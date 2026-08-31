import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sceneModule } from '../src/module.js'

describe('built-in scene module', () => {
  it('retains renderer protocol identifiers under a product-module coordinate', () => {
    assert.equal(sceneModule.kind, 'builtin')
    assert.equal(sceneModule.coordinate, 'modkit/scene')
    assert.deepEqual(
      [...sceneModule.input.documents.values()].map(manifest => manifest.id).sort(),
      ['modkit/browser-webgl-renderer', 'modkit/headless-renderer'],
    )
    assert.deepEqual(sceneModule.excluded, [])
    assert.equal(sceneModule.moduleEntries.length, 2)
  })
})
