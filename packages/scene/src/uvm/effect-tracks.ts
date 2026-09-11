import type { JsonObject, JsonValue } from '@modkit/sdk'
import { object } from './values.js'

/** Validate owned effect tracks and normalize key coordinates once to seconds. Concurrent wrapSeconds
 * already names its unit. The shared simulator remains the sole interpolation implementation. */
export function readUvmEffectAnimation(
  value: JsonValue,
  sequence: boolean,
  timeUnit: 'seconds' | 'milliseconds',
  maxKeys: number,
  signal?: AbortSignal,
): JsonObject {
  const output: Record<string, JsonValue> = {}
  let keysRead = 0
  const track = (input: JsonValue): JsonObject => {
    const record = object(input, 'effect track')
    if (Object.keys(record).some(key => !['keys', 'lineType', 'globalSeqId'].includes(key)))
      throw new TypeError('unknown effect track field')
    const lineType = record['lineType'],
      globalSeqId = record['globalSeqId'] ?? null
    if (
      typeof lineType !== 'number' ||
      ![0, 1, 2, 3].includes(lineType) ||
      (globalSeqId !== null &&
        (typeof globalSeqId !== 'number' || !Number.isSafeInteger(globalSeqId) || globalSeqId < 0))
    )
      throw new TypeError('invalid effect track interpolation or global sequence')
    const rawKeys = record['keys']
    if (!Array.isArray(rawKeys)) throw new TypeError('effect track keys must be an array')
    keysRead += rawKeys.length
    if (keysRead > maxKeys) throw new RangeError('effect animation key budget exceeded')
    let previous = -Infinity,
      arity: number | undefined
    const keys = rawKeys.map(value => {
      signal?.throwIfAborted()
      const key = object(value, 'effect animation key'),
        frame = key['frame']
      if (
        Object.keys(key).some(name => !['frame', 'vector', 'inTan', 'outTan'].includes(name)) ||
        typeof frame !== 'number' ||
        !Number.isFinite(frame) ||
        frame < previous
      )
        throw new TypeError('effect key frames must be finite and ordered')
      previous = frame
      const result: Record<string, JsonValue> = {
        frame: frame / (timeUnit === 'milliseconds' ? 1000 : 1),
      }
      for (const name of ['vector', 'inTan', 'outTan']) {
        const vector = key[name]
        if (vector === undefined && name !== 'vector') continue
        if (
          !Array.isArray(vector) ||
          vector.length < 1 ||
          vector.length > 4 ||
          vector.some(component => typeof component !== 'number' || !Number.isFinite(component))
        )
          throw new TypeError('effect key values must be finite vectors of arity 1..4')
        arity ??= vector.length
        if (vector.length !== arity)
          throw new TypeError('effect track vector/tangent arity differs')
        result[name] = [...vector]
      }
      return result
    })
    return { lineType, globalSeqId, keys }
  }
  for (const [property, propertyValue] of Object.entries(object(value, 'effect animation'))) {
    signal?.throwIfAborted()
    if (!sequence) {
      output[property] = track(propertyValue)
      continue
    }
    if (!Array.isArray(propertyValue))
      throw new TypeError('effect sequence tracks must be an array')
    const indices = new Set<number>()
    output[property] = propertyValue.map(value => {
      const entry = object(value, 'effect sequence track'),
        index = entry['sequenceIndex']
      if (
        typeof index !== 'number' ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        indices.has(index)
      )
        throw new TypeError('effect sequence indices must be unique nonnegative integers')
      indices.add(index)
      if (
        Object.keys(entry).some(
          key => !['sequenceIndex', 'track', 'concurrent', 'wrapSeconds'].includes(key),
        )
      )
        throw new TypeError('unknown effect sequence track field')
      const concurrent = entry['concurrent'],
        wrap = entry['wrapSeconds']
      if (
        (concurrent !== undefined && typeof concurrent !== 'boolean') ||
        (wrap !== undefined && (typeof wrap !== 'number' || !Number.isFinite(wrap) || wrap <= 0))
      )
        throw new TypeError('invalid effect concurrent timeline')
      if (entry['track'] === undefined) throw new TypeError('effect sequence track is missing')
      return {
        sequenceIndex: index,
        track: track(entry['track']),
        ...(concurrent === undefined ? {} : { concurrent }),
        ...(wrap === undefined ? {} : { wrapSeconds: wrap }),
      }
    })
  }
  return output
}
