import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import {
  explodePkwareDcl,
  PKWARE_DCL_DISTANCE_LENGTHS,
  PKWARE_DCL_LENGTH_LENGTHS,
  PKWARE_DCL_LITERAL_LENGTHS,
  PKWARE_DCL_MALFORMED,
  pkwareDclCode,
  type PkwareDclCode,
} from '../src/compression/pkware-dcl.js'

const decoder = new TextDecoder()
const limit = { maxOutputBytes: 1_048_576 }

/** Codes left unused after every length is assigned: 0 for a complete prefix code. */
function unusedCodes(code: PkwareDclCode): number {
  let left = 1
  for (let length = 1; length < code.count.length; length += 1) {
    left = left * 2 - (code.count[length] ?? 0)
  }
  return left
}

/** A minimal encoder over the same canonical codes: bits least significant first, codes inverted. */
function encoder(dictionaryBits: number, coded: boolean) {
  const bytes = [coded ? 1 : 0, dictionaryBits]
  let buffer = 0
  let used = 0
  const bit = (value: number) => {
    buffer |= value << used
    used += 1
    if (used === 8) {
      bytes.push(buffer)
      buffer = 0
      used = 0
    }
  }
  const bits = (value: number, count: number) => {
    for (let index = 0; index < count; index += 1) bit((value >> index) & 1)
  }
  const codes = (code: PkwareDclCode) => {
    const byValue = new Map<number, { value: number; length: number }>()
    let first = 0
    let index = 0
    for (let length = 1; length < code.count.length; length += 1) {
      const count = code.count[length] ?? 0
      for (let offset = 0; offset < count; offset += 1) {
        byValue.set(code.symbol[index + offset] ?? 0, { value: first + offset, length })
      }
      index += count
      first = (first + count) << 1
    }
    return (symbol: number) => {
      const found = byValue.get(symbol)!
      for (let index = found.length - 1; index >= 0; index -= 1) bit(((found.value >> index) & 1) ^ 1)
    }
  }
  const literal = codes(pkwareDclCode(PKWARE_DCL_LITERAL_LENGTHS, 256))
  const length = codes(pkwareDclCode(PKWARE_DCL_LENGTH_LENGTHS, 16))
  return {
    literal(value: number) {
      bit(0)
      if (coded) literal(value)
      else bits(value, 8)
    },
    end() {
      bit(1)
      length(15) // base 264 + 255 extra = 519
      bits(255, 8)
      if (used > 0) bytes.push(buffer)
      return Uint8Array.from(bytes)
    },
  }
}

describe('PKWARE DCL explode', () => {
  it('uses the format tables as complete codes', () => {
    expect(unusedCodes(pkwareDclCode(PKWARE_DCL_LITERAL_LENGTHS, 256))).toBe(0)
    expect(unusedCodes(pkwareDclCode(PKWARE_DCL_LENGTH_LENGTHS, 16))).toBe(0)
    expect(unusedCodes(pkwareDclCode(PKWARE_DCL_DISTANCE_LENGTHS, 64))).toBe(0)
  })

  it('decodes raw literals and an overlapping match', () => {
    // The format's own published example: literals A and I, then one match copying them on.
    const stream = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f])
    expect(decoder.decode(explodePkwareDcl(stream, limit))).toBe('AIAIAIAIAIAIA')
  })

  it('decodes Huffman-coded literals with every byte value', () => {
    const write = encoder(6, true)
    const all = Uint8Array.from({ length: 256 }, (_, index) => index)
    for (const value of all) write.literal(value)
    expect(explodePkwareDcl(write.end(), limit)).toEqual(all)
  })

  it('refuses a broken stream without reading past it', () => {
    const code = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return (error as { code?: string }).code
      }
      return undefined
    }
    const stream = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f])
    expect(code(() => explodePkwareDcl(stream.subarray(0, 6), limit))).toBe(PKWARE_DCL_MALFORMED)
    expect(code(() => explodePkwareDcl(Uint8Array.from([2, 4]), limit))).toBe(PKWARE_DCL_MALFORMED)
    expect(code(() => explodePkwareDcl(Uint8Array.from([0, 7]), limit))).toBe(PKWARE_DCL_MALFORMED)
    // A match first: nothing precedes it to copy from.
    expect(code(() => explodePkwareDcl(Uint8Array.from([0x00, 0x04, 0x01, 0x00, 0x00]), limit))).toBe(PKWARE_DCL_MALFORMED)
    expect(code(() => explodePkwareDcl(stream, { maxOutputBytes: 12 }))).toBe(COMPRESSION_OUTPUT_LIMIT)
  })
})
