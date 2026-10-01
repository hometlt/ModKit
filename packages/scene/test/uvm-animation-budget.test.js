import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { createUvmInspection } from '../src/uvm/inspection.js'

// A pose on every frame (Grey Goo ALA, Earth 2160 .mot): 70 000 keys are about half a million
// snapshot nodes, past this host's node budget, yet already decoded out of a bounded binary.
const keys = 70_000
const projection = {
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
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
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
      id: 'walk',
      name: 'Walk',
      kind: 'animation',
      provenance: 'direct',
      frames: keys,
      channels: [
        {
          target: 'body',
          kind: 'translation',
          firstFrame: 0,
          lastFrame: keys - 1,
          interpolation: 'linear',
          samples: Array.from({ length: keys }, (_, frame) => ({
            frame,
            timeSeconds: frame / 30,
            value: [frame, 0, 0],
          })),
        },
      ],
    },
  ],
}

it('UVM opens a clip larger than the host node budget, sized by its decoded keys', async () => {
  const { bytes } = materializeUvmCore(
    projection,
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:frames',
      options: { assetId: 'fixture/frames', sourceFormat: 'test' },
    },
    { animationBudget: { maxDepth: 64, maxNodes: 10_000_000, maxBytes: 1 << 30 } },
  )
  const inspection = createUvmInspection(readUvmContainer(bytes), {
    budget: {
      maxDepth: 256,
      maxNodes: 300_000,
      maxScalarBytes: 64 * 1024 * 1024,
      maxJsonBytes: 64 * 1024 * 1024,
    },
    subjectRevision: 'provider-token:frames',
    adapter: { id: 'modkit/model-uvm', version: '1.0.0' },
    bytesRead: BigInt(bytes.byteLength),
  })
  const source = inspection.dataSources['common.view/model-animation-source']
  assert.equal((await source.info()).clips, 1)
  const [clip] = (await source.clips({ limit: 1 })).items
  assert.equal(clip.channels[0].samples.length, keys)
})
