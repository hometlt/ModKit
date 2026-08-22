// Heroes III DEF structural inventory. Pixel decoding remains explicitly unsupported.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/def'

function parseDef(bytes, budget) {
  if (bytes.byteLength < 16) throw new TypeError('Heroes III DEF header is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = view.getUint32(0, true)
  const width = view.getUint32(4, true)
  const height = view.getUint32(8, true)
  const groups = view.getUint32(12, true)
  if (width === 0 || height === 0 || width > 16384 || height > 16384) {
    throw new TypeError('Heroes III DEF dimensions are invalid')
  }
  if (groups > budget.maxNodes) throw new RangeError('Heroes III DEF groups exceed maxNodes')
  return Object.freeze({ type, width, height, groups })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'def', label: 'Heroes III DEF sprite/animation' }),
  async detect(prefix, uri) {
    const name = uri.toLowerCase().split(/[?#]/u, 1)[0] ?? uri.toLowerCase()
    if (!name.endsWith('.def')) {
      return { confidence: 0, kind: 'structure', note: 'extension-mismatch' }
    }
    try {
      parseDef(prefix, { maxNodes: 100_000 })
      return { confidence: 0.88, kind: 'structure', note: 'bounded DEF header' }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'structure-mismatch' }
    }
  },
  async inspect(bytes, context) {
    const model = parseDef(bytes, context.budget)
    return {
      summary: { format: 'def', ...model, support: 'structural-metadata-only' },
      metadata: [
        {
          id: 'def',
          label: 'Heroes III DEF',
          entries: [
            { key: 'type', value: model.type },
            { key: 'width', value: model.width },
            { key: 'height', value: model.height },
            { key: 'groups', value: model.groups },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: model.width, height: model.height, decoded: false },
        },
        { id: 'image.frames', parameters: { groups: model.groups } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: 'Heroes III DEF',
          preview: `${model.width} × ${model.height}, ${model.groups} group(s)`,
          children: [{ kind: 'header', label: 'Type', preview: `0x${model.type.toString(16)}` }],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: ['def-group-decoding', 'def-frame-pixel-decoding', 'def-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
