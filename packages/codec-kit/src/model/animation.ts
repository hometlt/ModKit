import type { ModelAnimationClip } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '../json-snapshot.js'
import { sampleTrackValue } from '../model-math/sequence-pose.js'
import type { RenderScalarAnimationTrack } from '../legacy-model-support.js'

export const DEFAULT_MODEL_ANIMATION_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBytes: 134_217_728,
})

function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite`)
}

/** Own the complete facet, including optional playback data; older descriptive channels remain valid. */
export function snapshotModelAnimations(
  value: readonly ModelAnimationClip[],
  budget: JsonSnapshotBudget = DEFAULT_MODEL_ANIMATION_BUDGET,
  signal?: AbortSignal,
): readonly ModelAnimationClip[] {
  const clips = snapshotJson(value, budget, signal) as unknown as readonly ModelAnimationClip[]
  if (!Array.isArray(clips)) throw new TypeError('model animations must be an array')
  const ids = new Set<string>()
  for (const clip of clips) {
    if (
      clip === null ||
      typeof clip !== 'object' ||
      typeof clip.id !== 'string' ||
      !clip.id ||
      ids.has(clip.id)
    ) {
      throw new TypeError('animation clip needs a unique id')
    }
    ids.add(clip.id)
    if (
      typeof clip.name !== 'string' ||
      !['animation', 'rest-pose'].includes(clip.kind) ||
      !['direct', 'companion'].includes(clip.provenance) ||
      !Number.isSafeInteger(clip.frames) ||
      clip.frames < 0 ||
      !Array.isArray(clip.channels)
    )
      throw new TypeError('invalid animation clip')
    if (clip.durationSeconds !== undefined) {
      finite(clip.durationSeconds, 'clip duration')
      if (clip.durationSeconds < 0) throw new TypeError('negative clip duration')
    }
    if (clip.looping !== undefined && typeof clip.looping !== 'boolean')
      throw new TypeError('invalid clip looping')
    if (
      clip.repeatCount !== undefined &&
      (!Number.isSafeInteger(clip.repeatCount) || clip.repeatCount < 0)
    )
      throw new TypeError('invalid clip repeat count')
    if (
      clip.sequenceIndex !== undefined &&
      (!Number.isSafeInteger(clip.sequenceIndex) || clip.sequenceIndex < 0)
    )
      throw new TypeError('invalid animation material sequence index')
    if (clip.movementSpeed !== undefined) finite(clip.movementSpeed, 'clip movement speed')
    if (clip.boundsSphere !== undefined) {
      if (!Array.isArray(clip.boundsSphere.center) || clip.boundsSphere.center.length !== 3)
        throw new TypeError('invalid clip bounds')
      for (const component of clip.boundsSphere.center) finite(component, 'clip bounds center')
      finite(clip.boundsSphere.radius, 'clip bounds radius')
      if (clip.boundsSphere.radius < 0) throw new TypeError('negative clip bounds radius')
    }
    for (const channel of clip.channels) {
      if (
        channel === null ||
        typeof channel !== 'object' ||
        typeof channel.target !== 'string' ||
        typeof channel.kind !== 'string'
      )
        throw new TypeError('invalid animation channel')
      if (channel.concurrent !== undefined && typeof channel.concurrent !== 'boolean')
        throw new TypeError('invalid concurrent flag')
      if (channel.wrapSeconds !== undefined) {
        finite(channel.wrapSeconds, 'channel wrap')
        if (channel.wrapSeconds <= 0 || channel.concurrent !== true)
          throw new TypeError('invalid independent channel wrap')
      }
      if (
        channel.repeatCount !== undefined &&
          (!Number.isSafeInteger(channel.repeatCount) ||
          channel.repeatCount < 0 ||
          channel.concurrent !== true ||
          channel.wrapSeconds === undefined)
      )
        throw new TypeError('invalid independent channel repeat count')
      if (channel.samples !== undefined && !Array.isArray(channel.samples))
        throw new TypeError('invalid animation samples')
      if (channel.interpolation === undefined) continue
      if (
        !['step', 'linear', 'spherical-linear'].includes(channel.interpolation) ||
        !channel.samples?.length
      ) {
        throw new TypeError('sampleable channel needs interpolation and keys')
      }
      let previous = -Infinity
      let components: number | undefined
      for (const sample of channel.samples) {
        finite(sample.timeSeconds, 'key time')
        if (sample.timeSeconds < previous) throw new TypeError('animation keys are not ordered')
        previous = sample.timeSeconds
        if (!Array.isArray(sample.value) || sample.value.length === 0)
          throw new TypeError('empty animation key')
        components ??= sample.value.length
        if (
          components !== sample.value.length ||
          (channel.interpolation === 'spherical-linear' && components !== 4)
        ) {
          throw new TypeError('inconsistent animation key components')
        }
        for (const component of sample.value) finite(component, 'key component')
      }
    }
  }
  return clips
}

export interface ModelAnimationValue {
  readonly target: string
  readonly kind: string
  readonly axis?: string
  readonly value: readonly number[]
}

/**
 * Compile a facet clip once, then sample without rebuilding its tracks each frame.
 * Time is sequence-local seconds; the caller controls sequence looping. Concurrent channels wrap
 * by their own duration. Descriptive channels without a declared interpolation are refused.
 */
export function createModelAnimationSampler(
  clip: ModelAnimationClip,
  budget?: JsonSnapshotBudget,
  signal?: AbortSignal,
): { sample(timeSeconds: number, signal?: AbortSignal): readonly ModelAnimationValue[] } {
  const owned = snapshotModelAnimations([clip], budget, signal)[0]!
  const tracks = owned.channels.map(channel => {
    if (channel.interpolation === undefined || channel.samples === undefined)
      throw new TypeError('channel has no sampling semantics')
    const track: RenderScalarAnimationTrack = {
      lineType: channel.interpolation === 'step' ? 0 : 1,
      globalSeqId: null,
      keys: channel.samples.map(key => ({ frame: key.timeSeconds!, vector: key.value })),
    }
    return { channel, track }
  })
  return Object.freeze({
    sample(timeSeconds: number, requestSignal?: AbortSignal): readonly ModelAnimationValue[] {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      finite(timeSeconds, 'sample time')
      return Object.freeze(
        tracks.map(({ channel, track }) => {
          if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
          return Object.freeze({
            target: channel.target,
            kind: channel.kind,
            ...(channel.axis === undefined ? {} : { axis: channel.axis }),
            value: Object.freeze(
              sampleTrackValue(track, timeSeconds, [], {
                isQuat: channel.interpolation === 'spherical-linear',
                wrapSeconds: channel.concurrent ? channel.wrapSeconds : undefined,
              }),
            ),
          })
        }),
      )
    },
  })
}
