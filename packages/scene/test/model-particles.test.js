import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { ModelEffectSimulation } from '@modkit/codec-kit/model-math/effects-sim'
import { createUvmParticleGeometry } from '../src/uvm/effect-particles.js'
import { modelParticleMatrix } from '../src/uvm/model-particles.js'
import { prepareUvmRender, renderUvm } from '../src/uvm/render.js'
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
