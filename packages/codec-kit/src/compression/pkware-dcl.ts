/**
 * PKWARE Data Compression Library "implode" streams, decoded ("explode"). MPQ archives of
 * Diablo, StarCraft and Warcraft III compress entries with it — the 0x08 compression mask, or a
 * whole entry under the IMPLODE flag — and other games of that era do too.
 *
 * A stream opens with two bytes: 0 or 1 (literals stored as raw bytes, or Huffman-coded) and the
 * dictionary size as 4, 5 or 6 (1, 2 or 4 KiB). Bits follow, least significant first. A 0 bit is a
 * literal; a 1 bit a match: a length code plus extra bits — length 519 ends the stream — then a
 * distance code shifted left by 2 bits for length 2 or by the dictionary bits otherwise, plus that
 * many low bits, plus one. The three Huffman codes are fixed by the format; they are canonical and
 * stored with every bit inverted. Every read and every copy is checked, so a broken stream is
 * refused without reading past its end, and the output never grows past `maxOutputBytes`.
 */
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

export const PKWARE_DCL_MALFORMED = 'codec-kit/pkware-dcl-malformed'

export interface PkwareDclOptions {
  /** Refuse a stream that decodes to more than this many bytes. */
  readonly maxOutputBytes: number
}

function malformed(message: string): Error {
  const error = new RangeError(`PKWARE DCL stream ${message}`)
  Object.defineProperty(error, 'code', { value: PKWARE_DCL_MALFORMED, enumerable: true })
  return error
}

function outputLimit(maximum: number): Error {
  const error = new RangeError(`PKWARE DCL output exceeds its ${maximum}-byte bound`)
  Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
  return error
}

const MAX_CODE_BITS = 13

/** A canonical code: how many codes each length has, and the symbols in code order. */
export interface PkwareDclCode {
  readonly count: Uint16Array
  readonly symbol: Uint16Array
}

/**
 * The format's code lengths, compacted: each byte is (repeats − 1) << 4 | length, for consecutive
 * symbols. Exported so a test can prove each table describes a complete code.
 */
export const PKWARE_DCL_LITERAL_LENGTHS = Object.freeze([
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8,
  23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11,
  8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253,
  253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
])
export const PKWARE_DCL_LENGTH_LENGTHS = Object.freeze([2, 35, 36, 53, 38, 23])
export const PKWARE_DCL_DISTANCE_LENGTHS = Object.freeze([2, 20, 53, 230, 247, 151, 248])

/** Shortest length and extra bits of each of the 16 length codes; 264 + 255 = 519 ends a stream. */
const LENGTH_BASE = Object.freeze([3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264])
const LENGTH_EXTRA = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8])
const END_OF_STREAM = 519

/** Expand compacted lengths into a canonical code over `symbols` symbols. */
export function pkwareDclCode(compact: readonly number[], symbols: number): PkwareDclCode {
  const lengths: number[] = []
  for (const byte of compact) {
    for (let repeat = (byte >> 4) + 1; repeat > 0; repeat -= 1) lengths.push(byte & 15)
  }
  if (lengths.length !== symbols) throw new TypeError(`PKWARE DCL table lists ${lengths.length} of ${symbols} symbols`)
  const count = new Uint16Array(MAX_CODE_BITS + 1)
  for (const length of lengths) count[length] = (count[length] ?? 0) + 1
  const offset = new Uint16Array(MAX_CODE_BITS + 1)
  for (let length = 1; length < MAX_CODE_BITS; length += 1) {
    offset[length + 1] = (offset[length] ?? 0) + (count[length] ?? 0)
  }
  const symbol = new Uint16Array(symbols)
  lengths.forEach((length, value) => {
    if (length === 0) return
    const at = offset[length] ?? 0
    symbol[at] = value
    offset[length] = at + 1
  })
  return { count, symbol }
}

const LITERAL_CODE = pkwareDclCode(PKWARE_DCL_LITERAL_LENGTHS, 256)
const LENGTH_CODE = pkwareDclCode(PKWARE_DCL_LENGTH_LENGTHS, 16)
const DISTANCE_CODE = pkwareDclCode(PKWARE_DCL_DISTANCE_LENGTHS, 64)

/** Decode a PKWARE DCL implode stream. */
export function explodePkwareDcl(input: Uint8Array, options: PkwareDclOptions): Uint8Array {
  const maximum = options.maxOutputBytes
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new TypeError('maxOutputBytes must be a non-negative safe integer')
  }
  if (input.byteLength < 2) throw malformed('ends before its header')
  const coded = input[0]
  const dictionaryBits = input[1] ?? 0
  if (coded !== 0 && coded !== 1) throw malformed(`has literal mode ${String(coded)}`)
  if (dictionaryBits < 4 || dictionaryBits > 6) throw malformed(`has dictionary size ${dictionaryBits}`)

  let position = 2
  let buffer = 0
  let available = 0
  const bit = (): number => {
    if (available === 0) {
      if (position >= input.byteLength) throw malformed('ends before its end code')
      buffer = input[position] ?? 0
      position += 1
      available = 8
    }
    const value = buffer & 1
    buffer >>= 1
    available -= 1
    return value
  }
  const bits = (count: number): number => {
    let value = 0
    for (let index = 0; index < count; index += 1) value |= bit() << index
    return value
  }
  const decode = (code: PkwareDclCode): number => {
    let value = 0
    let first = 0
    let index = 0
    for (let length = 1; length <= MAX_CODE_BITS; length += 1) {
      value |= bit() ^ 1
      const count = code.count[length] ?? 0
      if (value - first < count) return code.symbol[index + value - first] ?? 0
      index += count
      first = (first + count) << 1
      value <<= 1
    }
    throw malformed('has a code outside its table')
  }

  let output = new Uint8Array(Math.min(maximum, Math.max(4096, input.byteLength * 4)))
  let written = 0
  const reserve = (bytes: number): void => {
    const needed = written + bytes
    if (needed > maximum) throw outputLimit(maximum)
    if (needed <= output.byteLength) return
    const grown = new Uint8Array(Math.min(maximum, Math.max(needed, output.byteLength * 2)))
    grown.set(output.subarray(0, written))
    output = grown
  }

  for (;;) {
    if (bit() === 0) {
      reserve(1)
      output[written] = coded === 1 ? decode(LITERAL_CODE) : bits(8)
      written += 1
      continue
    }
    const symbol = decode(LENGTH_CODE)
    const length = (LENGTH_BASE[symbol] ?? 0) + bits(LENGTH_EXTRA[symbol] ?? 0)
    if (length === END_OF_STREAM) break
    const low = length === 2 ? 2 : dictionaryBits
    const distance = (decode(DISTANCE_CODE) << low) + bits(low) + 1
    if (distance > written) throw malformed('copies from before its start')
    reserve(length)
    // Byte by byte: a match may overlap the bytes it produces.
    for (let index = 0; index < length; index += 1) {
      output[written] = output[written - distance] ?? 0
      written += 1
    }
  }
  return output.slice(0, written)
}
