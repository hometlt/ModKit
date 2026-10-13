import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.ts'

const grid = Array.from({ length: 16 }, (_, i) => ({
  facet: 'terrain',
  id: `t:${i}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: i % 4,
  y: Math.floor(i / 4),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: i % 4, y: 0, z: Math.floor(i / 4) },
}))
const water = polygon => ({
  facet: 'water',
  id: 'w',
  layerId: 'water',
  coordinateSpaceId: 'uvw',
  zoneId: 0,
  templateId: 'water',
  materialId: 'water',
  minimum: { x: 0, y: 0 },
  maximum: { x: 3, y: 3 },
  uvwMinimum: { x: 0, z: 0 },
  uvwMaximum: { x: 3, z: 3 },
  uvwElevation: 1,
  ...(polygon === undefined ? {} : { uvwPolygon: polygon.map(([x, z]) => ({ x, z })) }),
})
const plan = polygon =>
  createWorldWebGlPlan({
    items: [...grid, water(polygon)],
    waterMaterials: [
      { materialId: 'water', color: [0.1, 0.3, 0.5, 1], shorelineMode: 'terrain-clipped' },
    ],
  })
const area = positions => {
  let total = 0
  for (let i = 0; i < positions.length; i += 9) {
    const x = positions[i],
      z = positions[i + 2],
      b = positions[i + 3],
      c = positions[i + 5]
    total += Math.abs((b - x) * (positions[i + 8] - z) - (c - z) * (positions[i + 6] - x)) / 2
  }
  return total
}
it('clips concave authored water in both scene-depth planes and fallback surface geometry', () => {
  const p = plan([
    [0, 0],
    [3, 0],
    [3, 1],
    [1, 1],
    [1, 3],
    [0, 3],
  ])
  assert.equal(area(p.waterPlanes[0].batch.positions), 5)
  const vertices = p.waterPlanes[0].batch.positions
  for (let i = 0; i < vertices.length; i += 9) {
    const turn = (vertices[i+3]-vertices[i])*(vertices[i+8]-vertices[i+2]) - (vertices[i+5]-vertices[i+2])*(vertices[i+6]-vertices[i])
    assert.ok(turn <= 0, 'the depth plane faces upward regardless of authored boundary winding')
  }
  assert.ok(Math.abs(area(p.waterSurfaceDepth) - 5) < 1e-6)
  const reversed = plan([
    [0, 3],
    [1, 3],
    [1, 1],
    [3, 1],
    [3, 0],
    [0, 0],
  ])
  assert.equal(area(reversed.waterPlanes[0].batch.positions), 5)
})
it('keeps legacy bounds-only water unchanged and does not share caches between different footprints', () => {
  assert.equal(area(plan(undefined).waterPlanes[0].batch.positions), 9)
  assert.equal(
    area(
      plan([
        [0, 0],
        [3, 0],
        [0, 3],
      ]).waterPlanes[0].batch.positions,
    ),
    4.5,
  )
  const combined = createWorldWebGlPlan({
    items: [...grid, water([[0, 0], [3, 0], [0, 3]]),
      {...water([[2, 2], [3, 2], [2, 3]]), id: 'w2', zoneId: 1}],
    waterMaterials: [{materialId: 'water', color: [.1, .3, .5, 1], shorelineMode: 'terrain-clipped'}],
  })
  assert.equal(area(combined.waterPlanes[0].batch.positions), 5)
  assert.ok(Math.abs(area(combined.waterSurfaceDepth) - 5) < 1e-6)
})
