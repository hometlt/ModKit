import { describe, expect, it } from 'vitest'
import { decodeGlCompressed, gpuBlockLayoutFromGl } from '../src/texture/gl-compressed.js'

describe('GL compressed formats', () => {
  it('maps internal formats to block layouts, ASTC by footprint, nothing for plain RGBA', () => {
    expect(gpuBlockLayoutFromGl(0x9274)).toMatchObject({ kind: 'etc2', blockBytes: 8 })
    expect(gpuBlockLayoutFromGl(0x93b7)).toMatchObject({
      kind: 'astc',
      blockWidth: 8,
      blockHeight: 8,
    })
    expect(gpuBlockLayoutFromGl(0x8058)).toBeNull()
  })

  it('decodes a BC1 level inline', async () => {
    // one DXT1 block: colour0 = white, colour1 = black, every index 0 -> white
    const block = Uint8Array.of(0xff, 0xff, 0x00, 0x00, 0, 0, 0, 0)
    const image = await decodeGlCompressed(block, 0x83f1, 4, 4)
    expect([...image.pixels.subarray(0, 4)]).toEqual([255, 255, 255, 255])
  })

  it('decodes an ETC1 level through the Texture2DDecoder runtime', async () => {
    const image = await decodeGlCompressed(new Uint8Array(8), 0x8d64, 4, 4)
    expect(image.pixels.byteLength).toBe(64)
  })
})
