// Intended for modkit-core/packages/scene/test; existing Node test/TS import harness.
import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
import { readUvmEffectFields } from '../src/uvm/effect-fields.js'
import { ModelEffectSimulation } from '@modkit/codec-kit/model-math/effects-sim'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const emitter = {
  name: 'field receiver',
  node: 0,
  material: 0,
  emitShape: 'point',
  orientationMode: 'billboard',
  emissionRate: 10,
  lifeSpan: 3,
  speed: 0,
  gravity: 0,
  mass: 1,
  worldForceChannels: 1,
  localForceChannels: 1,
  lifecycleSize: { start: [0.2, 0.2, 0.2], middle: [0.2, 0.2, 0.2], end: [0.2, 0.2, 0.2] },
}
const force = {
  name: 'wind',
  node: 1,
  type: 'wind',
  shape: 'sphere',
  channels: 1,
  strength: 0,
  width: 8,
  height: 8,
  length: 8,
  unbounded: true,
}
const warp = {
  name: 'radial',
  node: 1,
  warpType: 0,
  radius: 8,
  height: 0,
  strength: 0,
  angular: 0,
  axial: 0,
  radial: 1,
}
const track = (sequenceIndex, start, end = start) => ({
  sequenceIndex,
  track: {
    lineType: 1,
    globalSeqId: null,
    keys: [
      { frame: 0, vector: [start] },
      { frame: 1, vector: [end] },
    ],
  },
})
function input(effects) {
  return {
    asset: { version: '2.0' },
    nodes: [{}, {}],
    materials: [{}],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    extensions: {
      UV_game_effects: {
        profile: 'common',
        trackTimeUnit: 'seconds',
        particles: [emitter],
        ribbons: [],
        ...effects,
      },
    },
  }
}
const translated = identity.slice()
translated[12] = 1
const options = (extra = {}) => ({
  time: 1,
  sequenceIndex: 0,
  viewMatrix: identity,
  materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1], shading: 'unlit' }],
  activeNodes: new Set(['node-0', 'node-1']),
  nodeTransformsAt: () =>
    new Map([
      ['node-0', translated],
      ['node-1', identity],
    ]),
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
  ...extra,
})
const center = primitive =>
  [0, 1, 2].map(
    component =>
      [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + component], 0) /
      4,
  )
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((row, index) =>
    row.forEach((value, component) =>
      assert.ok(
        Math.abs(value - expected[index][component]) < 2e-6,
        `${index}/${component}: ${value} != ${expected[index][component]}`,
      ),
    ),
  )
}
function reference(kind, at) {
  const field = { ...(kind === 'force' ? force : warp), boneIndex: 1 }
  const particle = { ...emitter, boneIndex: 0, materialIndex: 0 }
  const simulation = new ModelEffectSimulation(
    {
      particles: [particle],
      ribbons: [],
      ...(kind === 'force' ? { forces: [field] } : { warps: [field] }),
      trackTimeUnit: 'seconds',
    },
    {
      maxParticles: 1024,
      maxParticlesPerEmitter: 1024,
      maxRibbons: 0,
      maxProjectorSplats: 0,
      maxSpawnPerStep: 256,
      maxSeekSteps: 3600,
    },
  )
  simulation.seek(
    1,
    (time, frame) => {
      // Independent literal authored curve, not the new field reader/sampler.
      field.strength = at(time)
      frame.anchorProvider = (_kind, _index, node, _time, anchor) => {
        anchor.position.set(node === 0 ? [1, 0, 0] : [0, 0, 0])
        anchor.xAxis.set([1, 0, 0])
        anchor.yAxis.set([0, 1, 0])
        anchor.zAxis.set([0, 0, 1])
      }
    },
    0,
  )
  const state = simulation.particles
  return [...state.activeSlots.subarray(0, state.activeCount)].map(slot => [
    ...state.positions.subarray(slot * 3, slot * 3 + 3),
  ])
}

it('wind tracks reach every shared simulator step and force-channel filtering controls actual quads', () => {
  const source = input({
    forces: [{ ...force, sequenceAnimation: { strength: [track(0, 0, 4), track(1, 6)] } }],
  })
  const before = JSON.stringify(source),
    actual = createUvmEffectFrame(source, options())
  assert.ok(actual.primitives.length > 2)
  close(
    createUvmEffectFrame(input({ forces: [{ ...force, strength: 2 }] }), options()).primitives.map(
      center,
    ),
    reference('force', () => 2),
  )
  close(
    actual.primitives.map(center),
    reference('force', time => time * 4),
  )
  assert.ok(actual.primitives.some(primitive => center(primitive)[2] > 0.01))
  close(
    createUvmEffectFrame(source, options({ sequenceIndex: 1 })).primitives.map(center),
    reference('force', () => 6),
  )
  const masked = structuredClone(source)
  masked.extensions.UV_game_effects.particles[0].worldForceChannels = 2
  masked.extensions.UV_game_effects.particles[0].localForceChannels = 2
  assert.ok(
    createUvmEffectFrame(masked, options()).primitives.every(
      primitive => Math.abs(center(primitive)[2]) < 1e-7,
    ),
  )
  assert.equal(JSON.stringify(source), before)
  assert.deepEqual(actual.primitives, createUvmEffectFrame(source, options()).primitives)
})

it('warp radius/strength reach existing warp math and source-frame transform is applied exactly once', () => {
  const source = input({ warps: [{ ...warp, sequenceAnimation: { strength: [track(0, 0, 3)] } }] })
  const local = createUvmEffectFrame(source, options())
  close(
    createUvmEffectFrame(input({ warps: [{ ...warp, strength: 2 }] }), options()).primitives.map(
      center,
    ),
    reference('warp', () => 2),
  )
  close(
    local.primitives.map(center),
    reference('warp', time => time * 3),
  )
  assert.ok(local.primitives.some(primitive => center(primitive)[0] > 1.01))
  const narrow = structuredClone(source)
  narrow.extensions.UV_game_effects.warps[0].sequenceAnimation.radius = [track(0, 0.1)]
  assert.ok(
    createUvmEffectFrame(narrow, options()).primitives.every(
      primitive => Math.abs(center(primitive)[0] - 1) < 1e-6,
    ),
  )
  const frame = Float32Array.of(2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1)
  const transformedEmitter = frame.slice()
  transformedEmitter[12] += 2
  const framed = structuredClone(source)
  framed.nodes.push({ children: [0, 1], matrix: [...frame] })
  framed.scenes[0].nodes = [2]
  framed.extensions.UV_game_effects.spaceNode = 2
  const world = createUvmEffectFrame(
    framed,
    options({
      activeNodes: new Set(['node-0', 'node-1', 'node-2']),
      nodeTransformsAt: () =>
        new Map([
          ['node-0', transformedEmitter],
          ['node-1', frame],
          ['node-2', frame],
        ]),
    }),
  )
  close(
    world.primitives.map(primitive => {
      // Draw contract stores source-local positions plus a separate source-to-world matrix.
      assert.deepEqual(primitive.transform, frame)
      const point = center(primitive),
        matrix = primitive.transform
      return [0, 1, 2].map(
        axis =>
          matrix[axis] * point[0] +
          matrix[axis + 4] * point[1] +
          matrix[axis + 8] * point[2] +
          matrix[axis + 12],
      )
    }),
    local.primitives.map(center).map(([x, y, z]) => [2 * x + 3, 2 * z + 4, -2 * y + 5]),
  )
})

it('field tracks keep sparse fallback, millisecond normalization and unsupported branches explicit', () => {
  const warnings = [],
    settings = {
      nodeCount: 2,
      activeNodes: new Set(['node-0', 'node-1']),
      timeUnit: 'milliseconds',
      maxNodes: 100,
      maxBytes: 65536,
      warn: message => warnings.push(message),
    }
  const source = {
    forces: [
      {
        ...force,
        strength: 7,
        sequenceAnimation: {
          strength: [
            {
              sequenceIndex: 0,
              track: {
                lineType: 1,
                globalSeqId: null,
                keys: [
                  { frame: 0, vector: [2] },
                  { frame: 1000, vector: [6] },
                ],
              },
            },
          ],
        },
      },
    ],
  }
  const fields = readUvmEffectFields(source, settings)
  fields.sample(0.5, 0)
  assert.equal(fields.forces[0].strength, 4)
  fields.sample(0.5, 9)
  assert.equal(fields.forces[0].strength, 7)
  assert.throws(
    () => readUvmEffectFields({ forces: [force] }, { ...settings, maxBytes: 0 }),
    /budget/,
  )
  assert.throws(
    () =>
      readUvmEffectFields(
        { warps: [{ ...warp, sequenceAnimation: { angular: [track(0, 1)] } }] },
        settings,
      ),
    /unsupported/,
  )
  assert.equal(readUvmEffectFields({ warps: [{ ...warp, warpType: 3 }] }, settings).warps.length, 0)
  assert.ok(warnings.some(message => message.includes('warpType 3')))
  const projector = {
    name: 'receiver-pass-required',
    node: 1,
    material: 0,
    projectionType: 'orthographic',
    offset: [0, 0, 0],
    pitch: 0,
    yaw: 0,
    roll: 0,
    fieldOfView: 1,
    aspectRatio: 1,
    near: 0.1,
    far: 2,
    boxOffsetXLeft: -1,
    boxOffsetXRight: 1,
    boxOffsetYBack: -1,
    boxOffsetYFront: 1,
    boxOffsetZBottom: 0,
    boxOffsetZTop: 0,
    falloff: 0,
    alphaInit: 1,
    alphaMid: 1,
    alphaEnd: 0,
    attenuationDistance: 0,
    active: 1,
    layer: 0,
    flags: 0,
  }
  const result = createUvmEffectFrame(input({ projectors: [projector] }), options())
  assert.ok(
    result.diagnostics.some(
      value => value.message === 'projectors: receiver geometry is not connected to the preview.',
    ),
  )
  assert.throws(
    () => createUvmEffectFrame(input({ projectors: [{ node: 1, material: 0 }] }), options()),
    /invalid projector projection type/,
  )
  for (const channels of ['1', -1, 1.5, Infinity, 0x100000000]) {
    const invalid = input({ forces: [force] })
    invalid.extensions.UV_game_effects.particles = [{ ...emitter, worldForceChannels: channels }]
    assert.throws(
      () => createUvmEffectFrame(invalid, options()),
      channels === Infinity ? /non-JSON snapshot value/ : /uint32/,
    )
  }
})
