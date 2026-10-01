import assert from 'node:assert/strict'
import { it } from 'node:test'
import { acquireUvmMaterialTextures } from '../src/uvm/materials.js'
import { sceneTextureBytes } from '../src/textures/cube.js'

const resources = new Map([
  ['a', ['cube.dds']],
  ['b', ['cube.dds']],
])

// Each face has two padded, bottom-up rows. Alpha is a material data channel.
function decodedCube() {
  return {
    state: 'decoded-surfaces',
    diagnostics: [],
    info: {
      width: 2,
      height: 2,
      depth: 1,
      layers: 1,
      faces: 6,
      frames: 1,
      mipLevels: 1,
      orientation: 'bottom-left',
      alphaMode: 'premultiplied',
      channelLayout: 'rgba',
      compression: 'bc3',
      decodedAccess: true,
    },
    surfaces: Array.from({ length: 6 }, (_, face) => ({
      subresource: { frame: 0, mipLevel: 0, layer: 0, face, slice: 0 },
      region: {
        width: 2,
        height: 2,
        rowStride: 12,
        pixelFormat: 'rgba8',
        pixels: Uint8Array.of(
          face,
          30,
          40,
          50,
          face,
          31,
          41,
          51,
          99,
          99,
          99,
          99,
          face,
          10,
          20,
          0,
          face,
          11,
          21,
          128,
        ),
      },
    })),
  }
}

it('acquires shared cube faces once, owns canonical rows and preserves raw data channels', async () => {
  const input = decodedCube(),
    diagnostics = []
  let reads = 0
  const acquired = await acquireUvmMaterialTextures(
    resources,
    {
      async read(request) {
        reads++
        assert.equal(request.kind, 'logical')
        assert.equal(request.requirement.logicalId, 'cube.dds')
        // the most detailed level that fits its share of the budget
        assert.deepEqual(request.selection, { face: 'all', mipLevel: 'fit' })
        assert.equal(request.maxBytes, 96)
        return input
      },
    },
    96,
    diagnostics,
  )
  assert.equal(reads, 1)
  assert.deepEqual(diagnostics, [])
  assert.equal(acquired.textures.length, 1)
  const texture = acquired.textures[0]
  assert.equal(texture.dimension, 'cube')
  assert.equal(texture.channelLayout, 'rgba')
  assert.equal(texture.compression, 'bc3')
  assert.equal(sceneTextureBytes(texture), 96)
  assert.deepEqual(acquired.bindings('a'), acquired.bindings('b'))
  for (let face = 0; face < 6; face++) {
    input.surfaces[face].region.pixels.fill(255)
    assert.deepEqual(
      texture.rgba.slice(face * 16, (face + 1) * 16),
      Uint8Array.of(face, 10, 20, 0, face, 11, 21, 128, face, 30, 40, 50, face, 31, 41, 51),
    )
  }
})

for (const [name, mutate] of [
  ['missing face', input => input.surfaces.pop()],
  ['reordered faces', input => input.surfaces.reverse()],
  [
    'wrong mip',
    input => {
      input.surfaces[2].subresource.mipLevel = 1
    },
  ],
  [
    'wrong layer',
    input => {
      input.surfaces[2].subresource.layer = 1
    },
  ],
  [
    'truncated last face',
    input => {
      input.surfaces[5].region.pixels = new Uint8Array(3)
    },
  ],
  [
    'nonsquare faces',
    input => {
      input.info.width = 3
    },
  ],
  [
    'unknown face layout',
    input => {
      input.info.faces = 3
    },
  ],
]) {
  it(`refuses a ${name} without publishing a partial cube or material binding`, async () => {
    const input = decodedCube(),
      diagnostics = []
    mutate(input)
    const acquired = await acquireUvmMaterialTextures(
      resources,
      { read: async () => input },
      1024,
      diagnostics,
    )
    assert.deepEqual(acquired.textures, [])
    assert.deepEqual(acquired.bindings('a'), [])
    assert.deepEqual(
      diagnostics.map(item => item.code),
      ['common.uvm/material-image-unrendered'],
    )
  })
}

it('charges all faces against one image budget and retains explicit non-cube selection diagnostics', async () => {
  const diagnostics = [],
    input = decodedCube()
  const refused = await acquireUvmMaterialTextures(
    resources,
    { read: async () => input },
    95,
    diagnostics,
  )
  assert.deepEqual(refused.textures, [])
  assert.match(diagnostics[0].message, /budget/)
  input.info.layers = 2
  const acceptedDiagnostics = []
  const accepted = await acquireUvmMaterialTextures(
    resources,
    { read: async () => input },
    96,
    acceptedDiagnostics,
  )
  assert.equal(accepted.textures[0].dimension, 'cube')
  assert.deepEqual(
    acceptedDiagnostics.map(item => item.code),
    ['common.uvm/material-image-first-surface'],
  )
  assert.match(acceptedDiagnostics[0].message, /layer 0/)
})

it('keeps the existing single decoded image port compatible for one-face material images', async () => {
  const cube = decodedCube(),
    diagnostics = []
  const input = {
    state: 'decoded',
    info: { ...cube.info, faces: 1 },
    region: cube.surfaces[0].region,
    diagnostics: [],
  }
  const acquired = await acquireUvmMaterialTextures(
    resources,
    { read: async () => input },
    16,
    diagnostics,
  )
  assert.deepEqual(diagnostics, [])
  assert.equal(acquired.textures[0].dimension, undefined)
  assert.equal(sceneTextureBytes(acquired.textures[0]), 16)
})

it('requires complete packed cube storage at the scene boundary', () => {
  const base = { id: 'cube', width: 2, height: 2, dimension: 'cube', rgba: new Uint8Array(96) }
  assert.equal(sceneTextureBytes(base), 96)
  for (const change of [
    { rgba: new Uint8Array(16) },
    { rgba: new Uint8Array(97) },
    { width: 1 },
    { height: 0 },
    { dimension: 'volume' },
    { dimension: '2d' },
  ])
    assert.throws(() => sceneTextureBytes({ ...base, ...change }), TypeError)
})
