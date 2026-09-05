/**
 * The compressed-texture view of a DDS file: GPU block data handed over without being decoded.
 *
 * Ported from the legacy MK2 codec,
 * `references/modkitmk2/extensions/common/images/codecs/dds/src/codec.ts` — `readCompressedDds`,
 * `compressedProfile`, `alphaMode` and `SRGB_DXGI_FORMATS`, which together produced a
 * `CompressedTextureDescriptorV1` for its `readCompressed` operation (`image.compressed.read`).
 *
 * What this is for, and why it is not the same thing as decoding: `codec.js` projects a DDS into
 * rgba8 so a viewer can show it. That projection throws information away — BC5 loses its implied
 * third channel, BC6H loses its floating-point range, and every format loses the ability to be
 * uploaded to a GPU as-is. This descriptor keeps the stored bytes, states the block geometry, the
 * colour space and the alpha mode, and points each subresource back at its byte range in the file,
 * so a renderer can hand the payload straight to the hardware.
 *
 * Phase-A status: the implementation is here and is byte-identical to legacy's, but MK3 has no
 * `common.view/*` contract for compressed textures, so nothing publishes it yet. Designing that
 * contract is phase B; the port is not waiting on it.
 */

import { parseDds } from './codec.js'
import { elementBytes, levelBytes, levelDimensions, sliceBytes } from './layout.js'

/** DXGI formats whose stored values are sRGB-encoded. Same set legacy used. */
const SRGB_DXGI_FORMATS = new Set([29, 72, 75, 78, 91, 99])

/**
 * The GPU format, block size and alpha capability of one DDS payload.
 *
 * `snorm` and the BC6H signedness come from the header; everything else is fixed by the format.
 * A payload that is not block-compressed has no compressed view at all and is refused by name.
 */
function compressedProfile(info) {
  switch (info.format) {
    case 'DXT1':
      return { format: 'bc1-rgba-unorm', blockBytes: 8, hasAlpha: true }
    case 'DXT3':
      return { format: 'bc2-rgba-unorm', blockBytes: 16, hasAlpha: true }
    case 'DXT5':
      return { format: 'bc3-rgba-unorm', blockBytes: 16, hasAlpha: true }
    case 'BC4':
      return {
        format: info.snorm ? 'bc4-r-snorm' : 'bc4-r-unorm',
        blockBytes: 8,
        hasAlpha: false,
      }
    case 'BC5':
      return {
        format: info.snorm ? 'bc5-rg-snorm' : 'bc5-rg-unorm',
        blockBytes: 16,
        hasAlpha: false,
      }
    case 'BC6H':
      return {
        format: info.signedFloat ? 'bc6h-rgb-sfloat' : 'bc6h-rgb-ufloat',
        blockBytes: 16,
        hasAlpha: false,
        ...(info.dxgiFormat === 94
          ? { notes: ['DXGI BC6H_TYPELESS is exposed as the unsigned-float BC6H profile.'] }
          : {}),
      }
    case 'BC7':
      return { format: 'bc7-rgba-unorm', blockBytes: 16, hasAlpha: true }
    default:
      throw new TypeError('DDS payload is not block-compressed')
  }
}

/**
 * How the stored alpha relates to the stored colour.
 *
 * A DX10 header states it in `miscFlags2`; anything else is only as specific as the format allows,
 * so an unstated alpha stays `unknown` rather than being guessed at.
 */
function alphaMode(info, hasAlpha) {
  if (!hasAlpha) return 'none'
  switch ((info.miscFlags2 ?? 0) & 0x7) {
    case 1:
      return 'straight'
    case 2:
      return 'premultiplied'
    case 3:
      return 'none'
    default:
      return 'unknown'
  }
}

/**
 * Build the compressed-texture descriptor for a parsed DDS.
 *
 * `info` is what `parseDds` in `codec.js` returns; `bytes` is the whole file, because every
 * subresource's `data` is a view onto it rather than a copy.
 *
 * Subresource order is mip-major — mip, then layer, then face, then depth slice — which is the
 * order a renderer walks when it uploads a mip chain, not the order the file stores. The byte
 * offsets do the reordering, and `sourceByteRange` records where each one actually came from.
 */
export function compressedTextureOf(bytes, info) {
  const profile = compressedProfile(info)
  const subresources = []
  for (let mipLevel = 0; mipLevel < info.mipLevels; mipLevel += 1) {
    const size = levelDimensions(info, mipLevel)
    const length = sliceBytes(info, mipLevel)
    for (let layer = 0; layer < info.layers; layer += 1) {
      for (let face = 0; face < info.faces; face += 1) {
        let offset = info.dataOffset + (layer * info.faces + face) * elementBytes(info)
        for (let level = 0; level < mipLevel; level += 1) offset += levelBytes(info, level)
        for (let depthSlice = 0; depthSlice < size.depth; depthSlice += 1) {
          const sliceOffset = offset + depthSlice * length
          if (sliceOffset + length > bytes.byteLength) {
            throw new TypeError('DDS subresource table is incomplete')
          }
          subresources.push({
            mipLevel,
            layer,
            face,
            depthSlice,
            width: size.width,
            height: size.height,
            depth: 1,
            data: bytes.subarray(sliceOffset, sliceOffset + length),
            sourceByteRange: { offset: sliceOffset, length },
          })
        }
      }
    }
  }

  return {
    schemaVersion: 1,
    format: profile.format,
    dimensions: { width: info.width, height: info.height, depth: info.depth },
    mipLevelCount: info.mipLevels,
    layerCount: info.layers,
    faceCount: info.faces,
    colorSpace:
      info.dxgiFormat === undefined
        ? 'unknown'
        : SRGB_DXGI_FORMATS.has(info.dxgiFormat)
          ? 'srgb'
          : 'linear',
    alphaMode: alphaMode(info, profile.hasAlpha),
    block: { width: 4, height: 4, depth: 1, bytes: profile.blockBytes },
    subresources,
    source: { codecId: 'dds', containerFormat: 'dds', preservation: 'source-bytes' },
    ...(profile.notes ? { notes: profile.notes } : {}),
  }
}

/** The whole operation from file bytes: parse the header, then describe the stored blocks. */
export function readCompressedDds(bytes) {
  return compressedTextureOf(bytes, parseDds(bytes))
}
