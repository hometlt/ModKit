import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/bnk'
const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

function parseBnk(bytes, context) {
  if (bytes.byteLength < 16 || ascii(bytes, 0, 4) !== 'BKHD') {
    throw new TypeError('not a Wwise BNK soundbank')
  }
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('BNK exceeds maxInputBytes')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new RangeError('BNK chunk header is truncated')
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > bytes.byteLength) throw new RangeError(`BNK ${id} chunk is truncated`)
    chunks.push({ id, size, start })
    if (chunks.length > context.budget.maxNodes) throw new RangeError('BNK exceeds maxNodes')
    offset = start + size
  }
  const header = chunks.find(chunk => chunk.id === 'BKHD')
  const didx = chunks.find(chunk => chunk.id === 'DIDX')
  const data = chunks.find(chunk => chunk.id === 'DATA')
  if (header === undefined || header.size < 8 || didx === undefined || data === undefined) {
    throw new TypeError('BNK requires BKHD, DIDX and DATA chunks')
  }
  if (didx.size % 12 !== 0) throw new TypeError('BNK DIDX size is not a record multiple')
  const streamCount = didx.size / 12
  if (chunks.length + streamCount > context.budget.maxNodes)
    throw new RangeError('BNK exceeds maxNodes')
  const streams = []
  for (let index = 0; index < streamCount; index += 1) {
    const record = didx.start + index * 12
    const id = view.getUint32(record, true)
    const relativeOffset = view.getUint32(record + 4, true)
    const size = view.getUint32(record + 8, true)
    const start = data.start + relativeOffset
    if (start < data.start || start + size > data.start + data.size) {
      throw new RangeError(`BNK stream ${id} is outside DATA`)
    }
    const payload = bytes.slice(start, start + size)
    if (
      payload.byteLength < 12 ||
      !['RIFF', 'RIFX'].includes(ascii(payload, 0, 4)) ||
      ascii(payload, 8, 4) !== 'WAVE'
    ) {
      throw new TypeError(`BNK stream ${id} is not a WEM RIFF/WAVE payload`)
    }
    streams.push({ id, relativeOffset, size, start, payload })
  }
  if (streams.length < 1) throw new TypeError('BNK carries no embedded WEM streams')
  const first = streams[0]
  const firstView = new DataView(
    first.payload.buffer,
    first.payload.byteOffset,
    first.payload.byteLength,
  )
  const littleEndian = ascii(first.payload, 0, 4) === 'RIFF'
  let format
  for (let at = 12; at + 8 <= first.payload.byteLength;) {
    const id = ascii(first.payload, at, 4)
    const size = firstView.getUint32(at + 4, littleEndian)
    const start = at + 8
    if (start + size > first.payload.byteLength) break
    if (id === 'fmt ' && size >= 16) {
      format = {
        tag: firstView.getUint16(start, littleEndian),
        channels: firstView.getUint16(start + 2, littleEndian),
        sampleRate: firstView.getUint32(start + 4, littleEndian),
        byteRate: firstView.getUint32(start + 8, littleEndian),
      }
      break
    }
    at = start + size + (size & 1)
  }
  if (format === undefined || format.channels < 1 || format.sampleRate < 1) {
    throw new TypeError('BNK first WEM has no usable fmt chunk')
  }
  return {
    chunks,
    bankVersion: view.getUint32(header.start, true),
    bankId: view.getUint32(header.start + 4, true),
    streams,
    dataBytes: data.size,
    format,
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'bnk', label: 'Wwise SoundBank' }),
  async detect(prefix) {
    return prefix.byteLength >= 8 && ascii(prefix, 0, 4) === 'BKHD'
      ? { confidence: 0.99, kind: 'magic', note: 'wwise-bkhd' }
      : { confidence: 0, kind: 'magic', note: 'bkhd-mismatch' }
  },
  async inspect(bytes, context) {
    const bank = parseBnk(bytes, context)
    const first = bank.streams[0]
    const audio = createAudioMediaSource(first.payload, 'audio/x-wwise-wem', {
      durationMs: 0,
      seekable: false,
      tracks: [
        {
          id: String(first.id),
          codec: bank.format.tag === 1 ? 'pcm' : `wwise-0x${bank.format.tag.toString(16)}`,
          channels: bank.format.channels,
          sampleRate: bank.format.sampleRate,
          bitrateKbps: Math.round((bank.format.byteRate * 8) / 1000),
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    return {
      summary: {
        format: 'bnk',
        bankVersion: bank.bankVersion,
        bankId: bank.bankId,
        chunks: bank.chunks.length,
        streams: bank.streams.length,
        dataBytes: bank.dataBytes,
      },
      metadata: [
        {
          id: 'wwise-bank',
          label: 'Wwise SoundBank',
          entries: [
            { key: 'bankVersion', value: bank.bankVersion },
            { key: 'bankId', value: bank.bankId },
            { key: 'chunks', value: bank.chunks.map(chunk => chunk.id).join(', ') },
            { key: 'streams', value: bank.streams.length },
            { key: 'dataBytes', value: bank.dataBytes },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: bank.streams.length, codec: 'wem' } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'audio',
          label: `Wwise SoundBank ${bank.bankId}`,
          preview: `${bank.streams.length} embedded WEM stream(s)`,
          children: [
            ...bank.chunks.map(chunk => ({
              kind: 'chunk',
              label: chunk.id,
              preview: `${chunk.size} bytes at ${chunk.start}`,
            })),
            ...bank.streams.map(stream => ({
              kind: 'audio',
              label: `${stream.id}.wem`,
              preview: `${stream.size} bytes at DATA+${stream.relativeOffset}`,
            })),
          ],
        }),
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: [
        'hirc-event-synthesis',
        'external-stream-resolution',
        'multi-track-selection',
        'compressed-audio-transcoding',
        'soundbank-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
