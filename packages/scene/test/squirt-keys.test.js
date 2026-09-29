import assert from 'node:assert/strict'
import { it } from 'node:test'
import { uvmEffectSquirtKeyed } from '../src/uvm/effect-modes.js'

const track = (sequenceIndex, value) => ({
  sequenceIndex,
  track: { lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [value] }] },
})

it('throws a squirt burst only in a clip that keys its count', () => {
  // BraxisAlphaDestructible2x2's rock debris: 38 pieces, keyed in Death (1) only.
  const debris = { squirt: true, emitCount: 38, sequenceAnimation: { emitCount: [track(1, 38)] } }
  assert.equal(uvmEffectSquirtKeyed(debris, 0), false)
  assert.equal(uvmEffectSquirtKeyed(debris, 1), true)
  assert.equal(uvmEffectSquirtKeyed(debris, undefined), false)
  assert.equal(uvmEffectSquirtKeyed({ squirt: true, emitCount: 4 }, 0), false)
  // Without a count the emission rate's keys throw it (MDX).
  const rated = { squirt: true, sequenceAnimation: { emissionRate: [track(0, 3)] } }
  assert.equal(uvmEffectSquirtKeyed(rated, 0), true)
  assert.equal(uvmEffectSquirtKeyed(rated, 2), false)
  const legacy = {
    squirt: true,
    animation: { emissionRate: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [2] }] } },
  }
  assert.equal(uvmEffectSquirtKeyed(legacy, 0), true)
})
