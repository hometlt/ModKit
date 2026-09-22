import type { ModelPrimitive } from '@modkit/sdk'
import type { ModelBonePoseSample } from './skeleton.js'
import { skinInterleaved } from './legacy/skinning-kernels.js'

/** Compile buffer layout and sparse bone joins once. Output frames own their deformed attributes. */
export function createModelSkinDeformer(
  primitive: ModelPrimitive,
  boneIndices: readonly number[],
  maxBytes = 134_217_728,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const count = primitive.positions.length / 3
  if (!Number.isSafeInteger(count) || !primitive.positions.every(Number.isFinite))
    throw new TypeError('invalid skin positions')
  // Source + kernel output + decoded attributes + remapped indices/weights, including pose buffers.
  const workingBytes = count * 144 + boneIndices.length * 64
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || workingBytes > maxBytes)
    throw new RangeError('skin deformation exceeds maxBytes')
  const slots = new Map<number, number>()
  for (const [slot, index] of boneIndices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || slots.has(index))
      throw new TypeError('ambiguous skin bone index')
    slots.set(index, slot)
  }
  const { boneWeights, boneIndices: authored } = primitive
  if (!primitive.hierarchyId || authored?.length !== count * 4 || boneWeights?.length !== count * 4)
    throw new TypeError(
      'skin requires an explicit hierarchy and four indices and weights per vertex',
    )
  for (const [data, width, label] of [
    [primitive.normals, 3, 'normals'],
    [primitive.tangents, 4, 'tangents'],
  ] as const) {
    if (data !== undefined && (data.length !== count * width || !data.every(Number.isFinite)))
      throw new TypeError(`invalid skin ${label}`)
  }
  const indices = new Uint32Array(authored.length)
  const weights = new Float32Array(boneWeights)
  let zeroWeightVertices = 0
  let normalizedWeightVertices = 0
  for (let vertex = 0; vertex < count; vertex++) {
    let sum = 0
    for (let influence = 0; influence < 4; influence++) {
      const index = vertex * 4 + influence
      const weight = weights[index]!
      if (!Number.isFinite(weight) || weight < 0 || weight > 1)
        throw new TypeError('invalid skin weight')
      const slot = slots.get(authored[index]!)
      // Even a zero-weight reference remains an authored join, not an inferred root bone.
      if (slot === undefined) throw new TypeError('skin references an absent bone')
      indices[index] = slot
      sum += weight
    }
    if (sum === 0) zeroWeightVertices++
    else if (Math.abs(sum - 1) > 0.0001) normalizedWeightVertices++
  }
  const source = new Float32Array(count * 9)
  for (let vertex = 0; vertex < count; vertex++) {
    if ((vertex & 1023) === 0 && signal?.aborted)
      throw new DOMException('operation cancelled', 'AbortError')
    source.set(primitive.positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 9)
    if (primitive.normals)
      source.set(primitive.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 9 + 3)
    if (primitive.tangents)
      source.set(primitive.tangents.subarray(vertex * 4, vertex * 4 + 3), vertex * 9 + 6)
  }
  const mesh = {
    vertexCount: count,
    attributes: {
      strideBytes: 36,
      positionOffsetBytes: 0,
      normalOffsetBytes: 12,
      tangentOffsetBytes: 24,
    },
    skin: { maxInfluences: 4, boneIndices: indices, boneWeights: weights },
  }
  return Object.freeze({
    workingBytes,
    zeroWeightVertices,
    normalizedWeightVertices,
    deform(bones: readonly ModelBonePoseSample[], requestSignal?: AbortSignal): ModelPrimitive {
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const matrices: Float32Array[] = new Array(slots.size)
      for (const bone of bones) {
        const slot = slots.get(bone.boneIndex)
        if (slot === undefined) continue
        const matrix = bone.skinningMatrix
        if (matrices[slot] !== undefined || matrix?.length !== 16 || !matrix.every(Number.isFinite))
          throw new TypeError('skin needs a unique explicit inverse-bind pose for each bone')
        matrices[slot] = new Float32Array(matrix)
      }
      for (let slot = 0; slot < matrices.length; slot++)
        if (matrices[slot] === undefined) throw new TypeError('skin pose is incomplete')
      const deformed = skinInterleaved(source, mesh, matrices)
      if (!deformed.every(Number.isFinite))
        throw new RangeError('deformed skin exceeds finite float range')
      const positions = new Float32Array(count * 3)
      const normals = primitive.normals ? new Float32Array(count * 3) : undefined
      const tangents = primitive.tangents ? new Float32Array(primitive.tangents) : undefined
      for (let vertex = 0; vertex < count; vertex++) {
        if ((vertex & 1023) === 0 && requestSignal?.aborted)
          throw new DOMException('operation cancelled', 'AbortError')
        positions.set(deformed.subarray(vertex * 9, vertex * 9 + 3), vertex * 3)
        normals?.set(deformed.subarray(vertex * 9 + 3, vertex * 9 + 6), vertex * 3)
        tangents?.set(deformed.subarray(vertex * 9 + 6, vertex * 9 + 9), vertex * 4)
      }
      // Discard bind-pose bounds and skin buffers: these positions are already deformed.
      const {
        bounds: _bounds,
        boneIndices: _indices,
        boneWeights: _weights,
        hierarchyId: _hierarchy,
        normals: _normals,
        tangents: _tangents,
        ...rest
      } = primitive
      return {
        ...rest,
        positions,
        ...(normals ? { normals } : {}),
        ...(tangents ? { tangents } : {}),
      }
    },
  })
}

/**
 * One bone's share of a baked skin: rigid geometry plus the transform that places it.
 *
 * `transform` is the bone's own world bind matrix, so a target that has no skinning — Warzone's
 * PIE levels, a rigid scene graph — can put the part where the skin had it.
 */
export interface SkinBakePart {
  readonly boneSlot: number
  readonly positions: Float32Array
  readonly normals?: Float32Array
  readonly textureCoordinates?: Float32Array
  readonly indices: Uint32Array
  readonly transform: readonly number[]
}

export interface SkinBakeResult {
  readonly parts: readonly SkinBakePart[]
  /**
   * Vertices whose influences beyond the strongest carried real weight.
   *
   * This is the number a caller must report: baking assigns every vertex to one bone, so a vertex
   * genuinely shared between two bones moves with one of them from here on. Zero means the skin
   * was already rigid and nothing was lost.
   */
  readonly blendedVertices: number
  /** The largest weight that was dropped, so "how badly" is answerable and not a guess. */
  readonly maxDroppedWeight: number
}

export interface SkinBakeOptions {
  /** Column-major world bind matrix per bone slot, in the order the skin's indices address. */
  readonly bindMatrices: readonly (readonly number[])[]
  /**
   * Where the baked vertices land.
   *
   * `bone-local` puts each part in its own bone's frame, which is what a rigid format wants
   * because it will re-apply that bone's transform itself. `model` leaves them where the bind
   * pose had them, for a target that wants one static mesh.
   */
  readonly space?: 'bone-local' | 'model'
  /** A weight at or below this counts as noise rather than a real second influence. */
  readonly blendEpsilon?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

/** Column-major 4x4 inverse for an affine matrix: transpose the basis, then move the origin back. */
function invertAffine(matrix: readonly number[]): number[] {
  const value = (index: number): number => {
    const one = matrix[index]
    return typeof one === 'number' && Number.isFinite(one) ? one : 0
  }
  const basis = [value(0), value(1), value(2), value(4), value(5), value(6), value(8), value(9), value(10)]
  const determinant =
    basis[0]! * (basis[4]! * basis[8]! - basis[5]! * basis[7]!) -
    basis[3]! * (basis[1]! * basis[8]! - basis[2]! * basis[7]!) +
    basis[6]! * (basis[1]! * basis[5]! - basis[2]! * basis[4]!)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new RangeError('a bind matrix with no inverse cannot place a baked part')
  const inverse = [
    (basis[4]! * basis[8]! - basis[5]! * basis[7]!) / determinant,
    (basis[2]! * basis[7]! - basis[1]! * basis[8]!) / determinant,
    (basis[1]! * basis[5]! - basis[2]! * basis[4]!) / determinant,
    (basis[5]! * basis[6]! - basis[3]! * basis[8]!) / determinant,
    (basis[0]! * basis[8]! - basis[2]! * basis[6]!) / determinant,
    (basis[2]! * basis[3]! - basis[0]! * basis[5]!) / determinant,
    (basis[3]! * basis[7]! - basis[4]! * basis[6]!) / determinant,
    (basis[1]! * basis[6]! - basis[0]! * basis[7]!) / determinant,
    (basis[0]! * basis[4]! - basis[1]! * basis[3]!) / determinant,
  ]
  const translation = [value(12), value(13), value(14)]
  const moved = [0, 1, 2].map(
    row => -(inverse[row]! * translation[0]! + inverse[row + 3]! * translation[1]! + inverse[row + 6]! * translation[2]!),
  )
  return [
    inverse[0]!, inverse[1]!, inverse[2]!, 0,
    inverse[3]!, inverse[4]!, inverse[5]!, 0,
    inverse[6]!, inverse[7]!, inverse[8]!, 0,
    moved[0]!, moved[1]!, moved[2]!, 1,
  ]
}

function applyPoint(matrix: readonly number[], x: number, y: number, z: number): [number, number, number] {
  const at = (index: number): number => {
    const one = matrix[index]
    return typeof one === 'number' && Number.isFinite(one) ? one : 0
  }
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ]
}

function applyDirection(matrix: readonly number[], x: number, y: number, z: number): [number, number, number] {
  const at = (index: number): number => {
    const one = matrix[index]
    return typeof one === 'number' && Number.isFinite(one) ? one : 0
  }
  const out: [number, number, number] = [
    at(0) * x + at(4) * y + at(8) * z,
    at(1) * x + at(5) * y + at(9) * z,
    at(2) * x + at(6) * y + at(10) * z,
  ]
  const length = Math.hypot(out[0], out[1], out[2])
  return length === 0 ? out : [out[0] / length, out[1] / length, out[2] / length]
}

/**
 * Turn a skinned primitive into rigid parts, one per bone that owns vertices.
 *
 * A target without skeletal skinning cannot take a weighted mesh: Warzone's PIE has rigid levels
 * and connectors, and Warcraft III's bind pose is pivot points with no per-bone rotation. Baking
 * is how a skin reaches them, and it is lossy in one specific way — each vertex follows exactly
 * one bone from then on — so the result states how many vertices that cost and how much weight
 * was dropped, rather than leaving the caller to claim a clean conversion.
 *
 * A triangle whose three vertices end up on different bones is kept with its strongest bone, so
 * the surface stays closed rather than developing holes at every seam.
 */
export function bakeSkinToRigidParts(
  primitive: ModelPrimitive,
  options: SkinBakeOptions,
): SkinBakeResult {
  const { bindMatrices, signal } = options
  signal?.throwIfAborted()
  const space = options.space ?? 'bone-local'
  const epsilon = options.blendEpsilon ?? 0.001
  const count = primitive.positions.length / 3
  if (!Number.isSafeInteger(count) || count === 0) throw new TypeError('invalid skin positions')
  const { boneIndices, boneWeights, indices } = primitive
  if (boneIndices?.length !== count * 4 || boneWeights?.length !== count * 4)
    throw new TypeError('baking a skin requires four indices and weights per vertex')
  if (indices === undefined) throw new TypeError('baking a skin requires an index buffer')
  const maxBytes = options.maxBytes ?? 134_217_728
  if (count * 64 + indices.length * 8 > maxBytes)
    throw new RangeError('skin bake exceeds maxBytes')

  // Strongest influence per vertex, and what that choice costs.
  const owner = new Int32Array(count)
  let blendedVertices = 0
  let maxDroppedWeight = 0
  for (let vertex = 0; vertex < count; vertex += 1) {
    if ((vertex & 1023) === 0) signal?.throwIfAborted()
    let best = -1
    let bestWeight = -1
    let secondWeight = 0
    for (let influence = 0; influence < 4; influence += 1) {
      const weight = boneWeights[vertex * 4 + influence] ?? 0
      const slot = boneIndices[vertex * 4 + influence] ?? 0
      if (weight > bestWeight) {
        secondWeight = Math.max(secondWeight, bestWeight)
        bestWeight = weight
        best = slot
      } else secondWeight = Math.max(secondWeight, weight)
    }
    owner[vertex] = best < 0 ? 0 : best
    if (secondWeight > epsilon) {
      blendedVertices += 1
      maxDroppedWeight = Math.max(maxDroppedWeight, secondWeight)
    }
  }

  // A triangle belongs to the bone its strongest vertex follows, so no seam opens a hole.
  const triangleOwner = new Map<number, number[]>()
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const vertices = [indices[triangle]!, indices[triangle + 1]!, indices[triangle + 2]!]
    let slot = owner[vertices[0]!]!
    let bestWeight = -1
    for (const vertex of vertices) {
      const weight = boneWeights[vertex * 4] ?? 0
      if (weight > bestWeight) {
        bestWeight = weight
        slot = owner[vertex]!
      }
    }
    const list = triangleOwner.get(slot)
    if (list === undefined) triangleOwner.set(slot, [...vertices])
    else list.push(...vertices)
  }

  const parts: SkinBakePart[] = []
  for (const [slot, vertexList] of [...triangleOwner.entries()].sort((a, b) => a[0] - b[0])) {
    signal?.throwIfAborted()
    const bind = bindMatrices[slot]
    if (bind === undefined) throw new TypeError(`the skin names bone ${String(slot)} with no bind matrix`)
    const toLocal = space === 'bone-local' ? invertAffine(bind) : undefined
    const remap = new Map<number, number>()
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const partIndices = new Uint32Array(vertexList.length)
    for (const [ordinal, vertex] of vertexList.entries()) {
      let mapped = remap.get(vertex)
      if (mapped === undefined) {
        mapped = remap.size
        remap.set(vertex, mapped)
        const x = primitive.positions[vertex * 3] ?? 0
        const y = primitive.positions[vertex * 3 + 1] ?? 0
        const z = primitive.positions[vertex * 3 + 2] ?? 0
        const point = toLocal === undefined ? [x, y, z] : applyPoint(toLocal, x, y, z)
        positions.push(point[0]!, point[1]!, point[2]!)
        if (primitive.normals !== undefined) {
          const nx = primitive.normals[vertex * 3] ?? 0
          const ny = primitive.normals[vertex * 3 + 1] ?? 0
          const nz = primitive.normals[vertex * 3 + 2] ?? 0
          const direction = toLocal === undefined ? [nx, ny, nz] : applyDirection(toLocal, nx, ny, nz)
          normals.push(direction[0]!, direction[1]!, direction[2]!)
        }
        if (primitive.textureCoordinates !== undefined)
          uvs.push(
            primitive.textureCoordinates[vertex * 2] ?? 0,
            primitive.textureCoordinates[vertex * 2 + 1] ?? 0,
          )
      }
      partIndices[ordinal] = mapped
    }
    parts.push({
      boneSlot: slot,
      positions: Float32Array.from(positions),
      ...(normals.length === 0 ? {} : { normals: Float32Array.from(normals) }),
      ...(uvs.length === 0 ? {} : { textureCoordinates: Float32Array.from(uvs) }),
      indices: partIndices,
      transform: [...bind],
    })
  }
  return { parts, blendedVertices, maxDroppedWeight }
}
