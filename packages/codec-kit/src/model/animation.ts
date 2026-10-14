import type {
  ModelAnimationChannel,
  ModelAnimationClip,
  ModelAnimationEvent,
  ModelAnimationSample,
} from '@modkit/sdk'
import { xxHash32 } from '../checksum/xxhash32.js'
import { snapshotJson, type JsonSnapshotBudget } from '../json-snapshot.js'
import { CUBIC_SPLINE_LINE_TYPE, sampleTrackValue } from '../model-math/sequence-pose.js'
import type { RenderScalarAnimationTrack } from '../legacy-model-support.js'

export const DEFAULT_MODEL_ANIMATION_BUDGET: JsonSnapshotBudget = Object.freeze({
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxBytes: 134_217_728,
})

/** Native animation names can be property sets ("Stand Talk"); compare their tokens without
 * tying the generic sampling layer to any game's file layout. */
export function modelAnimationNameMatches(name: string, requested: string): boolean {
  return modelAnimationNameMatchScore(name, requested) !== undefined
}

/** Fewest extra properties wins; undefined means no match. Equal scores retain authored order. */
export function modelAnimationNameMatchScore(name: string, requested: string): number | undefined {
  const properties = new Set(name.toLowerCase().split(/\s+/u).filter(Boolean))
  const wanted = new Set(requested.toLowerCase().split(/\s+/u).filter(Boolean))
  return wanted.size > 0 && [...wanted].every(property => properties.has(property))
    ? properties.size - wanted.size : undefined
}

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

/** The longest common period a layered set loops by before its clips line up again, in seconds. */
const MAX_LAYERED_PERIOD = 60

/**
 * Clips that play at once as one clip, layered by priority: each target (a joint, a node, a
 * primitive) takes the channel of the highest-`priority` clip that animates it (ties: the later in
 * the list), at weight 1 - a run on the legs under a carry on the arms. Each clip keeps its own
 * clock: its `speedScale` scales its key times, and a looping clip's channels wrap by its own
 * length (as concurrent channels). The set loops by the common period of its looping clips (to the
 * millisecond, at most a minute; else by its longest clip), so a caller that loops it sees no seam.
 */
export function layeredClip(clips: readonly ModelAnimationClip[]): ModelAnimationClip {
  const first = clips[0]
  if (first === undefined) throw new TypeError('layeredClip needs a clip')
  if (clips.length === 1) return first
  const ranked = clips
    .map((clip, order) => ({ clip, order }))
    .sort((a, b) => (a.clip.priority ?? 0) - (b.clip.priority ?? 0) || a.order - b.order)
  const channels = new Map<string, ModelAnimationChannel>()
  const periods: number[] = []
  let longest = 0
  for (const { clip } of ranked) {
    const speed = clip.speedScale ?? 1
    if (!(speed > 0) || !Number.isFinite(speed)) throw new TypeError('clip speed must be positive')
    const lastKey = clip.channels.reduce(
      (end, channel) =>
        (channel.samples ?? []).reduce((last, key) => Math.max(last, key.timeSeconds ?? 0), end),
      0,
    )
    const length = (clip.durationSeconds ?? lastKey) / speed
    longest = Math.max(longest, length)
    const looping = (clip.loop ?? (clip.looping === true ? 'loop' : 'once')) === 'loop'
    if (looping && length > 0) periods.push(Math.max(1, Math.round(length * 1000)))
    for (const channel of clip.channels)
      channels.set(`${channel.target}/${channel.kind}/${channel.axis ?? ''}`, {
        ...channel,
        ...(speed === 1 || channel.samples === undefined
          ? {}
          : {
              samples: channel.samples.map(key => ({
                ...key,
                timeSeconds: (key.timeSeconds ?? 0) / speed,
                ...(key.inTangent === undefined
                  ? {}
                  : { inTangent: key.inTangent.map(value => value * speed) }),
                ...(key.outTangent === undefined
                  ? {}
                  : { outTangent: key.outTangent.map(value => value * speed) }),
              })),
            }),
        ...(looping && length > 0 && channel.concurrent !== true
          ? { concurrent: true, wrapSeconds: length }
          : {}),
      })
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const common = periods.reduce((period, next) => (period / gcd(period, next)) * next, 1)
  const period = periods.length > 0 && common / 1000 <= MAX_LAYERED_PERIOD ? common / 1000 : longest
  return {
    id: clips.map(clip => clip.id).join('+'),
    name: clips.map(clip => clip.name).join(' + '),
    kind: 'animation',
    provenance: clips.every(clip => clip.provenance === 'companion') ? 'companion' : 'direct',
    frames: Math.max(...clips.map(clip => clip.frames)),
    durationSeconds: period,
    ...(periods.length > 0 ? { looping: true } : {}),
    channels: [...channels.values()],
  }
}

/**
 * One of several candidates by weight (same-named StarCraft II clips by `frequency`, a Diablo III
 * actor's looks), the same for the same seed: an object of a map keeps its choice frame to frame.
 */
export function chooseByWeight<T>(
  candidates: readonly { readonly value: T; readonly weight: number }[],
  seed: string,
): T {
  const total = candidates.reduce((sum, item) => sum + Math.max(0, item.weight), 0)
  if (!(total > 0)) throw new TypeError('chooseByWeight needs a positive weight')
  let point = (xxHash32(new TextEncoder().encode(seed)) / 2 ** 32) * total
  for (const item of candidates) {
    point -= Math.max(0, item.weight)
    if (point < 0) return item.value
  }
  return candidates.findLast(item => item.weight > 0)!.value
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
 * What every value of one channel stays within, whatever the time (createModelAnimationSampler's
 * `extent`), as sampleTrackValue makes it: at and beyond its ends a key, between two keys the first
 * (step), a convex combination of them or a cubic within the Bezier control points of the keys and
 * their tangents (linear, cubic-spline), or a unit quaternion on the arc between them (a channel of
 * quaternions, spherical-linear with keys four wide).
 */
export interface ModelAnimationExtent {
  /** The number of components of its keys. */
  readonly width: number
  /**
   * What a value between two keys is: one of `points` (`step`), a point of their convex hull
   * (`hull`), or one on an arc of `arcs` (`arc`).
   */
  readonly between: 'step' | 'hull' | 'arc'
  /** The keys, and a cubic's inner control points. */
  readonly points: readonly (readonly number[])[]
  /**
   * The keys of an `arc` channel in pairs, each and the next, the second turned to the first's side
   * as slerp turns it. A value between them is the unit quaternion of a combination of the two with
   * weights not below zero: on the shorter arc between their directions (or the quaternion of no
   * length, the identity's, where a key has none and the other no weight).
   */
  readonly arcs: readonly (readonly [readonly number[], readonly number[]])[]
}

/**
 * Compile a facet clip once, then sample without rebuilding its tracks each frame.
 * Time is sequence-local seconds; the caller controls sequence looping. Concurrent channels wrap
 * by their own duration. Descriptive channels without a declared interpolation are refused.
 * `sample` returns frozen values; `sampleInto` writes the same values into arrays the caller keeps
 * from sample to sample, for a pose made every frame (an animated map poses every placed unit).
 */
export function createModelAnimationSampler(
  clip: ModelAnimationClip,
  budget?: JsonSnapshotBudget,
  signal?: AbortSignal,
): {
  sample(timeSeconds: number, signal?: AbortSignal): readonly ModelAnimationValue[]
  /**
   * Each channel's value at a time into `values[index]` (an array made where there is none), in
   * the order of `channels`: the values `sample` returns, overwritten by the next call.
   */
  sampleInto(timeSeconds: number, values: number[][], signal?: AbortSignal): void
  /** What each value is (its target, kind and axis), in the order of `sample` and `sampleInto`. */
  readonly channels: readonly Omit<ModelAnimationValue, 'value'>[]
  /** What every value of channel `index` stays within (ModelAnimationExtent), made when first asked for. */
  extent(index: number): ModelAnimationExtent
} {
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
    // what each sample tells sampleTrackValue of the channel
    const options = {
      isQuat: channel.interpolation === 'spherical-linear',
      wrapSeconds: channel.concurrent ? channel.wrapSeconds : undefined,
    }
    return { channel, track, options }
  })
  const channels = Object.freeze(
    tracks.map(({ channel }) =>
      Object.freeze(
        channel.axis === undefined
          ? { target: channel.target, kind: channel.kind }
          : { target: channel.target, kind: channel.kind, axis: channel.axis },
      ),
    ),
  )
  const extents: ModelAnimationExtent[] = []
  return Object.freeze({
    channels,
    extent(index: number): ModelAnimationExtent {
      const known = extents[index]
      if (known !== undefined) return known
      const entry = tracks[index]
      if (entry === undefined) throw new RangeError('no animation channel at that index')
      const { track, options } = entry
      const keys = track.keys
      const width = keys[0]?.vector.length ?? 0
      // sampleTrackValue slerps keys four wide only; others it blends linearly
      const between =
        track.lineType === 0
          ? 'step'
          : track.lineType !== CUBIC_SPLINE_LINE_TYPE && options.isQuat && width === 4
            ? 'arc'
            : 'hull'
      const points: (readonly number[])[] = []
      const arcs: (readonly [readonly number[], readonly number[]])[] = []
      for (let at = 0; at < keys.length; at++) {
        const key = keys[at]!
        points.push(key.vector)
        const next = keys[at + 1]
        if (next === undefined) continue
        if (track.lineType === CUBIC_SPLINE_LINE_TYPE) {
          // the segment's inner Bezier control points: each key a third of the span along its tangent
          const span = next.frame - key.frame
          points.push(key.vector.map((x, axis) => x + (span * (key.outTan?.[axis] ?? 0)) / 3))
          points.push(next.vector.map((x, axis) => x - (span * (next.inTan?.[axis] ?? 0)) / 3))
        } else if (between === 'arc') {
          // slerp takes the shorter way: the second key turned to the first's side
          let dot = 0
          for (let axis = 0; axis < 4; axis++) dot += key.vector[axis]! * next.vector[axis]!
          arcs.push([key.vector, dot < 0 ? next.vector.map(x => -x) : next.vector])
        }
      }
      return (extents[index] = Object.freeze({
        width,
        between,
        points: Object.freeze(points),
        arcs: Object.freeze(arcs),
      }))
    },
    sample(timeSeconds: number, requestSignal?: AbortSignal): readonly ModelAnimationValue[] {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      finite(timeSeconds, 'sample time')
      // a value of one shape per channel, without a closure or a spread
      const values: ModelAnimationValue[] = []
      for (const { channel, track, options } of tracks) {
        if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
        const value = Object.freeze(sampleTrackValue(track, timeSeconds, [], options))
        values.push(
          Object.freeze(
            channel.axis === undefined
              ? { target: channel.target, kind: channel.kind, value }
              : { target: channel.target, kind: channel.kind, axis: channel.axis, value },
          ),
        )
      }
      return Object.freeze(values)
    },
    sampleInto(timeSeconds: number, values: number[][], requestSignal?: AbortSignal): void {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      finite(timeSeconds, 'sample time')
      for (let index = 0; index < tracks.length; index++) {
        if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
        const { track, options } = tracks[index]!
        // sampleTrackValue sets the length and every element, so a kept array ends as a new one
        sampleTrackValue(track, timeSeconds, (values[index] ??= []), options)
      }
    },
  })
}
