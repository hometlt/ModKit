import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A 3×3 height grid whose cells name one material each, as Roblox terrain does: no texture, a colour.
const terrain = Array.from({ length: 9 }, (_, index) => ({
  facet: 'terrain',
  id: `terrain:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 3,
  y: Math.floor(index / 3),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 3, y: 0, z: -Math.floor(index / 3) },
}))
const cells = Array.from({ length: 9 }, (_, index) => ({
  facet: 'terrain-materials',
  id: `material:${index}`,
  layerId: 'terrain-materials',
  coordinateSpaceId: 'height-grid',
  x: index % 3,
  y: Math.floor(index / 3),
  weights: [{ materialId: index % 2 === 0 ? 'grass' : 'rock', weight: 1 }],
}))
const colours = plan => {
  const found = new Set()
  const { colors } = plan.opaqueTriangles
  for (let index = 0; index < colors.length; index += 4)
    found.add([...colors.subarray(index, index + 4)].map(value => value.toFixed(2)).join(','))
  return found
}

it('draws an untextured terrain material in its glTF baseColorFactor, opaque', () => {
  const plan = createWorldWebGlPlan({
    items: [...terrain, ...cells],
    terrainMaterials: [
      { materialId: 'grass', baseColorFactor: [0.2, 0.6, 0.1, 0.5] },
      { materialId: 'rock', baseColorFactor: [0.4, 0.4, 0.45, 1] },
    ],
  })
  const found = colours(plan)
  assert.ok(found.has('0.20,0.60,0.10,1.00'), `grass drawn in its factor: ${[...found]}`)
  assert.ok(found.has('0.40,0.40,0.45,1.00'), `rock drawn in its factor: ${[...found]}`)
})
