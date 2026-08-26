// Hand-ported container plus a dependency-free 2D LDR decode subset written from Khronos Data
// Format Specification chapter 23. Five fixture-pinned ordinary single-partition block modes
// (including trits/quints and dual-plane weights) are decoded by ./ldr.js; every unverified mode,
// multi-partition, HDR and 3D stay named.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

import { decodeAstcLdr2d } from './ldr.js'

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

function regionReader(decoded, info) {
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
      throw new RangeError('ASTC LDR decoder exposes only the first 2D image as rgba8')
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
      const source = ((request.y + row) * info.width + request.x) * 4
      pixels.set(decoded.subarray(source, source + request.width * 4), row * request.width * 4)
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
    const decodedBytes = BigInt(info.width) * BigInt(info.height) * 4n
    const decoded = decodeAstcLdr2d(bytes, info, context.signal, context.budget.maxScalarBytes)
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
      decoded.decodedAccess ? regionReader(decoded.pixels, info) : undefined,
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
            ...(decoded.mode === undefined
              ? []
              : [{ key: 'firstUnsupportedBlockMode', value: `0x${decoded.mode.toString(16)}` }]),
            ...(decoded.modes === undefined
              ? []
              : [
                  {
                    key: 'decodedBlockModes',
                    value: decoded.modes.map(mode => `0x${mode.toString(16)}`),
                  },
                ]),
            ...(decoded.endpointModes === undefined
              ? []
              : [{ key: 'decodedEndpointModes', value: decoded.endpointModes }]),
            ...(decoded.endpointRanges === undefined
              ? []
              : [{ key: 'decodedEndpointRanges', value: decoded.endpointRanges }]),
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
        'unverified-block-mode-decoding',
        'multi-partition-block-decoding',
        'hdr-void-extent-decoding',
        'hdr-endpoint-decoding',
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
