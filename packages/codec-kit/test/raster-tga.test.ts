import { describe, expect, it } from 'vitest'
import { encodeTga } from '../src/raster/encoders.js'
import { decodeTga, parseTga, plausibleTgaHeader } from '../src/raster/tga.js'

const pixels = (width: number, height: number) => Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 37) & 255)

describe('TGA reading', () => {
  it('reads back what encodeTga writes', () => {
    const image = { width: 3, height: 2, pixels: pixels(3, 2) }
    expect(decodeTga(encodeTga(image))).toEqual(image)
  })

  it('turns a bottom-left origin, 24-bit BGR and RLE packets into top-left RGBA', () => {
    // 2 × 2, bottom-left origin: the file's first row is the image's last.
    const raw = Uint8Array.from([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 24, 0,
      /* bottom row */ 3, 2, 1, 6, 5, 4, /* top row */ 9, 8, 7, 12, 11, 10])
    expect([...decodeTga(raw).pixels]).toEqual([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255])
    // Type 10 (RLE), top-left: one run of 4 identical 32-bit pixels.
    const rle = Uint8Array.from([0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 32, 0x28, 0x83, 30, 20, 10, 40])
    expect([...decodeTga(rle).pixels]).toEqual([10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40])
  })

  it('refuses what it cannot decode', () => {
    expect(plausibleTgaHeader(new Uint8Array(12))).toBe(false)
    const mapped = Uint8Array.from([0, 1, 1, 0, 0, 2, 0, 24, 0, 0, 0, 0, 1, 0, 1, 0, 8, 0, 1, 2, 3, 4, 5, 6, 0])
    expect(parseTga(mapped, 1024).decodedAccess).toBe(false)
    expect(() => decodeTga(mapped)).toThrow(/Colour-mapped/)
    expect(() => decodeTga(encodeTga({ width: 64, height: 64, pixels: pixels(64, 64) }), 1024)).toThrow(/budget/)
  })
})
