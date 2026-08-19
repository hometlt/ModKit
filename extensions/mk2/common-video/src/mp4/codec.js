// Hand-ported from the MK2 codec org.modkitx/mp4 (OPUS-MK2-02 task G, wave 1).
//
// ISO/IEC 14496-12 is a tree of boxes, and the v1 limitation says the codec "walks a limited set
// of movie, track and sample-description boxes and does not validate or expose the complete
// ISO-BMFF structure". This port walks exactly that limited set: `ftyp` for the brands, `moov`
// with `mvhd` for the timescale and duration, and `trak`/`hdlr`/`stsd` for the track inventory.
//
// The v1 match was a path glob matching every file; MK3 spells that as `match.signatures` — the
// `ftyp` box type at byte 4, cited in the extension README.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/mp4'
const latin1 = new TextDecoder('latin1')

/** §8.4.3 handler types the port names; anything else is reported by its four-character code. */
const HANDLERS = Object.freeze({
  vide: 'video',
  soun: 'audio',
  hint: 'hint',
  text: 'text',
  subt: 'subtitle',
})
/** Boxes whose payload is itself a box list (§8 container boxes). */
const CONTAINERS = Object.freeze(new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts']))

const fourCc = (bytes, offset) => latin1.decode(bytes.subarray(offset, offset + 4))
const u32be = (bytes, offset) =>
  (((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)) >>>
  0

const hasFtyp = bytes => bytes.byteLength >= 12 && fourCc(bytes, 4) === 'ftyp'

/**
 * §4.2 box header: a 32-bit size and a four-character type, where size 1 means a 64-bit size
 * follows and size 0 means "to the end of the file". Both are handled; neither is guessed at.
 */
function readBoxes(bytes, start, end, depth, budget, out) {
  let offset = start
  while (offset + 8 <= end) {
    if (out.length >= budget.maxNodes) throw new RangeError('ISO-BMFF box count exceeds maxNodes')
    const declared = u32be(bytes, offset)
    const type = fourCc(bytes, offset + 4)
    let header = 8
    let size = declared
    if (declared === 1) {
      // 64-bit sizes are legal but this port refuses to read past a safe integer.
      const high = u32be(bytes, offset + 8)
      const low = u32be(bytes, offset + 12)
      if (high !== 0) throw new RangeError('ISO-BMFF box is larger than this port will read')
      size = low
      header = 16
    } else if (declared === 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) break
    out.push(Object.freeze({ type, depth, offset, bytes: size, payload: offset + header }))
    if (CONTAINERS.has(type) && depth < budget.maxDepth) {
      readBoxes(bytes, offset + header, offset + size, depth + 1, budget, out)
    }
    offset += size
  }
  return out
}

/** §8.2.2 MovieHeaderBox, version 0 and 1. */
function readMovieHeader(bytes, box) {
  const version = bytes[box.payload] ?? 0
  const at = box.payload + 4
  if (version === 1) {
    // 64-bit creation/modification times are skipped; the port only needs timescale + duration.
    const timescale = u32be(bytes, at + 16)
    const durationHigh = u32be(bytes, at + 20)
    const durationLow = u32be(bytes, at + 24)
    if (durationHigh !== 0) return Object.freeze({ version, timescale, duration: undefined })
    return Object.freeze({ version, timescale, duration: durationLow })
  }
  return Object.freeze({
    version,
    timescale: u32be(bytes, at + 8),
    duration: u32be(bytes, at + 12),
  })
}

function summarize(bytes, budget) {
  if (!hasFtyp(bytes)) throw new TypeError('ISO-BMFF file type box is missing')
  const boxes = readBoxes(bytes, 0, bytes.byteLength, 0, budget, [])
  const ftyp = boxes.find(box => box.type === 'ftyp')
  if (ftyp === undefined) throw new TypeError('ISO-BMFF file type box is missing')
  const brands = []
  for (let at = ftyp.payload; at + 4 <= ftyp.offset + ftyp.bytes; at += 4) {
    if (at === ftyp.payload + 4) continue // minor_version is a number, not a brand
    brands.push(fourCc(bytes, at).trim())
  }
  const mvhdBox = boxes.find(box => box.type === 'mvhd')
  const movie = mvhdBox === undefined ? undefined : readMovieHeader(bytes, mvhdBox)
  const tracks = boxes
    .filter(box => box.type === 'hdlr')
    .map((box, index) => {
      const handler = fourCc(bytes, box.payload + 8)
      return Object.freeze({ index, handler, kind: HANDLERS[handler] ?? handler })
    })
  const sampleEntries = boxes
    .filter(box => box.type === 'stsd')
    .flatMap(box => {
      const count = u32be(bytes, box.payload + 4)
      const entries = []
      let at = box.payload + 8
      for (let index = 0; index < Math.min(count, 16); index += 1) {
        if (at + 8 > box.offset + box.bytes) break
        entries.push(fourCc(bytes, at + 4))
        at += u32be(bytes, at)
      }
      return entries
    })
  return Object.freeze({
    boxes: Object.freeze(boxes),
    brands: Object.freeze(brands),
    movie,
    tracks: Object.freeze(tracks),
    sampleEntries: Object.freeze(sampleEntries),
  })
}

const PROBE_BUDGET = Object.freeze({ maxNodes: 512, maxDepth: 8 })

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'mp4',
    label: 'MP4 / ISO Base Media File Format',
    mediaType: 'video/mp4',
  }),
  async detect(prefix) {
    if (!hasFtyp(prefix)) return { confidence: 0, kind: 'magic', note: 'ftyp-mismatch' }
    try {
      const parsed = summarize(prefix, PROBE_BUDGET)
      const major = parsed.brands[0] ?? ''
      // A file type box that also yields a readable box chain is decisive; `ftyp` alone is four
      // bytes at a fixed offset, which a truncated download can also produce.
      return { confidence: 0.98, kind: 'magic', note: `iso-bmff-${major || 'unbranded'}` }
    } catch {
      return { confidence: 0.6, kind: 'magic', note: 'iso-bmff-ftyp-only' }
    }
  },
  async inspect(bytes, context) {
    const parsed = summarize(bytes, context.budget)
    const timescale = parsed.movie?.timescale ?? 0
    const duration = parsed.movie?.duration
    const durationMs =
      timescale > 0 && duration !== undefined
        ? Math.round((duration / timescale) * 1000)
        : 'unknown'
    const videoTracks = parsed.tracks.filter(track => track.kind === 'video')
    const audioTracks = parsed.tracks.filter(track => track.kind === 'audio')
    const video = createVideoMediaSource(bytes, 'video/mp4', {
      durationMs,
      // §8.7.4 sample tables make an MP4 seekable, but this port never reads them; claiming
      // seekability it has not verified would be a promise the descriptor cannot keep.
      seekable: false,
      tracks: parsed.tracks.map((track, index) => ({
        id: `track-${index}`,
        kind: track.kind === 'audio' ? 'audio' : 'video',
        codec: parsed.sampleEntries[index] ?? 'unknown',
        selected: index === 0,
      })),
      frameAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'MP4',
      preview: `${parsed.brands.join(', ') || 'no brands'}, ${parsed.boxes.length} box(es)`,
      children: parsed.boxes.map(box => ({
        kind: 'box',
        label: `${'  '.repeat(box.depth)}${box.type}`,
        preview: `${box.bytes} bytes at ${box.offset}`,
      })),
    })
    return {
      summary: {
        format: 'mp4',
        brands: parsed.brands,
        timescale,
        durationMs,
        boxes: parsed.boxes.length,
        tracks: parsed.tracks.length,
        videoTracks: videoTracks.length,
        audioTracks: audioTracks.length,
        sampleEntries: parsed.sampleEntries,
      },
      metadata: [
        {
          id: 'iso-bmff',
          label: 'ISO base media file',
          entries: [
            { key: 'majorBrand', value: parsed.brands[0] ?? 'unknown' },
            { key: 'brands', value: parsed.brands.join('+') },
            { key: 'movieHeaderVersion', value: parsed.movie?.version ?? -1 },
            { key: 'timescale', value: timescale },
            { key: 'duration', value: duration ?? 0 },
            { key: 'boxes', value: parsed.boxes.length },
            { key: 'tracks', value: parsed.tracks.length },
            { key: 'sampleEntries', value: parsed.sampleEntries.join('+') },
          ],
        },
      ],
      traits: [
        ...(videoTracks.length === 0
          ? []
          : [
              {
                id: 'video.streams',
                parameters: {
                  count: videoTracks.length,
                  codec: parsed.sampleEntries[0] ?? 'unknown',
                },
              },
            ]),
        ...(audioTracks.length === 0
          ? []
          : [{ id: 'audio.streams', parameters: { count: audioTracks.length } }]),
        ...(durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: durationMs } }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: ['sample-table-parsing', 'elementary-stream-decoding', 'remuxing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
