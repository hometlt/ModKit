// Hand-ported from modkit/avi. The reader validates the classic Microsoft RIFF AVI form,
// its mandatory header/data lists, stream headers, and video/audio format structures.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkit/codec-kit'

const ID = 'modkit/avi'
const latin1 = new TextDecoder('latin1')

const fourCc = (bytes, offset) => latin1.decode(bytes.subarray(offset, offset + 4))
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
const u16le = (bytes, offset) => viewOf(bytes).getUint16(offset, true)
const u32le = (bytes, offset) => viewOf(bytes).getUint32(offset, true)
const i32le = (bytes, offset) => viewOf(bytes).getInt32(offset, true)

const hasAviHeader = bytes =>
  bytes.byteLength >= 12 && fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'AVI '

function charge(state, budget, bytes = 64) {
  state.bytes += bytes
  if (state.bytes > budget.maxScalarBytes) {
    throw new RangeError('AVI decoded metadata exceeds maxScalarBytes budget')
  }
}

function readChunks(bytes, start, end, depth, parentOffset, budget, state, output) {
  if (depth > budget.maxDepth) throw new RangeError('AVI RIFF nesting exceeds maxDepth budget')
  let offset = start
  while (offset < end) {
    if (output.length >= budget.maxNodes)
      throw new RangeError('AVI chunk count exceeds maxNodes budget')
    if (offset + 8 > end) throw new TypeError('AVI RIFF chunk header is truncated')
    const id = fourCc(bytes, offset)
    const size = u32le(bytes, offset + 4)
    const dataOffset = offset + 8
    const dataEnd = dataOffset + size
    const paddedEnd = dataEnd + (size & 1)
    if (!Number.isSafeInteger(dataEnd) || dataEnd > end || paddedEnd > end) {
      throw new RangeError(`AVI ${id} chunk exceeds its RIFF container`)
    }
    charge(state, budget)
    if (id === 'LIST') {
      if (size < 4) throw new TypeError('AVI LIST chunk has no list type')
      const type = fourCc(bytes, dataOffset)
      const record = Object.freeze({ id, type, size, offset, dataOffset, depth, parentOffset })
      output.push(record)
      readChunks(bytes, dataOffset + 4, dataEnd, depth + 1, offset, budget, state, output)
    } else {
      output.push(Object.freeze({ id, size, offset, dataOffset, depth, parentOffset }))
    }
    offset = paddedEnd
  }
  if (offset !== end) throw new TypeError('AVI RIFF chunk padding is malformed')
  return output
}

function mainHeader(bytes, chunk) {
  if (chunk.size < 56) throw new TypeError('AVI avih chunk is shorter than AVIMAINHEADER')
  const at = chunk.dataOffset
  const microsecondsPerFrame = u32le(bytes, at)
  const totalFrames = u32le(bytes, at + 16)
  const streams = u32le(bytes, at + 24)
  const width = u32le(bytes, at + 32)
  const height = u32le(bytes, at + 36)
  if (microsecondsPerFrame === 0 || streams === 0 || width === 0 || height === 0) {
    throw new TypeError('AVI main header has invalid timing, stream count, or dimensions')
  }
  const duration = (BigInt(microsecondsPerFrame) * BigInt(totalFrames) + 500n) / 1000n
  return Object.freeze({
    microsecondsPerFrame,
    totalFrames,
    streams,
    width,
    height,
    fps: 1_000_000 / microsecondsPerFrame,
    durationMs: duration <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(duration) : 'unknown',
  })
}

function compressionName(bytes, offset) {
  const numeric = u32le(bytes, offset)
  if (numeric === 0) return 'BI_RGB'
  if (numeric === 3) return 'BI_BITFIELDS'
  const text = fourCc(bytes, offset)
  return /^[\x20-\x7e]{4}$/u.test(text) ? text.trim() : `0x${numeric.toString(16)}`
}

function streamHeader(bytes, list, chunks, index) {
  const direct = chunks.filter(chunk => chunk.parentOffset === list.offset)
  const header = direct.find(chunk => chunk.id === 'strh')
  const format = direct.find(chunk => chunk.id === 'strf')
  if (header === undefined || format === undefined || header.offset > format.offset) {
    throw new TypeError(`AVI stream ${index} must contain strh followed by strf`)
  }
  if (header.size < 56) throw new TypeError(`AVI stream ${index} strh is truncated`)
  const at = header.dataOffset
  const type = fourCc(bytes, at)
  const handler = fourCc(bytes, at + 4).trim()
  const scale = u32le(bytes, at + 20)
  const rate = u32le(bytes, at + 24)
  const length = u32le(bytes, at + 32)
  const durationValue =
    scale > 0 && rate > 0
      ? (BigInt(length) * BigInt(scale) * 1000n + BigInt(Math.floor(rate / 2))) / BigInt(rate)
      : undefined
  const durationMs =
    durationValue !== undefined && durationValue <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(durationValue)
      : undefined

  if (type === 'vids') {
    if (format.size < 40) throw new TypeError(`AVI video stream ${index} strf is truncated`)
    const bitmap = format.dataOffset
    const bitmapSize = u32le(bytes, bitmap)
    const width = i32le(bytes, bitmap + 4)
    const height = i32le(bytes, bitmap + 8)
    const planes = u16le(bytes, bitmap + 12)
    const bitsPerPixel = u16le(bytes, bitmap + 14)
    if (
      bitmapSize < 40 ||
      bitmapSize > format.size ||
      width <= 0 ||
      height === 0 ||
      planes !== 1 ||
      bitsPerPixel === 0
    ) {
      throw new TypeError(`AVI video stream ${index} BITMAPINFOHEADER is invalid`)
    }
    const compression = compressionName(bytes, bitmap + 16)
    return Object.freeze({
      index,
      kind: 'video',
      type,
      codec: compression === 'BI_RGB' && handler !== '' ? handler : compression,
      width,
      height: Math.abs(height),
      bitsPerPixel,
      scale,
      rate,
      length,
      durationMs,
    })
  }

  if (type === 'auds') {
    if (format.size < 16) throw new TypeError(`AVI audio stream ${index} strf is truncated`)
    const wave = format.dataOffset
    const formatTag = u16le(bytes, wave)
    const channels = u16le(bytes, wave + 2)
    const sampleRate = u32le(bytes, wave + 4)
    const averageBytesPerSecond = u32le(bytes, wave + 8)
    const blockAlign = u16le(bytes, wave + 12)
    const bitsPerSample = u16le(bytes, wave + 14)
    if (formatTag === 0 || channels === 0 || sampleRate === 0 || blockAlign === 0) {
      throw new TypeError(`AVI audio stream ${index} WAVEFORMATEX is invalid`)
    }
    return Object.freeze({
      index,
      kind: 'audio',
      type,
      codec: `wave-format-${formatTag}`,
      channels,
      sampleRate,
      averageBytesPerSecond,
      bitsPerSample,
      scale,
      rate,
      length,
      durationMs,
    })
  }

  return Object.freeze({
    index,
    kind: 'other',
    type,
    codec: handler || 'unknown',
    scale,
    rate,
    length,
    durationMs,
  })
}

function summarize(bytes, budget) {
  if (!hasAviHeader(bytes)) throw new TypeError('AVI RIFF header or form type is missing')
  const riffSize = u32le(bytes, 4)
  if (riffSize < 4 || riffSize + 8 !== bytes.byteLength) {
    throw new TypeError('AVI RIFF declared size does not match the source')
  }
  const state = { bytes: 0 }
  const chunks = readChunks(bytes, 12, bytes.byteLength, 0, undefined, budget, state, [])
  const topLevelLists = chunks.filter(
    chunk => chunk.id === 'LIST' && chunk.parentOffset === undefined,
  )
  const headerList = topLevelLists.find(chunk => chunk.type === 'hdrl')
  const movieList = topLevelLists.find(chunk => chunk.type === 'movi')
  if (headerList === undefined || movieList === undefined || headerList.offset > movieList.offset) {
    throw new TypeError('AVI requires hdrl followed by movi LIST chunks')
  }
  const aviHeader = chunks.find(
    chunk => chunk.id === 'avih' && chunk.parentOffset === headerList.offset,
  )
  if (aviHeader === undefined) throw new TypeError('AVI hdrl list has no avih chunk')
  const main = mainHeader(bytes, aviHeader)
  const streamLists = chunks.filter(
    chunk =>
      chunk.id === 'LIST' && chunk.type === 'strl' && chunk.parentOffset === headerList.offset,
  )
  if (streamLists.length !== main.streams) {
    throw new TypeError('AVI stream-list count differs from AVIMAINHEADER')
  }
  const streams = streamLists.map((list, index) => streamHeader(bytes, list, chunks, index))
  const oldIndex = chunks.find(chunk => chunk.id === 'idx1' && chunk.parentOffset === undefined)
  if (oldIndex !== undefined && oldIndex.size % 16 !== 0) {
    throw new TypeError('AVI idx1 chunk is not a sequence of index entries')
  }
  const mediaChunks = chunks.filter(
    chunk => chunk.parentOffset === movieList.offset && /^\d\d(?:db|dc|wb|pc)$/u.test(chunk.id),
  )
  return Object.freeze({
    chunks: Object.freeze(chunks),
    main,
    streams: Object.freeze(streams),
    mediaChunks: mediaChunks.length,
    indexEntries: oldIndex === undefined ? 0 : oldIndex.size / 16,
    decodedBytes: state.bytes,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'avi',
    label: 'Audio Video Interleave',
    mediaType: 'video/x-msvideo',
  }),
  async detect(prefix) {
    return hasAviHeader(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'riff-avi-form' }
      : { confidence: 0, kind: 'magic', note: 'riff-avi-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = summarize(bytes, context.budget)
    const videoStreams = parsed.streams.filter(stream => stream.kind === 'video')
    const audioStreams = parsed.streams.filter(stream => stream.kind === 'audio')
    const mediaTracks = parsed.streams
      .filter(stream => stream.kind === 'video' || stream.kind === 'audio')
      .map(stream => ({
        id: `track-${stream.index}`,
        kind: stream.kind,
        codec: stream.codec,
        ...(stream.width === undefined ? {} : { width: stream.width }),
        ...(stream.height === undefined ? {} : { height: stream.height }),
        selected: stream.index === 0,
      }))
    const video = createVideoMediaSource(bytes, 'video/x-msvideo', {
      durationMs: parsed.main.durationMs,
      seekable: parsed.indexEntries > 0,
      tracks: mediaTracks,
      frameAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'AVI',
      preview: `${parsed.streams.length} stream(s), ${parsed.chunks.length} chunk(s)`,
      children: parsed.chunks.map(chunk => ({
        kind: chunk.id === 'LIST' ? 'list' : 'chunk',
        label: `${'  '.repeat(chunk.depth)}${chunk.id === 'LIST' ? `LIST ${chunk.type}` : chunk.id}`,
        preview: `${chunk.size} bytes at ${chunk.offset}`,
      })),
    })
    return {
      summary: {
        format: 'avi',
        width: parsed.main.width,
        height: parsed.main.height,
        fps: parsed.main.fps,
        durationMs: parsed.main.durationMs,
        totalFrames: parsed.main.totalFrames,
        streams: parsed.streams.map(stream => `${stream.kind}:${stream.codec}`),
        chunks: parsed.chunks.length,
        mediaChunks: parsed.mediaChunks,
        indexEntries: parsed.indexEntries,
      },
      metadata: [
        {
          id: 'avi-main-header',
          label: 'AVI main header',
          entries: [
            { key: 'width', value: parsed.main.width },
            { key: 'height', value: parsed.main.height },
            { key: 'fps', value: parsed.main.fps },
            { key: 'durationMs', value: parsed.main.durationMs },
            { key: 'totalFrames', value: parsed.main.totalFrames },
            { key: 'streams', value: parsed.streams.length },
            { key: 'chunks', value: parsed.chunks.length },
            { key: 'indexEntries', value: parsed.indexEntries },
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
        ...(parsed.main.durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: parsed.main.durationMs } }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      maxDecodedBytes: parsed.decodedBytes,
      unsupportedFeatures: [
        'opendml-multiple-riff-segments',
        'frame-and-sample-decoding',
        'palette-change-decoding',
        'remuxing-and-transcoding',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
