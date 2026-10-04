import { describe, expect, it } from 'vitest'
import { decodePcx, decodePcxIndices, parsePcx } from '../src/raster/index.js'

/** A 3x2 8-bit PCX, RLE rows, with a VGA palette trailer where index n is (n, 2n, 3n). */
function pcx(): Uint8Array {
  const header = new Uint8Array(128)
  header.set([0x0a, 5, 1, 8])
  const view = new DataView(header.buffer)
  view.setUint16(8, 2, true) // xmax
  view.setUint16(10, 1, true) // ymax
  header[65] = 1
  view.setUint16(66, 4, true) // bytes per line (even)
  view.setUint16(68, 1, true)
  // row 0: 1, 2, 3, pad; row 1: three 7s by one RLE packet, pad
  const data = [1, 2, 3, 0, 0xc3, 7, 0]
  const palette = new Uint8Array(769)
  palette[0] = 0x0c
  for (let index = 0; index < 256; index += 1)
    palette.set([index, (index * 2) & 255, (index * 3) & 255], 1 + index * 3)
  return Uint8Array.from([...header, ...data, ...palette])
}

describe('PCX in codec-kit raster', () => {
  it('reads the header, the palette indices and RGBA through the VGA trailer', () => {
    const bytes = pcx()
    const header = parsePcx(bytes, 1024)
    expect([header.width, header.height, header.hasVgaPalette, header.decodedAccess]).toEqual([
      3,
      2,
      true,
      true,
    ])
    expect([...decodePcxIndices(bytes, header)]).toEqual([1, 2, 3, 7, 7, 7])
    const image = decodePcx(bytes)
    expect([image.width, image.height]).toEqual([3, 2])
    expect([...image.pixels.subarray(0, 4)]).toEqual([1, 2, 3, 255])
    expect([...image.pixels.subarray(12, 16)]).toEqual([7, 14, 21, 255])
  })

  it('uses a valid VGA trailer even when paletteInfo declares grayscale', () => {
    const color = pcx()
    const grayscaleHint = color.slice()
    new DataView(grayscaleHint.buffer).setUint16(68, 2, true)
    const header = parsePcx(grayscaleHint, 1024)
    expect([header.paletteInfo, header.hasVgaPalette]).toEqual([2, true])
    expect(decodePcxIndices(grayscaleHint, header)).toEqual(
      decodePcxIndices(color, parsePcx(color, 1024)),
    )
    expect(decodePcx(grayscaleHint).pixels).toEqual(decodePcx(color).pixels)
    expect([...decodePcx(grayscaleHint).pixels.subarray(12, 16)]).toEqual([7, 14, 21, 255])
  })

  it('retains an authored grayscale trailer rather than replacing it with an index ramp', () => {
    const bytes = pcx()
    new DataView(bytes.buffer).setUint16(68, 2, true)
    for (let index = 0; index < 256; index += 1) {
      const shade = 255 - index
      bytes.set([shade, shade, shade], bytes.length - 768 + index * 3)
    }
    expect([...decodePcx(bytes).pixels.subarray(0, 4)]).toEqual([254, 254, 254, 255])
  })

  it('keeps header-palette and grayscale fallback policy when there is no VGA trailer', () => {
    const bytes = pcx().slice(0, -769)
    bytes.set([32, 64, 96], 16 + 3)
    expect(parsePcx(bytes, 1024).hasVgaPalette).toBe(false)
    expect([...decodePcx(bytes).pixels.subarray(0, 4)]).toEqual([32, 64, 96, 255])
    new DataView(bytes.buffer).setUint16(68, 2, true)
    expect([...decodePcx(bytes).pixels.subarray(0, 4)]).toEqual([1, 1, 1, 255])
  })

  it.each([3, 4])('keeps %i-plane direct color independent of paletteInfo', planes => {
    const header = pcx().slice(0, 128)
    const view = new DataView(header.buffer)
    header[2] = 0 // uncompressed
    header[65] = planes
    view.setUint16(8, 1, true) // 2x1
    view.setUint16(10, 0, true)
    view.setUint16(66, 2, true)
    view.setUint16(68, 2, true)
    const bytes = Uint8Array.from([
      ...header,
      12,
      13, // red
      24,
      25, // green
      36,
      37, // blue
      ...(planes === 4 ? [48, 49] : []),
    ])
    expect([...decodePcx(bytes).pixels]).toEqual([
      12,
      24,
      36,
      planes === 4 ? 48 : 255,
      13,
      25,
      37,
      planes === 4 ? 49 : 255,
    ])
  })

  it('still refuses truncated RLE data, overlong runs and decode budgets with a VGA trailer', () => {
    const bytes = pcx()
    new DataView(bytes.buffer).setUint16(68, 2, true)
    const truncated = Uint8Array.from([
      ...bytes.subarray(0, 128),
      0xc3, // run value is absent; the decoder must not consume the palette marker
      ...bytes.subarray(-769),
    ])
    expect(() => decodePcx(truncated)).toThrow(/RLE/u)
    const overlong = bytes.slice()
    overlong[128] = 0xff // 63 samples exceed the declared eight row bytes
    expect(() => decodePcx(overlong)).toThrow(/RLE/u)
    expect(() => decodePcx(bytes, 8)).toThrow(/budget/u)
  })

  it('refuses a truncated header and an image beyond the budget', () => {
    expect(() => parsePcx(new Uint8Array(64), 1024)).toThrow(/truncated/u)
    expect(() => decodePcx(pcx(), 8)).toThrow(/budget/u)
  })
})
