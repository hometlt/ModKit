// Hand-ported from the MK2 codec org.modkitx/ogg (OPUS-MK2-02 task G, wave 1).
//
// The v1 manifest routed on a path glob matching every file and said so out loud: "the broad
// file prefilter intentionally defers Ogg/Vorbis versus Ogg/Opus selection to the portable
// structural detector". MK3 spells that prefilter as `match.signatures` (the Vorbis
// identification header inside the first Ogg page, cited in the extension README), and this
// module still makes the Vorbis-versus-Opus call from the bytes.
//
// Fidelity is the v1 limitation: metadata inspection and byte export, no PCM decoding.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ogg'
const latin1 = new TextDecoder('latin1')

const OGG_HEADER_BYTES = 27
const VORBIS_IDENTIFICATION = 'vorbis'

const u32le = (bytes, offset) =>
  (((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
    0) >>>
  0

/**
 * RFC 3533 §6: capture pattern, version, header type, granule position, serial, sequence, CRC,
 * then a segment table whose bytes sum to the payload length. Nothing is decoded here — the page
 * frame alone is what tells one Ogg stream from another.
 */
function readPage(bytes, offset) {
  if (offset + OGG_HEADER_BYTES > bytes.byteLength) return undefined
  if (latin1.decode(bytes.subarray(offset, offset + 4)) !== 'OggS') return undefined
  if ((bytes[offset + 4] ?? 0xff) !== 0) return undefined // stream structure version 0 only
  const segments = bytes[offset + 26] ?? 0
  const tableEnd = offset + OGG_HEADER_BYTES + segments
  if (tableEnd > bytes.byteLength) return undefined
  let payloadBytes = 0
  for (let index = 0; index < segments; index += 1)
    payloadBytes += bytes[tableEnd - segments + index] ?? 0
  return Object.freeze({
    offset,
    headerType: bytes[offset + 5] ?? 0,
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

/** Vorbis I §4.2.1: packet type 1 followed by the codec name, then the identification fields. */
const isVorbisIdentification = payload =>
  payload.byteLength >= 30 &&
  payload[0] === 0x01 &&
  latin1.decode(payload.subarray(1, 7)) === VORBIS_IDENTIFICATION

/** Vorbis I §4.2.2: version, channels, sample rate and the three bitrate hints. */
function readVorbisHeader(payload) {
  return Object.freeze({
    version: u32le(payload, 7),
    channels: payload[11] ?? 0,
    sampleRate: u32le(payload, 12),
    bitrateMaximum: u32le(payload, 16) | 0,
    bitrateNominal: u32le(payload, 20) | 0,
    bitrateMinimum: u32le(payload, 24) | 0,
  })
}

function identify(bytes, maxPages) {
  const pages = readPages(bytes, maxPages)
  const first = pages[0]
  if (first === undefined) return undefined
  if (!isVorbisIdentification(first.payload)) {
    // An Ogg stream that is not Vorbis belongs to the Opus or Theora codec, not to this one.
    const marker = latin1.decode(first.payload.subarray(0, 8))
    return Object.freeze({ pages, vorbis: undefined, marker })
  }
  return Object.freeze({ pages, vorbis: readVorbisHeader(first.payload), marker: 'vorbis' })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ogg', label: 'Ogg Vorbis', mediaType: 'audio/ogg' }),
  async detect(prefix) {
    const found = identify(prefix, 64)
    if (found === undefined) return { confidence: 0, kind: 'magic', note: 'ogg-page-mismatch' }
    if (found.vorbis === undefined) {
      // The container is Ogg but the stream is somebody else's: report the container, not a win.
      return { confidence: 0.2, kind: 'structure', note: `ogg-not-vorbis:${found.marker.trim()}` }
    }
    const sane =
      found.vorbis.version === 0 && found.vorbis.channels > 0 && found.vorbis.sampleRate > 0
    return {
      confidence: sane ? 0.98 : 0.4,
      kind: 'structure',
      note: sane ? 'ogg-vorbis-identification' : 'ogg-vorbis-implausible',
    }
  },
  async inspect(bytes, context) {
    const found = identify(bytes, Math.min(context.budget.maxNodes, 4096))
    if (found?.vorbis === undefined) throw new TypeError('Ogg stream carries no Vorbis header')
    const vorbis = found.vorbis
    const streams = new Set(found.pages.map(page => page.serialNumber))
    const audio = createAudioMediaSource(bytes, 'audio/ogg', {
      durationMs: 'unknown', // duration needs the last page granule position, which is past the
      // bounded page walk this port performs
      seekable: false,
      tracks: [
        {
          id: `stream-${vorbis.channels}ch`,
          codec: 'vorbis',
          channels: vorbis.channels,
          sampleRate: vorbis.sampleRate,
          ...(vorbis.bitrateNominal > 0
            ? { bitrateKbps: Math.round(vorbis.bitrateNominal / 1000) }
            : {}),
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'Ogg Vorbis',
      preview: `${vorbis.sampleRate} Hz, ${vorbis.channels} channel(s), ${found.pages.length} page(s)`,
      children: found.pages.map(page => ({
        kind: 'page',
        label: `page ${page.sequence}`,
        preview: `serial ${page.serialNumber}, ${page.segments} segment(s), ${page.payload.byteLength} payload bytes`,
      })),
    })
    return {
      summary: {
        format: 'ogg',
        codec: 'vorbis',
        vorbisVersion: vorbis.version,
        channels: vorbis.channels,
        sampleRate: vorbis.sampleRate,
        bitrateNominal: vorbis.bitrateNominal,
        pages: found.pages.length,
        streams: streams.size,
      },
      metadata: [
        {
          id: 'ogg-vorbis',
          label: 'Ogg Vorbis identification',
          entries: [
            { key: 'vorbisVersion', value: vorbis.version },
            { key: 'channels', value: vorbis.channels },
            { key: 'sampleRate', value: vorbis.sampleRate },
            { key: 'bitrateMaximum', value: vorbis.bitrateMaximum },
            { key: 'bitrateNominal', value: vorbis.bitrateNominal },
            { key: 'bitrateMinimum', value: vorbis.bitrateMinimum },
            { key: 'pagesInspected', value: found.pages.length },
            { key: 'logicalStreams', value: streams.size },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: streams.size, codec: 'vorbis' } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['pcm-decoding', 'vorbis-comment-parsing', 'granule-position-duration'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
