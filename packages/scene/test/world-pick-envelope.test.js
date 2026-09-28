import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

const texture = { id: 'surface.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
// An opaque render-model material: its primitives take the shared (instanced) path with pick entries.
const material = {
  id: 'surface',
  layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: {
              slot: 'diffuse',
              texturePath: texture.id,
              constantColor: { value: [1, 1, 1, 1] },
              uvSource: 0,
              channels: 0,
              op: 6,
              teamColorMode: 0,
              invert: false,
              clampResult: true,
              wrapX: true,
              wrapY: true,
            },
          },
          blendMode: 0,
          priority: 0,
          specularity: 10,
          specMult: 1,
          emisMult: 1,
          specMode: 0,
          alphaTestThreshold: 0,
          twoSided: true,
          unshaded: true,
          doubleLambert: false,
          clampOutput: false,
          usesVertexColor: false,
          usesVertexAlpha: false,
        },
      },
    },
  },
}
const model = (key, positions) => ({
  state: 'converted',
  sourceKey: key,
  complete: true,
  diagnostics: [],
  meshes: [],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from(positions),
      indices: Uint16Array.of(0, 1, 2),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
    },
  ],
  materials: [material],
  textures: [texture],
})
const object = (objectId, resourceId, x) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'unit',
  objectId,
  position: { x, y: 0, z: 0 },
  uvwPosition: { x, y: 0, z: 0 },
  uvwRotation: [0, Math.sin(Math.PI / 7), 0, Math.cos(Math.PI / 7)],
  uvwScale: { x: 1.5, y: 1, z: 0.75 },
  resourceId,
})
// A large leaning triangle, and small ones placed inside its bounds or reaching above them.
const large = model('large', [-10, 0, -10, 10, 10, -10, 0, 0, 10])
const inside = model('inside', [-1, 4, -1, 1, 5, 0, 0, 6, 1])
const above = model('above', [-1, 4, -1, 1, 25, 0, 0, 6, 1])
// The world bounds of a pick entry's vertices, as the plan transforms them.
const exactBounds = entry => {
  const { positions, transform: m } = entry.primitive
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    const [x, y, z] = [positions[offset], positions[offset + 1], positions[offset + 2]]
    const world = [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]
    for (const axis of [0, 1, 2]) {
      minimum[axis] = Math.min(minimum[axis], world[axis])
      maximum[axis] = Math.max(maximum[axis], world[axis])
    }
  }
  return { minimum, maximum }
}
const planOf = (...models) =>
  createWorldWebGlPlan({
    items: models.map(([key], index) => object(index + 1, key, index * 0.5)),
    models: new Map(models),
  })

it('bounds a plan exactly by its objects, reading only the bounds an envelope needs', () => {
  const alone = planOf(['large', large])
  const withInside = planOf(['large', large], ['inside', inside])
  // An object inside the bounds so far leaves them exactly as they are.
  assert.deepEqual(withInside.bounds, alone.bounds)
  const withAbove = planOf(['large', large], ['above', above])
  const reaching = exactBounds(withAbove.picking.objects[1].primitives[0])
  assert.equal(withAbove.bounds.maximum[1], reaching.maximum[1])
  assert.ok(withAbove.bounds.maximum[1] > alone.bounds.maximum[1])
  // Every pick entry reads the exact bounds of its vertices, the envelope holds them.
  for (const plan of [alone, withInside, withAbove])
    for (const pick of plan.picking.objects)
      for (const entry of pick.primitives) {
        const { minimum, maximum } = exactBounds(entry)
        assert.deepEqual([...entry.minimum], minimum)
        assert.deepEqual([...entry.maximum], maximum)
        for (const axis of [0, 1, 2]) {
          assert.ok(entry.envelope[axis] <= minimum[axis])
          assert.ok(entry.envelope[axis + 3] >= maximum[axis])
        }
      }
})

it('refuses a non-finite model coordinate inside the bounds, as outside them', () => {
  const broken = model('broken', [-1, 4, -1, 1, Number.NaN, 0, 0, 6, 1])
  assert.throws(() => planOf(['large', large], ['broken', broken]), /non-finite model coordinate/)
  assert.throws(() => planOf(['broken', broken]), /non-finite model coordinate/)
})
