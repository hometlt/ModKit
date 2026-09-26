import {
  createInspectionCodec,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  createVideoMediaSource,
  TRANSPORT_OPERATIONS,
} from '@modkit/codec-kit'

const latin1 = new TextDecoder('latin1')
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

function text(bytes, offset, length) {
  return latin1.decode(bytes.subarray(offset, offset + length))
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('truncated MP4 u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
}

function u64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new RangeError('truncated MP4 u64')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, false)
}

function boxes(bytes, start, end, budget, depth = 0, state = { count: 0 }) {
  if (depth > budget.maxDepth) throw new RangeError('MP4 box depth exceeds maxDepth budget')
  const result = []
  let offset = start
  while (offset < end) {
    if (state.count >= budget.maxNodes) throw new RangeError('MP4 box count exceeds budget')
    state.count += 1
    if (offset + 8 > end) throw new TypeError('MP4 box header is truncated')
    const size32 = u32(bytes, offset)
    const type = text(bytes, offset + 4, 4)
    let header = 8
    let size = BigInt(size32)
    if (size32 === 1) {
      header = 16
      size = u64(bytes, offset + 8)
    } else if (size32 === 0) size = BigInt(end - offset)
    if (size < BigInt(header) || size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError('MP4 box size is invalid')
    }
    const boxEnd = offset + Number(size)
    if (boxEnd > end) throw new TypeError('MP4 box exceeds its parent')
    const box = {
      type,
      offset,
      size: Number(size),
      dataStart: offset + header,
      end: boxEnd,
      children: [],
    }
    if (CONTAINERS.has(type)) {
      box.children = boxes(bytes, box.dataStart, box.end, budget, depth + 1, state)
    }
    result.push(Object.freeze(box))
    offset = boxEnd
  }
  return Object.freeze(result)
}

function flatten(values) {
  return values.flatMap(value => [value, ...flatten(value.children)])
}

function child(box, type) {
  return box?.children?.find(value => value.type === type)
}

function movieDuration(bytes, moov) {
  const mvhd = child(moov, 'mvhd')
  if (mvhd === undefined || mvhd.dataStart + 20 > mvhd.end) return 'unknown'
  const version = bytes[mvhd.dataStart]
  const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12)
  const durationOffset = timescaleOffset + 4
  const timescale = u32(bytes, timescaleOffset)
  const duration = version === 1 ? u64(bytes, durationOffset) : BigInt(u32(bytes, durationOffset))
  if (timescale === 0) return 'unknown'
  const milliseconds = (duration * 1000n) / BigInt(timescale)
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('MP4 duration exceeds the safe runtime range')
  }
  return Number(milliseconds)
}

function sampleCodec(bytes, trak) {
  const stsd = child(child(child(child(trak, 'mdia') ?? {}, 'minf') ?? {}, 'stbl') ?? {}, 'stsd')
  return stsd !== undefined && stsd.dataStart + 16 <= stsd.end
    ? text(bytes, stsd.dataStart + 12, 4)
    : 'unknown'
}

function track(bytes, trak, index) {
  const mdia = child(trak, 'mdia')
  const hdlr = mdia === undefined ? undefined : child(mdia, 'hdlr')
  const handler =
    hdlr !== undefined && hdlr.dataStart + 12 <= hdlr.end
      ? text(bytes, hdlr.dataStart + 8, 4)
      : 'data'
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'data'
  const tkhd = child(trak, 'tkhd')
  const trackHeaderVersion = tkhd === undefined ? 0 : bytes[tkhd.dataStart]
  const dimensionsOffset = trackHeaderVersion === 1 ? 88 : 76
  const width =
    tkhd !== undefined && tkhd.dataStart + dimensionsOffset + 8 <= tkhd.end
      ? u32(bytes, tkhd.dataStart + dimensionsOffset) / 65536
      : undefined
  const height =
    tkhd !== undefined && tkhd.dataStart + dimensionsOffset + 8 <= tkhd.end
      ? u32(bytes, tkhd.dataStart + dimensionsOffset + 4) / 65536
      : undefined
  return Object.freeze({
    id: `track-${index}`,
    kind,
    codec: sampleCodec(bytes, trak),
    selected: false,
    ...(width === undefined || width === 0 ? {} : { width }),
    ...(height === undefined || height === 0 ? {} : { height }),
  })
}

function parseMp4(bytes, budget) {
  const roots = boxes(bytes, 0, bytes.byteLength, budget)
  const ftyp = roots.find(box => box.type === 'ftyp')
  const moov = roots.find(box => box.type === 'moov')
  if (ftyp === undefined || moov === undefined)
    throw new TypeError('MP4 ftyp/moov boxes are required')
  const majorBrand = text(bytes, ftyp.dataStart, Math.min(4, ftyp.end - ftyp.dataStart))
  const parsedTracks = moov.children
    .filter(box => box.type === 'trak')
    .map((box, index) => track(bytes, box, index))
  let selectedVideo = false
  const tracks = parsedTracks.map(value => {
    const selected = value.kind === 'video' && !selectedVideo
    if (selected) selectedVideo = true
    return Object.freeze({ ...value, selected })
  })
  if (!tracks.some(value => value.kind === 'video')) throw new TypeError('MP4 has no video track')
  return Object.freeze({
    roots,
    all: Object.freeze(flatten(roots)),
    majorBrand,
    durationMs: movieDuration(bytes, moov),
    tracks: Object.freeze(tracks),
  })
}

const definition = Object.freeze({
  id: 'modkit/video-mp4',
  format: Object.freeze({ id: 'mp4', label: 'MPEG-4 media', mediaType: 'video/mp4' }),
  operations: TRANSPORT_OPERATIONS,
  async detect(bytes) {
    const match = bytes.byteLength >= 12 && text(bytes, 4, 4) === 'ftyp'
    return { confidence: match ? 0.995 : 0.01, note: match ? 'iso-bmff-ftyp' : 'ftyp-missing' }
  },
  async inspect(bytes, context) {
    const mp4 = parseMp4(bytes, context.budget)
    const source = createVideoMediaSource(
      bytes,
      'video/mp4',
      {
        durationMs: mp4.durationMs,
        seekable: true,
        frameAccess: false,
        tracks: mp4.tracks,
      },
      context.videoFrames,
    )
    const transport = createTransportSource({
      state: 'idle',
      positionMs: 0,
      durationMs: mp4.durationMs,
      rate: 1,
      seekable: true,
      live: false,
      tracks: mp4.tracks.map(track => ({
        id: track.id,
        kind: track.kind,
        label: `${track.codec} ${track.kind}`,
        selected: track.selected,
      })),
      controls: {
        playPause: 'media.play-pause',
        seek: 'media.seek',
        setRate: 'media.set-rate',
        selectTrack: 'media.select-track',
      },
    })
    const tree = createTreeDataSource({
      kind: 'container',
      label: 'MP4',
      preview: `${mp4.all.length} boxes, ${mp4.tracks.length} tracks`,
      children: mp4.roots.map(box => ({
        kind: 'box',
        label: box.type,
        preview: `${box.size} bytes`,
        children: box.children.map(childBox => ({
          kind: 'box',
          label: childBox.type,
          preview: `${childBox.size} bytes`,
        })),
      })),
    })
    return {
      summary: {
        format: 'mp4',
        majorBrand: mp4.majorBrand,
        boxes: mp4.all.length,
        tracks: mp4.tracks,
        durationMs: mp4.durationMs,
      },
      metadata: [
        {
          id: 'mp4-container',
          label: 'MP4 container',
          entries: [
            { key: 'majorBrand', value: mp4.majorBrand },
            { key: 'boxes', value: mp4.all.length },
            { key: 'tracks', value: mp4.tracks.length },
            { key: 'durationMs', value: mp4.durationMs },
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: { count: mp4.tracks.filter(track => track.kind === 'video').length },
        },
        { id: 'video.tracks', parameters: { tracks: mp4.tracks.length } },
        ...(mp4.durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: mp4.durationMs } }]),
        { id: 'media.seekable', parameters: { value: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/video-media-source': source,
        'common.view/transport-source': transport,
        'common.view/tree-data-source': tree,
      },
      handlers: createTransportHandlers(transport),
      unsupportedFeatures: ['frame-decoder-provider'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
