import type { ModelAnimationClip, ModelBoneBinding, ModelNode, ModelPrimitive } from '@modkit/sdk'
import { snapshotModelSkeleton, createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { snapshotModelAnimations } from '@modkit/codec-kit/model/animation'
import type { RenderModel, RenderMesh } from '@modkit/codec-kit/legacy/models'
import {
  BufferBuilder,
  encodeSkeleton,
  addJointAttribute,
  encodeAnimationChannel,
  addAccessor,
} from './legacy/rig-kernels.js'
import type { UvmJsonObject } from './legacy/rig-types.js'
import { uvmVisibilityPointer } from './animation-clips.js'
import { uvmKeyTimesMetadata } from './key-times.js'

export interface RigStorage {
  readonly buffer: BufferBuilder
  readonly views: UvmJsonObject[]
  readonly accessors: UvmJsonObject[]
}

export interface UvmSkin {
  joints: number[]
  inverseBindMatrices: number
  skeleton?: number
}

function refuse(message: string): never {
  throw new TypeError(`UVM rig refused: ${message}`)
}

function unitQuaternion(values: Iterable<number>): boolean {
  return Math.abs(Math.hypot(...values) - 1) <= 0.0001
}

/**
 * Bind the unchanged MK2 writer to MK3's explicit scene identities. The frozen writer owns binary
 * layout; this adapter owns joins and refuses unknown bind transforms. It never substitutes the
 * frozen writer's legacy identity fallback for an absent MK3 inverse bind matrix.
 */
export function prepareUvmSkeleton(
  source: readonly ModelBoneBinding[],
  nodes: readonly ModelNode[],
  storage: RigStorage,
  budget?: Parameters<typeof snapshotModelSkeleton>[1],
  signal?: AbortSignal,
) {
  const bindings = snapshotModelSkeleton(source, budget, signal)
  const nodeIndices = new Map(nodes.map((node, index) => [node.id, index]))
  const parents = new Map<string, string>()
  for (const node of nodes) {
    for (const child of node.childIds ?? []) {
      if (!nodeIndices.has(child) || parents.has(child))
        refuse('scene has a missing or multiply parented node')
      parents.set(child, node.id)
    }
  }
  if (nodeIndices.size !== nodes.length) refuse('scene node ids are not unique')
  const groups = new Map<string, ModelBoneBinding[]>()
  for (const bone of bindings) {
    if (!bone.hierarchyId) refuse('bone has no explicit hierarchy')
    const group = groups.get(bone.hierarchyId) ?? []
    group.push(bone)
    groups.set(bone.hierarchyId, group)
  }
  const skins: UvmSkin[] = []
  const groupingRoots: { skin: number; children: number[] }[] = []
  const boneByNode = new Map<string, ModelBoneBinding>()
  const hierarchies = new Map<string, { skin: number; slots: ReadonlyMap<number, number> }>()
  for (const [hierarchyId, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    group.sort((a, b) => a.boneIndex - b.boneIndex)
    if (group.length > 65536) refuse('skin exceeds the unsigned 16-bit joint index range')
    const slots = new Map(group.map((bone, slot) => [bone.boneIndex, slot]))
    const groupNodes = new Set(group.map(bone => bone.nodeId))
    const expectedNodes = createModelSkeletonNodes(group, hierarchyId, budget, signal)
    for (const [slot, expected] of expectedNodes.entries()) {
      const bone = group[slot]!
      const node = nodes[nodeIndices.get(expected.id) ?? -1]
      if (!node || boneByNode.has(expected.id))
        refuse('bone node is absent or belongs to multiple skins')
      if (
        node.transform.length !== 16 ||
        node.transform.some((value, index) => value !== expected.transform[index])
      )
        refuse(`node ${node.id} disagrees with the bone local pose`)
      if (!unitQuaternion(bone.localPose!.rotation))
        refuse('bone rotation is not a unit quaternion')
      if (bone.inverseBindMatrix === undefined) refuse('bone has no explicit inverse bind matrix')
      const inverse = Float32Array.from(bone.inverseBindMatrix)
      if (!inverse.every(Number.isFinite)) refuse('inverse bind matrix exceeds finite float range')
      if (inverse[3] !== 0 || inverse[7] !== 0 || inverse[11] !== 0 || inverse[15] !== 1)
        refuse('inverse bind matrix is not affine')
      let parentId = parents.get(node.id)
      const visited = new Set<string>()
      while (parentId !== undefined && !groupNodes.has(parentId)) {
        if (visited.has(parentId)) refuse('scene ancestor cycle')
        visited.add(parentId)
        const ancestor = nodes[nodeIndices.get(parentId)!]!
        if (
          ancestor.transform.length !== 16 ||
          ancestor.transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0))
        )
          refuse('a non-joint ancestor transform requires explicit rebasing')
        parentId = parents.get(parentId)
      }
      if (bone.parentBoneIndex !== null) {
        const parent = group[slots.get(bone.parentBoneIndex!)!]!
        if (parentId !== parent.nodeId) refuse('scene and bone parents disagree')
      } else if (parentId !== undefined) {
        refuse('scene and root bone parents disagree')
      }
      boneByNode.set(node.id, bone)
    }
    const model: RenderModel = {
      format: 'model-facets',
      meshes: [],
      materials: [],
      animations: [],
      bounds: null,
      effects: { particles: [], ribbons: [] },
      skeleton: {
        skinningInverses: 'inverse-bind-matrices',
        bones: group.map((bone, index) => ({
          index,
          name: bone.boneName ?? '',
          parentIndex: bone.parentBoneIndex === null ? -1 : slots.get(bone.parentBoneIndex!)!,
          inverseBindMatrix: Float32Array.from(bone.inverseBindMatrix!),
        })),
      },
    }
    const encoded = encodeSkeleton(model, [], storage.buffer, storage.views, storage.accessors)
    const inverseBindMatrices = encoded.skins[0]?.['inverseBindMatrices']
    if (typeof inverseBindMatrices !== 'number')
      refuse('frozen skeleton writer returned no matrices')
    const joints = group.map(bone => nodeIndices.get(bone.nodeId!)!)
    const roots = group.filter(bone => bone.parentBoneIndex === null)
    if (roots.length > 1)
      groupingRoots.push({
        skin: skins.length,
        children: [
          ...new Set(
            roots.map(bone => {
              let root = bone.nodeId!
              while (parents.has(root)) root = parents.get(root)!
              return nodeIndices.get(root)!
            }),
          ),
        ],
      })
    hierarchies.set(hierarchyId, { skin: skins.length, slots })
    skins.push({
      joints,
      inverseBindMatrices,
      ...(roots.length === 1 ? { skeleton: nodeIndices.get(roots[0]!.nodeId!)! } : {}),
    })
  }
  return { skins, boneByNode, hierarchies, groupingRoots }
}

export function writeUvmSkinAttributes(
  primitive: ModelPrimitive,
  attributes: Record<string, number>,
  skeleton: ReturnType<typeof prepareUvmSkeleton>,
  storage: RigStorage,
): number {
  const hierarchy = skeleton.hierarchies.get(primitive.hierarchyId ?? '')
  if (!hierarchy) refuse(`primitive ${primitive.id} has no matching skeleton hierarchy`)
  const vertexCount = primitive.positions.length / 3
  if (
    primitive.boneIndices?.length !== vertexCount * 4 ||
    primitive.boneWeights?.length !== vertexCount * 4
  )
    refuse(`primitive ${primitive.id} needs four joint indices and weights per vertex`)
  const indices = new Uint16Array(primitive.boneIndices.length)
  for (const [index, joint] of primitive.boneIndices.entries()) {
    const slot = hierarchy.slots.get(joint)
    if (slot === undefined) refuse(`primitive ${primitive.id} references an unknown joint`)
    indices[index] = slot
  }
  const weights = Float32Array.from(primitive.boneWeights)
  if (weights.some(value => !Number.isFinite(value) || value < 0 || value > 1))
    refuse('skin weights must be finite values between zero and one')
  for (let offset = 0; offset < weights.length; offset += 4) {
    const sum =
      weights[offset]! + weights[offset + 1]! + weights[offset + 2]! + weights[offset + 3]!
    if (Math.abs(sum - 1) > 0.0001)
      refuse('skin weights must sum to one; no normalization is guessed')
  }
  const mesh: RenderMesh = {
    name: primitive.id,
    materialIndex: -1,
    positions: primitive.positions,
    indices: new Uint32Array(),
    boneIndices: indices,
    boneWeights: weights,
  }
  addJointAttribute(attributes, mesh, vertexCount, storage.buffer, storage.views, storage.accessors)
  return hierarchy.skin
}

export interface AnimationLoss {
  readonly clipId: string
  readonly channel?: number
  readonly reason: string
}

/** Standard glTF TRS channels, retaining MK2's independent-clock metadata. */
export function writeUvmAnimations(
  source: readonly ModelAnimationClip[],
  nodeIndices: ReadonlyMap<string, number>,
  boneByNode: ReadonlyMap<string, ModelBoneBinding>,
  storage: RigStorage,
  budget?: Parameters<typeof snapshotModelAnimations>[1],
  signal?: AbortSignal,
  primitiveIndices: ReadonlyMap<
    string,
    { readonly mesh: number; readonly primitive: number }
  > = new Map(),
  rigidNodeIds: ReadonlySet<string> = new Set(),
  /** Node id → morph target count of the node's mesh, for `weights` channels. */
  morphTargetCounts: ReadonlyMap<string, number> = new Map(),
  /**
   * Primitives drawn only when a clip shows them (`ModelPrimitive.hidden`): their visibility records
   * come first with stored value 0, and a clip's visibility channel on one animates that record.
   */
  hiddenPrimitives: readonly { readonly mesh: number; readonly primitive: number }[] = [],
) {
  const clips = snapshotModelAnimations(source, budget, signal)
  const animations: UvmJsonObject[] = []
  const catalog: UvmJsonObject[] = []
  const sequenceIndices = new Set<number>()
  const losses: AnimationLoss[] = []
  const visibility: UvmJsonObject[] = []
  const visibilityIndices = new Map<string, number>()
  for (const target of hiddenPrimitives) {
    visibilityIndices.set(`${target.mesh}/${target.primitive}/visibility`, visibility.length)
    visibility.push({ mesh: target.mesh, primitive: target.primitive, value: 0 })
  }
  for (const [clipIndex, clip] of clips.entries()) {
    const sequenceIndex = clip.sequenceIndex ?? clipIndex
    if (sequenceIndices.has(sequenceIndex))
      refuse('clips require distinct material sequence indices')
    sequenceIndices.add(sequenceIndex)
    const samplers: UvmJsonObject[] = []
    const channels: UvmJsonObject[] = []
    const targets = new Set<string>()
    for (const [index, channel] of clip.channels.entries()) {
      const path = channel.kind
      const node = nodeIndices.get(channel.target)
      const bone = boneByNode.get(channel.target)
      const width = path === 'rotation' ? 4 : 3
      const loss = (reason: string) => losses.push({ clipId: clip.id, channel: index, reason })
      if (path === 'visibility') {
        const primitive = primitiveIndices.get(channel.target)
        const binding =
          primitive === undefined && node !== undefined && bone !== undefined
            ? { node, binding: 'batch' as const }
            : undefined
        const samples = channel.samples
        if (
          (primitive === undefined && binding === undefined) ||
          channel.axis !== undefined ||
          !samples?.length ||
          (channel.interpolation !== 'step' && channel.interpolation !== 'linear')
        ) {
          loss('visibility channel has no explicit primitive target or scalar sampling semantics')
          continue
        }
        let previous = -Infinity
        if (
          !samples.every(sample => {
            const time = Math.fround(sample.timeSeconds ?? NaN)
            const valid =
              Number.isFinite(time) &&
              time >= 0 &&
              time > previous &&
              sample.value.length === 1 &&
              Number.isFinite(Math.fround(sample.value[0] ?? NaN))
            previous = time
            return valid
          })
        ) {
          loss(
            'visibility keys cannot be represented as finite, strictly increasing float32 samples',
          )
          continue
        }
        const targetKey =
          primitive === undefined
            ? `node/${binding!.node}/batch-visibility`
            : `${primitive.mesh}/${primitive.primitive}/visibility`
        if (targets.has(targetKey)) refuse(`clip ${clip.id} repeats primitive visibility`)
        targets.add(targetKey)
        let visibilityIndex = visibilityIndices.get(targetKey)
        if (visibilityIndex === undefined) {
          visibilityIndex = visibility.length
          visibilityIndices.set(targetKey, visibilityIndex)
          visibility.push({ ...(primitive ?? binding!), value: 1 })
        }
        const times = Float32Array.from(samples, sample => sample.timeSeconds ?? NaN)
        const values = Float32Array.from(samples, sample => sample.value[0] ?? NaN)
        const input = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          times,
          'SCALAR',
          5126,
          undefined,
          { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] },
        )
        const output = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          values,
          'SCALAR',
          5126,
        )
        channels.push({
          sampler: samplers.length,
          target: {
            path: 'pointer',
            extensions: {
              KHR_animation_pointer: { pointer: uvmVisibilityPointer(visibilityIndex) },
            },
          },
          extras: {
            uv: {
              ...uvmKeyTimesMetadata(samples.map(sample => sample.timeSeconds!)),
              ...(channel.concurrent === true
                ? {
                    sourceLineType: channel.interpolation === 'step' ? 0 : 1,
                    concurrent: true,
                    ...(channel.wrapSeconds === undefined
                      ? {}
                      : { wrapSeconds: channel.wrapSeconds }),
                    ...(channel.repeatCount === undefined
                      ? {}
                      : { repeatCount: channel.repeatCount }),
                  }
                : {}),
            },
          },
        })
        samplers.push({
          input,
          output,
          interpolation: channel.interpolation === 'step' ? 'STEP' : 'LINEAR',
        })
        if (
          samples.some(
            sample =>
              Math.fround(sample.timeSeconds ?? NaN) !== sample.timeSeconds ||
              sample.value.some(value => Math.fround(value) !== value),
          )
        )
          loss('visibility times or values were rounded to the glTF float32 representation')
        continue
      }
      if (path === 'weights') {
        // glTF morph weights: one key carries a weight per target of the node's mesh
        const count = morphTargetCounts.get(channel.target) ?? 0
        const samples = channel.samples
        if (
          node === undefined ||
          count === 0 ||
          channel.axis !== undefined ||
          !samples?.length ||
          (channel.interpolation !== 'step' && channel.interpolation !== 'linear')
        ) {
          loss('weights channel has no node with morph targets or no scalar sampling semantics')
          continue
        }
        let previous = -Infinity
        if (
          !samples.every(sample => {
            const time = Math.fround(sample.timeSeconds ?? NaN)
            const valid =
              Number.isFinite(time) &&
              time >= 0 &&
              time > previous &&
              sample.value.length === count &&
              sample.value.every(value => Number.isFinite(Math.fround(value)))
            previous = time
            return valid
          })
        ) {
          loss(`weights keys must be strictly increasing times with ${count} finite weights each`)
          continue
        }
        const key = `${node}/weights`
        if (targets.has(key)) refuse(`clip ${clip.id} has multiple channels for ${key}`)
        targets.add(key)
        const times = Float32Array.from(samples, sample => sample.timeSeconds ?? NaN)
        const input = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          times,
          'SCALAR',
          5126,
          undefined,
          { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] },
        )
        const output = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          Float32Array.from(samples.flatMap(sample => sample.value)),
          'SCALAR',
          5126,
        )
        channels.push({ sampler: samplers.length, target: { node, path: 'weights' } })
        samplers.push({
          input,
          output,
          interpolation: channel.interpolation === 'step' ? 'STEP' : 'LINEAR',
        })
        continue
      }
      if (
        !['translation', 'rotation', 'scale'].includes(path) ||
        channel.axis !== undefined ||
        node === undefined ||
        (bone === undefined && !rigidNodeIds.has(channel.target)) ||
        (clip.hierarchyId !== undefined && clip.hierarchyId !== bone?.hierarchyId)
      ) {
        loss('channel has no explicit TRS node target')
        continue
      }
      if (
        !channel.interpolation ||
        !channel.samples?.length ||
        (path === 'rotation' && channel.interpolation === 'linear') ||
        (path !== 'rotation' && channel.interpolation === 'spherical-linear')
      ) {
        loss('channel interpolation is not representable by glTF TRS')
        continue
      }
      const key = `${node}/${path}`
      if (targets.has(key)) refuse(`clip ${clip.id} has multiple channels for ${key}`)
      const cubic = channel.interpolation === 'cubic-spline'
      let previous = -Infinity
      const valid = channel.samples.every(sample => {
        const time = Math.fround(sample.timeSeconds!)
        const values = Float32Array.from(sample.value)
        const ok =
          Number.isFinite(time) &&
          time >= 0 &&
          time > previous &&
          values.length === width &&
          values.every(Number.isFinite) &&
          (width !== 4 || unitQuaternion(values)) &&
          (!cubic ||
            [sample.inTangent, sample.outTangent].every(
              tangent =>
                tangent?.length === width && tangent.every(value => Number.isFinite(value)),
            ))
        previous = time
        return ok
      })
      if (!valid) {
        loss('keys cannot be represented as finite, strictly increasing float32 glTF samples')
        continue
      }
      if (cubic) {
        // glTF CUBICSPLINE: per key [in-tangent, value, out-tangent], tangents in units per second
        const times = Float32Array.from(channel.samples, sample => sample.timeSeconds!)
        const input = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          times,
          'SCALAR',
          5126,
          undefined,
          { min: [times[0] ?? 0], max: [times[times.length - 1] ?? 0] },
        )
        const output = addAccessor(
          storage.buffer,
          storage.views,
          storage.accessors,
          Float32Array.from(
            channel.samples.flatMap(sample => [
              ...sample.inTangent!,
              ...sample.value,
              ...sample.outTangent!,
            ]),
          ),
          width === 4 ? 'VEC4' : 'VEC3',
          5126,
        )
        const keyTimes = uvmKeyTimesMetadata(channel.samples.map(sample => sample.timeSeconds!))
        const uv = {
          ...(channel.concurrent === true
            ? {
                concurrent: true,
                ...(channel.wrapSeconds === undefined ? {} : { wrapSeconds: channel.wrapSeconds }),
                ...(channel.repeatCount === undefined ? {} : { repeatCount: channel.repeatCount }),
              }
            : {}),
          ...keyTimes,
        }
        channels.push({
          sampler: samplers.length,
          target: { node, path },
          ...(Object.keys(uv).length ? { extras: { uv } } : {}),
        })
        samplers.push({ input, output, interpolation: 'CUBICSPLINE' })
        targets.add(key)
        if (
          channel.samples.some(sample =>
            [
              sample.timeSeconds!,
              ...sample.value,
              ...sample.inTangent!,
              ...sample.outTangent!,
            ].some(value => Math.fround(value) !== value),
          )
        )
          loss('key times, values or tangents were rounded to the glTF float32 representation')
        continue
      }
      const emitted = encodeAnimationChannel(
        {
          lineType: channel.interpolation === 'step' ? 0 : 1,
          globalSeqId: null,
          keys: channel.samples.map(sample => ({
            frame: sample.timeSeconds!,
            vector: sample.value,
          })),
        },
        width,
        node,
        path as 'translation' | 'rotation' | 'scale',
        samplers,
        channels,
        storage.buffer,
        storage.views,
        storage.accessors,
        channel.concurrent === true ? true : undefined,
        channel.wrapSeconds,
      )
      if (!emitted) {
        loss('frozen UVM writer refused the channel')
        continue
      }
      const emittedChannel = channels[channels.length - 1]!
      const keyTimes = uvmKeyTimesMetadata(channel.samples.map(sample => sample.timeSeconds!))
      if (Object.keys(keyTimes).length) {
        emittedChannel['extras'] = {
          uv: {
            sourceLineType: channel.interpolation === 'step' ? 0 : 1,
            ...(channel.concurrent === true
              ? {
                  concurrent: true,
                  ...(channel.wrapSeconds === undefined
                    ? {}
                    : { wrapSeconds: channel.wrapSeconds }),
                  ...(channel.repeatCount === undefined
                    ? {}
                    : { repeatCount: channel.repeatCount }),
                }
              : {}),
            ...keyTimes,
          },
        }
      }
      targets.add(key)
      if (
        channel.samples.some(
          sample =>
            Math.fround(sample.timeSeconds!) !== sample.timeSeconds ||
            sample.value.some(value => Math.fround(value) !== value),
        )
      )
        loss('key times or values were rounded to the glTF float32 representation')
    }
    if ((clip.unsupportedChannels ?? 0) > 0)
      losses.push({
        clipId: clip.id,
        reason: `${clip.unsupportedChannels} source channels are not represented by the facet`,
      })
    const durationSeconds =
      clip.durationSeconds ??
      clip.channels.reduce(
        (end, channel) =>
          (channel.samples ?? []).reduce(
            (last, sample) => Math.max(last, sample.timeSeconds ?? 0),
            end,
          ),
        0,
      )
    const animationIndex = channels.length === 0 ? undefined : animations.length
    catalog.push({
      id:
        animationIndex === undefined ? `sequence-${sequenceIndex}` : `animation-${animationIndex}`,
      sourceId: clip.id,
      name: clip.name,
      durationSeconds,
      sourceSequenceIndex: sequenceIndex,
      kind: clip.kind,
      frames: clip.frames,
      ...(animationIndex === undefined ? {} : { animation: animationIndex }),
      ...(clip.looping === undefined ? {} : { looping: clip.looping }),
      ...(clip.repeatCount === undefined ? {} : { repeatCount: clip.repeatCount }),
    })
    if (animationIndex === undefined) continue
    animations.push({
      name: clip.name,
      samplers,
      channels,
      extras: {
        uv: {
          sourceSequenceIndex: sequenceIndex,
          ...(clip.durationSeconds === undefined
            ? {}
            : { sourceDurationSeconds: clip.durationSeconds }),
          ...(clip.looping === undefined ? {} : { looping: clip.looping }),
          ...(clip.repeatCount === undefined ? {} : { repeatCount: clip.repeatCount }),
        },
      },
    })
  }
  return { animations, catalog, visibility, losses }
}
