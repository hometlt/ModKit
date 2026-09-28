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
const model = (key, blend, depthPrepass = false, animated = false) => ({
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
                  ...(animated
                    ? {
                        alphaFactor: {
                          value: 1,
                          track: {
                            lineType: 1,
                            globalSeqId: null,
                            keys: [
                              { frame: 0, vector: [0.25] },
                              { frame: 2, vector: [0.75] },
                            ],
                          },
                        },
                      }
                    : {}),
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

it('keeps an object in later plans until its clock or inputs change', () => {
  const models = new Map([
    ['rock', model('rock', 0)],
    ['glow', model('glow', 0, false, true)],
  ])
  const items = [item(1, 'rock', 0), item(2, 'glow', 3)]
  const sceneOf = (plan, key) =>
    plan.modelMaterialScenes.find(scene => scene.primitives[0].id === `${key}-triangle`)
  const alphaOf = plan =>
    sceneOf(plan, 'glow').programs.get('surface').passes[0].uniforms.u_diffuseAlphaFactor
  // The glowing material samples its alpha at the object's own clock.
  const at = (time, previous, extra = {}) =>
    createWorldWebGlPlan({ items, models, animationTimes: new Map([[2, time]]), ...extra }, previous)
  const first = at(0)
  const second = at(1, first)
  // The rock does not move or animate: the same scene and pick entry, so its draws keep their group.
  assert.equal(sceneOf(second, 'rock'), sceneOf(first, 'rock'))
  assert.equal(second.picking.objects[0], first.picking.objects[0])
  assert.equal(second.stats.modelTriangles, first.stats.modelTriangles)
  assert.notEqual(sceneOf(second, 'glow'), sceneOf(first, 'glow'))
  assert.notEqual(alphaOf(second), alphaOf(first))
  // Only its materials follow the clock: the object is kept, and its programs are sampled at the
  // new clock as a plan built anew samples them.
  assert.equal(second.picking.objects[1], first.picking.objects[1])
  assert.equal(sceneOf(second, 'glow').primitives, sceneOf(first, 'glow').primitives)
  const fresh = createWorldWebGlPlan({
    items: items.map(entry => ({ ...entry })),
    models,
    animationTimes: new Map([[2, 1]]),
  })
  assert.deepEqual(
    sceneOf(second, 'glow').programs.get('surface').passes[0].uniforms,
    sceneOf(fresh, 'glow').programs.get('surface').passes[0].uniforms,
  )
  // Its clock unchanged, the glowing object is kept as well.
  const third = at(1, second, { timeSeconds: 5 })
  assert.equal(sceneOf(third, 'glow'), sceneOf(second, 'glow'))
  // Selection tints the rock, and a reloaded model is a new input: both rebuild it.
  const selected = at(1, third, { selectedObjectId: 1 })
  assert.notEqual(sceneOf(selected, 'rock'), sceneOf(third, 'rock'))
  assert.ok(sceneOf(selected, 'rock').primitives[0].tint !== undefined)
  const reloaded = createWorldWebGlPlan(
    {
      items,
      models: new Map([...models, ['rock', model('rock', 0)]]),
      animationTimes: new Map([[2, 1]]),
    },
    third,
  )
  assert.notEqual(sceneOf(reloaded, 'rock'), sceneOf(third, 'rock'))
  assert.deepEqual(
    worldMaterialBatchesOf(reloaded).groups.map(group => group.instances.count),
    worldMaterialBatchesOf(third).groups.map(group => group.instances.count),
  )
})

it('keeps the instance matrices of groups whose placements did not change between plans', () => {
  const models = new Map([
    ['rock', model('rock', 0)],
    ['glow', model('glow', 0, false, true)],
  ])
  const items = [item(1, 'rock', 0), item(2, 'rock', 5), item(3, 'glow', 3)]
  const at = (time, previous, list = items) =>
    createWorldWebGlPlan({ items: list, models, animationTimes: new Map([[3, time]]) }, previous)
  const matricesOf = plan =>
    new Map(
      worldMaterialBatchesOf(plan).groups.map(group => [
        group.draw.primitive.id,
        group.instances.matrices,
      ]),
    )
  const firstPlan = at(0)
  const first = matricesOf(firstPlan)
  const secondPlan = at(1, firstPlan)
  const second = matricesOf(secondPlan)
  // The rocks keep their placements; the glowing object samples a new program at its new clock,
  // which changes its group but not where it stands.
  assert.equal(second.get('rock-triangle'), first.get('rock-triangle'))
  assert.equal(second.get('glow-triangle'), first.get('glow-triangle'))
  // A rock moved elsewhere is a new placement list.
  const moved = matricesOf(at(1, secondPlan, [items[0], item(2, 'rock', 7), items[2]]))
  assert.notEqual(moved.get('rock-triangle'), first.get('rock-triangle'))
  assert.notDeepEqual([...moved.get('rock-triangle')], [...first.get('rock-triangle')])
})
