import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ascii = (bytes, offset, length) =>
  new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length))
const u32le = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)

export function createRadVideoCodec({ id, formatId, label, mime, matches, read }) {
  const definition = Object.freeze({
    id,
    version: '1.0.0',
    format: Object.freeze({ id: formatId, label }),
    async detect(prefix) {
      return matches(prefix)
        ? { confidence: 0.99, kind: 'magic', note: `${label} magic` }
        : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
    },
    async inspect(bytes) {
      if (!matches(bytes)) throw new TypeError(`${label} signature is missing`)
      const value = read(bytes)
      if (value.width <= 0 || value.height <= 0 || value.width > 65_535 || value.height > 65_535)
        throw new RangeError(`${label} dimensions are invalid`)
      const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
      return {
        summary: { format: formatId, ...value },
        metadata: [{ id: formatId, label, entries }],
        traits: [{ id: 'video.streams', parameters: { count: 1, codec: value.codec } }],
        dataSources: {
          'common.view/video-media-source': createVideoMediaSource(bytes, mime, {
            seekable: false,
            tracks: [
              {
                id: 'video-0',
                kind: 'video',
                codec: value.codec,
                width: value.width,
                height: value.height,
                selected: true,
              },
            ],
            frameAccess: false,
          }),
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'movie',
            label,
            preview: `${value.width} × ${value.height}`,
            children: entries.map(entry => ({
              kind: 'field',
              label: entry.key,
              preview: String(entry.value),
            })),
          }),
        },
        maxDecodedBytes: bytes.byteLength,
        unsupportedFeatures: ['frame-decoding', 'demuxing', 'transcoding', 'frame-extraction'],
      }
    },
  })
  return Object.freeze({
    abiVersion: 1,
    createCodec: context => createInspectionCodec(definition, context),
  })
}

const codec = createRadVideoCodec({
  id: 'org.modkitx/bink',
  formatId: 'bink',
  label: 'Bink Video',
  mime: 'video/x-bink',
  matches: bytes =>
    bytes.byteLength >= 28 && (ascii(bytes, 0, 3) === 'BIK' || ascii(bytes, 0, 3) === 'KB2'),
  read: bytes => ({
    magic: ascii(bytes, 0, 4),
    codec: ascii(bytes, 0, 3) === 'KB2' ? 'bink2' : 'bink1',
    width: u32le(bytes, 20),
    height: u32le(bytes, 24),
  }),
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
