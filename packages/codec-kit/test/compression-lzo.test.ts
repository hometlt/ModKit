import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import { decodeLzo1x, encodeLzo1x, LZO_MALFORMED } from '../src/compression/lzo.js'

const encoder = new TextEncoder()
const bytes = (...parts: (number | string | Uint8Array)[]) =>
  Uint8Array.from(
    parts.flatMap(part =>
      typeof part === 'string'
        ? [...encoder.encode(part)]
        : typeof part === 'number'
          ? [part]
          : [...part],
    ),
  )
const text = (output: Uint8Array) => new TextDecoder().decode(output)
const END = [0x11, 0, 0]
const pattern = (length: number) => Uint8Array.from({ length }, (_, index) => index & 0xff)

describe('LZO1X', () => {
  it('decodes an opening literal run and the end marker', () => {
    expect(text(decodeLzo1x(bytes(17 + 11, 'hello world', ...END), 11))).toBe('hello world')
    // an opening count under 4 goes straight to the literals that precede a match
    expect(text(decodeLzo1x(bytes(17 + 2, 'ab', ...END), 2))).toBe('ab')
  })

  it('decodes an overlapping M2, its trailing literal and a 2-byte M1', () => {
    // M2: 3 bytes (t >> 5 = 2) from 4 back ((t >> 2) & 7 = 3), one trailing literal (t & 3)
    const m2 = (2 << 5) | (3 << 2) | 1
    // M1 after a match's literals: 2 bytes from 2 back
    const m1 = 1 << 2
    expect(text(decodeLzo1x(bytes(17 + 4, 'abcd', m2, 0x00, 'x', m1, 0x00, ...END), 10))).toBe(
      'abcdabcxcx',
    )
  })

  it('decodes a short literal command and an M3', () => {
    // literal command 1 → 4 literals; M3: 4 bytes (count 2 + 2) from 4 back
    expect(text(decodeLzo1x(bytes(0x01, 'abcd', 32 | 2, 3 << 2, 0x00, ...END), 8))).toBe('abcdabcd')
  })

  it('reads extended literal counts and the 3-byte M1 from 2 KiB back', () => {
    // 15 + 8 × 255 + 42 + 3 = 2100 literals, then 3 bytes from 2049 back
    const literals = pattern(2100)
    const output = decodeLzo1x(
      bytes(0x00, ...new Array(8).fill(0), 42, literals, 0x00, 0x00, ...END),
      2103,
    )
    expect([...output.subarray(0, 2100)]).toEqual([...literals])
    expect([...output.subarray(2100)]).toEqual([51, 52, 53])
  })

  it('decodes an M4 from 16 KiB back with a trailing literal', () => {
    // 15 + 64 × 255 + 62 + 3 = 16400 literals; M4: 3 bytes from 0x4000 + 16 back, one trailing literal
    const literals = pattern(16400)
    const stream = bytes(
      0x00,
      ...new Array(64).fill(0),
      62,
      literals,
      16 | 1,
      (16 << 2) | 1,
      0x00,
      0xaa,
      ...END,
    )
    const output = decodeLzo1x(stream, 16404)
    expect([...output.subarray(16400)]).toEqual([0, 1, 2, 0xaa])
  })

  it('refuses streams that end short, reach before their start, run on, or are cut', () => {
    for (const [stream, size] of [
      [bytes(17 + 2, 'ab', ...END), 4],
      [bytes(17 + 4, 'abcd', 0xfc, 0xff, ...END), 9],
      [bytes(17 + 1, 'a', ...END, 0x99), 1],
      [bytes(17 + 4, 'ab'), 4],
      [bytes(17 + 1, 'a', 0x11), 1],
    ] as const) {
      expect(() => decodeLzo1x(stream, size)).toThrow(
        expect.objectContaining({ code: LZO_MALFORMED }),
      )
    }
  })

  it('refuses a stream that writes past its declared size', () => {
    expect(() => decodeLzo1x(bytes(17 + 4, 'abcd', ...END), 2)).toThrow(
      expect.objectContaining({ code: COMPRESSION_OUTPUT_LIMIT }),
    )
  })
})

describe('LZO1X storing encoder', () => {
  it('writes streams the decoder reads back, across the short, extended and empty runs', () => {
    let seed = 11
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 0xff
    for (const length of [0, 1, 3, 4, 238, 239, 273, 274, 529, 8192, 70_000]) {
      const bytes = Uint8Array.from({ length }, random)
      const stream = encodeLzo1x(bytes)
      expect(decodeLzo1x(stream, length), `${length} bytes`).toEqual(bytes)
    }
    expect([...encodeLzo1x(new Uint8Array())]).toEqual([0x11, 0, 0])
    expect([...encodeLzo1x(Uint8Array.of(7))]).toEqual([18, 7, 0x11, 0, 0])
    // 18 + 255 + 1: a zero opener, one 255 step, then 1
    expect([...encodeLzo1x(new Uint8Array(274)).subarray(0, 3)]).toEqual([0, 0, 1])
  })
})
