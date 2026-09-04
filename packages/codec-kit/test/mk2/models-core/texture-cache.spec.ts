import { describe, expect, it } from 'vitest'
import { TextureCache, normalizeTexturePath } from '../../../src/legacy/models/texture-cache.js'
import type { DecodedTexture, TextureDecodeResult } from '../../../src/legacy/models/texture-codec.js'

function ok(rgba: number[]): TextureDecodeResult {
  const texture: DecodedTexture = {
    width: 1,
    height: 1,
    rgba: Uint8Array.from(rgba),
    format: 'rgba8',
    normalMapFormat: 'rgb8',
  }
  return { ok: true, texture }
}

describe('texture cache', () => {
  it('keys by full normalized path — basenames do not collide', async () => {
    const cache = new TextureCache(bytes => ok([...bytes]))
    const red = new Uint8Array([255, 0, 0, 255])
    const blue = new Uint8Array([0, 0, 255, 255])

    const a = await cache.getOrDecode('Assets\\UnitA\\diffuse.dds', () => red)
    const b = await cache.getOrDecode('Assets\\UnitB\\diffuse.dds', () => blue)
    expect(cache.size).toBe(2)
    expect(a.ok && [...a.texture.rgba.slice(0, 3)]).toEqual([255, 0, 0])
    expect(b.ok && [...b.texture.rgba.slice(0, 3)]).toEqual([0, 0, 255])
  })

  it('decodes once per path regardless of separators and case', async () => {
    const cache = new TextureCache(bytes => ok([...bytes]))
    const dds = new Uint8Array([9, 9, 9, 255])
    let loads = 0
    const load = () => {
      loads += 1
      return dds
    }
    await cache.getOrDecode('Assets\\Textures\\A.dds', load)
    await cache.getOrDecode('assets/textures/a.dds', load)
    expect(loads).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('caches read failures and lists them as diagnostics', async () => {
    const cache = new TextureCache(bytes => ok([...bytes]))
    let attempts = 0
    const failingLoad = () => {
      attempts += 1
      throw new Error('file not found')
    }
    const first = await cache.getOrDecode('missing.dds', failingLoad)
    const second = await cache.getOrDecode('missing.dds', failingLoad)
    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    expect(attempts).toBe(1)
    const diagnostics = await cache.diagnostics()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.diagnostic.code).toBe('texture-read-failed')
  })
})

describe('normalizeTexturePath', () => {
  it('lowercases and unifies separators', () => {
    expect(normalizeTexturePath('Assets\\Textures\\\\A.DDS')).toBe('assets/textures/a.dds')
  })
})
