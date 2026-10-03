import type { ModelPrimitive } from '@modkit/sdk'
import type { ModelBonePoseSample } from './skeleton.js'
import { skinInterleaved } from './legacy/skinning-kernels.js'
import { invertAffine } from '../model-math/transform.js'

/**
 * The kernel's interleaved output, shared by every deform: a deform runs to completion and copies
 * the attributes its frame owns out of it, so one buffer of the largest skin serves them all.
 */
let kernelOutput = new Float32Array(0)

/** Compile buffer layout and sparse bone joins once. Output frames own their deformed attributes. */
export function createModelSkinDeformer(
  primitive: ModelPrimitive,
  boneIndices: readonly number[],
  maxBytes = 134_217_728,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  const count = primitive.positions.length / 3
  const influences = primitive.boneInfluences ?? 4
  if (influences !== 4 && influences !== 8) throw new TypeError('unsupported skin influence count')
  if (!Number.isSafeInteger(count) || !primitive.positions.every(Number.isFinite))
    throw new TypeError('invalid skin positions')
  // Source + kernel output + decoded attributes + remapped indices/weights, including pose buffers.
  const workingBytes = count * (112 + influences * 8) + boneIndices.length * 64
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || workingBytes > maxBytes)
    throw new RangeError('skin deformation exceeds maxBytes')
  const slots = new Map<number, number>()
  for (const [slot, index] of boneIndices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || slots.has(index))
      throw new TypeError('ambiguous skin bone index')
    slots.set(index, slot)
  }
  const { boneWeights, boneIndices: authored } = primitive
  if (
    !primitive.hierarchyId ||
    authored?.length !== count * influences ||
    boneWeights?.length !== count * influences
  )
    throw new TypeError(
      'skin requires an explicit hierarchy and matching indices and weights per vertex',
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
    for (let influence = 0; influence < influences; influence++) {
      const index = vertex * influences + influence
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
    skin: { maxInfluences: influences, boneIndices: indices, boneWeights: weights },
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
      if (kernelOutput.length < source.length) kernelOutput = new Float32Array(source.length)
      const deformed = skinInterleaved(
        source,
        mesh,
        matrices,
        kernelOutput.subarray(0, source.length),
      )
      for (let index = 0; index < deformed.length; index++)
        if (!Number.isFinite(deformed[index]!))
          throw new RangeError('deformed skin exceeds finite float range')
      // Plain element copies: a subarray view per vertex and attribute cost more than the kernel.
      const positions = new Float32Array(count * 3)
      const normals = primitive.normals ? new Float32Array(count * 3) : undefined
      const tangents = primitive.tangents ? new Float32Array(primitive.tangents) : undefined
      for (let vertex = 0; vertex < count; vertex++) {
        if ((vertex & 1023) === 0 && requestSignal?.aborted)
          throw new DOMException('operation cancelled', 'AbortError')
        const from = vertex * 9,
          to = vertex * 3
        positions[to] = deformed[from]!
        positions[to + 1] = deformed[from + 1]!
        positions[to + 2] = deformed[from + 2]!
        if (normals !== undefined) {
          normals[to] = deformed[from + 3]!
          normals[to + 1] = deformed[from + 4]!
          normals[to + 2] = deformed[from + 5]!
        }
        if (tangents !== undefined) {
          const tangent = vertex * 4
          tangents[tangent] = deformed[from + 6]!
          tangents[tangent + 1] = deformed[from + 7]!
          tangents[tangent + 2] = deformed[from + 8]!
        }
      }
      // Discard bind-pose bounds and skin buffers: these positions are already deformed.
      const {
        bounds: _bounds,
        boneIndices: _indices,
        boneWeights: _weights,
        boneInfluences: _influences,
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

function applyPoint(
  matrix: readonly number[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
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

function applyDirection(
  matrix: readonly number[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
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
  const influences = primitive.boneInfluences ?? 4
  if (
    (influences !== 4 && influences !== 8) ||
    boneIndices?.length !== count * influences ||
    boneWeights?.length !== count * influences
  )
    throw new TypeError('baking a skin requires matching indices and weights per vertex')
  if (indices === undefined) throw new TypeError('baking a skin requires an index buffer')
  const maxBytes = options.maxBytes ?? 134_217_728
  if (count * 64 + indices.length * 8 > maxBytes) throw new RangeError('skin bake exceeds maxBytes')

  // Strongest influence per vertex, and what that choice costs.
  const owner = new Int32Array(count)
  let blendedVertices = 0
  let maxDroppedWeight = 0
  for (let vertex = 0; vertex < count; vertex += 1) {
    if ((vertex & 1023) === 0) signal?.throwIfAborted()
    let best = -1
    let bestWeight = -1
    let secondWeight = 0
    for (let influence = 0; influence < influences; influence += 1) {
      const weight = boneWeights[vertex * influences + influence] ?? 0
      const slot = boneIndices[vertex * influences + influence] ?? 0
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
      const weight = boneWeights[vertex * influences] ?? 0
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
    if (bind === undefined)
      throw new TypeError(`the skin names bone ${String(slot)} with no bind matrix`)
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
          const direction =
            toLocal === undefined ? [nx, ny, nz] : applyDirection(toLocal, nx, ny, nz)
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

/** One draw's worth of triangles, addressing at most the bone budget the caller stated. */
export interface BoneLimitPart {
  /** The distinct bones this part uses, ascending. Its length never exceeds `maxBones`. */
  readonly bones: readonly number[]
  /** The original vertex each of this part's vertices came from, in the part's own order. */
  readonly vertices: Uint32Array
  /** Triangles, as indices into `vertices`. */
  readonly indices: Uint32Array
}

export interface BoneLimitOptions {
  /** Skin stride; absent means four. */
  readonly boneInfluences?: 4 | 8
  /** Most distinct bones one part may address. */
  readonly maxBones: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}

/**
 * Split triangles so no part addresses more bones than a target can bind at once.
 *
 * Every skinned format binds a bounded set of bone matrices per draw and stores each vertex's
 * influence as a small index into that set: StarCraft II's M3 region lookup is one byte wide, and
 * its shaders bind far fewer than that byte could address. A mesh that names more bones than the
 * bound cannot be written truthfully - the surplus either wraps or silently rebinds geometry to
 * whatever bone index zero happens to be - so it is split instead.
 *
 * The split is greedy in triangle order: a triangle joins the current part while its bones still
 * fit, and starts a new one when they do not. That keeps neighbouring triangles together, which
 * is what makes the parts few, and it never reorders or drops a triangle. A single part is
 * returned unchanged when the whole mesh already fits, so a caller can skip the rebuild.
 *
 * ponytail: greedy in authored order, not a clustering pass. Real models come in well under any
 * sane bound, so the parts are usually one; reach for a proper partitioner only if a corpus shows
 * this producing many more draws than a target can afford.
 */
export function splitTrianglesByBoneLimit(
  indices: ArrayLike<number>,
  boneIndices: ArrayLike<number> | undefined,
  boneWeights: ArrayLike<number> | undefined,
  options: BoneLimitOptions,
): readonly BoneLimitPart[] {
  const { maxBones, signal } = options
  const influences = options.boneInfluences ?? 4
  if (influences !== 4 && influences !== 8) throw new TypeError('unsupported skin influence count')
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBones) || maxBones < 1)
    throw new RangeError('a bone budget must be a positive whole number')
  if (indices.length % 3 !== 0) throw new TypeError('splitting a mesh requires whole triangles')
  const maxBytes = options.maxBytes ?? 134_217_728
  if (indices.length * 8 > maxBytes) throw new RangeError('bone split exceeds maxBytes')

  /** The bones one vertex actually follows; an unskinned vertex follows none. */
  const bonesOf = (vertex: number): number[] => {
    if (boneIndices === undefined || boneWeights === undefined) return []
    const out: number[] = []
    for (let influence = 0; influence < influences; influence += 1) {
      const at = vertex * influences + influence
      if (at >= boneIndices.length) break
      const weight = boneWeights[at] ?? 0
      const bone = boneIndices[at] ?? 0
      if (weight > 0 && !out.includes(bone)) out.push(bone)
    }
    return out
  }

  const all = new Set<number>()
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    if ((triangle & 1023) === 0) signal?.throwIfAborted()
    for (let corner = 0; corner < 3; corner += 1)
      for (const bone of bonesOf(indices[triangle + corner] ?? 0)) all.add(bone)
  }
  const whole = (): BoneLimitPart[] => {
    const vertices: number[] = []
    const remap = new Map<number, number>()
    const out = new Uint32Array(indices.length)
    for (let at = 0; at < indices.length; at += 1) {
      const vertex = indices[at] ?? 0
      let mapped = remap.get(vertex)
      if (mapped === undefined) {
        mapped = vertices.length
        remap.set(vertex, mapped)
        vertices.push(vertex)
      }
      out[at] = mapped
    }
    return [
      {
        bones: [...all].sort((left, right) => left - right),
        vertices: Uint32Array.from(vertices),
        indices: out,
      },
    ]
  }
  if (all.size <= maxBones) return whole()

  const parts: BoneLimitPart[] = []
  let bones = new Set<number>()
  let vertices: number[] = []
  let remap = new Map<number, number>()
  let partIndices: number[] = []
  const close = (): void => {
    if (partIndices.length === 0) return
    parts.push({
      bones: [...bones].sort((left, right) => left - right),
      vertices: Uint32Array.from(vertices),
      indices: Uint32Array.from(partIndices),
    })
    bones = new Set<number>()
    vertices = []
    remap = new Map<number, number>()
    partIndices = []
  }
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    signal?.throwIfAborted()
    const corners = [indices[triangle] ?? 0, indices[triangle + 1] ?? 0, indices[triangle + 2] ?? 0]
    const wanted = new Set<number>()
    for (const corner of corners) for (const bone of bonesOf(corner)) wanted.add(bone)
    if (wanted.size > maxBones)
      throw new RangeError(
        `one triangle follows ${String(wanted.size)} bones, more than the budget of ${String(maxBones)}`,
      )
    let added = 0
    for (const bone of wanted) if (!bones.has(bone)) added += 1
    if (bones.size + added > maxBones) close()
    for (const bone of wanted) bones.add(bone)
    for (const corner of corners) {
      let mapped = remap.get(corner)
      if (mapped === undefined) {
        mapped = vertices.length
        remap.set(corner, mapped)
        vertices.push(corner)
      }
      partIndices.push(mapped)
    }
  }
  close()
  return parts
}
