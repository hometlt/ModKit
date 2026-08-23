// Hand-ported from the MK2 codec org.modkitx/opus (OPUS-MK2-02 task G, wave 1).
//
// Sibling of the Vorbis port: the same v1 prefilter (a path glob matching every file) and the
// same v1 note that the Vorbis-versus-Opus decision belongs to the structural detector. In MK3
// the prefilter is `match.signatures` — "OpusHead" inside the first Ogg page, cited in the
// extension README — and this module reads the identification header the signature points at.
//
// The Ogg page reader below is deliberately its own copy rather than shared with the Vorbis
// port: each converted codec module is the whole of what its runtime variant loads.
//
// Fidelity is the v1 limitation: metadata inspection and byte export, no PCM decoding.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/opus'
const latin1 = new TextDecoder('latin1')

const OGG_HEADER_BYTES = 27
/** RFC 7845 §5.1 fixes the identification header at 19 bytes before the optional channel map. */
const OPUS_HEAD_BYTES = 19

const u16le = (bytes, offset) => ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0
const u32le = (bytes, offset) =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

/** RFC 3533 §6 page frame; see the Vorbis port for the same walk over the same structure. */
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

const isOpusHead = payload =>
  payload.byteLength >= OPUS_HEAD_BYTES && latin1.decode(payload.subarray(0, 8)) === 'OpusHead'

/** RFC 7845 §5.1. `outputGain` is a signed Q7.8 value in decibels. */
function readOpusHead(payload) {
  const gain = u16le(payload, 16)
  return Object.freeze({
    version: payload[8] ?? 0,
    channels: payload[9] ?? 0,
    preSkip: u16le(payload, 10),
    inputSampleRate: u32le(payload, 12),
    outputGainDb: ((gain & 0x8000) === 0 ? gain : gain - 0x10000) / 256,
    mappingFamily: payload[18] ?? 0,
  })
}

function identify(bytes, maxPages) {
  const pages = readPages(bytes, maxPages)
  const first = pages[0]
  if (first === undefined) return undefined
  if (!isOpusHead(first.payload)) {
    const marker = latin1.decode(first.payload.subarray(0, 8))
    return Object.freeze({ pages, head: undefined, marker })
  }
  return Object.freeze({ pages, head: readOpusHead(first.payload), marker: 'OpusHead' })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'opus', label: 'Ogg Opus', mediaType: 'audio/ogg' }),
  async detect(prefix) {
    const found = identify(prefix, 64)
    if (found === undefined) return { confidence: 0, kind: 'magic', note: 'ogg-page-mismatch' }
    if (found.head === undefined) {
      return { confidence: 0.2, kind: 'structure', note: `ogg-not-opus:${found.marker.trim()}` }
    }
    // RFC 7845 §5.1: major version 0 is the only one defined, and family 0 is mono/stereo.
    const sane = found.head.version >>> 4 === 0 && found.head.channels > 0
    return {
      confidence: sane ? 0.98 : 0.4,
      kind: 'structure',
      note: sane ? 'ogg-opus-head' : 'ogg-opus-implausible',
    }
  },
  async inspect(bytes, context) {
    const found = identify(bytes, Math.min(context.budget.maxNodes, 4096))
    if (found?.head === undefined) throw new TypeError('Ogg stream carries no OpusHead header')
    const head = found.head
    const streams = new Set(found.pages.map(page => page.serialNumber))
    const audio = createAudioMediaSource(bytes, 'audio/ogg', {
      durationMs: 'unknown', // the granule position of the last page is past the bounded walk
      seekable: false,
      tracks: [
        {
          id: 'opus-0',
          codec: 'opus',
          channels: head.channels,
          // RFC 7845 §5.1: Opus always decodes at 48 kHz; `inputSampleRate` is provenance only.
          sampleRate: 48000,
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'Ogg Opus',
      preview: `${head.channels} channel(s), pre-skip ${head.preSkip}, ${found.pages.length} page(s)`,
      children: found.pages.map(page => ({
        kind: 'page',
        label: `page ${page.sequence}`,
        preview: `serial ${page.serialNumber}, ${page.segments} segment(s), ${page.payload.byteLength} payload bytes`,
      })),
    })
    return {
      summary: {
        format: 'opus',
        codec: 'opus',
        version: head.version,
        channels: head.channels,
        preSkip: head.preSkip,
        inputSampleRate: head.inputSampleRate,
        outputGainDb: head.outputGainDb,
        mappingFamily: head.mappingFamily,
        pages: found.pages.length,
        streams: streams.size,
      },
      metadata: [
        {
          id: 'ogg-opus',
          label: 'Opus identification header',
          entries: [
            { key: 'version', value: head.version },
            { key: 'channels', value: head.channels },
            { key: 'preSkip', value: head.preSkip },
            { key: 'inputSampleRate', value: head.inputSampleRate },
            { key: 'outputGainDb', value: head.outputGainDb },
            { key: 'mappingFamily', value: head.mappingFamily },
            { key: 'pagesInspected', value: found.pages.length },
            { key: 'logicalStreams', value: streams.size },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: streams.size, codec: 'opus' } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['pcm-decoding', 'opus-tags-parsing', 'granule-position-duration'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
