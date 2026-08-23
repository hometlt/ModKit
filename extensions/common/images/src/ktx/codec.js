import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ktx'
const IDENTIFIER = Object.freeze([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
])

function matches(bytes) {
  return IDENTIFIER.every((value, index) => bytes[index] === value)
}

function u32(bytes, offset, littleEndian) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('KTX1 field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian)
}

function aligned4(value) {
  return Math.ceil(value / 4) * 4
}

function parseKeyValues(bytes, start, length, littleEndian, maxNodes) {
  const end = start + length
  if (end > bytes.byteLength) throw new TypeError('KTX1 key/value data is truncated')
  const entries = []
  let offset = start
  while (offset < end) {
    if (entries.length >= maxNodes) throw new RangeError('KTX1 metadata exceeds maxNodes budget')
    const size = u32(bytes, offset, littleEndian)
    offset += 4
    if (size === 0 || offset + size > end) throw new TypeError('KTX1 key/value entry is malformed')
    const data = bytes.subarray(offset, offset + size)
    const separator = data.indexOf(0)
    if (separator < 1) throw new TypeError('KTX1 key/value entry has no key terminator')
    entries.push(
      Object.freeze({
        key: new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, separator)),
        value: new TextDecoder('utf-8').decode(data.subarray(separator + 1)).replace(/\0+$/u, ''),
      }),
    )
    offset += aligned4(size)
  }
  if (offset !== end) throw new TypeError('KTX1 key/value padding is malformed')
  return Object.freeze(entries)
}

function parseKtx(bytes, maxNodes, maxScalarBytes) {
  if (!matches(bytes) || bytes.byteLength < 64) throw new TypeError('KTX1 header is invalid')
  const endianBytes = [...bytes.subarray(12, 16)]
  const littleEndian = endianBytes.join(',') === '1,2,3,4'
  if (!littleEndian && endianBytes.join(',') !== '4,3,2,1') {
    throw new TypeError('KTX1 endianness marker is invalid')
  }
  const glType = u32(bytes, 16, littleEndian)
  const glTypeSize = u32(bytes, 20, littleEndian)
  const glFormat = u32(bytes, 24, littleEndian)
  const glInternalFormat = u32(bytes, 28, littleEndian)
  const glBaseInternalFormat = u32(bytes, 32, littleEndian)
  const width = u32(bytes, 36, littleEndian)
  const storedHeight = u32(bytes, 40, littleEndian)
  const storedDepth = u32(bytes, 44, littleEndian)
  const arrayElements = u32(bytes, 48, littleEndian)
  const faces = u32(bytes, 52, littleEndian)
  const declaredMipLevels = u32(bytes, 56, littleEndian)
  const keyValueBytes = u32(bytes, 60, littleEndian)
  const height = Math.max(1, storedHeight)
  const depth = Math.max(1, storedDepth)
  const mipLevels = Math.max(1, declaredMipLevels)
  if (
    width === 0 ||
    ![1, 6].includes(faces) ||
    mipLevels > maxNodes ||
    glTypeSize === 0 ||
    ![1, 2, 4].includes(glTypeSize)
  ) {
    throw new TypeError('KTX1 dimensions, faces, levels, or scalar size are invalid')
  }
  const keyValues = parseKeyValues(bytes, 64, keyValueBytes, littleEndian, maxNodes)
  let offset = 64 + keyValueBytes
  const levels = []
  for (let level = 0; level < mipLevels; level += 1) {
    if (offset + 4 > bytes.byteLength) throw new TypeError('KTX1 mip header is truncated')
    const imageBytes = u32(bytes, offset, littleEndian)
    offset += 4
    if (imageBytes === 0) throw new TypeError('KTX1 mip image size is zero')
    const levelDepth = storedDepth === 0 ? 1 : Math.max(1, storedDepth >>> level)
    const images = Math.max(1, arrayElements) * faces * levelDepth
    const firstOffset = offset
    for (let image = 0; image < images; image += 1) {
      if (offset + imageBytes > bytes.byteLength)
        throw new TypeError('KTX1 mip payload is truncated')
      offset += aligned4(imageBytes)
    }
    levels.push(
      Object.freeze({
        level,
        width: Math.max(1, width >>> level),
        height: Math.max(1, height >>> level),
        depth: levelDepth,
        images,
        imageBytes,
        firstOffset,
      }),
    )
  }
  if (offset !== bytes.byteLength) throw new TypeError('KTX1 has trailing or malformed mip data')
  const channels = glFormat === 0x1908 ? 4 : glFormat === 0x1907 ? 3 : 0
  const first = levels[0]
  const rowBytes = aligned4(width * channels)
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const decodedAccess =
    littleEndian &&
    storedHeight > 0 &&
    storedDepth === 0 &&
    arrayElements === 0 &&
    faces === 1 &&
    glType === 0x1401 &&
    glTypeSize === 1 &&
    channels > 0 &&
    first.imageBytes >= rowBytes * height &&
    decodedBytes <= BigInt(maxScalarBytes)
  const orientation = keyValues.find(entry => entry.key === 'KTXorientation')?.value
  return Object.freeze({
    littleEndian,
    glType,
    glTypeSize,
    glFormat,
    glInternalFormat,
    glBaseInternalFormat,
    width,
    height,
    depth,
    arrayElements,
    faces,
    mipLevels,
    keyValues,
    levels: Object.freeze(levels),
    channels,
    rowBytes,
    decodedBytes,
    decodedAccess,
    orientation,
  })
}

function regionReader(bytes, ktx) {
  const first = ktx.levels[0]
  const topDown = ktx.orientation?.includes('T=d') === true
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('KTX1 region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('KTX1 decoded access currently exposes only the first 2D image as rgba8')
    }
    if (request.x + request.width > ktx.width || request.y + request.height > ktx.height) {
      throw new RangeError('KTX1 region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('KTX1 region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const logicalY = request.y + row
      const sourceY = topDown ? logicalY : ktx.height - 1 - logicalY
      for (let column = 0; column < request.width; column += 1) {
        const source =
          first.firstOffset + sourceY * ktx.rowBytes + (request.x + column) * ktx.channels
        const target = (row * request.width + column) * 4
        pixels[target] = bytes[source] ?? 0
        pixels[target + 1] = bytes[source + 1] ?? 0
        pixels[target + 2] = bytes[source + 2] ?? 0
        pixels[target + 3] = ktx.channels === 4 ? (bytes[source + 3] ?? 255) : 255
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
  format: Object.freeze({ id: 'ktx', label: 'Khronos Texture v1', mediaType: 'image/ktx' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'ktx1-identifier' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const ktx = parseKtx(bytes, context.budget.maxNodes, context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/ktx',
      {
        width: ktx.width,
        height: ktx.height,
        depth: ktx.depth,
        layers: Math.max(1, ktx.arrayElements),
        faces: ktx.faces,
        mipLevels: ktx.mipLevels,
        frames: 1,
        channels: ktx.channels || 4,
        bitDepth: ktx.glTypeSize * 8,
        colorSpace: 'unknown',
        alphaMode: ktx.channels === 4 ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: ktx.decodedAccess,
      },
      ktx.decodedAccess ? regionReader(bytes, ktx) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'KTX1',
      preview: `${ktx.width} × ${ktx.height}, ${ktx.mipLevels} mip level(s)`,
      children: [
        ...ktx.levels.map(level => ({
          kind: 'image',
          label: `Mip ${level.level}`,
          preview: `${level.width} × ${level.height}, ${level.images} image(s), ${level.imageBytes} bytes each`,
        })),
        ...ktx.keyValues.map(entry => ({
          kind: 'field',
          label: entry.key,
          preview: entry.value,
        })),
      ],
    })
    return {
      summary: {
        format: 'ktx',
        width: ktx.width,
        height: ktx.height,
        depth: ktx.depth,
        layers: Math.max(1, ktx.arrayElements),
        faces: ktx.faces,
        mipLevels: ktx.mipLevels,
        glInternalFormat: ktx.glInternalFormat,
      },
      metadata: [
        {
          id: 'ktx1-texture',
          label: 'KTX1 texture',
          entries: [
            { key: 'width', value: ktx.width },
            { key: 'height', value: ktx.height },
            { key: 'depth', value: ktx.depth },
            { key: 'arrayElements', value: ktx.arrayElements },
            { key: 'faces', value: ktx.faces },
            { key: 'mipLevels', value: ktx.mipLevels },
            { key: 'glType', value: ktx.glType },
            { key: 'glFormat', value: ktx.glFormat },
            { key: 'glInternalFormat', value: ktx.glInternalFormat },
            { key: 'glBaseInternalFormat', value: ktx.glBaseInternalFormat },
            { key: 'keyValues', value: ktx.keyValues.length },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: ktx.width, height: ktx.height, bitDepth: ktx.glTypeSize * 8 },
        },
        {
          id: 'image.channels',
          parameters: { count: ktx.channels || 4, alpha: ktx.channels === 4 },
        },
        ...(ktx.mipLevels > 1
          ? [{ id: 'image.mipmaps', parameters: { levels: ktx.mipLevels } }]
          : []),
        ...(ktx.glType === 0
          ? [{ id: 'image.compressed-blocks', parameters: { format: ktx.glInternalFormat } }]
          : []),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(ktx.decodedAccess ? { maxDecodedBytes: ktx.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(ktx.decodedAccess ? [] : ['decoded-region-provider']),
        'decoded-mip-levels-after-zero',
        'decoded-array-layers',
        'decoded-cubemap-faces',
        'ktx1-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
