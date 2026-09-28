import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame, createUvmEffectFrameCache } from '../src/uvm/effects.js'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
// A view turned a quarter about Y and moved back: other billboard axes and camera position.
const turned = Float32Array.from([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -5, 1])
const standard = {
  layers: {},
  blendMode: 1,
  priority: 0,
  specularity: 0,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: true,
  unshaded: false,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
}
const base = {
  id: 'material-0',
  baseColor: [0.2, 0.3, 0.4, 0.2],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: { renderModel: { version: 1, standard, layers: [] } },
  },
}
const emitter = {
  node: 0,
  material: 0,
  emissionRate: 10,
  lifeSpan: 3,
  speed: 1,
  alpha: 1,
  segmentColors: [
    [0.5, 0.25, 1],
    [0.5, 0.25, 1],
    [0.5, 0.25, 1],
  ],
  segmentAlphas: [0.5, 0.5, 0.5],
}
const document = {
  asset: { version: '2.0' },
  nodes: [{}],
  materials: [{}],
  extensions: {
    UV_game_effects: {
      particles: [
        {
          ...emitter,
          texturePath: 'particle.dds',
          orientationMode: 'billboard',
          emitShape: 'point',
          maxParticles: 16,
        },
      ],
      ribbons: [
        {
          ...emitter,
          texturePath: 'ribbon.dds',
          ribbonType: 'planar',
          heightAbove: 0.2,
          heightBelow: 0.2,
        },
      ],
      projectors: [],
      trackTimeUnit: 'seconds',
    },
  },
}
const transforms = new Map([['node-0', identity]])
const options = {
  materials: [base],
  activeNodes: new Set(['node-0']),
  nodeTransformsAt: () => transforms,
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
}

test('a cached effect frame is the uncached frame at its step time for every view, simulated once per step', () => {
  const cache = createUvmEffectFrameCache()
  for (const time of [0.5, 1.25, 0.5])
    for (const viewMatrix of [identity, turned]) {
      const cached = createUvmEffectFrame(document, { ...options, time, viewMatrix, cache })
      assert.ok(cached.primitives.length > 0)
      assert.deepEqual(cached, createUvmEffectFrame(document, { ...options, time, viewMatrix }))
    }
  // Another view at a clock the cache holds takes its simulation instead of simulating again.
  const simulated = cache.simulations.get(0.5).simulated
  createUvmEffectFrame(document, { ...options, time: 0.5, viewMatrix: turned, cache })
  assert.equal(cache.simulations.get(0.5).simulated, simulated)
  // A clock within the same 1/60 s step shows that step's frame and simulation.
  assert.deepEqual(
    createUvmEffectFrame(document, { ...options, time: 0.505, viewMatrix: turned, cache }),
    createUvmEffectFrame(document, { ...options, time: 0.5, viewMatrix: turned }),
  )
  assert.equal(cache.simulations.get(0.5).simulated, simulated)
  // Other budgets are another preparation: the cache starts over.
  const prepared = cache.preparation.prepared
  createUvmEffectFrame(document, {
    ...options,
    maxNodes: 9000,
    time: 0.5,
    viewMatrix: identity,
    cache,
  })
  assert.notEqual(cache.preparation.prepared, prepared)
  assert.notEqual(cache.simulations.get(0.5).simulated, simulated)
})

test('every sprite of an emitter draws with one material, the same object in every frame', () => {
  const frames = [0.5, 1.25].map(time =>
    createUvmEffectFrame(document, { ...options, time, viewMatrix: identity }),
  )
  for (const frame of frames) {
    const sprites = frame.primitives.filter(primitive =>
      primitive.id.startsWith('uvm-effect-particle-'),
    )
    assert.ok(sprites.length > 1)
    assert.equal(new Set(sprites.map(sprite => sprite.materialId)).size, 1)
    assert.deepEqual(
      frame.materials.map(material => material.id),
      [...new Set(frame.primitives.map(primitive => primitive.materialId))],
    )
  }
  assert.equal(frames[1].materials.length, frames[0].materials.length)
  for (const [index, material] of frames[0].materials.entries())
    assert.equal(frames[1].materials[index], material)
})
