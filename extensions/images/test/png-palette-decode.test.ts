import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkit/testkit'
import type { RasterImageSource } from '@modkit/sdk'
import { crc32 } from '@modkit/codec-kit/checksum'
import { openImageCodec } from './codec-session.js'

const encoder = new TextEncoder()

function chunk(type: string, data = new Uint8Array()): Uint8Array {
  const name = encoder.encode(type)
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length, false)
  bytes.set(name, 4)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)), false)
  return bytes
}

function indexedPng(): Uint8Array {
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 2, false)
  view.setUint32(4, 1, false)
  ihdr[8] = 2
  ihdr[9] = 3
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('PLTE', Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255)),
    chunk('tRNS', Uint8Array.of(255, 128, 0, 255)),
    chunk('IDAT', deflateSync(Uint8Array.of(0, 0b00010000))),
    chunk('IEND'),
  ]
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

describe('PNG indexed-colour raster decode', () => {
  it('expands packed palette indexes and tRNS alpha into RGBA8', async () => {
    const session = await openImageCodec('png/codec.js', indexedPng())
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    try {
      const raster = lease.value as RasterImageSource
      expect(await raster.info()).toMatchObject({
        width: 2,
        height: 1,
        bitDepth: 2,
        decodedAccess: true,
        alphaMode: 'straight',
      })
      if (raster.readRegion === undefined) throw new Error('indexed PNG has no region reader')
      const region = await raster.readRegion({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        pixelFormat: 'rgba8',
        maxBytes: 8,
      })
      expect([...region.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 128])
      proves({
        contributionId: 'modkit/image-png',
        operation: 'read',
        note: 'packed indexed PNG samples and their palette transparency decode to exact RGBA8',
      })
    } finally {
      await lease.release()
      await session.dispose()
    }
  })
})
