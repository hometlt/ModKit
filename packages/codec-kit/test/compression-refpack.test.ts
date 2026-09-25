import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import {
  decodeRefPack,
  isRefPack,
  readRefPackHeader,
  REFPACK_MALFORMED,
} from '../src/compression/refpack.js'

const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))
const decoded = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/** Hand-written command encoders, one per RefPack form, so each bit field is exercised on purpose. */
const command = {
  short: (literals: number[], length: number, distance: number) => [
    (((distance - 1) >> 8) << 5) | ((length - 3) << 2) | literals.length,
    (distance - 1) & 0xff,
    ...literals,
  ],
  medium: (literals: number[], length: number, distance: number) => [
    0x80 | (length - 4),
    (literals.length << 6) | ((distance - 1) >> 8),
    (distance - 1) & 0xff,
    ...literals,
  ],
  long: (literals: number[], length: number, distance: number) => [
    0xc0 | (((distance - 1) >> 16) << 4) | (((length - 5) >> 8) << 2) | literals.length,
    ((distance - 1) >> 8) & 0xff,
    (distance - 1) & 0xff,
    (length - 5) & 0xff,
    ...literals,
  ],
  run: (literals: number[]) => [0xe0 | (literals.length / 4 - 1), ...literals],
  stop: (literals: number[]) => [0xfc | literals.length, ...literals],
}

function stream(size: number, body: number[]): Uint8Array {
  return Uint8Array.from([
    0x10,
    0xfb,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...body,
  ])
}

describe('RefPack', () => {
  it('decodes every command form, including an overlapping match', () => {
    const bytes = stream(22, [
      ...command.run(ascii('ABCD')),
      ...command.short(ascii('E'), 3, 5),
      ...command.medium(ascii('FG'), 4, 2),
      ...command.long([], 5, 14),
      ...command.stop(ascii('XYZ')),
    ])
    expect(isRefPack(bytes)).toBe(true)
    expect(readRefPackHeader(bytes)).toEqual({ headerBytes: 5, size: 22 })
    expect(decoded(decodeRefPack(bytes, 22))).toBe('ABCDEABCFGFGFGABCDEXYZ')
  })

  it('reads 4-byte sizes with the compressed size first', () => {
    const body = [...command.run(ascii('WXYZ')), ...command.stop([])]
    const compressed = 10 + body.length
    const bytes = Uint8Array.from([0x91, 0xfb, 0, 0, 0, compressed, 0, 0, 0, 4, ...body])
    expect(readRefPackHeader(bytes)).toEqual({
      headerBytes: 10,
      size: 4,
      compressedSize: compressed,
    })
    expect(decoded(decodeRefPack(bytes, 4))).toBe('WXYZ')
  })

  it('reaches back past 64 KiB with the long form and its widest length', () => {
    const body: number[] = []
    const expected: number[] = []
    for (let block = 0; expected.length < 70_000; block += 1) {
      const literals = Array.from({ length: 112 }, (_, index) => (block * 7 + index * 13) & 0xff)
      body.push(...command.run(literals))
      expected.push(...literals)
    }
    const start = expected.length - 70_000
    expected.push(...expected.slice(start, start + 1028))
    body.push(...command.long([], 1028, 70_000), ...command.stop([]))
    const bytes = Uint8Array.from([
      0x90,
      0xfb,
      ...[24, 16, 8, 0].map(shift => (expected.length >>> shift) & 0xff),
      ...body,
    ])
    expect([...decodeRefPack(bytes, expected.length)]).toEqual(expected)
  })

  it('refuses malformed streams and a declared size over the bound', () => {
    const code = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return (error as { code?: string }).code
      }
      return 'no error'
    }
    const run = command.run(ascii('ABCD'))
    expect(code(() => readRefPackHeader(Uint8Array.of(0x10, 0xfa, 0, 0, 4)))).toBe(
      REFPACK_MALFORMED,
    )
    expect(code(() => readRefPackHeader(Uint8Array.of(0x10, 0xfb, 0, 0)))).toBe(REFPACK_MALFORMED)
    expect(code(() => decodeRefPack(stream(4, run), 4))).toBe(REFPACK_MALFORMED)
    expect(() => decodeRefPack(stream(4, run), 4)).toThrow(/without its stop code/u)
    expect(() => decodeRefPack(stream(7, [...run, ...command.short([], 3, 5)]), 7)).toThrow(
      /before the output start/u,
    )
    expect(() => decodeRefPack(stream(5, [...run, ...command.stop([])]), 5)).toThrow(
      /decoded 4 bytes where 5 were declared/u,
    )
    expect(() => decodeRefPack(stream(4, [0xe0, 0x41]), 4)).toThrow(/overruns the input/u)
    expect(() => decodeRefPack(stream(4, [...run, ...command.stop(ascii('Z'))]), 4)).toThrow(
      /overruns the output/u,
    )
    expect(code(() => decodeRefPack(stream(4, [...run, ...command.stop([])]), 3))).toBe(
      COMPRESSION_OUTPUT_LIMIT,
    )
  })
})
