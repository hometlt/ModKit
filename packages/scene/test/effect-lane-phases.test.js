import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame, createUvmEffectFrameCache } from '../src/uvm/effects.js'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
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
const document = {
  asset: { version: '2.0' },
  nodes: [{}],
  materials: [{}],
  extensions: {
    UV_game_effects: {
      particles: [
        {
          node: 0,
          material: 0,
          emissionRate: 20,
          lifeSpan: 1,
          speed: 1,
          alpha: 1,
          segmentColors: [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1],
          ],
          segmentAlphas: [1, 1, 1],
          texturePath: 'particle.dds',
          orientationMode: 'billboard',
          emitShape: 'point',
          maxParticles: 64,
        },
      ],
      ribbons: [],
      projectors: [],
      trackTimeUnit: 'seconds',
    },
  },
}
const transforms = new Map([['node-0', identity]])
const options = {
  materials: [
    {
      id: 'material-0',
      baseColor: [1, 1, 1, 1],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: { renderModel: { version: 1, standard, layers: [] } },
      },
    },
  ],
  activeNodes: new Set(['node-0']),
  nodeTransformsAt: () => transforms,
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
  viewMatrix: identity,
}

test('eight random start phases of one effect keep a simulation each from frame to frame', () => {
  const cache = createUvmEffectFrameCache()
  // A clip of 2 s spread over eight phases, as the world spreads a looping clip's copies; the
  // phases of a frame come in an order where each follows the one it could otherwise continue.
  const phases = Array.from({ length: 8 }, (_, phase) => (phase / 8) * 2)
  let simulations
  for (const [pass, clock] of [1, 1.25, 1.5, 1.75].entries()) {
    for (const phase of phases) {
      const time = clock + phase
      const frame = createUvmEffectFrame(document, { ...options, time, cache, pass })
      assert.ok(frame.primitives.length > 0)
      if (pass === 1 && phase === 0.5)
        assert.deepEqual(frame, createUvmEffectFrame(document, { ...options, time }))
    }
    // The first frame simulates each phase; later ones step those eight and simulate none anew.
    const lanes = new Set(cache.lanes.map(entry => entry.lane))
    assert.equal(lanes.size, 8, `frame ${pass}`)
    if (simulations === undefined) simulations = lanes
    else assert.deepEqual(lanes, simulations, `frame ${pass}`)
  }
})
