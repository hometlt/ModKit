import { describe, expect, it } from 'vitest'
import { worldSceneModel } from '../src/maps/world-model.js'

const request = {
  maxBytes: 1024,
  maxMeshes: 8,
  maxPrimitives: 8,
  maxPrimitiveBytes: 1024,
  maxTextureBytes: 256,
  maxTextureTotalBytes: 256,
}

/** A model with one texture reference whose first read is refused for its budget. */
function asset(reads: string[]) {
  const page =
    <T>(items: readonly T[]) =>
    async () => ({ items })
  return {
    result: { state: 'converted', bytes: Uint8Array.of(1), sourceKey: 'model', diagnostics: [] },
    meshes: page([]),
    resourceReferences: page([{ id: 'skin.png', role: 'texture', provenance: 'reference-only' }]),
    async acquire() {
      throw new Error('no nested models')
    },
    async readRaster() {
      reads.push('read')
      if (reads.length === 1)
        return {
          state: 'unresolved',
          diagnostics: [
            { severity: 'warning', code: 'x3.host/resource-budget-exceeded', message: 'budget' },
          ],
        }
      return {
        state: 'decoded',
        diagnostics: [],
        info: {
          width: 1,
          height: 1,
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
        },
        region: {
          width: 1,
          height: 1,
          rowStride: 4,
          pixelFormat: 'rgba8',
          pixels: Uint8Array.of(9, 9, 9, 255),
        },
      }
    },
  } as never
}

describe('world model textures', () => {
  it('reads a texture again after a refused read, not the refusal from the cache', async () => {
    const reads: string[] = []
    const textureCache = new Map()
    const options = {
      requirement: {
        id: 'model',
        logicalId: 'models/model.rbxm',
        role: 'model',
        scopes: ['current-mount'],
      },
      textureCache,
    } as never
    const first = await worldSceneModel(asset(reads), request as never, options)
    expect(first.state === 'converted' && first.textures).toEqual([])
    const second = await worldSceneModel(asset(reads), request as never, options)
    expect(reads).toHaveLength(2)
    expect(second.state === 'converted' && second.textures?.map(texture => texture.id)).toEqual([
      'skin.png',
    ])
  })
})
