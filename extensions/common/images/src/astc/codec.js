// Hand-ported from the MK2 ASTC codec. This dependency-free MK3 slice validates the standalone
// container and block layout; it does not claim decoded pixels without an ASTC decoder.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/astc'
const HEADER_BYTES = 16
const BLOCK_BYTES = 16
const MAGIC = Object.freeze([0x13, 0xab, 0xa1, 0x5c])
const TWO_DIMENSIONAL_BLOCKS = new Set([
  '4x4',
  '5x4',
  '5x5',
  '6x5',
  '6x6',
  '8x5',
  '8x6',
  '8x8',
  '10x5',
  '10x6',
  '10x8',
  '10x10',
  '12x10',
  '12x12',
])

function hasMagic(bytes) {
  return MAGIC.every((value, index) => bytes[index] === value)
}

function u24le(bytes, offset) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

function parseHeader(bytes, requirePayload) {
  if (bytes.byteLength < HEADER_BYTES || !hasMagic(bytes)) {
    throw new TypeError('ASTC header is missing or truncated')
  }
  const info = {
    blockWidth: bytes[4] ?? 0,
    blockHeight: bytes[5] ?? 0,
    blockDepth: bytes[6] ?? 0,
    width: u24le(bytes, 7),
    height: u24le(bytes, 10),
    depth: u24le(bytes, 13),
  }
  if (Object.values(info).some(value => value <= 0)) {
    throw new TypeError('ASTC dimensions and block dimensions must be positive')
  }
  if (
    info.blockDepth === 1 &&
    info.depth === 1 &&
    !TWO_DIMENSIONAL_BLOCKS.has(`${info.blockWidth}x${info.blockHeight}`)
  ) {
    throw new TypeError('ASTC two-dimensional block dimensions are invalid')
  }
  const blockColumns = Math.ceil(info.width / info.blockWidth)
  const blockRows = Math.ceil(info.height / info.blockHeight)
  const blockSlices = Math.ceil(info.depth / info.blockDepth)
  const blocks = blockColumns * blockRows * blockSlices
  const payloadBytes = blocks * BLOCK_BYTES
  const requiredBytes = HEADER_BYTES + payloadBytes
  if (!Number.isSafeInteger(requiredBytes)) throw new RangeError('ASTC payload size is unsafe')
  if (requirePayload && bytes.byteLength < requiredBytes)
    throw new TypeError('ASTC payload is truncated')
  return Object.freeze({
    ...info,
    blockColumns,
    blockRows,
    blockSlices,
    blocks,
    payloadBytes,
    requiredBytes,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'astc', label: 'ASTC Texture', mediaType: 'image/astc' }),
  async detect(prefix) {
    if (!hasMagic(prefix)) return { confidence: 0, kind: 'magic', note: 'astc-magic-mismatch' }
    try {
      parseHeader(prefix, false)
      return { confidence: 0.99, kind: 'magic', note: 'astc-header' }
    } catch {
      return { confidence: 0.4, kind: 'magic', note: 'astc-header-invalid' }
    }
  },
  async inspect(bytes) {
    const info = parseHeader(bytes, true)
    const profile = info.depth === 1 ? '2D' : '3D'
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'ASTC',
      preview: `${info.width} × ${info.height} × ${info.depth}, ${info.blockWidth}×${info.blockHeight}×${info.blockDepth}`,
      children: [
        {
          kind: 'header',
          label: 'Header',
          preview: `${HEADER_BYTES} bytes`,
          children: [
            { kind: 'field', label: 'Profile', preview: profile },
            {
              kind: 'field',
              label: 'Dimensions',
              preview: `${info.width} × ${info.height} × ${info.depth}`,
            },
            {
              kind: 'field',
              label: 'Block',
              preview: `${info.blockWidth} × ${info.blockHeight} × ${info.blockDepth}`,
            },
          ],
        },
        {
          kind: 'payload',
          label: 'Compressed blocks',
          preview: `${info.blocks} blocks, ${info.payloadBytes} bytes`,
        },
      ],
    })
    return {
      summary: {
        format: 'astc',
        width: info.width,
        height: info.height,
        depth: info.depth,
        blockWidth: info.blockWidth,
        blockHeight: info.blockHeight,
        blockDepth: info.blockDepth,
        blocks: info.blocks,
        payloadBytes: info.payloadBytes,
      },
      metadata: [
        {
          id: 'astc-texture',
          label: 'ASTC texture',
          entries: [
            { key: 'profile', value: profile },
            { key: 'width', value: info.width },
            { key: 'height', value: info.height },
            { key: 'depth', value: info.depth },
            { key: 'blockWidth', value: info.blockWidth },
            { key: 'blockHeight', value: info.blockHeight },
            { key: 'blockDepth', value: info.blockDepth },
            { key: 'blocks', value: info.blocks },
            { key: 'payloadBytes', value: info.payloadBytes },
            { key: 'trailingBytes', value: bytes.byteLength - info.requiredBytes },
          ],
        },
      ],
      traits: [
        {
          id: 'image.compressed-blocks',
          parameters: {
            format: 'astc',
            blockWidth: info.blockWidth,
            blockHeight: info.blockHeight,
            blockBytes: BLOCK_BYTES,
          },
        },
        {
          id: 'image.raster',
          parameters: { width: info.width, height: info.height, depth: info.depth, decoded: false },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: { 'common.view/tree-data-source': tree },
      unsupportedFeatures: [
        'rgba-decoding',
        'color-profile-inference',
        'hdr-output',
        'pixel-editing',
        'astc-encoding',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
