import { describe, expect, it } from 'vitest'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

/** A one-level 2D KTX1 of GPU blocks in `glInternalFormat` (glType 0), with the KTX orientation. */
function ktx1(glInternalFormat: number, width: number, height: number, payload: Uint8Array) {
  const orientation = new TextEncoder().encode('KTXorientation\0S=r,T=d\0')
  const keyValue = 4 + orientation.length + ((4 - (orientation.length % 4)) % 4)
  const out = new Uint8Array(64 + keyValue + 4 + payload.length)
  const view = new DataView(out.buffer)
  out.set(IDENTIFIER, 0)
  view.setUint32(12, 0x04030201, true)
  view.setUint32(20, 1, true) // glTypeSize
  view.setUint32(28, glInternalFormat, true)
  view.setUint32(36, width, true)
  view.setUint32(40, height, true)
  view.setUint32(52, 1, true) // faces
  view.setUint32(56, 1, true) // mip levels
  view.setUint32(60, keyValue, true)
  view.setUint32(64, orientation.length, true)
  out.set(orientation, 68)
  view.setUint32(64 + keyValue, payload.length, true)
  out.set(payload, 64 + keyValue + 4)
  return out
}

describe('KTX1 GPU block pixels', { timeout: 60_000 }, () => {
  it('decodes a DXT1 level that used to list without pixels', async () => {
    // one DXT1 block of opaque red (565 endpoints equal, every index 0)
    const bytes = ktx1(0x83f1, 4, 4, Uint8Array.of(0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0))
    const session = await openImageCodec('ktx/codec.js', bytes)
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    expect((await raster.info()).decodedAccess).toBe(true)
    const region = await raster.readRegion?.({ x: 1, y: 1, width: 2, height: 2, pixelFormat: 'rgba8', maxBytes: 16 })
    await lease.release()
    await session.dispose()
    expect([...region!.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
  })
})
