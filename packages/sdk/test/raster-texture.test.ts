import { expect, it } from 'vitest'
import { rasterResourceTexture, type RasterResourceResult } from '../src/raster-resources.js'

/** Distinct padded rows make face order, row stride and vertical orientation observable. */
export function cubeReply(): Extract<RasterResourceResult, { state: 'decoded-surfaces' }> {
  return {
    state: 'decoded-surfaces', diagnostics: [],
    info: { width: 2, height: 2, depth: 1, layers: 1, faces: 6, mipLevels: 2, frames: 1,
      channels: 4, bitDepth: 8, colorSpace: 'linear', alphaMode: 'straight', orientation: 'bottom-left', decodedAccess: true },
    surfaces: Array.from({ length: 6 }, (_, face) => ({
      subresource: { frame: 0, mipLevel: 1, layer: 0, face, slice: 0 },
      region: { x: 0, y: 0, width: 2, height: 2, pixelFormat: 'rgba8', rowStride: 12,
        pixels: Uint8Array.from([face + 1, 0, 0, 255, face + 1, 0, 0, 255, 99, 99, 99, 99,
          face + 11, 0, 0, 255, face + 11, 0, 0, 255]) },
    })),
  }
}

it('owns six ordered cube faces, removes row padding and normalizes row orientation', () => {
  const source = cubeReply(), texture = rasterResourceTexture('cube', source, 96)!
  expect(texture.dimension).toBe('cube')
  expect(texture.rgba.length).toBe(96)
  for (let face = 0; face < 6; face++) {
    expect([...texture.rgba.subarray(face * 16, face * 16 + 4)]).toEqual([face + 11, 0, 0, 255])
    expect(texture.rgba[face * 16 + 8]).toBe(face + 1)
  }
  source.surfaces[0]!.region.pixels.fill(0)
  expect(texture.rgba[0]).toBe(11)
})

it('refuses partial, repeated, differently sized/mipped and over-budget cubes', () => {
  const source = cubeReply()
  expect(rasterResourceTexture('cube', source, 95)).toBeUndefined()
  expect(rasterResourceTexture('cube', { ...source, surfaces: source.surfaces.slice(0, 1) }, 96)).toBeUndefined()
  for (const replacement of [
    { ...source.surfaces[1]!, subresource: source.surfaces[0]!.subresource },
    { ...source.surfaces[1]!, subresource: { ...source.surfaces[1]!.subresource, mipLevel: 0 } },
    { ...source.surfaces[1]!, region: { ...source.surfaces[1]!.region, width: 1 } },
    { ...source.surfaces[1]!, region: { ...source.surfaces[1]!.region, pixels: new Uint8Array(19) } },
  ]) {
    expect(rasterResourceTexture('cube', { ...source, surfaces: [source.surfaces[0]!, replacement, ...source.surfaces.slice(2)] }, 96)).toBeUndefined()
  }
  expect(rasterResourceTexture('cube', { ...source, info: { ...source.info, orientation: 'unknown' } }, 96)).toBeUndefined()
})

it('retains a 2D reply and refuses presenting one selected cube face as a 2D image', () => {
  const cube = cubeReply(), first = cube.surfaces[0]!
  const reply = { state: 'decoded' as const, info: cube.info, region: first.region,
    subresource: first.subresource, diagnostics: [] }
  expect(rasterResourceTexture('single', reply, 16)).toBeUndefined()
  expect(rasterResourceTexture('single', { ...reply, info: { ...cube.info, faces: 1 } }, 16)?.dimension).toBeUndefined()
  expect(rasterResourceTexture('single', { ...reply, info: { ...cube.info, faces: 1 } }, 16)?.rgba[0]).toBe(11)
})
