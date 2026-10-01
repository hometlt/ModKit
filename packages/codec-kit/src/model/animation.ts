import type { ModelAnimationClip, ModelAnimationEvent, ModelAnimationSample } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '../json-snapshot.js'
import { CUBIC_SPLINE_LINE_TYPE, sampleTrackValue } from '../model-math/sequence-pose.js'
import type { RenderScalarAnimationTrack } from '../legacy-model-support.js'

export const DEFAULT_MODEL_ANIMATION_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBytes: 134_217_728,
})

/**
 * The keys without those equal to both neighbours: linear, spherical and step interpolation
 * between equal values give that value, so the track plays the same. A held run keeps its first
 * and last key; a cubic-spline key goes only when it and both neighbours have zero tangents.
 * Formats that store a pose per frame (SAGE, Earth 2160 `.mot`, Grey Goo ALA) were millions of
 * snapshot nodes and did not open. `frame` is renumbered to the kept order.
 */
export function withoutHeldSamples(
  samples: readonly ModelAnimationSample[],
): ModelAnimationSample[] {
  const still = (sample: ModelAnimationSample) =>
    (sample.inTangent ?? []).every(value => value === 0) &&
    (sample.outTangent ?? []).every(value => value === 0)
  const same = (a: ModelAnimationSample, b: ModelAnimationSample) =>
    a.value.length === b.value.length &&
    a.value.every((value, index) => Object.is(value, b.value[index])) &&
    still(a) &&
    still(b)
  const kept = samples.filter((sample, index) => {
    const previous = samples[index - 1]
    const next = samples[index + 1]
    return (
      previous === undefined || next === undefined || !same(previous, sample) || !same(sample, next)
    )
  })
  return kept.map((sample, index) =>
    sample.frame === index ? sample : { ...sample, frame: index },
  )
}

/**
 * The animation snapshot budget sized by clips the codec already decoded out of its bounded input
 * (a key is about nine JSON nodes and eighty bytes), never below the default. Give it to
 * `createModelAnimationSource` and to the UVM materializer's `animationBudget`: the default holds a
 * vehicle, not an infantry skeleton with fifty clips.
 */
export function animationSnapshotBudget(clips: readonly ModelAnimationClip[]): JsonSnapshotBudget {
  let samples = 0
  let channels = 0
  for (const clip of clips)
    for (const channel of clip.channels) {
      channels += 1
      samples += channel.samples?.length ?? 0
    }
  return Object.freeze({
    maxDepth: DEFAULT_MODEL_ANIMATION_BUDGET.maxDepth,
    maxNodes: Math.max(
      DEFAULT_MODEL_ANIMATION_BUDGET.maxNodes,
      16 * samples + 64 * channels + 64 * clips.length,
    ),
    maxBytes: Math.max(DEFAULT_MODEL_ANIMATION_BUDGET.maxBytes, 256 * samples + 1024 * channels),
  })
}

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
        !['step', 'linear', 'spherical-linear', 'cubic-spline'].includes(channel.interpolation) ||
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
        if (channel.interpolation === 'cubic-spline') {
          for (const tangent of [sample.inTangent, sample.outTangent]) {
            if (!Array.isArray(tangent) || tangent.length !== components)
              throw new TypeError('cubic-spline keys need in and out tangents of the key width')
            for (const component of tangent) finite(component, 'key tangent')
          }
        }
      }
    }
  }
  return clips
}

export interface ModelAnimationEventOccurrence {
  readonly event: ModelAnimationEvent
  /** Playback seconds of this occurrence: a looping clip repeats its events. */
  readonly atSeconds: number
}

/** A playback jump this long names at most this many occurrences; the rest are left out. */
const MAX_EVENT_OCCURRENCES = 4096

/**
 * The events a clip passes from `fromSeconds` (excluded) to `toSeconds` (included) of playback, in
 * time order: a `loop` clip (or `looping`) repeats them every duration, a `ping-pong` one forth and
 * then back, and `once` or `hold` passes each once.
 */
export function clipEventsBetween(
  clip: ModelAnimationClip,
  fromSeconds: number,
  toSeconds: number,
): readonly ModelAnimationEventOccurrence[] {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(toSeconds))
    throw new TypeError('event window must be finite')
  if ((clip.events?.length ?? 0) === 0 || !(toSeconds > fromSeconds)) return []
  const mode = clip.loop ?? (clip.looping === true ? 'loop' : 'once')
  const duration = clip.durationSeconds ?? 0
  const period = mode === 'loop' ? duration : mode === 'ping-pong' ? 2 * duration : 0
  const found: ModelAnimationEventOccurrence[] = []
  for (const event of clip.events ?? []) {
    const back = 2 * duration - event.timeSeconds
    const times =
      mode === 'ping-pong' && back !== event.timeSeconds
        ? [event.timeSeconds, back]
        : [event.timeSeconds]
    for (const time of times) {
      if (!(period > 0)) {
        if (fromSeconds < time && time <= toSeconds) found.push({ event, atSeconds: time })
        continue
      }
      for (
        let at = time + (Math.floor((fromSeconds - time) / period) + 1) * period;
        at <= toSeconds && found.length < MAX_EVENT_OCCURRENCES;
        at += period
      )
        if (at > fromSeconds) found.push({ event, atSeconds: at })
    }
  }
  return found.sort((left, right) => left.atSeconds - right.atSeconds)
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
      lineType:
        channel.interpolation === 'step'
          ? 0
          : channel.interpolation === 'cubic-spline'
            ? CUBIC_SPLINE_LINE_TYPE
            : 1,
      globalSeqId: null,
      keys: channel.samples.map(key => ({
        frame: key.timeSeconds!,
        vector: key.value,
        ...(key.inTangent === undefined ? {} : { inTan: key.inTangent }),
        ...(key.outTangent === undefined ? {} : { outTan: key.outTangent }),
      })),
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
