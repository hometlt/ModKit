import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { createUvmFramePreparer, prepareUvmRender, renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const { bytes } = materializeUvmCore(
  {
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded',
    },
    nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
  },
  {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:frame',
    options: { assetId: 'fixture/frame', sourceFormat: 'test' },
  },
)
const budget = {
  maxInputBytes: 64000000n,
  maxScalarBytes: 64000000,
  maxNodes: 100000,
  maxDepth: 96,
  maxDiagnostics: 100,
}
const request = {
  schemaVersion: 1,
  time: 0,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity, viewMatrix: identity },
}

it('prepares the frame renderUvm draws, without a renderer', async () => {
  const prepared = await prepareUvmRender(bytes, request, { budget })
  assert.deepEqual(prepared.request.viewport, { width: 4, height: 4 })
  assert.equal(prepared.request.scene.primitives.length, 1)
  let rendered
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            rendered = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  await renderUvm(bytes, request, { budget, contracts })
  assert.deepEqual(
    rendered.scene.primitives.map(item => item.id),
    prepared.request.scene.primitives.map(item => item.id),
  )
  assert.deepEqual(
    Array.from(rendered.camera.viewProjection),
    Array.from(prepared.request.camera.viewProjection),
  )
  assert.equal(prepared.metersPerSourceUnit, 1)
  assert.deepEqual(prepared.effectPrimitiveIds, [])
})

it('names the source unit the frame was scaled from (UV_units)', async () => {
  const { bytes: scaled } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
      primitives: [
        {
          id: 'tri',
          topology: 'triangles',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: Uint32Array.from([0, 1, 2]),
        },
      ],
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:inches',
      options: {
        assetId: 'fixture/inches',
        sourceFormat: 'test',
        units: { metersPerSourceUnit: 0.0254, sourceUnit: 'inch' },
      },
    },
  )
  const prepared = await prepareUvmRender(scaled, request, { budget })
  assert.equal(prepared.metersPerSourceUnit, 0.0254)
})

it('prepares many frames of one document the same as one by one', async () => {
  const preparer = createUvmFramePreparer(bytes, { budget })
  const turned = {
    ...request,
    camera: {
      viewProjection: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      viewMatrix: identity,
    },
  }
  for (const frame of [request, turned, request]) {
    const kept = await preparer.prepare(frame)
    const fresh = await prepareUvmRender(bytes, frame, { budget })
    assert.deepEqual(
      Array.from(kept.request.camera.viewProjection),
      Array.from(fresh.request.camera.viewProjection),
    )
    assert.deepEqual(
      kept.request.scene.primitives.map(item => [item.id, Array.from(item.positions)]),
      fresh.request.scene.primitives.map(item => [item.id, Array.from(item.positions)]),
    )
  }
  preparer.dispose()
  await assert.rejects(preparer.prepare(request), /disposed/)
})
