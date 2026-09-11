import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rebaseUvmScene, removeUvmSceneFrame } from '../dist/uvm/frame.js'

const transform = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 0, 0, 0, 1]
const source = {
  format: 'glb',
  binary: new Uint8Array(),
  extraChunks: [],
  document: {
    asset: {
      version: '2.0',
      extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Root' }],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_effects'],
    extensions: {
      UV_asset: { id: 'frame-test', class: 'model' },
      UV_provenance: {
        importer: { id: 'test/frame', version: '1' },
        source: { format: 'test' },
      },
      UV_game_effects: { profile: 'common', particles: [], ribbons: [] },
    },
  },
}

test('removes only the exact scene frame produced by the common rebase operation', () => {
  const framed = rebaseUvmScene(source, transform)
  const owned = structuredClone(framed)
  owned.document.extensions.UV_game_effects.spaceNode = 1
  const restored = removeUvmSceneFrame(owned, transform)
  assert.deepEqual(restored.document.nodes, source.document.nodes)
  assert.deepEqual(restored.document.scenes, source.document.scenes)
  assert.equal(restored.document.extensions.UV_game_effects.spaceNode, undefined)
  assert.throws(
    () => removeUvmSceneFrame(framed, [...transform.slice(0, 15), 2]),
    /does not match/,
  )
})
