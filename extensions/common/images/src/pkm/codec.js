import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/pkm'
const ascii = new TextDecoder('latin1')

function versionOf(bytes) {
  const header = ascii.decode(bytes.subarray(0, Math.min(bytes.byteLength, 6)))
  return header === 'PKM 10' ? '1.0' : header === 'PKM 20' ? '2.0' : undefined
}

function u16be(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new RangeError('PKM field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, false)
}

const FORMATS = Object.freeze({
  0: Object.freeze({ label: 'ETC1_RGB', blockBytes: 8 }),
  1: Object.freeze({ label: 'ETC2_RGB', blockBytes: 8 }),
  3: Object.freeze({ label: 'ETC2_RGBA', blockBytes: 16 }),
  4: Object.freeze({ label: 'EAC_R11', blockBytes: 8 }),
  5: Object.freeze({ label: 'EAC_RG11', blockBytes: 16 }),
  6: Object.freeze({ label: 'EAC_SIGNED_R11', blockBytes: 8 }),
  7: Object.freeze({ label: 'EAC_SIGNED_RG11', blockBytes: 16 }),
  8: Object.freeze({ label: 'ETC2_RGB_A1', blockBytes: 8 }),
  9: Object.freeze({ label: 'ETC2_SRGB', blockBytes: 8 }),
  10: Object.freeze({ label: 'ETC2_SRGBA', blockBytes: 16 }),
  11: Object.freeze({ label: 'ETC2_SRGB_A1', blockBytes: 8 }),
})

function parsePkm(bytes) {
  const version = versionOf(bytes)
  if (version === undefined || bytes.byteLength < 16) throw new TypeError('PKM header is invalid')
  const identifier = u16be(bytes, 6)
  const format = FORMATS[identifier]
  if (
    format === undefined ||
    (version === '1.0' && identifier !== 0) ||
    (version === '2.0' && identifier === 2)
  ) {
    throw new TypeError(`unsupported PKM ${version} format identifier ${identifier}`)
  }
  const encodedWidth = u16be(bytes, 8)
  const encodedHeight = u16be(bytes, 10)
  const width = u16be(bytes, 12)
  const height = u16be(bytes, 14)
  if (
    width === 0 ||
    height === 0 ||
    encodedWidth < width ||
    encodedHeight < height ||
    encodedWidth - width > 3 ||
    encodedHeight - height > 3 ||
    encodedWidth % 4 !== 0 ||
    encodedHeight % 4 !== 0
  ) {
    throw new TypeError('PKM encoded and logical dimensions are inconsistent')
  }
  const blocksWide = encodedWidth / 4
  const blocksHigh = encodedHeight / 4
  const payloadBytes = blocksWide * blocksHigh * format.blockBytes
  if (16 + payloadBytes !== bytes.byteLength) {
    throw new TypeError('PKM compressed payload size does not match its padded dimensions')
  }
  return Object.freeze({
    version,
    identifier,
    format: format.label,
    blockBytes: format.blockBytes,
    width,
    height,
    encodedWidth,
    encodedHeight,
    blocksWide,
    blocksHigh,
    payloadBytes,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'pkm', label: 'PKM ETC Texture', mediaType: 'image/x-pkm' }),
  async detect(prefix) {
    return versionOf(prefix) === undefined
      ? { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
      : { confidence: 0.99, kind: 'magic', note: 'pkm-identifier' }
  },
  async inspect(bytes) {
    const pkm = parsePkm(bytes)
    const raster = createRasterImageSource(bytes, 'image/x-pkm', {
      width: pkm.width,
      height: pkm.height,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: 1,
      channels: pkm.blockBytes === 16 ? 4 : 3,
      bitDepth: 8,
      colorSpace: pkm.format.includes('SRGB') ? 'srgb' : 'unknown',
      alphaMode: pkm.format.includes('RGBA') || pkm.format.includes('A1') ? 'straight' : 'none',
      orientation: 'top-left',
      decodedAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'image',
      label: 'PKM',
      preview: `${pkm.width} × ${pkm.height}, ${pkm.format}`,
      children: [
        { kind: 'field', label: 'Version', preview: pkm.version },
        {
          kind: 'chunk',
          label: 'ETC/EAC block payload',
          preview: `${pkm.blocksWide} × ${pkm.blocksHigh} blocks, ${pkm.payloadBytes} bytes`,
        },
      ],
    })
    return {
      summary: {
        format: 'pkm',
        version: pkm.version,
        encoding: pkm.format,
        width: pkm.width,
        height: pkm.height,
        encodedWidth: pkm.encodedWidth,
        encodedHeight: pkm.encodedHeight,
      },
      metadata: [
        {
          id: 'pkm-texture',
          label: 'PKM ETC texture',
          entries: [
            { key: 'version', value: pkm.version },
            { key: 'formatIdentifier', value: pkm.identifier },
            { key: 'encoding', value: pkm.format },
            { key: 'width', value: pkm.width },
            { key: 'height', value: pkm.height },
            { key: 'encodedWidth', value: pkm.encodedWidth },
            { key: 'encodedHeight', value: pkm.encodedHeight },
            { key: 'payloadBytes', value: pkm.payloadBytes },
          ],
        },
      ],
      traits: [
        { id: 'image.raster', parameters: { width: pkm.width, height: pkm.height, bitDepth: 8 } },
        {
          id: 'image.compressed-blocks',
          parameters: {
            format: pkm.format,
            blocksWide: pkm.blocksWide,
            blocksHigh: pkm.blocksHigh,
            blockBytes: pkm.blockBytes,
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      unsupportedFeatures: [
        'decoded-region-provider',
        'etc-eac-software-decoding',
        'mip-chains',
        'pkm-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
