import { expect, it } from 'vitest'
import { worldTexture } from '../src/maps/world-model.js'
import { compressedSelectionPlan } from '../src/raster-selection.js'
import type { RasterImageInfo } from '@modkit/sdk'

it('all-face acquisition keeps the compressed fast path for an ordinary 2D image only', () => {
  const info = { width: 4, height: 4, depth: 1, faces: 1, layers: 1, mipLevels: 1, compression: 'bc1' } as RasterImageInfo
  expect(compressedSelectionPlan(info, { face: 'all', mipLevel: 'fit' }, 8)).toEqual({ mipLevel: 0, bytes: 8 })
  expect(compressedSelectionPlan({ ...info, faces: 6 }, { face: 'all', mipLevel: 'fit' }, 48)).toBeUndefined()
})

it('world material textures retain all six decoded faces instead of face zero', () => {
  const info = { width: 1, height: 1, depth: 1, faces: 6, layers: 1, mipLevels: 1, orientation: 'top-left' } as RasterImageInfo
  const surfaces = Array.from({ length: 6 }, (_, face) => ({
    subresource: { frame: 0, mipLevel: 0, layer: 0, face, slice: 0 },
    region: { x: 0, y: 0, width: 1, height: 1, pixelFormat: 'rgba8' as const, rowStride: 4,
      pixels: Uint8Array.of(face + 1, 0, 0, 255) },
  }))
  const texture = worldTexture('environment', { state: 'decoded-surfaces', info, surfaces, diagnostics: [] })!
  expect(texture.dimension).toBe('cube')
  expect([...texture.rgba.filter((_, index) => index % 4 === 0)]).toEqual([1, 2, 3, 4, 5, 6])
  expect(worldTexture('partial', { state: 'decoded', info, ...surfaces[0]!, diagnostics: [] })).toBeUndefined()
})
