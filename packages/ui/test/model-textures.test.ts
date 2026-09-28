import { describe, expect, it } from 'vitest'
import { resolveModelViewerTextures } from '../src/model/index.js'

/*
 * A 4096² texture at mip 0 is 64 MiB — the whole budget of a model's maps; a BAR unit's other
 * textures were left out. Each texture now gets its share and the most detailed mip that fits.
 */
describe('model viewer textures', () => {
  it('asks each texture for the most detailed mip that fits its share, and takes that mip', async () => {
    const requests: { maxBytes: number; selection?: unknown }[] = []
    const textures = await resolveModelViewerTextures(
      {
        async read(request) {
          requests.push(request)
          // an 8×8 image the host answers at mip 2
          return {
            state: 'decoded-surfaces',
            info: {
              width: 8,
              height: 8,
              depth: 1,
              layers: 1,
              faces: 1,
              mipLevels: 4,
              frames: 1,
              channels: 4,
              bitDepth: 8,
              colorSpace: 'srgb',
              alphaMode: 'straight',
              orientation: 'top-left',
              decodedAccess: true,
            },
            surfaces: [
              {
                subresource: { frame: 0, mipLevel: 2, layer: 0, face: 0, slice: 0 },
                region: {
                  x: 0,
                  y: 0,
                  width: 2,
                  height: 2,
                  rowStride: 8,
                  pixelFormat: 'rgba8',
                  pixels: new Uint8Array(16).fill(7),
                },
              },
            ],
            diagnostics: [],
          }
        },
      },
      [
        { id: 'Unit_color.dds', role: 'texture', provenance: 'companion' },
        { id: 'Unit_normal.dds', role: 'texture', provenance: 'companion' },
      ],
    )
    // two textures share 64 MiB: 32 MiB each, whatever the first one's full size
    expect(requests.map(request => request.maxBytes)).toEqual([32 * 1024 * 1024, 32 * 1024 * 1024])
    expect(requests[0]?.selection).toEqual({ face: 'all', mipLevel: 'fit' })
    expect(textures.get('Unit_normal.dds')).toMatchObject({ width: 2, height: 2 })
    expect(textures.size).toBe(2)
  })
})
