// Hand-ported from org.modkitx/wmv. The reader validates ASF object framing, the mandatory
// header objects, stream type-specific data, file properties, and the following Data Object.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/wmv'
const latin1 = new TextDecoder('latin1')

const GUIDS = Object.freeze({
  HEADER: '3026b2758e66cf11a6d900aa0062ce6c',
  DATA: '3626b2758e66cf11a6d900aa0062ce6c',
  FILE_PROPERTIES: 'a1dcab8c47a9cf118ee400c00c205365',
  STREAM_PROPERTIES: '9107dcb7b7a9cf118ee600c00c205365',
  HEADER_EXTENSION: 'b503bf5f2ea9cf118ee300c00c205365',
  VIDEO_MEDIA: 'c0ef19bc4d5bcf11a8fd00805f5c442b',
  AUDIO_MEDIA: '409e69f84d5bcf11a8fd00805f5c442b',
})

const OBJECT_NAMES = Object.freeze({
  [GUIDS.HEADER]: 'Header Object',
  [GUIDS.DATA]: 'Data Object',
  [GUIDS.FILE_PROPERTIES]: 'File Properties Object',
  [GUIDS.STREAM_PROPERTIES]: 'Stream Properties Object',
  [GUIDS.HEADER_EXTENSION]: 'Header Extension Object',
})

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const u16le = (bytes, offset) => viewOf(bytes).getUint16(offset, true)
const u32le = (bytes, offset) => viewOf(bytes).getUint32(offset, true)
const i32le = (bytes, offset) => viewOf(bytes).getInt32(offset, true)
const u64le = (bytes, offset) =>
  BigInt(u32le(bytes, offset)) | (BigInt(u32le(bytes, offset + 4)) << 32n)
const guidAt = (bytes, offset) =>
  [...bytes.subarray(offset, offset + 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const equalBytes = (bytes, left, right, length) => {
  for (let index = 0; index < length; index += 1) {
    if (bytes[left + index] !== bytes[right + index]) return false
  }
  return true
}

const hasAsfHeader = bytes => bytes.byteLength >= 16 && guidAt(bytes, 0) === GUIDS.HEADER

function charge(state, budget, bytes = 96) {
  state.bytes += bytes
  if (state.bytes > budget.maxScalarBytes) {
    throw new RangeError('ASF decoded metadata exceeds maxScalarBytes budget')
  }
}

function safeSize(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the portable safe-integer range`)
  }
  return Number(value)
}

function objectAt(bytes, offset, end, label) {
  if (offset + 24 > end) throw new TypeError(`${label} header is truncated`)
  const guid = guidAt(bytes, offset)
  const size = safeSize(u64le(bytes, offset + 16), `${label} size`)
  if (size < 24 || offset + size > end) throw new RangeError(`${label} exceeds its ASF container`)
  return Object.freeze({
    guid,
    name: OBJECT_NAMES[guid] ?? `GUID ${guid.slice(0, 8)}`,
    offset,
    size,
    dataOffset: offset + 24,
  })
}

function fileProperties(bytes, object) {
  if (object.size < 104) throw new TypeError('ASF File Properties Object is truncated')
  const at = object.dataOffset
  const fileSize = u64le(bytes, at + 16)
  const dataPackets = u64le(bytes, at + 32)
  const playDuration = u64le(bytes, at + 40)
  const sendDuration = u64le(bytes, at + 48)
  const preroll = u64le(bytes, at + 56)
  const flags = u32le(bytes, at + 64)
  const minimumPacketSize = u32le(bytes, at + 68)
  const maximumPacketSize = u32le(bytes, at + 72)
  const maximumBitrate = u32le(bytes, at + 76)
  if (fileSize !== 0n && fileSize !== BigInt(bytes.byteLength)) {
    throw new TypeError('ASF File Properties size differs from the source')
  }
  if (minimumPacketSize > maximumPacketSize) {
    throw new TypeError('ASF File Properties packet-size range is invalid')
  }
  const playMilliseconds = playDuration / 10_000n
  const duration = playMilliseconds > preroll ? playMilliseconds - preroll : 0n
  return Object.freeze({
    fileIdOffset: at,
    fileSize,
    dataPackets,
    playDuration,
    sendDuration,
    preroll,
    flags,
    minimumPacketSize,
    maximumPacketSize,
    maximumBitrate,
    durationMs: duration <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(duration) : 'unknown',
    seekable: (flags & 0x2) !== 0,
    broadcast: (flags & 0x1) !== 0,
  })
}

function compressionName(bytes, offset) {
  const numeric = u32le(bytes, offset)
  if (numeric === 0) return 'BI_RGB'
  const text = latin1.decode(bytes.subarray(offset, offset + 4))
  return /^[\x20-\x7e]{4}$/u.test(text) ? text.trim() : `0x${numeric.toString(16)}`
}

function streamProperties(bytes, object, index) {
  if (object.size < 78) throw new TypeError(`ASF Stream Properties Object ${index} is truncated`)
  const at = object.dataOffset
  const streamType = guidAt(bytes, at)
  const typeDataLength = u32le(bytes, at + 40)
  const errorCorrectionLength = u32le(bytes, at + 44)
  const flags = u16le(bytes, at + 48)
  const streamNumber = flags & 0x7f
  const encrypted = (flags & 0x8000) !== 0
  const expectedSize = 78 + typeDataLength + errorCorrectionLength
  if (expectedSize !== object.size || streamNumber === 0) {
    throw new TypeError(
      `ASF Stream Properties Object ${index} has invalid lengths or stream number`,
    )
  }
  const typeData = at + 54

  if (streamType === GUIDS.VIDEO_MEDIA) {
    if (typeDataLength < 51) throw new TypeError(`ASF video stream ${index} type data is truncated`)
    const encodedWidth = u32le(bytes, typeData)
    const encodedHeight = u32le(bytes, typeData + 4)
    const formatDataSize = u16le(bytes, typeData + 9)
    if (formatDataSize < 40 || 11 + formatDataSize > typeDataLength) {
      throw new TypeError(`ASF video stream ${index} format-data size is invalid`)
    }
    const bitmap = typeData + 11
    const bitmapSize = u32le(bytes, bitmap)
    const bitmapWidth = i32le(bytes, bitmap + 4)
    const bitmapHeight = i32le(bytes, bitmap + 8)
    const planes = u16le(bytes, bitmap + 12)
    const bitsPerPixel = u16le(bytes, bitmap + 14)
    const width = encodedWidth || bitmapWidth
    const height = encodedHeight || Math.abs(bitmapHeight)
    if (
      bitmapSize < 40 ||
      bitmapSize > formatDataSize ||
      width <= 0 ||
      height <= 0 ||
      planes !== 1 ||
      bitsPerPixel === 0
    ) {
      throw new TypeError(`ASF video stream ${index} BITMAPINFOHEADER is invalid`)
    }
    return Object.freeze({
      index,
      streamNumber,
      kind: 'video',
      codec: compressionName(bytes, bitmap + 16),
      width,
      height,
      bitsPerPixel,
      encrypted,
    })
  }

  if (streamType === GUIDS.AUDIO_MEDIA) {
    if (typeDataLength < 16) throw new TypeError(`ASF audio stream ${index} type data is truncated`)
    const formatTag = u16le(bytes, typeData)
    const channels = u16le(bytes, typeData + 2)
    const sampleRate = u32le(bytes, typeData + 4)
    const averageBytesPerSecond = u32le(bytes, typeData + 8)
    const blockAlign = u16le(bytes, typeData + 12)
    const bitsPerSample = u16le(bytes, typeData + 14)
    if (formatTag === 0 || channels === 0 || sampleRate === 0 || blockAlign === 0) {
      throw new TypeError(`ASF audio stream ${index} WAVEFORMATEX is invalid`)
    }
    return Object.freeze({
      index,
      streamNumber,
      kind: 'audio',
      codec: `wave-format-${formatTag}`,
      channels,
      sampleRate,
      averageBytesPerSecond,
      bitsPerSample,
      encrypted,
    })
  }

  return Object.freeze({
    index,
    streamNumber,
    kind: 'other',
    codec: `guid-${streamType.slice(0, 8)}`,
    encrypted,
  })
}

function validateHeaderExtension(bytes, object) {
  if (object.size < 46) throw new TypeError('ASF Header Extension Object is truncated')
  const extensionDataSize = u32le(bytes, object.dataOffset + 18)
  if (object.size !== 46 + extensionDataSize) {
    throw new TypeError('ASF Header Extension data size is invalid')
  }
}

function summarize(bytes, budget) {
  if (!hasAsfHeader(bytes)) throw new TypeError('ASF Header Object GUID is missing')
  if (bytes.byteLength < 30) throw new TypeError('ASF Header Object is truncated')
  if (budget.maxDepth < 1) throw new RangeError('ASF object nesting exceeds maxDepth budget')
  const headerSize = safeSize(u64le(bytes, 16), 'ASF Header Object size')
  const headerObjects = u32le(bytes, 24)
  if (headerSize < 30 || headerSize > bytes.byteLength || bytes[28] !== 1 || bytes[29] !== 2) {
    throw new TypeError('ASF Header Object size or reserved bytes are invalid')
  }
  if (headerObjects > budget.maxNodes)
    throw new RangeError('ASF object count exceeds maxNodes budget')
  const state = { bytes: 0 }
  const objects = []
  let offset = 30
  for (let index = 0; index < headerObjects; index += 1) {
    const object = objectAt(bytes, offset, headerSize, `ASF header object ${index}`)
    charge(state, budget)
    objects.push(object)
    offset += object.size
  }
  if (offset !== headerSize)
    throw new TypeError('ASF Header Object count does not consume its size')

  const fileObjects = objects.filter(object => object.guid === GUIDS.FILE_PROPERTIES)
  const streamObjects = objects.filter(object => object.guid === GUIDS.STREAM_PROPERTIES)
  const extensionObjects = objects.filter(object => object.guid === GUIDS.HEADER_EXTENSION)
  if (fileObjects.length !== 1 || streamObjects.length === 0 || extensionObjects.length !== 1) {
    throw new TypeError('ASF header lacks mandatory File, Stream, or Header Extension objects')
  }
  validateHeaderExtension(bytes, extensionObjects[0])
  const file = fileProperties(bytes, fileObjects[0])
  const streams = streamObjects.map((object, index) => streamProperties(bytes, object, index))
  if (new Set(streams.map(stream => stream.streamNumber)).size !== streams.length) {
    throw new TypeError('ASF stream numbers are duplicated')
  }

  const topLevel = []
  offset = headerSize
  while (offset < bytes.byteLength) {
    if (objects.length + topLevel.length >= budget.maxNodes) {
      throw new RangeError('ASF object count exceeds maxNodes budget')
    }
    const object = objectAt(bytes, offset, bytes.byteLength, 'ASF top-level object')
    charge(state, budget)
    topLevel.push(object)
    offset += object.size
  }
  const data = topLevel[0]
  if (data?.guid !== GUIDS.DATA || data.size < 50) {
    throw new TypeError('ASF Data Object is missing after the Header Object')
  }
  if (!equalBytes(bytes, file.fileIdOffset, data.dataOffset, 16)) {
    throw new TypeError('ASF Data Object File ID differs from File Properties')
  }
  const dataPackets = u64le(bytes, data.dataOffset + 16)
  if (
    dataPackets !== file.dataPackets ||
    bytes[data.dataOffset + 24] !== 1 ||
    bytes[data.dataOffset + 25] !== 1
  ) {
    throw new TypeError('ASF Data Object packet count or reserved bytes are invalid')
  }

  return Object.freeze({
    headerSize,
    objects: Object.freeze(objects),
    topLevel: Object.freeze(topLevel),
    file,
    streams: Object.freeze(streams),
    decodedBytes: state.bytes,
  })
}

const displayInteger = value =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'wmv',
    label: 'Windows Media Video / ASF',
    mediaType: 'video/x-ms-wmv',
  }),
  async detect(prefix) {
    return hasAsfHeader(prefix)
      ? { confidence: 0.995, kind: 'magic', note: 'asf-header-guid' }
      : { confidence: 0, kind: 'magic', note: 'asf-header-guid-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = summarize(bytes, context.budget)
    const videoStreams = parsed.streams.filter(stream => stream.kind === 'video')
    const audioStreams = parsed.streams.filter(stream => stream.kind === 'audio')
    const mediaTracks = parsed.streams
      .filter(stream => stream.kind === 'video' || stream.kind === 'audio')
      .map(stream => ({
        id: `stream-${stream.streamNumber}`,
        kind: stream.kind,
        codec: stream.codec,
        ...(stream.width === undefined ? {} : { width: stream.width }),
        ...(stream.height === undefined ? {} : { height: stream.height }),
        selected: stream.index === 0,
      }))
    const video = createVideoMediaSource(bytes, 'video/x-ms-wmv', {
      durationMs: parsed.file.durationMs,
      seekable: parsed.file.seekable,
      tracks: mediaTracks,
      frameAccess: false,
    })
    const allObjects = [...parsed.objects, ...parsed.topLevel]
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'ASF / WMV',
      preview: `${parsed.streams.length} stream(s), ${allObjects.length} object(s)`,
      children: allObjects.map(object => ({
        kind: 'object',
        label: object.name,
        preview: `${object.size} bytes at ${object.offset}`,
      })),
    })
    return {
      summary: {
        format: 'wmv',
        container: 'asf',
        headerSize: parsed.headerSize,
        fileSize: displayInteger(parsed.file.fileSize),
        durationMs: parsed.file.durationMs,
        dataPackets: displayInteger(parsed.file.dataPackets),
        maximumBitrate: parsed.file.maximumBitrate,
        seekable: parsed.file.seekable,
        broadcast: parsed.file.broadcast,
        streams: parsed.streams.map(stream => `${stream.kind}:${stream.codec}`),
        objects: allObjects.length,
      },
      metadata: [
        {
          id: 'asf-file-properties',
          label: 'ASF file properties',
          entries: [
            { key: 'headerSize', value: parsed.headerSize },
            { key: 'fileSize', value: displayInteger(parsed.file.fileSize) },
            { key: 'durationMs', value: parsed.file.durationMs },
            { key: 'dataPackets', value: displayInteger(parsed.file.dataPackets) },
            { key: 'minimumPacketSize', value: parsed.file.minimumPacketSize },
            { key: 'maximumPacketSize', value: parsed.file.maximumPacketSize },
            { key: 'maximumBitrate', value: parsed.file.maximumBitrate },
            { key: 'streams', value: parsed.streams.length },
            { key: 'objects', value: allObjects.length },
          ],
        },
      ],
      traits: [
        ...(videoStreams.length > 0
          ? [
              {
                id: 'video.streams',
                parameters: { count: videoStreams.length, codec: videoStreams[0].codec },
              },
            ]
          : []),
        ...(audioStreams.length > 0
          ? [{ id: 'audio.streams', parameters: { count: audioStreams.length } }]
          : []),
        ...(parsed.file.durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: parsed.file.durationMs } }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      maxDecodedBytes: parsed.decodedBytes,
      unsupportedFeatures: [
        'packet-and-payload-demuxing',
        'elementary-stream-decoding',
        'drm-decryption',
        'index-object-parsing',
        'remuxing-and-transcoding',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
