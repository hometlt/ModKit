import type {
  CompressedTextureFormat,
  RasterImageInfo,
  RasterResourceSelection,
  RasterSubresource,
} from '@modkit/sdk'
import { ModkitError } from '@modkit/core'

const coordinates = ['frame', 'mipLevel', 'layer', 'face', 'slice'] as const

/** Capture untrusted/caller-owned selection before any resource or codec awaits. */
export function captureRasterSelection(
  value: RasterResourceSelection | undefined,
): RasterResourceSelection {
  if (value === undefined) return Object.freeze({})
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !coordinates.some(coordinate => coordinate === key))
  )
    throw new TypeError('invalid raster subresource selection')
  const owned: Record<string, number | 'all' | 'fit'> = {}
  for (const key of coordinates) {
    const item = value[key]
    if (item === undefined) continue
    if (key === 'face' && item === 'all') {
      owned[key] = item
      continue
    }
    if (key === 'mipLevel' && item === 'fit') {
      owned[key] = item
      continue
    }
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0)
      throw new TypeError(`raster ${key} must be a nonnegative safe integer`)
    owned[key] = item
  }
  return Object.freeze(owned)
}

/** Capture the block formats a caller takes, before any resource or codec awaits. */
export function captureCompressedFormats(
  value: readonly CompressedTextureFormat[] | undefined,
): ReadonlySet<string> {
  if (value === undefined) return new Set()
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(item => typeof item !== 'string' || item.length === 0 || item.length > 64)
  )
    throw new TypeError('invalid compressed texture formats')
  return new Set(value)
}

/** Bytes of one 4x4 block of a BC-compressed image, as `RasterImageInfo.compression` names it. */
function blockBytes(compression: RasterImageInfo['compression']): number | undefined {
  if (compression === 'bc1' || compression === 'bc4') return 8
  if (compression === 'bc2' || compression === 'bc3' || compression === 'bc5') return 16
  if (compression === 'bc6h' || compression === 'bc7') return 16
  return undefined
}

/**
 * The level of a block-compressed image to hand over as blocks, and the bytes of it with every
 * smaller stored level (what a renderer uploads). `'fit'` takes the most detailed stored level
 * whose chain fits `maxBytes`; computed levels are not blocks and are never chosen. Undefined when
 * the image is not block-compressed or the selection is not one plane.
 */
export function compressedSelectionPlan(
  info: RasterImageInfo,
  selection: RasterResourceSelection,
  maxBytes: number,
): { readonly mipLevel: number; readonly bytes: number } | undefined {
  const block = blockBytes(info.compression)
  if (block === undefined || selection.face === 'all' || info.depth !== 1) return undefined
  const stored = info.storedMipLevels ?? info.mipLevels
  const chain = (level: number) => {
    let bytes = 0
    for (let index = level; index < stored; index++)
      bytes +=
        Math.ceil(Math.max(1, Math.floor(info.width / 2 ** index)) / 4) *
        Math.ceil(Math.max(1, Math.floor(info.height / 2 ** index)) / 4) *
        block
    return bytes
  }
  const selected = selection.mipLevel ?? 0
  const mipLevel =
    selected === 'fit'
      ? Array.from({ length: stored }, (_, index) => index).find(level => chain(level) <= maxBytes)
      : selected
  if (mipLevel === undefined || mipLevel >= stored) return undefined
  const bytes = chain(mipLevel)
  return bytes <= maxBytes ? Object.freeze({ mipLevel, bytes }) : undefined
}

/** Full selected 2D planes, with one shared byte ceiling for an all-face read. */
export function rasterSelectionPlan(
  info: RasterImageInfo,
  selection: RasterResourceSelection,
  maxBytes: number,
) {
  for (const key of ['width', 'height', 'depth', 'layers', 'faces', 'mipLevels', 'frames'] as const)
    if (!Number.isSafeInteger(info[key]) || info[key] <= 0)
      throw new TypeError(`invalid raster ${key}`)
  const face = selection.face ?? 0
  if (face !== 'all' && face >= info.faces) throw new RangeError('raster face is out of range')
  const count = face === 'all' ? info.faces : 1
  const selectedMipLevel = selection.mipLevel ?? 0
  const mipLevel =
    selectedMipLevel === 'fit'
      ? Array.from({ length: info.mipLevels }, (_, index) => index).find(level => {
          const width = Math.max(1, Math.floor(info.width / 2 ** level))
          const height = Math.max(1, Math.floor(info.height / 2 ** level))
          const bytes = width * height * 4 * count
          return Number.isSafeInteger(bytes) && bytes <= maxBytes
        })
      : selectedMipLevel
  if (mipLevel === undefined)
    throw new ModkitError({
      code: 'x3.host/resource-budget-exceeded',
      message: 'no raster mip fits the decoded byte budget',
    })
  if (mipLevel >= info.mipLevels) throw new RangeError('raster mip level is out of range')
  const width = Math.max(1, Math.floor(info.width / 2 ** mipLevel))
  const height = Math.max(1, Math.floor(info.height / 2 ** mipLevel))
  const depth = Math.max(1, Math.floor(info.depth / 2 ** mipLevel))
  const base = {
    frame: selection.frame ?? 0,
    mipLevel,
    layer: selection.layer ?? 0,
    slice: selection.slice ?? 0,
  }
  if (base.frame >= info.frames || base.layer >= info.layers || base.slice >= depth)
    throw new RangeError('raster frame, layer or slice is out of range')
  const bytes = width * height * 4 * count
  if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
    throw new ModkitError({
      code: 'x3.host/resource-budget-exceeded',
      message: 'selected raster surfaces exceed the decoded byte budget',
    })
  const subresources: readonly RasterSubresource[] = Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({ ...base, face: face === 'all' ? index : face }),
    ),
  )
  return { width, height, subresources }
}
