import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

/** A one-level 2D KTX2 around `payload`, as the header, level index and level data. */
function ktx2(vkFormat: number, width: number, height: number, supercompression: number, payload: Uint8Array, uncompressed: number) {
  const out = new Uint8Array(80 + 24 + payload.length)
  const view = new DataView(out.buffer)
  out.set(IDENTIFIER, 0)
  view.setUint32(12, vkFormat, true)
  view.setUint32(16, 1, true) // typeSize
  view.setUint32(20, width, true)
  view.setUint32(24, height, true)
  view.setUint32(36, 1, true) // faces
  view.setUint32(40, 1, true) // levels
  view.setUint32(44, supercompression, true)
  view.setBigUint64(80, 104n, true)
  view.setBigUint64(88, BigInt(payload.length), true)
  view.setBigUint64(96, BigInt(uncompressed), true)
  out.set(payload, 104)
  return out
}

/** BC1 block of one opaque colour (565 endpoints equal, every index 0). */
function bc1(color565: number): Uint8Array {
  return new Uint8Array([color565 & 0xff, color565 >> 8, color565 & 0xff, color565 >> 8, 0, 0, 0, 0])
}

/** BC3 block: alpha endpoints 255/0 with every alpha index 1 (→ 0), colour as BC1. */
function bc3(color565: number): Uint8Array {
  return new Uint8Array([255, 0, 0x49, 0x92, 0x24, 0x49, 0x92, 0x24, ...bc1(color565)])
}

async function pixels(bytes: Uint8Array, width: number, height: number) {
  const session = await openImageCodec('ktx2/codec.js', bytes)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  const raster = lease.value as RasterImageSource
  const info = await raster.info()
  const region = await raster.readRegion?.({ x: 0, y: 0, width, height, pixelFormat: 'rgba8', maxBytes: width * height * 4 })
  await lease.release()
  await session.dispose()
  return { info, region }
}

// The first test pays for the cold codec import.
describe('KTX2 block pixels', { timeout: 60_000 }, () => {
  it('decodes plain BC1 (VK_FORMAT_BC1_RGB_UNORM_BLOCK)', async () => {
    const blocks = new Uint8Array([...bc1(0xf800), ...bc1(0x001f)]) // red, then blue, 8 × 4
    const { info, region } = await pixels(ktx2(131, 8, 4, 0, blocks, blocks.length), 8, 4)
    expect(info).toMatchObject({ width: 8, height: 4, decodedAccess: true })
    expect([...region!.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...region!.pixels.subarray(4 * 4, 4 * 4 + 4)]).toEqual([0, 0, 255, 255])
  })

  it('decodes BC3 under Zstandard supercompression, as Roblox stores it', async () => {
    const blocks = new Uint8Array([...bc3(0x07e0), ...bc3(0x07e0)]) // green, alpha 0, 8 × 4
    const { info, region } = await pixels(ktx2(137, 8, 4, 2, new Uint8Array(zstdCompressSync(blocks)), blocks.length), 8, 4)
    expect(info).toMatchObject({ decodedAccess: true, alphaMode: 'straight' })
    expect([...region!.pixels.subarray(0, 4)]).toEqual([0, 255, 0, 0])
  })

  it('keeps metadata-only access for what it cannot decode', async () => {
    const { info, region } = await pixels(ktx2(37, 4, 4, 0, new Uint8Array(64), 64), 4, 4) // R8G8B8A8_UNORM
    expect(info.decodedAccess).toBe(false)
    expect(region).toBeUndefined()
  })
})
