/**
 * Serializable-value contracts of the copied MK2 assets layer.
 *
 * `AssetDescriptor` and everything reachable from it must survive a
 * `structuredClone`/`JSON.stringify` round trip: no runtime functions, DOM objects, workers,
 * file handles, or host APIs may be embedded in it. The JSON types are the sdk's;
 * `isJsonSerializable` is codec-kit's check that a value survives serialization (an optional
 * property left `undefined` passes, as JSON omits it).
 */

export type { JsonObject, JsonPrimitive, JsonValue } from '@modkit/sdk'
export { isJsonSerializable } from '../../json.js'
