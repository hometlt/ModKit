/**
 * The 4-byte header of an MPEG audio frame (MPEG-1, MPEG-2 and MPEG-2.5, layers I–III; ISO/IEC
 * 11172-3 and 13818-3): what the frame holds and how long it is, so that a codec can walk the
 * frames of an MP3 or MP2 stream without decoding them. Free-format frames (bitrate index 0) have no
 * length in the header and are not read.
 */

export interface MpegAudioFrame {
  readonly version: 1 | 2 | 2.5
  readonly layer: 1 | 2 | 3
  readonly bitrateKbps: number
  readonly sampleRate: number
  readonly channels: 1 | 2
  /** Samples per channel the frame decodes to. */
  readonly samples: number
  /** The whole frame, header and padding slot included. */
  readonly bytes: number
}

/** Kilobits per second by bitrate index, for MPEG-1 layers I, II, III. */
const MPEG1_BITRATES = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
] as const
/** The same for MPEG-2 and MPEG-2.5, layer I and then layers II and III. */
const MPEG2_BITRATES = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
] as const
const SAMPLE_RATES = [44_100, 48_000, 32_000] as const

/** The frame whose header starts at `offset`, or `undefined` when none does. */
export function mpegAudioFrame(bytes: Uint8Array, offset: number): MpegAudioFrame | undefined {
  if (offset < 0 || offset + 4 > bytes.byteLength) return undefined
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return undefined
  const versionBits = (b1 >> 3) & 3
  const layerBits = (b1 >> 1) & 3
  const bitrateIndex = (b2 >> 4) & 0x0f
  const rateIndex = (b2 >> 2) & 3
  if (versionBits === 1 || layerBits === 0 || rateIndex === 3) return undefined
  if (bitrateIndex === 0 || bitrateIndex === 15) return undefined
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5
  const layer = (4 - layerBits) as 1 | 2 | 3
  const bitrates =
    version === 1 ? MPEG1_BITRATES[layer - 1] : MPEG2_BITRATES[layer === 1 ? 0 : 1]
  const bitrateKbps = bitrates?.[bitrateIndex] ?? 0
  const sampleRate = (SAMPLE_RATES[rateIndex] ?? 0) / (version === 1 ? 1 : version === 2 ? 2 : 4)
  const padding = (b2 >> 1) & 1
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152
  // samples / 8 bytes per bit per second; layer I counts in 4-byte slots.
  const frameBytes =
    layer === 1
      ? (Math.floor((12_000 * bitrateKbps) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * 1000 * bitrateKbps) / sampleRate) + padding
  return {
    version,
    layer,
    bitrateKbps,
    sampleRate,
    channels: ((b3 >> 6) & 3) === 3 ? 1 : 2,
    samples,
    bytes: frameBytes,
  }
}
