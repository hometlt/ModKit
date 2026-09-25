/**
 * RefPack (EA's LZ77 variant, also "QFS"): SAGE BIG archives, SAGE map envelopes and other EA
 * titles compress payloads with it.
 *
 * A stream starts with a flags byte and 0xFB, then big-endian sizes: 3 bytes each, or 4 when flag
 * 0x80 is set; with flag 0x01 the compressed size comes first and the decoded size second. Commands
 * follow: four match forms that may carry up to 3 literals, a literal run of 4–112 bytes, and a
 * stop code with up to 3 final literals. Every length and distance is checked before use, and the
 * declared size is bounded before anything is allocated.
 */
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

export const REFPACK_MALFORMED = 'codec-kit/refpack-malformed'

export interface RefPackHeader {
  /** Where the commands start. */
  readonly headerBytes: number
  /** Decoded size. */
  readonly size: number
  /** Present when the header carries it (flag 0x01). */
  readonly compressedSize?: number
}

function malformed(message: string): Error {
  const error = new RangeError(`RefPack stream ${message}`)
  Object.defineProperty(error, 'code', { value: REFPACK_MALFORMED, enumerable: true })
  return error
}

/** `true` for bytes that start with a RefPack header (flags with 0x10 set, then 0xFB). */
export function isRefPack(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && ((bytes[0] ?? 0) & 0x3e) === 0x10 && bytes[1] === 0xfb
}

/** The header of a RefPack stream; `bytes` needs only its first 10 bytes at most. */
export function readRefPackHeader(bytes: Uint8Array): RefPackHeader {
  if (!isRefPack(bytes)) throw malformed('has no RefPack header')
  const flags = bytes[0] ?? 0
  const width = (flags & 0x80) !== 0 ? 4 : 3
  const carriesCompressedSize = (flags & 0x01) !== 0
  const headerBytes = 2 + width * (carriesCompressedSize ? 2 : 1)
  if (bytes.byteLength < headerBytes) throw malformed('header is truncated')
  const number = (at: number): number => {
    let value = 0
    for (let index = 0; index < width; index += 1) value = value * 256 + (bytes[at + index] ?? 0)
    return value
  }
  return carriesCompressedSize
    ? { headerBytes, size: number(2 + width), compressedSize: number(2) }
    : { headerBytes, size: number(2) }
}

/** Decode a whole RefPack stream; its declared size must not exceed `maxOutputBytes`. */
export function decodeRefPack(input: Uint8Array, maxOutputBytes: number): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new TypeError('RefPack input must be bytes')
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new RangeError('maxOutputBytes must be a non-negative safe integer')
  }
  const header = readRefPackHeader(input)
  if (header.size > maxOutputBytes) {
    const error = new RangeError(
      `RefPack output ${header.size} exceeds its ${maxOutputBytes}-byte bound`,
    )
    Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
    throw error
  }
  const output = new Uint8Array(header.size)
  let ip = header.headerBytes
  let op = 0

  const literals = (length: number): void => {
    if (length > input.length - ip) throw malformed('literal run overruns the input')
    if (length > output.length - op) throw malformed('literal run overruns the output')
    output.set(input.subarray(ip, ip + length), op)
    ip += length
    op += length
  }
  const match = (distance: number, length: number): void => {
    if (distance > op) throw malformed(`has a match distance ${distance} before the output start`)
    if (length > output.length - op) throw malformed('match overruns the output')
    const from = op - distance
    if (distance >= length) {
      output.copyWithin(op, from, from + length)
      op += length
      return
    }
    // An overlapping match repeats the last `distance` bytes; it must run byte by byte.
    for (let index = 0; index < length; index += 1) {
      output[op] = output[from + index] ?? 0
      op += 1
    }
  }
  const operand = (count: number): number[] => {
    if (count > input.length - ip) throw malformed('ends inside a command')
    const bytes = Array.from(input.subarray(ip, ip + count))
    ip += count
    return bytes
  }

  for (;;) {
    if (ip >= input.length) throw malformed('ends without its stop code')
    const control = input[ip++] ?? 0
    if (control < 0x80) {
      const [b1 = 0] = operand(1)
      literals(control & 0x03)
      match(((control & 0x60) << 3) + b1 + 1, ((control & 0x1c) >>> 2) + 3)
    } else if (control < 0xc0) {
      const [b1 = 0, b2 = 0] = operand(2)
      literals(b1 >>> 6)
      match(((b1 & 0x3f) << 8) + b2 + 1, (control & 0x3f) + 4)
    } else if (control < 0xe0) {
      const [b1 = 0, b2 = 0, b3 = 0] = operand(3)
      literals(control & 0x03)
      match(((control & 0x10) << 12) + (b1 << 8) + b2 + 1, ((control & 0x0c) << 6) + b3 + 5)
    } else if (control < 0xfc) {
      literals(((control & 0x1f) + 1) << 2)
    } else {
      literals(control & 0x03)
      break
    }
  }
  if (op !== output.length)
    throw malformed(`decoded ${op} bytes where ${output.length} were declared`)
  return output
}
