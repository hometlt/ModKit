import type { JsonValue, ModelAnimationClip } from '@modkit/sdk'
import type { ModelPoseBlendSample } from '@modkit/codec-kit/model/skeleton'
import { object } from './values.js'

/** Resolve only pose selection. The primary clip independently selects material/effect/visibility. */
export function readUvmPoseSamples(
  value: JsonValue | undefined,
  clips: readonly ModelAnimationClip[],
): readonly ModelPoseBlendSample[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 32)
    throw new RangeError('poseSamples requires 1..32 entries')
  let active = false
  const samples = value.map(raw => {
    const sample = object(raw, 'pose sample'),
      clipId = sample['clipId'],
      time = sample['time'],
      weight = sample['weight'],
      additive = sample['additive']
    if (
      Object.keys(sample).some(key => !['clipId', 'time', 'weight', 'additive'].includes(key)) ||
      typeof clipId !== 'string' ||
      typeof time !== 'number' ||
      !Number.isFinite(time) ||
      time < 0 ||
      typeof weight !== 'number' ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      (additive !== undefined && typeof additive !== 'boolean')
    )
      throw new TypeError('invalid explicit pose sample')
    const clip = clips.find(candidate => candidate.id === clipId)
    if (clip === undefined) throw new TypeError(`unknown pose sample clip: ${clipId}`)
    if (weight > 0) active = true
    return Object.freeze({ clip, time, weight, ...(additive === undefined ? {} : { additive }) })
  })
  if (!active) throw new TypeError('poseSamples requires a positive weight')
  return Object.freeze(samples)
}
