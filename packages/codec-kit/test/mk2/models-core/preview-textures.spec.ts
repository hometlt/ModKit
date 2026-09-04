import { describe, expect, it, vi } from 'vitest'
import {
  resolveModelPreviewTextures,
  type PreviewTextureAssetResolver,
  type PreviewTextureDecoder,
} from '../../../src/legacy/models/preview-textures.js'

const decoder: PreviewTextureDecoder = async bytes => ({
  width: 1,
  height: 1,
  rgba: bytes,
  normalMapFormat: 'rgb8',
})

function resolver(bytes: Uint8Array): PreviewTextureAssetResolver {
  return {
    read: request => ({ path: request.path, bytes, source: { path: request.path } }),
  }
}

describe('resolveModelPreviewTextures', () => {
  it('keeps binary pixels and enforces the aggregate decode budget', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 255])
    const [decoded] = await resolveModelPreviewTextures(resolver(bytes), ['pixel.tga'], decoder, {
      binaryPixels: true,
      maxDecodedBytes: 4,
    })
    expect(decoded?.rgba).toBeInstanceOf(Uint8Array)

    const [overBudget] = await resolveModelPreviewTextures(
      resolver(bytes),
      ['pixel.tga'],
      decoder,
      { binaryPixels: true, maxDecodedBytes: 3 },
    )
    expect(overBudget).toMatchObject({ status: 'unsupported' })
    expect(overBudget).not.toHaveProperty('rgba')
  })

  it('reports progressive completion while a stalled read reaches its timeout', async () => {
    vi.useFakeTimers()
    try {
      const observed: string[] = []
      const source = resolver(Uint8Array.from([1, 2, 3, 255]))
      const mixed: PreviewTextureAssetResolver = {
        read: request =>
          request.path === 'fast.tga' ? source.read(request) : new Promise(() => {}),
      }
      const loading = resolveModelPreviewTextures(mixed, ['fast.tga', 'slow.dds'], decoder, {
        readTimeoutMs: 10,
        concurrency: 2,
        onTexture: texture => observed.push(texture.path),
      })
      await vi.advanceTimersByTimeAsync(10)
      expect((await loading).map(texture => texture.status)).toEqual(['decoded', 'error'])
      expect(observed[0]).toBe('fast.tga')
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves a compressed-only texture in binary and JSON-safe transport forms', async () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index)
    const compressedOnly: PreviewTextureDecoder = async payload => ({
      width: 4,
      height: 4,
      normalMapFormat: 'rgb8',
      compressedTexture: {
        schemaVersion: 1,
        format: 'astc-rgba-unorm',
        dimensions: { width: 4, height: 4, depth: 1 },
        mipLevelCount: 1,
        layerCount: 1,
        faceCount: 1,
        colorSpace: 'linear',
        alphaMode: 'straight',
        block: { width: 4, height: 4, depth: 1, bytes: 16 },
        subresources: [
          {
            mipLevel: 0,
            layer: 0,
            face: 0,
            depthSlice: 0,
            width: 4,
            height: 4,
            depth: 1,
            data: payload,
          },
        ],
        source: {
          codecId: 'org.modkitx.common/images.astc',
          containerFormat: 'astc',
          preservation: 'source-bytes',
        },
      },
    })

    const [binary] = await resolveModelPreviewTextures(
      resolver(bytes),
      ['texture.astc'],
      compressedOnly,
      { binaryPixels: true, maxDecodedBytes: 16 },
    )
    expect(binary).toMatchObject({ status: 'decoded', width: 4, height: 4 })
    expect(binary).not.toHaveProperty('rgba')
    expect(binary?.compressedTexture?.subresources[0]?.data).toBeInstanceOf(Uint8Array)

    const [jsonSafe] = await resolveModelPreviewTextures(
      resolver(bytes),
      ['texture.astc'],
      compressedOnly,
    )
    expect(Array.isArray(jsonSafe?.compressedTexture?.subresources[0]?.data)).toBe(true)

    const [overBudget] = await resolveModelPreviewTextures(
      resolver(bytes),
      ['texture.astc'],
      compressedOnly,
      { maxDecodedBytes: 15 },
    )
    expect(overBudget).toMatchObject({ status: 'unsupported' })
    expect(overBudget).not.toHaveProperty('compressedTexture')
  })
})
