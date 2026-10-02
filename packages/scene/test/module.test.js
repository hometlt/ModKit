import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sceneModule } from '../src/module.js'

describe('built-in scene module', () => {
  it('retains renderer protocol identifiers under a product-module coordinate', () => {
    assert.equal(sceneModule.kind, 'builtin')
    assert.equal(sceneModule.coordinate, 'modkit/scene')
    assert.deepEqual(
      [...sceneModule.input.documents.values()].map(manifest => manifest.id).sort(),
      ['modkit/browser-webgl-renderer', 'modkit/headless-renderer', 'modkit/world-uvp'],
    )
    assert.deepEqual(sceneModule.excluded, [])
    assert.equal(new Set(sceneModule.moduleEntries.map(([entrypoint]) => entrypoint)).size, 3)
    const headless = [...sceneModule.input.documents.values()].find(
      manifest => manifest.id === 'modkit/headless-renderer',
    )
    assert.deepEqual(headless.runtimeVariants[0].target.environments, ['node'])
    assert.deepEqual(headless.runtimeVariants.map(variant => variant.variantId), ['trusted-node'])
    const browser = [...sceneModule.input.documents.values()].find(
      manifest => manifest.id === 'modkit/browser-webgl-renderer',
    )
    assert.deepEqual(
      browser.runtimeVariants.map(variant => variant.variantId),
      ['trusted-browser-main', 'trusted-browser-worker'],
    )
  })
})
