import { ModkitError } from '@modkit/core'
import type { CompressedTextureBlockLayout } from '@modkit/sdk'

/** Default ceiling for one RGBA8 decode. Hosts may impose a lower operation budget. */
export const DEFAULT_MAX_RGBA8_DECODE_BYTES = 256 * 1024 * 1024

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Exact encoded size implied by a block layout, including minimum footprints such as PVRTC. */
export function compressedTextureByteLength(
  width: number,
  height: number,
  depth: number,
  block: CompressedTextureBlockLayout,
): number {
  const valid =
    typeof block === 'object' &&
    block !== null &&
    [width, height, depth, block.width, block.height, block.depth, block.bytes].every(
      positiveSafeInteger,
    ) &&
    [block.minimumBlocksWide, block.minimumBlocksHigh, block.minimumBlocksDeep].every(
      minimum => minimum === undefined || positiveSafeInteger(minimum),
    )
  const length = valid
    ? Math.max(block.minimumBlocksWide ?? 1, Math.ceil(width / block.width)) *
      Math.max(block.minimumBlocksHigh ?? 1, Math.ceil(height / block.height)) *
      Math.max(block.minimumBlocksDeep ?? 1, Math.ceil(depth / block.depth)) *
      block.bytes
    : undefined
  if (length === undefined || !Number.isSafeInteger(length))
    throw new ModkitError({
      code: 'codec-kit/texture-size-limit',
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
      code: 'codec-kit/texture-size-limit',
      message: 'Decoded RGBA8 texture exceeds the configured safety limit',
      context: { width, height, depth, requiredBytes: length, maxBytes },
    })
  return length
}
