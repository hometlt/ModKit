import type { RenderNodeTrackSet, RenderSequence } from '../legacy/models/animation.js'
import type { RenderScalarAnimationTrack } from '../legacy-model-support.js'
import { sampleTrackValue } from './sequence-pose.js'

/** Unity HumanBodyBones order through UpperChest (Unity 2018+). */
export const UNITY_HUMAN_BODY_BONE_NAMES = [
  'Hips',
  'LeftUpperLeg',
  'RightUpperLeg',
  'LeftLowerLeg',
  'RightLowerLeg',
  'LeftFoot',
  'RightFoot',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftShoulder',
  'RightShoulder',
  'LeftUpperArm',
  'RightUpperArm',
  'LeftLowerArm',
  'RightLowerArm',
  'LeftHand',
  'RightHand',
  'LeftToes',
  'RightToes',
  'LeftEye',
  'RightEye',
  'Jaw',
  'LeftThumbProximal',
  'LeftThumbIntermediate',
  'LeftThumbDistal',
  'LeftIndexProximal',
  'LeftIndexIntermediate',
  'LeftIndexDistal',
  'LeftMiddleProximal',
  'LeftMiddleIntermediate',
  'LeftMiddleDistal',
  'LeftRingProximal',
  'LeftRingIntermediate',
  'LeftRingDistal',
  'LeftLittleProximal',
  'LeftLittleIntermediate',
  'LeftLittleDistal',
  'RightThumbProximal',
  'RightThumbIntermediate',
  'RightThumbDistal',
  'RightIndexProximal',
  'RightIndexIntermediate',
  'RightIndexDistal',
  'RightMiddleProximal',
  'RightMiddleIntermediate',
  'RightMiddleDistal',
  'RightRingProximal',
  'RightRingIntermediate',
  'RightRingDistal',
  'RightLittleProximal',
  'RightLittleIntermediate',
  'RightLittleDistal',
  'UpperChest',
] as const

export type UnityHumanBodyBoneName = (typeof UNITY_HUMAN_BODY_BONE_NAMES)[number]

export interface RenderHumanoidBone {
  humanBone: number
  humanBoneName: string
  boneIndex: number
  /** Unity Avatar path hash or another source-format stable bone identifier. */
  boneHash?: number
  parentHumanBone?: number
  restPosition: readonly [number, number, number]
  restRotation: readonly [number, number, number, number]
  restScale: readonly [number, number, number]
  minLimit?: readonly [number, number, number]
  maxLimit?: readonly [number, number, number]
}

export interface RenderHumanoidRig {
  humanScale: number
  rootBoneIndex?: number
  hasLeftHand?: boolean
  hasRightHand?: boolean
  hasTranslationDoF?: boolean
  armTwist?: number
  foreArmTwist?: number
  upperLegTwist?: number
  legTwist?: number
  armStretch?: number
  legStretch?: number
  feetSpacing?: number
  bones: readonly RenderHumanoidBone[]
}

export interface HumanoidRetargetOptions {
  /** Retarget local translation on only Hips (default), all mapped bones, or none. */
  translationMode?: 'hips' | 'all' | 'none'
  /** Overrides target/source human-scale ratio. */
  translationScale?: number
}

export interface HumanoidMuscleValue {
  bindingId: number
  muscleIndex?: number
  value: number
}

export interface HumanoidMusclePoseSample {
  sequence: RenderSequence
  timeSeconds: number
  weight: number
  /** Additive muscle values are interpreted as deltas from the Avatar reference pose. */
  additive?: boolean
}

/** Samples and blends Avatar-normalized muscle curves without invoking Unity's native solver. */
export function sampleHumanoidMusclePose(
  samples: readonly HumanoidMusclePoseSample[],
  options: { clampNormalized?: boolean } = {},
): HumanoidMuscleValue[] {
  const accumulated = new Map<
    number,
    {
      muscleIndex?: number
      overrideValue: number
      overrideWeight: number
      additiveValue: number
    }
  >()
  const scratch: number[] = []
  for (const sample of samples) {
    const weight = Math.max(0, Number.isFinite(sample.weight) ? sample.weight : 0)
    if (weight <= 0) continue
    const duration = sample.sequence.durationSeconds
    const time =
      sample.sequence.looping && duration > 0
        ? ((sample.timeSeconds % duration) + duration) % duration
        : Math.max(0, sample.timeSeconds)
    for (const muscle of sample.sequence.humanoidMuscleTracks ?? []) {
      const value = sampleTrackValue(muscle.track, time, scratch)[0] ?? 0
      const target = accumulated.get(muscle.bindingId) ?? {
        ...(muscle.muscleIndex !== undefined ? { muscleIndex: muscle.muscleIndex } : {}),
        overrideValue: 0,
        overrideWeight: 0,
        additiveValue: 0,
      }
      if (sample.additive) target.additiveValue += value * weight
      else {
        target.overrideValue += value * weight
        target.overrideWeight += weight
      }
      accumulated.set(muscle.bindingId, target)
    }
  }

  const clampNormalized = options.clampNormalized !== false
  return [...accumulated.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bindingId, value]) => {
      const override = value.overrideValue / Math.max(1, value.overrideWeight)
      const blended = override + value.additiveValue
      return {
        bindingId,
        ...(value.muscleIndex !== undefined ? { muscleIndex: value.muscleIndex } : {}),
        value: clampNormalized ? Math.min(1, Math.max(-1, blended)) : blended,
      }
    })
}

/**
 * Retarget generic local transform tracks through Unity's HumanBodyBones map.
 * Rotations preserve the source rest-pose delta and apply it to the target rest
 * pose. Translation is scale compensated. Native Unity muscle limits and TDoF
 * solving remain represented by rig metadata and can be applied by a host.
 */
export function retargetHumanoidSequence(
  sequence: RenderSequence,
  source: RenderHumanoidRig,
  target: RenderHumanoidRig,
  options: HumanoidRetargetOptions = {},
): RenderSequence {
  const sourceByHuman = new Map(source.bones.map(bone => [bone.humanBone, bone]))
  const sourceTracks = new Map(sequence.nodeTracks.map(track => [track.boneIndex, track]))
  const scale =
    options.translationScale ??
    (source.humanScale > 1e-8 ? target.humanScale / source.humanScale : 1)
  const translationMode = options.translationMode ?? 'hips'
  const nodeTracks: RenderNodeTrackSet[] = []

  for (const targetBone of target.bones) {
    const sourceBone = sourceByHuman.get(targetBone.humanBone)
    if (!sourceBone) continue
    const sourceTrack = sourceTracks.get(sourceBone.boneIndex)
    const shouldTranslate =
      translationMode === 'all' || (translationMode === 'hips' && targetBone.humanBone === 0)
    nodeTracks.push({
      boneIndex: targetBone.boneIndex,
      translation:
        shouldTranslate && sourceTrack?.translation
          ? mapTrack(sourceTrack.translation, value => [
              targetBone.restPosition[0] +
                ((value[0] ?? sourceBone.restPosition[0]) - sourceBone.restPosition[0]) * scale,
              targetBone.restPosition[1] +
                ((value[1] ?? sourceBone.restPosition[1]) - sourceBone.restPosition[1]) * scale,
              targetBone.restPosition[2] +
                ((value[2] ?? sourceBone.restPosition[2]) - sourceBone.restPosition[2]) * scale,
            ])
          : constantTrack(targetBone.restPosition),
      rotation: sourceTrack?.rotation
        ? mapTrack(sourceTrack.rotation, value =>
            normalizeQuaternion(
              multiplyQuaternion(
                targetBone.restRotation,
                multiplyQuaternion(
                  inverseQuaternion(sourceBone.restRotation),
                  normalizeQuaternion(value),
                ),
              ),
            ),
          )
        : constantTrack(targetBone.restRotation),
      scale: sourceTrack?.scale
        ? mapTrack(sourceTrack.scale, value => [
            targetBone.restScale[0] * ratio(value[0], sourceBone.restScale[0]),
            targetBone.restScale[1] * ratio(value[1], sourceBone.restScale[1]),
            targetBone.restScale[2] * ratio(value[2], sourceBone.restScale[2]),
          ])
        : constantTrack(targetBone.restScale),
      ...(sourceTrack?.concurrent ? { concurrent: true } : {}),
      ...(sourceTrack?.wrapSeconds ? { wrapSeconds: sourceTrack.wrapSeconds } : {}),
    })
  }

  return {
    ...sequence,
    nodeTracks,
    metadata: {
      ...(sequence.metadata ?? {}),
      humanoidRetargeted: true,
      humanoidSourceScale: source.humanScale,
      humanoidTargetScale: target.humanScale,
      humanoidTranslationScale: scale,
    },
  }
}

export interface TwoBoneIkInput {
  root: readonly [number, number, number]
  joint: readonly [number, number, number]
  end: readonly [number, number, number]
  target: readonly [number, number, number]
  pole: readonly [number, number, number]
  /** Maximum extension relative to authored limb length. Defaults to 1. */
  maxStretch?: number
}

export interface TwoBoneIkResult {
  root: readonly [number, number, number]
  joint: readonly [number, number, number]
  end: readonly [number, number, number]
  rootDeltaRotation: readonly [number, number, number, number]
  jointDeltaRotation: readonly [number, number, number, number]
  stretchScale: number
  reachedTarget: boolean
}

/** Analytic pole-vector two-bone IK with uniform, explicitly bounded limb stretching. */
export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const upper = subtract3(input.joint, input.root)
  const lower = subtract3(input.end, input.joint)
  const upperLength = Math.max(1e-8, length3(upper))
  const lowerLength = Math.max(1e-8, length3(lower))
  const targetVector = subtract3(input.target, input.root)
  const targetDistance = length3(targetVector)
  const direction =
    targetDistance > 1e-8 ? scale3(targetVector, 1 / targetDistance) : normalize3(upper, [1, 0, 0])
  const authoredLength = upperLength + lowerLength
  const maximumStretch = Math.max(1, finitePositive(input.maxStretch, 1))
  const stretchScale = Math.min(
    maximumStretch,
    Math.max(1, targetDistance / Math.max(1e-8, authoredLength)),
  )
  const solvedUpperLength = upperLength * stretchScale
  const solvedLowerLength = lowerLength * stretchScale
  const maxDistance = authoredLength * maximumStretch
  const minDistance = Math.max(1e-6, Math.abs(solvedUpperLength - solvedLowerLength))
  const solvedDistance = Math.min(maxDistance, Math.max(minDistance, targetDistance))
  const planeNormal = normalize3(
    cross3(direction, subtract3(input.pole, input.root)),
    normalize3(cross3(upper, lower), [0, 0, 1]),
  )
  const bendDirection = normalize3(cross3(planeNormal, direction), [0, 1, 0])
  const along =
    (solvedUpperLength * solvedUpperLength -
      solvedLowerLength * solvedLowerLength +
      solvedDistance * solvedDistance) /
    (2 * solvedDistance)
  const height = Math.sqrt(Math.max(0, solvedUpperLength * solvedUpperLength - along * along))
  const solvedJoint = add3(
    add3(input.root, scale3(direction, along)),
    scale3(bendDirection, height),
  )
  const solvedEnd = add3(input.root, scale3(direction, solvedDistance))
  return {
    root: [...input.root],
    joint: solvedJoint,
    end: solvedEnd,
    rootDeltaRotation: quaternionFromTo(upper, subtract3(solvedJoint, input.root)),
    jointDeltaRotation: quaternionFromTo(lower, subtract3(solvedEnd, solvedJoint)),
    stretchScale,
    reachedTarget: targetDistance <= maxDistance + 1e-6,
  }
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function mapTrack(
  track: RenderScalarAnimationTrack,
  map: (value: readonly number[]) => readonly number[],
): RenderScalarAnimationTrack {
  return {
    ...track,
    keys: track.keys.map(key => ({
      ...key,
      vector: map(key.vector),
      ...(key.inTan ? { inTan: map(key.inTan) } : {}),
      ...(key.outTan ? { outTan: map(key.outTan) } : {}),
    })),
  }
}

function constantTrack(value: readonly number[]): RenderScalarAnimationTrack {
  return { lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [...value] }] }
}

function ratio(value: number | undefined, rest: number): number {
  return Math.abs(rest) > 1e-8 ? (value ?? rest) / rest : 1
}

function multiplyQuaternion(
  left: readonly number[],
  right: readonly number[],
): readonly [number, number, number, number] {
  const [ax = 0, ay = 0, az = 0, aw = 1] = left
  const [bx = 0, by = 0, bz = 0, bw = 1] = right
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function inverseQuaternion(value: readonly number[]): readonly [number, number, number, number] {
  const normalized = normalizeQuaternion(value)
  return [-normalized[0], -normalized[1], -normalized[2], normalized[3]]
}

function normalizeQuaternion(value: readonly number[]): readonly [number, number, number, number] {
  const x = value[0] ?? 0
  const y = value[1] ?? 0
  const z = value[2] ?? 0
  const w = value[3] ?? 1
  const length = Math.hypot(x, y, z, w) || 1
  return [x / length, y / length, z / length, w / length]
}

function quaternionFromTo(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): readonly [number, number, number, number] {
  const a = normalize3(from, [1, 0, 0])
  const b = normalize3(to, [1, 0, 0])
  const dot = Math.min(1, Math.max(-1, dot3(a, b)))
  if (dot > 0.999999) return [0, 0, 0, 1]
  if (dot < -0.999999) {
    const axis = normalize3(cross3(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]), [0, 0, 1])
    return [axis[0], axis[1], axis[2], 0]
  }
  const axis = cross3(a, b)
  return normalizeQuaternion([axis[0], axis[1], axis[2], 1 + dot])
}

function add3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scale3(
  value: readonly [number, number, number],
  scale: number,
): readonly [number, number, number] {
  return [value[0] * scale, value[1] * scale, value[2] * scale]
}

function length3(value: readonly [number, number, number]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function normalize3(
  value: readonly [number, number, number],
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const length = length3(value)
  return length > 1e-8 ? scale3(value, 1 / length) : fallback
}

function dot3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}
