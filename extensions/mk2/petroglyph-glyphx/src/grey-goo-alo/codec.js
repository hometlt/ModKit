import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/grey-goo-alo'
const ROOTS = Object.freeze({
  0x200: 'skeleton',
  0x400: 'mesh',
  0x600: 'connections',
  0x1500: 'particle-system',
})
const rootOf = bytes =>
  bytes.byteLength >= 8
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
    : 0
const isCompressed = bytes =>
  bytes.byteLength >= 40 && bytes[0] === 0x43 && bytes[1] === 0x48 && bytes[36] === 0x78
const matches = bytes => isCompressed(bytes) || ROOTS[rootOf(bytes)] !== undefined

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'grey-goo-alo', label: 'Grey Goo Alamo ALO model' }),
  async detect(prefix) {
    return matches(prefix)
      ? {
          confidence: 0.99,
          kind: 'magic',
          note: isCompressed(prefix) ? 'Grey Goo CH wrapper' : 'Alamo root chunk',
        }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes) {
    if (!matches(bytes)) throw new TypeError('Grey Goo ALO root is not recognized')
    const wrapper = isCompressed(bytes) ? 'grey-goo-ch-zlib' : 'legacy-chunk'
    const root = isCompressed(bytes) ? 'compressed' : ROOTS[rootOf(bytes)]
    const declaredBytes = isCompressed(bytes)
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
      : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
    return {
      summary: { format: 'grey-goo-alo', wrapper, root, declaredBytes },
      metadata: [
        {
          id: 'grey-goo-alo',
          label: 'Alamo model envelope',
          entries: [
            { key: 'wrapper', value: wrapper },
            { key: 'root', value: root },
            { key: 'declaredBytes', value: declaredBytes },
          ],
        },
      ],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Grey Goo ALO',
          preview: `${wrapper}, ${root}`,
          children: [
            { kind: 'chunk', label: String(root), preview: `${declaredBytes} declared bytes` },
          ],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'chunk-decompression',
        'geometry-preview',
        'animation-sidecars',
        'texture-resolution',
        'model-writing',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
