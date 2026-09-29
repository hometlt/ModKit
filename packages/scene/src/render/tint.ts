import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'

/**
 * Tints per vertex (four floats each), multiplied into the draw's colour as `tint` is: many sprites
 * of one tint each drawn as one primitive (an effect emitter's particles, see createUvmEffectFrame).
 */
export function primitiveVertexTints(primitive: SceneRendererPrimitive): Float32Array | undefined {
  return (primitive as { readonly vertexTints?: Float32Array }).vertexTints
}

export function primitiveTint(
  primitive: Pick<SceneRendererPrimitive, 'tint'>,
): [number, number, number, number] {
  const value = primitive.tint ?? [1, 1, 1, 1]
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some(x => !Number.isFinite(x) || x < 0 || x > 1)
  )
    throw new TypeError('primitive tint requires four finite components in 0..1')
  return [value[0], value[1], value[2], value[3]]
}
