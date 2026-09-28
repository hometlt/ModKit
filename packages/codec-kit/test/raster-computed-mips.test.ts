import { describe, expect, it } from 'vitest'
import type { RasterImageInfo, RasterRegionRequest } from '@modkit/sdk'
import { createRasterImageSource } from '../src/index.js'

const info: RasterImageInfo = {
  width: 8,
  height: 4,
  depth: 1,
  layers: 1,
  faces: 1,
  mipLevels: 1,
  frames: 1,
  channels: 4,
  bitDepth: 8,
  colorSpace: 'srgb',
  alphaMode: 'straight',
  orientation: 'top-left',
  decodedAccess: true,
}

describe('computed mip levels', () => {
  it('downscales the stored level for levels a file does not store', async () => {
    const requests: RasterRegionRequest[] = []
    // left half black, right half white; rows padded to a 40-byte stride
    const source = createRasterImageSource(
      new Uint8Array(1),
      'image/x-test',
      info,
      async request => {
        requests.push(request)
        const pixels = new Uint8Array(40 * 4)
        for (let y = 0; y < 4; y += 1)
          for (let x = 4; x < 8; x += 1) pixels.fill(255, y * 40 + x * 4, y * 40 + x * 4 + 4)
        return { width: 8, height: 4, rowStride: 40, pixelFormat: 'rgba8', pixels }
      },
    )
    const described = await source.info()
    expect(described).toMatchObject({ mipLevels: 4, storedMipLevels: 1 })
    const level = await source.readRegion!({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      mipLevel: 2,
      pixelFormat: 'rgba8',
      maxBytes: 8,
    })
    expect(level).toMatchObject({ width: 2, height: 1, rowStride: 8 })
    expect([...level.pixels]).toEqual([0, 0, 0, 0, 255, 255, 255, 255])
    expect(requests[0]).toMatchObject({ mipLevel: 0, width: 8, height: 4 })
    await expect(
      source.readRegion!({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        mipLevel: 4,
        pixelFormat: 'rgba8',
        maxBytes: 4,
      }),
    ).rejects.toThrow(RangeError)
  })

  it('leaves a full chain and a source without a decoder as they are', async () => {
    expect(
      (
        await createRasterImageSource(
          new Uint8Array(1),
          'image/x-test',
          { ...info, mipLevels: 4 },
          async () => {
            throw new Error('unused')
          },
        ).info()
      ).storedMipLevels,
    ).toBeUndefined()
    expect(
      (await createRasterImageSource(new Uint8Array(1), 'image/x-test', info).info()).mipLevels,
    ).toBe(1)
  })
})
