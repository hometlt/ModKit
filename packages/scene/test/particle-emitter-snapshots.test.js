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
// Two emitters, one sprite each: one with colours by segment and a sequence track, one whose name
// takes more than a byte a letter.
const emitters = [
  {
    name: 'wave',
    boneIndex: 0,
    materialIndex: 0,
    width: 2,
    length: 2,
    segmentColors: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    segmentAlphas: [255, 128, 0],
    sequenceAnimation: {
      width: [
        {
          sequenceIndex: 0,
          track: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [3] }] },
        },
      ],
    },
  },
  { name: 'écume', boneIndex: 0, materialIndex: 1, width: 1, length: 1 },
]
function particles() {
  const simulation = new ModelEffectSimulation(
    { particles: emitters, ribbons: [] },
    { maxParticles: 4, maxRibbons: 0, maxProjectorSplats: 0, seed: 123 },
  )
  const state = simulation.particles
  state.activeCount = 2
  for (const slot of [0, 1]) {
    state.activeSlots[slot] = slot
    state.emitterIndices[slot] = slot
    state.ages[slot] = 0.25
    state.lifeSpans[slot] = 1
    state.randomSeeds[slot] = 0
  }
  return state
}
const outcome = run => {
  try {
    run()
    return 'drawn'
  } catch (error) {
    return error.message
  }
}

it('copies each emitter once for an owner that keeps the copies, drawing as a copy per call', () => {
  const state = particles()
  const kept = new WeakMap()
  const fresh = createUvmParticleGeometry(state, emitters, options)
  assert.deepEqual(
    createUvmParticleGeometry(state, emitters, { ...options, emitterSnapshots: kept }),
    fresh,
  )
  const copies = emitters.map(emitter => kept.get(emitter))
  assert.ok(copies.every(copy => copy !== undefined && Object.isFrozen(copy.emitter)))
  // Later calls draw from the kept copies.
  assert.deepEqual(
    createUvmParticleGeometry(state, emitters, { ...options, emitterSnapshots: kept }),
    fresh,
  )
  assert.deepEqual(
    emitters.map(emitter => kept.get(emitter)),
    copies,
  )
})

it('refuses kept copies exactly where the budget refuses a copy per call', () => {
  const state = particles()
  for (const [field, pattern] of [
    ['maxBytes', /maxBytes/],
    ['maxNodes', /maxNodes/],
  ]) {
    // The least budget a copy per call fits in.
    let low = 0,
      high = options[field]
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (
        outcome(() =>
          createUvmParticleGeometry(state, emitters, { ...options, [field]: middle }),
        ) === 'drawn'
      )
        high = middle
      else low = middle + 1
    }
    const refused = outcome(() =>
      createUvmParticleGeometry(state, emitters, { ...options, [field]: low - 1 }),
    )
    assert.match(refused, pattern)
    // Kept copies made under a larger budget are charged alike.
    const kept = new WeakMap()
    createUvmParticleGeometry(state, emitters, { ...options, emitterSnapshots: kept })
    for (const value of [low - 1, low])
      assert.equal(
        outcome(() =>
          createUvmParticleGeometry(state, emitters, {
            ...options,
            [field]: value,
            emitterSnapshots: kept,
          }),
        ),
        value === low ? 'drawn' : refused,
      )
    // So are copies made at the call that is refused.
    assert.equal(
      outcome(() =>
        createUvmParticleGeometry(state, emitters, {
          ...options,
          [field]: low - 1,
          emitterSnapshots: new WeakMap(),
        }),
      ),
      refused,
    )
  }
})
