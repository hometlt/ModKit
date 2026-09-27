import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  createWorldWebGlPlan,
  worldBlendedMaterialPasses,
  worldMaterialBatchesOf,
} from '../src/world/webgl.js'

const item = (objectId, resourceId, x) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId,
  position: { x, y: 0, z: 0 },
  uvwPosition: { x, y: 0, z: 0 },
  resourceId,
})
// One textured triangle with a standard render-model material: 0 opaque, 1 blended.
const model = (key, blend, depthPrepass = false) => ({
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
      blendMode: blend === 1 ? 'blend' : 'opaque',
      layers: [{ slot: 'diffuse', resourceId: `${key}.png`, uvSource: 0 }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: {
                diffuse: {
                  slot: 'diffuse',
                  texturePath: `${key}.png`,
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
              blendMode: blend,
              priority: 0,
              specularity: 10,
              specMult: 1,
              emisMult: 1,
              specMode: 0,
              alphaTestThreshold: 0,
              twoSided: false,
              unshaded: true,
              doubleLambert: false,
              clampOutput: false,
              usesVertexColor: false,
              usesVertexAlpha: false,
              depthPrepass,
            },
          },
        },
      },
    },
  ],
  textures: [{ id: `${key}.png`, width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }],
})
const models = new Map([
  ['rock', model('rock', 0)],
  ['glass', model('glass', 1)],
])

it('draws every placement of one solid model and material in one instanced group', () => {
  const plan = createWorldWebGlPlan({
    items: [item(1, 'rock', 0), item(2, 'rock', 3), item(3, 'rock', 6), item(4, 'glass', 9)],
    models,
  })
  const batches = worldMaterialBatchesOf(plan)
  assert.equal(batches.groups.length, 1)
  const [group] = batches.groups
  assert.equal(group.instances.count, 3)
  // Each placement's model matrix, translation in the last column.
  assert.deepEqual(
    [0, 1, 2].map(index => group.instances.matrices[index * 16 + 12]),
    [0, 3, 6],
  )
  assert.equal(batches.singles.length, 0)
  // The blended glass keeps its per-frame back-to-front order.
  assert.equal(batches.transparentScenes.length, 1)
  assert.equal(worldMaterialBatchesOf(plan), batches)
})

it('keeps a placement with its own tint, such as the selected object, in its own group', () => {
  const plan = createWorldWebGlPlan({
    items: [item(1, 'rock', 0), item(2, 'rock', 3), item(3, 'rock', 6)],
    models,
    selectedObjectId: 3,
  })
  assert.deepEqual(
    worldMaterialBatchesOf(plan)
      .groups.map(group => group.instances.count)
      .sort(),
    [1, 2],
  )
})

it('casts shadows from the same groups as depth-only instanced draws', () => {
  const plan = createWorldWebGlPlan({
    items: [item(1, 'rock', 0), item(2, 'rock', 3), item(4, 'glass', 9)],
    models,
  })
  const casters = worldMaterialBatchesOf(plan, true)
  assert.equal(casters.groups.length, 1)
  assert.equal(casters.groups[0].instances.count, 2)
  for (const group of casters.groups) {
    assert.equal(group.draw.depthOnly, true)
    assert.deepEqual(group.draw.primitive.depthBias, { slopeScale: 1.1, units: 4 })
  }
  assert.equal(
    casters.groups.reduce((count, group) => count + group.instances.count, 0),
    plan.modelMaterialScenes.reduce((count, scene) => count + scene.shadowPrimitives.length, 0),
  )
})

it('leaves depth prepasses to their blended passes, right before each of them', () => {
  const plan = createWorldWebGlPlan({
    items: [item(1, 'rock', 0), item(2, 'crystal', 3), item(3, 'rock', 6), item(4, 'crystal', 9)],
    models: new Map([
      ['rock', model('rock', 0, true)],
      ['crystal', model('crystal', 1, true)],
    ]),
  })
  const batches = worldMaterialBatchesOf(plan)
  // The solid pass writes its own depth: one colour group, no depth-only groups.
  assert.deepEqual(
    batches.groups.map(group => [group.draw.depthOnly === true, group.instances.count]),
    [[false, 2]],
  )
  assert.equal(batches.transparentScenes.length, 2)
  const [solid] = batches.groups
  assert.deepEqual(worldBlendedMaterialPasses(solid.draw), [solid.draw])
  const blended = { ...solid.draw, program: { ...solid.draw.program, blend: 'blend' } }
  const passes = worldBlendedMaterialPasses(blended)
  assert.deepEqual(
    passes.map(draw => draw.depthOnly === true),
    [true, false],
  )
  assert.equal(passes[1], blended)
  const plain = { ...blended, program: { ...blended.program, depthPrepass: false } }
  assert.deepEqual(worldBlendedMaterialPasses(plain), [plain])
})
