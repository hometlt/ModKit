/**
 * FMOD FADPCM, the ADPCM of FSB5 banks (codec 0x10; Diablo III ships every sound as it). Frames of
 * 0x8C bytes hold 256 samples of one channel: coefficient indices and shifts as 8 nibbles each,
 * two history samples, then 8 groups of 16 bytes of 4-bit codes. A multichannel stream interleaves
 * whole frames by channel. Ported from MK2's FSB codec, which follows vgmstream's `fadpcm_decoder.c`.
 */

const FRAME_BYTES = 0x8c
const SAMPLES_PER_FRAME = 0x100

/** Predictor pairs by index; indices above 6 wrap (`% 7`). */
const COEFFICIENTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [60, 0],
  [122, 60],
  [115, 52],
  [98, 55],
  [0, 0],
  [0, 0],
]

/** Frames a stream of `sampleCount` samples needs per channel. */
export function fadpcmFrames(sampleCount: number): number {
  return Math.ceil(sampleCount / SAMPLES_PER_FRAME)
}

/**
 * `sampleCount` samples per channel of a FADPCM stream, as interleaved 16-bit PCM. The history
 * samples of each frame header seed the predictor and are not output.
 */
export function decodeFadpcm(data: Uint8Array, channels: number, sampleCount: number): Int16Array {
  if (!Number.isInteger(channels) || channels < 1) throw new RangeError('FADPCM needs 1+ channels')
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new RangeError('FADPCM sample count must be a non-negative integer')
  }
  const frames = fadpcmFrames(sampleCount)
  if (frames * FRAME_BYTES * channels > data.byteLength) {
    throw new RangeError(`FADPCM data holds fewer than ${frames} frames of ${channels} channel(s)`)
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out = new Int16Array(sampleCount * channels)
  for (let frame = 0; frame < frames; frame += 1) {
    const first = frame * SAMPLES_PER_FRAME
    const count = Math.min(SAMPLES_PER_FRAME, sampleCount - first)
    for (let channel = 0; channel < channels; channel += 1) {
      const at = (frame * channels + channel) * FRAME_BYTES
      const coefficients = view.getUint32(at, true)
      const shifts = view.getUint32(at + 4, true)
      let history1 = view.getInt16(at + 8, true)
      let history2 = view.getInt16(at + 10, true)
      let index = 0
      for (let group = 0; group < 8; group += 1) {
        const [coefficient1, coefficient2] = COEFFICIENTS[
          ((coefficients >>> (group * 4)) & 0xf) % 7
        ] ?? [0, 0]
        // The code is sign-extended from the top of 32 bits, so the shift is taken from 22.
        const shift = 22 - ((shifts >>> (group * 4)) & 0xf)
        for (let word = 0; word < 4; word += 1) {
          const codes = view.getUint32(at + 0x0c + group * 0x10 + word * 4, true)
          for (let nibble = 0; nibble < 8; nibble += 1) {
            let sample = (((codes >>> (nibble * 4)) & 0xf) << 28) >> shift
            sample = (sample - history2 * coefficient2 + history1 * coefficient1) >> 6
            sample = sample < -32768 ? -32768 : sample > 32767 ? 32767 : sample
            if (index < count) out[(first + index) * channels + channel] = sample
            index += 1
            history2 = history1
            history1 = sample
          }
        }
      }
    }
  }
  return out
}
