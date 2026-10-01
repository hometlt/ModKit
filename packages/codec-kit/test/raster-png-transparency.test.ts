import { describe, expect, it } from 'vitest'
import { crc32Range } from '../src/checksum/index.js'
import { compressPortable } from '../src/compression/bounded.js'
import { decodePngSamples } from '../src/raster/index.js'

/** One PNG from unfiltered rows: `rows` are each row's bytes, `extra` chunks go before IDAT. */
async function png(
  width: number,
  depth: number,
  colourType: number,
  rows: number[][],
  extra: [string, number[]][] = [],
) {
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
  new DataView(header.buffer).setUint32(4, rows.length)
  header[8] = depth
  header[9] = colourType
  const raw = Uint8Array.from(rows.flatMap(row => [0, ...row]))
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    ...extra.map(([type, data]) => chunk(type, Uint8Array.from(data))),
    chunk('IDAT', await compressPortable(raw, 'deflate')),
    chunk('IEND', new Uint8Array()),
  ]
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  parts.reduce((offset, part) => (bytes.set(part, offset), offset + part.byteLength), 0)
  return bytes
}

describe('PNG tRNS of grey and RGB images', () => {
  it('names the transparent grey in sample terms, sub-byte grey scaled', async () => {
    // 2-bit grey 0,1,2,3; tRNS says 2 is transparent
    const image = await decodePngSamples(await png(4, 2, 0, [[0b00011011]], [['tRNS', [0, 2]]]))
    expect([...image.samples]).toEqual([0, 85, 170, 255])
    expect(image.transparent).toEqual([170])
  })

  it('names the transparent RGB of a 16-bit image', async () => {
    const image = await decodePngSamples(
      await png(
        1,
        16,
        2,
        [[0x12, 0x34, 0, 0, 0xff, 0xff]],
        [['tRNS', [0x12, 0x34, 0, 0, 0xff, 0xff]]],
      ),
    )
    expect(image.bitDepth).toBe(16)
    expect([...image.samples]).toEqual([0x1234, 0, 0xffff])
    expect(image.transparent).toEqual([0x1234, 0, 0xffff])
  })

  it('has no transparent colour without tRNS', async () => {
    expect((await decodePngSamples(await png(1, 8, 0, [[7]]))).transparent).toBeUndefined()
  })
})
