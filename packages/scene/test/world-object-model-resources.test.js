import assert from 'node:assert/strict'
import { test } from 'node:test'
import { worldObjectModelResources } from '../src/world/webgl.js'

test('an object places the models of its id, its list and its components, once each (MW2)', () => {
  const base = { facet: 'objects', id: 'o', objectId: 1, kind: 'doodad' }
  // a Minecraft chunk entity: no resourceId, a component model per part
  assert.deepEqual(
    worldObjectModelResources({
      ...base,
      modelComponents: [
        { id: 'body', resourceId: 'cow' },
        { id: 'head', resourceId: 'cow-head', parentId: 'body' },
      ],
    }),
    ['cow', 'cow-head'],
  )
  assert.deepEqual(
    worldObjectModelResources({ ...base, resourceId: 'water', resourceIds: ['water', 'lava'] }),
    ['water', 'lava'],
  )
})
