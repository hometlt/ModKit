import type { RenderBone, RenderScalarAnimationTrack } from '../legacy-model-support.js'
import type { RenderNodeTrackSet, RenderSequence } from '../legacy/models/animation.js'
import type { ModelAnimationClip, ModelBoneBinding, ModelNode } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '../json-snapshot.js'
import {
  composeTrsMatrix,
  multiplyMat4,
  SequencePoseSampler,
  type SequencePoseBlendSample,
} from '../model-math/sequence-pose.js'
import { createModelAnimationSampler, type ModelAnimationValue } from './animation.js'

export const DEFAULT_MODEL_SKELETON_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBytes: 134_217_728,
})

function vector(value: unknown, size: number, label: string): void {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some(x => typeof x !== 'number' || !Number.isFinite(x))
  )
    throw new TypeError(`invalid ${label}`)
}

/** Own all optional semantic fields while retaining older descriptive skeleton publishers. */
export function snapshotModelSkeleton(
  bindings: readonly ModelBoneBinding[],
  budget: JsonSnapshotBudget = DEFAULT_MODEL_SKELETON_BUDGET,
  signal?: AbortSignal,
): readonly ModelBoneBinding[] {
  const owned = snapshotJson(bindings, budget, signal) as unknown as readonly ModelBoneBinding[]
  if (!Array.isArray(owned)) throw new TypeError('skeleton bindings must be an array')
  for (const bone of owned) {
    if (
      bone === null ||
      typeof bone !== 'object' ||
      typeof bone.partId !== 'string' ||
      !Number.isSafeInteger(bone.boneIndex) ||
      bone.boneIndex < 0 ||
      (bone.boneName !== null && typeof bone.boneName !== 'string')
    )
      throw new TypeError('invalid bone binding')
    if (bone.nodeId !== undefined && (typeof bone.nodeId !== 'string' || bone.nodeId.length === 0))
      throw new TypeError('invalid bone node id')
    if (bone.localPose !== undefined) {
      vector(bone.localPose.translation, 3, 'bone translation')
      vector(bone.localPose.rotation, 4, 'bone rotation')
      vector(bone.localPose.scale, 3, 'bone scale')
    }
    if (bone.inverseBindMatrix !== undefined)
      vector(bone.inverseBindMatrix, 16, 'inverse bind matrix')
  }
  return owned
}

function compileHierarchy(bindings: readonly ModelBoneBinding[], hierarchyId: string) {
  const bones = bindings
    .filter(bone => bone.hierarchyId === hierarchyId)
    .sort((a, b) => a.boneIndex - b.boneIndex)
  if (!hierarchyId || bones.length === 0) throw new TypeError('skeleton hierarchy is absent')
  const byIndex = new Map<number, number>()
  const byNode = new Map<string, number>()
  for (const [slot, bone] of bones.entries()) {
    if (
      bone.nodeId === undefined ||
      bone.localPose === undefined ||
      bone.parentBoneIndex === undefined
    )
      throw new TypeError('bone has no explicit scene node, local pose or parent')
    if (byIndex.has(bone.boneIndex) || byNode.has(bone.nodeId))
      throw new TypeError('ambiguous skeleton binding')
    byIndex.set(bone.boneIndex, slot)
    byNode.set(bone.nodeId, slot)
  }
  const parents = bones.map(bone => {
    if (bone.parentBoneIndex === null) return -1
    const slot = byIndex.get(bone.parentBoneIndex!)
    if (slot === undefined) throw new TypeError('bone parent is absent from hierarchy')
    return slot
  })
  // Iterative topology permits arbitrary storage order and avoids recursive depth exhaustion.
  const order: number[] = []
  const done = new Set<number>()
  for (let slot = 0; slot < bones.length; slot++) {
    const chain: number[] = []
    const visiting = new Set<number>()
    let current = slot
    while (current !== -1 && !done.has(current)) {
      if (visiting.has(current)) throw new TypeError('cyclic skeleton hierarchy')
      visiting.add(current)
      chain.push(current)
      current = parents[current]!
    }
    for (const entry of chain.reverse()) {
      done.add(entry)
      order.push(entry)
    }
  }
  return { bones, byNode, parents, order }
}

/** Build exact scene nodes from a named, complete skeleton; no binding or transform is guessed. */
export function createModelSkeletonNodes(
  bindings: readonly ModelBoneBinding[],
  hierarchyId: string,
  budget?: JsonSnapshotBudget,
  signal?: AbortSignal,
): readonly ModelNode[] {
  const { bones, parents } = compileHierarchy(
    snapshotModelSkeleton(bindings, budget, signal),
    hierarchyId,
  )
  const children = bones.map((): string[] => [])
  for (const [slot, parent] of parents.entries())
    if (parent >= 0) children[parent]!.push(bones[slot]!.nodeId!)
  return Object.freeze(
    bones.map((bone, slot) => {
      const transform = new Float32Array(16)
      const pose = bone.localPose!
      composeTrsMatrix(transform, 0, pose.translation, pose.rotation, pose.scale)
      if (!transform.every(Number.isFinite))
        throw new RangeError('bone transform exceeds finite float range')
      return Object.freeze({
        id: bone.nodeId!,
        ...(bone.boneName === null ? {} : { name: bone.boneName }),
        childIds: Object.freeze(children[slot]!),
        meshIds: Object.freeze([]),
        transform: Object.freeze(Array.from(transform)),
      })
    }),
  )
}

export interface ModelBonePoseSample {
  readonly boneIndex: number
  readonly nodeId: string
  readonly worldMatrix: readonly number[]
  /** Absent when the source does not supply an inverse bind matrix. */
  readonly skinningMatrix?: readonly number[]
}

/** Compile once; sample TRS, parent composition and world × inverse bind through shared math. */
export function createModelPoseSampler({
  bindings,
  hierarchyId,
  clip,
  budget,
  signal,
}: {
  readonly bindings: readonly ModelBoneBinding[]
  readonly hierarchyId: string
  readonly clip?: ModelAnimationClip
  readonly budget?: JsonSnapshotBudget
  readonly signal?: AbortSignal
}): {
  sample(
    timeSeconds: number,
    signal?: AbortSignal,
  ): {
    readonly bones: readonly ModelBonePoseSample[]
    readonly channels: readonly ModelAnimationValue[]
  }
} {
  const { bones, byNode, parents, order } = compileHierarchy(
    snapshotModelSkeleton(bindings, budget, signal),
    hierarchyId,
  )
  if (clip?.hierarchyId !== undefined && clip.hierarchyId !== hierarchyId)
    throw new TypeError('animation belongs to a different hierarchy')
  const animation =
    clip === undefined ? undefined : createModelAnimationSampler(clip, budget, signal)
  const world = new Float32Array(bones.length * 16)
  const local = new Float32Array(16)
  const skin = new Float32Array(16)
  return Object.freeze({
    sample(timeSeconds: number, requestSignal?: AbortSignal) {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isFinite(timeSeconds)) throw new TypeError('pose time must be finite')
      const channels = animation?.sample(timeSeconds, requestSignal) ?? Object.freeze([])
      const poses = bones.map(bone => ({ ...bone.localPose! }))
      const assigned = new Set<string>()
      for (const channel of channels) {
        if (!['translation', 'rotation', 'scale'].includes(channel.kind)) continue
        const slot = byNode.get(channel.target)
        if (slot === undefined || channel.axis !== undefined)
          throw new TypeError('animation has no whole-bone target')
        const key = `${slot}/${channel.kind}`
        if (assigned.has(key)) throw new TypeError('duplicate bone animation channel')
        assigned.add(key)
        vector(channel.value, channel.kind === 'rotation' ? 4 : 3, 'bone animation value')
        Object.assign(poses[slot]!, { [channel.kind]: channel.value })
      }
      const result: ModelBonePoseSample[] = new Array(bones.length)
      for (const slot of order) {
        if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
        const bone = bones[slot]!
        const pose = poses[slot]!
        composeTrsMatrix(local, 0, pose.translation, pose.rotation, pose.scale)
        const parent = parents[slot]!
        if (parent < 0) world.set(local, slot * 16)
        else multiplyMat4(world, slot * 16, world, parent * 16, local, 0)
        if (bone.inverseBindMatrix !== undefined)
          multiplyMat4(skin, 0, world, slot * 16, bone.inverseBindMatrix, 0)
        if (
          !world.subarray(slot * 16, slot * 16 + 16).every(Number.isFinite) ||
          (bone.inverseBindMatrix !== undefined && !skin.every(Number.isFinite))
        )
          throw new RangeError('bone pose exceeds finite float range')
        result[slot] = Object.freeze({
          boneIndex: bone.boneIndex,
          nodeId: bone.nodeId!,
          worldMatrix: Object.freeze(Array.from(world.subarray(slot * 16, slot * 16 + 16))),
          ...(bone.inverseBindMatrix === undefined
            ? {}
            : { skinningMatrix: Object.freeze(Array.from(skin)) }),
        })
      }
      return Object.freeze({ bones: Object.freeze(result), channels })
    },
  })
}

export interface ModelPoseBlendSample {
  readonly clip: ModelAnimationClip
  /** Explicit sequence-local time at the reference frame. Historical offsets may be negative. */
  readonly time: number
  readonly weight: number
  readonly additive?: boolean
}

/** Bounded neutral adapter to the existing pinned local-TRS blend kernel. Override gaps use
 * explicit local rest values; additive gaps stay identity deltas. Clip looping remains caller-owned,
 * while each declared concurrent channel retains the existing animation sampler's wrap semantics. */
export function createModelPoseBlendSampler({
  bindings,
  hierarchyId,
  samples,
  budget = DEFAULT_MODEL_SKELETON_BUDGET,
  signal,
}: {
  readonly bindings: readonly ModelBoneBinding[]
  readonly hierarchyId: string
  readonly samples: readonly ModelPoseBlendSample[]
  readonly budget?: JsonSnapshotBudget
  readonly signal?: AbortSignal
}) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > 32)
    throw new RangeError('poseSamples requires 1..32 entries')
  // Reserve for the combined JSON copy, validated skeleton/clip copies, compiled tracks and
  // per-frame sequence/TRS/matrix buffers; per-clip limits do not multiply the global allowance.
  const captureBudget = { ...budget, maxBytes: Math.floor(budget.maxBytes / 8) }
  // Capture the combined input before any sequences × bones allocation.
  const captured = snapshotJson({ bindings, samples }, captureBudget, signal) as unknown as {
    readonly bindings: readonly ModelBoneBinding[]
    readonly samples: readonly ModelPoseBlendSample[]
  }
  let active = 0
  for (const sample of captured.samples) {
    if (
      sample === null ||
      typeof sample !== 'object' ||
      Object.keys(sample).some(key => !['clip', 'time', 'weight', 'additive'].includes(key)) ||
      !Number.isFinite(sample.time) ||
      !Number.isFinite(sample.weight) ||
      sample.weight < 0 ||
      (sample.additive !== undefined && typeof sample.additive !== 'boolean')
    )
      throw new TypeError('invalid pose sample time, weight or mode')
    if (sample.weight > 0) active++
  }
  if (active === 0) throw new TypeError('poseSamples requires a positive weight')
  const { bones, byNode, parents, order } = compileHierarchy(
    snapshotModelSkeleton(captured.bindings, captureBudget, signal),
    hierarchyId,
  )
  const pairs = bones.length * captured.samples.length
  if (
    pairs > budget.maxNodes ||
    pairs * 1024 + bones.length * 512 > Math.floor(budget.maxBytes / 2)
  )
    throw new RangeError('pose blend sequences and bones exceed budget')
  const ordered = order.map(slot => {
    const bone = bones[slot]
    if (bone === undefined) throw new TypeError('pose blend bone absent')
    return bone
  })
  const ordinals = new Map(order.map((slot, ordinal) => [slot, ordinal]))
  const kernelBones: RenderBone[] = order.map((slot, ordinal) => {
    const bone = bones[slot],
      parent = parents[slot]
    if (bone === undefined || parent === undefined)
      throw new TypeError('pose blend hierarchy absent')
    const parentIndex = parent < 0 ? -1 : ordinals.get(parent)
    if (parentIndex === undefined) throw new TypeError('pose blend parent absent')
    return {
      index: ordinal,
      name: bone.boneName ?? `bone-${bone.boneIndex}`,
      parentIndex,
      ...(bone.inverseBindMatrix === undefined
        ? {}
        : { inverseBindMatrix: Float32Array.from(bone.inverseBindMatrix) }),
    }
  })
  const compiled = captured.samples.map(sample => {
    if (sample.clip?.hierarchyId !== undefined && sample.clip.hierarchyId !== hierarchyId)
      throw new TypeError('pose sample belongs to a different hierarchy')
    if ((sample.clip.unsupportedChannels ?? 0) > 0)
      throw new TypeError('pose sample has unresolved animation channels')
    const assigned = new Set<string>()
    for (const channel of sample.clip.channels) {
      if (
        !['translation', 'rotation', 'scale'].includes(channel.kind) ||
        channel.axis !== undefined ||
        !byNode.has(channel.target)
      )
        throw new TypeError('pose sample requires a whole-bone TRS target')
      const key = `${channel.target}/${channel.kind}`
      if (assigned.has(key)) throw new TypeError('duplicate pose blend channel')
      assigned.add(key)
    }
    return { sample, sampler: createModelAnimationSampler(sample.clip, captureBudget, signal) }
  })
  const kernel = new SequencePoseSampler(kernelBones)
  const constant = (value: readonly number[]): RenderScalarAnimationTrack => ({
    lineType: 0,
    globalSeqId: null,
    keys: [{ frame: 0, vector: value }],
  })
  return Object.freeze({
    sample(
      timeOffset = 0,
      requestSignal?: AbortSignal,
    ): {
      readonly bones: readonly ModelBonePoseSample[]
      readonly channels: readonly ModelAnimationValue[]
    } {
      signal?.throwIfAborted()
      requestSignal?.throwIfAborted()
      if (!Number.isFinite(timeOffset)) throw new TypeError('pose blend offset must be finite')
      const inputs: SequencePoseBlendSample[] = compiled.map(({ sample, sampler }) => {
        requestSignal?.throwIfAborted()
        const time = sample.time + timeOffset
        if (!Number.isFinite(time)) throw new RangeError('pose blend time overflow')
        const tracks: RenderNodeTrackSet[] = ordered.map((bone, boneIndex) => {
          const rest = bone.localPose
          if (rest === undefined) throw new TypeError('pose blend local rest absent')
          return sample.additive
            ? { boneIndex }
            : {
                boneIndex,
                translation: constant(rest.translation),
                rotation: constant(rest.rotation),
                scale: constant(rest.scale),
              }
        })
        for (const value of sampler.sample(time, requestSignal)) {
          const slot = byNode.get(value.target),
            ordinal = slot === undefined ? undefined : ordinals.get(slot)
          const target = ordinal === undefined ? undefined : tracks[ordinal]
          if (target === undefined) throw new TypeError('pose blend target absent')
          vector(value.value, value.kind === 'rotation' ? 4 : 3, 'pose blend channel value')
          if (value.kind === 'translation') target.translation = constant(value.value)
          else if (value.kind === 'rotation') target.rotation = constant(value.value)
          else if (value.kind === 'scale') target.scale = constant(value.value)
          else throw new TypeError('pose blend channel is not TRS')
        }
        const sequence: RenderSequence = {
          name: sample.clip.name,
          durationSeconds: sample.clip.durationSeconds ?? 0,
          looping: false,
          nodeTracks: tracks,
        }
        return {
          sequence,
          timeSeconds: 0,
          weight: sample.weight,
          ...(sample.additive === undefined ? {} : { additive: sample.additive }),
        }
      })
      const result = kernel.sampleBlendedPose(inputs)
      if (!result.world.every(Number.isFinite) || !result.skinning.every(Number.isFinite))
        throw new RangeError('pose blend exceeds finite float range')
      const output = ordered.map((bone, index): ModelBonePoseSample => {
        if (bone.nodeId === undefined) throw new TypeError('pose blend node absent')
        return Object.freeze({
          boneIndex: bone.boneIndex,
          nodeId: bone.nodeId,
          worldMatrix: Object.freeze(
            Array.from(result.world.subarray(index * 16, index * 16 + 16)),
          ),
          ...(bone.inverseBindMatrix === undefined
            ? {}
            : {
                skinningMatrix: Object.freeze(
                  Array.from(result.skinning.subarray(index * 16, index * 16 + 16)),
                ),
              }),
        })
      })
      return Object.freeze({
        bones: Object.freeze(output.sort((a, b) => a.boneIndex - b.boneIndex)),
        channels: Object.freeze([]),
      })
    },
  })
}
