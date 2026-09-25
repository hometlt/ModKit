import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { encodePng } from '@modkit/codec-kit/raster'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { WORLD_TOP_DOWN_MAX_SIZE, renderWorldTopDown } from '../src/world/top-down.js'

// A 3 × 3 heightfield two units across, rising toward the north (canonical −Z), with one object in
// the north-west corner, one in the south-east and a region circle in the middle.
function world() {
  const terrain = Array.from({ length: 9 }, (_, index) => {
    const x = index % 3
    const row = Math.floor(index / 3)
    return {
      facet: 'terrain',
      id: `t:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y: row,
      heightBase: row,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: row * 0.5, z: -row },
    }
  })
  const object = (objectId, x, z) => ({
    facet: 'objects',
    id: `object:${objectId}`,
    layerId: 'objects',
    coordinateSpaceId: 'uvw',
    kind: 'unit',
    objectId,
    position: { x, y: 0, z },
    uvwPosition: { x, y: 1, z },
    uvwRotation: [0, 0, 0, 1],
    uvwScale: { x: 0.2, y: 0.2, z: 0.2 },
  })
  return createWorldWebGlPlan({
    items: [
      ...terrain,
      object(1, 0.2, -1.8),
      object(2, 1.8, -0.2),
      {
        facet: 'regions',
        id: 'region',
        layerId: 'regions',
        coordinateSpaceId: 'uvw',
        regionId: 1,
        name: 'middle',
        shapes: [],
        uvwShapes: [{ kind: 'circle', center: { x: 1, y: -1 }, radius: 0.5, rawParameters: {} }],
      },
    ],
  })
}

describe('world top-down view', () => {
  it('draws the plan from above, north up, with a pixel box per object', async () => {
    const plan = world()
    const image = renderWorldTopDown(plan, { maxSize: 64 })
    assert.equal(image.rgba.length, image.width * image.height * 4)
    assert.equal(Math.max(image.width, image.height), 64)
    assert.deepEqual(
      image.objects.map(object => object.objectId),
      [1, 2],
    )
    const [northWest, southEast] = image.objects
    // Row 0 is north (−Z), column 0 west: the north-west object sits above and left of the other.
    assert.ok(northWest.y + northWest.height <= southEast.y, JSON.stringify(image.objects))
    assert.ok(northWest.x + northWest.width <= southEast.x, JSON.stringify(image.objects))
    assert.deepEqual(image.world, {
      minimumX: plan.bounds.minimum[0],
      maximumX: plan.bounds.maximum[0],
      minimumZ: plan.bounds.minimum[2],
      maximumZ: plan.bounds.maximum[2],
    })

    // The same plan gives the same pixels and the same PNG, pinned so a drawing change is seen.
    const again = renderWorldTopDown(world(), { maxSize: 64 })
    assert.deepEqual(again.rgba, image.rgba)
    const png = await encodePng(image.width, image.height, image.rgba)
    assert.equal(
      createHash('sha256').update(png).digest('hex'),
      'f38c48b71e6845a50475d2d0b20918c1fe528fa467df77071298e4fbb5b0b8c3',
    )
  })

  it('refuses a frame outside the size budget', () => {
    const plan = world()
    assert.throws(() => renderWorldTopDown(plan, { maxSize: 0 }), RangeError)
    assert.throws(() => renderWorldTopDown(plan, { maxSize: WORLD_TOP_DOWN_MAX_SIZE + 1 }), RangeError)
    assert.throws(() => renderWorldTopDown(plan, { maxSize: 1.5 }), RangeError)
  })
})
