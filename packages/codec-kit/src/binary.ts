/** Portable bounded byte reads shared by native format readers. */
export function requireByteRange(
  byteLength: number,
  offset: number,
  length: number,
  label: string,
): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0)
    throw new RangeError(label + ' has an invalid range')
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    offset > byteLength ||
    length > byteLength - offset
  )
    throw new RangeError(label + ' is outside the source')
}

/** Validate addressing within an actual source buffer. */
export function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  requireByteRange(bytes.byteLength, offset, length, label)
}

/** A zero-copy view respecting the input's own byte offset. */
export function byteView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** View only a validated range; readers never address the backing buffer outside their source. */
export function viewAt(bytes: Uint8Array, offset: number, length: number, label: string): DataView {
  requireRange(bytes, offset, length, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

/** WHATWG Latin-1/ASCII decoding (Windows-1252); preserves the existing texture helper. */
export function ascii(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

/** Read a bounded fixed-width legacy name, stopping at its first NUL. */
export function readNullTerminatedAscii(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): string {
  requireRange(bytes, offset, length, label)
  let end = offset
  while (end < offset + length && bytes[end] !== 0) end += 1
  return ascii(bytes.subarray(offset, end))
}

/** An integer count including zero, bounded by the native format's own maximum. */
export function boundedCount(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new RangeError(label + ' has an invalid maximum')
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new RangeError(label + ' is outside 0–' + String(maximum))
  return value
}

/** Byte/count product; negative or inexact results cannot address source memory. */
export function checkedProduct(left: number, right: number, label: string): number {
  const result = left * right
  if (!Number.isSafeInteger(result) || result < 0)
    throw new RangeError(label + ' overflows a nonnegative safe integer')
  return result
}
