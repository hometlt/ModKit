import { readSimpleEffect, simpleEffectSolid } from './simple-effect.js'
import type {
  SceneRendererAlphaMode,
  SceneRendererMaterial,
  SceneRendererPrimitive,
} from '@modkit/sdk/renderer'

export interface MaterialAlpha {
  readonly mode: SceneRendererAlphaMode
  readonly cutoff: number
}

export function materialAlpha(material?: SceneRendererMaterial): MaterialAlpha {
  const effect = readSimpleEffect(material?.simpleEffect)
  if (effect !== undefined)
    return { mode: simpleEffectSolid(effect) ? 'opaque' : 'blend', cutoff: effect.alphaCutoff }
  const mode = material?.alphaMode ?? 'opaque',
    cutoff = material?.alphaCutoff ?? 0.5
  if (!['opaque', 'mask', 'blend'].includes(mode))
    throw new TypeError('invalid material alpha mode')
  if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff < 0)
    throw new TypeError('material alpha cutoff must be finite and nonnegative')
  // WebGL uniforms are float32. Keep every valid >1 threshold fully transparent even when
  // its double value would round down to 1 on upload.
  return { mode, cutoff: cutoff > 1 ? 2 : Math.fround(cutoff) }
}

/**
 * Homogeneous center of a positions array's bounds. A primitive's arrays are immutable, and a scene
 * kept between frames sorts the same arrays every frame under another camera: each is read once.
 */
const boundsCenters = new WeakMap<Float32Array, readonly number[]>()
function boundsCenter(positions: Float32Array): readonly number[] {
  let center = boundsCenters.get(positions)
  if (center !== undefined) return center
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) {
    const value = positions[i]
    if (value === undefined || !Number.isFinite(value))
      throw new TypeError('nonfinite blend position')
    const axis = i % 3
    minimum[axis] = Math.min(minimum[axis] ?? Infinity, value)
    maximum[axis] = Math.max(maximum[axis] ?? -Infinity, value)
  }
  center =
    positions.length === 0
      ? [0, 0, 0, 1]
      : minimum.map((v, i) => (v + (maximum[i] ?? 0)) / 2).concat(1)
  boundsCenters.set(positions, center)
  return center
}

/** Solid geometry first, then stable back-to-front primitive bounds centers for source-over.
 * Intersecting translucent primitives still require a geometry split or an order-independent renderer.
 */
export function alphaDrawOrder(
  primitives: readonly SceneRendererPrimitive[],
  alphaFor: (id: string | undefined) => MaterialAlpha,
  viewProjection: Float32Array,
): readonly SceneRendererPrimitive[] {
  const opaque: SceneRendererPrimitive[] = []
  const blended: { primitive: SceneRendererPrimitive; depth: number; order: number }[] = []
  for (const [order, primitive] of primitives.entries()) {
    if (alphaFor(primitive.materialId).mode !== 'blend') {
      opaque.push(primitive)
      continue
    }
    const positions = primitive.positions
    if (!(positions instanceof Float32Array) || positions.length % 3 !== 0)
      throw new TypeError('blend primitive positions must be an xyz Float32Array')
    let center = boundsCenter(positions)
    for (const matrix of [primitive.transform, viewProjection]) {
      if (matrix === undefined) continue
      if (
        !(matrix instanceof Float32Array) ||
        matrix.length !== 16 ||
        !matrix.every(Number.isFinite)
      )
        throw new TypeError('blend transform must be a finite 4x4 matrix')
      center = [0, 1, 2, 3].map(
        row =>
          (matrix[row] ?? 0) * (center[0] ?? 0) +
          (matrix[4 + row] ?? 0) * (center[1] ?? 0) +
          (matrix[8 + row] ?? 0) * (center[2] ?? 0) +
          (matrix[12 + row] ?? 0) * (center[3] ?? 0),
      )
    }
    const z = center[2] ?? 0,
      w = center[3] ?? 0
    const depth = w === 0 ? z : z / w
    if (!Number.isFinite(depth)) throw new TypeError('blend depth exceeds finite range')
    blended.push({ primitive, depth, order })
  }
  blended.sort((a, b) => b.depth - a.depth || a.order - b.order)
  return [...opaque, ...blended.map(item => item.primitive)]
}

/** Both backends accumulate premultiplied RGBA; the public frame is straight RGBA8. */
export function straightenAlpha(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] ?? 0
    for (let channel = 0; channel < 3; channel++)
      rgba[i + channel] =
        alpha === 0 ? 0 : Math.min(255, Math.round(((rgba[i + channel] ?? 0) * 255) / alpha))
  }
}
