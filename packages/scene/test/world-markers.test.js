import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

const object = (objectId, kind, extra = {}) => ({
  facet: 'objects',
  id: `object:${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'map-native',
  kind,
  objectId,
  position: { x: objectId, y: 0, z: 0 },
  uvwPosition: { x: objectId, y: 0, z: 0 },
  ...extra,
})

it('marks map points only on request, and a model that did not load always', () => {
  // Blackrock's 53 sound emitters, no-fly zones and start locations: the game draws nothing there.
  const items = [
    object(1, 'point', { typeId: 'SoundEmitter' }),
    object(2, 'point', { typeId: 'StartLoc' }),
    object(3, 'camera'),
    object(4, 'doodad', { resourceId: 'resource:missing' }),
  ]
  assert.equal(createWorldWebGlPlan({ items }).stats.diagnosticPlaceholders, 1)
  assert.equal(
    createWorldWebGlPlan({ items, editorMarkers: true }).stats.diagnosticPlaceholders,
    4,
  )
  // A selected point is marked, so a picked start location stays visible.
  const selected = createWorldWebGlPlan({ items, selectedObjectId: 2 })
  assert.equal(selected.stats.diagnosticPlaceholders, 2)
  // The request is followed on the next plan built from this one.
  const first = createWorldWebGlPlan({ items })
  assert.equal(
    createWorldWebGlPlan({ items, editorMarkers: true }, first).stats.diagnosticPlaceholders,
    4,
  )
})
