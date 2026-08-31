// Hand-ported from the MK2 codec modkit/mpeg (OPUS-MK2-02 task G, wave 1).
//
// The v1 limitation is the specification of this port: "recognizes MPEG start codes or repeated
// transport-stream sync bytes and reports a bounded packet inventory; it does not parse complete
// program tables or decode elementary streams". So: a bounded start-code inventory, the sequence
// header when one is present, and a transport-stream check that requires the 0x47 sync byte to
// repeat on the 188-byte grid rather than merely appear.
//
// The v1 match was a path glob matching every file; MK3 spells that as `match.signatures` — the
// pack and sequence start codes, cited in the extension README.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkit/codec-kit'

const ID = 'modkit/mpeg'

/** ISO/IEC 11172-1 §2.4.3 and 11172-2 §2.4.2 start code values worth naming. */
const START_CODES = Object.freeze({
  0x00: 'picture',
  0xb3: 'sequence-header',
  0xb7: 'sequence-end',
  0xb8: 'group-of-pictures',
  0xba: 'pack',
  0xbb: 'system-header',
  0xbd: 'private-stream-1',
  0xbe: 'padding',
  0xc0: 'audio-stream',
  0xe0: 'video-stream',
})
/** ISO/IEC 13818-1 §2.4.3.2: a transport packet is 188 bytes and starts with 0x47. */
const TS_PACKET_BYTES = 188
/** 11172-2 Table 2-D.1 aspect ratios and Table 2-D.2 frame rates, indexed by the coded value. */
const FRAME_RATES = Object.freeze([
  0, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 0, 0, 0, 0, 0, 0, 0,
])

const nameOf = code =>
  START_CODES[code] ??
  (code >= 0x01 && code <= 0xaf ? 'slice' : `start-code-0x${code.toString(16).padStart(2, '0')}`)

/** Scans for `00 00 01 xx` prefixes, stopping at `limit` codes so a huge file stays bounded. */
function readStartCodes(bytes, limit) {
  const codes = []
  for (let offset = 0; offset + 3 < bytes.byteLength && codes.length < limit; offset += 1) {
    if (bytes[offset] !== 0x00 || bytes[offset + 1] !== 0x00 || bytes[offset + 2] !== 0x01) continue
    const code = bytes[offset + 3] ?? 0
    codes.push(Object.freeze({ offset, code, name: nameOf(code) }))
  }
  return Object.freeze(codes)
}

/** 11172-2 §2.4.2.3 sequence_header: 12 + 12 + 4 + 4 bits after the start code. */
function readSequenceHeader(bytes, offset) {
  if (offset + 8 > bytes.byteLength) return undefined
  const b0 = bytes[offset] ?? 0
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  const width = (b0 << 4) | (b1 >>> 4)
  const height = ((b1 & 0x0f) << 8) | b2
  if (width === 0 || height === 0) return undefined
  return Object.freeze({
    width,
    height,
    aspectRatioCode: b3 >>> 4,
    frameRate: FRAME_RATES[b3 & 0x0f] ?? 0,
  })
}

/** A single 0x47 proves nothing; a transport stream repeats it every 188 bytes. */
function transportPackets(bytes, limit) {
  if ((bytes[0] ?? 0) !== 0x47) return 0
  let packets = 0
  for (
    let offset = 0;
    offset < bytes.byteLength && packets < limit && bytes[offset] === 0x47;
    offset += TS_PACKET_BYTES
  ) {
    packets += 1
  }
  return packets >= 2 ? packets : 0
}

function summarize(bytes, limit) {
  const codes = readStartCodes(bytes, limit)
  const sequence = codes.find(entry => entry.code === 0xb3)
  const packets = transportPackets(bytes, limit)
  return Object.freeze({
    codes,
    packets,
    sequence: sequence === undefined ? undefined : readSequenceHeader(bytes, sequence.offset + 4),
    programStream: codes.some(entry => entry.code === 0xba),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'mpeg', label: 'MPEG-1/2 Video', mediaType: 'video/mpeg' }),
  async detect(prefix) {
    const parsed = summarize(prefix, 256)
    if (parsed.packets > 0) {
      return { confidence: 0.9, kind: 'structure', note: `mpeg-ts-${parsed.packets}-packets` }
    }
    const leading = parsed.codes[0]
    if (leading === undefined || leading.offset !== 0) {
      // A start code somewhere inside a file is a coincidence waiting to happen; only a stream
      // that *begins* with one is claimed. This is the same conservative rule the v1 detector had.
      return { confidence: 0, kind: 'structure', note: 'no-leading-mpeg-start-code' }
    }
    if (parsed.programStream) {
      return { confidence: 0.95, kind: 'structure', note: 'mpeg-program-stream' }
    }
    if (parsed.sequence !== undefined) {
      return {
        confidence: 0.95,
        kind: 'structure',
        note: `mpeg-video-${parsed.sequence.width}x${parsed.sequence.height}`,
      }
    }
    return { confidence: 0.4, kind: 'structure', note: `mpeg-${leading.name}` }
  },
  async inspect(bytes, context) {
    const parsed = summarize(bytes, Math.min(context.budget.maxNodes, 4096))
    if (parsed.codes.length === 0 && parsed.packets === 0) {
      throw new TypeError('no MPEG start code or transport-stream packet grid found')
    }
    const container =
      parsed.packets > 0
        ? 'transport-stream'
        : parsed.programStream
          ? 'program-stream'
          : 'elementary-stream'
    const sequence = parsed.sequence
    const video = createVideoMediaSource(bytes, 'video/mpeg', {
      durationMs: 'unknown', // duration needs the presentation timestamps this port does not read
      seekable: false,
      tracks: [
        {
          id: 'video-0',
          kind: 'video',
          codec: 'mpeg-video',
          ...(sequence === undefined ? {} : { width: sequence.width, height: sequence.height }),
          ...(sequence === undefined || sequence.frameRate === 0
            ? {}
            : { frameRate: sequence.frameRate }),
          selected: true,
        },
      ],
      frameAccess: false,
    })
    const counts = new Map()
    for (const entry of parsed.codes) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'MPEG',
      preview: `${container}, ${parsed.codes.length} start code(s) inspected`,
      children: [
        { kind: 'header', label: 'container', preview: container },
        ...(sequence === undefined
          ? [{ kind: 'header', label: 'sequence header', preview: 'absent' }]
          : [
              {
                kind: 'header',
                label: 'sequence header',
                preview: `${sequence.width} × ${sequence.height}, ${sequence.frameRate} fps`,
              },
            ]),
        ...[...counts]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([name, count]) => ({
            kind: 'start-code',
            label: name,
            preview: `${count} occurrence(s)`,
          })),
      ],
    })
    return {
      summary: {
        format: 'mpeg',
        container,
        startCodes: parsed.codes.length,
        transportPackets: parsed.packets,
        width: sequence?.width ?? null,
        height: sequence?.height ?? null,
        frameRate: sequence?.frameRate ?? null,
      },
      metadata: [
        {
          id: 'mpeg-stream',
          label: 'MPEG stream',
          entries: [
            { key: 'container', value: container },
            { key: 'startCodes', value: parsed.codes.length },
            { key: 'transportPackets', value: parsed.packets },
            { key: 'width', value: sequence?.width ?? 0 },
            { key: 'height', value: sequence?.height ?? 0 },
            { key: 'frameRate', value: sequence?.frameRate ?? 0 },
            { key: 'aspectRatioCode', value: sequence?.aspectRatioCode ?? 0 },
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: {
            count: 1,
            codec: 'mpeg-video',
            ...(sequence === undefined ? {} : { width: sequence.width, height: sequence.height }),
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: ['program-table-parsing', 'elementary-stream-decoding', 'timestamps'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
