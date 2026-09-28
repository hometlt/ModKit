import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A 4×3 height grid painted from one weight raster: exact GPU splat terrain.
const splatTerrain = Array.from({ length: 12 }, (_, index) => ({
  facet: 'terrain',
  id: `terrain:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 4,
  y: Math.floor(index / 4),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 4, y: 0, z: -Math.floor(index / 4) },
}))
const texture = (id, width, height, rgba) => ({ id, width, height, rgba: Uint8Array.from(rgba) })
const splatInput = {
  terrainMaterials: [{ materialId: 'ground', baseColorResourceId: 'ground.dds' }],
  terrainWeightRasters: [
    { resourceId: 'weights.rgba', width: 1, height: 1, materialIds: ['ground'], encoding: 'rgba8-unorm', normalization: 'sum' },
  ],
  terrainTextures: new Map([
    ['ground.dds', texture('ground.dds', 1, 1, [120, 90, 60, 255])],
    ['weights.rgba', texture('weights.rgba', 1, 1, [255, 0, 0, 0])],
  ]),
}

// A geyser's torn skirt (SC2 TER_): a raised quad whose material has no colour of its own, and whose
// normals lean outward.
const skirt = {
  state: 'converted',
  sourceKey: 'geyser',
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'skirt',
      topology: 'triangles',
      materialId: 'torn-ground',
      positions: Float32Array.of(...[0.5, 0.2, -0.5, 1.5, 0.4, -0.5, 0.5, 0.2, -1.5], ...[1.5, 0.4, -0.5, 1.5, 0.4, -1.5, 0.5, 0.2, -1.5]),
      normals: Float32Array.of(...[-0.6, 0.8, 0, 0.6, 0.8, 0, -0.6, 0.8, 0], ...[0.6, 0.8, 0, 0.6, 0.8, 0, -0.6, 0.8, 0]),
      indices: Uint32Array.of(0, 1, 2, 3, 4, 5),
    },
  ],
  materials: [
    {
      id: 'torn-ground',
      shader: {
        id: 'modkit.render-material.v1',
        parameters: { renderModel: { version: 1, presentation: 'terrain-projection', metadata: { sourceMaterialTag: 'TER_' } } },
      },
    },
  ],
  textures: [],
}
const geyser = {
  facet: 'objects',
  id: 'geyser:0',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'unit',
  objectId: 2,
  typeId: 'VespeneGeyser',
  resourceId: 'geyser',
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  uvwRotation: [0, 0, 0, 1],
}
const plainTriangles = plan =>
  plan.splatTriangles.filter(batch => batch.maskTexture === undefined).reduce((sum, batch) => sum + batch.positions.length / 9, 0)

it('draws a model part that shows the terrain as ground, lit by the mesh normals', () => {
  const bare = createWorldWebGlPlan({ items: [...splatTerrain], ...splatInput })
  const plan = createWorldWebGlPlan({ items: [...splatTerrain, geyser], models: new Map([['geyser', skirt]]), ...splatInput })
  // Both skirt triangles join the ground batch, in the terrain textures by map position.
  assert.equal(plainTriangles(plan) - plainTriangles(bare), 2)
  const [batch] = plan.splatTriangles.filter(item => item.maskTexture === undefined)
  const heights = []
  for (let index = 1; index < batch.positions.length; index += 3) heights.push(batch.positions[index])
  assert.ok(heights.some(height => Math.abs(height - 0.4) < 1e-6), 'the raised skirt keeps its own shape')
  // The leaning normals, not one face normal for the whole triangle.
  const normals = []
  for (let index = 0; index < batch.normals.length; index += 3) normals.push(Math.round(batch.normals[index] * 10) / 10)
  assert.ok(normals.includes(-0.6) && normals.includes(0.6))
})

it('renews the kept ground when a model that shows the terrain arrives', () => {
  // Progressive loading: the same items, the geyser's model delivered on a later tick. The static
  // terrain preparation is kept between plans unless something it draws changed.
  const items = [...splatTerrain, geyser]
  const before = createWorldWebGlPlan({ items, models: new Map(), ...splatInput })
  const after = createWorldWebGlPlan({ items, models: new Map([['geyser', skirt]]), ...splatInput }, before)
  assert.equal(plainTriangles(after) - plainTriangles(before), 2)
})
