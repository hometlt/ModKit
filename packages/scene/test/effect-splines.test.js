// Destination packages/scene/test; existing node:test runner, no new evaluator.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
import { readUvmEffectSplines, assertUvmEffectSplineWork } from '../src/uvm/effect-splines.js'
import {
  ModelEffectSimulation,
  writeEffectRibbonRingPositions,
} from '@modkit/codec-kit/model-math/effects-sim'
const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const transforms = time => {
  const endpoint = identity.slice()
  endpoint[12] = 4
  endpoint[13] = time * 2
  return new Map([
    ['node-0', identity],
    ['node-1', endpoint],
  ])
}
const opts = {
  nodeCount: 2,
  activeNodes: new Set(['node-0', 'node-1']),
  timeUnit: 'seconds',
  maxNodes: 10000,
  maxBytes: 8 * 1024 * 1024,
}
const track = (a, b, unit = 1) => [
  {
    sequenceIndex: 0,
    track: {
      lineType: 1,
      globalSeqId: null,
      keys: [
        { frame: 0, vector: a },
        { frame: unit, vector: b },
      ],
    },
  },
]
const particle = {
  name: 'spline',
  node: 0,
  material: 0,
  emitShape: 'spline',
  orientationMode: 'billboard',
  emissionRate: 12,
  lifeSpan: 2,
  speed: 0,
  gravity: 0,
  maxParticles: 32,
  width: 0.25,
  length: 0.25,
  emitShapePoints: [
    [1, 2, 3],
    [4, 2, 3],
  ],
  emitShapePointSequenceAnimations: [track([1, 2, 3], [1, 5, 3]), []],
}
const endpoint = {
  node: 1,
  emissionOffset: [0, 0, 0],
  emissionVector: [0, 1, 0],
  velocity: 1,
  velocityBaseFactor: 0.5,
  velocityEndFactor: 1.5,
  yaw: 0,
  pitch: 0,
  sequenceAnimation: { velocity: track([1], [3]), yaw: track([0], [45]) },
}
const ribbon = {
  name: 'ribbon',
  node: 0,
  material: 0,
  ribbonType: 'planar',
  emissionRate: 4,
  divisions: 4,
  lifeSpan: 2,
  speed: 1,
  emissionOffset: [0, 0, 0],
  emissionVector: [1, 0, 0],
  heightAbove: 0.5,
  heightBelow: 0.5,
  splineEndpoints: [endpoint],
}
function scene(kind, emitter, timeUnit = 'seconds') {
  return {
    asset: { version: '2.0' },
    nodes: [{}, {}],
    materials: [{}],
    extensions: {
      UV_game_effects: {
        profile: 'common',
        trackTimeUnit: timeUnit,
        particles: [],
        ribbons: [],
        [kind]: [emitter],
      },
    },
  }
}
function frame(kind, emitter, time = 0.5, timeUnit = 'seconds', at = transforms) {
  return createUvmEffectFrame(scene(kind, emitter, timeUnit), {
    ...opts,
    time,
    sequenceIndex: 0,
    viewMatrix: identity,
    materials: [{ id: 'material-0', baseColor: [1, 1, 1, 1], shading: 'unlit' }],
    nodeTransformsAt: at,
  })
}
function kernel(kind, emitter, time = 0.5) {
  const native = structuredClone(emitter)
  native.boneIndex = native.node
  native.materialIndex = native.material
  delete native.node
  delete native.material
  if (native.splineEndpoints)
    native.splineEndpoints = native.splineEndpoints.map(({ node, ...rest }) => ({
      ...rest,
      boneIndex: node,
    }))
  const sim = new ModelEffectSimulation(
    { particles: [], ribbons: [], [kind]: [native], trackTimeUnit: 'seconds' },
    {
      maxParticles: 1024,
      maxRibbons: 1024,
      maxParticlesPerEmitter: 1024,
      maxRibbonsPerEmitter: 1024,
      maxSpawnPerStep: 256,
      maxSeekSteps: 3600,
    },
  )
  sim.seek(
    time,
    (sourceTime, step) => {
      const matrices = transforms(sourceTime)
      step.anchorProvider = (_kind, _index, bone, _time, out) => {
        const matrix = matrices.get(`node-${bone}`)
        assert.ok(matrix)
        out.position.set(matrix.subarray(12, 15))
        out.xAxis.set(matrix.subarray(0, 3))
        out.yAxis.set(matrix.subarray(4, 7))
        out.zAxis.set(matrix.subarray(8, 11))
      }
    },
    0,
  )
  return sim
}
function close(actual, expected, label) {
  assert.equal(actual.length, expected.length, label)
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 2e-5,
      `${label}[${index}]: ${value} != ${expected[index]}`,
    ),
  )
}
test('all emitted particle positions match existing kernel with animated point tracks in source time', () => {
  const actual = frame('particles', particle),
    sim = kernel('particles', particle)
  assert.ok(actual.primitives.length > 2)
  assert.equal(actual.primitives.length, sim.particles.activeCount)
  for (const [index, primitive] of actual.primitives.entries()) {
    const slot = sim.particles.activeSlots[index],
      expected = Array.from(sim.particles.positions.subarray(slot * 3, slot * 3 + 3))
    const center = [0, 1, 2].map(
      axis =>
        [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + axis], 0) / 4,
    )
    close(center, expected, `particle ${index} full xyz`)
  }
  const milliseconds = structuredClone(particle)
  milliseconds.emitShapePointSequenceAnimations[0] = track([1, 2, 3], [1, 5, 3], 1000)
  assert.deepEqual(frame('particles', milliseconds, 0.5, 'milliseconds'), actual)
  assert.notDeepEqual(
    actual.primitives.map(x => [...x.positions]),
    frame('particles', { ...particle, emitShapePointSequenceAnimations: [[], []] }).primitives.map(
      x => [...x.positions],
    ),
  )
})
test('complete spline ribbon rings use animated endpoint nodes and scalar tangent tracks', () => {
  const actual = frame('ribbons', ribbon),
    sim = kernel('ribbons', ribbon)
  const state = sim.ribbons,
    slots = []
  for (let slot = state.firstSlots[0]; slot >= 0; slot = state.nextSlots[slot]) {
    assert.ok(slots.length < 5, 'independent spline chain is bounded and acyclic')
    slots.push(slot)
  }
  assert.equal(slots.length, 5)
  const center = slot => Array.from(state.positions.subarray(slot * 3, slot * 3 + 3))
  const positions = new Float32Array(5 * 2 * 3),
    indices = []
  slots.forEach((slot, point) => {
    const here = center(slot),
      before = center(slots[Math.max(0, point - 1)]),
      after = center(slots[Math.min(4, point + 1)])
    const tangent = after.map((value, axis) => value - before[axis])
    const up = [0, 1, 2].map(
      axis => state.vertices[slot * 6 + axis] - state.vertices[slot * 6 + axis + 3],
    )
    // Presentation is the existing kernel's planar ring basis, fed by an independent simulation.
    writeEffectRibbonRingPositions(
      positions,
      point * 2,
      3,
      here,
      tangent,
      up,
      [0, 0, 1],
      0.5,
      'planar',
    )
    if (point > 0) {
      const a = (point - 1) * 2,
        b = point * 2
      indices.push(a, a + 1, b + 1, a, b + 1, b)
    }
  })
  assert.equal(actual.primitives.length, 1, 'all five rings share one indexed draw')
  const primitive = actual.primitives[0]
  close([...primitive.positions], [...positions], 'complete spline ring positions')
  assert.deepEqual([...primitive.indices], indices)
  assert.equal(indices.length, 24)
  // Every packed pair still joins the exact independently simulated spline center.
  slots.forEach((slot, point) =>
    close(
      [0, 1, 2].map(
        axis =>
          (primitive.positions[point * 6 + axis] + primitive.positions[point * 6 + axis + 3]) * 0.5,
      ),
      center(slot),
      'packed ring center',
    ),
  )
  assert.notDeepEqual(
    actual.primitives.map(x => [...x.positions]),
    frame('ribbons', ribbon, 0.5, 'seconds', () => transforms(0)).primitives.map(x => [
      ...x.positions,
    ]),
  )
})
test('STEP, LINEAR, Hermite and Bezier point tracks retain complete vectors and tangents', () => {
  for (const lineType of [0, 1, 2, 3]) {
    const input = structuredClone(particle),
      pointTrack = input.emitShapePointSequenceAnimations[0][0].track
    pointTrack.lineType = lineType
    if (lineType >= 2)
      for (const key of pointTrack.keys) {
        key.inTan = [0, 1, 0]
        key.outTan = [0, 2, 0]
      }
    const parsed = readUvmEffectSplines(input, 'particles', opts)
    assert.deepEqual(
      parsed.values.emitShapePointSequenceAnimations,
      input.emitShapePointSequenceAnimations,
    )
    const actual = frame('particles', input),
      sim = kernel('particles', input)
    assert.ok(actual.primitives.length > 2)
    assert.equal(actual.primitives.length, sim.particles.activeCount)
    actual.primitives.forEach((primitive, index) => {
      const slot = sim.particles.activeSlots[index]
      const center = [0, 1, 2].map(
        axis =>
          [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + axis], 0) / 4,
      )
      close(
        center,
        [...sim.particles.positions.subarray(slot * 3, slot * 3 + 3)],
        `interpolation ${lineType}`,
      )
    })
  }
})
test('cutout input uses the existing bounded rejection sampler and never invents spline points', () => {
  const volume = {
    ...particle,
    emitShape: 'sphere',
    emitShapePoints: undefined,
    emitShapePointSequenceAnimations: undefined,
    emitShapeRadius: 2,
    emitShapeCutout: true,
    emitShapeCutoutRadius: 0.5,
    emitShapeCutoutSize: [0.25, 0.5, 0.75],
  }
  delete volume.emitShapePoints
  delete volume.emitShapePointSequenceAnimations
  const actual = frame('particles', volume),
    sim = kernel('particles', volume)
  assert.equal(actual.primitives.length, sim.particles.activeCount)
  actual.primitives.forEach((primitive, index) => {
    const slot = sim.particles.activeSlots[index]
    const center = [0, 1, 2].map(
      axis =>
        [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + axis], 0) / 4,
    )
    close(center, [...sim.particles.positions.subarray(slot * 3, slot * 3 + 3)], 'cutout full xyz')
  })
  assert.throws(
    () => readUvmEffectSplines({ emitShape: 'spline' }, 'particles', opts),
    /authored control points/,
  )
})
test('spline validation rejects malformed full tracks, invalid endpoint graphs and over-budget work', () => {
  const wrong = structuredClone(particle)
  wrong.emitShapePointSequenceAnimations[0][0].track.keys[1].vector = [1]
  assert.throws(() => readUvmEffectSplines(wrong, 'particles', opts), /arity|differs/)
  const cubic = structuredClone(particle)
  cubic.emitShapePointSequenceAnimations[0][0].track.lineType = 2
  assert.throws(() => readUvmEffectSplines(cubic, 'particles', opts), /arity/)
  assert.throws(
    () => readUvmEffectSplines(ribbon, 'ribbons', { ...opts, activeNodes: new Set(['node-0']) }),
    /active scene/,
  )
  assert.throws(
    () => frame('ribbons', ribbon, 0.5, 'seconds', () => new Map([['node-0', identity]])),
    /transform/,
  )
  assert.throws(
    () => readUvmEffectSplines(particle, 'particles', { ...opts, maxBytes: 16 }),
    /budget|limit|maxBytes/,
  )
  assert.throws(() => assertUvmEffectSplineWork(10000, 10000, 60, 256), /work/)
})
