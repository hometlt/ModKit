import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkit/codec-kit'

const ID = 'modkit/wmf'
const PLACEABLE_KEY = 0x9ac6cdd7
const NAMES = Object.freeze({ 0x0000: 'META_EOF', 0x041b: 'META_RECTANGLE' })

function placeable(bytes) {
  return (
    bytes.byteLength >= 40 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) ===
      PLACEABLE_KEY
  )
}

function parseWmf(bytes, budget) {
  if (!placeable(bytes)) throw new TypeError('WMF placeable header is missing')
  if (budget.maxDepth < 2) throw new RangeError('WMF structure exceeds maxDepth budget')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let checksum = 0
  for (let offset = 0; offset < 20; offset += 2) checksum ^= view.getUint16(offset, true)
  if (checksum !== view.getUint16(20, true))
    throw new TypeError('WMF placeable checksum is invalid')
  const bounds = Object.freeze({
    left: view.getInt16(6, true),
    top: view.getInt16(8, true),
    right: view.getInt16(10, true),
    bottom: view.getInt16(12, true),
  })
  const unitsPerInch = view.getUint16(14, true)
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top || unitsPerInch === 0)
    throw new TypeError('WMF placeable bounds/units are invalid')
  const header = 22
  const fileType = view.getUint16(header, true)
  const headerWords = view.getUint16(header + 2, true)
  const version = view.getUint16(header + 4, true)
  const declaredBytes = view.getUint32(header + 6, true) * 2
  const objects = view.getUint16(header + 10, true)
  const maximumRecordWords = view.getUint32(header + 12, true)
  if (
    (fileType !== 1 && fileType !== 2) ||
    headerWords !== 9 ||
    (version !== 0x0100 && version !== 0x0300) ||
    declaredBytes !== bytes.byteLength - header
  )
    throw new TypeError('WMF standard header is invalid')
  const records = []
  const shapes = []
  let offset = header + 18
  while (offset < bytes.byteLength) {
    if (records.length >= budget.maxNodes)
      throw new RangeError('WMF records exceed maxNodes budget')
    if (offset + 6 > bytes.byteLength) throw new RangeError('WMF record header is truncated')
    const words = view.getUint32(offset, true)
    const size = words * 2
    const type = view.getUint16(offset + 4, true)
    if (words < 3 || size > maximumRecordWords * 2 || offset + size > bytes.byteLength)
      throw new RangeError('WMF record size is invalid')
    records.push(
      Object.freeze({ type, name: NAMES[type] ?? `META_${type.toString(16)}`, offset, size }),
    )
    if (type === 0x041b) {
      if (words !== 7) throw new TypeError('WMF rectangle record size is invalid')
      const rectangle = Object.freeze({
        bottom: view.getInt16(offset + 6, true),
        right: view.getInt16(offset + 8, true),
        top: view.getInt16(offset + 10, true),
        left: view.getInt16(offset + 12, true),
      })
      if (rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top)
        throw new TypeError('WMF rectangle is empty')
      shapes.push(rectangle)
    }
    offset += size
    if (type === 0) break
  }
  if (offset !== bytes.byteLength || records.at(-1)?.type !== 0)
    throw new TypeError('WMF record stream lacks a terminal META_EOF')
  if (records.length * 32 + shapes.length * 32 > budget.maxScalarBytes)
    throw new RangeError('WMF scene exceeds maxScalarBytes budget')
  const scale = 96 / unitsPerInch
  return Object.freeze({
    bounds,
    unitsPerInch,
    width: Math.round((bounds.right - bounds.left) * scale),
    height: Math.round((bounds.bottom - bounds.top) * scale),
    fileType,
    version,
    objects,
    records: Object.freeze(records),
    shapes: Object.freeze(shapes),
  })
}

function svgOf(info) {
  const rectangles = info.shapes
    .map(
      shape =>
        `<rect x="${shape.left}" y="${shape.top}" width="${shape.right - shape.left}" height="${shape.bottom - shape.top}" fill="none" stroke="black"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${info.bounds.left} ${info.bounds.top} ${info.bounds.right - info.bounds.left} ${info.bounds.bottom - info.bounds.top}">${rectangles}</svg>`
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'wmf', label: 'Windows Classic Metafile', mediaType: 'image/wmf' }),
  async detect(prefix) {
    return placeable(prefix)
      ? { confidence: 0.995, kind: 'magic', note: 'Aldus placeable WMF key' }
      : { confidence: 0, kind: 'magic', note: 'placeable WMF key missing' }
  },
  async inspect(bytes, context) {
    const info = parseWmf(bytes, context.budget)
    const document = svgOf(info)
    const vector = createVectorSceneSource(
      {
        width: info.width,
        height: info.height,
        viewBox: [
          info.bounds.left,
          info.bounds.top,
          info.bounds.right - info.bounds.left,
          info.bounds.bottom - info.bounds.top,
        ],
        nodes: 1 + info.shapes.length,
        paths: 0,
        shapes: info.shapes.length,
        textNodes: 0,
        gradients: 0,
      },
      document,
    )
    const tree = createTreeDataSource({
      kind: 'vector',
      label: 'WMF',
      preview: `${info.width} × ${info.height}, ${info.records.length} records`,
      children: info.records.map(record => ({
        kind: 'record',
        label: record.name,
        preview: `${record.size} bytes at ${record.offset}`,
      })),
    })
    return {
      summary: {
        format: 'wmf',
        width: info.width,
        height: info.height,
        unitsPerInch: info.unitsPerInch,
        version: info.version,
        records: info.records.length,
        objects: info.objects,
        shapes: info.shapes.length,
      },
      metadata: [
        {
          id: 'wmf-header',
          label: 'WMF headers',
          entries: [
            {
              key: 'bounds',
              value: `${info.bounds.left},${info.bounds.top}–${info.bounds.right},${info.bounds.bottom}`,
            },
            { key: 'unitsPerInch', value: info.unitsPerInch },
            { key: 'fileType', value: info.fileType },
            { key: 'version', value: `0x${info.version.toString(16)}` },
            { key: 'records', value: info.records.length },
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
      maxDecodedBytes: document.length,
      unsupportedFeatures: [
        'all-gdi-records-except-rectangle-and-eof',
        'fonts-bitmaps-paths-transforms-and-clipping',
        'non-placeable-wmf',
        'editing-and-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
