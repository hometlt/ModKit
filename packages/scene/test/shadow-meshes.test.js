import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeUvmContainer } from '@modkit/uv/model/container'
import { addUvmShadowMeshes, readUvmShadowMeshBindings } from '../src/uvm/shadow-meshes.js'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const budget = {
  maxInputBytes: 16_000_000n,
  maxScalarBytes: 16_000_000,
  maxJsonBytes: 16_000_000,
  maxNodes: 100_000,
  maxDepth: 64,
  maxDiagnostics: 100,
}
const containerBudget = { ...budget, maxInputBytes: Number(budget.maxInputBytes) }
const source = () => ({
  format: 'glb',
  binary: new Uint8Array(),
  extraChunks: [],
  document: {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{}],
    extensionsUsed: ['UV_asset', 'UV_provenance'],
    extensions: {
      UV_asset: { id: 'shadow-test', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
    },
  },
})
const request = {
  schemaVersion: 1,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
}

test('portable shadow meshes are owned, hidden by default and visible in explicit overlay mode', async () => {
  const positions = Float32Array.of(-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0)
  const indices = Uint16Array.of(0, 1, 2)
  const added = addUvmShadowMeshes(source(), [{ node: 0, positions, indices }], containerBudget)
  positions.fill(9)
  indices.fill(2)
  assert.deepEqual(readUvmShadowMeshBindings(added.container.document), [{ node: 0, mesh: 0 }])
  let captured
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(value) {
            captured = value
            return renderHeadless(value)
          },
        },
        async release() {},
      }
    },
  }
  const bytes = writeUvmContainer(added.container, containerBudget)
  await renderUvm(bytes, request, { budget, contracts })
  assert.equal(captured.scene.primitives.length, 0)
  await renderUvm(bytes, { ...request, shadows: true }, { budget, contracts })
  assert.equal(captured.scene.primitives.length, 1)
  assert.match(captured.scene.primitives[0].id, /^uvm-shadow-/)
  assert.deepEqual(Array.from(captured.scene.primitives[0].positions), [
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0,
  ])
  assert.equal(captured.scene.primitives[0].materialId, 'uvm-shadow-overlay')
})

test('portable shadow bindings reject duplicate nodes and invalid indices before publication', () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0)
  assert.throws(
    () => addUvmShadowMeshes(source(), [
      { node: 0, positions, indices: Uint16Array.of(0, 1, 2) },
      { node: 0, positions, indices: Uint16Array.of(0, 1, 2) },
    ], containerBudget),
    /duplicate UVM shadow node/,
  )
  assert.throws(
    () => addUvmShadowMeshes(source(), [{ node: 0, positions, indices: Uint16Array.of(0, 1, 3) }], containerBudget),
    /index exceeds positions/,
  )
})
