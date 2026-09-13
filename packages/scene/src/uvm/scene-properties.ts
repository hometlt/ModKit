import type { JsonObject } from '@modkit/sdk'
import type { RenderEffectSequenceTracks } from '@modkit/codec-kit/legacy/models'
import {
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector,
} from '@modkit/codec-kit/model-math/effects-sim'
import { readUvmEffectAnimation } from './effect-tracks.js'
import { array, object } from './values.js'

/** Samples the bounded sequence-track vocabulary shared by portable scene properties. */
export function sampleUvmSceneProperties(
  source: unknown,
  defaults: Readonly<Record<string, number | readonly number[]>>,
  options: {
    readonly time: number
    readonly sequenceIndex?: number
    readonly maxKeys: number
    readonly signal?: AbortSignal
  },
): Readonly<Record<string, number | readonly number[]>> {
  if (!Number.isFinite(options.time)) throw new TypeError('scene property time must be finite')
  const parsed = readUvmEffectAnimation(
    source as JsonObject,
    true,
    'seconds',
    options.maxKeys,
    options.signal,
  )
  for (const key of Object.keys(parsed))
    if (!Object.hasOwn(defaults, key))
      throw new TypeError(`unsupported scene property track ${key}`)
  const tracks = parsed as unknown as Readonly<Record<string, RenderEffectSequenceTracks>>
  const sequence = options.sequenceIndex ?? null
  const output: Record<string, number | readonly number[]> = {}
  for (const [key, fallback] of Object.entries(defaults)) {
    const entries = tracks[key]
    if (entries !== undefined) {
      const width = Array.isArray(fallback) ? fallback.length : 1
      for (const raw of entries) {
        const track = object(raw['track'], 'scene property track')
        for (const rawKey of array(track, 'keys')) {
          const value = object(rawKey, 'scene property key')
          for (const component of ['vector', 'inTan', 'outTan']) {
            if (value[component] !== undefined && array(value, component).length !== width)
              throw new TypeError(`scene property ${key} track width differs from its default`)
          }
        }
      }
    }
    output[key] = typeof fallback === 'number'
      ? sampleEffectSequenceScalar(entries, undefined, sequence, options.time, fallback)
      : Array.from(sampleEffectSequenceVector(entries, sequence, options.time, fallback))
  }
  return Object.freeze(output)
}
