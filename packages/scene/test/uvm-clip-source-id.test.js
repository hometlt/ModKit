import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { prepareUvmRender } from '../src/uvm/render.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// a body whose clip the publisher calls `animation-walker`: the catalog writes it `animation-0`
const bytes = materializeUvmCore(
  {
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded',
    },
    nodes: [
      {
        id: 'body',
        childIds: [],
        meshIds: ['mesh'],
        transform: identity,
        trs: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    animations: [
      {
        id: 'animation-walker',
        name: 'Walk',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        channels: [
          {
            target: 'body',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [1, 0, 0] },
            ],
          },
        ],
      },
    ],
  },
  {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:clip-source-id',
    options: { assetId: 'fixture/clip-source-id', sourceFormat: 'test' },
  },
).bytes
const budget = {
  maxInputBytes: 64000000n,
  maxScalarBytes: 64000000,
  maxNodes: 100000,
  maxDepth: 96,
  maxDiagnostics: 100,
}
const request = clipId => ({
  schemaVersion: 1,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity },
  clipId,
  time: 0.5,
})

it('names a clip by the publisher id the catalog keeps, as by the catalog id', async () => {
  const byCatalog = await prepareUvmRender(bytes, request('animation-0'), { budget })
  const byPublisher = await prepareUvmRender(bytes, request('animation-walker'), { budget })
  assert.deepEqual(
    [...byPublisher.request.scene.primitives[0].transform],
    [...byCatalog.request.scene.primitives[0].transform],
  )
  await assert.rejects(
    prepareUvmRender(bytes, request('run'), { budget }),
    /unknown UVM animation clip/,
  )
})
