import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlCompositeTransparentDrawPlan,
  createWorldWebGlPlan,
  createWorldWebGlTransparentDrawPlan,
} from '../src/world/webgl.js'

// Two blended decal models (textured fallback batches), one triangle each.
const decal = key => ({
  state: 'converted',
  sourceKey: key,
  diagnostics: [],
  complete: true,
  meshes: [],
  primitives: [
    {
      id: `${key}-triangle`,
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
    },
  ],
  materials: [
    {
      id: 'surface',
      blendMode: 'blend',
      layers: [{ slot: 'diffuse', resourceId: `${key}.png`, uvSource: 0 }],
    },
  ],
  textures: [{ id: `${key}.png`, width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 128) }],
})
const object = (objectId, resourceId, x, z) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId,
  position: { x, y: 0, z },
  uvwPosition: { x, y: 0, z },
  resourceId,
})
const models = new Map([
  ['a', decal('a')],
  ['b', decal('b')],
])
// Looking along +x: depth is x, the screen spans z (and height).
const camera = { ...DEFAULT_WORLD_WEBGL_CAMERA, azimuth: 0, elevation: 0.04 }
const textureOf = draw => draw.draw.batch.texture.id

it('draws decal batches that alternate in depth but lie apart on screen as one run each', () => {
  const plan = createWorldWebGlPlan({
    items: [object(1, 'a', 0, 0), object(2, 'b', 10, 5), object(3, 'a', 20, 10), object(4, 'b', 30, 15)],
    models,
  })
  const sorted = createWorldWebGlTransparentDrawPlan(plan, camera)
  assert.deepEqual(
    sorted.map(draw => draw.batch.texture.id),
    ['a.png', 'b.png', 'a.png', 'b.png'],
  )
  const packed = createWorldWebGlCompositeTransparentDrawPlan(plan, camera, [])
  assert.deepEqual(packed.map(textureOf), ['a.png', 'b.png'])
  assert.deepEqual(
    packed.map(draw => draw.draw.range.count / 3),
    [2, 2],
  )
  // Each run keeps its batch's depth order and selects exactly that batch's triangles.
  for (const draw of packed) {
    const { indices, first, count } = draw.draw.range
    const vertices = Array.from(indices.subarray(first, first + count))
    const depths = []
    for (let index = 0; index < vertices.length; index += 3)
      depths.push(draw.draw.batch.positions[vertices[index] * 3])
    assert.deepEqual(
      depths,
      [...depths].sort((left, right) => left - right),
    )
  }
})

it('keeps the sorted order of decals that overlap on screen', () => {
  // Lined up along the view direction: every triangle covers the same screen area.
  const plan = createWorldWebGlPlan({
    items: [object(1, 'a', 0, 0), object(2, 'b', 10, 0), object(3, 'a', 20, 0), object(4, 'b', 30, 0)],
    models,
  })
  const packed = createWorldWebGlCompositeTransparentDrawPlan(plan, camera, [])
  assert.deepEqual(packed.map(textureOf), ['a.png', 'b.png', 'a.png', 'b.png'])
  assert.deepEqual(
    packed.map(draw => draw.draw.range.count / 3),
    [1, 1, 1, 1],
  )
})

it('reuses the packed runs while the plan, view direction and material draws stay the same', () => {
  const plan = createWorldWebGlPlan({
    items: [object(1, 'a', 0, 0), object(2, 'b', 10, 5)],
    models,
  })
  const first = createWorldWebGlCompositeTransparentDrawPlan(plan, camera, [])
  assert.equal(createWorldWebGlCompositeTransparentDrawPlan(plan, { ...camera, zoom: 3 }, []), first)
  assert.notEqual(
    createWorldWebGlCompositeTransparentDrawPlan(plan, { ...camera, azimuth: 0.5 }, []),
    first,
  )
})
