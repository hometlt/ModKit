import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createUvmParticleGeometry } from '../src/uvm/effect-particles.js'
import { ModelEffectSimulation } from '@modkit/codec-kit/model-math/effects-sim'

const options = {
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
  cameraPosition: [0, 0, 10],
  time: 0.25,
  anchorProvider: () => {},
  maxBytes: 1024 * 1024,
  maxNodes: 10000,
}
const cycle = (start, middle = start, end = start) => ({ start, middle, end, timeMiddle: 0.5 })
const base = { name: 'particle', boneIndex: 0, materialIndex: 0, width: 2, length: 2 }
function fixture(emitter = base, slot = 0) {
  const simulation = new ModelEffectSimulation(
    { particles: [emitter], ribbons: [] },
    { maxParticles: 4, maxRibbons: 0, maxProjectorSplats: 0, seed: 123 },
  )
  const state = simulation.particles
  state.activeCount = 1
  state.activeSlots[0] = slot
  state.emitterIndices[slot] = 0
  state.ages[slot] = 0.25
  state.lifeSpans[slot] = 1
  state.randomSeeds[slot] = 0
  return { state, simulation, emitter, slot }
}
function full(
  entry,
  positions,
  uv = [0, 1, 0, 0, 1, 0, 1, 1],
  color = [1, 1, 1, 1],
  tolerance = 0,
) {
  if (tolerance === 0) assert.deepEqual(entry.positions, Float32Array.from(positions))
  else {
    assert.equal(entry.positions.length, positions.length)
    positions.forEach((value, index) =>
      assert.ok(
        Math.abs(entry.positions[index] - value) <= tolerance,
        `position component ${index}`,
      ),
    )
  }
  assert.deepEqual(entry.indices, Uint32Array.of(0, 1, 2, 0, 2, 3))
  assert.deepEqual(entry.textureCoordinates, Float32Array.from(uv))
  assert.deepEqual(entry.colors, Float32Array.from([...color, ...color, ...color, ...color]))
}
const constant = (sequenceIndex, vector) => [
  { sequenceIndex, track: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector }] } },
]

it('reuses stable size/color/alpha/rotation factors and variation in full quad arrays', () => {
  const emitter = {
    ...base,
    lifecycleSize: cycle([2, 4, 1], [4, 8, 1], [6, 12, 1]),
    lifecycleSizeRandom: cycle([4, 8, 1], [8, 16, 1], [12, 24, 1]),
    lifecycleRotation: cycle([0, 0, 0]),
    lifecycleRotationRandom: cycle([0, 0, Math.PI / 2]),
    segmentColors: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    segmentColorsRandom: [
      [0, 0, 1],
      [1, 1, 1],
      [1, 0, 0],
    ],
    segmentAlphas: [255, 0, 0],
    segmentAlphasRandom: [0, 1, 1],
    sizeVariation: { shape: 'square', amplitude: 0.5, frequency: 1 },
    colorVariation: { shape: 'square', amplitude: 0.5, frequency: 1 },
    alphaVariation: { shape: 'square', amplitude: -0.5, frequency: 1 },
    rotationVariation: { shape: 'square', amplitude: Math.PI / 4, frequency: 1 },
    rows: 2,
    columns: 4,
    lifeSpanUvAnim: [0, 3, 0],
  }
  const { state } = fixture(emitter)
  state.sizeRandomFactors[0] = 0.5
  state.colorRandomFactors[0] = 0.5
  state.alphaRandomFactors[0] = 0.25
  state.rotationRandomFactors[0] = 0.5
  const result = createUvmParticleGeometry(state, [emitter], options)
  assert.equal(result.bytes, 168)
  assert.equal(result.nodes, 1)
  full(
    result.entries[0],
    [6.75, -3.375, 0, -6.75, -3.375, 0, -6.75, 3.375, 0, 6.75, 3.375, 0],
    [0.5, 0.5, 0.5, 0, 0.75, 0, 0.75, 0.5],
    [0.75, 0.75, 0.75, 0.25],
  )
})

it('samples per-sequence lifecycle/random and RGBA segments before lifetime interpolation', () => {
  const emitter = {
    ...base,
    lifecycleSize: cycle([2, 2, 1]),
    lifecycleSizeRandom: cycle([4, 4, 1]),
    segmentColors: [
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ],
    segmentAlphas: [128, 128, 128],
    sequenceAnimation: {},
  }
  for (const suffix of ['Start', 'Middle', 'End']) {
    emitter.sequenceAnimation['lifecycleSize' + suffix] = constant(1, [8, 4, 1])
    emitter.sequenceAnimation['lifecycleSizeRandom' + suffix] = constant(1, [12, 8, 1])
    emitter.sequenceAnimation['segmentColor' + suffix] = constant(1, [0, 0, 1, 128])
    emitter.sequenceAnimation['segmentAlpha' + suffix] = constant(1, [0.25])
  }
  const { state } = fixture(emitter)
  state.sizeRandomFactors[0] = 0.5
  full(
    createUvmParticleGeometry(state, [emitter], { ...options, sequenceIndex: 0 }).entries[0],
    [-1.5, -1.5, 0, -1.5, 1.5, 0, 1.5, 1.5, 0, 1.5, -1.5, 0],
    undefined,
    [1, 0, 0, 128 / 255],
  )
  full(
    createUvmParticleGeometry(state, [emitter], { ...options, sequenceIndex: 1 }).entries[0],
    [-5, -3, 0, -5, 3, 0, 5, 3, 0, 5, -3, 0],
    undefined,
    [0, 0, 1, 0.25],
  )
  // A missing authored segment curve follows the pinned white fallback.
  full(
    createUvmParticleGeometry(state, [base], options).entries[0],
    [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0],
  )
})

it('uses birth origin for pinned tails and the preceding segment for trail tails', () => {
  // Particle.fx: an M3 tail quad stands on its particle, `size` (2) to either side and size × tail
  // (2 × max(2, 2 × speed 1) = 4) along the travel; a trail quad ends on it.
  const tails = {
    tail: [-2, -2, 0, -2, 6, 0, 2, 6, 0, 2, -2, 0],
    pinned: [-1.7, -2, 0, -0.7, 2, 0, 0.7, 2, 0, -0.3, -2, 0],
    trail: [-2, -6, 0, -2, 2, 0, 2, 2, 0, 2, -6, 0],
  }
  for (const [orientationMode, points] of Object.entries(tails)) {
    const emitter = {
      ...base,
      orientationMode,
      tailLength: 2,
      rows: 2,
      columns: 4,
      tailUvAnim: [4, 5, 0],
    }
    const { state } = fixture(emitter)
    state.types[0] = 1
    state.positions.set([0, 2, 0])
    state.spawnPositions.set([-1, -2, 0])
    state.velocities.set([0, 1, 0])
    full(
      createUvmParticleGeometry(state, [emitter], options).entries[0],
      points,
      [0.25, 1, 0.25, 0.5, 0.5, 0.5, 0.5, 1],
    )
  }
})

it('normalizes emitter axes and transforms only bone-local stored positions once', () => {
  const provider = (_kind, _index, _bone, _time, out) => {
    out.position.set([10, 0, 0])
    out.xAxis.set([0, 2, 0])
    out.yAxis.set([-3, 0, 0])
    out.zAxis.set([0, 0, 4])
  }
  const { state } = fixture(base, 3)
  state.positions.set([1, 2, 3], 9)
  state.spaces[3] = 2
  const bone = createUvmParticleGeometry(
    state,
    [{ ...base, modelSpace: true, boneAnchored: true }],
    { ...options, anchorProvider: provider },
  )
  assert.equal(bone.entries[0].slot, 3)
  full(bone.entries[0], [7, 0, 3, 7, 2, 3, 9, 2, 3, 9, 0, 3])
  state.spaces[3] = 1
  full(
    createUvmParticleGeometry(
      state,
      [{ ...base, modelSpace: true, orientationMode: 'emitter-oriented' }],
      { ...options, anchorProvider: provider },
    ).entries[0],
    [0, 1, 3, 0, 3, 3, 2, 3, 3, 2, 1, 3],
  )
  state.spaces[3] = 0
  for (const orientationMode of [
    'face-world-direction',
    'terrain-oriented',
    'emitter-oriented',
    'physics-oriented',
  ])
    full(
      createUvmParticleGeometry(state, [{ ...base, orientationMode }], {
        ...options,
        anchorProvider: provider,
      }).entries[0],
      [2, 1, 3, 0, 1, 3, 0, 3, 3, 2, 3, 3],
    )
})

it('constructs travel and single-axis quads from camera-relative cross products', () => {
  for (const orientationMode of ['face-travel-direction', 'single-axis']) {
    const emitter = { ...base, orientationMode },
      { state } = fixture(emitter)
    state.velocities.set([0, 0, 1])
    full(
      createUvmParticleGeometry(state, [emitter], { ...options, cameraPosition: [0, 5, 10] })
        .entries[0],
      [1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 0, -1],
    )
  }
})

it('keeps active visibility and sequence sampling independent of simulator lifetime', () => {
  const emitter = { ...base, sequenceAnimation: { visibility: constant(1, [0]) } },
    { state } = fixture(emitter)
  const hidden = createUvmParticleGeometry(state, [emitter], { ...options, sequenceIndex: 1 })
  assert.deepEqual(hidden, { entries: [], bytes: 0, nodes: 0 })
  assert.equal(state.activeCount, 1)
  assert.equal(
    createUvmParticleGeometry(state, [emitter], { ...options, sequenceIndex: 0 }).nodes,
    1,
  )
})

it('owns buffers, preserves actual simulator random state, and repeats without reseeding', () => {
  const emitter = {
    ...base,
    emitShape: 'point',
    emissionRate: 8,
    lifeSpan: 2,
    speed: 0,
    gravity: 0,
    randomizeSize: true,
    randomizeColor: true,
    randomizeAlpha: true,
    randomizeRotation: true,
    lifecycleSize: cycle([1, 1, 1]),
    lifecycleSizeRandom: cycle([2, 2, 2]),
  }
  const simulation = new ModelEffectSimulation(
    { particles: [emitter], ribbons: [] },
    { maxParticles: 8, maxRibbons: 0, maxProjectorSplats: 0, seed: 19 },
  )
  simulation.update(0.5, { sequenceId: 0, sequenceTimeSeconds: 0.5 })
  const state = simulation.particles
  assert.ok(state.activeCount > 0)
  const before = structuredClone(state)
  const a = createUvmParticleGeometry(state, [emitter], options),
    b = createUvmParticleGeometry(state, [emitter], options)
  assert.deepEqual(a, b)
  assert.deepEqual(state, before)
  assert.notEqual(a.entries[0].positions.buffer, b.entries[0].positions.buffer)
  const saved = a.entries[0].positions.slice()
  state.positions.fill(99)
  emitter.width = 99
  assert.deepEqual(a.entries[0].positions, saved)
})

it('bounds active slots and metadata work, checks finite output, and cancels before returning partial geometry', () => {
  const { state } = fixture(base)
  assert.throws(
    () => createUvmParticleGeometry(state, [base], { ...options, maxBytes: 167 }),
    /maxBytes/,
  )
  assert.throws(
    () => createUvmParticleGeometry(state, [base], { ...options, maxNodes: 0 }),
    /budget/,
  )
  assert.throws(() =>
    createUvmParticleGeometry(
      state,
      [{ ...base, lifecycleSize: cycle([Infinity, 1, 1]) }],
      options,
    ),
  )
  const controller = new AbortController()
  assert.throws(
    () =>
      createUvmParticleGeometry(state, [base], {
        ...options,
        signal: controller.signal,
        anchorProvider: () => controller.abort(new Error('cancelled preview')),
      }),
    /cancelled preview/,
  )
  state.activeCount = 2
  state.activeSlots[1] = state.activeSlots[0]
  assert.throws(() => createUvmParticleGeometry(state, [base], options), /duplicated/)
})

it('projects terrain-direction velocity and applies XY facings from existing particle state', () => {
  const { state } = fixture(base)
  state.velocities.set([1, 1, 2])
  full(
    createUvmParticleGeometry(
      state,
      [{ ...base, orientationMode: 'terrain-direction-oriented' }],
      options,
    ).entries[0],
    [-Math.SQRT2, 0, 0, 0, Math.SQRT2, 0, Math.SQRT2, 0, 0, 0, -Math.SQRT2, 0],
  )
  state.facings[0] = Math.PI / 2
  full(
    createUvmParticleGeometry(state, [{ ...base, xyQuad: true }], options).entries[0],
    [1, -1, 0, -1, -1, 0, -1, 1, 0, 1, 1, 0],
    undefined,
    undefined,
    1e-6,
  )
})

it('uses decay atlas intervals and wraps cells independently for heads and tails', () => {
  const emitter = {
    ...base,
    rows: 2,
    columns: 4,
    decayUvAnim: [5, 7, 0],
    tailDecayUvAnim: [8, 11, 0],
  }
  const { state } = fixture(emitter)
  state.ages[0] = 0.75
  full(
    createUvmParticleGeometry(state, [emitter], options).entries[0],
    [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0],
    [0.5, 1, 0.5, 0.5, 0.75, 0.5, 0.75, 1],
  )
  state.types[0] = 1
  full(
    createUvmParticleGeometry(state, [emitter], options).entries[0],
    [-0.7, 0, -2, -0.7, 0, 0, 0.7, 0, 0, 0.7, 0, -2],
    [0.5, 0.5, 0.5, 0, 0.75, 0, 0.75, 0.5],
  )
})

it('runs a Warcraft III sprite interval its repeat times, short of its end', () => {
  // [start, end, repeat]: four sprites twice over the first half of the life (mdx-m3-viewer getCell)
  const emitter = { ...base, rows: 2, columns: 4, lifeSpanUvAnim: [0, 4, 2] }
  const { state } = fixture(emitter)
  state.ages[0] = 0.2
  // two fifths of the half: sprite floor(4 × 2 × 0.4) = 3, the last of the row
  full(
    createUvmParticleGeometry(state, [emitter], options).entries[0],
    [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0],
    [0.75, 0.5, 0.75, 0, 1, 0, 1, 0.5],
  )
  state.ages[0] = 0.25
  // halfway through the half the sprites start over, never showing sprite 4
  full(
    createUvmParticleGeometry(state, [emitter], options).entries[0],
    [-1, -1, 0, -1, 1, 0, 1, 1, 0, 1, -1, 0],
    [0, 0.5, 0, 0, 0.25, 0, 0.25, 0.5],
  )
})

it('draws a Warcraft III segment scaling as the half side of its quad', () => {
  // ParticleScaling 3 throughout the life: corners at ±1 × 3 (mdx-m3-viewer particles.vert)
  const emitter = { ...base, width: undefined, length: undefined, particleScaling: [3, 3, 3] }
  const { state } = fixture(emitter)
  full(
    createUvmParticleGeometry(state, [emitter], options).entries[0],
    [-3, -3, 0, -3, 3, 0, 3, 3, 0, 3, -3, 0],
  )
})

it('clamps an M3 tail to the way its particle travelled, as Tokyo floodlight beams start at the lamp', () => {
  const emitter = { ...base, orientationMode: 'tail', tailLength: 7, tailClamped: true }
  const { state } = fixture(emitter)
  state.types[0] = 1
  // Born at the lamp, one unit out at speed 2: a free tail would reach size × 7 × 2 = 28 each way.
  state.positions.set([0, 1, 0])
  state.spawnPositions.set([0, 0, 0])
  state.velocities.set([0, 2, 0])
  const entry = createUvmParticleGeometry(state, [emitter], options).entries[0]
  const ys = [entry.positions[1], entry.positions[4], entry.positions[7], entry.positions[10]]
  // Clamped, the quad reaches back exactly to where the particle was born.
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, 2])
})
