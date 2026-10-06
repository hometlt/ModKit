import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'
import type { ModelSceneSkin } from '../model/sampler.js'

/** The pose a sampled skin takes on the GPU (see ModelSceneSkin), if the primitive has one. */
export function materialSkinOf(primitive: SceneRendererPrimitive): ModelSceneSkin | undefined {
  return (primitive as { readonly skin?: ModelSceneSkin }).skin
}

/** Least and greatest x, y and z of a primitive as it stands. */
export interface MaterialBounds {
  readonly minimum: readonly [number, number, number]
  readonly maximum: readonly [number, number, number]
}

/**
 * Each palette slot's box of the vertices it moves (a weight above zero) in the bind pose: six
 * numbers a slot, minimum then maximum; a slot that moves none stays empty, its minimum above its
 * maximum. Per skin vertices (their weights array), with the positions they were read with.
 */
const slotBoxes = new WeakMap<
  Float32Array,
  Readonly<{ positions: Float32Array; boxes: Float64Array }>
>()

function skinSlotBoxes(positions: Float32Array, skin: ModelSceneSkin): Float64Array {
  const kept = slotBoxes.get(skin.weights)
  if (kept !== undefined && kept.positions === positions) return kept.boxes
  const slots = skin.palette.length / 16
  if (!Number.isInteger(slots) || skin.weights.length !== (positions.length / 3) * 4)
    throw new TypeError('invalid material skin')
  const boxes = new Float64Array(slots * 6)
  for (let slot = 0; slot < slots; slot++) {
    boxes.fill(Infinity, slot * 6, slot * 6 + 3)
    boxes.fill(-Infinity, slot * 6 + 3, slot * 6 + 6)
  }
  for (let influence = 0; influence < skin.weights.length; influence++) {
    if (!(skin.weights[influence]! > 0)) continue
    const slot = skin.joints[influence]!
    if (!(slot < slots)) throw new TypeError('invalid material skin')
    const vertex = (influence >> 2) * 3
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[vertex + axis]!
      if (value < boxes[slot * 6 + axis]!) boxes[slot * 6 + axis] = value
      if (value > boxes[slot * 6 + 3 + axis]!) boxes[slot * 6 + 3 + axis] = value
    }
  }
  slotBoxes.set(skin.weights, Object.freeze({ positions, boxes }))
  return boxes
}

/**
 * Each skin's bounds per pose (its palette: placements of one mesh at one clock share it) and per
 * vertices (their slot boxes).
 */
const skinBounds = new WeakMap<Float32Array, WeakMap<Float64Array, MaterialBounds>>()

/**
 * Bounds that hold a skin as it stands, for work on whole primitives (their depth order, their
 * screen boxes), without posing it on the CPU. A posed vertex is its slots' matrices applied to it,
 * weighted, the weights summing to one (see ModelSceneSkin): it lies within the box that spans each
 * of its slots' boxes moved by the slot's matrix. In the bind pose they are the vertices' own bounds;
 * in another they may be wider. A palette matrix that is not affine poses the skin instead.
 */
export function materialSkinBounds(
  primitive: SceneRendererPrimitive,
  skin: ModelSceneSkin,
): MaterialBounds {
  const boxes = skinSlotBoxes(primitive.positions, skin)
  let poses = skinBounds.get(skin.palette)
  const kept = poses?.get(boxes)
  if (kept !== undefined) return kept
  const palette = skin.palette
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let affine = true
  for (let slot = 0; affine && slot * 6 < boxes.length; slot++) {
    const box = slot * 6,
      matrix = slot * 16
    if (!(boxes[box]! <= boxes[box + 3]!)) continue
    affine =
      palette[matrix + 3] === 0 &&
      palette[matrix + 7] === 0 &&
      palette[matrix + 11] === 0 &&
      palette[matrix + 15] === 1
    // the moved box by its centre and half extents: |M| takes each half extent to its widest
    for (let row = 0; affine && row < 3; row++) {
      let center = palette[matrix + 12 + row]!,
        extent = 0
      for (let column = 0; column < 3; column++) {
        const value = palette[matrix + column * 4 + row]!
        center += (value * (boxes[box + column]! + boxes[box + 3 + column]!)) / 2
        extent += (Math.abs(value) * (boxes[box + 3 + column]! - boxes[box + column]!)) / 2
      }
      if (!Number.isFinite(center - extent) || !Number.isFinite(center + extent))
        throw new RangeError('posed skin bounds exceed finite range')
      if (center - extent < minimum[row]!) minimum[row] = center - extent
      if (center + extent > maximum[row]!) maximum[row] = center + extent
    }
  }
  if (!affine) {
    const posed = skin.deformed().positions
    minimum.fill(Infinity)
    maximum.fill(-Infinity)
    for (let index = 0; index < posed.length; index++) {
      const axis = index % 3
      if (posed[index]! < minimum[axis]!) minimum[axis] = posed[index]!
      if (posed[index]! > maximum[axis]!) maximum[axis] = posed[index]!
    }
  }
  const bounds = Object.freeze({
    minimum: Object.freeze(minimum),
    maximum: Object.freeze(maximum),
  })
  if (poses === undefined) skinBounds.set(palette, (poses = new WeakMap()))
  poses.set(boxes, bounds)
  return bounds
}

/** The centre of a skin's bounds as it stands (materialSkinBounds); the origin without vertices. */
export function materialSkinCenter(
  primitive: SceneRendererPrimitive,
  skin: ModelSceneSkin,
): readonly [number, number, number] {
  const { minimum, maximum } = materialSkinBounds(primitive, skin)
  return minimum[0] <= maximum[0]
    ? [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, (minimum[2] + maximum[2]) / 2]
    : [0, 0, 0]
}

/**
 * Clip-space depth (z over w) of each vertex under `matrix`, as the primitive stands. A skin is not
 * posed for it: depth is linear in the position before its division, and a posed vertex is its
 * slots' matrices applied to it, weighted, so each slot's matrix is folded into the depth's two rows
 * once, and a vertex reads its four slots' rows.
 */
export function materialVertexDepths(
  primitive: SceneRendererPrimitive,
  matrix: ArrayLike<number>,
): Float64Array {
  const positions = primitive.positions
  const count = Math.floor(positions.length / 3)
  const depths = new Float64Array(count)
  const skin = materialSkinOf(primitive)
  if (skin === undefined) {
    for (let vertex = 0; vertex < count; vertex++) {
      const x = positions[vertex * 3]!,
        y = positions[vertex * 3 + 1]!,
        z = positions[vertex * 3 + 2]!
      const clipZ = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!
      const clipW = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
      depths[vertex] = clipW === 0 ? clipZ : clipZ / clipW
    }
    return depths
  }
  const slots = skin.palette.length / 16
  if (!Number.isInteger(slots) || skin.weights.length !== count * 4)
    throw new TypeError('invalid material skin')
  // per slot, the depth's z and w rows through the slot's matrix: four columns each
  const rows = new Float64Array(slots * 8)
  for (let slot = 0; slot < slots; slot++)
    for (let column = 0; column < 4; column++) {
      let z = 0,
        w = 0
      for (let row = 0; row < 4; row++) {
        const value = skin.palette[slot * 16 + column * 4 + row]!
        z += matrix[row * 4 + 2]! * value
        w += matrix[row * 4 + 3]! * value
      }
      rows[slot * 8 + column] = z
      rows[slot * 8 + 4 + column] = w
    }
  for (let vertex = 0; vertex < count; vertex++) {
    const x = positions[vertex * 3]!,
      y = positions[vertex * 3 + 1]!,
      z = positions[vertex * 3 + 2]!
    let clipZ = 0,
      clipW = 0
    for (let influence = vertex * 4; influence < vertex * 4 + 4; influence++) {
      const weight = skin.weights[influence]!
      if (weight === 0) continue
      const slot = skin.joints[influence]!
      if (!(slot < slots)) throw new TypeError('invalid material skin')
      const at = slot * 8
      clipZ += weight * (rows[at]! * x + rows[at + 1]! * y + rows[at + 2]! * z + rows[at + 3]!)
      clipW += weight * (rows[at + 4]! * x + rows[at + 5]! * y + rows[at + 6]! * z + rows[at + 7]!)
    }
    depths[vertex] = clipW === 0 ? clipZ : clipZ / clipW
  }
  return depths
}

/**
 * The primitive as it stands, for work on the CPU that reads its vertices (picking, triangles the
 * caller writes itself): a skin posed on the GPU gets its pose's positions, normals and tangents.
 */
export function materialPosedPrimitive<T extends SceneRendererPrimitive>(primitive: T): T {
  const skin = materialSkinOf(primitive)
  if (skin === undefined) return primitive
  const deformed = skin.deformed()
  const { skin: _skin, ...rest } = primitive as T & { readonly skin?: ModelSceneSkin }
  return {
    ...rest,
    positions: deformed.positions,
    ...(deformed.normals === undefined ? {} : { normals: deformed.normals }),
    ...(deformed.tangents === undefined ? {} : { tangents: deformed.tangents }),
  } as unknown as T
}
