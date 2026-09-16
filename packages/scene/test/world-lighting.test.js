import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.ts'

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
  uvwPosition: { x: index % 2, y: 0, z: -Math.floor(index / 2) },
}))

const lighting = directional => ({
  facet: 'lighting',
  id: 'lighting',
  layerId: 'lighting',
  coordinateSpaceId: 'uvw-canonical',
  ambientColor: [0.6, 0.5, 0.35],
  ambientIntensity: 1,
  directional,
})

describe('world lighting rig', () => {
  it('keeps every directional past the key light as a fill', () => {
    // SC2 rigs ship Key, Fill and Back; only the key light owns the shadow map.
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        lighting([
          { id: 'Key', direction: [0.37, -0.72, 0.59], color: [1, 1, 1], intensity: 1 },
          { id: 'Fill', direction: [-0.7, -0.19, 0.69], color: [0.8, 0.68, 0.55], intensity: 1 },
          { id: 'Back', direction: [-0.18, -0.71, -0.68], color: [0.34, 0.44, 0.61], intensity: 0.4 },
        ]),
      ],
    })

    assert.deepEqual(plan.light.direction, [0.37, -0.72, 0.59])
    assert.equal(plan.light.fills.length, 2)
    assert.deepEqual(plan.light.fills[0].color, [0.8, 0.68, 0.55])
    assert.equal(plan.light.fills[1].intensity, 0.4)
  })

  it('winds terrain so its face normal points up in scene space', () => {
    // A world payload mirrors the map's Y into -Z. With the map-order winding the face normal came
    // out pointing down, N·L was zero for every light, and terrain rendered ambient-only.
    const quad = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `lit-terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: -y },
    }))
    const plan = createWorldWebGlPlan({ items: quad })

    assert.equal(plan.stats.terrainTriangles, 2)
    for (let vertex = 0; vertex < plan.opaqueTriangles.normals.length; vertex += 3)
      assert.ok(
        plan.opaqueTriangles.normals[vertex + 1] > 0.99,
        `terrain normal ${String(vertex / 3)} points up`,
      )
  })

  it('has no fills for a single-light rig', () => {
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        lighting([{ id: 'Key', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 }]),
      ],
    })

    assert.equal(plan.light.fills.length, 0)
  })
})
