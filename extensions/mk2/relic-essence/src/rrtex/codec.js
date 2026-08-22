import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
const ID = 'org.modkitx/rrtex'
const header = bytes =>
  new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(16, bytes.byteLength)))
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'rrtex', label: 'Relic RRTEX texture' }),
  async detect(prefix) {
    return header(prefix).includes('RRTEX')
      ? { confidence: 0.96, kind: 'structure', note: 'RRTEX marker' }
      : { confidence: 0, kind: 'structure', note: 'marker-mismatch' }
  },
  async inspect(bytes) {
    const marker = header(bytes).indexOf('RRTEX')
    if (marker < 0) throw new TypeError('RRTEX marker is missing')
    return {
      summary: { format: 'rrtex', markerOffset: marker, bytes: bytes.byteLength },
      metadata: [
        {
          id: 'rrtex',
          label: 'Relic RRTEX texture',
          entries: [
            { key: 'markerOffset', value: marker },
            { key: 'bytes', value: bytes.byteLength },
          ],
        },
      ],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: 'Relic RRTEX',
          preview: `${bytes.byteLength} bytes`,
          children: [{ kind: 'marker', label: 'RRTEX', preview: `offset ${marker}` }],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: ['pixel-decoding', 'texture-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
