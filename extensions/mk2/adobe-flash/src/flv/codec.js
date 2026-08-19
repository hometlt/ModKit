// Hand-ported from the MK2 codec org.modkitx/flv (OPUS-MK2-02 task G, wave 1).
//
// The v1 manifest had no magic at all — it routed on a path glob matching every file and left
// the decision to a detector. In MK3 that is `match.signatures` (the FLV header, cited in the
// extension README), so this module can hold the strict header check the v1 detector held.
//
// Fidelity follows the v1 limitation: "inspects FLV headers and a bounded tag stream, and
// preserves source bytes". No decoding, no thumbnails, no remuxing.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/flv'
const latin1 = new TextDecoder('latin1')

const TAG_TYPES = Object.freeze({ 8: 'audio', 9: 'video', 18: 'script' })
/** Video codec ids, FLV spec annex E.4.3.1. */
const VIDEO_CODECS = Object.freeze({
  2: 'sorenson-h263',
  3: 'screen-video',
  4: 'vp6',
  5: 'vp6-alpha',
  6: 'screen-video-2',
  7: 'avc',
})
/** Audio format ids, FLV spec annex E.4.2.1. */
const AUDIO_CODECS = Object.freeze({
  0: 'pcm',
  1: 'adpcm',
  2: 'mp3',
  4: 'nellymoser-16k',
  10: 'aac',
  11: 'speex',
})

const u24be = (bytes, offset) =>
  ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0)
const u32be = (bytes, offset) => u24be(bytes, offset) * 256 + (bytes[offset + 3] ?? 0)

/** Annex E.2: "FLV", one version byte, one flags byte, then the u32 header size. */
function headerOf(bytes) {
  if (bytes.byteLength < 9) return undefined
  if (latin1.decode(bytes.subarray(0, 3)) !== 'FLV') return undefined
  const version = bytes[3] ?? 0
  const flags = bytes[4] ?? 0
  if (version === 0 || (flags & 0xfa) !== 0) return undefined // bits 1 and 3 are the only ones defined
  const dataOffset = u32be(bytes, 5)
  if (dataOffset < 9) return undefined
  return Object.freeze({
    version,
    hasAudio: (flags & 0x04) !== 0,
    hasVideo: (flags & 0x01) !== 0,
    dataOffset,
  })
}

/** Annex E.3: each tag is an 11-byte header, its body, then the u32 size of the whole tag. */
function readTags(bytes, header, maxTags) {
  const tags = []
  let offset = header.dataOffset + 4 // skip PreviousTagSize0, which is always zero
  while (offset + 11 <= bytes.byteLength && tags.length < maxTags) {
    const type = bytes[offset] ?? 0
    const bodyBytes = u24be(bytes, offset + 1)
    const timestamp = u24be(bytes, offset + 4) | ((bytes[offset + 7] ?? 0) << 24)
    const body = offset + 11
    if (body + bodyBytes > bytes.byteLength) break
    const first = bytes[body] ?? 0
    const codec =
      type === 9
        ? (VIDEO_CODECS[first & 0x0f] ?? `video-${first & 0x0f}`)
        : type === 8
          ? (AUDIO_CODECS[first >>> 4] ?? `audio-${first >>> 4}`)
          : undefined
    tags.push(
      Object.freeze({
        type,
        name: TAG_TYPES[type] ?? `tag-${type}`,
        bytes: bodyBytes,
        timestamp,
        ...(codec === undefined ? {} : { codec }),
        ...(type === 9 ? { keyFrame: first >>> 4 === 1 } : {}),
      }),
    )
    offset = body + bodyBytes + 4
  }
  return Object.freeze(tags)
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'flv', label: 'Flash Video', mediaType: 'video/x-flv' }),
  async detect(prefix) {
    const header = headerOf(prefix)
    if (header === undefined) return { confidence: 0, kind: 'magic', note: 'flv-header-mismatch' }
    // "FLV" plus a sane version, reserved flag bits clear and a header size of at least nine is
    // the whole of what the container promises before the first tag.
    return { confidence: 0.97, kind: 'magic', note: `flv-v${header.version}` }
  },
  async inspect(bytes, context) {
    const header = headerOf(bytes)
    if (header === undefined) throw new TypeError('FLV header is invalid')
    const tags = readTags(bytes, header, Math.min(context.budget.maxNodes, 4096))
    const lastTimestamp = tags.reduce((latest, tag) => Math.max(latest, tag.timestamp), 0)
    const videoTag = tags.find(tag => tag.type === 9)
    const audioTag = tags.find(tag => tag.type === 8)
    const durationMs = tags.length === 0 ? 'unknown' : lastTimestamp

    const video = createVideoMediaSource(bytes, 'video/x-flv', {
      durationMs,
      seekable: false, // seeking needs the script-tag keyframe index, which this port does not read
      tracks: [
        ...(header.hasVideo
          ? [
              {
                id: 'video-0',
                kind: 'video',
                codec: videoTag?.codec ?? 'unknown',
                selected: true,
              },
            ]
          : []),
        ...(header.hasAudio
          ? [
              {
                id: 'audio-0',
                kind: 'audio',
                codec: audioTag?.codec ?? 'unknown',
                selected: !header.hasVideo,
              },
            ]
          : []),
      ],
      frameAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'FLV',
      preview: `version ${header.version}, ${tags.length} tag(s) inspected`,
      children: [
        { kind: 'header', label: 'version', preview: String(header.version) },
        { kind: 'header', label: 'audio', preview: header.hasAudio ? 'present' : 'absent' },
        { kind: 'header', label: 'video', preview: header.hasVideo ? 'present' : 'absent' },
        { kind: 'header', label: 'data offset', preview: String(header.dataOffset) },
        ...tags.map((tag, index) => ({
          kind: 'tag',
          label: `${index}: ${tag.name}`,
          preview: `${tag.bytes} bytes at ${tag.timestamp} ms${tag.codec === undefined ? '' : `, ${tag.codec}`}`,
        })),
      ],
    })
    return {
      summary: {
        format: 'flv',
        version: header.version,
        hasAudio: header.hasAudio,
        hasVideo: header.hasVideo,
        tags: tags.length,
        videoCodec: videoTag?.codec ?? null,
        audioCodec: audioTag?.codec ?? null,
        durationMs,
      },
      metadata: [
        {
          id: 'flv-header',
          label: 'FLV header',
          entries: [
            { key: 'version', value: header.version },
            { key: 'audio', value: header.hasAudio },
            { key: 'video', value: header.hasVideo },
            { key: 'dataOffset', value: header.dataOffset },
            { key: 'tagsInspected', value: tags.length },
            { key: 'lastTimestampMs', value: lastTimestamp },
          ],
        },
      ],
      traits: [
        ...(header.hasVideo
          ? [
              {
                id: 'video.streams',
                parameters: { count: 1, codec: videoTag?.codec ?? 'unknown' },
              },
            ]
          : []),
        ...(header.hasAudio
          ? [
              {
                id: 'audio.streams',
                parameters: { count: 1, codec: audioTag?.codec ?? 'unknown' },
              },
            ]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: ['elementary-stream-decoding', 'keyframe-index', 'remuxing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
