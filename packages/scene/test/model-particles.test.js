import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { ModelEffectSimulation } from '@modkit/codec-kit/model-math/effects-sim'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { createUvmParticleGeometry } from '../src/uvm/effect-particles.js'
import { modelParticleMatrix, composeModelParticles } from '../src/uvm/model-particles.js'
import { prepareUvmRender, renderUvm, createUvmFramePreparer } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const envelope = id => ({
  format: 'glb',
  binary: new Uint8Array(),
  extraChunks: [],
  document: {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{}],
    extensionsUsed: ['UV_asset', 'UV_provenance', 'KHR_materials_unlit'],
    extensions: {
      UV_asset: { id, class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
    },
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
  },
})
function child() {
  const appended = appendUvmAccessors(envelope('child'), [
    {
      type: 'VEC3',
      values: Float32Array.of(
        -0.5,
        -0.5,
        -0.25,
        0.5,
        -0.5,
        -0.25,
        0.5,
        0.5,
        -0.25,
        -0.5,
        0.5,
        -0.25,
      ),
    },
    { type: 'SCALAR', componentType: 5123, values: Uint16Array.of(0, 1, 2, 0, 2, 3) },
  ])
  const asset = structuredClone(appended.container)
  asset.document.nodes[0].mesh = 0
  asset.document.meshes = [
    {
      primitives: [
        {
          attributes: { POSITION: appended.accessors[0] },
          indices: appended.accessors[1],
          material: 0,
        },
      ],
    },
  ]
  return writeUvmContainer(asset)
}
function parent() {
  const asset = envelope('parent')
  asset.document.extensionsUsed.push('UV_game_effects')
  asset.document.extensions.UV_game_effects = {
    profile: 'common',
    trackTimeUnit: 'seconds',
    ribbons: [],
    particles: [
      {
        name: 'models',
        node: 0,
        material: 0,
        emissionRate: 4,
        lifeSpan: 2,
        speed: 0,
        gravity: 0,
        width: 1,
        length: 1,
        emitShape: 'point',
        orientationMode: 'billboard',
        modelPaths: ['Child.uvm.glb'],
        segmentColors: [
          [0.5, 0.25, 1],
          [0.5, 0.25, 1],
          [0.5, 0.25, 1],
        ],
        segmentAlphas: [255, 255, 255],
      },
    ],
  }
  return writeUvmContainer(asset)
}
const budget = {
  maxInputBytes: 64000000n,
  maxScalarBytes: 64000000,
  maxNodes: 100000,
  maxDepth: 96,
  maxDiagnostics: 100,
}
const request = {
  schemaVersion: 1,
  time: 0.5,
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity, viewMatrix: identity },
}

test('model descriptors preserve pinned seed selection, age, axes, color and YZ swap alongside unchanged quads', () => {
  const emitter = {
    name: 'models',
    boneIndex: 0,
    materialIndex: 0,
    width: 2,
    length: 4,
    modelPaths: ['A.m3', 'B.pie'],
    swapModelParticleYZ: true,
  }
  const simulation = new ModelEffectSimulation(
    { particles: [emitter], ribbons: [] },
    { maxParticles: 4, maxRibbons: 0, maxProjectorSplats: 0, seed: 123 },
  )
  const state = simulation.particles
  state.activeCount = 1
  state.activeSlots[0] = 0
  state.emitterIndices[0] = 0
  state.ages[0] = 0.25
  state.lifeSpans[0] = 1
  state.randomSeeds[0] = 0.75
  const options = {
    cameraRight: [1, 0, 0],
    cameraUp: [0, 1, 0],
    cameraPosition: [0, 0, 10],
    time: 0.25,
    anchorProvider: () => {},
    maxBytes: 1e6,
    maxNodes: 1000,
  }
  const plain = createUvmParticleGeometry(state, [emitter], options),
    descriptors = []
  const actual = createUvmParticleGeometry(state, [emitter], {
    ...options,
    drawModelParticle: item => descriptors.push(item),
  })
  assert.deepEqual(actual.entries, plain.entries)
  assert.equal(descriptors.length, 1)
  assert.equal(descriptors[0].path, 'B.pie')
  assert.equal(descriptors[0].ageSeconds, 0.25)
  assert.equal(descriptors[0].swapYZ, true)
  const instance = {
    ...descriptors[0],
    position: [3, 4, 5],
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, 1],
    scale: [2, 4, 4],
    transform: identity,
  }
  const cosine = Math.cos(Math.PI * 0.5)
  assert.deepEqual(
    modelParticleMatrix(instance),
    Float32Array.from([2, 0, 0, 0, 0, 4 * cosine, 4, 0, 0, -4, 4 * cosine, 0, 3, 4, 5, 1]),
  )
  assert.throws(
    () =>
      createUvmParticleGeometry(state, [emitter], {
        ...options,
        maxNodes: 1,
        drawModelParticle: () => assert.fail('partial descriptor escaped'),
      }),
    /budget/,
  )
})

test('actual UVM child composition acquires once, samples ages, applies tint and renders the combined scene once', async () => {
  let acquisitions = 0,
    releases = 0,
    renders = 0,
    captured
  const bytes = child(),
    before = bytes.slice()
  const models = {
    async acquire(input) {
      acquisitions++
      assert.equal(input.requirement.logicalId, 'Child.uvm.glb')
      return {
        value: {
          result: { state: 'converted', bytes, sourceKey: 'child', diagnostics: [] },
          acquire: models.acquire,
          async readRaster() {
            throw new Error('unexpected raster acquisition')
          },
        },
        async release() {
          releases++
        },
      }
    },
  }
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            renders++
            captured = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  const frame = await renderUvm(parent(), request, { budget, contracts, modelResources: models })
  assert.equal(acquisitions, 1)
  assert.equal(releases, 1)
  assert.equal(renders, 1)
  const nested = captured.scene.primitives.filter(x => x.id.startsWith('model-particle-'))
  assert.equal(nested.length, 2)
  assert.deepEqual(
    nested.map(x => x.tint),
    [
      [0.5, 0.25, 1, 1],
      [0.5, 0.25, 1, 1],
    ],
  )
  assert.deepEqual(
    captured.scene.materials
      .filter(x => x.id.startsWith('model-particle-'))
      .map(x => x.context.time),
    [0.25, 0],
  )
  assert.deepEqual([...frame.rgba.slice(20, 24)], [128, 64, 255, 255])
  assert.deepEqual(bytes, before)
  const absent = await renderUvm(parent(), request, { budget, contracts })
  assert(absent.diagnostics.some(x => x.code === 'common.uvm/model-particle-unrendered'))
  assert.equal(
    captured.scene.primitives.filter(x => x.id.startsWith('uvm-effect-particle-')).length,
    2,
  )
})

test('a prepared frame names its effect primitives: particles and model particles', async () => {
  const bytes = child()
  const models = {
    async acquire() {
      return {
        value: {
          result: { state: 'converted', bytes, sourceKey: 'child', diagnostics: [] },
          acquire: models.acquire,
          async readRaster() {
            throw new Error('unexpected raster acquisition')
          },
        },
        async release() {},
      }
    },
  }
  const prepared = await prepareUvmRender(parent(), request, { budget, modelResources: models })
  const ids = prepared.request.scene.primitives.map(primitive => primitive.id)
  const effects = new Set(prepared.effectPrimitiveIds)
  assert.ok(prepared.effectPrimitiveIds.length > 0)
  assert.ok(prepared.effectPrimitiveIds.every(id => ids.includes(id)))
  assert.ok(ids.filter(id => id.startsWith('model-particle-')).every(id => effects.has(id)))
  assert.ok(ids.filter(id => id.startsWith('uvm-effect-particle-')).every(id => effects.has(id)))
  assert.equal(prepared.metersPerSourceUnit, 1)
})

test('nested model composition preserves a projective camera chain', async () => {
  const bytes = child()
  const models = {
    async acquire() {
      return {
        value: {
          result: { state: 'converted', bytes, sourceKey: 'child', diagnostics: [] },
          acquire: models.acquire,
          async readRaster() {
            throw new Error('unexpected raster acquisition')
          },
        },
        async release() {},
      }
    },
  }
  let captured
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            captured = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  const perspective = [
    1.8304877281188965, 0, 0, 0,
    0, 1.1208505174682905e-16, -1.0100502967834473, -1,
    0, -1.8304877281188965, -6.184774584542817e-17, -6.123234262925839e-17,
    0, 0, -0.2010050266981125, 0,
  ]
  await renderUvm(
    parent(),
    { ...request, camera: { viewProjection: perspective, viewMatrix: identity } },
    { budget, contracts, modelResources: models },
  )
  assert.deepEqual(captured.camera.viewProjection, Float32Array.from(perspective))
  assert(captured.scene.primitives.some(x => x.id.startsWith('model-particle-')))
})

test('nested conversion refusal retains quads and cancellation releases already acquired resources', async () => {
  const controller = new AbortController()
  let released = 0
  const models = {
    async acquire() {
      controller.abort()
      return {
        value: {
          result: { state: 'converted', bytes: child(), sourceKey: 'child', diagnostics: [] },
        },
        async release() {
          released++
        },
      }
    },
  }
  await assert.rejects(
    () =>
      renderUvm(parent(), request, {
        budget,
        contracts: {},
        modelResources: models,
        signal: controller.signal,
      }),
    /abort/i,
  )
  assert.equal(released, 1)
})

test('portable model states replace the base scene through scoped model resources', async () => {
  const parentContainer = structuredClone(readUvmContainer(child()))
  parentContainer.document.extensionsUsed.push('UV_game_model_states')
  parentContainer.document.extensions.UV_game_model_states = {
    schemaVersion: 1,
    states: [{ state: 'active', model: 'events/active.pie' }],
  }
  const parentBytes = writeUvmContainer(parentContainer)
  let acquisitions = 0,
    releases = 0,
    captured
  const models = {
    async acquire(input) {
      acquisitions++
      assert.equal(input.requirement.id, 'model-state:events/active.pie')
      return {
        value: {
          result: { state: 'converted', bytes: child(), sourceKey: 'active', diagnostics: [] },
          acquire: models.acquire,
          async readRaster() {
            throw new Error('unexpected raster acquisition')
          },
        },
        async release() {
          releases++
        },
      }
    },
  }
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            captured = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  await renderUvm(parentBytes, { ...request, modelState: 'active' }, {
    budget,
    contracts,
    modelResources: models,
  })
  assert.equal(acquisitions, 1)
  assert.equal(releases, 1)
  assert.equal(captured.scene.primitives.length, 1)
  assert.match(captured.scene.primitives[0].id, /^model-state-0\//)

  await renderUvm(parentBytes, request, { budget, contracts, modelResources: models })
  assert.equal(acquisitions, 1, 'base state must not acquire a variant')
  assert.equal(captured.scene.primitives.length, 1)
  assert.doesNotMatch(captured.scene.primitives[0].id, /^model-state-/)

  const unknown = await renderUvm(parentBytes, { ...request, modelState: 'missing' }, {
    budget,
    contracts,
    modelResources: models,
  })
  assert.equal(acquisitions, 1)
  assert(unknown.diagnostics.some(item => item.code === 'common.uvm/model-state-unrendered'))

  const unavailable = await renderUvm(parentBytes, { ...request, modelState: 'active' }, {
    budget,
    contracts,
  })
  assert(unavailable.diagnostics.some(item => item.code === 'common.uvm/model-state-unrendered'))
  assert.doesNotMatch(captured.scene.primitives[0].id, /^model-state-/)
})

test('portable model state schema rejects undeclared and duplicate entries', async () => {
  const invalid = structuredClone(readUvmContainer(child()))
  invalid.document.extensions.UV_game_model_states = {
    schemaVersion: 1,
    states: [
      { state: 'active', model: 'a.pie' },
      { state: 'active', model: 'b.pie' },
    ],
  }
  await assert.rejects(
    () => renderUvm(writeUvmContainer(invalid), request, { budget, contracts: {} }),
    /model state|declaration/i,
  )
  invalid.document.extensionsUsed.push('UV_game_model_states')
  await assert.rejects(
    () => renderUvm(writeUvmContainer(invalid), request, { budget, contracts: {} }),
    /duplicate UVM model state/i,
  )
})

test('child API preserves local ages and only forwards an explicitly supplied parent global time', async () => {
  const captured = []
  let released = 0
  const models = {
    async acquire() {
      return {
        value: {
          result: { state: 'converted', bytes: child(), sourceKey: 'child', diagnostics: [] },
          async readRaster() {
            throw new Error('unexpected raster')
          },
        },
        async release() {
          released++
        },
      }
    },
  }
  const instance = ageSeconds => ({
    path: 'Child.uvm.glb',
    emitterIndex: 0,
    slot: 0,
    ageSeconds,
    position: [0, 0, 0],
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, 1],
    scale: [1, 1, 1],
    color: [1, 1, 1, 1],
    swapYZ: false,
    transform: identity,
  })
  const parentRequest = {
    outputKind: 'rgba8',
    viewport: request.viewport,
    camera: { viewProjection: Float32Array.from(identity) },
    scene: { primitives: [], materials: [], textures: [] },
  }
  const prepare = async (_bytes, input) => {
    captured.push(input)
    return {
      request: parentRequest,
      diagnostics: [],
      metersPerSourceUnit: 1,
      effectPrimitiveIds: [],
    }
  }
  await composeModelParticles(
    [instance(0.1), instance(0.2)],
    parentRequest,
    { budget, modelResources: models },
    0,
    1 << 20,
    prepare,
    undefined,
    0.75,
  )
  assert.deepEqual(
    captured.map(input => [input.time, input.globalTime]),
    [
      [0.1, 0.75],
      [0.2, 0.75],
    ],
  )
  captured.length = 0
  await composeModelParticles(
    [instance(0.1)],
    parentRequest,
    { budget, modelResources: models },
    0,
    1 << 20,
    prepare,
  )
  assert.equal(captured[0].time, 0.1)
  assert.equal(Object.hasOwn(captured[0], 'globalTime'), false)
  assert.equal(released, 2)
})

test('same-clock parent admits instantaneous children and refuses historical children atomically', async () => {
  const historyChild = structuredClone(readUvmContainer(child()))
  historyChild.document.extensionsUsed.push('UV_game_effects')
  historyChild.document.extensions.UV_game_effects = {
    profile: 'common',
    trackTimeUnit: 'seconds',
    particles: [
      {
        name: 'child-history',
        node: 0,
        material: 0,
        emissionRate: 0,
        lifeSpan: 1,
        width: 1,
        length: 1,
        visibility: 0,
      },
    ],
    ribbons: [],
  }
  let acquired = 0,
    released = 0,
    rendered = 0
  let resource = child()
  const models = {
    async acquire() {
      acquired++
      return {
        value: {
          result: { state: 'converted', bytes: resource, sourceKey: 'child', diagnostics: [] },
          async readRaster() {
            throw new Error('unexpected raster')
          },
        },
        async release() {
          released++
        },
      }
    },
  }
  const instantaneous = await prepareUvmRender(
    parent(),
    { ...request, globalTime: 0.5 },
    { budget, modelResources: models },
  )
  assert.deepEqual(
    instantaneous.request.scene.materials
      .filter(m => m.id.startsWith('model-particle-'))
      .map(m => m.context.time),
    [0.5, 0.5],
  )
  assert.equal(acquired, released)
  resource = writeUvmContainer(historyChild)
  acquired = released = 0
  const contracts = {
    async resolve() {
      return {
        value: {
          async render() {
            rendered++
            throw new Error('partial frame escaped')
          },
        },
        async release() {},
      }
    },
  }
  await assert.rejects(
    renderUvm(
      parent(),
      { ...request, globalTime: 0.5 },
      { budget, contracts, modelResources: models },
    ),
    /historical particles or ribbons/,
  )
  assert.deepEqual([acquired, released, rendered], [1, 1, 0])
  const variant = structuredClone(readUvmContainer(child()))
  variant.document.extensionsUsed.push('UV_game_model_states')
  variant.document.extensions.UV_game_model_states = {
    schemaVersion: 1,
    states: [{ state: 'active', model: 'Child.uvm.glb' }],
  }
  acquired = released = 0
  await assert.rejects(
    prepareUvmRender(
      writeUvmContainer(variant),
      { ...request, time: 0.25, globalTime: 0.75, modelState: 'active' },
      { budget, modelResources: models },
    ),
    /historical particles or ribbons/,
  )
  assert.deepEqual([acquired, released, rendered], [1, 1, 0])
})

function clockHistoryParent(coefficients) {
  const clips = coefficients.map((coefficient, index) => ({
    id: `clock-${index}`,
    name: `clock-${index}`,
    kind: 'animation',
    provenance: 'direct',
    frames: 2,
    durationSeconds: 1,
    channels: [
      {
        target: 'anchor',
        kind: 'translation',
        concurrent: true,
        wrapSeconds: 1,
        firstFrame: 0,
        lastFrame: 1,
        interpolation: 'linear',
        samples: [
          { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
          { frame: 1, timeSeconds: 1, value: [coefficient, 0, 0] },
        ],
      },
    ],
  }))
  const materialized = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 0,
        primitives: 0,
        materials: 0,
        textures: 0,
        animations: clips.length,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'anchor',
          childIds: [],
          meshIds: [],
          transform: identity,
          trs: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      ],
      meshes: [],
      primitives: [],
      animations: clips,
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:clock-history',
      options: { assetId: 'fixture/clock-history', sourceFormat: 'test' },
    },
  )
  const container = structuredClone(readUvmContainer(materialized.bytes))
  const node = container.document.animations[0].channels[0].target.node
  const effect = structuredClone(readUvmContainer(parent()).document.extensions.UV_game_effects)
  effect.particles[0].node = node
  effect.particles[0].spaceNode = container.document.nodes.length
  container.document.nodes.push({})
  container.document.scenes[0].nodes.push(effect.particles[0].spaceNode)
  container.document.materials = [{ extensions: { KHR_materials_unlit: {} } }]
  if (!container.document.extensionsUsed.includes('KHR_materials_unlit'))
    container.document.extensionsUsed.push('KHR_materials_unlit')
  container.document.extensionsUsed.push('UV_game_effects')
  container.document.extensions.UV_game_effects = effect
  return writeUvmContainer(container)
}

test('explicit same-clock blend history samples global at each simulation step and matches a reference trajectory', async () => {
  let acquired = 0,
    released = 0
  const models = {
    async acquire() {
      acquired++
      return {
        value: {
          result: { state: 'converted', bytes: child(), sourceKey: 'child', diagnostics: [] },
          async readRaster() {
            throw new Error('unexpected raster')
          },
        },
        async release() {
          released++
        },
      }
    },
  }
  const options = { budget, modelResources: models }
  const actualBytes = clockHistoryParent([4, 8])
  const input = {
    ...request,
    clipId: 'clock-0',
    globalTime: 0.5,
    poseSamples: [
      { clipId: 'clock-0', time: 0.25, weight: 1 },
      { clipId: 'clock-1', time: 0.75, weight: 1 },
    ],
  }
  const reference = await prepareUvmRender(
    clockHistoryParent([6]),
    { ...request, clipId: 'clock-0' },
    options,
  )
  const positions = frame => frame.request.scene.primitives.map(p => Array.from(p.positions))
  const transforms = frame =>
    frame.request.scene.primitives.map(p => Array.from(p.transform ?? identity))
  const actual = await prepareUvmRender(actualBytes, input, options)
  assert(actual.request.scene.primitives.length > 0)
  assert.deepEqual(positions(actual), positions(reference))
  assert.deepEqual(transforms(actual), transforms(reference))
  const preparer = createUvmFramePreparer(actualBytes, options)
  try {
    for (const time of [0.5, 0.1, 0.5]) {
      const frame = { ...input, time, globalTime: time }
      assert.deepEqual(
        positions(await preparer.prepare(frame)),
        positions(await prepareUvmRender(actualBytes, frame, options)),
      )
    }
  } finally {
    preparer.dispose()
  }
  assert.equal(acquired, released)
})
