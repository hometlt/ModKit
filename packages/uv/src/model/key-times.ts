import type { JsonObject } from '@modkit/sdk'

/** Optional extras.uv.keyTimes v1: exact finite nonnegative increasing seconds. Its length
 * and float32 projection must match the input accessor. This preserves discrete boundaries
 * such as 100 ms while ordinary glTF consumers retain the standard float32 approximation.
 * Editing an accessor requires updating or removing this metadata; stale pairs are refused.
 */
export function readUvmKeyTimes(
  value: unknown,
  input?: { readonly values: ArrayLike<number>; readonly maxScalarBytes: number },
  signal?: AbortSignal,
): readonly number[] | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('invalid UVM keyTimes metadata')
  const record = value as Record<string, unknown>
  if (
    record['version'] !== 1 ||
    Object.keys(record).some(key => !['version', 'seconds'].includes(key)) ||
    !Array.isArray(record['seconds']) ||
    !record['seconds'].length
  )
    throw new TypeError('UVM keyTimes requires version 1 and seconds')
  const seconds: unknown[] = record['seconds']
  if (
    input !== undefined &&
    (seconds.length !== input.values.length || seconds.length * 8 > input.maxScalarBytes)
  )
    throw new RangeError('UVM keyTimes count or scalar budget mismatch')
  let previous = -Infinity
  for (let index = 0; index < seconds.length; index++) {
    signal?.throwIfAborted()
    const time = seconds[index]
    if (
      typeof time !== 'number' ||
      !Number.isFinite(time) ||
      time < 0 ||
      time <= previous ||
      (input !== undefined && Math.fround(time) !== input.values[index])
    )
      throw new TypeError('UVM keyTimes must increase and match the input accessor')
    previous = time
  }
  return seconds as readonly number[]
}

export function uvmKeyTimesMetadata(seconds: readonly number[]): JsonObject {
  return seconds.some(time => Math.fround(time) !== time)
    ? { keyTimes: { version: 1, seconds: [...seconds] } }
    : {}
}
