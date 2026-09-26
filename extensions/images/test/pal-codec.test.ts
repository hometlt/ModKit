import { describe, expect, it } from 'vitest'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'

const encoder = new TextEncoder()

async function swatch(bytes: Uint8Array) {
  const session = await openImageCodec('pal/codec.js', bytes)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  try {
    const raster = lease.value as RasterImageSource
    const region = await raster.readRegion?.({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      pixelFormat: 'rgba8',
      maxBytes: 1024,
    })
    if (region === undefined) throw new Error('PAL swatch has no readRegion')
    return region.pixels
  } finally {
    await lease.release()
    await session.dispose()
  }
}

describe('pal codec reads through codec-kit/raster/palette', () => {
  it('renders a Westwood 6-bit table and JASC-PAL text as a 16 by 16 swatch', async () => {
    const raw = new Uint8Array(768)
    raw.set([63, 32, 1], 3)
    expect([...(await swatch(raw)).subarray(4, 8)]).toEqual([255, 130, 4, 255])
    const jasc = await swatch(encoder.encode('JASC-PAL\n0100\n2\n1 2 3\n250 128 0\n'))
    expect([...jasc.subarray(4, 12)]).toEqual([250, 128, 0, 255, 0, 0, 0, 255])
    // the first open imports the codec cold, which takes seconds on a loaded machine
  }, 30_000)

  it('refuses a raw table that is not 256 entries', async () => {
    await expect(openImageCodec('pal/codec.js', new Uint8Array(767))).rejects.toThrow(
      /256 RGB entries/u,
    )
  })
})
