import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { projectUvmStaticModel } from '../src/uvm/static-model.js'

const renderModel = {
  version: 1,
  standard: {
    layers: {
      diffuse: {
        slot: 'diffuse',
        texturePath: null,
        uvSource: 0,
        channels: 0,
        op: 6,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: false,
        wrapY: false,
        constantColor: { value: [1, 1, 1, 1] },
      },
    },
    blendMode: 0,
    priority: 0,
    specularity: 0,
    specMult: 0,
    emisMult: 0,
    environmentMultipliers: [1, 0, 0],
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: true,
    unshaded: true,
    depthPrepass: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
  },
}

test('static authoring reads a program material that also states the glTF look (П7)', () => {
  const { document, binary } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'body',
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
          indices: Uint32Array.from([0, 1, 2]),
        },
      ],
      materials: [
        {
          id: '0',
          unlit: true,
          doubleSided: true,
          baseColorFactor: [1, 1, 1, 0.5],
          emissiveFactor: [0.25, 0, 0],
          depthWrite: false,
          priority: 3,
          shader: { id: 'modkit.render-material.v1', parameters: { renderModel } },
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:static-unlit',
      options: { assetId: 'fixture/static-unlit', sourceFormat: 'json' },
    },
  )
  assert.ok(document.extensionsUsed.includes('KHR_materials_unlit'))
  const projected = projectUvmStaticModel(
    { document, binary },
    { maxScalarBytes: 1 << 24, maxNodes: 10_000 },
  )
  assert.equal(projected.materialRequirements.length, 1)
})
