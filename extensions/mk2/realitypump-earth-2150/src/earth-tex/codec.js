import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/earth-tex'
const fourCc = (bytes, offset) =>
  new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4))
const parse = bytes => {
  if (fourCc(bytes, 0) === 'DDS ' && bytes.byteLength >= 128) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      payload: 'dds',
      width: view.getUint32(16, true),
      height: view.getUint32(12, true),
      mipmaps: view.getUint32(28, true),
    }
  }
  if (bytes.byteLength >= 24 && bytes[0] === 0x89 && fourCc(bytes, 1) === 'PNG\r') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      payload: 'png',
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
      mipmaps: 1,
    }
  }
  throw new TypeError('Earth TEX has no supported embedded DDS or PNG payload')
}
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'earth-tex', label: 'Earth 2150 TEX texture' }),
  async detect(prefix) {
    try {
      parse(prefix)
      return { confidence: 0.92, kind: 'structure', note: 'self-described embedded texture' }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'payload-mismatch' }
    }
  },
  async inspect(bytes) {
    const value = parse(bytes)
    if (value.width <= 0 || value.height <= 0)
      throw new TypeError('Earth TEX dimensions are invalid')
    const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
    return {
      summary: { format: 'earth-tex', ...value },
      metadata: [{ id: 'earth-tex', label: 'Earth 2150 TEX texture', entries }],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: value.width, height: value.height, bitDepth: 8 },
        },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: 'Earth 2150 TEX',
          preview: `${value.width} × ${value.height} ${value.payload}`,
          children: entries.map(entry => ({
            kind: 'field',
            label: entry.key,
            preview: String(entry.value),
          })),
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: ['native-earth-tex-layout', 'pixel-decoding', 'texture-writing'],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
