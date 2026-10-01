import { readSimpleEffect, simpleEffectSolid } from './simple-effect.js'
import { materialPosedPositions } from './material-skin.js'
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
    // A skin posed on the GPU is ordered where its pose stands. A lone blended primitive has no
    // order to find: its checks read the vertices it has, and a skin is not posed on the CPU for it.
    const positions = blending.length > 1 ? materialPosedPositions(primitive) : primitive.positions
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
    blended.push({ primitive, priority: alphaFor(primitive.materialId).priority, depth, order })
  }
  blended.sort((a, b) => a.priority - b.priority || b.depth - a.depth || a.order - b.order)
  return [...opaque, ...blended.map(item => item.primitive)]
}

/** The last sorted order of each blended primitive's triangles, per its positions (see below). */
const sortedTriangles = new WeakMap<
  Float32Array,
  Readonly<{ indices: unknown; matrix: Float32Array; sorted: Uint32Array }>
>()

/**
 * A blended primitive's own triangles back to front under `viewProjection`: a chunk's water or glass
 * is one primitive across the chunk (Minecraft), so its triangles need the order `alphaDrawOrder`
 * gives primitives. Strips and fans come back as triangle lists. A primitive with fewer than two
 * triangles stays as it is, and a view that has not changed sorts nothing: the same index array
 * draws again.
 */
export function depthSortedTriangles<T extends SceneRendererPrimitive>(
  primitive: T,
  viewProjection: Float32Array,
): T {
  const order = primitive.indices
  const length = order?.length ?? Math.floor(primitive.positions.length / 3)
  const corners: number[] = []
  const at = (index: number) => order?.[index] ?? index
  if (primitive.topology === 'triangles')
    for (let index = 0; index + 2 < length; index += 3)
      corners.push(at(index), at(index + 1), at(index + 2))
  else if (primitive.topology === 'triangle-strip')
    for (let index = 0; index + 2 < length; index += 1)
      if (index % 2 === 0) corners.push(at(index), at(index + 1), at(index + 2))
      else corners.push(at(index + 1), at(index), at(index + 2))
  else if (primitive.topology === 'triangle-fan')
    for (let index = 1; index + 1 < length; index += 1)
      corners.push(at(0), at(index), at(index + 1))
  const count = corners.length / 3
  if (count < 2) return primitive
  const matrix =
    primitive.transform === undefined
      ? viewProjection
      : multiplyMatrix4(viewProjection, primitive.transform)
  const kept = sortedTriangles.get(primitive.positions)
  let sorted = kept?.sorted
  if (
    kept === undefined ||
    kept.indices !== order ||
    kept.matrix.some((value, index) => value !== matrix[index])
  ) {
    const positions = materialPosedPositions(primitive)
    const depth = (vertex: number) => {
      const x = positions[vertex * 3] ?? 0,
        y = positions[vertex * 3 + 1] ?? 0,
        z = positions[vertex * 3 + 2] ?? 0
      const clipZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!
      const clipW = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
      return clipW === 0 ? clipZ : clipZ / clipW
    }
    const depths = Array.from(
      { length: count },
      (_, triangle) =>
        depth(corners[triangle * 3]!) +
        depth(corners[triangle * 3 + 1]!) +
        depth(corners[triangle * 3 + 2]!),
    )
    const triangles = Array.from({ length: count }, (_, triangle) => triangle).sort(
      (left, right) => depths[right]! - depths[left]! || left - right,
    )
    sorted = new Uint32Array(count * 3)
    triangles.forEach((triangle, index) =>
      sorted!.set(corners.slice(triangle * 3, triangle * 3 + 3), index * 3),
    )
    sortedTriangles.set(
      primitive.positions,
      Object.freeze({ indices: order, matrix: Float32Array.from(matrix), sorted }),
    )
  }
  return Object.freeze({ ...primitive, topology: 'triangles', indices: sorted! }) as T
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
