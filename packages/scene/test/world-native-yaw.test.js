import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const texture = { id: 'unit.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
const diffuse = {
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
}
const programMaterial = {
  id: 'surface',
  layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: { diffuse },
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
// a triangle whose first vertex points along the model's +X
const model = materials => ({
  state: 'converted',
  sourceKey: materials.length === 0 ? 'plain' : 'programmed',
  complete: true,
  diagnostics: [],
  meshes: [],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      ...(materials.length === 0 ? {} : { materialId: 'surface' }),
      positions: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0.5]),
      indices: Uint16Array.from([0, 1, 2]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
    },
  ],
  materials,
  textures: materials.length === 0 ? [] : [texture],
})
const placed = (objectId, resourceId) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'map-native',
  kind: 'unit',
  objectId,
  position: { x: 10, y: 20, z: 0 },
  sourcePositionDimensions: 2,
  // a quarter turn clockwise seen from above, Westwood's facing 64 × 256
  rotation: 16_384,
  nativeRotationUnit: 'uint16-turn',
  nativeRotationSense: 'clockwise',
  resourceId,
})

it('turns an object placed without its UVW rotation by its native unit and sense, on every path', () => {
  const plan = createWorldWebGlPlan({
    items: [placed(1, 'programmed'), placed(2, 'plain')],
    models: new Map([
      ['programmed', model([programMaterial])],
      ['plain', model([])],
    ]),
  })
  const near = (actual, expected) =>
    expected.every((value, index) => Math.abs(actual[index] - value) < 1e-5)
  // east turned a quarter clockwise is south: map +Y, the world's +z; placed at (10, 0, 20)
  const expected = [10, 0, 21]
  const scene = plan.modelMaterialScenes.flatMap(item => item.primitives)[0]
  const m = scene.transform
  const shared = [0, 1, 2].map(row => m[row] * 1 + m[12 + row])
  assert.ok(near(shared, expected), `shared path ${shared}`)
  const baked = [plan.opaqueTriangles, ...plan.texturedTriangles].find(
    batch => batch.positions.length >= 9,
  )
  assert.ok(
    near([...baked.positions.slice(0, 3)], expected),
    `fallback path ${[...baked.positions.slice(0, 3)]}`,
  )
})
