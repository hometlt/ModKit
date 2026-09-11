import type { RenderBone, RenderScalarAnimationTrack } from '../legacy-model-support.js'
import type { RenderNodeTrackSet, RenderSequence } from '../legacy/models/animation.js'

/**
 * Backend-agnostic RenderSequence pose evaluation (P5-S5/S6 shared core).
 *
 * Both renderer backends sample the same extracted tracks through this module
 * so bone poses cannot diverge: track sampling (step/linear/slerp, clamp/hold,
 * concurrent wrap), local TRS composition, parent-chain world matrices, and
 * skinning matrices = world × inverseBindMatrix (IREF, P5 D8).
 *
 * Key times are sequence-local seconds (`RenderScalarAnimationKey.frame`).
 * Matrices are column-major Float32Arrays, 16 floats per bone — compatible
 * with WebGL uniforms and THREE.Matrix4.fromArray.
 */

const IDENTITY_QUAT: readonly number[] = [0, 0, 0, 1]
const ZERO_VEC3: readonly number[] = [0, 0, 0]
const ONE_VEC3: readonly number[] = [1, 1, 1]

/**
 * Sample a track at a time with the M3 clamp/hold rules. Writes components
 * into `out` and returns it. `wrapSeconds` wraps time first (concurrent
 * overlays, P5 D4); `isQuat` slerps 4-component keys on lineType 1.
 */
export function sampleTrackValue(
  track: RenderScalarAnimationTrack,
  timeSeconds: number,
  out: number[],
  options: { wrapSeconds?: number | undefined; isQuat?: boolean | undefined } = {},
): number[] {
  const keys = track.keys
  const count = keys.length
  if (count === 0) {
    out.length = 0
    return out
  }
  let time = timeSeconds
  let wrapRoundoff = 0
  if (options.wrapSeconds && options.wrapSeconds > 0) {
    time = timeSeconds % options.wrapSeconds
    // Modulo can land one double ULP below an exact discrete key (e.g. .5 % .2).
    // Compensate arithmetic roundoff only; do not use a visual/frame-sized tolerance.
    wrapRoundoff = Math.max(options.wrapSeconds, Math.abs(timeSeconds)) * Number.EPSILON * 2
    if (Math.abs(time - options.wrapSeconds) <= wrapRoundoff) time = 0
  }
  const first = keys[0]!
  if (time <= first.frame || count === 1) return copyVector(first.vector, out)
  const last = keys[count - 1]!
  if (time >= last.frame) return copyVector(last.vector, out)

  let b = 1
  while (b < count - 1 && time + wrapRoundoff >= keys[b]!.frame) b += 1
  const ka = keys[b - 1]!
  const kb = keys[b]!
  if (track.lineType === 0) return copyVector(ka.vector, out) // step
  const span = kb.frame - ka.frame
  const t = span > 0 ? Math.min(Math.max((time - ka.frame) / span, 0), 1) : 0
  if (options.isQuat && ka.vector.length === 4 && kb.vector.length === 4) {
    return slerpVector(ka.vector, kb.vector, t, out)
  }
  out.length = ka.vector.length
  for (let i = 0; i < ka.vector.length; i += 1) {
    const a = ka.vector[i]!
    out[i] = a + ((kb.vector[i] ?? a) - a) * t
  }
  return out
}

function copyVector(source: readonly number[], out: number[]): number[] {
  out.length = source.length
  for (let i = 0; i < source.length; i += 1) out[i] = source[i]!
  return out
}

function slerpVector(
  a: readonly number[],
  b: readonly number[],
  t: number,
  out: number[],
): number[] {
  let dot = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  let sign = 1
  if (dot < 0) {
    dot = -dot
    sign = -1
  }
  out.length = 4
  if (dot > 0.9995) {
    for (let i = 0; i < 4; i += 1) out[i] = a[i]! + (sign * b[i]! - a[i]!) * t
  } else {
    const theta = Math.acos(Math.min(1, dot))
    const sinTheta = Math.sin(theta)
    const wa = Math.sin((1 - t) * theta) / sinTheta
    const wb = (Math.sin(t * theta) / sinTheta) * sign
    for (let i = 0; i < 4; i += 1) out[i] = wa * a[i]! + wb * b[i]!
  }
  const len = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!)
  if (len > 0) {
    for (let i = 0; i < 4; i += 1) out[i]! /= len
  }
  return out
}

/** Column-major TRS composition: M = T · R · S. */
export function composeTrsMatrix(
  out: Float32Array,
  offset: number,
  translation: readonly number[],
  rotation: readonly number[],
  scale: readonly number[],
): void {
  const x = rotation[0] ?? 0
  const y = rotation[1] ?? 0
  const z = rotation[2] ?? 0
  const w = rotation[3] ?? 1
  const sx = scale[0] ?? 1
  const sy = scale[1] ?? 1
  const sz = scale[2] ?? 1

  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2

  out[offset] = (1 - (yy + zz)) * sx
  out[offset + 1] = (xy + wz) * sx
  out[offset + 2] = (xz - wy) * sx
  out[offset + 3] = 0
  out[offset + 4] = (xy - wz) * sy
  out[offset + 5] = (1 - (xx + zz)) * sy
  out[offset + 6] = (yz + wx) * sy
  out[offset + 7] = 0
  out[offset + 8] = (xz + wy) * sz
  out[offset + 9] = (yz - wx) * sz
  out[offset + 10] = (1 - (xx + yy)) * sz
  out[offset + 11] = 0
  out[offset + 12] = translation[0] ?? 0
  out[offset + 13] = translation[1] ?? 0
  out[offset + 14] = translation[2] ?? 0
  out[offset + 15] = 1
}

/** out[outOff..] = a[aOff..] × b[bOff..] (column-major). Aliasing-safe for out === a/b at same offsets. */
export function multiplyMat4(
  out: Float32Array,
  outOffset: number,
  a: Float32Array,
  aOffset: number,
  b: Float32Array | readonly number[],
  bOffset: number,
): void {
  const a00 = a[aOffset]!
  const a01 = a[aOffset + 1]!
  const a02 = a[aOffset + 2]!
  const a03 = a[aOffset + 3]!
  const a10 = a[aOffset + 4]!
  const a11 = a[aOffset + 5]!
  const a12 = a[aOffset + 6]!
  const a13 = a[aOffset + 7]!
  const a20 = a[aOffset + 8]!
  const a21 = a[aOffset + 9]!
  const a22 = a[aOffset + 10]!
  const a23 = a[aOffset + 11]!
  const a30 = a[aOffset + 12]!
  const a31 = a[aOffset + 13]!
  const a32 = a[aOffset + 14]!
  const a33 = a[aOffset + 15]!
  for (let col = 0; col < 4; col += 1) {
    const b0 = b[bOffset + col * 4]!
    const b1 = b[bOffset + col * 4 + 1]!
    const b2 = b[bOffset + col * 4 + 2]!
    const b3 = b[bOffset + col * 4 + 3]!
    out[outOffset + col * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
    out[outOffset + col * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
    out[outOffset + col * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
    out[outOffset + col * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
  }
}

export interface SequencePoseResult {
  /** Bone world matrices (boneCount × 16, column-major). */
  world: Float32Array
  /** Skinning matrices = world × inverseBindMatrix (world where a bone has no IREF). */
  skinning: Float32Array
}

export interface SequencePoseBlendSample {
  sequence: RenderSequence
  timeSeconds: number
  weight: number
  /** Additive samples are applied as local TRS deltas after override blending. */
  additive?: boolean
}

/**
 * Samples a sequence pose with zero steady-state allocations: scratch and
 * result buffers are created once per (sampler, bone count) and reused.
 */
export class SequencePoseSampler {
  private readonly boneCount: number
  private readonly world: Float32Array
  private readonly skinning: Float32Array
  private readonly local: Float32Array
  private readonly translation: number[] = []
  private readonly rotation: number[] = []
  private readonly scale: number[] = []
  private readonly trackSetsBySequence = new WeakMap<
    RenderSequence,
    (RenderNodeTrackSet | undefined)[]
  >()

  constructor(private readonly bones: readonly RenderBone[]) {
    this.boneCount = bones.length
    this.world = new Float32Array(this.boneCount * 16)
    this.skinning = new Float32Array(this.boneCount * 16)
    this.local = new Float32Array(16)
  }

  private trackSets(sequence: RenderSequence): (RenderNodeTrackSet | undefined)[] {
    let sets = this.trackSetsBySequence.get(sequence)
    if (!sets) {
      sets = new Array<RenderNodeTrackSet | undefined>(this.boneCount)
      for (const trackSet of sequence.nodeTracks) {
        if (trackSet.boneIndex >= 0 && trackSet.boneIndex < this.boneCount) {
          sets[trackSet.boneIndex] = trackSet
        }
      }
      this.trackSetsBySequence.set(sequence, sets)
    }
    return sets
  }

  /**
   * Bones must be stored parent-before-child (M3/MDX convention; the codecs
   * guarantee it). Loops sample tracks → local TRS → world = parentWorld ×
   * local → skinning = world × IREF.
   */
  samplePose(sequence: RenderSequence, timeSeconds: number): SequencePoseResult {
    const sets = this.trackSets(sequence)
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex]!
      const trackSet = sets[boneIndex]
      const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : undefined

      const translation = trackSet?.translation
        ? sampleTrackValue(trackSet.translation, timeSeconds, this.translation, { wrapSeconds })
        : ZERO_VEC3
      const rotation = trackSet?.rotation
        ? sampleTrackValue(trackSet.rotation, timeSeconds, this.rotation, {
            wrapSeconds,
            isQuat: true,
          })
        : IDENTITY_QUAT
      const scale = trackSet?.scale
        ? sampleTrackValue(trackSet.scale, timeSeconds, this.scale, { wrapSeconds })
        : ONE_VEC3

      composeTrsMatrix(this.local, 0, translation, rotation, scale)

      const parentIndex = bone.parentIndex
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0)
      } else {
        this.world.set(this.local, boneIndex * 16)
      }

      const inverseBind = bone.inverseBindMatrix
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0)
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16)
      }
    }
    return { world: this.world, skinning: this.skinning }
  }

  /** Blend controller clip samples before composing the hierarchy. */
  sampleBlendedPose(samples: readonly SequencePoseBlendSample[]): SequencePoseResult {
    const active = samples.filter(sample => sample.weight > 0 && Number.isFinite(sample.weight))
    if (active.length === 0) {
      this.world.fill(0)
      this.skinning.fill(0)
      return { world: this.world, skinning: this.skinning }
    }

    const value: number[] = []
    for (let boneIndex = 0; boneIndex < this.boneCount; boneIndex += 1) {
      const bone = this.bones[boneIndex]!
      const translation = [0, 0, 0]
      const rotation = [0, 0, 0, 0]
      const scale = [0, 0, 0]
      let overrideWeight = 0
      let referenceRotation: readonly number[] | undefined

      for (const sample of active) {
        if (sample.additive) continue
        const trackSet = this.trackSets(sample.sequence)[boneIndex]
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : undefined
        const sampledTranslation = trackSet?.translation
          ? sampleTrackValue(trackSet.translation, sample.timeSeconds, value, { wrapSeconds })
          : ZERO_VEC3
        for (let component = 0; component < 3; component += 1)
          translation[component]! += (sampledTranslation[component] ?? 0) * sample.weight

        const sampledRotation = trackSet?.rotation
          ? sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
              wrapSeconds,
              isQuat: true,
            })
          : IDENTITY_QUAT
        referenceRotation ??= [...sampledRotation]
        const sign = quaternionDot(referenceRotation, sampledRotation) < 0 ? -1 : 1
        for (let component = 0; component < 4; component += 1)
          rotation[component]! +=
            (sampledRotation[component] ?? IDENTITY_QUAT[component]!) * sample.weight * sign

        const sampledScale = trackSet?.scale
          ? sampleTrackValue(trackSet.scale, sample.timeSeconds, value, { wrapSeconds })
          : ONE_VEC3
        for (let component = 0; component < 3; component += 1)
          scale[component]! += (sampledScale[component] ?? 1) * sample.weight
        overrideWeight += sample.weight
      }

      if (overrideWeight > 0) {
        for (let component = 0; component < 3; component += 1) {
          translation[component]! /= overrideWeight
          scale[component]! /= overrideWeight
        }
        normalizeQuaternionInPlace(rotation)
      } else {
        translation.splice(0, 3, 0, 0, 0)
        rotation.splice(0, 4, 0, 0, 0, 1)
        scale.splice(0, 3, 1, 1, 1)
      }

      for (const sample of active) {
        if (!sample.additive) continue
        const trackSet = this.trackSets(sample.sequence)[boneIndex]
        const wrapSeconds = trackSet?.concurrent ? trackSet.wrapSeconds : undefined
        if (trackSet?.translation) {
          const sampled = sampleTrackValue(trackSet.translation, sample.timeSeconds, value, {
            wrapSeconds,
          })
          for (let component = 0; component < 3; component += 1)
            translation[component]! += (sampled[component] ?? 0) * sample.weight
        }
        if (trackSet?.scale) {
          const sampled = sampleTrackValue(trackSet.scale, sample.timeSeconds, value, {
            wrapSeconds,
          })
          for (let component = 0; component < 3; component += 1)
            scale[component]! *= 1 + ((sampled[component] ?? 1) - 1) * sample.weight
        }
        if (trackSet?.rotation) {
          const sampled = sampleTrackValue(trackSet.rotation, sample.timeSeconds, value, {
            wrapSeconds,
            isQuat: true,
          })
          const delta: number[] = []
          slerpVector(IDENTITY_QUAT, sampled, Math.min(1, sample.weight), delta)
          multiplyQuaternionInPlace(rotation, delta)
        }
      }

      composeTrsMatrix(this.local, 0, translation, rotation, scale)
      const parentIndex = bone.parentIndex
      if (parentIndex >= 0 && parentIndex < boneIndex) {
        multiplyMat4(this.world, boneIndex * 16, this.world, parentIndex * 16, this.local, 0)
      } else {
        this.world.set(this.local, boneIndex * 16)
      }
      const inverseBind = bone.inverseBindMatrix
      if (inverseBind && inverseBind.length === 16) {
        multiplyMat4(this.skinning, boneIndex * 16, this.world, boneIndex * 16, inverseBind, 0)
      } else {
        this.skinning.set(this.world.subarray(boneIndex * 16, boneIndex * 16 + 16), boneIndex * 16)
      }
    }
    return { world: this.world, skinning: this.skinning }
  }
}

function quaternionDot(left: readonly number[], right: readonly number[]): number {
  return (
    (left[0] ?? 0) * (right[0] ?? 0) +
    (left[1] ?? 0) * (right[1] ?? 0) +
    (left[2] ?? 0) * (right[2] ?? 0) +
    (left[3] ?? 1) * (right[3] ?? 1)
  )
}

function normalizeQuaternionInPlace(value: number[]): void {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!) || 1
  for (let component = 0; component < 4; component += 1) value[component]! /= length
}

function multiplyQuaternionInPlace(left: number[], right: readonly number[]): void {
  const [ax, ay, az, aw] = left as [number, number, number, number]
  const [bx = 0, by = 0, bz = 0, bw = 1] = right
  left[0] = aw * bx + ax * bw + ay * bz - az * by
  left[1] = aw * by - ax * bz + ay * bw + az * bx
  left[2] = aw * bz + ax * by - ay * bx + az * bw
  left[3] = aw * bw - ax * bx - ay * by - az * bz
  normalizeQuaternionInPlace(left)
}

/**
 * Mesh visibility from the extracted `batching` tracks (P5 1.6): visible when
 * no track exists for the mesh; step-sampled flag > 0.5 otherwise.
 */
export function sampleMeshVisibility(
  sequence: RenderSequence,
  meshIndex: number,
  timeSeconds: number,
): boolean {
  const entries = sequence.meshVisibility
  if (!entries) return true
  const scratch: number[] = []
  for (const entry of entries) {
    if (entry.meshIndex !== meshIndex) continue
    const value = sampleTrackValue(entry.track, timeSeconds, scratch)
    return (value[0] ?? 1) > 0.5
  }
  return true
}
