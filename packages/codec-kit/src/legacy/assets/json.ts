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

export { isJsonSerializable } from '../../json.js'
