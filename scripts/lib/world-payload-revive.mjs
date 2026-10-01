// Reads a world payload written by world-payload.mjs back into the renderer input. Browser-safe:
// render-world-payload.mjs bundles it into its page.
const constructors = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  DataView,
}

/** The value of world.json (parsed) over world.bin; each stored array is one object again. */
export function reviveWorldPayload(json, binary) {
  const revived = new Map()
  const revive = value => {
    if (Array.isArray(value)) return value.map(revive)
    if (value === null || typeof value !== 'object') return value
    if ('$bigint' in value) return BigInt(value.$bigint)
    if ('$typed' in value) {
      const Constructor = constructors[value.$typed]
      if (Constructor === undefined) throw new TypeError(`unknown payload array ${value.$typed}`)
      // One object per offset keeps shared arrays shared; aligned payloads are viewed in place.
      const shared = revived.get(value.offset)
      if (
        shared !== undefined &&
        shared.byteLength === value.byteLength &&
        shared.constructor === Constructor
      )
        return shared
      const size = Constructor === DataView ? 1 : Constructor.BYTES_PER_ELEMENT
      const result =
        Constructor === DataView
          ? new DataView(binary, value.offset, value.byteLength)
          : value.offset % size === 0
            ? new Constructor(binary, value.offset, value.byteLength / size)
            : new Constructor(binary.slice(value.offset, value.offset + value.byteLength))
      revived.set(value.offset, result)
      return result
    }
    if ('$map' in value)
      return new Map(value.$map.map(([key, item]) => [revive(key), revive(item)]))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
  }
  return revive(json)
}
