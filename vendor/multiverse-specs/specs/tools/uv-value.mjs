/** Proposed UVB 2 canonical State value codec. This is a specification oracle, not VM admission. */
const MAX_BYTES = 1_048_576
const MAX_STRING_BYTES = 1024
const MAX_NODES = 65_536
const MAX_DEPTH = 16
const MAX_FIELDS = 256
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const signedMinimum = -(1n << 63n)
const signedMaximum = (1n << 63n) - 1n
const unsignedMaximum = (1n << 64n) - 1n

function utf8(value, maximum) {
  if (typeof value !== 'string') throw new TypeError('value string is required')
  const bytes = encoder.encode(value)
  if (bytes.length > maximum || decoder.decode(bytes) !== value)
    throw new RangeError('value string is invalid UTF-8 or exceeds its byte budget')
  return bytes
}

function integer(value, signed) {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value))
    throw new TypeError('value integer needs canonical decimal text')
  const number = BigInt(value)
  if (number < (signed ? signedMinimum : 1n) || number > (signed ? signedMaximum : unsignedMaximum))
    throw new RangeError('value integer is outside its wire range')
  return number
}

function declarationsByName(declarations) {
  if (!Array.isArray(declarations) || declarations.length > 256)
    throw new TypeError('value needs a bounded nominal type table')
  const byName = new Map()
  for (const declaration of declarations) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(declaration?.name ?? '') || byName.has(declaration.name)
      || !Array.isArray(declaration.fields) || declaration.fields.length === 0
      || declaration.fields.length > MAX_FIELDS)
      throw new TypeError('value has an invalid nominal declaration')
    const names = new Set()
    for (const field of declaration.fields) {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(field?.name ?? '') || names.has(field.name)
        || (field.optional !== undefined && field.optional !== true))
        throw new TypeError('value has an invalid nominal field')
      names.add(field.name)
    }
    byName.set(declaration.name, declaration)
  }
  for (const declaration of byName.values())
    for (const field of declaration.fields) concreteType(field.type, byName)
  return byName
}

function concreteType(name, declarations, depth = 0) {
  if (typeof name !== 'string' || name.length > 128 || depth > MAX_DEPTH)
    throw new RangeError('value type exceeds its grammar or depth budget')
  if (['bool', 'i64', 'fixed64', 'strref'].includes(name)) return { name, kind: name }
  if (/^ref<[a-z][a-z0-9-]*>$/.test(name)) return { name, kind: 'ref' }
  if (name.startsWith('list<') && name.endsWith('>'))
    return { name, kind: 'list', item: concreteType(name.slice(5, -1), declarations, depth + 1) }
  if (/^[A-Z][A-Za-z0-9]*$/.test(name) && declarations.has(name))
    return { name, kind: 'record', fields: declarations.get(name).fields }
  throw new TypeError(`value type ${name} is not a concrete declared type`)
}

const tag = { bool: 0, i64: 1, fixed64: 2, strref: 3, ref: 4, list: 5, record: 6 }

class Writer {
  chunks = []
  length = 0
  push(bytes) {
    if (this.length + bytes.length > MAX_BYTES) throw new RangeError('value exceeds 1 MiB')
    this.chunks.push(bytes)
    this.length += bytes.length
  }
  u8(value) { this.push(Uint8Array.of(value)) }
  u32(value) {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value, true)
    this.push(bytes)
  }
  i64(value) {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, value, true)
    this.push(bytes)
  }
  u64(value) {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigUint64(0, value, true)
    this.push(bytes)
  }
  text(value, maximum) {
    const bytes = utf8(value, maximum)
    this.u32(bytes.length)
    this.push(bytes)
  }
  bytes() {
    const result = new Uint8Array(this.length)
    let offset = 0
    for (const bytes of this.chunks) { result.set(bytes, offset); offset += bytes.length }
    return result
  }
}

class Reader {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES)
      throw new RangeError('value bytes exceed 1 MiB')
    this.bytes = bytes
    this.offset = 0
  }
  take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.length - this.offset)
      throw new RangeError('truncated value bytes')
    const result = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }
  u8() { return this.take(1)[0] }
  u32() {
    const bytes = this.take(4)
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true)
  }
  i64() {
    const bytes = this.take(8)
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true).toString()
  }
  u64() {
    const bytes = this.take(8)
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true).toString()
  }
  text(maximum) {
    const length = this.u32()
    if (length > maximum) throw new RangeError('value string exceeds its byte budget')
    return decoder.decode(this.take(length))
  }
}

function encodePayload(writer, type, value, declarations, budget, depth) {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH)
    throw new RangeError('value exceeds its node or depth budget')
  switch (type.kind) {
    case 'bool':
      if (typeof value !== 'boolean') throw new TypeError('value bool expected')
      writer.u8(value ? 1 : 0)
      break
    case 'i64': case 'fixed64': writer.i64(integer(value, true)); break
    case 'strref': writer.text(value, MAX_STRING_BYTES); break
    case 'ref': writer.u64(integer(value, false)); break
    case 'list':
      if (!Array.isArray(value) || value.length > MAX_NODES)
        throw new TypeError('value list exceeds its element budget')
      if (Reflect.ownKeys(value).length !== value.length + 1)
        throw new TypeError('value list has holes or computed elements')
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('value list has holes or computed elements')
      }
      writer.u32(value.length)
      for (const item of value) encodePayload(writer, type.item, item, declarations, budget, depth + 1)
      break
    case 'record': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new TypeError('value record needs a plain object')
      const names = new Set(type.fields.map(field => field.name))
      if (Reflect.ownKeys(value).some(name => typeof name !== 'string' || !names.has(name)
        || !Object.getOwnPropertyDescriptor(value, name)?.enumerable
        || !('value' in Object.getOwnPropertyDescriptor(value, name))))
        throw new TypeError('value record has an undeclared or computed field')
      for (const field of type.fields) {
        const present = Object.hasOwn(value, field.name)
        if (field.optional === true) writer.u8(present ? 1 : 0)
        else if (!present) throw new TypeError('value record misses a required field')
        if (present) encodePayload(writer, concreteType(field.type, declarations),
          value[field.name], declarations, budget, depth + 1)
      }
      break
    }
  }
}

function decodePayload(reader, type, declarations, budget, depth) {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH)
    throw new RangeError('value exceeds its node or depth budget')
  switch (type.kind) {
    case 'bool': {
      const value = reader.u8()
      if (value > 1) throw new TypeError('noncanonical bool value')
      return value === 1
    }
    case 'i64': case 'fixed64': return reader.i64()
    case 'strref': return reader.text(MAX_STRING_BYTES)
    case 'ref': {
      const value = reader.u64()
      if (value === '0') throw new TypeError('zero is not a typed reference')
      return value
    }
    case 'list': {
      const count = reader.u32()
      if (count > MAX_NODES) throw new RangeError('value list exceeds its element budget')
      const result = []
      for (let index = 0; index < count; index++)
        result.push(decodePayload(reader, type.item, declarations, budget, depth + 1))
      return result
    }
    case 'record': {
      const result = {}
      for (const field of type.fields) {
        const present = field.optional !== true || reader.u8()
        if (present !== true && present !== 0 && present !== 1)
          throw new TypeError('noncanonical optional field presence')
        if (present) result[field.name] = decodePayload(reader,
          concreteType(field.type, declarations), declarations, budget, depth + 1)
      }
      return result
    }
  }
}

/** A value carries its concrete type; nominal definitions come from the verified module table. */
export function encodeCanonicalValue({ type, value }, declarations = []) {
  const table = declarationsByName(declarations)
  const concrete = concreteType(type, table)
  const writer = new Writer()
  writer.u8(tag[concrete.kind])
  writer.text(type, 128)
  encodePayload(writer, concrete, value, table, { nodes: 0 }, 0)
  return writer.bytes()
}

export function decodeCanonicalValue(bytes, declarations = []) {
  const table = declarationsByName(declarations)
  const reader = new Reader(bytes)
  const actualTag = reader.u8()
  const type = reader.text(128)
  const concrete = concreteType(type, table)
  if (actualTag !== tag[concrete.kind]) throw new TypeError('value tag disagrees with its concrete type')
  const value = decodePayload(reader, concrete, table, { nodes: 0 }, 0)
  if (reader.offset !== bytes.length) throw new TypeError('trailing value bytes')
  return { type, value }
}
