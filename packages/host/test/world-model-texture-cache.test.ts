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
  it('joins native aiming joints to reopened UVM by source ordinal and reports ambiguous identities', async () => {
    const current = asset([]) as any
    current.resourceReferences = async () => ({ items: [] })
    current.nodes = async () => ({ items: [{ id: 'projected/0', childIds: [] }, { id: 'projected/1', childIds: [] }] })
    current.skeletonBindings = async () => ({ items: [{ boneIndex: 0, sourceBoneIndex: 42, nodeId: 'projected/0' }] })
    current.nodeBehaviours = async () => ({ items: [{ id: 'head', name: 'Head', nodeId: 'bone/42',
      aim: { parts: [{ nodeId: 'bone/42', sourceBoneIndex: 42 }] } }] })
    const options = { requirement: { id: 'model', logicalId: 'model.m3', role: 'model', scopes: ['current-mount'] } } as never
    const first = await worldSceneModel(current, request as never, options)
    expect(first.state === 'converted' && first.nodeBehaviours?.[0]?.aim?.parts[0]?.nodeId).toBe('projected/0')
    current.skeletonBindings = async () => ({ items: [
      { boneIndex: 0, sourceBoneIndex: 42, nodeId: 'projected/0' },
      { boneIndex: 1, sourceBoneIndex: 42, nodeId: 'projected/1' },
    ] })
    const ambiguous = await worldSceneModel(current, request as never, options)
    expect(ambiguous.state === 'converted' && ambiguous.nodeBehaviours).toEqual([])
    expect(ambiguous.diagnostics.some(item => item.code === 'x3.host/model-aim-binding-unresolved')).toBe(true)
  })
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
    if (second.state !== 'converted') throw new Error('expected converted model')
    const pixels = second.textures![0]!.rgba
    structuredClone(second, { transfer: [pixels.buffer as ArrayBuffer] })
    expect(pixels.byteLength).toBe(0)
    const third = await worldSceneModel(asset(reads), request as never, options)
    expect(reads).toHaveLength(2) // Reuses decoded pixels after transferring the previous reply.
    expect(third.state === 'converted' && [...third.textures![0]!.rgba]).toEqual([9, 9, 9, 255])
  })
})
