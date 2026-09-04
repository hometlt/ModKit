import { ModkitError } from '../legacy/core/errors.js'
import type {
  CompressedTextureBlockLayout,
  CompressedTextureDescriptorV1,
} from '../legacy/assets/profiles/image-texture.js'
import {
  compressedTextureBlockByteLengthV1,
  validateCompressedTextureDescriptorV1,
} from '../legacy/assets/profiles/image-texture.js'

export type {
  CompressedTextureBlockLayout,
  CompressedTextureDescriptorV1,
  CompressedTextureFormat,
  CompressedTextureSubresource,
} from '../legacy/assets/profiles/image-texture.js'

/** Stable operation ID for obtaining renderer-neutral compressed texture data. */
export const IMAGE_COMPRESSED_READ_OPERATION = 'image.compressed.read' as const

/** Default ceiling for one RGBA8 decode. Hosts may impose a lower operation budget. */
export const DEFAULT_MAX_RGBA8_DECODE_BYTES = 256 * 1024 * 1024

/** Exact encoded size implied by a block layout, including minimum footprints such as PVRTC. */
export function compressedTextureByteLength(
  width: number,
  height: number,
  depth: number,
  block: CompressedTextureBlockLayout,
): number {
  const length = compressedTextureBlockByteLengthV1(width, height, depth, block)
  if (length === undefined)
    throw new ModkitError({
      code: 'ASSET_LIMIT_EXCEEDED',
      message: 'Compressed texture subresource size is not safely representable',
      context: { width, height, depth, block },
    })
  return length
}

/** Guard the allocation performed by every software RGBA8 decode path. */
export function assertRgba8DecodeWithinLimit(
  width: number,
  height: number,
  depth = 1,
  maxBytes = DEFAULT_MAX_RGBA8_DECODE_BYTES,
): number {
  const length = width * height * depth * 4
  if (!Number.isSafeInteger(length) || width <= 0 || height <= 0 || depth <= 0 || length > maxBytes)
    throw new ModkitError({
      code: 'ASSET_LIMIT_EXCEEDED',
      message: 'Decoded RGBA8 texture exceeds the configured safety limit',
      context: { width, height, depth, requiredBytes: length, maxBytes },
    })
  return length
}

/** Validate the common invariants before a descriptor crosses a codec/renderer boundary. */
export function validateCompressedTextureDescriptor(
  descriptor: CompressedTextureDescriptorV1,
): readonly string[] {
  return validateCompressedTextureDescriptorV1(descriptor).map(issue => issue.message)
}
