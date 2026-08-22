import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/wem'
const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

function parseWem(bytes, context) {
  if (bytes.byteLength < 12) throw new TypeError('WEM RIFF header is truncated')
  const riff = ascii(bytes, 0, 4)
  const littleEndian = riff === 'RIFF'
  if ((!littleEndian && riff !== 'RIFX') || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new TypeError('WEM must be RIFF/RIFX WAVE')
  }
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('WEM exceeds maxInputBytes')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declaredSize = view.getUint32(4, littleEndian)
  if (declaredSize + 8 !== bytes.byteLength) throw new TypeError('WEM RIFF size is inconsistent')
  const chunks = []
  let offset = 12
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new RangeError('WEM chunk header is truncated')
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, littleEndian)
    const start = offset + 8
    if (start + size > bytes.byteLength) throw new RangeError(`WEM ${id} chunk is truncated`)
    chunks.push({ id, size, start })
    if (chunks.length > context.budget.maxNodes) throw new RangeError('WEM exceeds maxNodes')
    offset = start + size + (size & 1)
  }
  if (offset !== bytes.byteLength) throw new TypeError('WEM chunk padding is inconsistent')
  const formatChunk = chunks.find(chunk => chunk.id === 'fmt ')
  const dataChunk = chunks.find(chunk => chunk.id === 'data')
  if (formatChunk === undefined || formatChunk.size < 16 || dataChunk === undefined) {
    throw new TypeError('WEM requires fmt and data chunks')
  }
  const formatTag = view.getUint16(formatChunk.start, littleEndian)
  const channels = view.getUint16(formatChunk.start + 2, littleEndian)
  const sampleRate = view.getUint32(formatChunk.start + 4, littleEndian)
  const byteRate = view.getUint32(formatChunk.start + 8, littleEndian)
  const blockAlign = view.getUint16(formatChunk.start + 12, littleEndian)
  const bitsPerSample = view.getUint16(formatChunk.start + 14, littleEndian)
  if (channels < 1 || sampleRate < 1 || blockAlign < 1) {
    throw new TypeError('WEM fmt values are invalid')
  }
  const codec =
    new Map([
      [1, 'pcm'],
      [2, 'ms-adpcm'],
      [0x11, 'ima-adpcm'],
      [0xffff, 'wwise-vorbis'],
      [0xfffe, 'wwise-extensible'],
      [0x3041, 'wwise-opus'],
    ]).get(formatTag) ?? `wwise-0x${formatTag.toString(16)}`
  const durationMs = byteRate > 0 ? Math.round((dataChunk.size / byteRate) * 1000) : 0
  return {
    riff,
    chunks,
    formatTag,
    codec,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataChunk,
    durationMs,
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'wem', label: 'Wwise WEM', mediaType: 'audio/x-wwise-wem' }),
  async detect(prefix) {
    return prefix.byteLength >= 12 &&
      (ascii(prefix, 0, 4) === 'RIFF' || ascii(prefix, 0, 4) === 'RIFX') &&
      ascii(prefix, 8, 4) === 'WAVE'
      ? { confidence: 0.98, kind: 'magic', note: 'wwise-riff-wave' }
      : { confidence: 0, kind: 'magic', note: 'riff-wave-mismatch' }
  },
  async inspect(bytes, context) {
    const wem = parseWem(bytes, context)
    const audio = createAudioMediaSource(bytes, 'audio/x-wwise-wem', {
      durationMs: wem.durationMs,
      seekable: wem.byteRate > 0,
      tracks: [
        {
          id: 'stream-0',
          codec: wem.codec,
          channels: wem.channels,
          sampleRate: wem.sampleRate,
          bitrateKbps: Math.round((wem.byteRate * 8) / 1000),
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    return {
      summary: {
        format: 'wem',
        riff: wem.riff,
        codec: wem.codec,
        channels: wem.channels,
        sampleRate: wem.sampleRate,
        bitsPerSample: wem.bitsPerSample,
        dataBytes: wem.dataChunk.size,
        durationMs: wem.durationMs,
        chunks: wem.chunks.length,
      },
      metadata: [
        {
          id: 'wwise-wem',
          label: 'Wwise WEM',
          entries: [
            { key: 'riff', value: wem.riff },
            { key: 'formatTag', value: wem.formatTag },
            { key: 'codec', value: wem.codec },
            { key: 'channels', value: wem.channels },
            { key: 'sampleRate', value: wem.sampleRate },
            { key: 'bitsPerSample', value: wem.bitsPerSample },
            { key: 'dataBytes', value: wem.dataChunk.size },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: 1, codec: wem.codec } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'audio',
          label: 'Wwise WEM',
          preview: `${wem.sampleRate} Hz; ${wem.channels} channel(s); ${wem.codec}`,
          children: wem.chunks.map(chunk => ({
            kind: 'chunk',
            label: chunk.id,
            preview: `${chunk.size} bytes at ${chunk.start}`,
          })),
        }),
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['pcm-decoding', 'compressed-audio-transcoding', 'wem-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
