// Hand-ported from the MK2 codec modkit/ogv (OPUS-MK2-02 task G, wave 1).
//
// The v1 limitation is unusually precise and this port keeps to it word for word: "Detection
// requires an Ogg stream with a Theora or Skeleton marker so generic Ogg audio is not claimed as
// video", and "container inspection recognizes Theora and Vorbis markers and limited dimensions
// rather than parsing the complete Ogg page and stream structure".
//
// The v1 match was a path glob matching every file; MK3 spells that as `match.signatures` — the
// Theora identification header inside the first Ogg page, cited in the extension README.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkit/codec-kit'

const ID = 'modkit/ogv'
const latin1 = new TextDecoder('latin1')

const OGG_HEADER_BYTES = 27

const u24be = (bytes, offset) =>
  ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0)
const u32le = (bytes, offset) =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

/** RFC 3533 §6 page frame. Only the framing is read; no packet is reassembled across pages. */
function readPage(bytes, offset) {
  if (offset + OGG_HEADER_BYTES > bytes.byteLength) return undefined
  if (latin1.decode(bytes.subarray(offset, offset + 4)) !== 'OggS') return undefined
  if ((bytes[offset + 4] ?? 0xff) !== 0) return undefined
  const segments = bytes[offset + 26] ?? 0
  const tableEnd = offset + OGG_HEADER_BYTES + segments
  if (tableEnd > bytes.byteLength) return undefined
  let payloadBytes = 0
  for (let index = 0; index < segments; index += 1) {
    payloadBytes += bytes[tableEnd - segments + index] ?? 0
  }
  return Object.freeze({
    offset,
    serialNumber: u32le(bytes, offset + 14),
    sequence: u32le(bytes, offset + 18),
    segments,
    payload: bytes.subarray(tableEnd, Math.min(tableEnd + payloadBytes, bytes.byteLength)),
    end: tableEnd + payloadBytes,
  })
}

function readPages(bytes, maxPages) {
  const pages = []
  let offset = 0
  while (pages.length < maxPages) {
    const page = readPage(bytes, offset)
    if (page === undefined) break
    pages.push(page)
    if (page.end <= offset) break
    offset = page.end
  }
  return Object.freeze(pages)
}

/** The three markers the v1 codec knows about, each a packet-type byte plus a codec name. */
const markerOf = payload => {
  if (payload.byteLength < 8) return undefined
  const name = latin1.decode(payload.subarray(1, 7))
  if (payload[0] === 0x80 && name === 'theora') return 'theora'
  if (payload[0] === 0x01 && name === 'vorbis') return 'vorbis'
  if (latin1.decode(payload.subarray(0, 8)) === 'fishead\0') return 'skeleton'
  return undefined
}

/**
 * Theora I §6.1 identification header. Only the fields the v1 codec called "limited dimensions"
 * are read: the frame size in macro blocks, the picture size, and the frame rate ratio.
 */
function readTheoraHeader(payload) {
  if (payload.byteLength < 22) return undefined
  return Object.freeze({
    version: `${payload[7] ?? 0}.${payload[8] ?? 0}.${payload[9] ?? 0}`,
    macroBlockWidth: ((payload[10] ?? 0) << 8) | (payload[11] ?? 0),
    macroBlockHeight: ((payload[12] ?? 0) << 8) | (payload[13] ?? 0),
    width: u24be(payload, 14),
    height: u24be(payload, 17),
  })
}

function identify(bytes, maxPages) {
  const pages = readPages(bytes, maxPages)
  if (pages.length === 0) return undefined
  const markers = new Map()
  for (const page of pages) {
    const marker = markerOf(page.payload)
    if (marker !== undefined && !markers.has(marker)) markers.set(marker, page)
  }
  const theoraPage = markers.get('theora')
  return Object.freeze({
    pages,
    markers: Object.freeze([...markers.keys()].sort()),
    theora: theoraPage === undefined ? undefined : readTheoraHeader(theoraPage.payload),
    hasVorbis: markers.has('vorbis'),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ogv', label: 'Ogg Theora Video', mediaType: 'video/ogg' }),
  async detect(prefix) {
    const found = identify(prefix, 64)
    if (found === undefined) return { confidence: 0, kind: 'magic', note: 'ogg-page-mismatch' }
    if (found.theora === undefined) {
      // Exactly the v1 rule: an Ogg stream without a Theora marker is not this codec's video.
      const skeleton = found.markers.includes('skeleton')
      return {
        confidence: skeleton ? 0.3 : 0,
        kind: 'structure',
        note: `ogg-without-theora:${found.markers.join('+') || 'unknown'}`,
      }
    }
    const sane = found.theora.width > 0 && found.theora.height > 0
    return {
      confidence: sane ? 0.97 : 0.4,
      kind: 'structure',
      note: sane
        ? `ogg-theora-${found.theora.width}x${found.theora.height}`
        : 'ogg-theora-implausible',
    }
  },
  async inspect(bytes, context) {
    const found = identify(bytes, Math.min(context.budget.maxNodes, 4096))
    if (found?.theora === undefined) throw new TypeError('Ogg stream carries no Theora header')
    const theora = found.theora
    const streams = new Set(found.pages.map(page => page.serialNumber))
    const video = createVideoMediaSource(
      bytes,
      'video/ogg',
      {
        durationMs: 'unknown', // the granule position of the last page is past the bounded walk
        seekable: false,
        tracks: [
          {
            id: 'theora-0',
            kind: 'video',
            codec: 'theora',
            width: theora.width,
            height: theora.height,
            selected: true,
          },
          ...(found.hasVorbis
            ? [{ id: 'vorbis-0', kind: 'audio', codec: 'vorbis', selected: false }]
            : []),
        ],
        frameAccess: false,
      },
      context.videoFrames,
    )
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'Ogg Theora',
      preview: `${theora.width} × ${theora.height}, markers: ${found.markers.join(', ')}`,
      children: [
        { kind: 'header', label: 'theora version', preview: theora.version },
        {
          kind: 'header',
          label: 'macro blocks',
          preview: `${theora.macroBlockWidth} × ${theora.macroBlockHeight}`,
        },
        ...found.pages.map(page => ({
          kind: 'page',
          label: `page ${page.sequence}`,
          preview: `serial ${page.serialNumber}, ${page.payload.byteLength} payload bytes`,
        })),
      ],
    })
    return {
      summary: {
        format: 'ogv',
        codec: 'theora',
        theoraVersion: theora.version,
        width: theora.width,
        height: theora.height,
        markers: found.markers,
        pages: found.pages.length,
        streams: streams.size,
      },
      metadata: [
        {
          id: 'ogg-theora',
          label: 'Theora identification header',
          entries: [
            { key: 'theoraVersion', value: theora.version },
            { key: 'width', value: theora.width },
            { key: 'height', value: theora.height },
            { key: 'macroBlockWidth', value: theora.macroBlockWidth },
            { key: 'macroBlockHeight', value: theora.macroBlockHeight },
            { key: 'markers', value: found.markers.join('+') },
            { key: 'pagesInspected', value: found.pages.length },
            { key: 'logicalStreams', value: streams.size },
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: { count: 1, codec: 'theora', width: theora.width, height: theora.height },
        },
        ...(found.hasVorbis
          ? [{ id: 'audio.streams', parameters: { count: 1, codec: 'vorbis' } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: ['theora-decoding', 'frame-rate-parsing', 'remuxing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)

// Programmatic sequence export; native document editing remains a separate capability.
export { encodeOgv } from '../../dist/ogv/encode.js'
