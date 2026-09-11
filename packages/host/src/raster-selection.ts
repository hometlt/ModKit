import type { RasterImageInfo, RasterResourceSelection, RasterSubresource } from '@modkit/sdk'
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
  const owned: Record<string, number | 'all'> = {}
  for (const key of coordinates) {
    const item = value[key]
    if (item === undefined) continue
    if (key === 'face' && item === 'all') {
      owned[key] = item
      continue
    }
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0)
      throw new TypeError(`raster ${key} must be a nonnegative safe integer`)
    owned[key] = item
  }
  return Object.freeze(owned)
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
  const mipLevel = selection.mipLevel ?? 0
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
  const face = selection.face ?? 0
  if (face !== 'all' && face >= info.faces) throw new RangeError('raster face is out of range')
  const count = face === 'all' ? info.faces : 1
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
