import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeUvmContainer } from '@modkit/uv/model/container'
import {
  createWorldWebGlPlan,
  createWorldWebGlRenderer,
  pickWorldWebGl,
} from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = id => ({ id, width: 1, height: 1, rgba: Uint8Array.of(80, 160, 200, 255) })
const actor = {
  facet: 'objects',
  id: 'actor',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  resourceId: 'actor',
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
}
function animatedModel() {
  return {
    state: 'converted',
    sourceKey: 'actor',
    complete: true,
    diagnostics: [],
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    skeleton: [
      {
        partId: 'triangle',
        boneIndex: 0,
        boneName: 'root',
        provenance: 'direct',
        hierarchyId: 'skin',
        parentBoneIndex: null,
        nodeId: 'root',
        localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        inverseBindMatrix: identity,
      },
    ],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
      },
    ],
    animations: [
      {
        id: 'stand',
        name: 'Stand',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        looping: true,
        channels: [
          {
            target: 'root',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [0, 2, 0] },
            ],
          },
        ],
      },
    ],
  }
}
function world() {
  const terrain = Array.from({ length: 9 }, (_, i) => ({
    facet: 'terrain',
    id: `ground:${i}`,
    layerId: 'ground',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x: i % 3, y: 0, z: -Math.floor(i / 3) },
  }))
  return {
    items: [
      ...terrain,
      {
        facet: 'water',
        id: 'water',
        layerId: 'water',
        coordinateSpaceId: 'uvw',
        zoneId: 0,
        templateId: 'water',
        materialId: 'water',
        minimum: { x: 0, y: 0 },
        maximum: { x: 2, y: 2 },
        uvwMinimum: { x: 0, z: -2 },
        uvwMaximum: { x: 2, z: 0 },
        uvwElevation: 0.5,
      },
      actor,
    ],
    models: new Map([['actor', animatedModel()]]),
    terrainMaterials: [{ materialId: 'ground', baseColorResourceId: 'ground.png' }],
    terrainWeightRasters: [
      {
        resourceId: 'weights',
        width: 1,
        height: 1,
        materialIds: ['ground'],
        encoding: 'rgba8-unorm',
        normalization: 'sum',
      },
    ],
    terrainTextures: new Map([
      ['ground.png', texture('ground.png')],
      ['water.png', texture('water.png')],
      ['weights', { ...texture('weights'), rgba: Uint8Array.of(255, 0, 0, 0) }],
    ]),
    waterMaterials: [
      {
        materialId: 'water',
        baseColorResourceId: 'water.png',
        scroll: [0.25, 0.5],
        shorelineMode: 'terrain-clipped',
      },
    ],
    timeSeconds: 0,
  }
}
it('retains exact terrain/splat/picking arrays while default actors and water advance, with fresh-plan parity', () => {
  const input = world()
  const initial = createWorldWebGlPlan(input)
  const movedInput = { ...input, timeSeconds: 0.5 }
  const moved = createWorldWebGlPlan(movedInput, initial)
  assert.equal(moved.splatTriangles, initial.splatTriangles)
  assert.equal(moved.picking.terrainTriangles, initial.picking.terrainTriangles)
  assert.notDeepEqual(moved.opaqueTriangles.positions, initial.opaqueTriangles.positions)
  assert.notDeepEqual(
    moved.transparentTexturedTriangles[0].textureCoordinates,
    initial.transparentTexturedTriangles[0].textureCoordinates,
  )
  assert.deepEqual(moved, createWorldWebGlPlan(movedInput))
  const seekInput = { ...movedInput, animationTimes: new Map([[1, 0.25]]) }
  const seek = createWorldWebGlPlan(seekInput, moved)
  assert.equal(seek.splatTriangles, initial.splatTriangles)
  assert.notDeepEqual(seek.opaqueTriangles.positions, moved.opaqueTriangles.positions)
  assert.deepEqual(seek, createWorldWebGlPlan(seekInput))
})

it('invalidates ground preparation for every structural/presentation revision, including replaced map entries', () => {
  const input = world()
  const initial = createWorldWebGlPlan(input)
  const variants = [
    { items: input.items.map((item, i) => (i === 0 ? { ...item, ambientOcclusion: 0.25 } : item)) },
    { models: new Map([['actor', { ...input.models.get('actor'), sourceKey: 'revision:2' }]]) },
    { terrainMaterials: [{ ...input.terrainMaterials[0], normalResourceId: 'normal.png' }] },
    { terrainWeightRasters: [{ ...input.terrainWeightRasters[0] }] },
    { terrainTextures: new Map([...input.terrainTextures, ['ground.png', texture('ground.png')]]) },
    { waterMaterials: [{ ...input.waterMaterials[0], scroll: [1, 0] }] },
    { selectedObjectId: 1 },
    { selectedObjectId: 1, previewPosition: { x: 2, y: 1, z: 3 } },
    { teamColors: new Map([[0, [1, 0, 0]]]) },
  ]
  for (const variant of variants) {
    const changed = { ...input, ...variant }
    const plan = createWorldWebGlPlan(changed, initial)
    assert.notEqual(plan.picking.terrainTriangles, initial.picking.terrainTriangles)
    assert.deepEqual(plan, createWorldWebGlPlan(changed))
  }
  input.models.set('actor', { ...input.models.get('actor'), sourceKey: 'replaced-in-map' })
  const replaced = createWorldWebGlPlan(input, initial)
  assert.notEqual(replaced.picking.terrainTriangles, initial.picking.terrainTriangles)
})

it('rebuilds animated cliff caps and their adjoining terrain, but retains them for static cliffs', () => {
  const input = world()
  input.items = input.items.map(item =>
    item === actor ? { ...actor, derivedFrom: 'cliffs', typeId: 'CliffNatural:fixture' } : item,
  )
  const initial = createWorldWebGlPlan(input)
  const movedInput = { ...input, timeSeconds: 0.5 }
  const moved = createWorldWebGlPlan(movedInput, initial)
  assert.notEqual(moved.splatTriangles, initial.splatTriangles)
  assert.notDeepEqual(moved.splatTriangles[0].positions, initial.splatTriangles[0].positions)
  assert.deepEqual(moved, createWorldWebGlPlan(movedInput))
  const staticInput = {
    ...input,
    models: new Map([
      [
        'actor',
        {
          ...animatedModel(),
          animations: [
            {
              ...animatedModel().animations[0],
              channels: [],
            },
          ],
        },
      ],
    ]),
  }
  const staticPlan = createWorldWebGlPlan(staticInput)
  const staticMoved = createWorldWebGlPlan({ ...staticInput, timeSeconds: 0.5 }, staticPlan)
  assert.equal(staticMoved.splatTriangles, staticPlan.splatTriangles)
  assert.deepEqual(staticMoved, createWorldWebGlPlan({ ...staticInput, timeSeconds: 0.5 }))
})

// These tests use picking to exercise the production retained-plan owner without pretending to
// measure GPU pixels. Only shader allocation is required until draw() is called.
function canvasForPicking() {
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
  return { getContext: () => gl }
}

it('renderer picking reuses its retained plan, counts dynamic updates honestly and matches standalone picks', () => {
  const renderer = createWorldWebGlRenderer(canvasForPicking())
  const input = world(),
    screen = { x: 32, y: 32, width: 64, height: 64 }
  assert.deepEqual(renderer.pick(input, screen), pickWorldWebGl(input, screen))
  renderer.pick(input, screen)
  assert.equal(renderer.stats().worldPlanBuilds, 1)
  assert.equal(renderer.stats().worldPlanReuses, 1)
  const next = { ...input, timeSeconds: 0.5 }
  assert.deepEqual(renderer.pick(next, screen), pickWorldWebGl(next, screen))
  assert.equal(renderer.stats().worldPlanBuilds, 1)
  assert.equal(renderer.stats().worldPlanBuildSamples, 1)
  assert.equal(renderer.stats().worldPlanDynamicUpdates, 1)
  assert.equal(renderer.stats().worldPlanDynamicUpdateSamples, 1)
  renderer.pick({ ...next, selectedObjectId: 1 }, screen)
  assert.equal(renderer.stats().worldPlanBuilds, 2)
  renderer.dispose()
  assert.equal(renderer.stats().worldPlanBytesRetained, 0)
  assert.throws(() => renderer.pick(next, screen), /disposed/)
})

function effectModel({ decal = false } = {}) {
  const layer = (slot, animated = false) => ({
    slot,
    texturePath: 'effect.png',
    constantColor: { value: [1, 1, 1, 1] },
    uvSource: 0,
    channels: slot === 'alpha1' ? 4 : 0,
    op: 2,
    teamColorMode: 0,
    invert: false,
    clampResult: true,
    wrapX: true,
    wrapY: true,
    ...(animated
      ? {
          colorMultiply: {
            value: 0,
            sequenceTracks: [
              {
                sequenceIndex: 0,
                track: {
                  globalSeqId: null,
                  lineType: 1,
                  keys: [
                    { frame: 0, vector: [0] },
                    { frame: 1, vector: [1] },
                  ],
                },
              },
            ],
          },
        }
      : {}),
  })
  const standard = {
    layers: { diffuse: layer('diffuse'), alpha1: layer('alpha1', true) },
    blendMode: 1,
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
  }
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ translation: [0, 1, 0], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] }],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      ...(decal ? [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }] : []),
    ],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_effects'],
    extensions: {
      UV_asset: { id: 'world-animation-fixture', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'scene-test', version: '1' } },
      UV_game_effects: {
        profile: 'common',
        trackTimeUnit: 'seconds',
        particles: [],
        ribbons: [],
        projectors: [
          {
            node: 0,
            material: decal ? 1 : 0,
            active: 1,
            projectionType: 'orthographic',
            offset: [0, 0, 0],
            pitch: 0,
            yaw: 0,
            roll: 0,
            near: 0.1,
            far: 2,
            fieldOfView: 1,
            aspectRatio: 1,
            boxOffsetXLeft: -1,
            boxOffsetXRight: 1,
            boxOffsetYBack: -1,
            boxOffsetYFront: 1,
            boxOffsetZBottom: 0,
            boxOffsetZTop: 0,
            alphaInit: 1,
            falloff: 0,
            attenuationDistance: 0,
            flags: 0,
            layer: 0,
          },
        ],
      },
    },
  }
  return {
    ...animatedModel(),
    nodes: [],
    animations: [
      {
        id: 'stand',
        name: 'Stand',
        kind: 'sequence',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        looping: true,
        sequenceIndex: 0,
        channels: [],
      },
    ],
    primitives: [
      {
        ...animatedModel().primitives[0],
        materialId: 'effect',
        textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      },
    ],
    materials: [
      {
        id: 'effect',
        alphaMode: 'blend',
        blendMode: 'blend',
        layers: [{ slot: 'diffuse', resourceId: 'effect.png', uvSource: 0 }],
        shader: {
          id: 'modkit.render-material.v1',
          parameters: {
            renderModel: { version: 1, layers: [], standard },
          },
        },
      },
      // A projected decal whose alpha does not animate is drawn as a simple textured effect.
      ...(decal
        ? [
            {
              id: 'decal',
              alphaMode: 'blend',
              blendMode: 'blend',
              layers: [{ slot: 'diffuse', resourceId: 'decal.png', uvSource: 0 }],
              shader: {
                id: 'modkit.render-material.v1',
                parameters: {
                  renderModel: {
                    version: 1,
                    layers: [{ label: 'diffuse', path: 'decal.png' }],
                    standard: {
                      ...standard,
                      layers: { diffuse: { ...layer('diffuse'), texturePath: 'decal.png' } },
                    },
                  },
                },
              },
            },
          ]
        : []),
    ],
    textures: [texture('effect.png'), ...(decal ? [texture('decal.png')] : [])],
    uvmBytes: writeUvmContainer({
      format: 'glb',
      document,
      binary: new Uint8Array(),
      extraChunks: [],
    }),
  }
}

it('retains terrain while sequence-only material programs, live effects and projector materials advance', () => {
  const input = { ...world(), models: new Map([['actor', effectModel()]]) }
  const first = createWorldWebGlPlan(input)
  const nextInput = { ...input, timeSeconds: 0.5 }
  const next = createWorldWebGlPlan(nextInput, first)
  assert.equal(next.splatTriangles, first.splatTriangles)
  assert.equal(first.modelEffects.length, 1)
  assert.equal(next.modelEffects[0].source, first.modelEffects[0].source)
  assert.equal(next.modelEffects[0].time, 0.5)
  // The first material scene is projected onto the retained terrain receiver.
  assert.equal(first.modelMaterialScenes.length, 2)
  const alpha = plan =>
    plan.modelMaterialScenes.map(
      scene => [...scene.programs.values()][0].passes[0].uniforms.u_alpha1Multiply,
    )
  assert.deepEqual(alpha(first), [0, 0])
  assert.deepEqual(alpha(next), [0.5, 0.5])
  // Compiled programs own sampler callbacks; compare their serializable values and actual sampled
  // uniforms above, rather than requiring independently compiled closures to share identity.
  const values = plan =>
    JSON.stringify(plan, (_, value) => (value instanceof Map ? [...value] : value))
  assert.equal(values(next), values(createWorldWebGlPlan(nextInput)))
})

it('replays the projected decal triangles of an object kept from the previous plan', () => {
  const input = {
    ...world(),
    models: new Map([['actor', effectModel({ decal: true })]]),
    // The object's own clock stays while the global time moves: the next plan keeps the object.
    animationTimes: new Map([[actor.objectId, 0]]),
  }
  const decals = plan =>
    plan.transparentTexturedTriangles.filter(batch => batch.texture.id === 'decal.png')
  const first = createWorldWebGlPlan(input)
  assert.equal(decals(first).length, 1)
  assert.ok(decals(first)[0].positions.length > 0)
  const nextInput = { ...input, timeSeconds: 0.5 }
  const next = createWorldWebGlPlan(nextInput, first)
  assert.equal(next.modelMaterialScenes[0], first.modelMaterialScenes[0])
  assert.deepEqual([...decals(next)[0].positions], [...decals(first)[0].positions])
  const values = plan =>
    JSON.stringify(plan, (_, value) => (value instanceof Map ? [...value] : value))
  assert.equal(values(next), values(createWorldWebGlPlan(nextInput)))
})

it('keeps procedural cliff skirts until the model covering each edge has loaded', () => {
  const terrain = Array.from({ length: 6 }, (_, i) => ({
    facet: 'terrain',
    id: `t:${i}`,
    layerId: 'terrain',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: 0,
    heightAdjustment: i % 3,
    mask: 0,
    uvwPosition: { x: i % 3, y: i % 3, z: -Math.floor(i / 3) },
  }))
  const pieces = [0, 1].map(x => ({
    ...actor,
    id: `cliff:${x}`,
    objectId: x + 1,
    derivedFrom: 'cliffs',
    resourceId: `cliff:${x}`,
    position: { x, y: 0, z: 0 },
    uvwPosition: { x, y: 0, z: 0 },
  }))
  const input = {
    items: [
      ...terrain,
      ...terrain.map(item => ({
        facet: 'cliffs',
        id: `c:${item.id}`,
        layerId: 'cliffs',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        authored: true,
        x: item.x,
        y: item.y,
        level: item.x,
      })),
      ...pieces,
    ],
    models: new Map(),
  }
  const empty = createWorldWebGlPlan(input)
  assert.equal(empty.stats.cliffTriangles, 4)
  const model = { ...animatedModel(), animations: [] }
  input.models.set('cliff:0', model)
  const partial = createWorldWebGlPlan(input, empty)
  assert.equal(partial.stats.cliffTriangles, 2)
  assert.equal(partial.lines.positions[0], 1)
  input.models.set('cliff:1', model)
  const complete = createWorldWebGlPlan(input, partial)
  assert.equal(complete.stats.cliffTriangles, 0)
  // Complete provider meshes own ramp transitions too, even when their individual bounds do not
  // enclose every height-grid edge.
  assert.equal(complete.stats.cliffEdges, 0)
  assert.deepEqual(complete, createWorldWebGlPlan(input))
})

it('uses a smooth height gradient only for terrain whose texture has not loaded', () => {
  const input = world()
  input.items = input.items
    .filter(item => item.facet === 'terrain')
    .map(item => ({
      ...item,
      heightAdjustment: item.x,
      uvwPosition: { ...item.uvwPosition, y: item.x },
    }))
  input.terrainWeightRasters = []
  input.terrainTextures = new Map()
  const fallback = createWorldWebGlPlan(input)
  const samples = new Map()
  for (let i = 0; i < fallback.opaqueTriangles.positions.length / 3; i++) {
    samples.set(fallback.opaqueTriangles.positions[i * 3 + 1], [
      ...fallback.opaqueTriangles.colors.slice(i * 4, i * 4 + 4),
    ])
  }
  assert.ok(samples.get(0)[2] > samples.get(0)[0])
  assert.ok(samples.get(2)[0] > samples.get(0)[0])
  assert.ok(Math.abs(samples.get(1)[0] - (samples.get(0)[0] + samples.get(2)[0]) / 2) < 1e-6)
  const loadedInput = {
    ...input,
    items: [
      ...input.items,
      ...input.items.map(item => ({
        facet: 'terrain-materials',
        id: `m:${item.id}`,
        layerId: 'materials',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: item.x,
        y: item.y,
        materialId: 'ground',
        textureIndex: 0,
        weights: [{ materialId: 'ground', weight: 1 }],
      })),
    ],
    terrainTextures: new Map([['ground.png', texture('ground.png')]]),
  }
  const loaded = createWorldWebGlPlan(loadedInput, fallback)
  assert.ok(loaded.texturedTriangles.length > 0)
  assert.ok(loaded.texturedTriangles[0].colors.every(value => value === 1))
})
