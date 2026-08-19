import {
  createAudioMediaSource,
  createInspectionCodec,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  TRANSPORT_OPERATIONS,
} from '@modkitx-x3/codec-kit'

const latin1 = new TextDecoder('latin1')

function isId3(bytes) {
  return bytes.byteLength >= 10 && latin1.decode(bytes.subarray(0, 3)) === 'ID3'
}

function id3Size(bytes) {
  if (!isId3(bytes)) return 0
  const size =
    (((bytes[6] ?? 0) & 0x7f) << 21) |
    (((bytes[7] ?? 0) & 0x7f) << 14) |
    (((bytes[8] ?? 0) & 0x7f) << 7) |
    ((bytes[9] ?? 0) & 0x7f)
  return 10 + size + (((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0)
}

function frameAt(bytes, offset) {
  if (
    offset + 4 > bytes.byteLength ||
    bytes[offset] !== 0xff ||
    ((bytes[offset + 1] ?? 0) & 0xe0) !== 0xe0
  ) {
    return undefined
  }
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  const versionBits = (b1 >> 3) & 3
  const layerBits = (b1 >> 1) & 3
  const bitrateIndex = (b2 >> 4) & 0x0f
  const sampleIndex = (b2 >> 2) & 3
  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleIndex === 3
  ) {
    return undefined
  }
  const version = versionBits === 3 ? 'MPEG-1' : versionBits === 2 ? 'MPEG-2' : 'MPEG-2.5'
  const sampleBase = [44_100, 48_000, 32_000][sampleIndex]
  const sampleRate =
    versionBits === 3 ? sampleBase : versionBits === 2 ? sampleBase / 2 : sampleBase / 4
  const bitrates =
    versionBits === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  return Object.freeze({
    offset,
    version,
    layer: 'III',
    sampleRate,
    bitrateKbps: bitrates[bitrateIndex],
    channels: ((b3 >> 6) & 3) === 3 ? 1 : 2,
  })
}

function findFrame(bytes) {
  const start = Math.min(id3Size(bytes), bytes.byteLength)
  const end = Math.min(bytes.byteLength - 3, start + 16_384)
  for (let offset = start; offset < end; offset += 1) {
    const frame = frameAt(bytes, offset)
    if (frame !== undefined) return frame
  }
  return undefined
}

function id3Info(bytes) {
  if (!isId3(bytes)) return undefined
  return Object.freeze({
    version: `2.${bytes[3] ?? 0}.${bytes[4] ?? 0}`,
    bytes: id3Size(bytes),
  })
}

const definition = Object.freeze({
  id: 'org.modkitx/audio-mp3',
  format: Object.freeze({ id: 'mp3', label: 'MP3 audio', mediaType: 'audio/mpeg' }),
  operations: TRANSPORT_OPERATIONS,
  async detect(bytes) {
    const frame = findFrame(bytes)
    if (frame !== undefined) return { confidence: 0.99, note: 'mpeg-layer-3-frame' }
    if (isId3(bytes)) return { confidence: 0.72, note: 'id3-prefix-without-bounded-frame' }
    return { confidence: 0.01, note: 'mp3-frame-missing' }
  },
  async inspect(bytes) {
    const frame = findFrame(bytes)
    if (frame === undefined) throw new TypeError('MP3 frame header is missing')
    const id3 = id3Info(bytes)
    const audioBytes = Math.max(0, bytes.byteLength - (id3?.bytes ?? 0))
    const durationMs = Math.round((audioBytes * 8 * 1000) / (frame.bitrateKbps * 1000))
    const audio = createAudioMediaSource(bytes, 'audio/mpeg', {
      durationMs,
      seekable: true,
      pcmAccess: false,
      tracks: [
        {
          id: 'audio-0',
          codec: 'mp3',
          channels: frame.channels,
          sampleRate: frame.sampleRate,
          bitrateKbps: frame.bitrateKbps,
          selected: true,
        },
      ],
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'MP3',
      preview: `${frame.sampleRate} Hz, ${frame.bitrateKbps} kbps`,
      children: [
        ...(id3 === undefined
          ? []
          : [{ kind: 'metadata', label: 'ID3', preview: `${id3.version}, ${id3.bytes} bytes` }]),
        {
          kind: 'stream',
          label: `${frame.version} Layer ${frame.layer}`,
          preview: `${frame.channels} channel(s), ~${durationMs} ms`,
        },
      ],
    })
    const transport = createTransportSource({
      state: 'idle',
      positionMs: 0,
      durationMs,
      rate: 1,
      seekable: true,
      live: false,
      tracks: [{ id: 'audio-0', kind: 'audio', label: 'MPEG audio', selected: true }],
      controls: {
        playPause: 'media.play-pause',
        seek: 'media.seek',
        setRate: 'media.set-rate',
        selectTrack: 'media.select-track',
      },
    })
    return {
      summary: {
        format: 'mp3',
        sampleRate: frame.sampleRate,
        bitrateKbps: frame.bitrateKbps,
        channels: frame.channels,
        durationMs,
        id3Version: id3?.version ?? null,
      },
      metadata: [
        {
          id: 'mpeg-audio',
          label: 'MPEG audio',
          entries: [
            { key: 'version', value: frame.version },
            { key: 'layer', value: frame.layer },
            { key: 'sampleRate', value: frame.sampleRate },
            { key: 'bitrateKbps', value: frame.bitrateKbps },
            { key: 'channels', value: frame.channels },
            { key: 'durationMs', value: durationMs },
          ],
        },
        ...(id3 === undefined
          ? []
          : [
              {
                id: 'id3',
                label: 'ID3',
                entries: [
                  { key: 'version', value: id3.version },
                  { key: 'bytes', value: id3.bytes },
                ],
              },
            ]),
      ],
      traits: [
        {
          id: 'audio.streams',
          parameters: {
            count: 1,
            codec: 'mp3',
            sampleRate: frame.sampleRate,
            channels: frame.channels,
          },
        },
        { id: 'media.duration', parameters: { milliseconds: durationMs, estimated: true } },
        { id: 'media.seekable', parameters: { value: true } },
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
