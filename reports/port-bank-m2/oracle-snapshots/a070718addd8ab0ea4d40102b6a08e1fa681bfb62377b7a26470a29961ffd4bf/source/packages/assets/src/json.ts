/**
 * Serializable-value contracts.
 *
 * `AssetDescriptor` and everything reachable from it must survive a
 * `structuredClone`/`JSON.stringify` round trip: no runtime functions, DOM objects, workers,
 * file handles, or host APIs may be embedded in it (canonical architecture, section 5,
 * pipeline rule 4). Runtime behaviour is referenced by stable handler/contribution IDs
 * instead.
 */

export type JsonPrimitive = string | number | boolean | null

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject

/** Depth guard so a pathological structure cannot hang a validation pass. */
const DEFAULT_MAX_DEPTH = 64

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === null || prototype === Object.prototype
}

/**
 * True when `value` only contains JSON-representable data.
 *
 * Rejects functions, symbols, bigints, non-finite numbers, class instances (including
 * `Uint8Array`, `Map`, `Date`, DOM nodes, and worker/file handles), `undefined` inside
 * arrays, and cyclic references. `undefined` object *property* values are accepted because
 * an optional property that is present-but-undefined serializes as an omitted property.
 *
 * This is the runtime guard behind pipeline rule 4; descriptor producers should assert it in
 * tests rather than on every hot path.
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
