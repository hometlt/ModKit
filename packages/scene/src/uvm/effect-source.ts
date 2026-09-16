import type { SceneRendererMaterial } from '@modkit/sdk/renderer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { createModelSceneSampler } from '../model/sampler.js'
import { createUvmEffectFrame } from './effects.js'
import { readUvmModel } from './model.js'
import { field } from './values.js'

export interface UvmEffectSource {
  /** Seconds of the looping clip whose sequence drives emission, when the model has one. */
  readonly clipSeconds?: number
  frame(
    time: number,
    materials: readonly SceneRendererMaterial[],
    viewMatrix: Float32Array,
  ): ReturnType<typeof createUvmEffectFrame>
}

const MAX_BYTES = 64 * 1024 * 1024
const MAX_NODES = 1_000_000
const MAX_CACHED_POSES = 4_096

/**
 * Reusable live effects of one source-free UVM for scenes that place many instances (world maps).
 * Same pose and clip rule as the world model sampler: the first animation clip with channels.
 * Returns undefined for a model without UV_game_effects.
 */
export function createUvmEffectSource(bytes: Uint8Array): UvmEffectSource | undefined {
  const { document, binary } = readUvmContainer(bytes)
  if (field(document['extensions'], 'UV_game_effects') === undefined) return undefined
  const { scene, rig } = readUvmModel(document, binary, { maxScalarBytes: MAX_BYTES })
  const clip = rig.clips.find(
    candidate => candidate.kind === 'animation' && candidate.channels.length > 0,
  )
  // Emitters sample historical node poses while seeking; a geometry-free sampler avoids skinning.
  const pose = createModelSceneSampler(
    {
      nodes: scene.nodes.map(node => ({ ...node, meshIds: [] })),
      meshes: [],
      primitives: [],
      skeleton: rig.bindings,
      nodePoses: rig.nodePoses,
    },
    {
      maxBytes: MAX_BYTES,
      ...(clip === undefined
        ? {}
        : {
            clip: {
              ...clip,
              channels: clip.channels.filter(channel => channel.kind !== 'visibility'),
            },
          }),
    },
  )
  const activeNodes = new Set(scene.nodes.map(node => node.id))
  // Seeking to one clock samples the same historical times whatever the view, so a new camera (or
  // another instance at that clock) reuses the poses instead of re-sampling the rig.
  // ponytail: whole-map clear at a fixed size; an LRU if clocks start varying per frame.
  const poses = new Map<number, ReturnType<typeof pose.sample>['nodeTransforms']>()
  const nodeTransformsAt = (at: number) => {
    let transforms = poses.get(at)
    if (transforms === undefined) {
      if (poses.size >= MAX_CACHED_POSES) poses.clear()
      transforms = pose.sample(at).nodeTransforms
      poses.set(at, transforms)
    }
    return transforms
  }
  return Object.freeze<UvmEffectSource>({
    ...(clip?.durationSeconds === undefined ? {} : { clipSeconds: clip.durationSeconds }),
    frame: (time: number, materials: readonly SceneRendererMaterial[], viewMatrix: Float32Array) =>
      createUvmEffectFrame(document, {
        projectorsHandled: true,
        binary,
        time,
        ...(clip?.sequenceIndex === undefined ? {} : { sequenceIndex: clip.sequenceIndex }),
        materials,
        activeNodes,
        maxBytes: MAX_BYTES,
        maxNodes: MAX_NODES,
        nodeTransformsAt,
        viewMatrix,
      }),
  })
}
