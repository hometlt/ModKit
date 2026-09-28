import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { decodePcxPixels, parsePcx } from '@modkit/codec-kit/raster'

const ID = 'modkit/pcx'

function regionReader(bytes, pcx) {
  let decoded
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PCX region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PCX exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > pcx.width || request.y + request.height > pcx.height) {
      throw new RangeError('PCX region is outside the image')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PCX region exceeds maxBytes budget')
    }
    decoded ??= decodePcxPixels(bytes, pcx)
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * pcx.width + request.x) * 4
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
  format: Object.freeze({ id: 'pcx', label: 'ZSoft Paintbrush PCX', mediaType: 'image/x-pcx' }),
  async detect(prefix) {
    try {
      const pcx = parsePcx(prefix, Number.MAX_SAFE_INTEGER)
      return {
        confidence: 0.95,
        kind: 'structure',
        note: `pcx-v${pcx.version}-${pcx.bitsPerPlane}x${pcx.planes}`,
      }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
    }
  },
  async inspect(bytes, context) {
    const pcx = parsePcx(bytes, context.budget.maxScalarBytes)
    const raster = createRasterImageSource(
      bytes,
      'image/x-pcx',
      {
        width: pcx.width,
        height: pcx.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: pcx.planes === 4 && pcx.bitsPerPlane === 8 ? 4 : 3,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: pcx.planes === 4 && pcx.bitsPerPlane === 8 ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: pcx.decodedAccess,
      },
      pcx.decodedAccess ? regionReader(bytes, pcx) : undefined,
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'PCX',
      preview: `${pcx.width} × ${pcx.height}, ${pcx.bitsPerPlane} bit(s) × ${pcx.planes} plane(s)`,
      children: [
        { kind: 'field', label: 'Version', preview: String(pcx.version) },
        { kind: 'field', label: 'Encoding', preview: pcx.encoding === 1 ? 'RLE' : 'raw' },
        { kind: 'field', label: 'Bytes per line', preview: String(pcx.bytesPerLine) },
        {
          kind: 'field',
          label: 'Palette',
          preview: pcx.hasVgaPalette ? '256-color VGA trailer' : 'header/grayscale',
        },
      ],
    })
    return {
      summary: {
        format: 'pcx',
        version: pcx.version,
        width: pcx.width,
        height: pcx.height,
        encoding: pcx.encoding === 1 ? 'rle' : 'raw',
        bitsPerPlane: pcx.bitsPerPlane,
        planes: pcx.planes,
        hasVgaPalette: pcx.hasVgaPalette,
      },
      metadata: [
        {
          id: 'pcx-image',
          label: 'PCX image',
          entries: [
            { key: 'version', value: pcx.version },
            { key: 'width', value: pcx.width },
            { key: 'height', value: pcx.height },
            { key: 'encoding', value: pcx.encoding === 1 ? 'RLE' : 'raw' },
            { key: 'bitsPerPlane', value: pcx.bitsPerPlane },
            { key: 'planes', value: pcx.planes },
            { key: 'bytesPerLine', value: pcx.bytesPerLine },
            { key: 'paletteInfo', value: pcx.paletteInfo },
            { key: 'hasVgaPalette', value: pcx.hasVgaPalette },
            { key: 'hdpi', value: pcx.hdpi },
            { key: 'vdpi', value: pcx.vdpi },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: pcx.width, height: pcx.height, bitDepth: 8 } },
        ...(pcx.planes === 1 ? [{ id: 'image.palette', parameters: { indexed: true } }] : []),
        {
          id: 'image.channels',
          parameters: { count: pcx.planes === 4 ? 4 : 3, alpha: pcx.planes === 4 },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(pcx.decodedAccess ? { maxDecodedBytes: pcx.decodedBytes } : {}),
      unsupportedFeatures: [
        ...(pcx.decodedAccess ? [] : ['decoded-region-provider']),
        'pcx-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
