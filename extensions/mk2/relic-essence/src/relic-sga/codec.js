import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
const ID = 'org.modkitx/relic-sga'
const matches = bytes =>
  bytes.byteLength >= 12 && new TextDecoder('ascii').decode(bytes.subarray(0, 8)) === '_ARCHIVE'
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'relic-sga', label: 'Relic SGA archive' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'Relic SGA signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes) {
    if (!matches(bytes)) throw new TypeError('Relic SGA signature is missing')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const major = view.getUint16(8, true)
    const minor = view.getUint16(10, true)
    return {
      summary: { format: 'relic-sga', version: `${major}.${minor}`, bytes: bytes.byteLength },
      metadata: [
        {
          id: 'relic-sga',
          label: 'Relic SGA archive',
          entries: [
            { key: 'version', value: `${major}.${minor}` },
            { key: 'bytes', value: bytes.byteLength },
          ],
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: 0 } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Relic SGA',
          preview: `version ${major}.${minor}`,
          children: [],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: ['toc-decoding', 'entry-extraction', 'compression', 'archive-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
