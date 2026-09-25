import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { decodeZstd } from '@modkit/codec-kit/compression/zstd'
import { decodeBcSurface } from '@modkit/codec-kit/texture/bc'

const ID = 'modkit/ktx2'
const IDENTIFIER = Object.freeze([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
])

function matches(bytes) {
  return IDENTIFIER.every((value, index) => bytes[index] === value)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('KTX2 field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function u64(bytes, offset) {
  if (offset < 0 || offset + 8 > bytes.byteLength) throw new RangeError('KTX2 field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true)
}

function checkedRange(bytes, offset, length, label) {
  if (offset + length > BigInt(bytes.byteLength)) {
    throw new TypeError(`KTX2 ${label} range is outside the source`)
  }
}

function parseKtx2(bytes, maxNodes) {
  if (!matches(bytes) || bytes.byteLength < 80) throw new TypeError('KTX2 header is invalid')
  const vkFormat = u32(bytes, 12)
  const typeSize = u32(bytes, 16)
  const width = u32(bytes, 20)
  const storedHeight = u32(bytes, 24)
  const storedDepth = u32(bytes, 28)
  const layerCount = u32(bytes, 32)
  const faceCount = u32(bytes, 36)
  const levelCount = u32(bytes, 40)
  const supercompression = u32(bytes, 44)
  const dfdOffset = BigInt(u32(bytes, 48))
  const dfdLength = BigInt(u32(bytes, 52))
  const kvdOffset = BigInt(u32(bytes, 56))
  const kvdLength = BigInt(u32(bytes, 60))
  const sgdOffset = u64(bytes, 64)
  const sgdLength = u64(bytes, 72)
  if (
    width === 0 ||
    typeSize === 0 ||
    levelCount === 0 ||
    levelCount > maxNodes ||
    ![1, 6].includes(faceCount)
  ) {
    throw new TypeError('KTX2 dimensions, faces, levels, or type size are invalid')
  }
  const indexEnd = 80 + levelCount * 24
  if (indexEnd > bytes.byteLength) throw new TypeError('KTX2 level index is truncated')
  if (dfdLength > 0n) checkedRange(bytes, dfdOffset, dfdLength, 'data-format descriptor')
  if (kvdLength > 0n) checkedRange(bytes, kvdOffset, kvdLength, 'key/value data')
  if (sgdLength > 0n) checkedRange(bytes, sgdOffset, sgdLength, 'supercompression global data')
  const levels = []
  for (let level = 0; level < levelCount; level += 1) {
    const position = 80 + level * 24
    const offset = u64(bytes, position)
    const length = u64(bytes, position + 8)
    const uncompressedLength = u64(bytes, position + 16)
    if (length === 0n) throw new TypeError(`KTX2 level ${level} is empty`)
    checkedRange(bytes, offset, length, `level ${level}`)
    levels.push(
      Object.freeze({
        level,
        width: Math.max(1, width >>> level),
        height: Math.max(1, Math.max(1, storedHeight) >>> level),
        depth: Math.max(1, Math.max(1, storedDepth) >>> level),
        offset,
        length,
        uncompressedLength,
      }),
    )
  }
  return Object.freeze({
    vkFormat,
    typeSize,
    width,
    height: Math.max(1, storedHeight),
    depth: Math.max(1, storedDepth),
    layerCount,
    faceCount,
    levelCount,
    supercompression,
    dfdOffset,
    dfdLength,
    kvdOffset,
    kvdLength,
    sgdOffset,
    sgdLength,
    levels: Object.freeze(levels),
  })
}

const SUPERCOMPRESSION = Object.freeze({
  0: 'none',
  1: 'BasisLZ',
  2: 'Zstandard',
  3: 'zlib',
})

/**
 * Block formats decoded to rgba8 through `@modkit/codec-kit/texture/bc` (VkFormat → BC kind; odd
 * members of each pair are UNORM, even ones SRGB or SNORM).
 */
const BLOCK_FORMATS = Object.freeze({
  131: { format: 'DXT1', colorSpace: 'linear' },
  132: { format: 'DXT1', colorSpace: 'srgb' },
  133: { format: 'DXT1', colorSpace: 'linear' },
  134: { format: 'DXT1', colorSpace: 'srgb' },
  135: { format: 'DXT3', colorSpace: 'linear' },
  136: { format: 'DXT3', colorSpace: 'srgb' },
  137: { format: 'DXT5', colorSpace: 'linear' },
  138: { format: 'DXT5', colorSpace: 'srgb' },
  139: { format: 'BC4', colorSpace: 'linear' },
  140: { format: 'BC4', colorSpace: 'linear', snorm: true },
  141: { format: 'BC5', colorSpace: 'linear' },
  142: { format: 'BC5', colorSpace: 'linear', snorm: true },
})

/**
 * Pixels are decoded for single 2D images (one layer, one face, depth 1) in a BC format, stored
 * plain or with Zstandard supercompression — what the Roblox asset cache holds. Anything else keeps
 * metadata and encoded payload access only.
 */
function decodable(ktx, maxScalarBytes) {
  const block = BLOCK_FORMATS[ktx.vkFormat]
  return block !== undefined && ktx.depth === 1 && ktx.layerCount <= 1 && ktx.faceCount === 1 &&
    (ktx.supercompression === 0 || ktx.supercompression === 2) &&
    ktx.width * ktx.height * 4 <= maxScalarBytes
    ? block
    : undefined
}

function levelPixels(bytes, ktx, block, level) {
  const blocks = Math.ceil(level.width / 4) * Math.ceil(level.height / 4)
  const expected = blocks * (block.format === 'DXT1' || block.format === 'BC4' ? 8 : 16)
  const stored = bytes.subarray(Number(level.offset), Number(level.offset + level.length))
  const data = ktx.supercompression === 2 ? decodeZstd(stored, { expectedLength: expected, maxOutputBytes: expected }) : stored
  if (data.byteLength < expected) throw new TypeError(`KTX2 level ${level.level} holds ${data.byteLength} of ${expected} block bytes`)
  return decodeBcSurface(data, 0, level.width, level.height, block.format, block.snorm === true)
}

function regionReader(bytes, ktx, block) {
  const decoded = new Map()
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('KTX2 region coordinates and budget must be non-negative safe integers')
    }
    if (request.pixelFormat !== 'rgba8') throw new RangeError('KTX2 decoder exposes pixels as rgba8 only')
    if ((request.frame ?? 0) !== 0 || (request.layer ?? 0) !== 0 || (request.face ?? 0) !== 0 || (request.slice ?? 0) !== 0) {
      throw new RangeError('KTX2 decodes one 2D image; only frame, layer, face and slice 0 exist')
    }
    const level = ktx.levels[request.mipLevel ?? 0]
    if (level === undefined) throw new RangeError(`KTX2 has no mip level ${request.mipLevel}`)
    if (request.x + request.width > level.width || request.y + request.height > level.height) {
      throw new RangeError(`KTX2 region is outside mip ${level.level} (${level.width}x${level.height})`)
    }
    const length = request.width * request.height * 4
    if (length > request.maxBytes) throw new RangeError('KTX2 region exceeds maxBytes budget')
    let surface = decoded.get(level.level)
    if (surface === undefined) {
      surface = levelPixels(bytes, ktx, block, level)
      decoded.set(level.level, surface)
    }
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = ((request.y + row) * level.width + request.x) * 4
      pixels.set(surface.subarray(start, start + request.width * 4), row * request.width * 4)
    }
    return Object.freeze({ width: request.width, height: request.height, rowStride: request.width * 4, pixelFormat: 'rgba8', pixels })
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ktx2', label: 'Khronos Texture v2', mediaType: 'image/ktx2' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'ktx2-identifier' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const ktx = parseKtx2(bytes, context.budget.maxNodes)
    const compression = SUPERCOMPRESSION[ktx.supercompression] ?? `scheme-${ktx.supercompression}`
    const block = decodable(ktx, context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/ktx2',
      {
        width: ktx.width,
        height: ktx.height,
        depth: ktx.depth,
        layers: Math.max(1, ktx.layerCount),
        faces: ktx.faceCount,
        mipLevels: ktx.levelCount,
        frames: 1,
        channels: 4,
        bitDepth: block === undefined ? ktx.typeSize * 8 : 8,
        colorSpace: block?.colorSpace ?? 'unknown',
        alphaMode: block === undefined ? 'unknown' : 'straight',
        orientation: 'top-left',
        decodedAccess: block !== undefined,
      },
      ...(block === undefined ? [] : [regionReader(bytes, ktx, block)]),
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'KTX2',
      preview: `${ktx.width} × ${ktx.height}, ${ktx.levelCount} mip level(s), ${compression}`,
      children: ktx.levels.map(level => ({
        kind: 'image',
        label: `Mip ${level.level}`,
        preview: `${level.width} × ${level.height} × ${level.depth}, ${level.length} stored bytes`,
      })),
    })
    return {
      summary: {
        format: 'ktx2',
        width: ktx.width,
        height: ktx.height,
        depth: ktx.depth,
        layers: Math.max(1, ktx.layerCount),
        faces: ktx.faceCount,
        mipLevels: ktx.levelCount,
        vkFormat: ktx.vkFormat,
        supercompression: compression,
      },
      metadata: [
        {
          id: 'ktx2-texture',
          label: 'KTX2 texture',
          entries: [
            { key: 'width', value: ktx.width },
            { key: 'height', value: ktx.height },
            { key: 'depth', value: ktx.depth },
            { key: 'layers', value: Math.max(1, ktx.layerCount) },
            { key: 'faces', value: ktx.faceCount },
            { key: 'mipLevels', value: ktx.levelCount },
            { key: 'vkFormat', value: ktx.vkFormat },
            { key: 'typeSize', value: ktx.typeSize },
            { key: 'supercompression', value: compression },
            { key: 'dfdBytes', value: String(ktx.dfdLength) },
            { key: 'keyValueBytes', value: String(ktx.kvdLength) },
            { key: 'globalDataBytes', value: String(ktx.sgdLength) },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: ktx.width, height: ktx.height, bitDepth: ktx.typeSize * 8 },
        },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        ...(ktx.levelCount > 1
          ? [{ id: 'image.mipmaps', parameters: { levels: ktx.levelCount } }]
          : []),
        {
          id: 'image.compressed-blocks',
          parameters: { vkFormat: ktx.vkFormat, supercompression: compression },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: [
        ...(block === undefined ? ['decoded-region-provider'] : []),
        'basis-transcoding',
        ...(ktx.supercompression === 1 || ktx.supercompression === 3 ? ['supercompression-decoding'] : []),
        'ktx2-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
