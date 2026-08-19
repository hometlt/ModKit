// Hand-ported from the MK2 codec org.modkitx/webm (OPUS-MK2-02 task G, wave 1).
//
// The v1 limitation calls the inspection "intentionally shallow … recognizable track codec
// markers rather than the complete Matroska element graph", and this port keeps that shape: the
// EBML header (RFC 8794 §4) with its DocType, then the Segment's Info and Tracks elements. No
// cluster is opened and no frame is touched.
//
// The v1 match was a path glob matching every file; MK3 spells that as `match.signatures` — the
// EBML header element id, cited in the extension README.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/webm'
const utf8 = new TextDecoder('utf-8', { fatal: false })

/** The element ids this port names, written as the hex of their full id including the marker. */
const ELEMENTS = Object.freeze({
  '1a45dfa3': 'EBML',
  4282: 'DocType',
  4287: 'DocTypeVersion',
  18538067: 'Segment',
  '1549a966': 'Info',
  '2ad7b1': 'TimestampScale',
  '4d80': 'MuxingApp',
  5741: 'WritingApp',
  4489: 'Duration',
  '1654ae6b': 'Tracks',
  ae: 'TrackEntry',
  83: 'TrackType',
  86: 'CodecID',
  b0: 'PixelWidth',
  ba: 'PixelHeight',
  '1f43b675': 'Cluster',
})
/** Master elements whose payload is another element list; everything else is a leaf here. */
const MASTERS = Object.freeze(new Set(['EBML', 'Segment', 'Info', 'Tracks', 'TrackEntry']))
/** Matroska TrackType values (§Track element). */
const TRACK_TYPES = Object.freeze({ 1: 'video', 2: 'audio', 3: 'complex', 17: 'subtitle' })

const hasEbmlHeader = bytes =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x1a &&
  bytes[1] === 0x45 &&
  bytes[2] === 0xdf &&
  bytes[3] === 0xa3

/** RFC 8794 §4.3: the leading zeros of the first octet give the id its length. */
function readId(bytes, offset) {
  const first = bytes[offset] ?? 0
  if (first === 0) return undefined
  let length = 1
  for (let mask = 0x80; (first & mask) === 0; mask >>>= 1) length += 1
  if (length > 4 || offset + length > bytes.byteLength) return undefined
  let hex = ''
  for (let index = 0; index < length; index += 1) {
    hex += (bytes[offset + index] ?? 0).toString(16).padStart(2, '0')
  }
  return { hex, length }
}

/** RFC 8794 §4.4: same width encoding, but the marker bit is stripped from the value. */
function readSize(bytes, offset) {
  const first = bytes[offset] ?? 0
  if (first === 0) return undefined
  let length = 1
  let mask = 0x80
  for (; (first & mask) === 0; mask >>>= 1) length += 1
  if (length > 8 || offset + length > bytes.byteLength) return undefined
  let value = first & (mask - 1)
  let unknown = value === mask - 1
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index] ?? 0
    if (byte !== 0xff) unknown = false
    value = value * 256 + byte
  }
  if (!Number.isSafeInteger(value)) return undefined
  return { value, length, unknown }
}

const uintOf = (bytes, at, size) => {
  let value = 0
  for (let index = 0; index < size; index += 1) value = value * 256 + (bytes[at + index] ?? 0)
  return value
}

function readElements(bytes, start, end, depth, budget, out) {
  let offset = start
  while (offset < end) {
    if (out.length >= budget.maxNodes) throw new RangeError('EBML element count exceeds maxNodes')
    const id = readId(bytes, offset)
    if (id === undefined) break
    const size = readSize(bytes, offset + id.length)
    if (size === undefined) break
    const payload = offset + id.length + size.length
    // An unknown size means "until the next element of the parent"; a shallow reader stops there
    // rather than guessing where the master element ends.
    const bodyBytes = size.unknown ? end - payload : size.value
    if (payload + bodyBytes > end) break
    const name = ELEMENTS[id.hex] ?? `0x${id.hex}`
    out.push(Object.freeze({ name, id: id.hex, depth, offset, payload, bytes: bodyBytes }))
    if (MASTERS.has(name) && depth < budget.maxDepth) {
      readElements(bytes, payload, payload + bodyBytes, depth + 1, budget, out)
    }
    offset = payload + bodyBytes
  }
  return out
}

function summarize(bytes, budget) {
  if (!hasEbmlHeader(bytes)) throw new TypeError('EBML header element is missing')
  const elements = readElements(bytes, 0, bytes.byteLength, 0, budget, [])
  const textOf = name => {
    const element = elements.find(item => item.name === name)
    return element === undefined
      ? undefined
      : utf8
          .decode(bytes.subarray(element.payload, element.payload + element.bytes))
          .replace(/\0+$/u, '')
  }
  const numberOf = name => {
    const element = elements.find(item => item.name === name)
    return element === undefined ? undefined : uintOf(bytes, element.payload, element.bytes)
  }
  const tracks = []
  for (const entry of elements.filter(element => element.name === 'TrackEntry')) {
    const within = elements.filter(
      element => element.offset > entry.offset && element.offset < entry.payload + entry.bytes,
    )
    const child = name => within.find(element => element.name === name)
    const typeElement = child('TrackType')
    const codecElement = child('CodecID')
    const widthElement = child('PixelWidth')
    const heightElement = child('PixelHeight')
    const type =
      typeElement === undefined ? 0 : uintOf(bytes, typeElement.payload, typeElement.bytes)
    tracks.push(
      Object.freeze({
        kind: TRACK_TYPES[type] ?? `track-type-${type}`,
        codec:
          codecElement === undefined
            ? 'unknown'
            : utf8.decode(
                bytes.subarray(codecElement.payload, codecElement.payload + codecElement.bytes),
              ),
        ...(widthElement === undefined
          ? {}
          : { width: uintOf(bytes, widthElement.payload, widthElement.bytes) }),
        ...(heightElement === undefined
          ? {}
          : { height: uintOf(bytes, heightElement.payload, heightElement.bytes) }),
      }),
    )
  }
  return Object.freeze({
    elements: Object.freeze(elements),
    docType: textOf('DocType'),
    docTypeVersion: numberOf('DocTypeVersion'),
    timestampScale: numberOf('TimestampScale'),
    muxingApp: textOf('MuxingApp'),
    tracks: Object.freeze(tracks),
  })
}

const PROBE_BUDGET = Object.freeze({ maxNodes: 512, maxDepth: 6 })

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'webm', label: 'WebM / Matroska', mediaType: 'video/webm' }),
  async detect(prefix) {
    if (!hasEbmlHeader(prefix)) return { confidence: 0, kind: 'magic', note: 'ebml-id-mismatch' }
    try {
      const parsed = summarize(prefix, PROBE_BUDGET)
      // The EBML id is shared by every Matroska family member; the DocType is what separates
      // WebM from a generic .mkv, and the v1 codec claimed both.
      const docType = parsed.docType ?? 'unknown'
      const known = docType === 'webm' || docType === 'matroska'
      return {
        confidence: known ? 0.98 : 0.5,
        kind: 'structure',
        note: `ebml-doctype-${docType}`,
      }
    } catch {
      return { confidence: 0.6, kind: 'magic', note: 'ebml-header-only' }
    }
  },
  async inspect(bytes, context) {
    const parsed = summarize(bytes, context.budget)
    const videoTrack = parsed.tracks.find(track => track.kind === 'video')
    const video = createVideoMediaSource(bytes, 'video/webm', {
      durationMs: 'unknown', // Duration lives in Info as a float; this port reads unsigned ints only
      seekable: false, // seeking needs Cues, and this port never opens a Cluster
      tracks:
        parsed.tracks.length > 0
          ? parsed.tracks.map((track, index) => ({
              id: `track-${index}`,
              kind: track.kind === 'audio' ? 'audio' : 'video',
              codec: track.codec,
              ...(track.width === undefined ? {} : { width: track.width }),
              ...(track.height === undefined ? {} : { height: track.height }),
              selected: index === 0,
            }))
          : [{ id: 'track-0', kind: 'video', codec: 'unknown', selected: true }],
      frameAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'WebM',
      preview: `DocType ${parsed.docType ?? 'unknown'}, ${parsed.elements.length} element(s)`,
      children: parsed.elements.map(element => ({
        kind: 'element',
        label: `${'  '.repeat(element.depth)}${element.name}`,
        preview: `${element.bytes} bytes at ${element.offset}`,
      })),
    })
    return {
      summary: {
        format: 'webm',
        docType: parsed.docType ?? null,
        docTypeVersion: parsed.docTypeVersion ?? null,
        timestampScale: parsed.timestampScale ?? null,
        muxingApp: parsed.muxingApp ?? null,
        elements: parsed.elements.length,
        tracks: parsed.tracks.map(track => `${track.kind}:${track.codec}`),
      },
      metadata: [
        {
          id: 'ebml-header',
          label: 'EBML header',
          entries: [
            { key: 'docType', value: parsed.docType ?? 'unknown' },
            { key: 'docTypeVersion', value: parsed.docTypeVersion ?? 0 },
            { key: 'timestampScale', value: parsed.timestampScale ?? 0 },
            { key: 'muxingApp', value: parsed.muxingApp ?? 'unknown' },
            { key: 'elements', value: parsed.elements.length },
            { key: 'tracks', value: parsed.tracks.length },
            ...(videoTrack === undefined ? [] : [{ key: 'videoCodec', value: videoTrack.codec }]),
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: {
            count: parsed.tracks.filter(track => track.kind === 'video').length,
            codec: videoTrack?.codec ?? 'unknown',
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: ['cluster-parsing', 'cue-index', 'elementary-stream-decoding'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
