import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createModelSkeletonNodes } from '@modkit/codec-kit/model/skeleton'
import { createModelSceneSampler } from '../src/model/sampler.js'
import {
  DEFAULT_WORLD_WEBGL_CAMERA,
  createWorldWebGlPlan,
  createWorldWebGlRenderer,
  pickWorldWebGl,
  worldMaterialBatchesOf,
  worldPosingView,
  worldWebGlPosedScene,
  worldWebGlScenePrograms,
} from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = { id: 'surface.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
// An opaque render-model material: its primitives take the shared (instanced) path.
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
const inverse = (x, y) => {
  const result = [...identity]
  result[12] = -x
  result[13] = -y
  return result
}
const bone = (index, parent, translation, ibm) => ({
  partId: `part-${index}`,
  nodeId: `node-${index}`,
  hierarchyId: 'rig',
  boneIndex: index,
  parentBoneIndex: parent,
  boneName: `joint-${index}`,
  provenance: 'direct',
  localPose: { translation, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  inverseBindMatrix: ibm,
})
const bindings = [bone(3, 9, [0, 2, 0], inverse(10, 2)), bone(9, null, [10, 0, 0], inverse(10, 0))]
// The Stand clip lifts the root and turns it a quarter about z.
const clip = {
  id: 'stand',
  name: 'Stand',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  channels: [
    ['translation', [10, 0, 0], [10, 3, 0]],
    ['rotation', [0, 0, 0, 1], [0, 0, Math.SQRT1_2, Math.SQRT1_2]],
  ].map(([kind, a, b]) => ({
    target: 'node-9',
    kind,
    firstFrame: 0,
    lastFrame: 1,
    interpolation: kind === 'rotation' ? 'spherical-linear' : 'linear',
    samples: [
      { frame: 0, timeSeconds: 0, value: a },
      { frame: 1, timeSeconds: 1, value: b },
    ],
  })),
}
const nodes = createModelSkeletonNodes(bindings, 'rig').map(node => ({
  ...node,
  childIds: [...node.childIds],
  meshIds: node.id === 'node-9' ? ['mesh'] : [],
}))
const skin = {
  id: 'triangle',
  hierarchyId: 'rig',
  topology: 'triangles',
  materialId: 'surface',
  positions: Float32Array.of(10, 0, 0, 10, 2, 0, 11, 1, 0),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  tangents: Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
  boneIndices: Uint32Array.of(9, 9, 9, 9, 3, 9, 9, 9, 9, 3, 9, 9),
  boneWeights: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0),
}
const model = {
  state: 'converted',
  sourceKey: 'skinned',
  complete: true,
  diagnostics: [],
  nodes,
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  primitives: [skin],
  skeleton: bindings,
  animations: [clip],
  materials: [material],
  textures: [texture],
}
const world = timeSeconds => ({
  items: [
    {
      facet: 'objects',
      id: 'object-1',
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'unit',
      objectId: 1,
      position: { x: 0, y: 0, z: 0 },
      uvwPosition: { x: 0, y: 0, z: 0 },
      resourceId: 'skinned',
    },
  ],
  models: new Map([['skinned', model]]),
  timeSeconds,
})
const cpuPose = time =>
  createModelSceneSampler(
    { nodes, meshes: model.meshes, primitives: [skin], skeleton: bindings },
    { clip },
  ).sample(time).primitives[0]

it('draws a skin from its bind-pose arrays with each clock its palette, and picks it posed', () => {
  let plan
  const drawn = []
  for (const time of [0.25, 0.5]) {
    plan = createWorldWebGlPlan(world(time), plan)
    const primitive = plan.modelMaterialScenes.flatMap(scene => scene.primitives)[0]
    // The drawn vertices are the model's own arrays: uploaded once, posed by the vertex stage.
    assert.equal(primitive.positions, skin.positions)
    assert.equal(primitive.normals, skin.normals)
    drawn.push(primitive.skin.palette)
    // Its shadow and colour groups carry the pose.
    for (const shadow of [false, true]) {
      const group = worldMaterialBatchesOf(plan, shadow).groups[0]
      assert.equal(group.draw.primitive.skin.palette, primitive.skin.palette)
      assert.deepEqual(group.instances.palettes, [primitive.skin.palette])
    }
    // Picking reads the pose on the CPU.
    const [entry] = plan.picking.objects[0].primitives
    assert.deepEqual([...entry.primitive.positions], [...cpuPose(time).positions])
    assert.ok(entry.maximum[1] > 2)
  }
  assert.notEqual(drawn[0], drawn[1])
  assert.notDeepEqual([...drawn[0]], [...drawn[1]])
})

it('draws placements of one skin at other clocks as one group, each placement with its pose', () => {
  const placed = (objectId, x) => ({
    ...world(0).items[0],
    id: `object-${objectId}`,
    objectId,
    position: { x, y: 0, z: 0 },
    uvwPosition: { x, y: 0, z: 0 },
  })
  const input = {
    ...world(0),
    items: [placed(1, 0), placed(2, 5)],
    animationTimes: new Map([
      [1, 0.25],
      [2, 0.5],
    ]),
  }
  const plan = createWorldWebGlPlan(input)
  const primitives = plan.modelMaterialScenes.flatMap(scene => scene.primitives)
  assert.equal(primitives.length, 2)
  const [first, second] = primitives.map(primitive => primitive.skin.palette)
  assert.notEqual(first, second)
  for (const shadow of [false, true]) {
    const { groups } = worldMaterialBatchesOf(plan, shadow)
    assert.equal(groups.length, 1)
    assert.equal(groups[0].instances.count, 2)
    assert.deepEqual(groups[0].instances.palettes, [first, second])
  }
  // the same poses again: the same list, which the kept shadow keys its caster by
  const again = createWorldWebGlPlan(input, plan)
  assert.equal(
    worldMaterialBatchesOf(again, true).groups[0].instances.palettes,
    worldMaterialBatchesOf(plan, true).groups[0].instances.palettes,
  )
})

it('keeps the scenes of placed skins while they play, each plan equal to one built anew', async () => {
  // The same model with an alpha that plays, drawn by the fallback (no material), holding a tool at
  // a socket that moves with the clip, and blinking out half way through it (a visibility track).
  const alpha = {
    value: 1,
    track: {
      lineType: 1,
      globalSeqId: null,
      keys: [
        { frame: 0, vector: [0.25] },
        { frame: 2, vector: [0.75] },
      ],
    },
  }
  const { diffuse } = material.shader.parameters.renderModel.standard.layers
  const glowing = {
    ...model,
    materials: [
      {
        ...material,
        shader: {
          ...material.shader,
          parameters: {
            renderModel: {
              ...material.shader.parameters.renderModel,
              standard: {
                ...material.shader.parameters.renderModel.standard,
                layers: { diffuse: { ...diffuse, alphaFactor: alpha } },
              },
            },
          },
        },
      },
    ],
  }
  // Object-space normals take each draw's own normal matrix: its draws draw alone, not instanced.
  const mapped = {
    ...model,
    materials: [
      {
        ...material,
        layers: [...material.layers, { slot: 'normal', resourceId: texture.id, uvSource: 0 }],
        shader: {
          ...material.shader,
          parameters: {
            renderModel: {
              ...material.shader.parameters.renderModel,
              standard: {
                ...material.shader.parameters.renderModel.standard,
                layers: { diffuse, normal: { ...diffuse, slot: 'normal' } },
                normalMapFormat: 'rgb8',
                normalMapSpace: 'object',
              },
            },
          },
        },
      },
    ],
  }
  const holder = { ...model, sockets: [{ id: 'tip', nodeId: 'node-3', role: 'attach' }] }
  const tool = {
    state: 'converted',
    sourceKey: 'tool',
    complete: true,
    diagnostics: [],
    primitives: [
      {
        id: 'tool',
        topology: 'triangles',
        materialId: 'surface',
        positions: Float32Array.of(0, 0, 0, 0.5, 0, 0, 0, 0.5, 0),
        textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      },
    ],
    materials: [material],
    textures: [texture],
  }
  const blinking = {
    ...model,
    animations: [
      {
        ...clip,
        channels: [
          ...clip.channels,
          {
            target: 'triangle',
            kind: 'visibility',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'step',
            samples: [
              { frame: 0, timeSeconds: 0, value: [1] },
              { frame: 1, timeSeconds: 0.5, value: [0] },
            ],
          },
        ],
      },
    ],
  }
  const stand = { name: 'Stand', groups: [], loop: true, speed: 1 }
  // The pose a skin takes on the GPU at a time of the clip.
  const gpuPalette = time =>
    createModelSceneSampler(
      { nodes, meshes: model.meshes, primitives: [skin], skeleton: bindings },
      { clip, skinning: 'gpu' },
    ).sample(time).primitives[0].skin.palette
  const placed = (index, resourceId, extra = {}) => ({
    facet: 'objects',
    id: `objects:unit:${index}`,
    layerId: 'objects',
    coordinateSpaceId: 'uvw',
    kind: 'unit',
    objectId: index + 1,
    position: { x: (index % 8) * 3, y: 0, z: Math.floor(index / 8) * 3 },
    uvwPosition: { x: (index % 8) * 3, y: 0, z: Math.floor(index / 8) * 3 },
    resourceId,
    ...extra,
  })
  // Blocks of 32 objects: the first holds copies in step and copies at random phases, which a plan
  // takes whole; the second the other kinds, its holder built anew at every clock; the third a copy
  // drawn by the fallback, taken whole while the clock stays.
  const kinds = new Map([
    [32, 'skinned'],
    [33, 'glowing'],
    [34, 'holder'],
    [35, 'blinking'],
    [36, 'mapped'],
    [80, 'bare'],
  ])
  const items = Array.from({ length: 96 }, (_, index) =>
    placed(index, kinds.get(index) ?? 'skinned', {
      presentationAnimation: { ...stand, randomStart: index < 32 && index % 2 === 1 },
      ...(index === 34
        ? {
            modelComponents: [
              { id: 'body', resourceId: 'holder' },
              { id: 'tool', resourceId: 'tool', parentId: 'body', parentSocketId: 'tip' },
            ],
          }
        : {}),
    }),
  )
  const input = {
    items,
    models: new Map([
      ['skinned', model],
      ['glowing', glowing],
      ['bare', { ...model, materials: [], textures: [] }],
      ['holder', holder],
      ['mapped', mapped],
      ['tool', tool],
      ['blinking', blinking],
    ]),
  }
  // The 33rd object in step with the others, then at a time of its own, then with them again.
  const own = time => new Map([[33, time]])
  const steps = [
    { ...input, timeSeconds: 0.1 },
    { ...input, timeSeconds: 0.2 },
    // the clock stays: every pose with it, and a block holding the fallback copy is taken whole
    { ...input, timeSeconds: 0.2 },
    { ...input, timeSeconds: 0.2 },
    { ...input, timeSeconds: 0.3 },
    { ...input, timeSeconds: 0.4, animationTimes: own(0.9) },
    { ...input, timeSeconds: 0.5, animationTimes: own(0.9) },
    { ...input, timeSeconds: 0.6, animationTimes: own(0.6) },
    { ...input, timeSeconds: 0.7, animationTimes: own(0.7) },
    { ...input, timeSeconds: 0.8 },
    { ...input, timeSeconds: 0.9 },
    { ...input, timeSeconds: 1.3, selectedObjectId: 2 },
    { ...input, timeSeconds: 1.4 },
    { ...input, timeSeconds: 1.5 },
    // Items moved, turned and shaded in place, as the RTS preview moves its units: with the clock,
    // while it stays, and shaded alone; then the clock moves on.
    { ...input, timeSeconds: 1.6 },
    { ...input, timeSeconds: 1.6 },
    { ...input, timeSeconds: 1.7 },
    { ...input, timeSeconds: 1.8 },
  ]
  const turned = (item, x, angle) =>
    Object.assign(item, {
      uvwPosition: { ...item.uvwPosition, x },
      uvwRotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
    })
  const changes = new Map([
    [14, () => turned(items[5], 40, 0.5)],
    [15, () => turned(items[7], 41, 1)],
    [16, () => Object.assign(items[9], { presentationTint: [0.25, 0.25, 0.25] })],
  ])
  // A kept scene keeps the programs and skins it was built with, and a plan draws what they stand
  // for (worldWebGlScenePrograms, worldWebGlPosedScene): its scenes are compared as posed, every
  // program as the one it stands for. The draws carry their poses themselves.
  const values = (module, plan) => {
    const standing = new Map()
    for (const scene of plan.modelMaterialScenes) {
      const programs = module.worldWebGlScenePrograms(plan, scene)
      for (const [id, entry] of scene.programs) {
        const now = programs.get(id)
        if (now === entry) continue
        standing.set(entry, now)
        entry.passes.forEach((pass, index) => standing.set(pass, now.passes[index]))
      }
    }
    const posed = scene => module.worldWebGlPosedScene(plan, scene)
    const batches = shadow => {
      const grouped = module.worldMaterialBatchesOf(plan, shadow)
      return { ...grouped, transparentScenes: grouped.transparentScenes.map(posed) }
    }
    return JSON.stringify(
      {
        plan: { ...plan, modelMaterialScenes: plan.modelMaterialScenes.map(posed) },
        main: batches(false),
        shadow: batches(true),
      },
      (_, value) => {
        const stood = standing.get(value) ?? value
        if (stood instanceof Map) return [...stood]
        if (ArrayBuffer.isView(stood)) return Array.from(stood)
        // A draw prepared by one module is rebound by the other (preparedMaterialGeometry is
        // shared): the same values with the keys in another order.
        if (stood === null || typeof stood !== 'object' || Array.isArray(stood)) return stood
        return Object.fromEntries(
          Object.keys(stood)
            .sort()
            .map(key => [key, stood[key]]),
        )
      },
    )
  }
  let plan = createWorldWebGlPlan({ ...input, timeSeconds: 0 })
  let posedScenes = 0
  for (const [index, step] of steps.entries()) {
    changes.get(index)?.()
    const previous = plan
    plan = createWorldWebGlPlan(step, previous)
    // Built anew: a module of its own keeps nothing of earlier plans.
    const fresh = await import(`../src/world/webgl.js?skins-${index}`)
    assert.equal(
      values({ worldMaterialBatchesOf, worldWebGlPosedScene, worldWebGlScenePrograms }, plan),
      values(fresh, fresh.createWorldWebGlPlan(step)),
    )
    for (const scene of plan.modelMaterialScenes)
      if (worldWebGlPosedScene(plan, scene) !== scene) posedScenes += 1
    // The first copy keeps its scene while only the clock moves, posed at each clock.
    if (index === 1 || index === 4 || index === 10) {
      const [scene] = plan.modelMaterialScenes
      assert.equal(scene, previous.modelMaterialScenes[0])
      assert.notEqual(worldWebGlPosedScene(plan, scene), scene)
      assert.deepEqual(
        worldWebGlPosedScene(plan, scene).primitives[0].skin.palette,
        gpuPalette(step.timeSeconds),
      )
    }
  }
  assert.ok(posedScenes > 0)
})

// Four placements along x, each at a clock of its own (no two share a pose); the same items and
// models from plan to plan, as a viewer keeps them.
const spread = (() => {
  const placed = (objectId, x) => ({
    ...world(0).items[0],
    id: `object-${objectId}`,
    objectId,
    position: { x, y: 0, z: 0 },
    uvwPosition: { x, y: 0, z: 0 },
  })
  const base = world(0)
  const items = [0, -28, 60, 100].map((x, index) => placed(index + 1, x))
  return times => ({
    ...base,
    items,
    animationTimes: new Map(times.map((time, index) => [index + 1, time])),
  })
})()

it('leaves kept skins no view can see in the pose they have, posed again once one sees them', () => {
  const input = spread
  const gpuPalette = time =>
    createModelSceneSampler(
      { nodes, meshes: model.meshes, primitives: [skin], skeleton: bindings },
      { clip, skinning: 'gpu' },
    ).sample(time).primitives[0].skin.palette
  const posed = plan =>
    plan.modelMaterialScenes.map(scene => [
      ...worldWebGlPosedScene(plan, scene).primitives[0].skin.palette,
    ])
  const expected = times => times.map(time => [...gpuPalette(time)])
  // an orthographic view of x and y within ±20 and depth within ±100 (column-major)
  const ortho = (half, depth) =>
    Float32Array.of(1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, -1 / depth, 0, 0, 0, 0, 1)
  const first = createWorldWebGlPlan(input([0.1, 0.2, 0.3, 0.4]))
  const next = input([0.5, 0.6, 0.7, 0.8])
  // The skin's bounds reach about 4.6 from (9.6, 2.9) of its placement: the placement at -28 crosses
  // the view's edge, those at 60 and 100 cannot reach into the view, nor their shadows straight down
  // or away from it.
  for (const direction of [undefined, [0, -1, 0], [1, -1, 0]]) {
    const light = direction === undefined ? undefined : { direction }
    const plan = createWorldWebGlPlan(next, first, worldPosingView(ortho(20, 100), 0.5, light))
    assert.deepEqual(posed(plan), expected([0.5, 0.6, 0.3, 0.4]))
    // kept as they were: the same scenes
    assert.equal(plan.modelMaterialScenes[2], first.modelMaterialScenes[2])
    assert.equal(plan.modelMaterialScenes[3], first.modelMaterialScenes[3])
  }
  // a light that carries their shadows toward the view, a view that sees them, or none: posed
  for (const view of [
    worldPosingView(ortho(20, 100), 0.5, { direction: [-1, -1, 0] }),
    worldPosingView(ortho(200, 100), 0.5),
    undefined,
  ])
    assert.deepEqual(posed(createWorldWebGlPlan(next, first, view)), expected([0.5, 0.6, 0.7, 0.8]))
  // a plan made again with a view that sees them, after one that did not, poses them at its clock
  const unseen = createWorldWebGlPlan(next, first, worldPosingView(ortho(20, 100), 0.5))
  const seen = createWorldWebGlPlan(next, unseen, worldPosingView(ortho(200, 100), 0.5))
  assert.deepEqual(posed(seen), expected([0.5, 0.6, 0.7, 0.8]))
})

it("keeps a renderer's plan while its view sees no skin left unposed, made again once it sees one", () => {
  // only shader allocation is needed until a draw: picking runs the renderer's plans
  const noop = () => {}
  const gl = {
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    deleteProgram: noop,
    createVertexArray: () => ({}),
    drawArrays: noop,
    getExtension: () => null,
  }
  const renderer = createWorldWebGlRenderer({ getContext: () => gl })
  const screen = { x: 32, y: 32, width: 64, height: 64 }
  // a view of the first placement, and one of them all
  const near = { ...DEFAULT_WORLD_WEBGL_CAMERA, frame: { center: [0, 0, 0], radius: 20 } }
  const wide = { ...DEFAULT_WORLD_WEBGL_CAMERA, frame: { center: [50, 0, 0], radius: 200 } }
  renderer.pick({ ...spread([0.1, 0.2, 0.3, 0.4]), camera: near }, screen)
  const next = spread([0.5, 0.6, 0.7, 0.8])
  renderer.pick({ ...next, camera: near }, screen)
  assert.equal(renderer.stats().worldObjectsUnposed, 2)
  renderer.pick({ ...next, camera: near }, screen)
  assert.deepEqual(
    [renderer.stats().worldPlanReuses, renderer.stats().worldPlanViewRebuilds],
    [1, 0],
  )
  // the view that sees them makes the plan again, posing them as a plan made anew does
  const seen = { ...next, camera: wide }
  assert.deepEqual(renderer.pick(seen, screen), pickWorldWebGl(seen, screen))
  assert.deepEqual(
    [renderer.stats().worldPlanReuses, renderer.stats().worldPlanViewRebuilds],
    [1, 1],
  )
  assert.equal(renderer.stats().worldObjectsUnposed, 2)
  renderer.pick(seen, screen)
  assert.equal(renderer.stats().worldPlanReuses, 2)
})
