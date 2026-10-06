import { readSimpleEffect, simpleEffectSolid } from './simple-effect.js'
import { materialSkinCenter, materialSkinOf, materialVertexDepths } from './material-skin.js'
import { primitiveFade } from './tint.js'
import { multiplyMatrix4 } from '../model/billboard-math.js'
import type {
  SceneRendererAlphaMode,
  SceneRendererMaterial,
  SceneRendererPrimitive,
} from '@modkit/sdk/renderer'

export interface MaterialAlpha {
  readonly mode: SceneRendererAlphaMode
  readonly cutoff: number
  /** The material's own word, else every mode but blend writes depth. */
  readonly depthWrite: boolean
  /** Among blended draws, a higher priority draws later. */
  readonly priority: number
}

export function materialAlpha(material?: SceneRendererMaterial): MaterialAlpha {
  const priority = material?.priority ?? 0
  if (typeof priority !== 'number' || !Number.isFinite(priority))
    throw new TypeError('material priority must be finite')
  if (material?.depthWrite !== undefined && typeof material.depthWrite !== 'boolean')
    throw new TypeError('material depthWrite must be boolean')
  const effect = readSimpleEffect(material?.simpleEffect)
  if (effect !== undefined)
    return {
      mode: simpleEffectSolid(effect) ? 'opaque' : 'blend',
      cutoff: effect.alphaCutoff,
      depthWrite: effect.depthWrite,
      priority,
    }
  const mode = material?.alphaMode ?? 'opaque',
    cutoff = material?.alphaCutoff ?? 0.5
  if (!['opaque', 'mask', 'blend'].includes(mode))
    throw new TypeError('invalid material alpha mode')
  if (typeof cutoff !== 'number' || !Number.isFinite(cutoff) || cutoff < 0)
    throw new TypeError('material alpha cutoff must be finite and nonnegative')
  // WebGL uniforms are float32. Keep every valid >1 threshold fully transparent even when
  // its double value would round down to 1 on upload.
  return {
    mode,
    cutoff: cutoff > 1 ? 2 : Math.fround(cutoff),
    depthWrite: material?.depthWrite ?? mode !== 'blend',
    priority,
  }
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

/** Solid geometry first, then blended by priority and, within one, stable back-to-front primitive
 * bounds centers for source-over. Intersecting translucent primitives still require a geometry
 * split or an order-independent renderer.
 */
export function alphaDrawOrder(
  primitives: readonly SceneRendererPrimitive[],
  alphaFor: (id: string | undefined) => MaterialAlpha,
  viewProjection: Float32Array,
): readonly SceneRendererPrimitive[] {
  const opaque: SceneRendererPrimitive[] = []
  const blending: SceneRendererPrimitive[] = []
  // a fading primitive (tint alpha below 1) is drawn over what is behind it, as a blended one
  for (const primitive of primitives)
    if (alphaFor(primitive.materialId).mode !== 'blend' && primitiveFade(primitive) >= 1)
      opaque.push(primitive)
    else blending.push(primitive)
  const blended: {
    primitive: SceneRendererPrimitive
    priority: number
    depth: number
    order: number
  }[] = []
  for (const [order, primitive] of blending.entries()) {
    const positions = primitive.positions
    if (!(positions instanceof Float32Array) || positions.length % 3 !== 0)
      throw new TypeError('blend primitive positions must be an xyz Float32Array')
    // A skin posed on the GPU is ordered where its pose stands (materialSkinCenter), without posing
    // it on the CPU. A lone blended primitive has no order to find.
    const skin = blending.length > 1 ? materialSkinOf(primitive) : undefined
    let center =
      skin === undefined ? boundsCenter(positions) : [...materialSkinCenter(primitive, skin), 1]
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
    blended.push({ primitive, priority: alphaFor(primitive.materialId).priority, depth, order })
  }
  blended.sort((a, b) => a.priority - b.priority || b.depth - a.depth || a.order - b.order)
  return [...opaque, ...blended.map(item => item.primitive)]
}

/**
 * The last sorted order of each blended primitive's triangles, per its positions, with what it was
 * sorted for: index array, order key (see triangleOrderKey) and, for a skin, its pose.
 */
const sortedTriangles = new WeakMap<
  Float32Array,
  Readonly<{
    indices: unknown
    key: Float64Array
    palette: Float32Array | undefined
    sorted: Uint32Array
  }>
>()

/**
 * The last sorted primitive each blended primitive came back as, with the order key it was sorted
 * for: the placements of one model share their positions but not their placement, so a kept primitive
 * at a still camera finds its own order here whatever its siblings sorted in between.
 */
const sortedPrimitives = new WeakMap<
  SceneRendererPrimitive,
  Readonly<{ key: Float64Array; result: SceneRendererPrimitive }>
>()

/**
 * What the order of a primitive's triangles depends on under `matrix` (the view's projection times
 * the placement). Under an orthographic view (a w row of 0, 0, 0 and a positive constant) it is the
 * direction of the depth row alone: moving the view adds the same to every depth, and zooming scales
 * every depth alike. Under a perspective view it is the whole matrix.
 */
function triangleOrderKey(matrix: ArrayLike<number>): Float64Array {
  if (matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 && matrix[15]! > 0) {
    const length = Math.hypot(matrix[2]!, matrix[6]!, matrix[10]!)
    return length > 0
      ? Float64Array.of(matrix[2]! / length, matrix[6]! / length, matrix[10]! / length)
      : new Float64Array(3)
  }
  return Float64Array.from({ length: 16 }, (_, index) => matrix[index]!)
}

const sameValues = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

/**
 * The corners of a primitive's triangles, three per triangle, as a triangle list: strips alternate
 * their winding, fans share their first vertex.
 */
function triangleCorners(primitive: SceneRendererPrimitive): Uint32Array {
  const order = primitive.indices
  const length = order?.length ?? Math.floor(primitive.positions.length / 3)
  const at = (index: number) => order?.[index] ?? index
  if (primitive.topology === 'triangles') {
    const count = Math.floor(length / 3)
    const corners = new Uint32Array(count * 3)
    for (let index = 0; index < count * 3; index++) corners[index] = at(index)
    return corners
  }
  if (primitive.topology === 'triangle-strip') {
    const count = Math.max(0, length - 2)
    const corners = new Uint32Array(count * 3)
    for (let index = 0; index < count; index += 1)
      if (index % 2 === 0) corners.set([at(index), at(index + 1), at(index + 2)], index * 3)
      else corners.set([at(index + 1), at(index), at(index + 2)], index * 3)
    return corners
  }
  if (primitive.topology === 'triangle-fan') {
    const count = Math.max(0, length - 2)
    const corners = new Uint32Array(count * 3)
    for (let index = 1; index + 1 < length; index += 1)
      corners.set([at(0), at(index), at(index + 1)], (index - 1) * 3)
    return corners
  }
  return new Uint32Array(0)
}

/**
 * A blended primitive's own triangles back to front under `viewProjection`: a chunk's water or glass
 * is one primitive across the chunk (Minecraft), so its triangles need the order `alphaDrawOrder`
 * gives primitives. A skin is ordered as its pose stands, without posing it (materialVertexDepths).
 * Strips and fans come back as triangle lists. A primitive with fewer than two triangles stays as it
 * is, and a view that has not changed the order sorts nothing (triangleOrderKey): the same primitive
 * comes back for the same primitive, and the same index array for the same positions, placement and
 * pose, or for the same order found again.
 */
export function depthSortedTriangles<T extends SceneRendererPrimitive>(
  primitive: T,
  viewProjection: Float32Array,
): T {
  const matrix =
    primitive.transform === undefined
      ? viewProjection
      : multiplyMatrix4(viewProjection, primitive.transform)
  const key = triangleOrderKey(matrix)
  const known = sortedPrimitives.get(primitive)
  if (known !== undefined && sameValues(known.key, key)) return known.result as T
  const order = primitive.indices
  const length = order?.length ?? Math.floor(primitive.positions.length / 3)
  const count =
    primitive.topology === 'triangles'
      ? Math.floor(length / 3)
      : primitive.topology === 'triangle-strip' || primitive.topology === 'triangle-fan'
        ? Math.max(0, length - 2)
        : 0
  if (count < 2) return primitive
  const palette = materialSkinOf(primitive)?.palette
  const kept = sortedTriangles.get(primitive.positions)
  let sorted = kept?.sorted
  if (
    kept === undefined ||
    kept.indices !== order ||
    kept.palette !== palette ||
    !sameValues(kept.key, key)
  ) {
    const corners = triangleCorners(primitive)
    const depth = materialVertexDepths(primitive, matrix)
    const depths = new Float64Array(count)
    const triangles = new Uint32Array(count)
    for (let triangle = 0; triangle < count; triangle++) {
      depths[triangle] =
        (depth[corners[triangle * 3]!] ?? 0) +
        (depth[corners[triangle * 3 + 1]!] ?? 0) +
        (depth[corners[triangle * 3 + 2]!] ?? 0)
      triangles[triangle] = triangle
    }
    triangles.sort((left, right) => depths[right]! - depths[left]! || left - right)
    const next = new Uint32Array(count * 3)
    for (let index = 0; index < count; index++) {
      const from = triangles[index]! * 3
      next[index * 3] = corners[from]!
      next[index * 3 + 1] = corners[from + 1]!
      next[index * 3 + 2] = corners[from + 2]!
    }
    // The order found again keeps its array, and with it the renderer's index buffer.
    sorted =
      kept !== undefined && kept.indices === order && sameValues(kept.sorted, next)
        ? kept.sorted
        : next
    sortedTriangles.set(
      primitive.positions,
      Object.freeze({ indices: order, key, palette, sorted }),
    )
  }
  const result =
    known !== undefined && known.result.indices === sorted
      ? (known.result as T)
      : (Object.freeze({ ...primitive, topology: 'triangles', indices: sorted! }) as T)
  sortedPrimitives.set(primitive, Object.freeze({ key, result }))
  return result
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
