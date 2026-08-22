import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
const fourCc = (bytes, offset) =>
  new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4))
export function createEmpireTextureCodec({ id, formatId, label }) {
  const parse = bytes => {
    if (bytes.byteLength < 128 || fourCc(bytes, 0) !== 'DDS ')
      throw new TypeError(`${label} has no self-described DDS payload`)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      payload: 'dds',
      width: view.getUint32(16, true),
      height: view.getUint32(12, true),
      mipmaps: view.getUint32(28, true),
    }
  }
  const definition = Object.freeze({
    id,
    version: '1.0.0',
    format: Object.freeze({ id: formatId, label }),
    async detect(prefix) {
      try {
        parse(prefix)
        return { confidence: 0.92, kind: 'structure', note: 'embedded DDS texture' }
      } catch {
        return { confidence: 0, kind: 'structure', note: 'payload-mismatch' }
      }
    },
    async inspect(bytes) {
      const value = parse(bytes)
      const entries = Object.entries(value).map(([key, item]) => ({ key, value: item }))
      return {
        summary: { format: formatId, ...value },
        metadata: [{ id: formatId, label, entries }],
        traits: [
          {
            id: 'image.raster',
            parameters: { width: value.width, height: value.height, bitDepth: 8 },
          },
        ],
        dataSources: {
          'common.view/tree-data-source': createTreeDataSource({
            kind: 'image',
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
        unsupportedFeatures: ['native-cache-layout', 'pixel-decoding', 'texture-writing'],
      }
    },
  })
  return Object.freeze({
    abiVersion: 1,
    createCodec: context => createInspectionCodec(definition, context),
  })
}
const codec = createEmpireTextureCodec({
  id: 'org.modkitx/sst',
  formatId: 'sst',
  label: 'Empire Earth SST texture',
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
