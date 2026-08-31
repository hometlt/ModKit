import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/bmp'
const SIGNATURE = Object.freeze([0x42, 0x4d])

function matchesSignature(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value)
}

function view(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new RangeError('BMP structure is truncated')
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

function u16(bytes, offset) {
  return view(bytes, offset, 2).getUint16(0, true)
}

function u32(bytes, offset) {
  return view(bytes, offset, 4).getUint32(0, true)
}

function i32(bytes, offset) {
  return view(bytes, offset, 4).getInt32(0, true)
}

function parseBmp(bytes, maxScalarBytes) {
  if (!matchesSignature(bytes) || bytes.byteLength < 54) {
    throw new TypeError('BMP file header is invalid or truncated')
  }
  const declaredFileBytes = u32(bytes, 2)
  const pixelOffset = u32(bytes, 10)
  const dibBytes = u32(bytes, 14)
  if (dibBytes < 40 || 14 + dibBytes > bytes.byteLength) {
    throw new TypeError('BMP requires a complete BITMAPINFOHEADER-compatible DIB header')
  }
  const width = i32(bytes, 18)
  const rawHeight = i32(bytes, 22)
  const height = Math.abs(rawHeight)
  const planes = u16(bytes, 26)
  const bitDepth = u16(bytes, 28)
  const compression = u32(bytes, 30)
  const declaredImageBytes = u32(bytes, 34)
  const colorsUsed = u32(bytes, 46)
  if (width < 1 || height < 1 || planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(bitDepth)) {
    throw new TypeError('BMP dimensions, planes, or bit depth are invalid')
  }
  if (declaredFileBytes !== 0 && declaredFileBytes > bytes.byteLength) {
    throw new TypeError('BMP declared file size exceeds the source')
  }
  if (pixelOffset < 14 + dibBytes || pixelOffset > bytes.byteLength) {
    throw new TypeError('BMP pixel offset is outside the source')
  }
  const rowBytesBig = ((BigInt(width) * BigInt(bitDepth) + 31n) / 32n) * 4n
  const storedBytesBig = rowBytesBig * BigInt(height)
  if (compression === 0 && BigInt(pixelOffset) + storedBytesBig > BigInt(bytes.byteLength)) {
    throw new TypeError('BMP uncompressed pixel rows are truncated')
  }
  if (
    compression !== 0 &&
    declaredImageBytes !== 0 &&
    BigInt(pixelOffset) + BigInt(declaredImageBytes) > BigInt(bytes.byteLength)
  ) {
    throw new TypeError('BMP compressed payload is truncated')
  }
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const decodedAccess =
    compression === 0 &&
    (bitDepth === 24 || bitDepth === 32) &&
    decodedBytes <= BigInt(maxScalarBytes) &&
    rowBytesBig <= BigInt(Number.MAX_SAFE_INTEGER)
  return Object.freeze({
    width,
    height,
    topDown: rawHeight < 0,
    bitDepth,
    compression,
    colorsUsed,
    pixelOffset,
    rowBytes: rowBytesBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rowBytesBig) : 0,
    decodedBytes,
    decodedAccess,
  })
}

function regionReader(bytes, bmp) {
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('BMP region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('BMP exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > bmp.width || request.y + request.height > bmp.height) {
      throw new RangeError('BMP region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('BMP region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(outputBytes)
    const bytesPerPixel = bmp.bitDepth / 8
    for (let row = 0; row < request.height; row += 1) {
      const sourceY = bmp.topDown ? request.y + row : bmp.height - 1 - (request.y + row)
      const sourceRow = bmp.pixelOffset + sourceY * bmp.rowBytes
      for (let column = 0; column < request.width; column += 1) {
        const source = sourceRow + (request.x + column) * bytesPerPixel
        const target = (row * request.width + column) * 4
        pixels[target] = bytes[source + 2] ?? 0
        pixels[target + 1] = bytes[source + 1] ?? 0
        pixels[target + 2] = bytes[source] ?? 0
        pixels[target + 3] = bmp.bitDepth === 32 ? (bytes[source + 3] ?? 255) : 255
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
  format: Object.freeze({ id: 'bmp', label: 'Windows Bitmap', mediaType: 'image/bmp' }),
  async detect(prefix) {
    return matchesSignature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'bmp-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const bmp = parseBmp(bytes, context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/bmp',
      {
        width: bmp.width,
        height: bmp.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: bmp.bitDepth === 32 ? 4 : 3,
        bitDepth: Math.min(bmp.bitDepth, 8),
        colorSpace: 'srgb',
        alphaMode: bmp.bitDepth === 32 ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: bmp.decodedAccess,
      },
      bmp.decodedAccess ? regionReader(bytes, bmp) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'BMP',
      preview: `${bmp.width} × ${bmp.height}, ${bmp.bitDepth}-bit`,
      children: [
        {
          kind: 'field',
          label: 'DIB orientation',
          preview: bmp.topDown ? 'top-down' : 'bottom-up',
        },
        { kind: 'field', label: 'Compression', preview: String(bmp.compression) },
        { kind: 'field', label: 'Pixel offset', preview: String(bmp.pixelOffset) },
      ],
    })
    return {
      summary: {
        format: 'bmp',
        width: bmp.width,
        height: bmp.height,
        bitDepth: bmp.bitDepth,
        compression: bmp.compression,
        topDown: bmp.topDown,
      },
      metadata: [
        {
          id: 'bmp-image',
          label: 'Windows bitmap',
          entries: [
            { key: 'width', value: bmp.width },
            { key: 'height', value: bmp.height },
            { key: 'bitDepth', value: bmp.bitDepth },
            { key: 'compression', value: bmp.compression },
            { key: 'colorsUsed', value: bmp.colorsUsed },
            { key: 'pixelOffset', value: bmp.pixelOffset },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: bmp.width, height: bmp.height, bitDepth: bmp.bitDepth },
        },
        {
          id: 'image.channels',
          parameters: { count: bmp.bitDepth === 32 ? 4 : 3, alpha: bmp.bitDepth === 32 },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(bmp.decodedAccess ? { maxDecodedBytes: bmp.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(bmp.decodedAccess ? [] : ['decoded-region-provider']),
        'bmp-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
