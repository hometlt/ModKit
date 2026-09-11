import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectUvmEffectSquirt } from '../src/uvm/effect-modes.js'

function emitter(modes) {
  return {
    squirt: false,
    sequenceAnimation: {
      squirt: modes.map((value, sequenceIndex) => ({
        sequenceIndex,
        track: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [value] }] },
      })),
    },
  }
}
test('shared scene selects an independent burst mode for the active clip and preserves default', () => {
  const parent = emitter([0, 1, 0]),
    copy = emitter([0, 0, 1])
  assert.deepEqual(
    [0, 1, 2].map(index => selectUvmEffectSquirt(parent, index, 10)),
    [false, true, false],
  )
  assert.deepEqual(
    [0, 1, 2].map(index => selectUvmEffectSquirt(copy, index, 10)),
    [false, false, true],
  )
  assert.equal(selectUvmEffectSquirt(parent, undefined, 10), false)
  assert.equal(selectUvmEffectSquirt(parent, 7, 10), false)
  assert.throws(() => selectUvmEffectSquirt(emitter([0, 0.5]), 0, 10), /0\/1/)
  assert.throws(() => selectUvmEffectSquirt(parent, 0, 1), /budget/)
  const abort = new AbortController()
  abort.abort()
  assert.throws(() => selectUvmEffectSquirt(parent, 0, 10, abort.signal), /abort/i)
})
