import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/pvr'

function endianOf(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x56 && bytes[2] === 0x52 && bytes[3] === 0x03) {
    return true
  }
  if (bytes[0] === 0x03 && bytes[1] === 0x52 && bytes[2] === 0x56 && bytes[3] === 0x50) {
    return false
  }
  return undefined
}

function u32(bytes, offset, littleEndian) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('PVR field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian)
}

function parseMetadata(bytes, start, length, littleEndian, maxNodes) {
  const end = start + length
  if (end > bytes.byteLength) throw new TypeError('PVR metadata is truncated')
  const entries = []
  let offset = start
  while (offset < end) {
    if (entries.length >= maxNodes) throw new RangeError('PVR metadata exceeds maxNodes budget')
    if (offset + 12 > end) throw new TypeError('PVR metadata record header is truncated')
    const fourCc = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    )
    const key = u32(bytes, offset + 4, littleEndian)
    const dataBytes = u32(bytes, offset + 8, littleEndian)
    offset += 12
    if (offset + dataBytes > end) throw new TypeError('PVR metadata record payload is truncated')
    entries.push(Object.freeze({ fourCc, key, dataBytes }))
    offset += dataBytes
  }
  return Object.freeze(entries)
}

function parsePvr(bytes, maxNodes, maxScalarBytes) {
  const littleEndian = endianOf(bytes)
  if (littleEndian === undefined || bytes.byteLength < 52)
    throw new TypeError('PVR v3 header is invalid')
  const flags = u32(bytes, 4, littleEndian)
  const formatLow = u32(bytes, 8, littleEndian)
  const formatHigh = u32(bytes, 12, littleEndian)
  const colorSpace = u32(bytes, 16, littleEndian)
  const channelType = u32(bytes, 20, littleEndian)
  const height = u32(bytes, 24, littleEndian)
  const width = u32(bytes, 28, littleEndian)
  const depth = u32(bytes, 32, littleEndian)
  const surfaces = u32(bytes, 36, littleEndian)
  const faces = u32(bytes, 40, littleEndian)
  const mipLevels = u32(bytes, 44, littleEndian)
  const metadataBytes = u32(bytes, 48, littleEndian)
  if (
    width === 0 ||
    height === 0 ||
    depth === 0 ||
    surfaces === 0 ||
    faces === 0 ||
    mipLevels === 0 ||
    mipLevels > maxNodes
  ) {
    throw new TypeError('PVR dimensions, surfaces, faces, or mip levels are invalid')
  }
  const metadata = parseMetadata(bytes, 52, metadataBytes, littleEndian, maxNodes)
  const dataOffset = 52 + metadataBytes
  if (dataOffset >= bytes.byteLength) throw new TypeError('PVR texture payload is missing')
  const compressed = formatHigh === 0
  const channelOrder = compressed
    ? undefined
    : String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0).replace(
        /\0+$/u,
        '',
      )
  const channelBits = compressed ? [] : [...bytes.subarray(12, 16)].filter(value => value > 0)
  const bitsPerPixel = channelBits.reduce((sum, value) => sum + value, 0)
  const bytesPerPixel = bitsPerPixel / 8
  const levels = []
  let offset = dataOffset
  if (!compressed) {
    if (
      channelOrder === undefined ||
      channelOrder.length === 0 ||
      channelBits.length !== channelOrder.length ||
      bitsPerPixel === 0 ||
      bitsPerPixel % 8 !== 0
    ) {
      throw new TypeError('PVR custom pixel format is invalid')
    }
    for (let level = 0; level < mipLevels; level += 1) {
      const levelWidth = Math.max(1, width >>> level)
      const levelHeight = Math.max(1, height >>> level)
      const levelDepth = Math.max(1, depth >>> level)
      const imageBytesBig =
        BigInt(levelWidth) * BigInt(levelHeight) * BigInt(levelDepth) * BigInt(bytesPerPixel)
      const levelBytesBig = imageBytesBig * BigInt(surfaces) * BigInt(faces)
      if (levelBytesBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError('PVR mip payload size is unsafe')
      }
      const levelBytes = Number(levelBytesBig)
      if (offset + levelBytes > bytes.byteLength)
        throw new TypeError('PVR mip payload is truncated')
      levels.push(
        Object.freeze({
          level,
          width: levelWidth,
          height: levelHeight,
          depth: levelDepth,
          offset,
          imageBytes: Number(imageBytesBig),
          levelBytes,
        }),
      )
      offset += levelBytes
    }
    if (offset !== bytes.byteLength)
      throw new TypeError('PVR has trailing custom-format payload bytes')
  } else {
    levels.push(
      Object.freeze({
        level: 0,
        width,
        height,
        depth,
        offset: dataOffset,
        imageBytes: bytes.byteLength - dataOffset,
        levelBytes: bytes.byteLength - dataOffset,
      }),
    )
  }
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const decodedAccess =
    littleEndian &&
    !compressed &&
    ['rgba', 'bgra'].includes(channelOrder) &&
    channelBits.length === 4 &&
    channelBits.every(value => value === 8) &&
    channelType === 0 &&
    depth === 1 &&
    surfaces === 1 &&
    faces === 1 &&
    decodedBytes <= BigInt(maxScalarBytes)
  return Object.freeze({
    littleEndian,
    flags,
    formatLow,
    formatHigh,
    compressed,
    channelOrder,
    channelBits: Object.freeze(channelBits),
    bytesPerPixel,
    colorSpace,
    channelType,
    width,
    height,
    depth,
    surfaces,
    faces,
    mipLevels,
    metadata,
    dataOffset,
    levels: Object.freeze(levels),
    decodedBytes,
    decodedAccess,
  })
}

function regionReader(bytes, pvr) {
  const first = pvr.levels[0]
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PVR region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PVR decoded access currently exposes only the first 2D image as rgba8')
    }
    if (request.x + request.width > pvr.width || request.y + request.height > pvr.height) {
      throw new RangeError('PVR region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PVR region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(outputBytes)
    const bgra = pvr.channelOrder === 'bgra'
    for (let row = 0; row < request.height; row += 1) {
      for (let column = 0; column < request.width; column += 1) {
        const source = first.offset + ((request.y + row) * pvr.width + request.x + column) * 4
        const target = (row * request.width + column) * 4
        pixels[target] = bytes[source + (bgra ? 2 : 0)] ?? 0
        pixels[target + 1] = bytes[source + 1] ?? 0
        pixels[target + 2] = bytes[source + (bgra ? 0 : 2)] ?? 0
        pixels[target + 3] = bytes[source + 3] ?? 255
      }
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels,
    })
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'pvr',
    label: 'PowerVR Texture Container',
    mediaType: 'image/x-pvr',
  }),
  async detect(prefix) {
    return endianOf(prefix) === undefined
      ? { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
      : { confidence: 0.99, kind: 'magic', note: 'pvr3-signature' }
  },
  async inspect(bytes, context) {
    const pvr = parsePvr(bytes, context.budget.maxNodes, context.budget.maxScalarBytes)
    const format = pvr.compressed
      ? `compressed-${pvr.formatLow}`
      : `${pvr.channelOrder}${pvr.channelBits.join('')}`
    const raster = createRasterImageSource(
      bytes,
      'image/x-pvr',
      {
        width: pvr.width,
        height: pvr.height,
        depth: pvr.depth,
        layers: pvr.surfaces,
        faces: pvr.faces,
        mipLevels: pvr.mipLevels,
        frames: 1,
        channels: pvr.channelBits.length || 4,
        bitDepth: pvr.channelBits[0] ?? 8,
        colorSpace: pvr.colorSpace === 1 ? 'srgb' : 'linear',
        alphaMode: pvr.channelOrder?.includes('a') === true ? 'straight' : 'unknown',
        orientation: 'top-left',
        decodedAccess: pvr.decodedAccess,
      },
      pvr.decodedAccess ? regionReader(bytes, pvr) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'PVR v3',
      preview: `${pvr.width} × ${pvr.height}, ${format}, ${pvr.mipLevels} mip level(s)`,
      children: [
        ...pvr.levels.map(level => ({
          kind: 'image',
          label: `Mip ${level.level}`,
          preview: `${level.width} × ${level.height} × ${level.depth}, ${level.levelBytes} bytes`,
        })),
        ...pvr.metadata.map((entry, index) => ({
          kind: 'chunk',
          label: `Metadata ${index}: ${entry.fourCc}/${entry.key}`,
          preview: `${entry.dataBytes} bytes`,
        })),
      ],
    })
    return {
      summary: {
        format: 'pvr',
        width: pvr.width,
        height: pvr.height,
        depth: pvr.depth,
        surfaces: pvr.surfaces,
        faces: pvr.faces,
        mipLevels: pvr.mipLevels,
        encoding: format,
      },
      metadata: [
        {
          id: 'pvr3-texture',
          label: 'PVR v3 texture',
          entries: [
            { key: 'width', value: pvr.width },
            { key: 'height', value: pvr.height },
            { key: 'depth', value: pvr.depth },
            { key: 'surfaces', value: pvr.surfaces },
            { key: 'faces', value: pvr.faces },
            { key: 'mipLevels', value: pvr.mipLevels },
            { key: 'encoding', value: format },
            { key: 'colorSpace', value: pvr.colorSpace },
            { key: 'channelType', value: pvr.channelType },
            { key: 'metadataRecords', value: pvr.metadata.length },
            { key: 'flags', value: pvr.flags },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: pvr.width, height: pvr.height, bitDepth: pvr.channelBits[0] ?? 8 },
        },
        ...(pvr.mipLevels > 1
          ? [{ id: 'image.mipmaps', parameters: { levels: pvr.mipLevels } }]
          : []),
        ...(pvr.compressed
          ? [{ id: 'image.compressed-blocks', parameters: { format: pvr.formatLow } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(pvr.decodedAccess ? { maxDecodedBytes: pvr.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(pvr.decodedAccess ? [] : ['decoded-region-provider']),
        'compressed-block-software-decoding',
        'decoded-mip-levels-after-zero',
        'decoded-surfaces-and-faces',
        'pvr-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
