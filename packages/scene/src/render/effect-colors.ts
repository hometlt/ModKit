import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'

/** Existing renderer COLOR_0 correspondence for the simple effect pass. The caller owns the
 * immutable scene snapshot. Validate before GPU allocation or per-fragment interpolation. */
export function readSimpleEffectColors(
  primitive: SceneRendererPrimitive,
): Float32Array | undefined {
  const colors = primitive.colors
  if (colors === undefined) return undefined
  const count = primitive.positions.length / 3
  if (
    !Number.isSafeInteger(count) ||
    !(colors instanceof Float32Array) ||
    colors.length !== count * 4 ||
    !colors.every(Number.isFinite)
  )
    throw new TypeError('simple effect colors require one finite RGBA per vertex')
  return colors
}
