/**
 * EA-XA, the ADPCM of Electronic Arts' SCHl audio streams (revisions 1-3), and EA-XAS v1, its
 * successor in EAAudioCore SNR/SNS streams and SAGE `.cdata` assets. Both predict each 4-bit code
 * from the two previous samples with one of four filters and scale it by a shift. Only the frames
 * are decoded here; the containers around them (SCHl, SNR/SNS, `.cdata`) are read by the game's
 * extension. Written from the formats as ffmpeg's `adpcm_ea_r1`..`adpcm_ea_r3` and `adpcm_ea_xas`
 * decode them — the SAGE tests compare the two bit for bit on Kane's Wrath's sound.
 */

/** Revision of an SCHl stream's EA-XA: 3 writes block counts and offsets big-endian. */
export type EaXaRevision = 1 | 2 | 3

/** Samples of one EA-XA frame (15 bytes, or 61 for a frame of samples as they are). */
export const EA_XA_FRAME_SAMPLES = 28
/** Bytes of one EA-XAS v1 frame of one channel, and the samples it holds. */
export const EA_XAS_FRAME_BYTES = 76
export const EA_XAS_FRAME_SAMPLES = 128

/**
 * Predictor weights in 1/256: `WEIGHTS[filter]` weighs the previous sample and
 * `WEIGHTS[filter + 4]` the one before it. Encoders write filters 0-3; a larger filter reads on into
 * the table, as ffmpeg and vgmstream both do, so a damaged stream decodes the same everywhere.
 */
const WEIGHTS: readonly number[] = [
  0, 240, 460, 392, 0, 0, -208, -220, 0, 1, 3, 4, 7, 8, 10, 11, 0, -1, -3, -4,
]
/** A frame header that announces 28 samples stored as they are. */
const RAW_FRAME = 0xee

function checkChannels(channels: number): void {
  if (!Number.isInteger(channels) || channels < 1 || channels > 64) {
    throw new RangeError('EA-XA audio has 1 to 64 channels')
  }
}

const clamp16 = (value: number): number => (value < -32768 ? -32768 : value > 32767 ? 32767 : value)

/**
 * The SCDl blocks of one SCHl stream, in order, as interleaved 16-bit PCM. A block is its sample
 * count, one offset per channel (from the end of the offsets) and each channel's frames there.
 * Revision 1 starts every channel of every block from two stored samples (little-endian, the last
 * first); revisions 2 and 3 carry the predictor on from the previous block. A frame is a byte
 * (filter << 4 | 20 - shift) and 28 codes, high nibble first, or 0xEE: two big-endian samples the
 * next frame predicts from, then 28 big-endian samples as they are.
 */
export function decodeEaXa(
  blocks: Iterable<Uint8Array>,
  revision: EaXaRevision,
  channels: number,
): Int16Array {
  if (revision !== 1 && revision !== 2 && revision !== 3) {
    throw new RangeError('EA-XA revision is 1, 2 or 3')
  }
  checkChannels(channels)
  const littleEndian = revision !== 3
  // The two previous samples of each channel, carried from block to block.
  const history1 = new Int32Array(channels)
  const history2 = new Int32Array(channels)
  const parts: Int16Array[] = []
  let total = 0
  for (const block of blocks) {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
    const header = 4 + 4 * channels
    if (block.byteLength < header) throw new RangeError('EA-XA block is shorter than its header')
    const samples = view.getUint32(0, littleEndian)
    // Every channel's frames lie in the block (15 bytes at least each): checked before allocating,
    // so a damaged count cannot ask for gigabytes.
    const frames = Math.ceil(samples / EA_XA_FRAME_SAMPLES)
    if (channels * (frames * 15 + (revision === 1 ? 4 : 0)) > block.byteLength - header) {
      throw new RangeError('EA-XA block holds fewer frames than its sample count')
    }
    const out = new Int16Array(samples * channels)
    for (let channel = 0; channel < channels; channel += 1) {
      let at = header + view.getUint32(4 + 4 * channel, littleEndian)
      const need = (bytes: number) => {
        if (at + bytes > block.byteLength) throw new RangeError('EA-XA block ends inside a frame')
      }
      if (revision === 1) {
        need(4)
        history1[channel] = view.getInt16(at, true)
        history2[channel] = view.getInt16(at + 2, true)
        at += 4
      }
      let previous = history1[channel] ?? 0
      let beforePrevious = history2[channel] ?? 0
      for (let index = 0; index < samples; index += EA_XA_FRAME_SAMPLES) {
        need(1)
        const head = block[at] ?? 0
        at += 1
        const count = Math.min(EA_XA_FRAME_SAMPLES, samples - index)
        if (head === RAW_FRAME) {
          need(4 + 2 * EA_XA_FRAME_SAMPLES)
          previous = view.getInt16(at, false)
          beforePrevious = view.getInt16(at + 2, false)
          for (let sample = 0; sample < count; sample += 1) {
            out[(index + sample) * channels + channel] = view.getInt16(at + 4 + 2 * sample, false)
          }
          at += 4 + 2 * EA_XA_FRAME_SAMPLES
          continue
        }
        need(EA_XA_FRAME_SAMPLES / 2)
        const weight1 = WEIGHTS[head >> 4] ?? 0
        const weight2 = WEIGHTS[(head >> 4) + 4] ?? 0
        const shift = 20 - (head & 0x0f)
        for (let sample = 0; sample < EA_XA_FRAME_SAMPLES; sample += 1) {
          const byte = block[at + (sample >> 1)] ?? 0
          // Sign-extend the high or the low nibble.
          const code = (sample & 1) === 0 ? (byte << 24) >> 28 : (byte << 28) >> 28
          const decoded = clamp16(
            ((code << shift) + previous * weight1 + beforePrevious * weight2) >> 8,
          )
          beforePrevious = previous
          previous = decoded
          if (sample < count) out[(index + sample) * channels + channel] = decoded
        }
        at += EA_XA_FRAME_SAMPLES / 2
      }
      history1[channel] = previous
      history2[channel] = beforePrevious
    }
    parts.push(out)
    total += out.length
  }
  const pcm = new Int16Array(total)
  let offset = 0
  for (const part of parts) {
    pcm.set(part, offset)
    offset += part.length
  }
  return pcm
}

/**
 * EA-XAS v1 frames as interleaved 16-bit PCM: every 128 samples of a stream are one 76-byte frame
 * per channel, in channel order. A frame is four groups of 32 samples: first a header per group, two
 * little-endian words that are the group's first two samples, the first with the filter in its low
 * nibble and the second with 20 - shift; then 15 rows of one byte per group, two codes each, high
 * nibble first. Frames carry no predictor from one to the next. `samples` (per channel) ends the
 * stream inside its last frame.
 */
export function decodeEaXas(frames: Uint8Array, channels: number, samples?: number): Int16Array {
  checkChannels(channels)
  const stride = EA_XAS_FRAME_BYTES * channels
  if (frames.byteLength % stride !== 0) {
    throw new RangeError(`EA-XAS data is not a whole number of ${stride}-byte frames`)
  }
  const count = frames.byteLength / stride
  const available = count * EA_XAS_FRAME_SAMPLES
  const length = samples ?? available
  if (!Number.isInteger(length) || length < 0 || length > available) {
    throw new RangeError(`EA-XAS frames hold ${available} samples per channel, not ${length}`)
  }
  const view = new DataView(frames.buffer, frames.byteOffset, frames.byteLength)
  const out = new Int16Array(length * channels)
  for (let frame = 0; frame < count; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = (frame * channels + channel) * EA_XAS_FRAME_BYTES
      for (let group = 0; group < 4; group += 1) {
        const first = view.getInt16(at + 4 * group, true)
        const second = view.getInt16(at + 4 * group + 2, true)
        const weight1 = WEIGHTS[first & 0x0f] ?? 0
        const weight2 = WEIGHTS[(first & 0x0f) + 4] ?? 0
        const shift = 20 - (second & 0x0f)
        const start = frame * EA_XAS_FRAME_SAMPLES + group * 32
        const put = (position: number, value: number) => {
          if (start + position < length) out[(start + position) * channels + channel] = value
        }
        let beforePrevious = first & ~0x0f
        let previous = second & ~0x0f
        put(0, beforePrevious)
        put(1, previous)
        for (let row = 0; row < 15; row += 1) {
          const byte = frames[at + 16 + 4 * row + group] ?? 0
          for (let half = 0; half < 2; half += 1) {
            const code = half === 0 ? (byte << 24) >> 28 : (byte << 28) >> 28
            const decoded = clamp16(
              ((code << shift) + previous * weight1 + beforePrevious * weight2 + 0x80) >> 8,
            )
            beforePrevious = previous
            previous = decoded
            put(2 + 2 * row + half, decoded)
          }
        }
      }
    }
  }
  return out
}
