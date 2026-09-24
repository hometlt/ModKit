import { describe, expect, it } from 'vitest'
import { crc32Range } from '../src/checksum/index.js'
import { compressPortable } from '../src/compression/bounded.js'
import { decodePngSamples, encodeGreyPng, encodePng, greyGridFromPng, greyGridToPng } from '../src/raster/index.js'

/** A PNG whose rows use the given filters, as image editors write them. */
async function filteredPng(width: number, height: number, depth: 8 | 16, grey: number[], filters: number[]) {
  const bpp = depth / 8
  const rowBytes = width * bpp
  const rows = grey.flatMap(value => (depth === 16 ? [value >> 8, value & 0xff] : [value]))
  const raw: number[] = []
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y += 1) {
    const filter = filters[y % filters.length] as number
    raw.push(filter)
    for (let x = 0; x < rowBytes; x += 1) {
      const at = (yy: number, xx: number) => (yy < 0 || xx < 0 ? 0 : (rows[yy * rowBytes + xx] as number))
      const [a, b, c] = [at(y, x - bpp), at(y - 1, x), at(y - 1, x - bpp)]
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] as number
      raw.push(((rows[y * rowBytes + x] as number) - predicted) & 0xff)
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.byteLength)
    new DataView(out.buffer).setUint32(0, data.byteLength)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    new DataView(out.buffer).setUint32(8 + data.byteLength, crc32Range(out, 4, 8 + data.byteLength))
    return out
  }
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header[8] = depth
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', await compressPortable(Uint8Array.from(raw), 'deflate')),
    chunk('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  parts.reduce((offset, part) => (png.set(part, offset), offset + part.byteLength), 0)
  return png
}

describe('codec-kit PNG samples', () => {
  it('keeps every 16-bit and 8-bit grey sample exactly', async () => {
    const heights = [0, 1, 255, 256, 4096, 65535]
    const sixteen = await decodePngSamples(await encodeGreyPng(3, 2, heights, 16))
    expect(sixteen).toMatchObject({ width: 3, height: 2, bitDepth: 16, channels: 1 })
    expect([...sixteen.samples]).toEqual(heights)
    const eight = await decodePngSamples(await encodeGreyPng(2, 2, [0, 7, 128, 255], 8))
    expect(eight).toMatchObject({ bitDepth: 8, channels: 1 })
    expect([...eight.samples]).toEqual([0, 7, 128, 255])
    await expect(encodeGreyPng(1, 1, [256], 8)).rejects.toThrow(/outside 0..255/)
  })

  it('reads RGBA and every row filter an editor may write', async () => {
    const rgba = await decodePngSamples(await encodePng(1, 1, Uint8Array.from([1, 2, 3, 4])))
    expect(rgba).toMatchObject({ channels: 4, bitDepth: 8 })
    expect([...rgba.samples]).toEqual([1, 2, 3, 4])
    const grey = Array.from({ length: 5 * 5 }, (_, index) => (index * 2654435761) % 65536)
    const decoded = await decodePngSamples(await filteredPng(5, 5, 16, grey, [0, 1, 2, 3, 4]))
    expect([...decoded.samples]).toEqual(grey)
    const small = grey.map(value => value & 0xff)
    expect([...(await decodePngSamples(await filteredPng(5, 5, 8, small, [4, 3, 2, 1, 0]))).samples]).toEqual(small)
  })

  it('carries a grid through an image exactly, and an 8-bit edit of a 16-bit grid over its range', async () => {
    const grid = { width: 2, height: 2, values: [0, 300, 4096, 65535] }
    const png = await greyGridToPng(grid, 65535)
    expect((await decodePngSamples(png)).bitDepth).toBe(16)
    expect(await greyGridFromPng(png, { width: 2, height: 2, minimum: 0, maximum: 65535 })).toEqual(grid)
    const levels = await greyGridToPng({ width: 2, height: 1, values: [0, 15] }, 15)
    expect((await decodePngSamples(levels)).bitDepth).toBe(8)
    const edited = await encodeGreyPng(2, 1, [0, 255], 8)
    expect((await greyGridFromPng(edited, { width: 2, height: 1, minimum: 0, maximum: 65535 })).values).toEqual([0, 65535])
    await expect(greyGridFromPng(levels, { width: 2, height: 1, minimum: 0, maximum: 10 })).rejects.toThrow(/outside 0..10/)
    await expect(greyGridFromPng(levels, { width: 3, height: 1, minimum: 0, maximum: 15 })).rejects.toThrow(/2x1/)
  })

  it('refuses what it cannot read instead of guessing', async () => {
    await expect(decodePngSamples(new Uint8Array([1, 2, 3]))).rejects.toThrow(/signature/)
    await expect(decodePngSamples(await encodeGreyPng(4, 4, new Array(16).fill(0), 8), { maxPixels: 8 })).rejects.toThrow(
      /pixel bound/,
    )
  })
})
