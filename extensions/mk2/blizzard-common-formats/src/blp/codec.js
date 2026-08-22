// Hand-ported from org.modkitx/blp. This dependency-free MK3 profile validates BLP1/BLP2
// headers and mip ranges and exposes decoded access for the source-native BLP2 BGRA layout.

import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/blp'
const BLP1_HEADER_BYTES = 156
const BLP2_HEADER_BYTES = 148
const ascii = new TextDecoder('latin1')

function magic(bytes) {
  return bytes.byteLength < 4 ? '' : ascii.decode(bytes.subarray(0, 4))
}

function encodingLabel(value) {
  return value === 0 ? 'jpeg' : value === 1 ? 'paletted' : value === 2 ? 'dxt/bcn' : value === 3 ? 'bgra8' : `unknown-${value}`
}

function mipTable(data, offsetsAt, sizesAt, bytes) {
  const mips = []
  for (let level = 0; level < 16; level += 1) {
    const offset = data.getUint32(offsetsAt + level * 4, true)
    const size = data.getUint32(sizesAt + level * 4, true)
    if ((offset === 0) !== (size === 0)) throw new TypeError(`BLP mip ${level} has an incomplete range`)
    if (offset === 0) continue
    if (offset + size > bytes.byteLength) throw new RangeError(`BLP mip ${level} is out of bounds`)
    mips.push(Object.freeze({ level, offset, size }))
  }
  return Object.freeze(mips)
}

function parseBlp(bytes, context) {
  const id = magic(bytes)
  const headerBytes = id === 'BLP1' ? BLP1_HEADER_BYTES : id === 'BLP2' ? BLP2_HEADER_BYTES : 0
  if (headerBytes === 0) throw new TypeError('BLP signature is invalid')
  if (bytes.byteLength < headerBytes) throw new RangeError(`${id} header is truncated`)
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = data.getUint32(12, true)
  const height = data.getUint32(16, true)
  if (width === 0 || height === 0) throw new TypeError('BLP dimensions must be positive')
  const decodedBytes = width * height * 4
  if (!Number.isSafeInteger(decodedBytes)) throw new RangeError('BLP dimensions exceed safe integer range')
  const common = {
    id,
    width,
    height,
    decodedBytes,
    type: data.getUint32(4, true),
  }
  if (id === 'BLP1') {
    const alphaDepth = data.getUint32(8, true)
    if (![0, 1, 4, 8].includes(alphaDepth)) throw new TypeError(`unsupported BLP1 alpha depth ${alphaDepth}`)
    return Object.freeze({
      ...common,
      encoding: data.getUint32(4, true) === 0 ? 'jpeg' : data.getUint32(4, true) === 1 ? 'paletted' : `unknown-${data.getUint32(4, true)}`,
      alphaDepth,
      alphaEncoding: data.getUint32(20, true),
      hasMipmaps: data.getUint32(24, true) !== 0,
      mips: mipTable(data, 28, 92, bytes),
      decodedAccess: false,
    })
  }
  const encodingId = bytes[8] ?? 0
  const alphaDepth = bytes[9] ?? 0
  if (![0, 1, 4, 8].includes(alphaDepth)) throw new TypeError(`unsupported BLP2 alpha depth ${alphaDepth}`)
  const mips = mipTable(data, 20, 84, bytes)
  const decodedAccess = encodingId === 3
  if (decodedAccess) {
    const top = mips.find(mip => mip.level === 0)
    if (top === undefined) throw new TypeError('BLP2 BGRA top mip is missing')
    if (top.size < decodedBytes) throw new RangeError('BLP2 BGRA top mip is truncated')
    if (decodedBytes > context.budget.maxScalarBytes) throw new RangeError('BLP2 decoded image exceeds maxScalarBytes budget')
  }
  return Object.freeze({
    ...common,
    encoding: encodingLabel(encodingId),
    encodingId,
    alphaDepth,
    alphaEncoding: bytes[10] ?? 0,
    hasMipmaps: (bytes[11] ?? 0) !== 0,
    mips,
    decodedAccess,
  })
}

function regionReader(bytes, texture) {
  const top = texture.mips.find(mip => mip.level === 0)
  if (top === undefined) throw new TypeError('BLP2 BGRA top mip is missing')
  return async request => {
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('BLP region coordinates must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('BLP exposes only mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > texture.width || request.y + request.height > texture.height) {
      throw new RangeError('BLP region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('BLP region exceeds maxBytes')
    }
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      for (let column = 0; column < request.width; column += 1) {
        const source = top.offset + ((request.y + row) * texture.width + request.x + column) * 4
        const target = (row * request.width + column) * 4
        pixels[target] = bytes[source + 2] ?? 0
        pixels[target + 1] = bytes[source + 1] ?? 0
        pixels[target + 2] = bytes[source] ?? 0
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
  format: Object.freeze({ id: 'blp', label: 'Blizzard BLP texture', mediaType: 'image/x-blp' }),
  async detect(prefix) {
    const id = magic(prefix)
    return id === 'BLP1' || id === 'BLP2'
      ? { confidence: 0.99, kind: 'magic', note: id.toLowerCase() }
      : { confidence: 0, kind: 'magic', note: 'blp-signature-mismatch' }
  },
  async inspect(bytes, context) {
    const texture = parseBlp(bytes, context)
    const raster = createRasterImageSource(
      bytes,
      'image/x-blp',
      {
        width: texture.width,
        height: texture.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: Math.max(1, texture.mips.length),
        frames: 1,
        channels: texture.alphaDepth > 0 ? 4 : 3,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: texture.alphaDepth > 0 ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: texture.decodedAccess,
      },
      texture.decodedAccess ? regionReader(bytes, texture) : undefined,
    )
    return {
      summary: {
        format: 'blp',
        version: texture.id,
        width: texture.width,
        height: texture.height,
        encoding: texture.encoding,
        alphaDepth: texture.alphaDepth,
        alphaEncoding: texture.alphaEncoding,
        mipLevels: texture.mips.length,
        decodedAccess: texture.decodedAccess,
      },
      metadata: [{
        id: 'blp-header',
        label: `${texture.id} texture`,
        entries: [
          { key: 'version', value: texture.id },
          { key: 'dimensions', value: `${texture.width}x${texture.height}` },
          { key: 'encoding', value: texture.encoding },
          { key: 'alphaDepth', value: texture.alphaDepth },
          { key: 'alphaEncoding', value: texture.alphaEncoding },
          { key: 'hasMipmaps', value: texture.hasMipmaps },
          { key: 'mipLevels', value: texture.mips.length },
          { key: 'decodedAccess', value: texture.decodedAccess },
        ],
      }],
      traits: [
        { id: 'image.raster', parameters: { width: texture.width, height: texture.height, bitDepth: 8 } },
        { id: 'image.channels', parameters: { count: texture.alphaDepth > 0 ? 4 : 3, alpha: texture.alphaDepth > 0 } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: texture.id,
          preview: `${texture.width} × ${texture.height}; ${texture.encoding}`,
          children: texture.mips.map(mip => ({
            kind: 'mip',
            label: `Mip ${mip.level}`,
            preview: `${mip.size} bytes at ${mip.offset}`,
          })),
        }),
        'common.view/raster-image-source': raster,
      },
      ...(texture.decodedAccess ? { maxDecodedBytes: texture.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(texture.decodedAccess ? [] : ['pixel-decoding-for-this-encoding']),
        'texture-writing',
        'mip-generation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
