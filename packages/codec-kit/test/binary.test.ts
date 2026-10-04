import { describe, expect, it } from 'vitest'
import {
  ascii,
  boundedCount,
  byteView,
  checkedProduct,
  readNullTerminatedAscii,
  requireRange,
  viewAt,
} from '../src/binary.js'

describe('bounded native binary reads', () => {
  it('respects a source subarray, fixed string width and its NUL terminator', () => {
    const bytes = Uint8Array.from([255, 65, 66, 0, 67, 255]).subarray(1, 5)
    expect(byteView(bytes).getUint8(0)).toBe(65)
    expect(viewAt(bytes, 1, 1, 'name').getUint8(0)).toBe(66)
    expect(readNullTerminatedAscii(bytes, 0, 4, 'name')).toBe('AB')
    expect(readNullTerminatedAscii(bytes, 0, 1, 'name')).toBe('A')
    expect(ascii(Uint8Array.of(128))).toBe('€')
  })
  it('refuses unsafe addressing while allowing an empty range at EOF', () => {
    const bytes = new Uint8Array(4)
    expect(() => requireRange(bytes, 4, 0, 'field')).not.toThrow()
    for (const [offset, length] of [
      [-1, 1],
      [0, -1],
      [3, 2],
      [5, 0],
      [0.5, 1],
      [0, Infinity],
    ])
      expect(() => viewAt(bytes, offset!, length!, 'field')).toThrow(RangeError)
    expect(() => readNullTerminatedAscii(bytes, 0, 5, 'field')).toThrow(RangeError)
  })
  it('admits zero counts and refuses invalid counts or overflowing sizes', () => {
    expect(boundedCount(0, 3, 'count')).toBe(0)
    expect(boundedCount(3, 3, 'count')).toBe(3)
    for (const value of [-1, 4, 0.5, Infinity])
      expect(() => boundedCount(value, 3, 'count')).toThrow(RangeError)
    expect(checkedProduct(3, 4, 'size')).toBe(12)
    expect(() => checkedProduct(Number.MAX_SAFE_INTEGER, 2, 'size')).toThrow(RangeError)
    expect(() => checkedProduct(-1, 2, 'size')).toThrow(RangeError)
  })
})
