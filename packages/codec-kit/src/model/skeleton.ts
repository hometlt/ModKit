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
import { linearStretch } from '../model-math/transform.js'
import {
  createModelAnimationSampler,
  type ModelAnimationExtent,
  type ModelAnimationValue,
} from './animation.js'

export const DEFAULT_MODEL_SKELETON_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBytes: 134_217_728,
})

function vector(value: unknown, size: number, label: string): void {
  if (!Array.isArray(value) || value.length !== size) throw new TypeError(`invalid ${label}`)
  for (let index = 0; index < size; index++) {
    const x: unknown = value[index]
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`invalid ${label}`)
  }
}

/** Whether the 16 values of `matrix` from `offset` are all finite. */
function finiteMatrix(matrix: Float32Array, offset: number): boolean {
  for (let index = offset; index < offset + 16; index++)
    if (!Number.isFinite(matrix[index]!)) return false
  return true
}

/** The 16 values of `matrix` from `offset` as a frozen array of numbers. */
function frozenMatrix(matrix: Float32Array, offset: number): readonly number[] {
  const m = (index: number) => matrix[offset + index]!
  return Object.freeze([
    m(0), m(1), m(2), m(3), m(4), m(5), m(6), m(7),
    m(8), m(9), m(10), m(11), m(12), m(13), m(14), m(15),
  ])
}

/** The TRS kind a bone channel animates: translation 0, rotation 1, scale 2; -1 for another kind. */
const boneChannelKind = (kind: string): number =>
  kind === 'translation' ? 0 : kind === 'rotation' ? 1 : kind === 'scale' ? 2 : -1

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

/** A bone of a pose sampler, in the order of its poses (by boneIndex). */
export interface ModelPoseBone {
  readonly boneIndex: number
  readonly nodeId: string
  /** Whether it has an inverse bind matrix, and so a skinning matrix. */
  readonly skinned: boolean
}

/**
 * How far any pose of a pose sampler's clip moves each bone from a pose at the middle of the clip's
 * values, whatever the time (its `extent`): a point p of a bone's frame (a vertex times the bone's
 * inverse bind, or a point of a node below the bone) lies at most `shift + turn·|p|` from where the
 * middle pose puts it, `center` times p. Its arrays are the sampler's own: read them, never write.
 */
export interface ModelPoseExtent {
  /**
   * Each bone's world matrix in the middle pose, as a sample composes it, 16 floats per bone in the
   * order of `bones`, column-major: each channel of the clip at the middle of its values, the rest
   * pose where none animates.
   */
  readonly center: Float32Array
  /** Per bone: a bound of the operator norm of its world matrix's linear part less the middle one. */
  readonly turn: Float64Array
  /** Per bone: a bound of the length of its world translation less the middle one. */
  readonly shift: Float64Array
}

/**
 * The most composeTrsMatrix's rotation of a quaternion at most `length` long lengthens a vector: it
 * does not normalize, and across the quaternion's axis scales by √(1 + 4|v|²(s² − 1)), s its length
 * and v its vector part (|v| ≤ s), along it by 1. So 1 for a quaternion no longer than a unit one.
 */
function quaternionStretch(length: number): number {
  return length <= 1 ? 1 : Math.sqrt(1 + 4 * length * length * (length * length - 1))
}

/** The length of a vector. */
function vectorLength(vector: readonly number[]): number {
  let sum = 0
  for (const x of vector) sum += x * x
  return Math.sqrt(sum)
}

/** How far `a` lies from `b` (from −b where `sign` is −1), vectors of one width. */
function vectorDistance(a: readonly number[], b: readonly number[], sign = 1): number {
  let sum = 0
  for (let axis = 0; axis < a.length; axis++) sum += (a[axis]! - sign * b[axis]!) ** 2
  return Math.sqrt(sum)
}

/** The middle of the box of points, by component. */
function boxMiddle(points: readonly (readonly number[])[]): number[] {
  return points[0]!.map((_, axis) => {
    let low = Infinity
    let high = -Infinity
    for (const point of points) {
      low = Math.min(low, point[axis]!)
      high = Math.max(high, point[axis]!)
    }
    return (low + high) / 2
  })
}

/**
 * A unit quaternion amid quaternions: their directions turned to the first's side, summed and
 * normalized; the first's direction where they cancel, the identity's where none has a length.
 */
function quaternionMiddle(points: readonly (readonly number[])[]): number[] {
  const first = points.find(point => vectorLength(point) > 0)
  if (first === undefined) return [0, 0, 0, 1]
  const sum = [0, 0, 0, 0]
  for (const point of points) {
    const length = vectorLength(point)
    if (!(length > 0)) continue
    let dot = 0
    for (let axis = 0; axis < 4; axis++) dot += point[axis]! * first[axis]!
    for (let axis = 0; axis < 4; axis++) sum[axis]! += ((dot < 0 ? -1 : 1) * point[axis]!) / length
  }
  const middle = vectorLength(sum) > 1e-9 ? sum : [...first]
  const length = vectorLength(middle)
  return middle.map(x => x / length)
}

/**
 * composeTrsMatrix's rotation of a quaternion q is I + B(q, q), B symmetric and bilinear with
 * ‖B(a, b)‖ ≤ |a₄||b⃗| + |b₄||a⃗| + 2|a⃗||b⃗| ≤ (1 + √2)·|a|·|b| (a₄ the scalar part, a⃗ the vector).
 */
const ROTATION_FORM = 1 + Math.SQRT2

/**
 * A bound of how far composeTrsMatrix's rotation of a channel's values (ModelAnimationExtent) lies
 * from the rotation of `middle`, in operator norm. Rotations of q and r differ by B(q − r, q + r):
 * at most (1 + √2)·|q − r|·|q + r|, over a hull each distance largest at a point. Unit quaternions
 * q and r rotate within 2·|q ∓ r| of each other (either sign); a quaternion within
 * (1 + √2)·||q| − 1|·(|q| + 1) of its direction; a value on an arc whose ends lie on one side of a
 * unit r is no farther from r (or −r) than the farther end. No two differ by more than both
 * stretches.
 */
function rotationDeviation(extent: ModelAnimationExtent, middle: readonly number[]): number {
  const middleLength = vectorLength(middle)
  const middleStretch = quaternionStretch(middleLength)
  if (extent.between === 'hull') {
    let length = 0
    let near = 0
    let far = 0
    for (const point of extent.points) {
      length = Math.max(length, vectorLength(point))
      near = Math.max(near, vectorDistance(point, middle))
      far = Math.max(far, vectorDistance(point, middle, -1))
    }
    return Math.min(quaternionStretch(length) + middleStretch, ROTATION_FORM * near * far)
  }
  // the middle's direction, and how far its rotation lies from the middle's
  const unit = middleLength > 0 ? middle.map(x => x / middleLength) : undefined
  const unitError = ROTATION_FORM * Math.abs(middleLength - 1) * (middleLength + 1)
  // how far a unit quaternion on the arc between unit ends (or at the one) rotates from `toward`
  const arc = (toward: readonly number[], ends: readonly (readonly number[])[]) => {
    const sides = ends.map(end => end.reduce((sum, x, axis) => sum + x * toward[axis]!, 0))
    const side = sides.every(dot => dot >= 0) ? 1 : sides.every(dot => dot <= 0) ? -1 : 0
    if (side === 0) return 2
    let farthest = 0
    for (const end of ends) farthest = Math.max(farthest, vectorDistance(end, toward, side))
    return Math.min(2, 2 * farthest)
  }
  let deviation = 0
  // the keys as they are: each from its direction, that from the middle's direction
  for (const point of extent.points) {
    const length = vectorLength(point)
    let bound = quaternionStretch(length) + middleStretch
    if (unit !== undefined && length > 0)
      bound = Math.min(
        bound,
        ROTATION_FORM * Math.abs(length - 1) * (length + 1) +
          arc(unit, [point.map(x => x / length)]) +
          unitError,
      )
    deviation = Math.max(deviation, bound)
  }
  // the values between keys: unit quaternions on arcs, or the identity's
  for (const [from, to] of extent.arcs) {
    const a = vectorLength(from)
    const b = vectorLength(to)
    let bound = 1 + middleStretch
    if (unit !== undefined && a > 0 && b > 0)
      bound = Math.min(bound, arc(unit, [from.map(x => x / a), to.map(x => x / b)]) + unitError)
    deviation = Math.max(deviation, bound)
  }
  return deviation
}

/** One pose as matrices (createModelPoseSampler's `sampleMatrices`). */
export interface ModelPoseMatrices {
  /**
   * 32 floats per bone of the sampler's `bones`, column-major, owned by this pose: the world matrix
   * at 16 × slot, then world × inverse bind at 16 × (bones + slot), zeros where a bone has none.
   */
  readonly matrices: Float32Array
  /** The bones `sample` returns at this time, made from `matrices` when first asked for. */
  pose(): readonly ModelBonePoseSample[]
}

/**
 * Compile once; sample TRS, parent composition and world × inverse bind through shared math. A
 * sample reuses the sampler's own TRS slots and matrices: per bone it makes only the frozen pose it
 * returns (an animated map poses every placed unit each frame). `sampleMatrices` makes the same
 * pose as one array of matrices, its channel values and frozen bones left unmade.
 */
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
  /** The pose `sample` makes at a time, as matrices (ModelPoseMatrices). */
  sampleMatrices(timeSeconds: number, signal?: AbortSignal): ModelPoseMatrices
  /** The bones of every pose, in its order. */
  readonly bones: readonly ModelPoseBone[]
  /**
   * How far any pose of the clip moves each bone from a pose at the middle of its values
   * (ModelPoseExtent), made when first asked for. Undefined when a channel makes every sample
   * reaching it refuse.
   */
  extent(): ModelPoseExtent | undefined
} {
  const { bones, byNode, parents, order } = compileHierarchy(
    snapshotModelSkeleton(bindings, budget, signal),
    hierarchyId,
  )
  if (clip?.hierarchyId !== undefined && clip.hierarchyId !== hierarchyId)
    throw new TypeError('animation belongs to a different hierarchy')
  const animation =
    clip === undefined ? undefined : createModelAnimationSampler(clip, budget, signal)
  // What each channel of the clip does to a sample, the same every time: its TRS slot (3 × bone +
  // kind), or IGNORED (not translation, rotation nor scale), UNBOUND (no whole bone) or REPEATED (a
  // second channel for a bone's kind), which every sample reaching it refuses.
  const IGNORED = -1
  const UNBOUND = -2
  const REPEATED = -3
  const targets = new Int32Array(animation?.channels.length ?? 0)
  const claimed = new Uint8Array(bones.length * 3)
  for (const [index, channel] of (animation?.channels ?? []).entries()) {
    const kind = boneChannelKind(channel.kind)
    const slot = kind < 0 ? undefined : byNode.get(channel.target)
    const target =
      kind < 0
        ? IGNORED
        : slot === undefined || channel.axis !== undefined
          ? UNBOUND
          : claimed[slot * 3 + kind] === 1
            ? REPEATED
            : slot * 3 + kind
    if (target >= 0) claimed[target] = 1
    targets[index] = target
  }
  // A sample's TRS per bone and kind (translation, rotation, scale): the rest pose unless a channel
  // of the sample sets it.
  const trs: (readonly number[])[] = new Array(bones.length * 3)
  const restPose = () => {
    for (let slot = 0; slot < bones.length; slot++) {
      const rest = bones[slot]!.localPose!
      trs[slot * 3] = rest.translation
      trs[slot * 3 + 1] = rest.rotation
      trs[slot * 3 + 2] = rest.scale
    }
  }
  // A channel's value into the sample's TRS, refused as every sample refuses it.
  const assign = (index: number, value: readonly number[]) => {
    const target = targets[index]!
    if (target === IGNORED) return
    if (target === UNBOUND) throw new TypeError('animation has no whole-bone target')
    if (target === REPEATED) throw new TypeError('duplicate bone animation channel')
    vector(value, target % 3 === 1 ? 4 : 3, 'bone animation value')
    trs[target] = value
  }
  const local = new Float32Array(16)
  const skinning = bones.length * 16
  // The sample's TRS composed into `matrices`: world matrices at 16 × slot, world × inverse bind at
  // 16 × (bones + slot).
  const compose = (matrices: Float32Array, requestSignal?: AbortSignal) => {
    for (const slot of order) {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      composeTrsMatrix(local, 0, trs[slot * 3]!, trs[slot * 3 + 1]!, trs[slot * 3 + 2]!)
      const parent = parents[slot]!
      if (parent < 0) matrices.set(local, slot * 16)
      else multiplyMat4(matrices, slot * 16, matrices, parent * 16, local, 0)
      const inverseBind = bones[slot]!.inverseBindMatrix
      if (inverseBind !== undefined)
        multiplyMat4(matrices, skinning + slot * 16, matrices, slot * 16, inverseBind, 0)
      if (
        !finiteMatrix(matrices, slot * 16) ||
        (inverseBind !== undefined && !finiteMatrix(matrices, skinning + slot * 16))
      )
        throw new RangeError('bone pose exceeds finite float range')
    }
  }
  // The frozen bones of composed matrices: what `sample` returns.
  const frozenPose = (matrices: Float32Array): readonly ModelBonePoseSample[] => {
    const result: ModelBonePoseSample[] = new Array(bones.length)
    for (let slot = 0; slot < bones.length; slot++) {
      const bone = bones[slot]!
      result[slot] =
        bone.inverseBindMatrix === undefined
          ? Object.freeze({
              boneIndex: bone.boneIndex,
              nodeId: bone.nodeId!,
              worldMatrix: frozenMatrix(matrices, slot * 16),
            })
          : Object.freeze({
              boneIndex: bone.boneIndex,
              nodeId: bone.nodeId!,
              worldMatrix: frozenMatrix(matrices, slot * 16),
              skinningMatrix: frozenMatrix(matrices, skinning + slot * 16),
            })
    }
    return Object.freeze(result)
  }
  const scratch = new Float32Array(bones.length * 32)
  const values: number[][] = []
  // The middle pose of the clip's values and how far a sample moves each bone from it: per bone,
  // how long its local translation is (`length`) and how far from the middle (`move`), how much its
  // local rotation and scale stretch (`stretch`) and how far from the middle ones (`bend`). Down the
  // hierarchy, a world matrix W = P·L less the middle one P₀·L₀ is (P − P₀)·L + P₀·(L − L₀): its
  // linear part within turnₚ·|L| + |P₀|·bend, its translation within
  // turnₚ·length + shiftₚ + |P₀|·move.
  const extentOf = (): ModelPoseExtent | undefined => {
    const channelOf = new Int32Array(bones.length * 3).fill(-1)
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!
      if (target === IGNORED) continue
      // a channel every sample reaching it refuses, by its target or its width
      if (target < 0 || animation!.extent(index).width !== (target % 3 === 1 ? 4 : 3))
        return undefined
      channelOf[target] = index
    }
    const middle: (readonly number[])[] = new Array(bones.length * 3)
    const length = new Float64Array(bones.length)
    const move = new Float64Array(bones.length)
    const stretch = new Float64Array(bones.length)
    const bend = new Float64Array(bones.length)
    for (let slot = 0; slot < bones.length; slot++) {
      const rest = bones[slot]!.localPose!
      const extentOfKind = (kind: number) => {
        const index = channelOf[slot * 3 + kind]!
        return index < 0 ? undefined : animation!.extent(index)
      }
      const translation = extentOfKind(0)
      const rotation = extentOfKind(1)
      const scale = extentOfKind(2)
      // the translation: its middle, its length, its distance from the middle
      const t0 = translation === undefined ? rest.translation : boxMiddle(translation.points)
      for (const point of translation?.points ?? [t0]) {
        length[slot] = Math.max(length[slot]!, vectorLength(point))
        move[slot] = Math.max(move[slot]!, vectorDistance(point, t0))
      }
      // the rotation: its middle, its stretch (a unit quaternion's on arcs), its distance in rotation
      const q0 = rotation === undefined ? rest.rotation : quaternionMiddle(rotation.points)
      let turned = (rotation?.arcs.length ?? 0) > 0 ? 1 : 0
      for (const point of rotation?.points ?? [q0])
        turned = Math.max(turned, quaternionStretch(vectorLength(point)))
      const deviation = rotation === undefined ? 0 : rotationDeviation(rotation, q0)
      // the scale: its middle, its largest component, its largest distance from the middle's
      const s0 = scale === undefined ? rest.scale : boxMiddle(scale.points)
      let scaled = 0
      let spread = 0
      for (const point of scale?.points ?? [s0])
        for (let axis = 0; axis < 3; axis++) {
          scaled = Math.max(scaled, Math.abs(point[axis]!))
          spread = Math.max(spread, Math.abs(point[axis]! - s0[axis]!))
        }
      middle[slot * 3] = t0
      middle[slot * 3 + 1] = q0
      middle[slot * 3 + 2] = s0
      stretch[slot] = turned * scaled
      // R·S − R₀·S₀ = (R − R₀)·S + R₀·(S − S₀)
      bend[slot] = deviation * scaled + quaternionStretch(vectorLength(q0)) * spread
    }
    // the middle pose, composed as a sample composes it
    const center = new Float32Array(bones.length * 16)
    const turn = new Float64Array(bones.length)
    const shift = new Float64Array(bones.length)
    for (const slot of order) {
      composeTrsMatrix(local, 0, middle[slot * 3]!, middle[slot * 3 + 1]!, middle[slot * 3 + 2]!)
      const parent = parents[slot]!
      if (parent < 0) {
        center.set(local, slot * 16)
        turn[slot] = bend[slot]!
        shift[slot] = move[slot]!
        continue
      }
      multiplyMat4(center, slot * 16, center, parent * 16, local, 0)
      const above = linearStretch(center.subarray(parent * 16, parent * 16 + 16))
      turn[slot] = turn[parent]! * stretch[slot]! + above * bend[slot]!
      shift[slot] = turn[parent]! * length[slot]! + shift[parent]! + above * move[slot]!
    }
    for (const values of [center, turn, shift])
      for (let index = 0; index < values.length; index++)
        if (!Number.isFinite(values[index])) return undefined
    return Object.freeze({ center, turn, shift })
  }
  let extent: ModelPoseExtent | null | undefined
  return Object.freeze({
    extent: () => (extent === undefined ? (extent = extentOf() ?? null) : extent) ?? undefined,
    bones: Object.freeze(
      bones.map(bone =>
        Object.freeze({
          boneIndex: bone.boneIndex,
          nodeId: bone.nodeId!,
          skinned: bone.inverseBindMatrix !== undefined,
        }),
      ),
    ),
    sample(timeSeconds: number, requestSignal?: AbortSignal) {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isFinite(timeSeconds)) throw new TypeError('pose time must be finite')
      const channels = animation?.sample(timeSeconds, requestSignal) ?? Object.freeze([])
      restPose()
      for (let index = 0; index < channels.length; index++) assign(index, channels[index]!.value)
      compose(scratch, requestSignal)
      return Object.freeze({ bones: frozenPose(scratch), channels })
    },
    sampleMatrices(timeSeconds: number, requestSignal?: AbortSignal): ModelPoseMatrices {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isFinite(timeSeconds)) throw new TypeError('pose time must be finite')
      animation?.sampleInto(timeSeconds, values, requestSignal)
      restPose()
      for (let index = 0; index < targets.length; index++) assign(index, values[index]!)
      const matrices = new Float32Array(bones.length * 32)
      compose(matrices, requestSignal)
      let pose: readonly ModelBonePoseSample[] | undefined
      return Object.freeze({ matrices, pose: () => (pose ??= frozenPose(matrices)) })
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
