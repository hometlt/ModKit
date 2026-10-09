import type { SceneRendererMaterial, SceneRendererPrimitive } from '@modkit/sdk/renderer'
import { createUvmProjectorFrame, type UvmProjectorFrameCache } from './projectors.js'
import { readUvmContainer } from '@modkit/uv/model/container'
import { createModelSceneSampler } from '../model/sampler.js'
import {
  createUvmEffectFrame,
  createUvmEffectFrameCache,
  snapshotUvmEffectExtension,
} from './effects.js'
import type { JsonObject, JsonValue } from '@modkit/sdk'
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
  /** `pass`: the caller's frame (UvmEffectFrameOptions.pass). */
  frame(
    time: number,
    materials: readonly SceneRendererMaterial[],
    viewMatrix: Float32Array,
    pass?: unknown,
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
  const baked = field(document['extensions'], 'UV_game_baked_particles') !== undefined
  if (field(document['extensions'], 'UV_game_effects') === undefined && !baked) return undefined
  const { scene, rig } = readUvmModel(document, binary, { maxScalarBytes: MAX_BYTES })
  const clip =
    sequenceIndex === undefined
      ? (rig.clips.find(candidate => candidate.name?.toLowerCase() === 'stand') ??
        rig.clips.find(
          candidate => candidate.kind === 'animation' && candidate.channels.length > 0,
        ))
      : rig.clips.find(candidate => candidate.sequenceIndex === sequenceIndex)
  const poseClip =
    clip === undefined || clip.kind !== 'animation'
      ? undefined
      : { ...clip, channels: clip.channels.filter(channel => channel.kind !== 'visibility') }
  // Emitters sample historical node poses while seeking; a geometry-free sampler avoids skinning.
  const pose = createModelSceneSampler(
    {
      nodes: scene.nodes.map(node => ({ ...node, meshIds: [] })),
      meshes: [],
      primitives: [],
      skeleton: rig.bindings,
      nodePoses: rig.nodePoses,
    },
    { maxBytes: MAX_BYTES, ...(poseClip === undefined ? {} : { clip: poseClip }) },
  )
  // Every step of every effect lane reads the few nodes the effect names (see anchoredPose).
  const anchors = anchoredPose(document, scene, rig, poseClip, pose)
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
      transforms = anchors === undefined ? pose.sample(at).nodeTransforms : anchors.at(at)
      poses.set(key, transforms)
    }
    return transforms
  }
  // Every instance at one clock shares the prepared emitters and one simulation; a view or instance
  // only builds its sprites (see UvmEffectFrameCache).
  const frames = createUvmEffectFrameCache()
  return Object.freeze<UvmEffectSource>({
    hasProjectors: entries('projectors').length > 0,
    liveEffects: baked || entries('particles').length + entries('ribbons').length > 0,
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
    frame: (
      time: number,
      materials: readonly SceneRendererMaterial[],
      viewMatrix: Float32Array,
      pass?: unknown,
    ) =>
      createUvmEffectFrame(document, {
        ...(pass === undefined ? {} : { pass }),
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
        // A map places many effects: an emitter's sprites draw as one primitive.
        batchParticles: true,
      }),
  })
}

type ScenePoseSampler = ReturnType<typeof createModelSceneSampler>
type ScenePoseClip = NonNullable<Parameters<typeof createModelSceneSampler>[1]>['clip']

/**
 * Scene node ids an effect names: every `node` and `spaceNode` index in UV_game_effects (emitters,
 * ribbons, projectors, fields, spline ends), the `spaceNode` of UV_game_baked_particles and the
 * nodes that carry collision volumes.
 */
function effectNodeIds(document: JsonObject): Set<string> {
  const nodes = Array.isArray(document['nodes']) ? document['nodes'] : []
  const ids = new Set<string>()
  const pending: unknown[] = [
    field(document['extensions'], 'UV_game_effects'),
    field(document['extensions'], 'UV_game_baked_particles'),
  ]
  while (pending.length > 0) {
    const value = pending.pop()
    if (Array.isArray(value)) for (const item of value) pending.push(item)
    else if (value !== null && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        if (
          (key === 'node' || key === 'spaceNode') &&
          typeof item === 'number' &&
          Number.isSafeInteger(item) &&
          item >= 0 &&
          item < nodes.length
        )
          ids.add(`node-${item}`)
        else pending.push(item)
      }
  }
  for (const [index, node] of nodes.entries())
    if (field(field(node, 'extensions'), 'UV_game_collision') !== undefined)
      ids.add(`node-${index}`)
  return ids
}

/**
 * The world transforms effect steps read, from a sampler of only the nodes the effect names and
 * their ancestors. A node's world transform composes its ancestors' alone (bones, their rigid
 * children and posed nodes alike), so those nodes come out bit for bit as from the whole rig, which
 * every step sampled before; any other node is read from a sample of the whole rig. Kept only where
 * neither sampler loses a hierarchy's pose and both agree at the clip's start and middle.
 */
function anchoredPose(
  document: JsonObject,
  scene: ReturnType<typeof readUvmModel>['scene'],
  rig: ReturnType<typeof readUvmModel>['rig'],
  clip: ScenePoseClip,
  whole: ScenePoseSampler,
): { at(time: number): ReadonlyMap<string, Float32Array> } | undefined {
  const parents = new Map<string, string>()
  for (const node of scene.nodes) for (const child of node.childIds) parents.set(child, node.id)
  const kept = new Set<string>()
  for (const id of effectNodeIds(document))
    for (let at: string | undefined = id; at !== undefined && !kept.has(at); at = parents.get(at))
      kept.add(at)
  if (kept.size === 0 || kept.size >= scene.nodes.length) return undefined
  let part: ScenePoseSampler
  try {
    part = createModelSceneSampler(
      {
        nodes: scene.nodes
          .filter(node => kept.has(node.id))
          .map(node => ({
            ...node,
            meshIds: [],
            childIds: node.childIds.filter(child => kept.has(child)),
          })),
        meshes: [],
        primitives: [],
        skeleton: rig.bindings.filter(bone => bone.nodeId !== undefined && kept.has(bone.nodeId)),
        nodePoses: (rig.nodePoses ?? []).filter(node => kept.has(node.nodeId)),
      },
      {
        maxBytes: MAX_BYTES,
        ...(clip === undefined
          ? {}
          : {
              clip: {
                ...clip,
                channels: clip.channels.filter(channel => kept.has(channel.target)),
              },
            }),
      },
    )
  } catch {
    return undefined
  }
  const unposed = (sampler: ScenePoseSampler) =>
    sampler.diagnostics.some(item => item.code === 'common.model/pose-unavailable')
  if (unposed(whole) || unposed(part)) return undefined
  for (const time of new Set([0, (clip?.durationSeconds ?? 0) / 2])) {
    const expected = whole.sample(time).nodeTransforms,
      actual = part.sample(time).nodeTransforms
    for (const id of kept) {
      const left = expected.get(id),
        right = actual.get(id)
      if (
        left === undefined ||
        right === undefined ||
        left.length !== right.length ||
        left.some((value, index) => !Object.is(value, right[index]))
      )
        return undefined
    }
  }
  return {
    at: time =>
      new AnchoredNodeTransforms(
        part.sample(time).nodeTransforms,
        kept,
        () => whole.sample(time).nodeTransforms,
      ),
  }
}

/** One moment's node transforms: named nodes from the anchored sample, others from the whole rig. */
class AnchoredNodeTransforms implements ReadonlyMap<string, Float32Array> {
  readonly #anchored: ReadonlyMap<string, Float32Array>
  readonly #kept: ReadonlySet<string>
  readonly #sampleWhole: () => ReadonlyMap<string, Float32Array>
  #whole: ReadonlyMap<string, Float32Array> | undefined

  constructor(
    anchored: ReadonlyMap<string, Float32Array>,
    kept: ReadonlySet<string>,
    sampleWhole: () => ReadonlyMap<string, Float32Array>,
  ) {
    this.#anchored = anchored
    this.#kept = kept
    this.#sampleWhole = sampleWhole
  }

  #all(): ReadonlyMap<string, Float32Array> {
    return (this.#whole ??= this.#sampleWhole())
  }

  get(id: string) {
    return this.#kept.has(id) ? this.#anchored.get(id) : this.#all().get(id)
  }

  has(id: string) {
    return this.#kept.has(id) || this.#all().has(id)
  }

  get size() {
    return this.#all().size
  }

  forEach(
    callback: (value: Float32Array, key: string, map: ReadonlyMap<string, Float32Array>) => void,
    thisArg?: unknown,
  ) {
    for (const [key, value] of this.#all()) callback.call(thisArg, value, key, this)
  }

  entries() {
    return this.#all().entries()
  }

  keys() {
    return this.#all().keys()
  }

  values() {
    return this.#all().values()
  }

  [Symbol.iterator]() {
    return this.#all()[Symbol.iterator]()
  }
}
