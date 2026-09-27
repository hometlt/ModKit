import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { rasterEditContent, rasterEditContentOperation } from '../ops/raster-transforms.js'
// Header and pixel reading are codec-kit's (also used by providers that meet a TGA).
import { decodeTgaPixels, encodeTga, parseTga, plausibleTgaHeader } from '@modkit/codec-kit/raster'

const ID = 'modkit/tga'

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
    decoded ??= decodeTgaPixels(bytes, tga)
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
    return plausibleTgaHeader(prefix)
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
            pixels: decodeTgaPixels(bytes, tga),
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
