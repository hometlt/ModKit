import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  createWorldWebGlTransparentDrawPlan,
} from '../src/world/webgl.js'

// A 3×2 height grid whose ground rises with x: the zone's surface at 0.5 floods only the low
// column, so the terrain-clipped water stops on a cell step.
const terrain = Array.from({ length: 6 }, (_, index) => ({
  facet: 'terrain',
  id: `terrain:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'uvw',
  lod: 'exact',
  x: index % 3,
  y: Math.floor(index / 3),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 3, y: index % 3, z: -Math.floor(index / 3) },
}))
const water = {
  facet: 'water',
  id: 'water',
  layerId: 'water',
  coordinateSpaceId: 'uvw',
  zoneId: 0,
  templateId: 'CompoundSewers',
  materialId: 'sewers',
  minimum: { x: 0, y: 0 },
  maximum: { x: 2, y: 1 },
  uvwMinimum: { x: 0, z: -1 },
  uvwMaximum: { x: 2, z: 0 },
  uvwElevation: 0.5,
}
const waterMaterials = [
  {
    materialId: 'sewers',
    shorelineMode: 'terrain-clipped',
    color: [0.4, 0.3, 0.6, 0.5],
    colorFalloff: 0.25,
  },
]

it('keeps an untextured water zone as a plane at its elevation beside the clipped water', () => {
  const plan = createWorldWebGlPlan({ items: [...terrain, water], waterMaterials })
  assert.equal(plan.waterPlanes.length, 1)
  const [plane] = plan.waterPlanes
  assert.equal(plane.colorFalloff, 0.25)
  assert.equal(plane.receiveShadows, false)
  // The zone rectangle, two triangles, flat at the surface and coloured by the material.
  assert.equal(plane.batch.positions.length, 6 * 3)
  const xs = plane.batch.positions.filter((_, index) => index % 3 === 0)
  const ys = plane.batch.positions.filter((_, index) => index % 3 === 1)
  const zs = plane.batch.positions.filter((_, index) => index % 3 === 2)
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [0, 2])
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [-1, 0])
  assert.ok(ys.every(y => y === 0.5))
  for (let vertex = 0; vertex < 6; vertex++)
    assert.deepEqual(
      Array.from(plane.batch.colors.slice(vertex * 4, vertex * 4 + 4)).map(
        value => Math.round(value * 100) / 100,
      ),
      [0.4, 0.3, 0.6, 0.5],
    )
  // Both triangles face up, as the water normal says.
  for (let triangle = 0; triangle < 2; triangle++) {
    const [ax, , az, bx, , bz, cx, , cz] = plane.batch.positions.slice(triangle * 9, triangle * 9 + 9)
    assert.ok((bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0)
  }
  // The clipped water is still planned (renderers without the scene depth draw it), and every
  // triangle of the untextured transparent batch is that water.
  assert.ok(plan.transparentWaterTriangles > 0)
  assert.equal(plan.transparentWaterTriangles, plan.transparentTriangles.positions.length / 9)
})

it('leaves the clipped water out of the transparent draws of a renderer that draws the planes', () => {
  const plan = createWorldWebGlPlan({ items: [...terrain, water], waterMaterials })
  const camera = { ...DEFAULT_WORLD_WEBGL_CAMERA, azimuth: 0, elevation: 0.8 }
  const clipped = createWorldWebGlTransparentDrawPlan(plan, camera)
  assert.equal(
    clipped.reduce((count, draw) => count + draw.range.count / 3, 0),
    plan.transparentWaterTriangles,
  )
  assert.deepEqual(createWorldWebGlTransparentDrawPlan(plan, camera, { excludeClippedWater: true }), [])
  // Both orders stay cached per option: asking again returns the first answer.
  assert.equal(createWorldWebGlTransparentDrawPlan(plan, camera).length, clipped.length)
})

it('gives textured water no plane: its surface UVs belong to the clipped triangles', () => {
  const texture = { id: 'water.png', width: 1, height: 1, rgba: Uint8Array.of(64, 128, 255, 180) }
  const plan = createWorldWebGlPlan({
    items: [...terrain, water],
    waterMaterials: [{ ...waterMaterials[0], baseColorResourceId: texture.id }],
    terrainTextures: new Map([[texture.id, texture]]),
  })
  assert.equal(plan.waterPlanes.length, 0)
  assert.equal(plan.transparentWaterTriangles, 0)
  assert.equal(plan.transparentTexturedTriangles.length, 1)
})

it('gives a water plane the caustics frames that arrived, the same object while none change', () => {
  const frame = id => ({ id, width: 1, height: 1, data: new Uint8Array([200, 220, 255, 255]) })
  const caustic = {
    ...waterMaterials[0],
    causticsScale: [0.225, 0.225],
    causticsFramesPerSecond: 15,
    causticsFalloff: 1.56,
    causticsResourceId: 'caustics:1',
    causticsFrameResourceIds: ['caustics:1', 'caustics:2'],
  }
  const first = frame('caustics:1')
  const input = {
    items: [...terrain, water],
    waterMaterials: [caustic],
    terrainTextures: new Map([['caustics:1', first]]),
  }
  const early = createWorldWebGlPlan(input).waterPlanes[0].caustics
  assert.deepEqual(early, { frames: [first], scale: [0.225, 0.225], falloff: 1.56, framesPerSecond: 15 })
  assert.equal(createWorldWebGlPlan(input).waterPlanes[0].caustics, early)
  const second = frame('caustics:2')
  const later = createWorldWebGlPlan({
    ...input,
    terrainTextures: new Map([...input.terrainTextures, ['caustics:2', second]]),
  }).waterPlanes[0].caustics
  assert.deepEqual(later.frames, [first, second])
  // No falloff, no caustics: the state casts none.
  const { causticsFalloff: _falloff, ...plain } = caustic
  assert.equal(
    createWorldWebGlPlan({ ...input, waterMaterials: [plain] }).waterPlanes[0].caustics,
    undefined,
  )
})
