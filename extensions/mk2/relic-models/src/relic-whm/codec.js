import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ascii = (bytes, offset, length) =>
  new TextDecoder('latin1').decode(bytes.subarray(offset, offset + length)).replace(/\0+$/u, '')
const rootOffset = bytes => (ascii(bytes, 0, 12) === 'Relic Chunky' ? 24 : 0)
const matches = bytes => ascii(bytes, rootOffset(bytes), 8) === 'FOLDRSGM'
export function createRelicModelCodec({ id, formatId, label }) {
  const definition = Object.freeze({
    id,
    version: '1.0.0',
    format: Object.freeze({ id: formatId, label }),
    async detect(prefix) {
      return matches(prefix)
        ? { confidence: 0.99, kind: 'structure', note: 'FOLDRSGM model root' }
        : { confidence: 0, kind: 'structure', note: 'root-mismatch' }
    },
    async inspect(bytes) {
      if (!matches(bytes) || rootOffset(bytes) + 20 > bytes.byteLength)
        throw new TypeError(`${label} root is invalid`)
      const offset = rootOffset(bytes)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const value = {
        root: 'FOLDRSGM',
        version: view.getInt32(offset + 8, true),
        payloadBytes: view.getInt32(offset + 12, true),
        nameBytes: view.getInt32(offset + 16, true),
        preamble: offset === 24,
      }
      if (
        value.payloadBytes < 0 ||
        value.nameBytes < 0 ||
        offset + 20 + value.nameBytes + value.payloadBytes > bytes.byteLength
      )
        throw new TypeError(`${label} root exceeds input`)
      const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
      return {
        summary: { format: formatId, ...value },
        metadata: [{ id: formatId, label, entries }],
        traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
        dataSources: {
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'model',
            label,
            preview: `FOLDRSGM v${value.version}`,
            children: entries.map(entry => ({
              kind: 'field',
              label: entry.key,
              preview: String(entry.value),
            })),
          }),
        },
        maxDecodedBytes: bytes.byteLength,
        unsupportedFeatures: [
          'geometry-decoding',
          'materials',
          'skeletons',
          'animations',
          'model-writing',
        ],
      }
    },
  })
  return Object.freeze({
    abiVersion: 1,
    createCodec: context => createInspectionCodec(definition, context),
  })
}
const codec = createRelicModelCodec({
  id: 'org.modkitx/relic-whm',
  formatId: 'relic-whm',
  label: 'Relic WHM model',
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
