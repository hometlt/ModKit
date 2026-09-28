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

  it('refuses a truncated header and an image beyond the budget', () => {
    expect(() => parsePcx(new Uint8Array(64), 1024)).toThrow(/truncated/u)
    expect(() => decodePcx(pcx(), 8)).toThrow(/budget/u)
  })
})
