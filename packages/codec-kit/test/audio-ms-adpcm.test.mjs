import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMsAdpcmBlock } from '../dist/audio/ms-adpcm.js'

function block(channels, nibbles) {
  const bytes = new Uint8Array(channels * 7 + nibbles.length), view = new DataView(bytes.buffer)
  for (let c = 0; c < channels; c++) {
    view.setUint16(channels + c * 2, 16, true)
    view.setInt16(channels * 3 + c * 2, channels === 1 ? 1000 : 100 + c * 100, true)
    view.setInt16(channels * 5 + c * 2, channels === 1 ? 900 : 90 + c * 100, true)
  }
  bytes.set(nibbles, channels * 7)
  return bytes
}
test('MS ADPCM predictor seeds and high-nibble-first mono output', () => {
  assert.deepEqual([...decodeMsAdpcmBlock(block(1, [0x12]), 1, [[256, 0]], 8)], [900, 1000, 1016, 1048])
})
test('MS ADPCM stereo nibble pairs produce interleaved frames', () => {
  assert.deepEqual([...decodeMsAdpcmBlock(block(2, [0x12]), 2, [[256, 0]], 12)], [90, 190, 100, 200, 116, 232])
})
test('MS ADPCM rejects predictor, header, delta, coefficients and output ceiling', () => {
  const bytes = block(1, [0x12])
  assert.throws(() => decodeMsAdpcmBlock(bytes, 1, [[256, 0]], 7), /budget/)
  assert.throws(() => decodeMsAdpcmBlock(bytes.subarray(0, 6), 1, [[256, 0]], 8))
  bytes[0] = 1
  assert.throws(() => decodeMsAdpcmBlock(bytes, 1, [[256, 0]], 8), /predictor/)
  bytes[0] = 0; bytes[1] = 0
  assert.throws(() => decodeMsAdpcmBlock(bytes, 1, [[256, 0]], 8), /delta/)
  assert.throws(() => decodeMsAdpcmBlock(block(1, []), 1, [], 8))
})
test('MS ADPCM malicious repeat codes refuse delta overflow rather than publishing NaN as silence', () => {
  const bytes = block(1, new Uint8Array(401).fill(0x88))
  const view = new DataView(bytes.buffer); view.setInt16(3, -32768, true); view.setInt16(5, -32768, true)
  bytes[bytes.length - 1] = 0
  assert.throws(() => decodeMsAdpcmBlock(bytes, 1, [[256, 0]], 4096), /delta overflow/)
})
