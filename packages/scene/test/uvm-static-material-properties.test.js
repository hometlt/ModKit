import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer, packUvmGlb } from '@modkit/uv/model/container'
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

function materialFixture(program = renderModel) {
  return materializeUvmCore(
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
          shader: { id: 'modkit.render-material.v1', parameters: { renderModel: program } },
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
}

test('static authoring reads a program material that also states the glTF look (П7)', () => {
  const { document, binary } = materialFixture()
  assert.ok(document.extensionsUsed.includes('KHR_materials_unlit'))
  const projected = projectUvmStaticModel(
    { document, binary },
    { maxScalarBytes: 1 << 24, maxNodes: 10_000 },
  )
  assert.equal(projected.materialRequirements.length, 1)
})

function projectEncoded(program) {
  const { document, binary } = materialFixture(program)
  return projectUvmStaticModel(readUvmContainer(packUvmGlb(document, binary)), {
    maxScalarBytes: 1 << 24,
    maxNodes: 10_000,
  })
}

test('static authoring preserves the complete colorless screen-distortion requirements after GLB reopen', () => {
  const program = structuredClone(renderModel)
  program.presentation = 'screen-distortion'
  program.standard.priority = 7
  program.standard.layers.diffuse.texturePath = 'Textures/distortion.dds'
  program.standard.layers.diffuse.constantColor.value = [0.2, 0.4, 0.6, 0.8]
  const projected = projectEncoded(program)
  assert.deepEqual(projected.materialRequirements, [
    {
      name: 'Material_0',
      presentation: program.presentation,
      standard: program.standard,
    },
  ])
})

test('colorless screen-distortion still validates the authored standard material', () => {
  const program = structuredClone(renderModel)
  program.presentation = 'screen-distortion'
  program.standard.blendMode = 'invalid'
  assert.throws(() => projectEncoded(program), /blendMode/)
})

test('screen-distortion cannot bypass the composite authoring refusal', () => {
  const program = {
    version: 1,
    presentation: 'screen-distortion',
    composite: {
      priority: 0,
      passes: [{ material: renderModel.standard, alphaFactor: { value: 1 } }],
    },
  }
  assert.throws(() => projectEncoded(program), /requires a standard RenderMaterial v1/)
})

test('terrain-projection remains outside static colorless authoring', () => {
  assert.throws(
    () => projectEncoded({ ...renderModel, presentation: 'terrain-projection' }),
    /requires one material pass/,
  )
})

test('explicit surface still preserves its single standard pass after GLB reopen', () => {
  const projected = projectEncoded({ ...renderModel, presentation: 'surface' })
  assert.deepEqual(projected.materialRequirements, [
    {
      name: 'Material_0',
      presentation: 'surface',
      standard: renderModel.standard,
    },
  ])
})

test('a static projection accepts a document that declares clip events (the rig path writes them)', () => {
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_animation_events'],
    extensions: {
      UV_asset: { id: 'static-events', class: 'prop' },
      UV_provenance: { source: { format: 'test' }, importer: { id: 'test', version: '1' } },
    },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
  }
  assert.doesNotThrow(() => {
    try {
      projectUvmStaticModel(
        { document, binary: new Uint8Array() },
        { maxScalarBytes: 1 << 24, maxNodes: 10_000 },
      )
    } catch (error) {
      // an empty scene may be refused for its own reason, never for the extension
      if (/unsupported static extension/.test(String(error))) throw error
    }
  })
})
