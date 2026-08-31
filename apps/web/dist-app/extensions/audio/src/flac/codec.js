import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/flac'
const BLOCK_TYPES = Object.freeze([
  'STREAMINFO',
  'PADDING',
  'APPLICATION',
  'SEEKTABLE',
  'VORBIS_COMMENT',
  'CUESHEET',
  'PICTURE',
])

function streamInfo(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const minimumBlockSize = view.getUint16(offset, false)
  const maximumBlockSize = view.getUint16(offset + 2, false)
  const minimumFrameSize = (bytes[offset + 4] << 16) | (bytes[offset + 5] << 8) | bytes[offset + 6]
  const maximumFrameSize = (bytes[offset + 7] << 16) | (bytes[offset + 8] << 8) | bytes[offset + 9]
  const packedHigh = view.getUint32(offset + 10, false)
  const packedLow = view.getUint32(offset + 14, false)
  const sampleRate = packedHigh >>> 12
  const channels = ((packedHigh >>> 9) & 7) + 1
  const bitsPerSample = ((packedHigh >>> 4) & 0x1f) + 1
  const totalSamples = (BigInt(packedHigh & 0x0f) << 32n) | BigInt(packedLow)
  if (
    minimumBlockSize < 16 ||
    maximumBlockSize < minimumBlockSize ||
    sampleRate < 1 ||
    channels < 1 ||
    bitsPerSample < 4 ||
    bitsPerSample > 32
  )
    throw new TypeError('FLAC STREAMINFO fields are invalid')
  return Object.freeze({
    minimumBlockSize,
    maximumBlockSize,
    minimumFrameSize,
    maximumFrameSize,
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    md5: Array.from(bytes.subarray(offset + 18, offset + 34), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  })
}

// RFC 9639 metadata-block framing: one last-block bit, seven-bit type, 24-bit payload length.
function parseFlac(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('FLAC structure exceeds maxDepth budget')
  if (bytes.byteLength < 42 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'fLaC')
    throw new TypeError('FLAC stream marker is missing')
  const blocks = []
  let offset = 4
  let last = false
  while (!last) {
    if (blocks.length >= budget.maxNodes)
      throw new RangeError('FLAC metadata blocks exceed maxNodes budget')
    if (offset + 4 > bytes.byteLength) throw new RangeError('FLAC metadata header is truncated')
    const header = bytes[offset]
    last = (header & 0x80) !== 0
    const type = header & 0x7f
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    const dataOffset = offset + 4
    if (type === 127) throw new TypeError('FLAC metadata block type 127 is invalid')
    if (dataOffset + length > bytes.byteLength)
      throw new RangeError('FLAC metadata payload is truncated')
    blocks.push(
      Object.freeze({
        type,
        name: BLOCK_TYPES[type] ?? `reserved-${type}`,
        offset,
        dataOffset,
        length,
        last,
      }),
    )
    offset = dataOffset + length
  }
  const first = blocks[0]
  if (first?.type !== 0 || first.length !== 34)
    throw new TypeError('FLAC first metadata block must be 34-byte STREAMINFO')
  if (
    offset + 2 > bytes.byteLength ||
    bytes[offset] !== 0xff ||
    (bytes[offset + 1] & 0xfc) !== 0xf8
  )
    throw new TypeError('FLAC audio frame sync is missing after metadata')
  if (blocks.length * 48 + 34 > budget.maxScalarBytes)
    throw new RangeError('FLAC metadata exceeds maxScalarBytes budget')
  const info = streamInfo(bytes, first.dataOffset)
  const durationMs =
    info.totalSamples === 0n
      ? 'unknown'
      : Math.round((Number(info.totalSamples) / info.sampleRate) * 1000)
  return Object.freeze({ blocks: Object.freeze(blocks), audioOffset: offset, info, durationMs })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'flac', label: 'FLAC', mediaType: 'audio/flac' }),
  async detect(prefix) {
    return prefix.byteLength >= 4 && String.fromCharCode(...prefix.subarray(0, 4)) === 'fLaC'
      ? { confidence: 0.995, kind: 'magic', note: 'FLAC stream marker' }
      : { confidence: 0, kind: 'magic', note: 'FLAC stream marker missing' }
  },
  async inspect(bytes, context) {
    const parsed = parseFlac(bytes, context.budget)
    const info = parsed.info
    const audio = createAudioMediaSource(bytes, 'audio/flac', {
      durationMs: parsed.durationMs,
      seekable: parsed.blocks.some(block => block.type === 3),
      tracks: [
        {
          id: 'flac-0',
          codec: 'flac',
          channels: info.channels,
          sampleRate: info.sampleRate,
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'FLAC',
      preview: `${info.sampleRate} Hz, ${info.channels} channel(s), ${info.bitsPerSample}-bit`,
      children: [
        ...parsed.blocks.map(block => ({
          kind: 'metadata',
          label: block.name,
          preview: `${block.length} bytes at ${block.dataOffset}${block.last ? ', last' : ''}`,
        })),
        {
          kind: 'stream',
          label: 'Audio frames',
          preview: `${bytes.byteLength - parsed.audioOffset} bytes at ${parsed.audioOffset}`,
        },
      ],
    })
    return {
      summary: {
        format: 'flac',
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitsPerSample: info.bitsPerSample,
        totalSamples: info.totalSamples.toString(),
        durationMs: parsed.durationMs,
        minimumBlockSize: info.minimumBlockSize,
        maximumBlockSize: info.maximumBlockSize,
        metadataBlocks: parsed.blocks.length,
      },
      metadata: [
        {
          id: 'flac-streaminfo',
          label: 'FLAC STREAMINFO',
          entries: [
            { key: 'sampleRate', value: info.sampleRate },
            { key: 'channels', value: info.channels },
            { key: 'bitsPerSample', value: info.bitsPerSample },
            { key: 'totalSamples', value: info.totalSamples.toString() },
            { key: 'minimumBlockSize', value: info.minimumBlockSize },
            { key: 'maximumBlockSize', value: info.maximumBlockSize },
            { key: 'md5', value: info.md5 },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: 1, codec: 'flac' } },
        ...(parsed.durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: parsed.durationMs } }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: [
        'pcm-decoding',
        'frame-level-validation-and-seeking-without-seektable',
        'vorbis-comments-pictures-and-cuesheet-decoding',
        'writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
