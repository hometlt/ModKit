import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  createWorldWebGlPlan,
  worldBlendedMaterialPasses,
  worldMaterialBatchesOf,
  worldWebGlScenePrograms,
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
  const surfaceOf = plan =>
    worldWebGlScenePrograms(plan, sceneOf(plan, 'glow')).get('surface').passes[0]
  const alphaOf = plan => surfaceOf(plan).uniforms.u_diffuseAlphaFactor
  // The glowing material samples its alpha at the object's own clock.
  const at = (time, previous, extra = {}) =>
    createWorldWebGlPlan(
      { items, models, animationTimes: new Map([[2, time]]), ...extra },
      previous,
    )
  const first = at(0)
  const second = at(1, first)
  // The rock does not move or animate: the same scene and pick entry, so its draws keep their group.
  assert.equal(sceneOf(second, 'rock'), sceneOf(first, 'rock'))
  assert.equal(second.picking.objects[0], first.picking.objects[0])
  assert.equal(second.stats.modelTriangles, first.stats.modelTriangles)
  // Only its materials follow the clock: the object is kept with its scene, and the scene stands
  // for programs sampled at the new clock as a plan built anew samples them.
  assert.equal(sceneOf(second, 'glow'), sceneOf(first, 'glow'))
  assert.notEqual(alphaOf(second), alphaOf(first))
  assert.equal(second.picking.objects[1], first.picking.objects[1])
  const fresh = createWorldWebGlPlan({
    items: items.map(entry => ({ ...entry })),
    models,
    animationTimes: new Map([[2, 1]]),
  })
  assert.deepEqual(
    surfaceOf(second).uniforms,
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

it('groups kept draws by the programs they stand for, and builds anew an object whose clock parts', () => {
  const models = new Map([['glow', model('glow', 0, false, true)]])
  const items = [item(1, 'glow', 0), item(2, 'glow', 3), item(3, 'glow', 6)]
  const at = (times, previous, list = items) =>
    createWorldWebGlPlan(
      {
        items: list,
        models,
        animationTimes: new Map(times.map((time, index) => [index + 1, time])),
      },
      previous,
    )
  const groupsOf = plan =>
    worldMaterialBatchesOf(plan).groups.map(group => [
      group.instances.count,
      worldWebGlScenePrograms(
        plan,
        plan.modelMaterialScenes.find(
          scene => scene.primitives[0].transform === group.draw.primitive.transform,
        ),
      ).get('surface').passes[0].uniforms.u_diffuseAlphaFactor,
    ])
  // The three objects share their programs at the first clock: one group.
  const first = at([0, 0, 0])
  assert.deepEqual(
    groupsOf(first).map(([count]) => count),
    [3],
  )
  // All move on together: kept, one group standing for the programs of the new clock.
  const second = at([1, 1, 1], first)
  assert.deepEqual(second.modelMaterialScenes, first.modelMaterialScenes)
  const fresh = times =>
    at(
      times,
      undefined,
      items.map(entry => ({ ...entry })),
    )
  assert.deepEqual(groupsOf(second), groupsOf(fresh([1, 1, 1])))
  // The third object's clock parts from the others: kept programs cannot stand for two clocks, so it
  // is built anew with programs of its own, and groups as a plan built anew groups.
  const third = at([2, 2, 1.5], second)
  assert.equal(third.modelMaterialScenes[0], first.modelMaterialScenes[0])
  assert.notEqual(third.modelMaterialScenes[2], first.modelMaterialScenes[2])
  assert.deepEqual(groupsOf(third), groupsOf(fresh([2, 2, 1.5])))
  // From then on both keep their scenes.
  const fourth = at([3, 3, 2.5], third)
  assert.deepEqual(fourth.modelMaterialScenes, third.modelMaterialScenes)
  assert.deepEqual(groupsOf(fourth), groupsOf(fresh([3, 3, 2.5])))
  // Met at one clock again, kept scenes of different programs draw in one group.
  const fifth = at([4, 4, 4], fourth)
  assert.deepEqual(fifth.modelMaterialScenes, fourth.modelMaterialScenes)
  assert.deepEqual(groupsOf(fifth).map(([count]) => count), [3])
  assert.deepEqual(groupsOf(fifth), groupsOf(fresh([4, 4, 4])))
})

it('rebuilds a kept object when its team colour or model changes, not when the same values come anew', () => {
  const items = [{ ...item(1, 'rock', 0), player: 1 }]
  const models = new Map([['rock', model('rock', 0)]])
  const colours = colour => new Map([[1, colour]])
  const sceneOf = plan => plan.modelMaterialScenes[0]
  const red = colours([1, 0, 0])
  const first = createWorldWebGlPlan({ items, models, teamColors: red })
  const same = createWorldWebGlPlan({ items, models, teamColors: red }, first)
  assert.equal(sceneOf(same), sceneOf(first))
  const blue = createWorldWebGlPlan({ items, models, teamColors: colours([0, 0, 1]) }, same)
  assert.notEqual(sceneOf(blue), sceneOf(first))
  // The same colour in a new map keeps the object.
  const blueAgain = createWorldWebGlPlan({ items, models, teamColors: colours([0, 0, 1]) }, blue)
  assert.equal(sceneOf(blueAgain), sceneOf(blue))
  const reloaded = createWorldWebGlPlan(
    { items, models: new Map([['rock', model('rock', 0)]]), teamColors: colours([0, 0, 1]) },
    blueAgain,
  )
  assert.notEqual(sceneOf(reloaded), sceneOf(blueAgain))
})

it('keeps an object by the models of the plan it builds on, whatever was built in between', () => {
  const items = [item(1, 'rock', 0)]
  const opaque = model('rock', 0)
  const sceneOf = plan => plan.modelMaterialScenes[0]
  const first = createWorldWebGlPlan({ items, models: new Map([['rock', opaque]]) })
  const blended = createWorldWebGlPlan(
    { items, models: new Map([['rock', model('rock', 1)]]) },
    first,
  )
  assert.equal(worldMaterialBatchesOf(blended).transparentScenes.length, 1)
  // Built on the first plan again, with its model: not the blended object built in between.
  const back = createWorldWebGlPlan({ items, models: new Map([['rock', opaque]]) }, first)
  assert.notEqual(sceneOf(back), sceneOf(blended))
  assert.equal(worldMaterialBatchesOf(back).transparentScenes.length, 0)
})

it('keeps mirrored native placements on the CW single-draw path in color and shadow passes', () => {
  const native = objectId => ({
    ...item(objectId, 'rock', objectId),
    uvwPosition: undefined,
    coordinateSpaceId: 'map-native',
    presentationModelReflection: 'z',
  })
  const plan = createWorldWebGlPlan({ items: [native(1), native(2), item(3, 'rock', 3)], models })
  for (const shadow of [false, true]) {
    const b = worldMaterialBatchesOf(plan, shadow)
    assert.equal(b.singles.length, 2)
    assert.equal(b.groups.length, 1)
    assert.equal(b.groups[0].instances.count, 1)
    for (const d of b.singles) assert.ok(d.primitive.transform[10] < 0)
  }
})

it('retains a hidden placement as input but omits its geometry and picking in the chosen preview state', () => {
  const kept = item(1, 'rock', 0),
    hidden = { ...item(2, 'rock', 3), presentationHidden: true }
  const input = { items: [kept, hidden], models }
  const plan = createWorldWebGlPlan(input)
  assert.equal(input.items.length, 2)
  assert.equal(plan.stats.objectInstances, 1)
  assert.equal(plan.picking.objects.length, 1)
  const batch = worldMaterialBatchesOf(plan)
  assert.equal(batch.groups[0].instances.count, 1)
})
