// Hand-ported from the MK2 ASTC codec. This dependency-free MK3 slice validates the standalone
// container and decodes only the mandatory 2D LDR void-extent constant-colour block mode. All
// other ASTC block modes remain compressed-only instead of being approximated.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

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

/**
 * Khronos Data Format Specification 1.4, sections 23.9.3 and 23.22:
 * bits 8..0 are 111111100 for a void-extent block; bit 9 selects LDR/HDR; bits 10 and 11 are
 * reserved and must be one. The first 64 bits are little-endian block configuration, so checking
 * the low 16-bit word is sufficient to classify this deliberately bounded decoder path.
 */
function classifyBlock(bytes, offset) {
  const low = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
  if ((low & 0x1ff) !== 0x1fc) return 'other-block-mode'
  if ((low & 0xc00) !== 0xc00) return 'illegal-void-extent'
  return (low & 0x200) === 0 ? 'ldr-void-extent' : 'hdr-void-extent'
}

function decodedSubset(bytes, info, signal) {
  if (info.depth !== 1 || info.blockDepth !== 1) {
    return Object.freeze({ decodedAccess: false, unsupported: 'three-dimensional-blocks' })
  }
  for (let index = 0; index < info.blocks; index += 1) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const classification = classifyBlock(bytes, HEADER_BYTES + index * BLOCK_BYTES)
    if (classification !== 'ldr-void-extent') {
      return Object.freeze({ decodedAccess: false, unsupported: classification, index })
    }
  }
  return Object.freeze({ decodedAccess: true, subset: '2d-ldr-void-extent' })
}

function regionReader(bytes, info) {
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('ASTC region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('ASTC void-extent decoder exposes only the first 2D image as rgba8')
    }
    if (request.x + request.width > info.width || request.y + request.height > info.height) {
      throw new RangeError('ASTC region is outside the image')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('ASTC region exceeds maxBytes budget')
    }

    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const sourceY = request.y + row
      for (let column = 0; column < request.width; column += 1) {
        const sourceX = request.x + column
        const blockX = Math.floor(sourceX / info.blockWidth)
        const blockY = Math.floor(sourceY / info.blockHeight)
        const block = HEADER_BYTES + (blockY * info.blockColumns + blockX) * BLOCK_BYTES
        const target = (row * request.width + column) * 4
        // LDR void-extent components are little-endian UNORM16. decode_unorm8 takes the top byte.
        pixels[target] = bytes[block + 9]
        pixels[target + 1] = bytes[block + 11]
        pixels[target + 2] = bytes[block + 13]
        pixels[target + 3] = bytes[block + 15]
      }
    }
    return { pixelFormat: 'rgba8', width: request.width, height: request.height, pixels }
  }
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
  async inspect(bytes, context) {
    const info = parseHeader(bytes, true)
    const profile = info.depth === 1 ? '2D' : '3D'
    const decoded = decodedSubset(bytes, info, context.signal)
    const decodedBytes = BigInt(info.width) * BigInt(info.height) * 4n
    if (decoded.decodedAccess && decodedBytes > BigInt(context.budget.maxScalarBytes)) {
      throw new RangeError('ASTC decoded pixels exceed the scalar budget')
    }
    const raster = createRasterImageSource(
      bytes,
      'image/astc',
      {
        width: info.width,
        height: info.height,
        depth: info.depth,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'unknown',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: decoded.decodedAccess,
      },
      decoded.decodedAccess ? regionReader(bytes, info) : undefined,
    )
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
        decodedSubset: decoded.subset ?? 'none',
        decodedAccess: decoded.decodedAccess,
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
            { key: 'decodedSubset', value: decoded.subset ?? 'none' },
            { key: 'decodedAccess', value: decoded.decodedAccess },
            ...(decoded.unsupported === undefined
              ? []
              : [{ key: 'firstUnsupportedBlock', value: decoded.unsupported }]),
            ...(decoded.index === undefined
              ? []
              : [{ key: 'firstUnsupportedBlockIndex', value: decoded.index }]),
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
          parameters: {
            width: info.width,
            height: info.height,
            depth: info.depth,
            decoded: decoded.decodedAccess,
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(decoded.decodedAccess ? { maxDecodedBytes: decodedBytes } : {}),
      unsupportedFeatures: [
        ...(decoded.decodedAccess ? [] : ['rgba-decoding']),
        'non-void-extent-block-decoding',
        'hdr-void-extent-decoding',
        'three-dimensional-astc-decoding',
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
