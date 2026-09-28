import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeXaAdpcm, XA_SOUND_GROUP_SAMPLES } from '../dist/audio/index.js'
import { cdRomEdc } from '../dist/checksum/index.js'

/** One 128-byte sound group: `parameters[unit]` at 4 + unit, `codes[unit][row]` as nibbles. */
function group(parameters, codes) {
  const bytes = new Uint8Array(128)
  parameters.forEach((value, unit) => (bytes[4 + unit] = value))
  codes.forEach((rows, unit) =>
    rows.forEach((code, row) => (bytes[16 + row * 4 + (unit >> 1)] |= code << ((unit & 1) * 4))),
  )
  return bytes
}

test('decodeXaAdpcm scales each code by its shift and predicts from the filter', () => {
  // Filter 1 (60/64), shift 0: code 1 -> 4096, then (4096 * 60 + 32) >> 6 = 3840, then 3600.
  const pcm = decodeXaAdpcm(group([0x10], [[1, 0, 0]]), 1)
  assert.equal(pcm.length, XA_SOUND_GROUP_SAMPLES)
  assert.deepEqual([...pcm.slice(0, 3)], [4096, 3840, 3600])
  // Reserved shift 13 acts as 9: code 1 -> 4096 >> 9 = 8.
  assert.equal(decodeXaAdpcm(group([0x0d], [[1]]), 1)[0], 8)
})

test('decodeXaAdpcm predicts from the clamped sample, as psx-spx and ffmpeg do', () => {
  // 28672 + 26880 clips to 32767; the next prediction starts from 32767, not 55552.
  const pcm = decodeXaAdpcm(group([0x10], [[7, 7, 0]]), 1)
  assert.deepEqual([...pcm.slice(0, 3)], [28672, 32767, 30719])
})

test('decodeXaAdpcm puts even units left, odd units right, and runs each predictor on', () => {
  // Unit 0 (left) code 1, unit 1 (right) code 2; units 2 and 3 carry on their channel's predictor.
  const pcm = decodeXaAdpcm(group([0x10, 0, 0x10, 0x10], [[1], [2], [0], [0]]), 2)
  assert.deepEqual([...pcm.slice(0, 4)], [4096, 8192, 3840, 0])
  // Left sample 28 (unit 2) predicts from left sample 27; right sample 28 (unit 3) from right 27 = 0.
  assert.equal(pcm[28 * 2], ((pcm[27 * 2] ?? 0) * 60 + 32) >> 6)
  assert.notEqual(pcm[28 * 2], 0)
  assert.equal(pcm[28 * 2 + 1], 0)
  assert.throws(() => decodeXaAdpcm(new Uint8Array(100), 1), /whole number of 128-byte groups/u)
})

test('cdRomEdc is CRC-32/CD-ROM-EDC', () => {
  assert.equal(cdRomEdc(new TextEncoder().encode('123456789')), 0x6ec2edc4)
})
