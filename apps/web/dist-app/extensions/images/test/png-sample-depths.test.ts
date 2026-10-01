import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32 } from '@modkit/codec-kit/checksum'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'

/** A PNG from unfiltered rows, as the shared decoder reads every depth. */
function png(width: number, depth: number, colourType: number, rows: number[][]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(12 + data.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, data.length, false)
    bytes.set(new TextEncoder().encode(type), 4)
    bytes.set(data, 8)
    view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)), false)
    return bytes
  }
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width, false)
  new DataView(header.buffer).setUint32(4, rows.length, false)
  header[8] = depth
  header[9] = colourType
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    // node:zlib only compresses the fixture input
    chunk('IDAT', deflateSync(Uint8Array.from(rows.flatMap(row => [0, ...row])))),
    chunk('IEND', new Uint8Array()),
  ]
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  parts.reduce((offset, part) => (output.set(part, offset), offset + part.length), 0)
  return output
}

async function pixels(bytes: Uint8Array, width: number) {
  const session = await openImageCodec('png/codec.js', bytes)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  try {
    const raster = lease.value as RasterImageSource
    expect((await raster.info()).decodedAccess).toBe(true)
    const region = await raster.readRegion!({
      x: 0,
      y: 0,
      width,
      height: 1,
      pixelFormat: 'rgba8',
      maxBytes: width * 4,
    })
    return [...region.pixels]
  } finally {
    await lease.release()
    await session.dispose()
  }
}

describe('PNG pixels of every depth the shared decoder reads', () => {
  it('reads sub-byte grey scaled to eight bits', async () => {
    expect(await pixels(png(4, 2, 0, [[0b00011011]]), 4)).toEqual([
      0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255,
    ])
    expect(await pixels(png(2, 1, 0, [[0b10000000]]), 2)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255,
    ])
  })

  it('reads 16-bit RGB at its high byte', async () => {
    expect(await pixels(png(1, 16, 2, [[0x12, 0x34, 0, 0, 0xff, 0xff]]), 1)).toEqual([
      0x12, 0, 0xff, 255,
    ])
  })
})
