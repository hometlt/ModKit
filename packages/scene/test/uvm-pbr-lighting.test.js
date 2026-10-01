import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { prepareUvmRender } from '../src/uvm/render.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const uvm = materials =>
  materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: materials.length,
        materials: materials.length,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: materials.map((_, index) => `tri-${index}`) }],
      primitives: materials.map((_, index) => ({
        id: `tri-${index}`,
        topology: 'triangles',
        materialId: String(index),
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      })),
      materials: materials.map((material, index) => ({ id: String(index), ...material })),
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:pbr',
      options: { assetId: 'fixture/pbr', sourceFormat: 'test' },
    },
  ).bytes
const budget = {
  maxInputBytes: 64000000n,
  maxScalarBytes: 64000000,
  maxNodes: 100000,
  maxDepth: 96,
  maxDiagnostics: 100,
}
const request = lighting => ({
  schemaVersion: 1,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity, viewMatrix: identity },
  ...(lighting === undefined ? {} : { lighting }),
})

it('lights glTF materials with their own metallic-roughness when asked (П11)', async () => {
  const bytes = uvm([{ emissiveFactor: [0.5, 0, 0] }, { unlit: true }])
  const lit = await prepareUvmRender(bytes, request('material'), { budget })
  const [surface, flat] = lit.request.scene.materials
  assert.equal(surface.shading, 'pbr')
  // the materializer's own defaults: a rough dielectric
  assert.deepEqual(surface.pbr, { metallic: 0, roughness: 1, emissive: [0.5, 0, 0] })
  assert.equal(flat.shading, 'unlit')
  // asked for nothing, the look stays flat
  const plain = await prepareUvmRender(bytes, request(undefined), { budget })
  assert.equal(plain.request.scene.materials[0].shading, 'unlit')
  await assert.rejects(prepareUvmRender(bytes, request('lambert'), { budget }), /lighting/u)
})
