import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeEaXa, decodeEaXas, EA_XAS_FRAME_BYTES } from '../dist/audio/index.js'

/** One EA-XA frame: the header byte (filter << 4 | 20 - shift) and 28 codes, high nibble first. */
function frame(head, codes = []) {
  const bytes = new Uint8Array(15)
  bytes[0] = head
  codes.forEach((code, index) => (bytes[1 + (index >> 1)] |= (code & 15) << (index & 1 ? 0 : 4)))
  return bytes
}

/** A frame of samples as they are: 0xEE, the two samples to predict from, then 28 samples. */
function rawFrame(previous, beforePrevious, samples) {
  const bytes = new Uint8Array(61)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0xee
  view.setInt16(1, previous, false)
  view.setInt16(3, beforePrevious, false)
  samples.forEach((sample, index) => view.setInt16(5 + 2 * index, sample, false))
  return bytes
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** An SCDl block: its sample count, an offset per channel (from the end of the offsets), the data. */
function block(samples, channelData, bigEndian = false) {
  const header = 4 + 4 * channelData.length
  const out = new Uint8Array(header + channelData.reduce((sum, data) => sum + data.length, 0))
  const view = new DataView(out.buffer)
  view.setUint32(0, samples, !bigEndian)
  let offset = 0
  channelData.forEach((data, channel) => {
    view.setUint32(4 + 4 * channel, offset, !bigEndian)
    out.set(data, header + offset)
    offset += data.length
  })
  return out
}

test('decodeEaXa scales each code by its shift and predicts from the filter', () => {
  // Filter 1 weighs the previous sample by 240/256; shift 20: code 1 -> 4096, then 3840, 3600.
  assert.deepEqual([...decodeEaXa([block(28, [frame(0x10, [1])])], 2, 1).slice(0, 4)], [
    4096, 3840, 3600, 3375,
  ])
  // Filter 2 also weighs the sample before by -208/256: (7360 * 460 - 4096 * 208) >> 8 = 9897.
  assert.deepEqual([...decodeEaXa([block(28, [frame(0x20, [1])])], 2, 1).slice(0, 3)], [
    4096, 7360, 9897,
  ])
  // Code 15 is -1; shift 20 - 12 = 8 leaves code 1 as 1.
  assert.equal(decodeEaXa([block(28, [frame(0x00, [15])])], 2, 1)[0], -4096)
  assert.equal(decodeEaXa([block(28, [frame(0x0c, [1])])], 2, 1)[0], 1)
})

test('decodeEaXa predicts from the clamped sample', () => {
  // 28672 + 26880 clips to 32767; the next prediction starts from 32767, not 55552.
  const pcm = decodeEaXa([block(28, [frame(0x10, [7, 7, 0])])], 2, 1)
  assert.deepEqual([...pcm.slice(0, 3)], [28672, 32767, 30719])
})

test('revisions 2 and 3 carry the predictor across blocks, revision 1 restarts it', () => {
  const first = frame(0x10, [1])
  const second = frame(0x10)
  const whole = decodeEaXa([block(56, [concat(first, second)])], 2, 1)
  assert.deepEqual(decodeEaXa([block(28, [first]), block(28, [second])], 2, 1), whole)
  // Revision 3 writes the counts and offsets big-endian and decodes the same.
  const bigEndian = [block(28, [first], true), block(28, [second], true)]
  assert.deepEqual(decodeEaXa(bigEndian, 3, 1), whole)
  // Revision 1 starts each block from two stored samples, the last first (little-endian).
  const stored = (previous, beforePrevious) => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setInt16(0, previous, true)
    new DataView(bytes.buffer).setInt16(2, beforePrevious, true)
    return bytes
  }
  const restarted = decodeEaXa(
    [block(28, [concat(stored(4096, 0), second)]), block(28, [concat(stored(0, 0), second)])],
    1,
    1,
  )
  assert.deepEqual([...restarted.slice(0, 2)], [3840, 3600])
  assert.deepEqual([...restarted.slice(28, 30)], [0, 0])
})

test('a raw frame gives its samples as they are and the predictor its two header samples', () => {
  const raw = Array.from({ length: 28 }, (_, index) => index * 100 - 1400)
  const pcm = decodeEaXa([block(56, [concat(rawFrame(1000, 500, raw), frame(0x20))])], 2, 1)
  assert.deepEqual([...pcm.slice(0, 28)], raw)
  // (1000 * 460 - 500 * 208) >> 8 = 1390: from the header pair, not from the last raw samples.
  assert.equal(pcm[28], 1390)
})

test('decodeEaXa interleaves channels found by their offsets and ends inside the last frame', () => {
  const left = concat(frame(0x00, Array(28).fill(1)), frame(0x00, Array(28).fill(1)))
  const right = concat(frame(0x00, Array(28).fill(15)), frame(0x00, Array(28).fill(15)))
  const pcm = decodeEaXa([block(30, [left, right])], 2, 2)
  assert.equal(pcm.length, 60)
  assert.deepEqual([...pcm.slice(0, 2)], [4096, -4096])
  assert.deepEqual([...pcm.slice(58)], [4096, -4096])
  assert.throws(() => decodeEaXa([block(56, [frame(0x10)])], 2, 1), /ends inside a frame/u)
  assert.throws(() => decodeEaXa([new Uint8Array(6)], 2, 1), /shorter than its header/u)
  assert.throws(() => decodeEaXa([], 4, 1), /revision is 1, 2 or 3/u)
  assert.throws(() => decodeEaXa([], 2, 0), /1 to 64 channels/u)
})

/** One EA-XAS v1 frame of one channel: per group its two header samples, filter, shift and codes. */
function xasFrame(groups) {
  const bytes = new Uint8Array(EA_XAS_FRAME_BYTES)
  const view = new DataView(bytes.buffer)
  groups.forEach(({ first = 0, filter = 0, second = 0, shiftField = 0, codes = [] }, group) => {
    view.setInt16(4 * group, (first & ~15) | filter, true)
    view.setInt16(4 * group + 2, (second & ~15) | shiftField, true)
    codes.forEach(
      (code, index) => (bytes[16 + 4 * (index >> 1) + group] |= (code & 15) << (index & 1 ? 0 : 4)),
    )
  })
  return bytes
}

test('decodeEaXas starts each group from its two header samples and rounds its prediction', () => {
  const pcm = decodeEaXas(
    xasFrame([
      // Filter 1, shift 8: (256 + 8192 * 240 + 128) >> 8 = 7681, then (7681 * 240 + 128) >> 8.
      { first: 4096, filter: 1, second: 8192, shiftField: 12, codes: [1, 0] },
      {},
      // Rounded: (16 * 460 + 128) >> 8 = 29, where EA-XA's (16 * 460) >> 8 is 28.
      { first: 0, filter: 2, second: 16, shiftField: 12, codes: [0] },
      { first: -4096, second: -8192 },
    ]),
    1,
  )
  assert.equal(pcm.length, 128)
  assert.deepEqual([...pcm.slice(0, 4)], [4096, 8192, 7681, 7201])
  assert.equal(pcm[66], 29)
  assert.deepEqual([...pcm.slice(96, 99)], [-4096, -8192, 0])
})

test('decodeEaXas takes one frame per channel for every 128 samples', () => {
  const left = xasFrame([{ first: 16 }, {}, {}, {}])
  const right = xasFrame([{ first: -16 }, {}, {}, {}])
  const pcm = decodeEaXas(concat(left, right, left, right), 2, 130)
  assert.equal(pcm.length, 260)
  assert.deepEqual([...pcm.slice(0, 2)], [16, -16])
  assert.deepEqual([...pcm.slice(256, 258)], [16, -16])
  assert.throws(() => decodeEaXas(new Uint8Array(100), 1), /whole number of 76-byte frames/u)
  assert.throws(() => decodeEaXas(left, 1, 129), /hold 128 samples per channel, not 129/u)
})
