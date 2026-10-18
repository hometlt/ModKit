// Hand-ported from the MK2 codec modkit/wav (OPUS-MK2-02 task G, wave 1).
//
// RIFF/WAVE is a chunk list, so the port is a chunk walk: `fmt ` gives the stream shape, `data`
// gives the sample bytes, everything else is inventoried by id and size.
//
// Wave 2B moved the decoding line. The v1 limitation put samples "behind native playback", which
// only works while the platform player can read the file — and it cannot read IMA ADPCM, the
// encoding StarCraft II uses for its UI sounds. Linear PCM and IMA ADPCM are now decoded here and
// published through `readPcm`; the encoded view carries the WHOLE RIFF file, because a player
// handed a bare `data` chunk has no format to play it with.
//
// The v1 manifest routed on `.wav` alone, so `detect` earns its confidence from the RIFF/WAVE
// header and the presence of a well-formed `fmt ` chunk instead of trusting the name.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { decodeWavPcm, frameCountFor, isDecodableFormat } from './pcm.js'

const ID = 'modkit/wav'
const latin1 = new TextDecoder('latin1')

/** RIFF WAVE wFormatTag values worth naming; anything else is reported by its number. */
const FORMAT_TAGS = Object.freeze({
  0x0001: 'pcm',
  0x0002: 'ms-adpcm',
  0x0003: 'ieee-float',
  0x0006: 'a-law',
  0x0007: 'mu-law',
  0x0011: 'ima-adpcm',
  0xfffe: 'extensible',
})

const fourCc = (bytes, offset) => latin1.decode(bytes.subarray(offset, offset + 4))

function u16le(bytes, offset) {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0
}

function u32le(bytes, offset) {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  )
}

const isRiffWave = bytes =>
  bytes.byteLength >= 12 && fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'WAVE'

/**
 * Walks the chunk list. Chunks are word-aligned: an odd size is followed by one pad byte, which
 * is a classic source of off-by-one readers, so it is handled here and asserted by the fixture.
 */
function readChunks(bytes, maxChunks) {
  if (!isRiffWave(bytes)) throw new TypeError('RIFF/WAVE signature is invalid')
  const chunks = []
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = fourCc(bytes, offset)
    const size = u32le(bytes, offset + 4)
    const start = offset + 8
    const available = Math.max(0, Math.min(size, bytes.byteLength - start))
    chunks.push(Object.freeze({ id, size, start, bytes: available, truncated: available !== size }))
    if (chunks.length > maxChunks) throw new RangeError('RIFF chunk count exceeds maxNodes')
    offset = start + size + (size % 2)
  }
  return Object.freeze(chunks)
}

/** `fmt ` is WAVEFORMAT/WAVEFORMATEX: tag, channels, rate, byte rate, block align, bit depth. */
function readFormat(bytes, chunk) {
  if (chunk === undefined || chunk.bytes < 16) return undefined
  const at = chunk.start
  const tag = u16le(bytes, at)
  let adpcm
  if (tag === 2) {
    if (chunk.bytes < 22) throw new TypeError('Microsoft ADPCM fmt extension is truncated')
    const extensionBytes = u16le(bytes, at + 16), count = u16le(bytes, at + 20)
    if (count < 1 || count > 256 || extensionBytes < 4 + count * 4 || 18 + extensionBytes > chunk.bytes)
      throw new TypeError('Microsoft ADPCM fmt coefficient extent')
    const signed = offset => (u16le(bytes, offset) << 16) >> 16
    adpcm = { samplesPerBlock: u16le(bytes, at + 18),
      coefficients: Array.from({ length: count }, (_, i) => Object.freeze([signed(at + 22 + i * 4), signed(at + 24 + i * 4)])) }
  }
  return Object.freeze({
    tag,
    encoding: FORMAT_TAGS[tag] ?? `format-${tag}`,
    channels: u16le(bytes, at + 2),
    sampleRate: u32le(bytes, at + 4),
    byteRate: u32le(bytes, at + 8),
    blockAlign: u16le(bytes, at + 12),
    bitsPerSample: u16le(bytes, at + 14),
    ...adpcm,
  })
}

/** Inspect native RIFF/WAVE bytes; reused by referencing formats without creating another session. */
export async function inspectWav(bytes, context) {
  const chunks = readChunks(bytes, context.budget.maxNodes)
  let format = readFormat(
    bytes,
    chunks.find(chunk => chunk.id === 'fmt '),
  )
  if (format === undefined) throw new TypeError('RIFF/WAVE carries no usable fmt chunk')
  if (format.encoding === 'ms-adpcm') {
    if (!isDecodableFormat(format)) throw new TypeError('Microsoft ADPCM invalid frame/block declaration')
    const fact = chunks.find(chunk => chunk.id === 'fact')
    if (fact !== undefined && fact.bytes < 4) throw new TypeError('Microsoft ADPCM fact is truncated')
    if (fact !== undefined) format = Object.freeze({ ...format, sampleFrames: u32le(bytes, fact.start) })
  }
  const data = chunks.find(chunk => chunk.id === 'data')
  if (data === undefined) throw new TypeError('RIFF/WAVE carries no data chunk')
  const frames = frameCountFor(format, data.bytes)
  const durationMs = format.encoding === 'ms-adpcm' && format.sampleRate > 0
    ? Math.round(frames / format.sampleRate * 1000)
    : format.byteRate > 0 ? Math.round((data.bytes / format.byteRate) * 1000) : 'unknown'
  const decodable = isDecodableFormat(format)
  const samples = bytes.subarray(data.start, data.start + data.bytes)

  const readPcm = async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    if (request.trackId !== 'stream-0') {
      throw new RangeError(`unknown audio track ${String(request.trackId)}`)
    }
    if (typeof request.fromFrame !== 'bigint' || request.fromFrame < 0n) {
      throw new RangeError('WAV PCM fromFrame must be a non-negative bigint')
    }
    if (!Number.isSafeInteger(request.frameCount) || request.frameCount < 0) {
      throw new RangeError('WAV PCM frameCount must be a non-negative safe integer')
    }
    const needed = request.frameCount * format.channels * 4
    if (!Number.isSafeInteger(needed) || needed > request.maxBytes) {
      throw new RangeError('WAV PCM window exceeds maxBytes budget')
    }
    const fromFrame = Number(request.fromFrame)
    if (!Number.isSafeInteger(fromFrame)) {
      throw new RangeError('WAV PCM fromFrame exceeds the safe integer range')
    }
    const channels = decodeWavPcm(samples, format, fromFrame, request.frameCount)
    /*
     * Interleave into ONE buffer before answering. The boundary requires each typed array to own
     * its whole buffer, so per-channel arrays cross as N separate payloads; one interleaved
     * buffer is what `AudioPcmBlock` asks for and what the wire is built to carry.
     */
    const channelCount = channels.length
    const decodedFrames = channels[0]?.length ?? 0
    const interleaved = new Float32Array(decodedFrames * channelCount)
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = channels[channel]
      for (let frame = 0; frame < decodedFrames; frame += 1) {
        interleaved[frame * channelCount + channel] = source[frame]
      }
    }
    return Object.freeze({
      sampleRate: format.sampleRate,
      fromFrame: BigInt(Math.min(fromFrame, frames)),
      frameCount: decodedFrames,
      channelCount,
      samples: interleaved,
    })
  }

  // The whole RIFF file, not the bare `data` chunk: a platform player needs the header.
  const audio = createAudioMediaSource(
    bytes,
    'audio/wav',
    {
      durationMs,
      seekable: true, // uncompressed frames are a constant size: any sample offset is arithmetic
      tracks: [
        {
          id: 'stream-0',
          codec: format.encoding,
          channels: format.channels,
          sampleRate: format.sampleRate,
          bitrateKbps: Math.round((format.byteRate * 8) / 1000),
          selected: true,
        },
      ],
      pcmAccess: decodable,
    },
    ...(decodable ? [readPcm] : []),
  )
  const tree = createTreeDataSource({
    kind: 'audio',
    label: 'WAV',
    preview: `${format.sampleRate} Hz, ${format.channels} channel(s), ${format.bitsPerSample}-bit ${format.encoding}`,
    children: chunks.map(chunk => ({
      kind: 'chunk',
      label: chunk.id,
      preview: `${chunk.bytes} bytes${chunk.truncated ? ' (truncated)' : ''} at ${chunk.start}`,
    })),
  })
  return {
    summary: {
      format: 'wav',
      encoding: format.encoding,
      channels: format.channels,
      sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample,
      frames,
      durationMs,
      chunks: chunks.length,
    },
    metadata: [
      {
        id: 'riff-wave',
        label: 'RIFF/WAVE format',
        entries: [
          { key: 'encoding', value: format.encoding },
          { key: 'formatTag', value: format.tag },
          { key: 'channels', value: format.channels },
          { key: 'sampleRate', value: format.sampleRate },
          { key: 'bitsPerSample', value: format.bitsPerSample },
          { key: 'byteRate', value: format.byteRate },
          { key: 'blockAlign', value: format.blockAlign },
          { key: 'dataBytes', value: data.bytes },
          { key: 'frames', value: frames },
        ],
      },
    ],
    traits: [
      { id: 'audio.streams', parameters: { count: 1, codec: format.encoding } },
      ...(durationMs === 'unknown'
        ? []
        : [{ id: 'media.duration', parameters: { milliseconds: durationMs } }]),
      { id: 'media.seekable', parameters: { constantBitrate: true } },
      { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
    ],
    dataSources: {
      'common.view/tree-data-source': tree,
      'common.view/audio-media-source': audio,
    },
    unsupportedFeatures: [
      ...(decodable ? [] : [`pcm-decoding-for-${format.encoding}-${format.bitsPerSample}bit`]),
      'cue-and-playlist-chunks',
      'broadcast-wave-metadata',
    ],
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'wav', label: 'WAV (RIFF)', mediaType: 'audio/wav' }),
  async detect(prefix) {
    if (!isRiffWave(prefix)) return { confidence: 0, kind: 'magic', note: 'riff-wave-mismatch' }
    const format = readFormat(
      prefix,
      readChunks(prefix, 256).find(chunk => chunk.id === 'fmt '),
    )
    if (format === undefined) return { confidence: 0.6, kind: 'magic', note: 'riff-wave-no-fmt' }
    return { confidence: 0.98, kind: 'magic', note: `riff-wave-${format.encoding}` }
  },
  inspect: inspectWav,
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
