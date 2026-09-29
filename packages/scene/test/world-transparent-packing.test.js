import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlCompositeTransparentDrawPlan,
  createWorldWebGlPlan,
  createWorldWebGlTransparentDrawPlan,
} from '../src/world/webgl.js'
import { primitiveVertexPlacements } from '../src/render/vertex-placements.js'

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

// Material draws built for one frame, as an effect's sprites: a triangle facing the view at (x, 0, z).
const effectProgram = blend => ({ priority: 0, blend, twoSided: true, normalMapSpace: 'tangent' })
const effectMaterial = { passes: [], textures: new Map() }
const effectScene = {
  primitives: [],
  shadowPrimitives: [],
  materials: [],
  programs: new Map(),
  textures: [],
}
const effectDraw = (program, x, z, merge = true) => ({
  scene: effectScene,
  merge,
  draw: {
    program,
    material: effectMaterial,
    primitive: {
      id: `sprite-${x}-${z}`,
      materialId: 'effect',
      topology: 'triangles',
      positions: Float32Array.of(0, 0, 0, 0, 1, 0, 0, 0, 1),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      transform: Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1),
    },
  },
})
const emptyPlan = () => createWorldWebGlPlan({ items: [object(1, 'a', 100, 100)], models })
const placedAt = entry => {
  const placements = primitiveVertexPlacements(entry.draw.primitive)
  if (placements === undefined) return [entry.draw.primitive.transform[12]]
  const xs = []
  for (let vertex = 0; vertex < placements.length / 16; vertex += 3)
    xs.push(placements[vertex * 16 + 12])
  return xs
}

it('draws what a frame built with one program as one, in depth order, past draws apart on screen', () => {
  const sprites = effectProgram('blend')
  const other = effectProgram('blend')
  const packed = createWorldWebGlCompositeTransparentDrawPlan(emptyPlan(), camera, [
    effectDraw(sprites, 20, 0),
    effectDraw(other, 5, 20),
    effectDraw(sprites, 0, 5),
    effectDraw(sprites, 10, 10),
  ]).filter(entry => entry.kind === 'material')
  assert.equal(packed.length, 2)
  assert.equal(packed[0].draw.program, sprites)
  // Back to front along the view: x = 0, 10, 20, each vertex with its draw's placement.
  assert.deepEqual(placedAt(packed[0]), [0, 10, 20])
  assert.equal(packed[0].draw.primitive.transform, undefined)
  assert.deepEqual(placedAt(packed[1]), [5])
})

it('keeps a draw of another program between the draws of one program it overlaps', () => {
  const packed = otherBlend => {
    const sprites = effectProgram('additive')
    const other = effectProgram(otherBlend)
    return createWorldWebGlCompositeTransparentDrawPlan(emptyPlan(), camera, [
      effectDraw(sprites, 0, 0),
      effectDraw(other, 5, 0),
      effectDraw(sprites, 10, 0),
    ])
      .filter(entry => entry.kind === 'material')
      .map(entry => [entry.draw.program.blend, ...placedAt(entry)])
  }
  assert.deepEqual(packed('blend'), [
    ['additive', 0],
    ['blend', 5],
    ['additive', 10],
  ])
  // Additions sum alike in any order: the sprites join past another adding draw.
  assert.deepEqual(packed('add-alpha'), [
    ['additive', 0, 10],
    ['add-alpha', 5],
  ])
})

it('leaves draws apart that are not built for the frame alone', () => {
  const sprites = effectProgram('blend')
  const packed = createWorldWebGlCompositeTransparentDrawPlan(emptyPlan(), camera, [
    effectDraw(sprites, 0, 0, false),
    effectDraw(sprites, 10, 10, false),
  ]).filter(entry => entry.kind === 'material')
  assert.deepEqual(packed.map(placedAt), [[0], [10]])
})
