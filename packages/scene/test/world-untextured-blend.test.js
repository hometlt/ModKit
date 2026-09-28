import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A Roblox water slab: one quad of a blended material with no texture, alpha from its vertex colours.
const slab = alphaMode => ({
  state: 'converted',
  sourceKey: `slab-${alphaMode ?? 'opaque'}`,
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [
    {
      id: 'slab',
      topology: 'triangles',
      materialId: 'water',
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1, 1, 0, 0, 1, 0, -1, 0, 0, -1),
      normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0),
      colors: Float32Array.from({ length: 24 }, (_, index) => (index % 4 === 3 ? 0.25 : 0.5)),
      indices: Uint32Array.of(0, 1, 2, 3, 4, 5),
    },
  ],
  materials: [{ id: 'water', ...(alphaMode === undefined ? {} : { alphaMode }) }],
  textures: [],
})
const part = {
  facet: 'objects',
  id: 'part:0',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  typeId: 'Part',
  resourceId: 'slab',
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  uvwRotation: [0, 0, 0, 1],
}
const triangles = batch => batch.positions.length / 9

it('blends an untextured primitive of a blended material instead of drawing it opaque', () => {
  const blended = createWorldWebGlPlan({ items: [part], models: new Map([['slab', slab('blend')]]) })
  assert.equal(triangles(blended.transparentTriangles), 2)
  assert.equal(triangles(blended.opaqueTriangles), 0)
  const alphas = new Set()
  for (let index = 3; index < blended.transparentTriangles.colors.length; index += 4)
    alphas.add(blended.transparentTriangles.colors[index].toFixed(2))
  assert.deepEqual([...alphas], ['0.25'])

  const opaque = createWorldWebGlPlan({ items: [part], models: new Map([['slab', slab()]]) })
  assert.equal(triangles(opaque.transparentTriangles), 0)
  assert.equal(triangles(opaque.opaqueTriangles), 2)
})
