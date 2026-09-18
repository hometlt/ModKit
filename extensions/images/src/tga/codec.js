import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { rasterEditContent, rasterEditContentOperation } from '../ops/raster-transforms.js'
import { encodeTga } from '@modkit/codec-kit/raster'

const ID = 'modkit/tga'
const FOOTER = Object.freeze([
  0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4f, 0x4e, 0x2d, 0x58, 0x46, 0x49, 0x4c, 0x45,
  0x2e, 0x00,
])

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('TGA field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true)
}

function hasFooter(bytes) {
  const start = bytes.byteLength - FOOTER.length
  return start >= 0 && FOOTER.every((value, index) => bytes[start + index] === value)
}

function plausibleHeader(bytes) {
  if (bytes.byteLength < 18) return false
  const colorMapType = bytes[1]
  const imageType = bytes[2]
  const width = u16(bytes, 12)
  const height = u16(bytes, 14)
  const pixelDepth = bytes[16]
  if (
    ![0, 1].includes(colorMapType) ||
    ![1, 2, 3, 9, 10, 11].includes(imageType) ||
    width === 0 ||
    height === 0
  ) {
    return false
  }
  const mapped = imageType === 1 || imageType === 9
  const grayscale = imageType === 3 || imageType === 11
  if (mapped !== (colorMapType === 1)) return false
  if (mapped && ![8, 16].includes(pixelDepth)) return false
  if (grayscale && ![8, 16].includes(pixelDepth)) return false
  if (!mapped && !grayscale && ![16, 24, 32].includes(pixelDepth)) return false
  return true
}

function parseTga(bytes, maxScalarBytes) {
  if (!plausibleHeader(bytes)) throw new TypeError('TGA header is invalid')
  const idBytes = bytes[0]
  const colorMapType = bytes[1]
  const imageType = bytes[2]
  const colorMapFirst = u16(bytes, 3)
  const colorMapLength = u16(bytes, 5)
  const colorMapDepth = bytes[7]
  const xOrigin = u16(bytes, 8)
  const yOrigin = u16(bytes, 10)
  const width = u16(bytes, 12)
  const height = u16(bytes, 14)
  const pixelDepth = bytes[16]
  const descriptor = bytes[17]
  const mapped = imageType === 1 || imageType === 9
  const grayscale = imageType === 3 || imageType === 11
  const rle = imageType >= 9
  const colorMapEntryBytes = Math.ceil(colorMapDepth / 8)
  if (
    (mapped && (colorMapLength === 0 || ![15, 16, 24, 32].includes(colorMapDepth))) ||
    (!mapped && (colorMapLength !== 0 || colorMapType !== 0))
  ) {
    throw new TypeError('TGA color-map declaration is invalid')
  }
  const dataOffset = 18 + idBytes + colorMapLength * colorMapEntryBytes
  const footerBytes = hasFooter(bytes) ? 26 : 0
  const dataEnd = bytes.byteLength - footerBytes
  if (dataOffset >= dataEnd) throw new TypeError('TGA image payload is missing')
  const decodedBytes = BigInt(width) * BigInt(height) * 4n
  const decodedAccess =
    !mapped &&
    decodedBytes <= BigInt(maxScalarBytes) &&
    ((!grayscale && [16, 24, 32].includes(pixelDepth)) ||
      (grayscale && [8, 16].includes(pixelDepth)))
  return Object.freeze({
    idBytes,
    colorMapType,
    imageType,
    colorMapFirst,
    colorMapLength,
    colorMapDepth,
    xOrigin,
    yOrigin,
    width,
    height,
    pixelDepth,
    descriptor,
    mapped,
    grayscale,
    rle,
    topOrigin: (descriptor & 0x20) !== 0,
    rightOrigin: (descriptor & 0x10) !== 0,
    alphaBits: descriptor & 0x0f,
    dataOffset,
    dataEnd,
    decodedBytes,
    decodedAccess,
    hasFooter: footerBytes !== 0,
  })
}

function readPixel(bytes, source, tga) {
  if (tga.grayscale) {
    return Object.freeze({
      red: bytes[source] ?? 0,
      green: bytes[source] ?? 0,
      blue: bytes[source] ?? 0,
      alpha: tga.pixelDepth === 16 ? (bytes[source + 1] ?? 255) : 255,
      next: source + tga.pixelDepth / 8,
    })
  }
  if (tga.pixelDepth === 16) {
    const value = u16(bytes, source)
    return Object.freeze({
      red: Math.round((((value >>> 10) & 0x1f) * 255) / 31),
      green: Math.round((((value >>> 5) & 0x1f) * 255) / 31),
      blue: Math.round(((value & 0x1f) * 255) / 31),
      alpha: tga.alphaBits > 0 ? ((value & 0x8000) === 0 ? 0 : 255) : 255,
      next: source + 2,
    })
  }
  return Object.freeze({
    red: bytes[source + 2] ?? 0,
    green: bytes[source + 1] ?? 0,
    blue: bytes[source] ?? 0,
    alpha: tga.pixelDepth === 32 ? (bytes[source + 3] ?? 255) : 255,
    next: source + tga.pixelDepth / 8,
  })
}

function decodePixels(bytes, tga) {
  const pixelCount = tga.width * tga.height
  const pixels = new Uint8Array(pixelCount * 4)
  let source = tga.dataOffset
  let filePixel = 0
  const write = pixel => {
    if (filePixel >= pixelCount) throw new TypeError('TGA packet crosses the declared image')
    const fileX = filePixel % tga.width
    const fileY = Math.floor(filePixel / tga.width)
    const targetX = tga.rightOrigin ? tga.width - 1 - fileX : fileX
    const targetY = tga.topOrigin ? fileY : tga.height - 1 - fileY
    const target = (targetY * tga.width + targetX) * 4
    pixels[target] = pixel.red
    pixels[target + 1] = pixel.green
    pixels[target + 2] = pixel.blue
    pixels[target + 3] = pixel.alpha
    filePixel += 1
  }
  while (filePixel < pixelCount) {
    if (source >= tga.dataEnd) throw new TypeError('TGA image data is truncated')
    if (tga.rle) {
      const packet = bytes[source] ?? 0
      source += 1
      const count = (packet & 0x7f) + 1
      if (filePixel + count > pixelCount) throw new TypeError('TGA RLE packet is too long')
      if ((packet & 0x80) !== 0) {
        const pixel = readPixel(bytes, source, tga)
        if (pixel.next > tga.dataEnd) throw new TypeError('TGA RLE pixel is truncated')
        source = pixel.next
        for (let index = 0; index < count; index += 1) write(pixel)
      } else {
        for (let index = 0; index < count; index += 1) {
          const pixel = readPixel(bytes, source, tga)
          if (pixel.next > tga.dataEnd) throw new TypeError('TGA raw packet pixel is truncated')
          source = pixel.next
          write(pixel)
        }
      }
    } else {
      const pixel = readPixel(bytes, source, tga)
      if (pixel.next > tga.dataEnd) throw new TypeError('TGA pixel is truncated')
      source = pixel.next
      write(pixel)
    }
  }
  return pixels
}

function regionReader(bytes, tga) {
  let decoded
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('TGA region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('TGA exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > tga.width || request.y + request.height > tga.height) {
      throw new RangeError('TGA region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('TGA region exceeds maxBytes budget')
    }
    decoded ??= decodePixels(bytes, tga)
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * tga.width + request.x) * 4
      pixels.set(decoded.subarray(source, source + request.width * 4), row * request.width * 4)
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
  format: Object.freeze({ id: 'tga', label: 'Truevision TGA', mediaType: 'image/x-tga' }),
  operations: Object.freeze([rasterEditContentOperation('transform')]),
  async detect(prefix) {
    return plausibleHeader(prefix)
      ? { confidence: 0.9, kind: 'structure', note: 'tga-plausible-header' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const tga = parseTga(bytes, context.budget.maxScalarBytes)
    const hasAlpha =
      (tga.grayscale && tga.pixelDepth === 16) || tga.alphaBits > 0 || tga.pixelDepth === 32
    const channels = tga.grayscale ? (hasAlpha ? 2 : 1) : hasAlpha ? 4 : 3
    const raster = createRasterImageSource(
      bytes,
      'image/x-tga',
      {
        width: tga.width,
        height: tga.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: hasAlpha ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: tga.decodedAccess,
      },
      tga.decodedAccess ? regionReader(bytes, tga) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'TGA',
      preview: `${tga.width} × ${tga.height}, type ${tga.imageType}, ${tga.pixelDepth}-bit`,
      children: [
        { kind: 'field', label: 'Encoding', preview: tga.rle ? 'RLE' : 'raw' },
        {
          kind: 'field',
          label: 'Origin',
          preview: `${tga.topOrigin ? 'top' : 'bottom'}-${tga.rightOrigin ? 'right' : 'left'}`,
        },
        { kind: 'field', label: 'Color map entries', preview: String(tga.colorMapLength) },
        { kind: 'field', label: 'TGA 2.0 footer', preview: tga.hasFooter ? 'present' : 'absent' },
      ],
    })
    return {
      summary: {
        format: 'tga',
        width: tga.width,
        height: tga.height,
        imageType: tga.imageType,
        pixelDepth: tga.pixelDepth,
        rle: tga.rle,
        colorMapped: tga.mapped,
        hasFooter: tga.hasFooter,
      },
      metadata: [
        {
          id: 'tga-image',
          label: 'Truevision TGA',
          entries: [
            { key: 'width', value: tga.width },
            { key: 'height', value: tga.height },
            { key: 'imageType', value: tga.imageType },
            { key: 'pixelDepth', value: tga.pixelDepth },
            { key: 'alphaBits', value: tga.alphaBits },
            { key: 'rle', value: tga.rle },
            { key: 'colorMapFirst', value: tga.colorMapFirst },
            { key: 'colorMapLength', value: tga.colorMapLength },
            { key: 'colorMapDepth', value: tga.colorMapDepth },
            { key: 'xOrigin', value: tga.xOrigin },
            { key: 'yOrigin', value: tga.yOrigin },
            { key: 'hasFooter', value: tga.hasFooter },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: tga.width, height: tga.height, bitDepth: 8 } },
        ...(tga.mapped
          ? [{ id: 'image.palette', parameters: { colors: tga.colorMapLength } }]
          : []),
        { id: 'image.channels', parameters: { count: channels, alpha: hasAlpha } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(tga.decodedAccess ? { maxDecodedBytes: tga.decodedBytes } : {}),
      handlers: {
        /*
         * Written back as uncompressed 32-bit RGBA: the pixels are exact, while RLE, the colour
         * map, the image ID and the TGA 2.0 extension area are not carried over.
         */
        transform: rasterEditContent({
          codecId: ID,
          input: context.input,
          bytes,
          decode: async () => ({
            width: tga.width,
            height: tga.height,
            pixels: decodePixels(bytes, tga),
          }),
          encode: encodeTga,
          fidelity: {
            roundTrip: 'semantic',
            preservesUnknownData: false,
            notes: [
              'Written as uncompressed 32-bit RGBA; the image ID and extension area are dropped.',
            ],
          },
        }),
      },
      unsupportedFeatures: [
        ...(tga.decodedAccess ? [] : ['decoded-region-provider']),
        'color-mapped-pixel-decoding',
        'metadata-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
