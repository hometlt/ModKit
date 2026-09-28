/**
 * Westwood's two sound compressions, as its AUD files and VQA movies carry them (Command & Conquer
 * through Red Alert 2). Both match ffmpeg sample for sample — `adpcm_ima_ws` and `ws_snd1` — on
 * the installed Tiberian Sun AUDs, a Red Alert 2 VQA and synthetic streams of every code.
 *
 * - IMA ADPCM, Westwood's way (AUD type 99, VQA `SND2`): IMA steps, but the difference is
 *   `((2 * magnitude + 1) * step) >> 3` rather than Microsoft's sum of shifted steps, codes low
 *   nibble first, no block headers: the predictor of each channel starts at 0 and runs on through
 *   every chunk. Interleaved stereo alternates one byte (two samples) per channel; a version 3 VQA
 *   gives each channel one half of a chunk instead (`planar`).
 * - WS SND1 (AUD type 1, VQA `SND1`): 8-bit mono, in chunks each decoded from 128 afresh. A byte's
 *   top two bits pick the code, its low six a count: 2-bit deltas, 4-bit deltas, one 5-bit delta or
 *   raw samples, or a run of the current sample. A chunk as long as its output is raw.
 */
import { IMA_INDEX_TABLE, IMA_STEP_TABLE } from './ima.js'

const WS_4BIT_DELTAS = [-9, -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8]

/**
 * Westwood IMA ADPCM chunks, in order, as interleaved 16-bit PCM: two samples per byte, each
 * channel's predictor running on across chunks. `planar` is a version 3 VQA's stereo, each chunk
 * the left half then the right.
 */
export function decodeImaWs(
  chunks: readonly Uint8Array[],
  channels: 1 | 2,
  layout: 'interleaved' | 'planar' = 'interleaved',
): Int16Array {
  if (channels !== 1 && channels !== 2) throw new RangeError('Westwood IMA ADPCM is mono or stereo')
  let bytes = 0
  for (const chunk of chunks) {
    if (chunk.byteLength % channels !== 0) {
      throw new RangeError('a stereo Westwood IMA ADPCM chunk has an odd number of bytes')
    }
    bytes += chunk.byteLength
  }
  const out = new Int16Array(bytes * 2)
  const predictors = [0, 0]
  const indices = [0, 0]
  const next = (channel: number, code: number): number => {
    const index = indices[channel] ?? 0
    const difference = ((2 * (code & 7) + 1) * (IMA_STEP_TABLE[index] ?? 0)) >> 3
    const predictor = (predictors[channel] ?? 0) + ((code & 8) !== 0 ? -difference : difference)
    const clamped = predictor < -32_768 ? -32_768 : predictor > 32_767 ? 32_767 : predictor
    predictors[channel] = clamped
    indices[channel] = Math.min(88, Math.max(0, index + (IMA_INDEX_TABLE[code] ?? 0)))
    return clamped
  }
  let written = 0
  for (const chunk of chunks) {
    if (channels === 1) {
      for (const byte of chunk) {
        out[written++] = next(0, byte & 15)
        out[written++] = next(0, byte >> 4)
      }
      continue
    }
    const half = chunk.byteLength / 2
    for (let pair = 0; pair < half; pair += 1) {
      const left = chunk[layout === 'planar' ? pair : 2 * pair] ?? 0
      const right = chunk[layout === 'planar' ? half + pair : 2 * pair + 1] ?? 0
      out[written++] = next(0, left & 15)
      out[written++] = next(1, right & 15)
      out[written++] = next(0, left >> 4)
      out[written++] = next(1, right >> 4)
    }
  }
  return out
}

/** One WS SND1 chunk: its compressed bytes and the 8-bit samples they expand to. */
export interface WsAdpcmChunk {
  readonly data: Uint8Array
  readonly samples: number
}

/**
 * WS SND1 chunks, in order, as 16-bit mono PCM (`(sample - 128) << 8`). A code whose output or
 * input would run past its chunk ends the chunk, as in ffmpeg; the samples it leaves unwritten
 * hold the last value.
 */
export function decodeWsAdpcm(chunks: readonly WsAdpcmChunk[]): Int16Array {
  let total = 0
  for (const { samples } of chunks) {
    if (!Number.isInteger(samples) || samples < 0)
      throw new RangeError('WS SND1 sample count must be a whole number')
    total += samples
  }
  const out = new Int16Array(total)
  let written = 0
  for (const { data, samples } of chunks) {
    const end = written + samples
    let sample = 128
    const put = (value: number) => {
      sample = value < 0 ? 0 : value > 255 ? 255 : value
      out[written++] = (sample - 128) << 8
    }
    if (data.byteLength === samples) {
      for (const byte of data) put(byte)
      continue
    }
    let at = 0
    while (written < end && at < data.byteLength) {
      const byte = data[at++] ?? 0
      const code = byte >> 6
      const count = (byte & 0x3f) + 1
      const size =
        code === 0
          ? 4 * count
          : code === 1
            ? 2 * count
            : code === 2 && (byte & 0x20) !== 0
              ? 1
              : count
      const input = code === 3 || (code === 2 && (byte & 0x20) !== 0) ? 0 : count
      if (end - written < size || data.byteLength - at < input) break
      if (code === 0) {
        for (let k = 0; k < count; k += 1) {
          const bits = data[at++] ?? 0
          for (let shift = 0; shift < 8; shift += 2) put(sample + ((bits >> shift) & 3) - 2)
        }
      } else if (code === 1) {
        for (let k = 0; k < count; k += 1) {
          const bits = data[at++] ?? 0
          put(sample + (WS_4BIT_DELTAS[bits & 15] ?? 0))
          put(sample + (WS_4BIT_DELTAS[bits >> 4] ?? 0))
        }
      } else if (code === 2 && (byte & 0x20) !== 0) {
        // the low five bits of the count, signed
        put(sample + (((byte & 0x1f) << 27) >> 27))
      } else if (code === 2) {
        for (let k = 0; k < count; k += 1) put(data[at++] ?? 0)
      } else {
        for (let k = 0; k < count; k += 1) put(sample)
      }
    }
    while (written < end) put(sample)
  }
  return out
}
