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

it('keeps separate native object light axes and falls back exactly when the rig is omitted', async () => {
  const { worldMaterialLight } = await import('../src/world/webgl.ts')
  const base = lighting('map-native')
  const plan = createWorldWebGlPlan({
    items: [
      ...terrain,
      {
        ...base,
        objects: {
          ambientColor: [0, 0, 1],
          ambientIntensity: 0.8,
          directional: [
            { id: 'object-sun', direction: [1, 2, -3], color: [0.2, 0.5, 0.9], intensity: 0.7 },
            { id: 'object-fill', direction: [-1, 4, -2], color: [0.1, 0.2, 0.3], intensity: 0.2 },
          ],
        },
      },
    ],
  })
  assert.deepEqual(plan.light.direction, [0.37, -0.72, 0.59])
  assert.deepEqual(plan.objectLight.direction, [1, -3, 2])
  assert.deepEqual(plan.objectLight.fills[0].direction, [-1, -2, 4])
  assert.deepEqual(worldMaterialLight(plan).ambientColor, [0, 0, 0.8])
  assert.deepEqual(worldMaterialLight(plan, 'terrain').ambientColor, [0.4, 0.4, 0.4])
  const omitted = createWorldWebGlPlan({ items: [...terrain, base] })
  assert.equal(omitted.objectLight, undefined)
  assert.deepEqual(worldMaterialLight(omitted), worldMaterialLight(omitted, 'terrain'))
})

it('keeps terrain vertex normals upward for both native row directions', () => {
  for (const sign of [-1, 1]) {
    const items = Array.from({ length: 4 }, (_, i) => ({
      facet: 'terrain',
      id: 'n:' + i,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x: i % 2,
      y: Math.floor(i / 2),
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      mapNativePosition: { x: i % 2, y: sign * Math.floor(i / 2), z: 0 },
    }))
    const plan = createWorldWebGlPlan({ items })
    for (let i = 1; i < plan.opaqueTriangles.normals.length; i += 3)
      assert.ok(plan.opaqueTriangles.normals[i] > 0.99)
  }
})

it('frames more than the browser argument limit of terrain samples without spreading the grid', () => {
  const count = 131072
  const items = Array.from({ length: count }, (_, i) => ({
    facet: 'terrain',
    id: 'large:' + i,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i,
    y: 0,
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    mapNativePosition: { x: i, y: 0, z: 0 },
  }))
  assert.doesNotThrow(() => createWorldWebGlPlan({ items }))
})
