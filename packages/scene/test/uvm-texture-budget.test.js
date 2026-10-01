import assert from 'node:assert/strict'
import { it } from 'node:test'
import { acquireUvmMaterialTextures } from '../src/uvm/materials.js'

// A 4×4 image the host hands back at mip 1 (2×2) because that is what fits.
function reduced() {
  return {
    state: 'decoded',
    diagnostics: [],
    info: {
      width: 4,
      height: 4,
      depth: 1,
      layers: 1,
      faces: 1,
      frames: 1,
      mipLevels: 3,
      orientation: 'top-left',
      alphaMode: 'straight',
      channelLayout: 'rgba',
      decodedAccess: true,
    },
    subresource: { frame: 0, mipLevel: 1, layer: 0, face: 0, slice: 0 },
    region: {
      width: 2,
      height: 2,
      rowStride: 8,
      pixelFormat: 'rgba8',
      pixels: new Uint8Array(16).fill(200),
    },
  }
}

it('asks each texture for its share as the most detailed level that fits, and says when it shrank', async () => {
  const requests = []
  const diagnostics = []
  const acquired = await acquireUvmMaterialTextures(
    new Map([
      ['a', ['one.dds', 'two.dds']],
      ['b', ['three.dds']],
    ]),
    {
      async read(request) {
        requests.push(request)
        return reduced()
      },
    },
    24 * 1024 * 1024,
    diagnostics,
  )
  // three textures share 24 MiB: 8 MiB each, the host picks the level
  assert.deepEqual(
    requests.map(request => [request.maxBytes, request.selection]),
    Array.from({ length: 3 }, () => [8 * 1024 * 1024, { face: 'all', mipLevel: 'fit' }]),
  )
  assert.equal(acquired.textures.length, 3)
  assert.deepEqual(
    acquired.textures.map(texture => [texture.width, texture.height, texture.rgba.length]),
    Array.from({ length: 3 }, () => [2, 2, 16]),
  )
  assert.deepEqual(
    diagnostics.map(item => item.code),
    Array.from({ length: 3 }, () => 'common.uvm/material-image-reduced'),
  )
})
