import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

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
    const raster = createRasterImageSource(bytes, 'image/ktx2', {
      width: ktx.width,
      height: ktx.height,
      depth: ktx.depth,
      layers: Math.max(1, ktx.layerCount),
      faces: ktx.faceCount,
      mipLevels: ktx.levelCount,
      frames: 1,
      channels: 4,
      bitDepth: ktx.typeSize * 8,
      colorSpace: 'unknown',
      alphaMode: 'unknown',
      orientation: 'top-left',
      decodedAccess: false,
    })
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
        'decoded-region-provider',
        'basis-transcoding',
        'supercompression-decoding',
        'ktx2-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
