import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addUvmOrderedEulerChains,
  readUvmOrderedEulerChains,
} from '../src/uvm/ordered-euler-chains.js'

const budget = {
  maxInputBytes: 1_000_000,
  maxJsonBytes: 1_000_000,
  maxNodes: 10_000,
  maxDepth: 32,
}
const source = () => ({
  format: 'glb',
  binary: new Uint8Array(),
  extraChunks: [],
  document: {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { children: [1] },
      { children: [2] },
      { children: [3] },
      {},
    ],
    extensionsUsed: ['UV_asset', 'UV_provenance'],
    extensions: {
      UV_asset: { id: 'ordered-euler-test', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
    },
  },
})

test('ordered Euler chain relation is owned and round-trips independently of node names', () => {
  const input = { node: 0, rotationNodes: [1, 2, 3], scaleNode: 3, order: 'xyz' }
  const added = addUvmOrderedEulerChains(source(), [input], budget)
  input.rotationNodes[0] = 3
  assert.deepEqual(readUvmOrderedEulerChains(added.document), [{
    node: 0,
    rotationNodes: [1, 2, 3],
    scaleNode: 3,
    order: 'xyz',
  }])
})

test('ordered Euler chain relation rejects duplicate roots and a mismatched hierarchy', () => {
  const input = { node: 0, rotationNodes: [1, 2, 3], scaleNode: 3, order: 'xyz' }
  assert.throws(() => addUvmOrderedEulerChains(source(), [input, input], budget), /distinct|duplicate/)
  const broken = source()
  broken.document.nodes[1].children = [3]
  assert.throws(() => addUvmOrderedEulerChains(broken, [input], budget), /hierarchy/)
})
