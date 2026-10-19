import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer, uvmImageUri } from '@modkit/uv/model/container'
import { createUvmInspection } from '../src/uvm/inspection.js'

const limits = {
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 4_000_000,
  maxJsonBytes: 4_000_000,
}

/** Real materializer/reader roundtrip, with native identity distinct from external lookup. */
function fixture() {
  const { bytes } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 1,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'root',
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
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: Uint32Array.from([0, 1, 2]),
          materialId: 'material',
        },
      ],
      materials: [{ id: 'material', layers: [{ slot: 'albedo', resourceId: 'native texture' }] }],
      resourceClosure: {
        mode: 'logical',
        entries: [{ role: 'texture', logicalId: 'native texture' }],
      },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:fixture',
      options: { assetId: 'fixture/resources', sourceFormat: 'test' },
    },
  )
  const container = readUvmContainer(bytes)
  const document = structuredClone(container.document)
  document.images[0].name = 'native texture'
  return { ...container, document }
}

/** Exercise the canonical inspection owner with explicit limits and cancellation. */
function inspect(container, budget = limits, signal) {
  return createUvmInspection(container, {
    budget,
    subjectRevision: 'provider-token:fixture',
    bytesRead: 0n,
    adapter: { id: 'modkit/model-uvm', version: '1.0.0' },
    ...(signal === undefined ? {} : { signal }),
  })
}

it('publishes identity and decoded lookup separately, preserving material and scene sources', async () => {
  const container = fixture()
  container.document.images[0].uri = uvmImageUri('Sources/текстуры/a #50%.dds')
  const inspection = inspect(container)
  const sources = inspection.dataSources
  const refs = await sources['common.view/model-resource-refs-source'].references({ limit: 10 })
  assert.deepEqual(refs.items, [
    {
      id: 'native texture',
      logicalId: 'Sources/текстуры/a #50%.dds',
      role: 'texture',
      provenance: 'reference-only',
    },
  ])
  const materials = await sources['common.view/model-material-source'].materials({ limit: 10 })
  assert.equal(materials.items[0].layers[0].resourceId, refs.items[0].id)
  assert.ok(sources['common.view/tree-data-source'])
  assert.equal((await sources['common.view/model-scene-source'].info()).primitives, 1)
  container.document.images[0].name = 'changed'
  assert.equal(
    (await sources['common.view/model-resource-refs-source'].references({ limit: 1 })).items[0].id,
    'native texture',
  )
})

it('does not publish embedded image identities as logical filenames', () => {
  for (const image of [
    { name: 'embedded', uri: 'data:image/png;base64,AA==' },
    { name: 'embedded', bufferView: 0, mimeType: 'image/png' },
  ]) {
    const container = fixture()
    container.document.images[0] = image
    container.document.images.push({ ...image })
    assert.equal(
      inspect(container).dataSources['common.view/model-resource-refs-source'],
      undefined,
    )
  }
})

it('rejects conflicting lookup targets instead of choosing an image by order', () => {
  const container = fixture()
  container.document.images.push({ ...container.document.images[0], uri: 'other.dds' })
  assert.throws(() => inspect(container), /conflicting resource targets/)
})

it('deduplicates identical logical facts, bounds text and honors cancellation', async () => {
  const container = fixture()
  container.document.images.push({ ...container.document.images[0] })
  const source = inspect(container).dataSources['common.view/model-resource-refs-source']
  assert.equal((await source.references({ limit: 10 })).items.length, 1)
  assert.throws(() => inspect(container, { ...limits, maxScalarBytes: 1 }), /references.*budget/)
  container.document.images[0].name = '纹'.repeat(200)
  assert.throws(() => inspect(container, { ...limits, maxScalarBytes: 300 }), /references.*budget/)
  assert.throws(() => inspect(container, limits, AbortSignal.abort()))
  assert.throws(() => inspect(container, { ...limits, maxNodes: 1 }), /maxNodes/)
})
