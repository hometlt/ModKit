import assert from 'node:assert/strict'
import { it } from 'node:test'
import { decodeBcSurface } from '@modkit/codec-kit/texture/bc'

import {
  SCENE_COMPRESSED_TEXTURE_FORMATS,
  sceneTextureByteLength,
  sceneTexturePixels,
  uploadCompressedTexture,
  uploadCompressedTextureArray,
} from '../src/render/compressed-textures.js'

/** One DXT1 block: red and blue endpoints in the transparent two-colour mode, indices 0..3. */
const block = Uint8Array.from([0x1f, 0x00, 0x00, 0xf8, 0xe4, 0xe4, 0xe4, 0xe4])
const level = (size, data) => ({
  mipLevel: 0,
  layer: 0,
  face: 0,
  depthSlice: 0,
  width: size,
  height: size,
  depth: 1,
  data,
})
const texture = (levels, format = 'bc1-rgba-unorm') => ({
  id: 'tile',
  width: levels[0].width,
  height: levels[0].height,
  rgba: new Uint8Array(0),
  compressed: {
    schemaVersion: 1,
    format,
    dimensions: { width: levels[0].width, height: levels[0].height, depth: 1 },
    mipLevelCount: levels.length,
    layerCount: 1,
    faceCount: 1,
    colorSpace: 'unknown',
    alphaMode: 'unknown',
    block: { width: 4, height: 4, depth: 1, bytes: 8 },
    subresources: levels.map((item, mipLevel) => ({ ...item, mipLevel })),
    source: { codecId: 'dds', containerFormat: 'dds', preservation: 'source-bytes' },
  },
})

/** A WebGL2 stand-in that records the calls an upload makes. */
function recordingGl(s3tc) {
  const calls = []
  return {
    calls,
    TEXTURE_2D: 0x0de1,
    TEXTURE_BASE_LEVEL: 0x813c,
    TEXTURE_MAX_LEVEL: 0x813d,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    getExtension: name => (name === 'WEBGL_compressed_texture_s3tc' && s3tc ? {} : null),
    compressedTexImage2D: (...args) => calls.push(['compressedTexImage2D', ...args]),
    TEXTURE_2D_ARRAY: 0x8c1a,
    texStorage3D: (...args) => calls.push(['texStorage3D', ...args]),
    compressedTexSubImage3D: (...args) => calls.push(['compressedTexSubImage3D', ...args]),
    texParameteri: (...args) => calls.push(['texParameteri', ...args]),
    texParameterf: (...args) => calls.push(['texParameterf', ...args]),
  }
}

it('asks for S3TC only: the formats the GPU samples as the decoder decodes them', () => {
  assert.deepEqual(SCENE_COMPRESSED_TEXTURE_FORMATS, [
    'bc1-rgba-unorm',
    'bc2-rgba-unorm',
    'bc3-rgba-unorm',
  ])
})

it('decodes stored blocks once for what reads texels, and passes RGBA8 through', () => {
  const tile = texture([level(4, block)])
  const pixels = sceneTexturePixels(tile)
  assert.deepEqual(pixels, decodeBcSurface(block, 0, 4, 4, 'DXT1'))
  // Index 3 of a two-colour block is transparent black, as RGBA_DXT1 samples it.
  assert.deepEqual([...pixels.subarray(12, 16)], [0, 0, 0, 0])
  assert.equal(sceneTexturePixels(tile), pixels)
  const plain = { id: 'plain', width: 1, height: 1, rgba: Uint8Array.from([1, 2, 3, 4]) }
  assert.equal(sceneTexturePixels(plain), plain.rgba)
  assert.equal(sceneTextureByteLength(tile), 8)
  assert.equal(sceneTextureByteLength(plain), 4)
})

it('uploads every stored level as it is, with the mip range the file holds', () => {
  const gl = recordingGl(true)
  const chain = texture([level(8, new Uint8Array(32)), level(4, block), level(2, block)])
  assert.equal(uploadCompressedTexture(gl, chain, 'linear'), true)
  const uploads = gl.calls.filter(call => call[0] === 'compressedTexImage2D')
  assert.deepEqual(
    uploads.map(call => [call[2], call[3], call[4], call[5]]),
    [
      [0, 0x83f1, 8, 8],
      [1, 0x83f1, 4, 4],
      [2, 0x83f1, 2, 2],
    ],
  )
  assert.deepEqual(
    gl.calls.find(call => call[0] === 'texParameteri' && call[2] === gl.TEXTURE_MAX_LEVEL),
    ['texParameteri', gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 2],
  )
  assert.ok(
    gl.calls.some(
      call =>
        call[0] === 'texParameteri' &&
        call[2] === gl.TEXTURE_MIN_FILTER &&
        call[3] === gl.LINEAR_MIPMAP_LINEAR,
    ),
  )
})

it('leaves the texture to its texels where the context or the size cannot take the blocks', () => {
  const without = recordingGl(false)
  assert.equal(uploadCompressedTexture(without, texture([level(4, block)]), 'linear'), false)
  assert.deepEqual(without.calls, [])
  const odd = recordingGl(true)
  assert.equal(
    uploadCompressedTexture(odd, texture([level(6, new Uint8Array(32))]), 'linear'),
    false,
  )
  assert.deepEqual(odd.calls, [])
  const bc5 = recordingGl(true)
  assert.equal(
    uploadCompressedTexture(bc5, texture([level(4, block)], 'bc5-rg-unorm'), 'linear'),
    false,
  )
})

it('builds a layer array from every layer at the smallest size, level by level', () => {
  const gl = recordingGl(true)
  const blocks = size => new Uint8Array(Math.ceil(size / 4) ** 2 * 8)
  const large = texture([level(8, blocks(8)), level(4, blocks(4)), level(2, blocks(2))])
  const small = texture([level(4, blocks(4)), level(2, blocks(2)), level(1, blocks(1))])
  const array = uploadCompressedTextureArray(gl, [large, small], 'linear')
  assert.deepEqual(array, { width: 4, height: 4, bytes: 4 * 8 })
  assert.deepEqual(
    gl.calls.find(call => call[0] === 'texStorage3D'),
    ['texStorage3D', gl.TEXTURE_2D_ARRAY, 2, 0x83f1, 4, 4, 2],
  )
  assert.deepEqual(
    gl.calls
      .filter(call => call[0] === 'compressedTexSubImage3D')
      .map(call => [call[2], call[5], call[6], call[7]]),
    [
      [0, 0, 4, 4],
      [1, 0, 2, 2],
      [0, 1, 4, 4],
      [1, 1, 2, 2],
    ],
  )
  const none = recordingGl(true)
  assert.equal(uploadCompressedTextureArray(none, [large, undefined], 'linear'), undefined)
  assert.equal(
    uploadCompressedTextureArray(
      none,
      [large, texture([level(4, blocks(4))], 'bc3-rgba-unorm')],
      'linear',
    ),
    undefined,
  )
  assert.deepEqual(none.calls, [])
})
