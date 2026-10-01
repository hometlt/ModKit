import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { uvmImageFilters } from '../src/uvm/images.js'
import { acquireUvmMaterialTextures } from '../src/uvm/materials.js'
import { presentWorldModelTextures } from '../src/world/color-keys.js'

// A block whose texture the publisher samples nearest, as Minecraft does (MC1).
function blockUvm() {
  return materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 2,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'block',
          childIds: [],
          meshIds: ['mesh'],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          materialId: '0',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
          indices: Uint32Array.from([0, 1, 2]),
        },
      ],
      materials: [{ id: '0', layers: [{ slot: 'diffuse', resourceId: 'grass.png' }] }],
      resourceClosure: {
        mode: 'logical',
        entries: [
          { role: 'image', logicalId: 'grass.png', filter: 'nearest' },
          { role: 'image', logicalId: 'stone.png' },
        ],
      },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:texture-filter',
      options: { assetId: 'fixture/texture-filter', sourceFormat: 'json' },
    },
  )
}
const texel = id => ({ id, width: 1, height: 1, rgba: Uint8Array.of(0, 255, 0, 255) })

test('a texture keeps the filter its sampler states, on every route to the renderer (MC1)', async () => {
  const { bytes } = blockUvm()
  const { document } = readUvmContainer(bytes, {
    maxInputBytes: bytes.byteLength,
    maxJsonBytes: bytes.byteLength,
    maxDepth: 128,
    maxNodes: 100_000,
  })
  assert.deepEqual([...uvmImageFilters(document)], [['grass.png', 'nearest']])

  // a material program's layer texture, acquired by its logical id
  const acquired = await acquireUvmMaterialTextures(
    new Map([['0', ['grass.png']]]),
    {
      async read() {
        return {
          state: 'decoded',
          diagnostics: [],
          info: {
            width: 1,
            height: 1,
            depth: 1,
            layers: 1,
            faces: 1,
            frames: 1,
            mipLevels: 1,
            orientation: 'top-left',
            alphaMode: 'straight',
            channelLayout: 'rgba',
            decodedAccess: true,
          },
          subresource: { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 },
          region: {
            width: 1,
            height: 1,
            rowStride: 4,
            pixelFormat: 'rgba8',
            pixels: texel('x').rgba,
          },
        }
      },
    },
    1 << 20,
    [],
    undefined,
    uvmImageFilters(document),
  )
  assert.equal(acquired.textures[0]?.filter, 'nearest')

  // a map object's model, as its textures enter the world
  const presented = presentWorldModelTextures({
    state: 'converted',
    sourceKey: 'block',
    complete: true,
    uvmBytes: bytes,
    diagnostics: [],
    textures: [texel('grass.png'), texel('stone.png')],
  })
  assert.deepEqual(
    presented.textures.map(texture => texture.filter),
    ['nearest', undefined],
  )
})
