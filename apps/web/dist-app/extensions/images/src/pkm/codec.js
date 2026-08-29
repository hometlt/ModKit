import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

import { decodeEtcRgba } from './etc.js'

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

/** Which formats ./etc.js implements; the budget rule applies only to images it can produce. */
const decodable = format =>
  format.includes('ETC1') ||
  format.includes('ETC2_RGB') ||
  format.includes('ETC2_SRGB') ||
  format === 'EAC_R11' ||
  format === 'EAC_RG11'

const channelsOf = format =>
  format.endsWith('RG11')
    ? 2
    : format.endsWith('R11')
      ? 1
      : format.includes('RGBA') || format.includes('A1')
        ? 4
        : 3

/**
 * Bounded reader over the decoded image.
 *
 * The decode covers the block-aligned extent; the logical image is the top-left crop of it, so the
 * stride here is the encoded width and every request is clipped to the logical one. Getting that
 * backwards is how a 1x1 PKM ends up showing three pixels of padding it was never meant to have.
 */
function regionReader(decoded, pkm) {
  const stride = pkm.encodedWidth * 4
  return async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const values = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('PKM region coordinates and budget must be non-negative safe integers')
    }
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    ) {
      throw new RangeError('PKM decoder exposes only the first image as rgba8')
    }
    if (request.x + request.width > pkm.width || request.y + request.height > pkm.height) {
      throw new RangeError('PKM region is outside the image')
    }
    const length = request.width * request.height * 4
    if (!Number.isSafeInteger(length) || length > request.maxBytes) {
      throw new RangeError('PKM region exceeds maxBytes budget')
    }
    const pixels = new Uint8Array(length)
    for (let row = 0; row < request.height; row += 1) {
      const start = (request.y + row) * stride + request.x * 4
      pixels.set(decoded.subarray(start, start + request.width * 4), row * request.width * 4)
    }
    return { pixelFormat: 'rgba8', width: request.width, height: request.height, pixels }
  }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'pkm', label: 'PKM ETC Texture', mediaType: 'image/x-pkm' }),
  async detect(prefix) {
    return versionOf(prefix) === undefined
      ? { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
      : { confidence: 0.99, kind: 'magic', note: 'pkm-identifier' }
  },
  async inspect(bytes, context) {
    const pkm = parsePkm(bytes)
    /*
     * Decoding is per-format and honest about it: ETC1/ETC2 and unsigned EAC R/RG are implemented
     * from the specification in ./etc.js. Signed EAC stays compressed-only until a signed raster
     * contract or an explicit visualization policy exists.
     */
    // ./etc.js decodes the complete block grid before regionReader crops to the logical extent.
    // Budget that actual allocation, including padding, rather than only the visible pixels.
    const decodedBytes = pkm.encodedWidth * pkm.encodedHeight * 4
    if (!Number.isSafeInteger(decodedBytes)) {
      throw new RangeError('PKM decoded pixel count is not representable')
    }
    if (decodable(pkm.format) && decodedBytes > context.budget.maxScalarBytes) {
      // an image this codec *can* decode but the caller has no room for: refused, never truncated
      throw new RangeError('PKM decoded pixels exceed the scalar budget')
    }
    const decoded = decodeEtcRgba(bytes.subarray(16), pkm.blocksWide, pkm.blocksHigh, pkm.format)
    const raster = createRasterImageSource(
      bytes,
      'image/x-pkm',
      {
        width: pkm.width,
        height: pkm.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: channelsOf(pkm.format),
        bitDepth: pkm.format.startsWith('EAC_') ? 11 : 8,
        colorSpace: pkm.format.includes('SRGB') ? 'srgb' : 'unknown',
        alphaMode: pkm.format.includes('RGBA') || pkm.format.includes('A1') ? 'straight' : 'none',
        orientation: 'top-left',
        decodedAccess: decoded !== undefined,
      },
      decoded === undefined ? undefined : regionReader(decoded, pkm),
    )
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
        ...(decoded === undefined
          ? ['decoded-region-provider', 'signed-eac-11-bit-channel-view']
          : []),
        'mip-chains',
        'pkm-writing',
        'pixel-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
