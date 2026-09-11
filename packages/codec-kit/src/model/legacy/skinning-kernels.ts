// Generated from immutable MK2 declarations. Change the strict adapter, not these algorithms.
// Source selection: packages/codec-kit/model-skinning-kernels.config.json
import type { WebGlMeshPlan } from './skinning-types.js'

function skinInterleaved(
  source: Float32Array,
  mesh: WebGlMeshPlan,
  matrices: readonly Float32Array[],
  target?: Float32Array,
): Float32Array {
  if (!mesh.skin) return new Float32Array(source)
  const out = target?.length === source.length ? target : new Float32Array(source.length)
  out.set(source)
  const stride = mesh.attributes.strideBytes / Float32Array.BYTES_PER_ELEMENT
  const positionOffset = mesh.attributes.positionOffsetBytes / Float32Array.BYTES_PER_ELEMENT
  const normalOffset = mesh.attributes.normalOffsetBytes / Float32Array.BYTES_PER_ELEMENT
  const tangentOffset = mesh.attributes.tangentOffsetBytes / Float32Array.BYTES_PER_ELEMENT

  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const vertexBase = vertex * stride
    const skinBase = vertex * mesh.skin.maxInfluences
    const px = source[vertexBase + positionOffset] ?? 0
    const py = source[vertexBase + positionOffset + 1] ?? 0
    const pz = source[vertexBase + positionOffset + 2] ?? 0
    const nx = source[vertexBase + normalOffset] ?? 0
    const ny = source[vertexBase + normalOffset + 1] ?? 0
    const nz = source[vertexBase + normalOffset + 2] ?? 1
    const tx = source[vertexBase + tangentOffset] ?? 1
    const ty = source[vertexBase + tangentOffset + 1] ?? 0
    const tz = source[vertexBase + tangentOffset + 2] ?? 0
    let weightSum = 0
    let x = 0
    let y = 0
    let z = 0
    let normalX = 0
    let normalY = 0
    let normalZ = 0
    let tangentX = 0
    let tangentY = 0
    let tangentZ = 0

    for (let slot = 0; slot < mesh.skin.maxInfluences; slot += 1) {
      const weight = mesh.skin.boneWeights[skinBase + slot] ?? 0
      if (weight <= 0) continue
      const matrix = matrices[mesh.skin.boneIndices[skinBase + slot] ?? 0]
      if (!matrix) continue
      const transformed = transformPoint(matrix, px, py, pz)
      const transformedNormal = transformVector(matrix, nx, ny, nz)
      const transformedTangent = transformVector(matrix, tx, ty, tz)
      x += transformed[0] * weight
      y += transformed[1] * weight
      z += transformed[2] * weight
      normalX += transformedNormal[0] * weight
      normalY += transformedNormal[1] * weight
      normalZ += transformedNormal[2] * weight
      tangentX += transformedTangent[0] * weight
      tangentY += transformedTangent[1] * weight
      tangentZ += transformedTangent[2] * weight
      weightSum += weight
    }

    if (weightSum > 0) {
      out[vertexBase + positionOffset] = x / weightSum
      out[vertexBase + positionOffset + 1] = y / weightSum
      out[vertexBase + positionOffset + 2] = z / weightSum
      const normalLength = Math.hypot(normalX, normalY, normalZ) || 1
      out[vertexBase + normalOffset] = normalX / normalLength
      out[vertexBase + normalOffset + 1] = normalY / normalLength
      out[vertexBase + normalOffset + 2] = normalZ / normalLength
      const tangentLength = Math.hypot(tangentX, tangentY, tangentZ) || 1
      out[vertexBase + tangentOffset] = tangentX / tangentLength
      out[vertexBase + tangentOffset + 1] = tangentY / tangentLength
      out[vertexBase + tangentOffset + 2] = tangentZ / tangentLength
    }
  }

  return out
}

function transformPoint(
  matrix: Float32Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ]
}

function transformVector(
  matrix: Float32Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z,
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z,
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z,
  ]
}

export { skinInterleaved }
