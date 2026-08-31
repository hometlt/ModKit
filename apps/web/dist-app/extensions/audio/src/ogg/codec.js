import {
  createAudioMediaSource,
  createInspectionCodec,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  TRANSPORT_OPERATIONS,
} from '@modkit/codec-kit'

const latin1 = new TextDecoder('latin1')

function capture(bytes, offset, length) {
  return latin1.decode(bytes.subarray(offset, offset + length))
}

function u32(bytes, offset) {
  if (offset + 4 > bytes.byteLength) throw new RangeError('truncated Ogg u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function u64(bytes, offset) {
  if (offset + 8 > bytes.byteLength) throw new RangeError('truncated Ogg u64')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
}

function parseOgg(bytes, maxPages) {
  const pages = []
  const streams = new Map()
  let offset = 0
  while (offset < bytes.byteLength) {
    if (pages.length >= maxPages) throw new RangeError('Ogg page count exceeds maxNodes budget')
    if (offset + 27 > bytes.byteLength || capture(bytes, offset, 4) !== 'OggS') {
      throw new TypeError('Ogg page capture pattern is missing')
    }
    if (bytes[offset + 4] !== 0) throw new TypeError('unsupported Ogg bitstream version')
    const flags = bytes[offset + 5] ?? 0
    const granule = u64(bytes, offset + 6)
    const serial = u32(bytes, offset + 14)
    const sequence = u32(bytes, offset + 18)
    const segmentCount = bytes[offset + 26] ?? 0
    const headerEnd = offset + 27 + segmentCount
    if (headerEnd > bytes.byteLength) throw new TypeError('Ogg segment table is truncated')
    let payloadBytes = 0
    for (let index = 0; index < segmentCount; index += 1)
      payloadBytes += bytes[offset + 27 + index] ?? 0
    const pageEnd = headerEnd + payloadBytes
    if (pageEnd > bytes.byteLength) throw new TypeError('Ogg page payload is truncated')
    const firstPacket = bytes.subarray(headerEnd, pageEnd)
    const current = streams.get(serial) ?? {
      serial,
      codec: 'unknown',
      channels: undefined,
      sampleRate: undefined,
      maxGranule: 0n,
      pages: 0,
    }
    if ((flags & 0x02) !== 0) {
      if (capture(firstPacket, 0, 8) === 'OpusHead' && firstPacket.byteLength >= 19) {
        current.codec = 'opus'
        current.channels = firstPacket[9]
        current.sampleRate = 48_000
      } else if (
        firstPacket[0] === 1 &&
        capture(firstPacket, 1, 6) === 'vorbis' &&
        firstPacket.byteLength >= 16
      ) {
        current.codec = 'vorbis'
        current.channels = firstPacket[11]
        current.sampleRate = u32(firstPacket, 12)
      }
    }
    if (granule !== 0xffffffffffffffffn && granule > current.maxGranule)
      current.maxGranule = granule
    current.pages += 1
    streams.set(serial, current)
    pages.push(Object.freeze({ serial, sequence, granule, payloadBytes, flags }))
    offset = pageEnd
  }
  if (pages.length === 0) throw new TypeError('Ogg stream has no pages')
  return Object.freeze({
    pages: Object.freeze(pages),
    streams: Object.freeze([...streams.values()]),
  })
}

const definition = Object.freeze({
  id: 'modkit/audio-ogg',
  format: Object.freeze({ id: 'ogg', label: 'Ogg media', mediaType: 'audio/ogg' }),
  operations: TRANSPORT_OPERATIONS.filter(operation => operation.id !== 'media.seek'),
  async detect(bytes) {
    const match = bytes.byteLength >= 4 && capture(bytes, 0, 4) === 'OggS'
    return {
      confidence: match ? 0.995 : 0.01,
      note: match ? 'ogg-capture-pattern' : 'capture-pattern-missing',
    }
  },
  async inspect(bytes, context) {
    const ogg = parseOgg(bytes, context.budget.maxNodes)
    const audioStreams = ogg.streams.filter(
      stream => stream.codec === 'opus' || stream.codec === 'vorbis',
    )
    if (audioStreams.length === 0) {
      throw new TypeError('Ogg stream contains no supported Opus or Vorbis audio track')
    }
    const primary = audioStreams[0] ?? ogg.streams[0]
    const durationMs =
      primary?.sampleRate && primary.maxGranule > 0n
        ? Number((primary.maxGranule * 1000n) / BigInt(primary.sampleRate))
        : 'unknown'
    const audio = createAudioMediaSource(bytes, 'audio/ogg', {
      durationMs,
      seekable: durationMs !== 'unknown',
      pcmAccess: false,
      tracks: audioStreams.map((stream, index) => ({
        id: `logical-${stream.serial}`,
        codec: stream.codec,
        channels: stream.channels ?? 'unknown',
        sampleRate: stream.sampleRate ?? 'unknown',
        selected: index === 0,
      })),
    })
    const transport = createTransportSource({
      state: 'idle',
      positionMs: 0,
      durationMs,
      rate: 1,
      seekable: durationMs !== 'unknown',
      live: false,
      tracks: ogg.streams.map(stream => ({
        id: `logical-${stream.serial}`,
        kind: stream.codec === 'unknown' ? 'data' : 'audio',
        label: `${stream.codec} (${stream.serial})`,
        selected: stream === primary,
      })),
      controls: {
        playPause: 'media.play-pause',
        ...(durationMs === 'unknown' ? {} : { seek: 'media.seek' }),
        setRate: 'media.set-rate',
        selectTrack: 'media.select-track',
      },
    })
    const tree = createTreeDataSource({
      kind: 'container',
      label: 'Ogg',
      preview: `${ogg.pages.length} pages, ${ogg.streams.length} logical stream(s)`,
      children: ogg.streams.map(stream => ({
        kind: 'logical-stream',
        label: `${stream.serial}: ${stream.codec}`,
        preview: `${stream.pages} pages${stream.sampleRate ? `, ${stream.sampleRate} Hz` : ''}`,
      })),
    })
    return {
      summary: {
        format: 'ogg',
        pages: ogg.pages.length,
        streams: ogg.streams.length,
        codecs: ogg.streams.map(stream => stream.codec),
        durationMs,
      },
      metadata: [
        {
          id: 'ogg-container',
          label: 'Ogg container',
          entries: [
            { key: 'pages', value: ogg.pages.length },
            { key: 'logicalStreams', value: ogg.streams.length },
            { key: 'codecs', value: ogg.streams.map(stream => stream.codec) },
            { key: 'durationMs', value: durationMs },
          ],
        },
      ],
      traits: [
        {
          id: 'audio.streams',
          parameters: {
            count: audioStreams.length,
            codecs: audioStreams.map(stream => stream.codec),
          },
        },
        ...(durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: durationMs } }]),
        {
          id: 'container.entries',
          parameters: { pages: ogg.pages.length, logicalStreams: ogg.streams.length },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/transport-source': transport,
        'common.view/audio-media-source': audio,
      },
      handlers: createTransportHandlers(transport),
      unsupportedFeatures: ['pcm-decoder-provider'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
