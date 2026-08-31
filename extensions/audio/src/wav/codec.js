// Hand-ported from the MK2 codec org.modkitx/wav (OPUS-MK2-02 task G, wave 1).
//
// RIFF/WAVE is a chunk list, so the port is a chunk walk: `fmt ` gives the stream shape, `data`
// gives the sample bytes, everything else is inventoried by id and size. PCM samples are not
// decoded — the v1 limitation puts decoding behind native playback or an injected transcoder,
// and this port keeps that line.
//
// The v1 manifest routed on `.wav` alone, so `detect` earns its confidence from the RIFF/WAVE
// header and the presence of a well-formed `fmt ` chunk instead of trusting the name.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/wav'
const latin1 = new TextDecoder('latin1')

/** RIFF WAVE wFormatTag values worth naming; anything else is reported by its number. */
const FORMAT_TAGS = Object.freeze({
  0x0001: 'pcm',
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
  return Object.freeze({
    tag,
    encoding: FORMAT_TAGS[tag] ?? `format-${tag}`,
    channels: u16le(bytes, at + 2),
    sampleRate: u32le(bytes, at + 4),
    byteRate: u32le(bytes, at + 8),
    blockAlign: u16le(bytes, at + 12),
    bitsPerSample: u16le(bytes, at + 14),
  })
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
  async inspect(bytes, context) {
    const chunks = readChunks(bytes, context.budget.maxNodes)
    const format = readFormat(
      bytes,
      chunks.find(chunk => chunk.id === 'fmt '),
    )
    if (format === undefined) throw new TypeError('RIFF/WAVE carries no usable fmt chunk')
    const data = chunks.find(chunk => chunk.id === 'data')
    if (data === undefined) throw new TypeError('RIFF/WAVE carries no data chunk')
    const durationMs =
      format.byteRate > 0 ? Math.round((data.bytes / format.byteRate) * 1000) : 'unknown'
    const frames = format.blockAlign > 0 ? Math.floor(data.bytes / format.blockAlign) : 0

    const audio = createAudioMediaSource(
      bytes.subarray(data.start, data.start + data.bytes),
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
        pcmAccess: false, // decoding is out of scope; see the v1 limitation
      },
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
      unsupportedFeatures: ['pcm-decoding', 'cue-and-playlist-chunks', 'broadcast-wave-metadata'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
