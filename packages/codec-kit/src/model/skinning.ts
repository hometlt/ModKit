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
