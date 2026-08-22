import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/earth2160-model'
const MAGIC = Object.freeze([0x9f, 0x99, 0x66, 0xf6, 0x02])
const matches = bytes =>
  bytes.byteLength >= 16 && MAGIC.every((value, index) => bytes[index] === value)
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'earth2160-model', label: 'Earth 2160 model family' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.98, kind: 'magic', note: 'corpus-observed Earth 2160 prefix' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (!matches(bytes)) throw new TypeError('Earth 2160 model prefix is missing')
    const extension = context.source.ref.uri.toLowerCase().split('.').at(-1) ?? 'unknown'
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const value = {
      extension,
      headerVersion: bytes[4],
      recordHint: view.getUint32(8, true),
      flags: view.getUint32(12, true),
    }
    const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
    return {
      summary: { format: 'earth2160-model', ...value },
      metadata: [{ id: 'earth2160-model', label: 'Earth 2160 model envelope', entries }],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Earth 2160 model',
          preview: extension.toUpperCase(),
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
        'sidecar-application',
        'materials',
        'animations',
        'model-writing',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
