import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unity'
const MAGIC = new TextEncoder().encode('MKXUNITYTEX\0')

function hasMagic(bytes) {
  return (
    bytes.byteLength >= MAGIC.byteLength && MAGIC.every((value, index) => bytes[index] === value)
  )
}

function parseTexture(bytes, context) {
  if (!hasMagic(bytes) || bytes.byteLength < MAGIC.byteLength + 4) {
    throw new TypeError('not a MKXUNITYTEX payload')
  }
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('Unity texture exceeds maxInputBytes')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(MAGIC.byteLength, true)
  const jsonStart = MAGIC.byteLength + 4
  const payloadStart = jsonStart + jsonLength
  if (jsonLength < 2 || payloadStart > bytes.byteLength) {
    throw new RangeError('Unity texture JSON header is truncated')
  }
  if (jsonLength > context.budget.maxScalarBytes) {
    throw new RangeError('Unity texture JSON exceeds maxScalarBytes')
  }
  let header
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, payloadStart)))
  } catch {
    throw new TypeError('Unity texture JSON header is invalid')
  }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    throw new TypeError('Unity texture JSON header must be an object')
  }
  const width = Number(header.width)
  const height = Number(header.height)
  const format = Number(header.format)
  const mipCount = Number(header.mipCount)
  const imageCount = Number(header.imageCount)
  const textureDimension = Number(header.textureDimension)
  if (
    header.version !== 1 ||
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    format !== 4 ||
    mipCount !== 1 ||
    imageCount !== 1 ||
    textureDimension !== 2
  ) {
    throw new TypeError('unsupported Unity texture profile (expected one RGBA32 Texture2D mip)')
  }
  const decodedBytes = width * height * 4
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > context.budget.maxScalarBytes) {
    throw new RangeError('Unity texture pixels exceed maxScalarBytes')
  }
  if (bytes.byteLength - payloadStart !== decodedBytes) {
    throw new TypeError(`Unity RGBA32 payload must contain exactly ${decodedBytes} pixel bytes`)
  }
  const name = typeof header.name === 'string' ? header.name : ''
  const unityVersion = typeof header.unityVersion === 'string' ? header.unityVersion : ''
  return {
    width,
    height,
    name,
    unityVersion,
    pixels: bytes.slice(payloadStart),
    decodedBytes,
    jsonLength,
  }
}

function regionReader(texture) {
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('Unity texture region coordinates must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('Unity texture exposes only mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > texture.width || request.y + request.height > texture.height) {
      throw new RangeError('Unity texture region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('Unity texture region exceeds maxBytes')
    }
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * texture.width + request.x) * 4
      pixels.set(
        texture.pixels.subarray(source, source + request.width * 4),
        row * request.width * 4,
      )
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
  format: Object.freeze({ id: 'unity', label: 'Unity serialized texture payload' }),
  async detect(prefix) {
    return hasMagic(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'mkx-unity-texture' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const texture = parseTexture(bytes, context)
    const raster = createRasterImageSource(
      bytes,
      'application/x-modkitx-unity-texture',
      {
        width: texture.width,
        height: texture.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(texture),
    )
    return {
      summary: {
        format: 'unity',
        profile: 'MKXUNITYTEX/RGBA32',
        name: texture.name,
        unityVersion: texture.unityVersion,
        width: texture.width,
        height: texture.height,
        mipLevels: 1,
        pixelFormat: 'RGBA32',
      },
      metadata: [
        {
          id: 'unity-texture',
          label: 'Unity texture payload',
          entries: [
            { key: 'name', value: texture.name || '(unnamed)' },
            { key: 'unityVersion', value: texture.unityVersion || '(unknown)' },
            { key: 'width', value: texture.width },
            { key: 'height', value: texture.height },
            { key: 'format', value: 'TextureFormat 4 (RGBA32)' },
            { key: 'headerBytes', value: texture.jsonLength },
            { key: 'pixelBytes', value: texture.decodedBytes },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: texture.width, height: texture.height, bitDepth: 8 },
        },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'image',
          label: texture.name || 'Unity RGBA32 Texture2D',
          preview: `${texture.width} × ${texture.height}; one RGBA32 mip`,
          children: [
            {
              kind: 'mip',
              label: 'Mip 0',
              preview: `${texture.decodedBytes} decoded bytes`,
            },
          ],
        }),
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: texture.decodedBytes,
      unsupportedFeatures: [
        'serialized-assets-input',
        'resource-stream-companions',
        'compressed-texture-formats',
        'mip-chains-arrays-cubemaps-and-volumes',
        'texture-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
