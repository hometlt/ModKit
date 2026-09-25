import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav } from '../dist/audio/index.js'

const ascii = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4))

test('encodeWav writes the canonical 44-byte header and keeps the samples unchanged', () => {
  // Two stereo 16-bit frames: 48 kHz, 4-byte frames, 192 000 bytes per second.
  const samples = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
  const wav = encodeWav({ channels: 2, sampleRate: 48_000, bitsPerSample: 16 }, samples)
  const view = new DataView(wav.buffer)
  assert.equal(wav.byteLength, 52)
  assert.equal(wav.buffer.byteLength, wav.byteLength)
  assert.deepEqual(
    [
      ascii(wav, 0),
      view.getUint32(4, true),
      ascii(wav, 8),
      ascii(wav, 12),
      view.getUint32(16, true),
    ],
    ['RIFF', 44, 'WAVE', 'fmt ', 16],
  )
  assert.deepEqual(
    [
      view.getUint16(20, true),
      view.getUint16(22, true),
      view.getUint32(24, true),
      view.getUint32(28, true),
      view.getUint16(32, true),
      view.getUint16(34, true),
    ],
    [1, 2, 48_000, 192_000, 4, 16],
  )
  assert.equal(ascii(wav, 36), 'data')
  assert.equal(view.getUint32(40, true), 8)
  assert.deepEqual([...wav.subarray(44)], [...samples])
})

test('encodeWav pads odd data to even size and counts the pad in the RIFF size only', () => {
  const wav = encodeWav(
    { channels: 1, sampleRate: 8_000, bitsPerSample: 8 },
    Uint8Array.of(9, 8, 7),
  )
  const view = new DataView(wav.buffer)
  assert.equal(wav.byteLength, 48)
  assert.equal(view.getUint32(4, true), 40)
  assert.equal(view.getUint32(40, true), 3)
  assert.deepEqual([...wav.subarray(44)], [9, 8, 7, 0])
})

test('encodeWav refuses shapes a PCM WAVE cannot carry', () => {
  const pcm = { channels: 2, sampleRate: 44_100, bitsPerSample: 16 }
  assert.throws(() => encodeWav({ ...pcm, channels: 0 }, new Uint8Array(0)), /channels/u)
  assert.throws(() => encodeWav({ ...pcm, sampleRate: 0 }, new Uint8Array(0)), /sample rate/u)
  assert.throws(
    () => encodeWav({ ...pcm, bitsPerSample: 12 }, new Uint8Array(0)),
    /8, 16, 24 or 32/u,
  )
  assert.throws(() => encodeWav(pcm, new Uint8Array(6)), /whole number of 4-byte frames/u)
})
