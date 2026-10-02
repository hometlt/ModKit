/**
 * Serializable-value contracts of the copied MK2 assets layer.
 *
 * `AssetDescriptor` and everything reachable from it must survive a
 * `structuredClone`/`JSON.stringify` round trip: no runtime functions, DOM objects, workers,
 * file handles, or host APIs may be embedded in it. The JSON types are the sdk's;
 * `isJsonSerializable` is the MK2 check those contracts still make, which passes an optional
 * property left `undefined` because JSON omits it. MK3 code checks JSON with the sdk's
 * `isJsonValue`.
 */

export type { JsonObject, JsonPrimitive, JsonValue } from '@modkit/sdk'

/** Depth guard so a pathological structure cannot hang a validation pass. */
const DEFAULT_MAX_DEPTH = 64

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === null || prototype === Object.prototype
}

/**
 * True when `value` contains only JSON-representable data.
 *
 * Optional object properties whose value is `undefined` are accepted because JSON omits them;
 * `undefined` array entries, cycles, non-finite numbers and runtime objects are rejected.
 */
export function isJsonSerializable(value: unknown, maxDepth = DEFAULT_MAX_DEPTH): boolean {
  return check(value, maxDepth, new Set<object>(), false)
}

function check(value: unknown, depth: number, seen: Set<object>, insideArray: boolean): boolean {
  if (depth < 0) return false
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'undefined':
      return !insideArray
    case 'bigint':
    case 'symbol':
    case 'function':
      return false
    default:
      break
  }
  const object = value as object
  if (seen.has(object)) return false
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      return (object as readonly unknown[]).every(entry => check(entry, depth - 1, seen, true))
    }
    if (!isPlainObject(object)) return false
    return Object.values(object as Record<string, unknown>).every(entry =>
      check(entry, depth - 1, seen, false),
    )
  } finally {
    seen.delete(object)
  }
}
