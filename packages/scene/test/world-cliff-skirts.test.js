import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// Two height-grid columns a level apart, no cliff piece loaded: the plan draws a skirt between them.
const terrain = Array.from({ length: 4 }, (_, index) => ({
  facet: 'terrain',
  id: `t:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 2,
  y: Math.floor(index / 2),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 2, y: index % 2 === 0 ? 0 : 0.5, z: -Math.floor(index / 2) },
}))
const cliff = (x, y, level, ramp) => ({
  facet: 'cliffs',
  id: `c:${x}:${y}`,
  layerId: 'cliffs',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x,
  y,
  level,
  authored: false,
  ...(ramp ? { ramp: true } : {}),
})

it('draws no cliff skirt across a ramp, whose ground is the terrain itself', () => {
  const skirts = ramp =>
    createWorldWebGlPlan({
      items: [...terrain, cliff(0, 0, 4, ramp), cliff(1, 0, 5, ramp), cliff(0, 1, 4, ramp), cliff(1, 1, 5, ramp)],
    }).stats.cliffEdges
  assert.equal(skirts(false), 1)
  // Highland's ramps rise a sub-level per sample; a skirt on each step drew a grid of dark lines.
  assert.equal(skirts(true), 0)
})
