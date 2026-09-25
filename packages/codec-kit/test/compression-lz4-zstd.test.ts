import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import { decodeLz4Block, LZ4_MALFORMED } from '../src/compression/lz4.js'
import { decodeZstd, isZstdFrame, ZSTD_MALFORMED } from '../src/compression/zstd.js'

/** Deterministic bytes with long repeats, so the encoders find matches of every length class. */
function sample(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length)
  let state = seed
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    out[index] = index % 97 < 60 ? (out[index - 13] ?? 65) : (state >>> 24) & 0x3f
  }
  return out
}

/** Greedy LZ4 block encoder, only to produce valid blocks for the decoder under test. */
function encodeLz4(input: Uint8Array): Uint8Array {
  const out: number[] = []
  const table = new Map<number, number>()
  const length = (value: number): void => {
    let rest = value
    while (rest >= 255) {
      out.push(255)
      rest -= 255
    }
    out.push(rest)
  }
  let anchor = 0
  let ip = 0
  // The last 5 bytes are always literals and the last match starts 12 bytes before the end.
  while (ip + 12 <= input.length) {
    const key =
      ((input[ip] ?? 0) |
        ((input[ip + 1] ?? 0) << 8) |
        ((input[ip + 2] ?? 0) << 16) |
        ((input[ip + 3] ?? 0) << 24)) >>>
      0
    const candidate = table.get(key)
    table.set(key, ip)
    if (candidate === undefined || ip - candidate > 65535) {
      ip += 1
      continue
    }
    let match = 4
    while (ip + match < input.length - 5 && input[candidate + match] === input[ip + match])
      match += 1
    const literals = ip - anchor
    out.push((Math.min(literals, 15) << 4) | Math.min(match - 4, 15))
    if (literals >= 15) length(literals - 15)
    for (let index = anchor; index < ip; index += 1) out.push(input[index] ?? 0)
    const offset = ip - candidate
    out.push(offset & 0xff, offset >>> 8)
    if (match - 4 >= 15) length(match - 4 - 15)
    ip += match
    anchor = ip
  }
  const literals = input.length - anchor
  out.push(Math.min(literals, 15) << 4)
  if (literals >= 15) length(literals - 15)
  for (let index = anchor; index < input.length; index += 1) out.push(input[index] ?? 0)
  return Uint8Array.from(out)
}

describe('LZ4 block', () => {
  it('decodes literals, long literal runs and overlapping matches', () => {
    // "ab" then a match of length 7 at offset 2 → "ababababa", then literal "!".
    const block = Uint8Array.from([0x23, 0x61, 0x62, 0x02, 0x00, 0x10, 0x21])
    expect(new TextDecoder().decode(decodeLz4Block(block, 10))).toBe('ababababa!')
    for (const size of [0, 1, 15, 16, 300, 70_000]) {
      const input = sample(size, size)
      expect(decodeLz4Block(encodeLz4(input), input.length)).toEqual(input)
    }
  })

  it('refuses blocks that lie about their size or reach outside their buffers', () => {
    const input = sample(1000)
    const block = encodeLz4(input)
    const code = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        return (error as { code?: string }).code
      }
      return undefined
    }
    expect(code(() => decodeLz4Block(block, 999))).toBe(LZ4_MALFORMED)
    expect(code(() => decodeLz4Block(block, 1001))).toBe(LZ4_MALFORMED)
    expect(code(() => decodeLz4Block(block.subarray(0, block.length - 3), 1000))).toBe(
      LZ4_MALFORMED,
    )
    // Offset 5 before any output exists.
    expect(code(() => decodeLz4Block(Uint8Array.from([0x10, 0x61, 0x05, 0x00]), 10))).toBe(
      LZ4_MALFORMED,
    )
    // Offset zero.
    expect(code(() => decodeLz4Block(Uint8Array.from([0x10, 0x61, 0x00, 0x00]), 10))).toBe(
      LZ4_MALFORMED,
    )
  })
})

describe('Zstandard', () => {
  it('decodes frames produced by the reference encoder at several levels', () => {
    for (const [size, level] of [
      [0, 3],
      [1, 1],
      [4096, 3],
      [300_000, 1],
      [60_000, 19],
    ] as const) {
      const input = sample(size, size + level)
      const frame = new Uint8Array(zstdCompressSync(input, { params: { 100: level } }))
      expect(isZstdFrame(frame)).toBe(true)
      expect(decodeZstd(frame, { maxOutputBytes: 1 << 24 })).toEqual(input)
      expect(decodeZstd(frame, { maxOutputBytes: 1 << 24, expectedLength: size })).toEqual(input)
    }
  })

  it('decodes concatenated frames', () => {
    const a = sample(1000, 1)
    const b = sample(2000, 2)
    const frames = Uint8Array.from([...zstdCompressSync(a), ...zstdCompressSync(b)])
    expect(decodeZstd(frames, { maxOutputBytes: 10_000 })).toEqual(Uint8Array.from([...a, ...b]))
  })

  it('enforces the output bound and the declared length', () => {
    const input = sample(50_000)
    const frame = new Uint8Array(zstdCompressSync(input))
    const code = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        return (error as { code?: string }).code
      }
      return undefined
    }
    expect(code(() => decodeZstd(frame, { maxOutputBytes: 49_999 }))).toBe(COMPRESSION_OUTPUT_LIMIT)
    expect(code(() => decodeZstd(frame, { maxOutputBytes: 1 << 20, expectedLength: 40_000 }))).toBe(
      ZSTD_MALFORMED,
    )
    expect(code(() => decodeZstd(frame, { maxOutputBytes: 1 << 20, expectedLength: 60_000 }))).toBe(
      ZSTD_MALFORMED,
    )
    expect(
      code(() => decodeZstd(frame.subarray(0, frame.length - 10), { maxOutputBytes: 1 << 20 })),
    ).toBe(ZSTD_MALFORMED)
  })
})
