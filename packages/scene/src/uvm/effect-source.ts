import type { SceneRendererMaterial, SceneRendererPrimitive } from '@modkit/sdk/renderer'
import { createUvmProjectorFrame, type UvmProjectorFrameCache } from './projectors.js'
import { readUvmContainer } from '@modkit/uv/model/container'
import { createModelSceneSampler } from '../model/sampler.js'
import {
  createUvmEffectFrame,
  createUvmEffectFrameCache,
  snapshotUvmEffectExtension,
} from './effects.js'
import type { JsonValue } from '@modkit/sdk'
import { readUvmModel } from './model.js'
import { field } from './values.js'

export interface UvmEffectSource {
  readonly hasProjectors: boolean
  /** Particles or ribbons: a frame simulates them up to its clock. */
  readonly liveEffects: boolean
  /**
   * Whether `project` can answer differently at another clock: a projector track, or a projector
   * (or the effect space) on a node the clip moves. Otherwise every clock projects the same decals.
   */
  readonly projectionsFollowTime: boolean
  /** `cache` belongs to one placement: its projectors keep what they clipped and made last time. */
  project(
    time: number,
    materials: readonly SceneRendererMaterial[],
    receivers: readonly SceneRendererPrimitive[],
    cache?: UvmProjectorFrameCache,
  ): ReturnType<typeof createUvmProjectorFrame>
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
 * Uses the actor-selected sequence, including material-only sequences without keyed bones.
 * Returns undefined for a model without UV_game_effects.
 */
export function createUvmEffectSource(
  bytes: Uint8Array,
  sequenceIndex?: number,
): UvmEffectSource | undefined {
  const { document, binary } = readUvmContainer(bytes)
  if (field(document['extensions'], 'UV_game_effects') === undefined) return undefined
  const { scene, rig } = readUvmModel(document, binary, { maxScalarBytes: MAX_BYTES })
  const clip =
    sequenceIndex === undefined
      ? (rig.clips.find(candidate => candidate.name?.toLowerCase() === 'stand') ??
        rig.clips.find(
          candidate => candidate.kind === 'animation' && candidate.channels.length > 0,
        ))
      : rig.clips.find(candidate => candidate.sequenceIndex === sequenceIndex)
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
      ...(clip === undefined || clip.kind !== 'animation'
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
  const effects = field(document['extensions'], 'UV_game_effects')
  const entries = (key: string): readonly unknown[] => {
    const value = field(effects, key)
    return Array.isArray(value) ? value : []
  }
  // Nodes whose world transform the clip moves: its targets, their children and the bones below
  // them, as the pose sampler composes them.
  const animatedNodes = new Set<string>()
  if (clip?.kind === 'animation') {
    const below = new Map<string, string[]>()
    for (const node of scene.nodes) below.set(node.id, [...(node.childIds ?? [])])
    const bones = new Map(rig.bindings.map(binding => [binding.boneIndex, binding]))
    for (const binding of rig.bindings) {
      const parent =
        binding.parentBoneIndex == null ? undefined : bones.get(binding.parentBoneIndex)
      if (parent?.nodeId === undefined || binding.nodeId === undefined) continue
      below.set(parent.nodeId, [...(below.get(parent.nodeId) ?? []), binding.nodeId])
    }
    const pending = clip.channels
      .filter(channel => channel.kind !== 'visibility' && (channel.samples?.length ?? 0) > 0)
      .map(channel => channel.target)
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (animatedNodes.has(id)) continue
      animatedNodes.add(id)
      pending.push(...(below.get(id) ?? []))
    }
  }
  const spaceNode = field(effects, 'spaceNode')
  const projectionsFollowTime =
    (typeof spaceNode === 'number' && animatedNodes.has(`node-${spaceNode}`)) ||
    entries('projectors').some(
      entry =>
        field(entry, 'sequenceAnimation') !== undefined ||
        animatedNodes.has(`node-${String(field(entry, 'node'))}`),
    )
  // This document is private to the source and never changes: every instance and frame reads one
  // snapshot of its effects instead of copying the whole extension per call.
  let snapshot: JsonValue | undefined
  const effectSnapshot = (): JsonValue =>
    (snapshot ??= snapshotUvmEffectExtension(document, {
      maxBytes: MAX_BYTES,
      maxNodes: MAX_NODES,
    }))
  // Seeking to one clock samples the same historical times whatever the view, so a new camera (or
  // another instance at that clock) reuses the poses instead of re-sampling the rig. Frames seek on
  // a fixed step grid (see createUvmEffectFrame), whose step times agree between frames to far below
  // a microsecond: poses are kept by microsecond, so the next frame samples only its new steps.
  // ponytail: whole-map clear at a fixed size; an LRU if clocks start varying per frame.
  const poses = new Map<number, ReturnType<typeof pose.sample>['nodeTransforms']>()
  const nodeTransformsAt = (at: number) => {
    const key = Math.round(at * 1e6)
    let transforms = poses.get(key)
    if (transforms === undefined) {
      if (poses.size >= MAX_CACHED_POSES) poses.clear()
      transforms = pose.sample(at).nodeTransforms
      poses.set(key, transforms)
    }
    return transforms
  }
  // Every instance at one clock shares the prepared emitters and one simulation; a view or instance
  // only builds its sprites (see UvmEffectFrameCache).
  const frames = createUvmEffectFrameCache()
  return Object.freeze<UvmEffectSource>({
    hasProjectors: entries('projectors').length > 0,
    liveEffects: entries('particles').length + entries('ribbons').length > 0,
    projectionsFollowTime,
    project: (time, materials, receivers, cache) =>
      createUvmProjectorFrame(document, {
        ...(cache === undefined ? {} : { cache }),
        time,
        materials,
        receivers,
        activeNodes,
        nodeTransforms: nodeTransformsAt(time),
        ...(clip?.sequenceIndex === undefined ? {} : { sequenceIndex: clip.sequenceIndex }),
        maxBytes: MAX_BYTES,
        maxNodes: MAX_NODES,
        warn: () => {},
      }),
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
        extensionSnapshot: effectSnapshot(),
        cache: frames,
      }),
  })
}
