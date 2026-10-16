import { expect, it } from 'vitest'
import { expand5To8, rgb555ToRgb888 } from '../src/raster/index.js'
import { decodeBcSurface } from '../src/texture/bc-decode.js'

const bytes = [0,8,16,24,33,41,49,57,66,74,82,90,99,107,115,123,
  132,140,148,156,165,173,181,189,198,206,214,222,231,239,247,255]

it('expands every 5-bit level to the packed RGB byte table', () => {
  expect(Array.from({ length: 32 }, (_, level) => expand5To8(level))).toEqual(bytes)
})

it('keeps every red/blue endpoint pair of BC1 on the same byte table', () => {
  const block = new Uint8Array(8), view = new DataView(block.buffer)
  for (let red = 0; red < 32; red++) for (let blue = 0; blue < 32; blue++) {
    view.setUint16(0, (red << 11) | (20 << 5) | blue, true)
    const rgba = decodeBcSurface(block, 0, 4, 4, 'DXT1')
    for (let offset = 0; offset < rgba.length; offset += 4)
      expect([...rgba.subarray(offset, offset + 4)]).toEqual([bytes[red],81,bytes[blue],255])
  }
})

it('refuses values outside the extracted integer channel', () => {
  for (const value of [-1,32,1.5,NaN,Infinity,-Infinity,2**32])
    expect(() => expand5To8(value)).toThrow(RangeError)
})

it('unpacks all RGB555 colours, leaving bit 15 to the owning format', () => {
  for (let red = 0; red < 32; red++) for (let green = 0; green < 32; green++)
    for (let blue = 0; blue < 32; blue++) {
      const word = (red << 10) | (green << 5) | blue
      const expected = (bytes[red]! << 16) | (bytes[green]! << 8) | bytes[blue]!
      expect(rgb555ToRgb888(word)).toBe(expected)
      expect(rgb555ToRgb888(word | 0x8000)).toBe(expected)
    }
  for (const value of [-1,65536,1.5,NaN,Infinity])
    expect(() => rgb555ToRgb888(value)).toThrow(RangeError)
})
