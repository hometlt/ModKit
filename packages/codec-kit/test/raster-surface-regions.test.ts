import { describe, expect, it } from 'vitest'
import { surfaceRegionReader, type RasterSurfaceAddress } from '../src/raster/surfaces.js'

// Two frames of 4 × 2 with a mip level each; a pixel's red is its x, green its y, blue frame·10 + mip.
const sizeOf = (surface: RasterSurfaceAddress) =>
  surface.frame < 2 && surface.mipLevel < 2 && surface.layer + surface.face + surface.slice === 0
    ? { width: 4 >> surface.mipLevel, height: 2 >> surface.mipLevel }
    : undefined

function reader() {
  const decoded: string[] = []
  const read = surfaceRegionReader(sizeOf, surface => {
    decoded.push(`${surface.frame}:${surface.mipLevel}`)
    const { width, height } = sizeOf(surface)!
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        pixels.set([x, y, surface.frame * 10 + surface.mipLevel, 255], (y * width + x) * 4)
    return pixels
  })
  return { read, decoded }
}

describe('surfaceRegionReader', () => {
  it('crops the addressed surface and decodes it once for several tiles', async () => {
    const { read, decoded } = reader()
    const region = await read({
      x: 1,
      y: 1,
      width: 2,
      height: 1,
      frame: 1,
      pixelFormat: 'rgba8',
      maxBytes: 8,
    })
    expect([...region.pixels]).toEqual([1, 1, 10, 255, 2, 1, 10, 255])
    expect(region.rowStride).toBe(8)
    await read({ x: 0, y: 0, width: 4, height: 2, frame: 1, pixelFormat: 'rgba8', maxBytes: 32 })
    const mip = await read({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
      mipLevel: 1,
      pixelFormat: 'rgba8',
      maxBytes: 4,
    })
    expect([...mip.pixels]).toEqual([1, 0, 1, 255])
    expect(decoded).toEqual(['1:0', '0:1'])
  })

  it('refuses before decoding what the texture lacks or the budget does not hold', async () => {
    const { read, decoded } = reader()
    const base = { x: 0, y: 0, width: 1, height: 1, pixelFormat: 'rgba8' as const, maxBytes: 4 }
    await expect(read({ ...base, frame: 2 })).rejects.toThrow(/not present/u)
    await expect(read({ ...base, face: 1 })).rejects.toThrow(/not present/u)
    await expect(read({ ...base, x: 4 })).rejects.toThrow(/outside/u)
    await expect(read({ ...base, width: 2, maxBytes: 7 })).rejects.toThrow(/maxBytes/u)
    await expect(read({ ...base, pixelFormat: 'rgba16f' as never })).rejects.toThrow(/rgba8/u)
    await expect(read({ ...base, x: -1 })).rejects.toThrow(TypeError)
    expect(decoded).toEqual([])
  })
})
