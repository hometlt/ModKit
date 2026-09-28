import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import { applyFormat40, decodeLcw, LCW_MALFORMED } from '../src/compression/lcw.js'

const encoder = new TextEncoder()
const bytes = (...parts: (number | string)[]) =>
  Uint8Array.from(
    parts.flatMap(part => (typeof part === 'string' ? [...encoder.encode(part)] : [part])),
  )
const text = ({ output, written }: { output: Uint8Array; written: number }) =>
  new TextDecoder().decode(output.subarray(0, written))

describe('LCW (Format80)', () => {
  it('copies literals, repeats from behind, fills, and copies from an absolute position', () => {
    // prettier-ignore
    const stream = bytes(
      0x83, 'abc', // 3 literals
      0x10, 0x03, // 4 bytes from 3 back, overlapping → abca
      0xfe, 0x02, 0x00, 'z', // fill 2 × z
      0xc0, 0x00, 0x00, // 3 bytes from position 0 → abc
      0xff, 0x02, 0x00, 0x07, 0x00, // 2 bytes from position 7 → zz
      0x80, // end
    )
    const decoded = decodeLcw(stream, 16)
    expect(text(decoded)).toBe('abcabcazzabczz')
    expect(decoded.output.length).toBe(16)
  })

  it('addresses positions from the end of the output when the stream opens with zero', () => {
    expect(text(decodeLcw(bytes(0, 0x82, 'xy', 0xc0, 0x02, 0x00, 0x80), 8))).toBe('xyxyx')
  })

  it('ends where its input ends', () => {
    expect(text(decodeLcw(bytes(0x82, 'ok'), 4))).toBe('ok')
  })

  it('refuses copies from outside what was written and truncated commands', () => {
    for (const stream of [
      bytes(0x10, 0x05),
      bytes(0xc0, 0x04, 0x00),
      bytes(0x84, 'ab'),
      bytes(0xfe, 0x02),
    ]) {
      expect(() => decodeLcw(stream, 8)).toThrow(expect.objectContaining({ code: LCW_MALFORMED }))
    }
  })

  it('refuses a stream that writes past its declared size', () => {
    for (const stream of [
      bytes(0x84, 'abcd'),
      bytes(0xfe, 0x09, 0x00, 1),
      bytes(0x81, 'a', 0x10, 0x01),
    ]) {
      expect(() => decodeLcw(stream, 3)).toThrow(
        expect.objectContaining({ code: COMPRESSION_OUTPUT_LIMIT }),
      )
    }
  })
})

describe('Format40', () => {
  it('XORs short runs and fills onto the previous frame, skipping what does not change', () => {
    const frame = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1])
    applyFormat40(bytes(0x02, 0x03, 0x03, 0x81, 0x00, 0x02, 0x04, 0x80, 0x00, 0x00), frame)
    expect([...frame]).toEqual([2, 2, 1, 5, 5, 1, 1, 1])
  })

  it('reads the long skip, run and fill forms', () => {
    const frame = new Uint8Array(8)
    // prettier-ignore
    const delta = bytes(
      0x80, 0x02, 0x00, // skip 2
      0x80, 0x02, 0x80, 7, 8, // run of 2
      0x80, 0x03, 0xc0, 9, // fill 3 × 9
    )
    applyFormat40(delta, frame)
    expect([...frame]).toEqual([0, 0, 7, 8, 9, 9, 9, 0])
  })

  it('refuses a delta past its frame or cut inside a command', () => {
    expect(() => applyFormat40(bytes(0x80, 0x09, 0x00), new Uint8Array(8))).toThrow(
      expect.objectContaining({ code: COMPRESSION_OUTPUT_LIMIT }),
    )
    expect(() => applyFormat40(bytes(0x03, 1), new Uint8Array(8))).toThrow(
      expect.objectContaining({ code: LCW_MALFORMED }),
    )
  })
})
