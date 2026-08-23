import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/emf'
const EMF_SIGNATURE = 0x464d4520
const NAMES = Object.freeze({ 1: 'EMR_HEADER', 14: 'EMR_EOF', 43: 'EMR_RECTANGLE' })

function headerPlausible(bytes) {
  if (bytes.byteLength < 88) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return (
    view.getUint32(0, true) === 1 &&
    view.getUint32(4, true) >= 88 &&
    view.getUint32(40, true) === EMF_SIGNATURE
  )
}

function parseEmf(bytes, budget) {
  if (!headerPlausible(bytes)) throw new TypeError('EMF header is invalid')
  if (budget.maxDepth < 2) throw new RangeError('EMF structure exceeds maxDepth budget')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declaredBytes = view.getUint32(48, true)
  const declaredRecords = view.getUint32(52, true)
  if (declaredBytes !== bytes.byteLength || declaredRecords < 2)
    throw new TypeError('EMF declared byte/record counts are invalid')
  const bounds = Object.freeze({
    left: view.getInt32(8, true),
    top: view.getInt32(12, true),
    right: view.getInt32(16, true),
    bottom: view.getInt32(20, true),
  })
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  if (width <= 0 || height <= 0) throw new TypeError('EMF bounds are empty')
  const records = []
  const shapes = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (records.length >= budget.maxNodes)
      throw new RangeError('EMF records exceed maxNodes budget')
    if (offset + 8 > bytes.byteLength) throw new RangeError('EMF record header is truncated')
    const type = view.getUint32(offset, true)
    const size = view.getUint32(offset + 4, true)
    if (size < 8 || size % 4 !== 0 || offset + size > bytes.byteLength)
      throw new RangeError('EMF record size is invalid')
    records.push(Object.freeze({ type, name: NAMES[type] ?? `EMR_${type}`, offset, size }))
    if (type === 43) {
      if (size !== 24) throw new TypeError('EMF rectangle record size is invalid')
      const rectangle = Object.freeze({
        left: view.getInt32(offset + 8, true),
        top: view.getInt32(offset + 12, true),
        right: view.getInt32(offset + 16, true),
        bottom: view.getInt32(offset + 20, true),
      })
      if (rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top)
        throw new TypeError('EMF rectangle is empty')
      shapes.push(rectangle)
    }
    offset += size
    if (type === 14) break
  }
  if (
    offset !== bytes.byteLength ||
    records.at(-1)?.type !== 14 ||
    records.length !== declaredRecords
  )
    throw new TypeError('EMF record stream lacks a terminal EOF or count agreement')
  const scalarBytes = records.length * 32 + shapes.length * 32
  if (scalarBytes > budget.maxScalarBytes)
    throw new RangeError('EMF scene exceeds maxScalarBytes budget')
  return Object.freeze({
    bounds,
    width,
    height,
    records: Object.freeze(records),
    shapes: Object.freeze(shapes),
    version: view.getUint32(44, true),
    handles: view.getUint16(56, true),
    deviceWidth: view.getInt32(72, true),
    deviceHeight: view.getInt32(76, true),
  })
}

function svgOf(info) {
  const rectangles = info.shapes
    .map(
      shape =>
        `<rect x="${shape.left}" y="${shape.top}" width="${shape.right - shape.left}" height="${shape.bottom - shape.top}" fill="none" stroke="black"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${info.bounds.left} ${info.bounds.top} ${info.width} ${info.height}">${rectangles}</svg>`
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'emf', label: 'Windows Enhanced Metafile', mediaType: 'image/emf' }),
  async detect(prefix) {
    return headerPlausible(prefix)
      ? { confidence: 0.995, kind: 'structure', note: 'EMR_HEADER and EMF signature' }
      : { confidence: 0, kind: 'structure', note: 'EMF header mismatch' }
  },
  async inspect(bytes, context) {
    const info = parseEmf(bytes, context.budget)
    const vector = createVectorSceneSource(
      {
        width: info.width,
        height: info.height,
        viewBox: [info.bounds.left, info.bounds.top, info.width, info.height],
        nodes: 1 + info.shapes.length,
        paths: 0,
        shapes: info.shapes.length,
        textNodes: 0,
        gradients: 0,
      },
      svgOf(info),
    )
    const tree = createTreeDataSource({
      kind: 'vector',
      label: 'EMF',
      preview: `${info.width} × ${info.height}, ${info.records.length} records`,
      children: info.records.map(record => ({
        kind: 'record',
        label: record.name,
        preview: `${record.size} bytes at ${record.offset}`,
      })),
    })
    return {
      summary: {
        format: 'emf',
        width: info.width,
        height: info.height,
        version: info.version,
        records: info.records.length,
        handles: info.handles,
        shapes: info.shapes.length,
      },
      metadata: [
        {
          id: 'emf-header',
          label: 'EMF header',
          entries: [
            {
              key: 'bounds',
              value: `${info.bounds.left},${info.bounds.top}–${info.bounds.right},${info.bounds.bottom}`,
            },
            { key: 'deviceWidth', value: info.deviceWidth },
            { key: 'deviceHeight', value: info.deviceHeight },
            { key: 'records', value: info.records.length },
            { key: 'handles', value: info.handles },
          ],
        },
      ],
      traits: [
        { id: 'vector.scene', parameters: { nodes: 1 + info.shapes.length } },
        { id: 'vector.shapes', parameters: { count: info.shapes.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/vector-scene-source': vector,
      },
      maxDecodedBytes: svgOf(info).length,
      unsupportedFeatures: [
        'all-gdi-records-except-rectangle-and-eof',
        'fonts-bitmaps-paths-transforms-and-clipping',
        'editing-and-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
