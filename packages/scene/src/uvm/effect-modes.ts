import type { JsonObject, JsonValue } from '@modkit/sdk'

function object(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('effect sequence mode must use a constant boolean STEP track')
  return value as JsonObject
}

/** Common scene extension: mode is constant for a selected clip. This is not an animated
 * boolean interpolator. Call after readUvmEffectAnimation and before creating the simulator. */
export function selectUvmEffectSquirt(
  emitter: JsonObject,
  sequenceIndex: number | undefined,
  maxNodes: number,
  signal?: AbortSignal,
): boolean | undefined {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0)
    throw new RangeError('effect sequence mode budget must be positive')
  const fallback = emitter['squirt']
  if (fallback !== undefined && typeof fallback !== 'boolean')
    throw new TypeError('effect squirt must be boolean')
  const animation = emitter['sequenceAnimation']
  const modes = animation === undefined ? undefined : object(animation)['squirt']
  if (modes === undefined) return fallback
  if (!Array.isArray(modes) || modes.length > maxNodes)
    throw new RangeError('effect sequence modes exceed budget')
  const seen = new Set<number>()
  let selected = fallback
  for (const raw of modes) {
    signal?.throwIfAborted()
    const item = object(raw),
      index = item['sequenceIndex'],
      track = object(item['track']),
      keys = track['keys']
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      seen.has(index) ||
      track['lineType'] !== 0 ||
      track['globalSeqId'] !== null ||
      item['concurrent'] === true ||
      item['wrapSeconds'] !== undefined ||
      !Array.isArray(keys) ||
      keys.length !== 1
    )
      throw new TypeError('effect sequence mode must use a constant boolean STEP track')
    const key = object(keys[0]),
      vector = key['vector']
    if (
      key['frame'] !== 0 ||
      !Array.isArray(vector) ||
      vector.length !== 1 ||
      (vector[0] !== 0 && vector[0] !== 1) ||
      key['inTan'] !== undefined ||
      key['outTan'] !== undefined
    )
      throw new TypeError('effect sequence mode must have one 0/1 key at zero')
    seen.add(index)
    if (sequenceIndex === index) selected = vector[0] === 1
  }
  return selected
}

/**
 * Whether a squirt emitter can throw its burst in the selected clip: it throws on the keys of its
 * count track (the emit count; the emission rate when it has none), so a clip without that track
 * never throws it. The simulator reads a clip without the track as a single key and threw the whole
 * burst as the clip began: the death debris of Washout's destructible rocks hung in the air around
 * the intact rocks. Call on the simulator-ready emitter (after readUvmEffectAnimation).
 */
export function uvmEffectSquirtKeyed(
  emitter: JsonObject,
  sequenceIndex: number | undefined,
): boolean {
  const record = (value: JsonValue | undefined) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : undefined
  const sequence = record(emitter['sequenceAnimation'])
  const counted = emitter['emitCount'] !== undefined || sequence?.['emitCount'] !== undefined
  const tracks = sequence?.[counted ? 'emitCount' : 'emissionRate']
  if (
    Array.isArray(tracks) &&
    tracks.some(entry => record(entry)?.['sequenceIndex'] === sequenceIndex)
  )
    return true
  if (counted) return false
  const legacy = record(record(emitter['animation'])?.['emissionRate'])?.['keys']
  return Array.isArray(legacy) && legacy.length > 0
}
