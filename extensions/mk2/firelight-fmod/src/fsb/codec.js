// Hand-ported from org.modkitx/fsb. The FSB5 header and sample-table layout follow the original
// clean-room MK2 implementation; this MK3 profile inventories streams and preserves the encoded
// bank, but deliberately makes no decoding or transcoding claim.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/fsb'
const ascii = new TextDecoder('latin1')
const utf8 = new TextDecoder('utf-8', { fatal: false })
const SAMPLE_RATES = Object.freeze([4000, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000])
const CHANNEL_COUNTS = Object.freeze([1, 2, 6, 8])
const CODECS = Object.freeze({
  0x01: 'pcm8',
  0x02: 'pcm16',
  0x03: 'pcm24',
  0x04: 'pcm32',
  0x05: 'pcm-float',
  0x06: 'gc-adpcm',
  0x07: 'ima-adpcm',
  0x08: 'vag',
  0x09: 'hevag',
  0x0a: 'xma',
  0x0b: 'mpeg',
  0x0c: 'celt',
  0x0d: 'atrac9',
  0x0e: 'xwma',
  0x0f: 'vorbis',
  0x10: 'fmod-fadpcm',
  0x11: 'opus',
})

function codecName(value) {
  return CODECS[value] ?? `unknown-${value}`
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function signature(bytes) {
  return bytes.byteLength >= 4 && ascii.decode(bytes.subarray(0, 4)) === 'FSB5'
}

function streamName(bytes, tableOffset, tableSize, index, streamCount) {
  if (tableSize < streamCount * 4) return undefined
  const relative = view(bytes).getUint32(tableOffset + index * 4, true)
  if (relative < streamCount * 4 || relative >= tableSize) return undefined
  const start = tableOffset + relative
  const limit = tableOffset + tableSize
  let end = start
  while (end < limit && bytes[end] !== 0) end += 1
  if (end === start || end === limit) return undefined
  return utf8.decode(bytes.subarray(start, end))
}

function parseFsb5(bytes, context) {
  if (!signature(bytes) || bytes.byteLength < 0x3c) {
    throw new TypeError('FSB5 header is invalid or truncated')
  }
  const data = view(bytes)
  const version = data.getUint32(0x04, true)
  if (version !== 0 && version !== 1) throw new TypeError(`unsupported FSB5 version ${version}`)
  const streamCount = data.getUint32(0x08, true)
  if (streamCount === 0) throw new TypeError('FSB5 sound bank contains no streams')
  if (streamCount > context.budget.maxNodes) throw new RangeError('FSB5 stream count exceeds maxNodes budget')
  const sampleHeaderSize = data.getUint32(0x0c, true)
  const nameTableSize = data.getUint32(0x10, true)
  const sampleDataSize = data.getUint32(0x14, true)
  const codec = data.getUint32(0x18, true)
  const flags = data.getUint32(0x20, true)
  const baseHeaderSize = version === 1 ? 0x3c : 0x40
  const expectedSize = baseHeaderSize + sampleHeaderSize + nameTableSize + sampleDataSize
  if (expectedSize !== bytes.byteLength) {
    throw new TypeError(`FSB5 declared size ${expectedSize} does not match ${bytes.byteLength}`)
  }
  const sampleHeaderEnd = baseHeaderSize + sampleHeaderSize
  if (sampleHeaderSize < streamCount * 8 || sampleHeaderEnd > bytes.byteLength) {
    throw new TypeError('FSB5 sample header table is invalid')
  }

  const parsed = []
  let cursor = baseHeaderSize
  for (let index = 0; index < streamCount; index += 1) {
    if (cursor + 8 > sampleHeaderEnd) throw new TypeError(`FSB5 stream ${index} header is truncated`)
    const mode = data.getBigUint64(cursor, true)
    const numSamples = Number((mode >> 34n) & 0x3fffffffn)
    const dataRelative = Number((mode >> 7n) & 0x07ffffffn) << 5
    let channels = CHANNEL_COUNTS[Number((mode >> 5n) & 0x03n)] ?? 0
    let sampleRate = SAMPLE_RATES[Number((mode >> 1n) & 0x0fn)] ?? 0
    cursor += 8
    if ((mode & 1n) !== 0n) {
      let another = true
      while (another) {
        if (cursor + 4 > sampleHeaderEnd) throw new TypeError(`FSB5 stream ${index} extra header is truncated`)
        const extra = data.getUint32(cursor, true)
        const type = (extra >>> 25) & 0x7f
        const size = (extra >>> 1) & 0xffffff
        another = (extra & 1) !== 0
        if (cursor + 4 + size > sampleHeaderEnd) throw new TypeError(`FSB5 stream ${index} extra payload is truncated`)
        if (type === 0x01 && size >= 1) channels = bytes[cursor + 4] ?? channels
        if (type === 0x02 && size >= 4) sampleRate = data.getInt32(cursor + 4, true)
        cursor += 4 + size
      }
    }
    if (channels <= 0 || sampleRate <= 0 || numSamples <= 0) {
      throw new TypeError(`FSB5 stream ${index} has invalid audio parameters`)
    }
    parsed.push({ index, channels, sampleRate, numSamples, dataRelative })
  }
  if (cursor !== sampleHeaderEnd) throw new TypeError('FSB5 sample header table has unparsed bytes')

  const nameTableOffset = sampleHeaderEnd
  const dataBase = nameTableOffset + nameTableSize
  const streams = parsed.map((stream, index) => {
    const nextRelative = parsed[index + 1]?.dataRelative ?? sampleDataSize
    if (stream.dataRelative > sampleDataSize || nextRelative < stream.dataRelative || nextRelative > sampleDataSize) {
      throw new TypeError(`FSB5 stream ${index} has an invalid data range`)
    }
    const name = streamName(bytes, nameTableOffset, nameTableSize, index, streamCount)
    return Object.freeze({
      ...stream,
      ...(name === undefined ? {} : { name }),
      durationMs: Math.round((stream.numSamples / stream.sampleRate) * 1000),
      dataOffset: dataBase + stream.dataRelative,
      dataSize: nextRelative - stream.dataRelative,
    })
  })
  return Object.freeze({
    version,
    codec,
    codecName: codecName(codec),
    flags,
    sampleHeaderSize,
    nameTableSize,
    sampleDataSize,
    streams: Object.freeze(streams),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'fsb', label: 'FMOD Sound Bank (FSB5)', mediaType: 'audio/x-fsb' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'fsb5-signature' }
      : { confidence: 0, kind: 'magic', note: 'fsb5-mismatch' }
  },
  async inspect(bytes, context) {
    const fsb = parseFsb5(bytes, context)
    const longest = fsb.streams.reduce((duration, stream) => Math.max(duration, stream.durationMs), 0)
    const audio = createAudioMediaSource(bytes, 'audio/x-fsb', {
      durationMs: longest,
      seekable: false,
      tracks: fsb.streams.map(stream => ({
        id: `stream-${stream.index}`,
        codec: fsb.codecName,
        channels: stream.channels,
        sampleRate: stream.sampleRate,
        selected: stream.index === 0,
      })),
      pcmAccess: false,
    })
    return {
      summary: {
        format: 'fsb',
        container: 'fsb5',
        version: fsb.version,
        codec: fsb.codecName,
        streams: fsb.streams.length,
        sampleHeaderBytes: fsb.sampleHeaderSize,
        nameTableBytes: fsb.nameTableSize,
        audioBytes: fsb.sampleDataSize,
      },
      metadata: [{
        id: 'fsb5-bank',
        label: 'FMOD FSB5 sound bank',
        entries: [
          { key: 'version', value: fsb.version },
          { key: 'codec', value: fsb.codecName },
          { key: 'codecId', value: fsb.codec },
          { key: 'flags', value: fsb.flags },
          { key: 'streams', value: fsb.streams.length },
          { key: 'sampleHeaderBytes', value: fsb.sampleHeaderSize },
          { key: 'nameTableBytes', value: fsb.nameTableSize },
          { key: 'audioBytes', value: fsb.sampleDataSize },
        ],
      }],
      traits: [
        { id: 'audio.streams', parameters: { count: fsb.streams.length, codec: fsb.codecName } },
        { id: 'media.duration', parameters: { milliseconds: longest } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'audio',
          label: 'FSB5',
          preview: `${fsb.streams.length} stream(s), ${fsb.codecName}`,
          children: fsb.streams.map(stream => ({
            kind: 'stream',
            label: stream.name ?? `stream ${stream.index}`,
            preview: `${stream.channels} ch, ${stream.sampleRate} Hz, ${stream.numSamples} samples, ${stream.dataSize} bytes`,
          })),
        }),
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['fadpcm-decoding', 'payload-transcoding', 'per-stream-extraction', 'bank-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
