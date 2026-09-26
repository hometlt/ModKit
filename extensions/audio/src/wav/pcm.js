/**
 * WAV sample decoding: linear PCM and IMA ADPCM.
 *
 * The v1 port deliberately stopped at the chunk walk and left decoding "behind native playback".
 * That line held only as long as the native player could read the file — and it cannot read
 * IMA ADPCM, which is exactly what StarCraft II ships its UI sounds as. So the decode lives here,
 * bounded by the frame window the caller asks for, and the viewer plays what comes back.
 */

/** IMA ADPCM step index adjustment per 4-bit nibble magnitude. */
const INDEX_TABLE = Object.freeze([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8])

/** IMA ADPCM quantiser step sizes (89 entries, the standard table). */
const STEP_TABLE = Object.freeze([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10_442,
  11_487, 12_635, 13_899, 15_289, 16_818, 18_500, 20_350, 22_385, 24_623, 27_086, 29_794, 32_767,
])

const clampSample = value => (value < -32_768 ? -32_768 : value > 32_767 ? 32_767 : value)

/** Advance one IMA ADPCM state by one nibble and return the new predictor. */
function stepAdpcm(state, nibble) {
  const step = STEP_TABLE[state.index]
  let difference = step >> 3
  if ((nibble & 1) !== 0) difference += step >> 2
  if ((nibble & 2) !== 0) difference += step >> 1
  if ((nibble & 4) !== 0) difference += step
  state.predictor = clampSample(
    (nibble & 8) !== 0 ? state.predictor - difference : state.predictor + difference,
  )
  state.index = Math.min(88, Math.max(0, state.index + INDEX_TABLE[nibble]))
  return state.predictor
}

/** Frames per IMA ADPCM block for one channel: 1 preamble frame plus two nibbles per byte. */
export function adpcmFramesPerBlock(blockAlign, channels) {
  if (blockAlign <= 4 * channels) return 0
  return 1 + ((blockAlign - 4 * channels) * 2) / channels
}

/**
 * Frames in a short last IMA ADPCM block of `bytes`: its header frame and 8 per whole group of
 * 4-byte words (one word per channel), as Microsoft IMA allows at the end of a stream.
 */
function adpcmTailFrames(bytes, channels) {
  const header = 4 * channels
  return bytes < header ? 0 : 1 + Math.floor((bytes - header) / header) * 8
}

/** How many whole frames the data chunk holds for this format. */
export function frameCountFor(format, dataBytes) {
  if (format.encoding === 'ima-adpcm') {
    if (format.blockAlign <= 0) return 0
    const blocks = Math.floor(dataBytes / format.blockAlign)
    return (
      blocks * adpcmFramesPerBlock(format.blockAlign, format.channels) +
      adpcmTailFrames(dataBytes % format.blockAlign, format.channels)
    )
  }
  if (format.blockAlign <= 0) return 0
  return Math.floor(dataBytes / format.blockAlign)
}

/** True when this module can turn the declared format into samples. */
export function isDecodableFormat(format) {
  if (format.encoding === 'ima-adpcm') {
    return format.bitsPerSample === 4 && format.channels > 0 && format.blockAlign > 4
  }
  if (format.encoding === 'pcm' || format.encoding === 'extensible') {
    return [8, 16, 24, 32].includes(format.bitsPerSample) && format.channels > 0
  }
  if (format.encoding === 'ieee-float') {
    return [32, 64].includes(format.bitsPerSample) && format.channels > 0
  }
  return false
}

function readLinearFrame(view, offset, format, channel) {
  const at = offset + (channel * format.bitsPerSample) / 8
  if (format.encoding === 'ieee-float') {
    return format.bitsPerSample === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true)
  }
  if (format.bitsPerSample === 8) return (view.getUint8(at) - 128) / 128
  if (format.bitsPerSample === 16) return view.getInt16(at, true) / 32_768
  if (format.bitsPerSample === 24) {
    const value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)
    return value / 8_388_608
  }
  return view.getInt32(at, true) / 2_147_483_648
}

function decodeLinear(data, format, fromFrame, frameCount, channels) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = (fromFrame + frame) * format.blockAlign
    for (let channel = 0; channel < format.channels; channel += 1) {
      channels[channel][frame] = readLinearFrame(view, offset, format, channel)
    }
  }
}

/**
 * IMA ADPCM stores interleaved per-channel blocks: each channel opens its block with a 16-bit
 * predictor and an 8-bit step index, then the nibble stream alternates between channels in
 * 4-byte groups. Decoding therefore walks whole blocks even when the caller wants a window inside
 * one, and copies out only the window.
 */
function decodeImaAdpcm(data, format, fromFrame, frameCount, channels) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const framesPerBlock = adpcmFramesPerBlock(format.blockAlign, format.channels)
  if (framesPerBlock <= 0) throw new RangeError('IMA ADPCM block alignment carries no frames')
  const firstBlock = Math.floor(fromFrame / framesPerBlock)
  const lastFrame = fromFrame + frameCount
  const lastBlock = Math.ceil(lastFrame / framesPerBlock)
  const states = Array.from({ length: format.channels }, () => ({ predictor: 0, index: 0 }))
  for (let block = firstBlock; block < lastBlock; block += 1) {
    const blockStart = block * format.blockAlign
    // The last block may be short: it keeps its header and the whole word groups it has.
    const blockBytes = Math.min(format.blockAlign, data.byteLength - blockStart)
    if (blockBytes < 4 * format.channels) break
    let frame = block * framesPerBlock
    for (let channel = 0; channel < format.channels; channel += 1) {
      const at = blockStart + channel * 4
      states[channel].predictor = view.getInt16(at, true)
      states[channel].index = Math.min(88, Math.max(0, view.getUint8(at + 2)))
      const target = frame - fromFrame
      if (target >= 0 && target < frameCount) {
        channels[channel][target] = states[channel].predictor / 32_768
      }
    }
    frame += 1
    const nibbleStart = blockStart + 4 * format.channels
    // Each 4-byte word holds 8 nibbles, i.e. 8 frames of one channel; words alternate by channel.
    const groups = Math.floor((blockBytes - 4 * format.channels) / (4 * format.channels))
    for (let group = 0; group < groups; group += 1) {
      for (let channel = 0; channel < format.channels; channel += 1) {
        const at = nibbleStart + (group * format.channels + channel) * 4
        for (let byte = 0; byte < 4; byte += 1) {
          const packed = view.getUint8(at + byte)
          // Low nibble is the earlier sample; the pair spans two consecutive frames.
          const low = stepAdpcm(states[channel], packed & 0xf)
          const lowTarget = frame + byte * 2 - fromFrame
          if (lowTarget >= 0 && lowTarget < frameCount) channels[channel][lowTarget] = low / 32_768
          const high = stepAdpcm(states[channel], (packed >> 4) & 0xf)
          const highTarget = lowTarget + 1
          if (highTarget >= 0 && highTarget < frameCount) {
            channels[channel][highTarget] = high / 32_768
          }
        }
      }
      frame += 8
    }
  }
}

/**
 * Decode a frame window to per-channel float arrays in [-1, 1].
 *
 * `data` is the `data` chunk only. The window is clamped to the frames the chunk actually holds,
 * so a caller asking past the end gets what exists rather than an exception or invented silence.
 */
export function decodeWavPcm(data, format, fromFrame, requestedFrames) {
  if (!isDecodableFormat(format)) {
    throw new RangeError(
      `WAV ${format.encoding} at ${format.bitsPerSample} bits has no decoder in this package`,
    )
  }
  const total = frameCountFor(format, data.byteLength)
  const start = Math.max(0, Math.min(fromFrame, total))
  const frameCount = Math.max(0, Math.min(requestedFrames, total - start))
  const channels = Array.from({ length: format.channels }, () => new Float32Array(frameCount))
  if (frameCount === 0) return channels
  if (format.encoding === 'ima-adpcm') decodeImaAdpcm(data, format, start, frameCount, channels)
  else decodeLinear(data, format, start, frameCount, channels)
  return channels
}
