import assert from 'node:assert/strict'
import { it } from 'node:test'

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
  mapNativePosition: { x: index % 2, y: Math.floor(index / 2), z: 0 },
}))
const lighting = coordinateSpaceId => ({
  facet: 'lighting',
  id: 'lighting',
  layerId: 'lighting',
  coordinateSpaceId,
  ambientColor: [0.4, 0.4, 0.4],
  ambientIntensity: 1,
  directional: [{ id: 'sun', direction: [0.37, 0.59, -0.72], color: [1, 1, 1], intensity: 1 }],
})

it('turns a light stated in the map native axes (z up) into the render axes, as positions', () => {
  const native = createWorldWebGlPlan({ items: [...terrain, lighting('map-native')] })
  assert.deepEqual(native.light.direction, [0.37, -0.72, 0.59])
  const canonical = createWorldWebGlPlan({ items: [...terrain, lighting('uvw-canonical')] })
  assert.deepEqual(canonical.light.direction, [0.37, 0.59, -0.72])
})
