import { describe, expect, it } from 'vitest'
import { computePeaks, loadModelStage } from '@modkitx-x3/ui'
import { collectEncodedMedia } from '../src/media/encoded.js'
import type { EncodedMediaSource, ModelSceneSource } from '@modkitx-x3/sdk'

describe('format-neutral media viewer models', () => {
  it('collects chunked encoded media under a hard byte budget', async () => {
    const bytes = new TextEncoder().encode('portable-media')
    const source: EncodedMediaSource = {
      async descriptor() {
        return { mediaType: 'application/octet-stream', bytes: BigInt(bytes.byteLength) }
      },
      async read(offset, length) {
        const start = Number(offset)
        return bytes.slice(start, Math.min(start + Math.min(length, 3), bytes.byteLength))
      },
    }
    await expect(collectEncodedMedia(source, bytes.byteLength - 1)).rejects.toThrow(/budget/u)
    expect(await collectEncodedMedia(source, bytes.byteLength)).toEqual({
      mediaType: 'application/octet-stream',
      bytes,
    })
  })

  it('fails closed when an encoded source ends before its declared size', async () => {
    const source: EncodedMediaSource = {
      async descriptor() {
        return { mediaType: 'video/webm', bytes: 4n }
      },
      async read() {
        return new Uint8Array()
      },
    }
    await expect(collectEncodedMedia(source, 4)).rejects.toThrow(/declared size/u)
  })

  it('discovers every bounded primitive id, loads only the first, and preserves metadata-only scenes', async () => {
    let requestedBytes = 0
    const decoded: ModelSceneSource = {
      async info() {
        return {
          scenes: 1,
          nodes: 1,
          meshes: 1,
          primitives: 1,
          materials: 0,
          textures: 0,
          animations: 0,
          geometryAccess: 'decoded',
        }
      },
      async nodes() {
        return { items: [] }
      },
      async meshes(request) {
        return request.cursor === undefined
          ? {
              items: [{ id: 'mesh-a', primitiveIds: ['triangle', 'lines'] }],
              nextCursor: 'second',
            }
          : { items: [{ id: 'mesh-b', primitiveIds: ['points'] }] }
      },
      async primitive(_id, request) {
        requestedBytes = request.maxBytes
        return {
          id: 'triangle',
          topology: 'triangles',
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        }
      },
    }
    const loaded = await loadModelStage(decoded)
    expect(loaded.primitive?.id).toBe('triangle')
    expect(loaded.primitiveIds).toEqual(['triangle', 'lines', 'points'])
    expect(requestedBytes).toBeGreaterThan(0)

    const metadataOnly: ModelSceneSource = {
      async info() {
        return { ...(await decoded.info()), geometryAccess: 'metadata-only' }
      },
      nodes: decoded.nodes,
      meshes: decoded.meshes,
    }
    expect(await loadModelStage(metadataOnly)).not.toHaveProperty('primitive')
  })

  it('reduces PCM to bounded min/max peaks without retaining samples', () => {
    expect(computePeaks([new Float32Array([-1, -0.5, 0.5, 1])], 2)).toEqual(
      new Float32Array([-1, 0, 0, 1]),
    )
  })
})
