import {
  createInspectionCodec,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  createVideoMediaSource,
  TRANSPORT_OPERATIONS,
} from '@modkit/codec-kit'

const latin1 = new TextDecoder('latin1')
const SIGNATURE = Object.freeze([0x1a, 0x45, 0xdf, 0xa3])

function contains(bytes, value) {
  return latin1.decode(bytes).includes(value)
}

function isEbml(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

function parseWebm(bytes) {
  if (!isEbml(bytes)) throw new TypeError('WebM EBML signature is invalid')
  const docType = contains(bytes, 'webm')
    ? 'webm'
    : contains(bytes, 'matroska')
      ? 'matroska'
      : undefined
  if (docType === undefined) throw new TypeError('EBML document is not WebM/Matroska')
  const codecs = [
    ['V_VP8', 'vp8', 'video'],
    ['V_VP9', 'vp9', 'video'],
    ['V_AV1', 'av1', 'video'],
    ['A_OPUS', 'opus', 'audio'],
    ['A_VORBIS', 'vorbis', 'audio'],
  ]
    .filter(([marker]) => contains(bytes, marker))
    .map(([, codec, kind], index) => ({
      id: `track-${index}`,
      kind,
      codec,
      selected: kind === 'video' && index === 0,
    }))
  if (!codecs.some(track => track.kind === 'video'))
    throw new TypeError('WebM has no supported video track')
  return Object.freeze({ docType, tracks: Object.freeze(codecs.map(Object.freeze)) })
}

const definition = Object.freeze({
  id: 'modkit/video-webm',
  format: Object.freeze({ id: 'webm', label: 'WebM video', mediaType: 'video/webm' }),
  operations: TRANSPORT_OPERATIONS,
  async detect(bytes) {
    const match = isEbml(bytes) && (contains(bytes, 'webm') || contains(bytes, 'matroska'))
    return {
      confidence: match ? 0.97 : 0.01,
      note: match ? 'webm-ebml-header' : 'webm-header-missing',
    }
  },
  async inspect(bytes) {
    const webm = parseWebm(bytes)
    const source = createVideoMediaSource(bytes, 'video/webm', {
      durationMs: 'unknown',
      seekable: true,
      frameAccess: false,
      tracks: webm.tracks,
    })
    const transport = createTransportSource({
      state: 'idle',
      positionMs: 0,
      durationMs: 'unknown',
      rate: 1,
      seekable: true,
      live: false,
      tracks: webm.tracks.map(track => ({
        id: track.id,
        kind: track.kind,
        label: track.codec,
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
      label: 'WebM',
      preview: `${webm.tracks.length} recognized track(s)`,
      children: webm.tracks.map(track => ({
        kind: 'track',
        label: `${track.kind}: ${track.codec}`,
      })),
    })
    return {
      summary: { format: 'webm', docType: webm.docType, tracks: webm.tracks },
      metadata: [
        {
          id: 'webm-container',
          label: 'WebM container',
          entries: [
            { key: 'docType', value: webm.docType },
            { key: 'tracks', value: webm.tracks.length },
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: { count: webm.tracks.filter(track => track.kind === 'video').length },
        },
        { id: 'video.tracks', parameters: { tracks: webm.tracks.length } },
        { id: 'media.seekable', parameters: { value: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/video-media-source': source,
        'common.view/transport-source': transport,
        'common.view/tree-data-source': tree,
      },
      handlers: createTransportHandlers(transport),
      unsupportedFeatures: ['duration-index', 'frame-decoder-provider'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
