import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFadpcm, fadpcmFrames } from '../dist/audio/index.js'

/** One 0x8C-byte FADPCM frame: group 0 uses `coefficient`/`shift`, its first word `codes`. */
function frame({ coefficient, shift, history1, history2, codes }) {
  const bytes = new Uint8Array(0x8c)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, coefficient, true)
  view.setUint32(4, shift, true)
  view.setInt16(8, history1, true)
  view.setInt16(10, history2, true)
  view.setUint32(0x0c, codes, true)
  return bytes
}

test('decodeFadpcm predicts from the header history and scales each code by its shift', () => {
  // Coefficients (60, 0), shift 0: code 1 -> ((1 << 28) >> 22) = 64, (64 + 100 * 60) >> 6 = 94;
  // code 0xF -> -64, (-64 + 94 * 60) >> 6 = 87.
  const one = frame({ coefficient: 1, shift: 0, history1: 100, history2: 0, codes: 0xf1 })
  assert.deepEqual([...decodeFadpcm(one, 1, 2)], [94, 87])
  // Index 9 wraps to 2: (122, 60). Code 0: (0 - 50 * 60 + 100 * 122) >> 6 = 143.
  const two = frame({ coefficient: 9, shift: 0, history1: 100, history2: 50, codes: 0 })
  assert.deepEqual([...decodeFadpcm(two, 1, 1)], [143])
  assert.equal(fadpcmFrames(256), 1)
  assert.equal(fadpcmFrames(257), 2)
})

test('decodeFadpcm interleaves channels from frames stored channel after channel', () => {
  const left = frame({ coefficient: 1, shift: 0, history1: 100, history2: 0, codes: 0xf1 })
  const right = frame({ coefficient: 1, shift: 0, history1: -100, history2: 0, codes: 0 })
  const data = new Uint8Array(0x8c * 2)
  data.set(left, 0)
  data.set(right, 0x8c)
  // Right: code 0 -> (0 - 100 * 60) >> 6 = -94 (arithmetic shift rounds down), then -89.
  assert.deepEqual([...decodeFadpcm(data, 2, 2)], [94, -94, 87, -89])
})

test('decodeFadpcm refuses data shorter than the frames the sample count needs', () => {
  assert.throws(() => decodeFadpcm(new Uint8Array(0x8c), 1, 257), /fewer than 2 frames/u)
  assert.throws(() => decodeFadpcm(new Uint8Array(0x8c), 0, 1), /1\+ channels/u)
})
