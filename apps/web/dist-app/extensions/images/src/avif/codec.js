// Hand-ported from the MK2 AVIF codec. The MK3 port intentionally exposes BMFF structure and
// image properties only: AV1 pixel decoding belongs to a decoder provider and is not fabricated.

import { createInspectionCodec, createTreeDataSource } from '@modkit/codec-kit'

const ID = 'modkit/avif'
const AVIF_BRANDS = new Set(['avif', 'avis'])
const CONTAINER_BOXES = new Set(['meta', 'iprp', 'ipco', 'trak', 'mdia', 'minf', 'stbl', 'moov'])
const latin1 = new TextDecoder('latin1')

const ascii = (bytes, start, end) => latin1.decode(bytes.subarray(start, end))

function u32be(bytes, offset) {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  )
}

function u64be(bytes, offset) {
  return (BigInt(u32be(bytes, offset)) << 32n) | BigInt(u32be(bytes, offset + 4))
}

function avifBrands(bytes) {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 8) !== 'ftyp') return []
  const declared = u32be(bytes, 0)
  const end = Math.min(declared === 0 ? bytes.byteLength : declared, bytes.byteLength)
  if (end < 16) return []
  const brands = [ascii(bytes, 8, 12)]
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    brands.push(ascii(bytes, offset, offset + 4))
  }
  return [...new Set(brands.filter(brand => brand.length === 4))]
}

function isAvif(bytes) {
  return avifBrands(bytes).some(brand => AVIF_BRANDS.has(brand))
}

function readBoxes(bytes, start, end, context, depth, state) {
  if (depth > context.budget.maxDepth) throw new RangeError('AVIF box depth exceeds maxDepth')
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    let size = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, offset + 8)
    let headerBytes = 8
    if (size === 1) {
      if (offset + 16 > end) throw new TypeError(`AVIF ${type} extended header is truncated`)
      const extended = u64be(bytes, offset + 8)
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`AVIF ${type} box size is not a safe integer`)
      }
      size = Number(extended)
      headerBytes = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerBytes || offset + size > end) {
      throw new TypeError(`AVIF ${type} box is truncated or has an invalid size`)
    }
    state.nodes += 1
    if (state.nodes > context.budget.maxNodes) throw new RangeError('AVIF boxes exceed maxNodes')
    const payloadOffset = offset + headerBytes
    const boxEnd = offset + size
    const children = CONTAINER_BOXES.has(type)
      ? readBoxes(
          bytes,
          type === 'meta' ? payloadOffset + 4 : payloadOffset,
          boxEnd,
          context,
          depth + 1,
          state,
        )
      : []
    if (type === 'ispe' && payloadOffset + 12 <= boxEnd) {
      state.width = u32be(bytes, payloadOffset + 4)
      state.height = u32be(bytes, payloadOffset + 8)
    } else if (type === 'pixi' && payloadOffset + 5 <= boxEnd) {
      const channels = bytes[payloadOffset + 4] ?? 0
      if (payloadOffset + 5 + channels > boxEnd) throw new TypeError('AVIF pixi box is truncated')
      state.depths = Array.from(bytes.subarray(payloadOffset + 5, payloadOffset + 5 + channels))
    }
    boxes.push(
      Object.freeze({
        type,
        offset,
        size,
        children: Object.freeze(children),
      }),
    )
    offset = boxEnd
  }
  if (offset !== end) throw new TypeError('AVIF box stream carries trailing partial header bytes')
  return boxes
}

function parseAvif(bytes, context) {
  if (!isAvif(bytes)) throw new TypeError('AVIF ftyp brands are missing')
  const state = { nodes: 0, width: 0, height: 0, depths: [] }
  const boxes = readBoxes(bytes, 0, bytes.byteLength, context, 1, state)
  if (boxes[0]?.type !== 'ftyp') throw new TypeError('AVIF must start with an ftyp box')
  return Object.freeze({
    brands: Object.freeze(avifBrands(bytes)),
    boxes: Object.freeze(boxes),
    nodes: state.nodes,
    width: state.width,
    height: state.height,
    depths: Object.freeze(state.depths),
  })
}

function boxTree(box) {
  return {
    kind: 'box',
    label: box.type,
    preview: `${box.size} bytes at ${box.offset}`,
    children: box.children.map(boxTree),
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'avif', label: 'AV1 Image File Format', mediaType: 'image/avif' }),
  async detect(prefix) {
    return isAvif(prefix)
      ? { confidence: 0.97, kind: 'structure', note: 'iso-bmff-avif-brand' }
      : { confidence: 0, kind: 'structure', note: 'avif-brand-mismatch' }
  },
  async inspect(bytes, context) {
    const info = parseAvif(bytes, context)
    const sequence = info.brands.includes('avis')
    const channels = info.depths.length
    const bitDepth = info.depths[0] ?? 0
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'AVIF',
      preview:
        info.width > 0 && info.height > 0
          ? `${info.width} × ${info.height}, ${info.brands.join(', ')}`
          : info.brands.join(', '),
      children: info.boxes.map(boxTree),
    })
    return {
      summary: {
        format: 'avif',
        brands: info.brands,
        width: info.width,
        height: info.height,
        channels,
        bitDepth,
        sequence,
        boxes: info.nodes,
      },
      metadata: [
        {
          id: 'avif-image',
          label: 'AVIF image',
          entries: [
            { key: 'brands', value: info.brands.join(', ') },
            { key: 'width', value: info.width },
            { key: 'height', value: info.height },
            { key: 'channels', value: channels },
            { key: 'bitDepth', value: bitDepth },
            { key: 'sequence', value: sequence },
            { key: 'boxes', value: info.nodes },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: {
            width: info.width,
            height: info.height,
            bitDepth: bitDepth || 'unknown',
            decoded: false,
          },
        },
        { id: 'image.channels', parameters: { count: channels || 'unknown', alpha: 'unknown' } },
        ...(sequence ? [{ id: 'image.frames', parameters: { count: 'unknown' } }] : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: { 'common.view/tree-data-source': tree },
      unsupportedFeatures: [
        'av1-pixel-decoding',
        'item-property-association',
        'animated-frame-timing',
        'pixel-editing',
        'avif-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
