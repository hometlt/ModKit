/** Exact UVW scalar storage. No I/O, geometry interpretation, hashing or Runtime admission.
 * Binary64 preserves the existing JSON number domain; the existing binder still owns fixed64 lowering.
 */
import schema from '../world/schema/uvw.exact-page.v1.schema.json' with { type: 'json' }

function refuse(message: string): never { throw new TypeError(`uvw-exact-page: ${message}`) }
const encodings = schema.properties.encoding.enum
export const UVW_EXACT_PAGE_MAX_VALUES = schema.properties.count.maximum

export interface UvwExactPageDescriptor {
  readonly schemaVersion: 1
  readonly encoding: string
  readonly count: number
  readonly byteLength: number
}

function byteLengthFor(encoding: string, count: number): number {
  if (!encodings.includes(encoding) || !Number.isSafeInteger(count)
    || count < 1 || count > UVW_EXACT_PAGE_MAX_VALUES)
    refuse('Unknown encoding or count outside the page budget')
  return encoding === 'bool-lsb0' ? Math.ceil(count / 8)
    : count * (encoding === 'f64-le' ? 8 : encoding === 'u32-le' ? 4 : 1)
}

export function assertUvwExactPageDescriptor(descriptor: unknown): UvwExactPageDescriptor {
  if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || Object.keys(descriptor).length !== schema.required.length
    || !schema.required.every(key => Object.hasOwn(descriptor, key)))
    refuse('Expected an unmixed version 1 page descriptor')
  const record = descriptor as Record<string, unknown>
  if (record['schemaVersion'] !== 1 || typeof record['encoding'] !== 'string' || typeof record['count'] !== 'number')
    refuse('Expected a version 1 page with a string encoding and numeric count')
  if (record['byteLength'] !== byteLengthFor(record['encoding'], record['count']))
    refuse('Byte length disagrees with encoding and count')
  return record as unknown as UvwExactPageDescriptor
}

/** Pack an already parsed, dense JSON scalar array. Signed zero follows existing JCS semantics. */
export function packUvwExactPage(encoding: string, values: readonly unknown[]): { descriptor: UvwExactPageDescriptor; bytes: Uint8Array } {
  if (!Array.isArray(values)) refuse('Expected a JSON scalar array')
  const byteLength = byteLengthFor(encoding, values.length)
  const bytes = new Uint8Array(byteLength), view = new DataView(bytes.buffer)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (encoding === 'bool-lsb0') {
      if (typeof value !== 'boolean') refuse(`Expected a boolean at ${i}`)
      if (value) bytes[i >>> 3] = bytes[i >>> 3]! | (1 << (i & 7))
    } else if (encoding === 'f64-le') {
      if (typeof value !== 'number' || !Number.isFinite(value)) refuse(`Expected a finite number at ${i}`)
      view.setFloat64(i * 8, value === 0 ? 0 : value, true)
    } else {
      const maximum = encoding === 'u8' ? 255 : 4294967295
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
        refuse(`Expected an unsigned ${encoding} integer at ${i}`)
      if (encoding === 'u8') bytes[i] = value
      else view.setUint32(i * 4, value, true)
    }
  }
  return { descriptor: { schemaVersion: 1, encoding, count: values.length, byteLength }, bytes }
}

/** Return private JSON values. Reject malformed/canonicality violations before exposing a result. */
export function unpackUvwExactPage(descriptor: unknown, bytes: unknown): (number | boolean)[] {
  const checked = assertUvwExactPageDescriptor(descriptor)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== checked.byteLength
    || !(bytes.buffer instanceof ArrayBuffer) || ('resizable' in bytes.buffer && bytes.buffer.resizable === true))
    refuse('Expected exactly one page in an ordinary fixed ArrayBuffer')
  const { encoding, count } = checked
  if (encoding === 'bool-lsb0' && count % 8 && (bytes[bytes.length - 1]! >>> (count % 8)) !== 0)
    refuse('Unused boolean tail bits must be zero')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = new Array<number | boolean>(count)
  for (let i = 0; i < count; i++) {
    if (encoding === 'bool-lsb0') values[i] = (bytes[i >>> 3]! & (1 << (i & 7))) !== 0
    else if (encoding === 'f64-le') {
      const value = view.getFloat64(i * 8, true)
      if (!Number.isFinite(value) || Object.is(value, -0)) refuse(`Noncanonical binary64 at ${i}`)
      values[i] = value
    } else values[i] = encoding === 'u8' ? bytes[i]! : view.getUint32(i * 4, true)
  }
  return values
}
