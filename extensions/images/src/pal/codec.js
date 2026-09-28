import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { isJascPalette, isRiffPalette, parsePalette } from '@modkit/codec-kit/raster/palette'

const ID = 'modkit/pal'

function regionReader(palette) {
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PAL region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PAL exposes only frame/mip/layer/face/slice zero as rgba8')
    }
    if (request.x + request.width > 16 || request.y + request.height > 16) {
      throw new RangeError('PAL region is outside the 16 by 16 swatch')
    }
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes) {
      throw new RangeError('PAL region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * 16 + request.x) * 4
      pixels.set(
        palette.colors.subarray(source, source + request.width * 4),
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
  format: Object.freeze({ id: 'pal', label: 'Palette image' }),
  async detect(prefix) {
    if (isJascPalette(prefix)) return { confidence: 0.99, kind: 'structure', note: 'jasc-pal' }
    if (isRiffPalette(prefix)) return { confidence: 0.98, kind: 'structure', note: 'riff-pal' }
    if (prefix.byteLength === 768)
      return { confidence: 0.7, kind: 'structure', note: 'raw-256-rgb' }
    // 256 RGBx entries: Total Annihilation's PALETTE.PAL, StarCraft's tileset .wpe
    if (prefix.byteLength === 1024)
      return { confidence: 0.6, kind: 'structure', note: 'raw-256-rgbx' }
    return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const palette = parsePalette(bytes, context.budget.maxNodes)
    const raster = createRasterImageSource(
      bytes,
      'application/x-palette',
      {
        width: 16,
        height: 16,
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
      regionReader(palette),
    )
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'Palette',
      preview: `${palette.format}, ${palette.count} declared color(s)`,
      children: Array.from({ length: Math.min(16, palette.count) }, (_, index) => ({
        kind: 'field',
        label: `Index ${index}`,
        preview: `rgba(${palette.colors[index * 4]}, ${palette.colors[index * 4 + 1]}, ${palette.colors[index * 4 + 2]}, ${palette.colors[index * 4 + 3]})`,
      })),
    })
    return {
      summary: {
        format: 'pal',
        encoding: palette.format,
        colors: palette.count,
        swatchWidth: 16,
        swatchHeight: 16,
      },
      metadata: [
        {
          id: 'palette',
          label: 'Palette image',
          entries: [
            { key: 'encoding', value: palette.format },
            { key: 'version', value: palette.version },
            { key: 'declaredColors', value: palette.count },
            { key: 'swatchWidth', value: 16 },
            { key: 'swatchHeight', value: 16 },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: 16, height: 16, bitDepth: 8 } },
        { id: 'image.palette', parameters: { colors: palette.count } },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: 1024n,
      unsupportedFeatures: ['palette-writing', 'palette-remapping', 'pixel-editing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
