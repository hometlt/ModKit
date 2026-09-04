import type { CodecIssue } from '../legacy/models/codec.js'
import type { RenderMesh, RenderModel } from '../legacy-model-support.js'

export type WestwoodVec3 = readonly [number, number, number]
export type WestwoodVec4 = readonly [number, number, number, number]

export interface WestwoodBindPivot {
  index: number
  name: string
  parentIndex: number
  translation: WestwoodVec3
  rotation: WestwoodVec4
}

export interface WestwoodBindPose {
  localMatrices: Float32Array[]
  worldMatrices: Float32Array[]
  inverseWorldMatrices: Float32Array[]
}

export interface WestwoodBindOptions {
  issuePrefix: 'westwood-w3d' | 'sage-w3x'
  metadataPrefix: 'w3d' | 'w3x'
  rigidBindingName: 'hlod' | 'container'
}

export function buildWestwoodBindPose(
  pivots: readonly WestwoodBindPivot[],
  hierarchyName: string,
  issues: CodecIssue[],
  issuePrefix: WestwoodBindOptions['issuePrefix'],
): WestwoodBindPose {
  const maxIndex = pivots.reduce((maximum, pivot) => Math.max(maximum, pivot.index), -1)
  const localMatrices = Array.from({ length: maxIndex + 1 }, westwoodIdentityMatrix4)
  const worldMatrices = Array.from({ length: maxIndex + 1 }, westwoodIdentityMatrix4)
  const inverseWorldMatrices = Array.from({ length: maxIndex + 1 }, westwoodIdentityMatrix4)
  const pivotByIndex = new Map(pivots.map(pivot => [pivot.index, pivot]))
  const resolved = new Set<number>()
  const resolving = new Set<number>()
  const warnedParents = new Set<number>()

  for (const pivot of pivots) {
    localMatrices[pivot.index] = westwoodTransformMatrix(pivot.translation, pivot.rotation)
  }

  const resolveWorld = (index: number): Float32Array => {
    if (resolved.has(index)) return worldMatrices[index] ?? westwoodIdentityMatrix4()
    const pivot = pivotByIndex.get(index)
    const local = localMatrices[index] ?? westwoodIdentityMatrix4()
    if (!pivot) return local
    if (resolving.has(index)) {
      if (!warnedParents.has(index)) {
        warnedParents.add(index)
        issues.push({
          severity: 'warning',
          code: `${issuePrefix}-hierarchy-cycle`,
          message: `Westwood hierarchy "${hierarchyName}" contains a parent cycle at pivot ${index}; that pivot was treated as a root.`,
        })
      }
      return local
    }

    resolving.add(index)
    let world = local
    if (pivot.parentIndex >= 0) {
      if (pivotByIndex.has(pivot.parentIndex) && pivot.parentIndex !== index) {
        world = westwoodMultiplyMatrix4(resolveWorld(pivot.parentIndex), local)
      } else if (!warnedParents.has(index)) {
        warnedParents.add(index)
        issues.push({
          severity: 'warning',
          code: `${issuePrefix}-hierarchy-parent-invalid`,
          message: `Westwood hierarchy "${hierarchyName}" pivot ${index} references missing parent ${pivot.parentIndex}; that pivot was treated as a root.`,
        })
      }
    }
    resolving.delete(index)
    resolved.add(index)
    worldMatrices[index] = world
    inverseWorldMatrices[index] = westwoodInvertRigidMatrix4(world)
    return world
  }

  for (const pivot of pivots) resolveWorld(pivot.index)
  return { localMatrices, worldMatrices, inverseWorldMatrices }
}

export function westwoodSkeletonBones(
  pivots: readonly WestwoodBindPivot[],
  bindPose: WestwoodBindPose,
): RenderModel['skeleton']['bones'] {
  return pivots.map(pivot => ({
    index: pivot.index,
    name: pivot.name,
    parentIndex: pivot.parentIndex,
    inverseBindMatrix: new Float32Array(
      bindPose.inverseWorldMatrices[pivot.index] ?? westwoodIdentityMatrix4(),
    ),
  }))
}

export function applyWestwoodBindPoseToMeshes(
  meshes: RenderMesh[],
  hierarchyName: string,
  bindPose: WestwoodBindPose,
  issues: CodecIssue[],
  options: WestwoodBindOptions,
): void {
  const warned = new Set<string>()
  const appliedKey = `${options.metadataPrefix}BindPoseApplied`
  const hierarchyKey = `${options.metadataPrefix}BindHierarchy`
  const referenceKey = `${options.metadataPrefix}BindReference`
  for (const mesh of meshes) {
    if (mesh.metadata?.['westwoodBindPoseApplied'] || mesh.metadata?.[appliedKey]) continue
    const vertexCount = Math.floor(mesh.positions.length / 3)
    if (vertexCount === 0) continue

    let referenceMatrices: Array<Float32Array | undefined> | null = null
    let referenceKind: 'skin' | 'rigid' | null = null
    if (
      mesh.boneIndices?.length === vertexCount * 4 &&
      mesh.boneWeights?.length === vertexCount * 4
    ) {
      referenceMatrices = new Array<Float32Array | undefined>(vertexCount)
      const weights = new Float32Array(mesh.boneWeights)
      let invalidInfluence = false
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const primaryOffset = vertex * 4
        const primaryMatrix = bindPose.worldMatrices[mesh.boneIndices[primaryOffset] ?? -1]
        if (primaryMatrix) {
          // The first position stream is local to the primary influence bone,
          // even when that influence contributes no blend weight.
          referenceMatrices[vertex] = primaryMatrix
        } else {
          invalidInfluence = true
        }
        let total = 0
        for (let slot = 0; slot < 4; slot += 1) {
          const offset = vertex * 4 + slot
          const weight = weights[offset] ?? 0
          const matrix = bindPose.worldMatrices[mesh.boneIndices[offset] ?? -1]
          if (!(weight > 0) || !Number.isFinite(weight)) {
            weights[offset] = 0
            continue
          }
          if (!matrix) {
            invalidInfluence = true
            weights[offset] = 0
            continue
          }
          // Invalid primary indices can still fall back to a valid weighted stream.
          if (!referenceMatrices[vertex]) referenceMatrices[vertex] = matrix
          total += weight
        }
        if (total > 0) {
          for (let slot = 0; slot < 4; slot += 1) {
            const offset = vertex * 4 + slot
            weights[offset] = (weights[offset] ?? 0) / total
          }
        } else if (primaryMatrix) {
          weights[primaryOffset] = 1
        } else {
          invalidInfluence = true
        }
      }
      mesh.boneWeights = weights
      referenceKind = 'skin'
      if (invalidInfluence) {
        const sourceName = String(mesh.metadata?.['sourceMeshName'] ?? mesh.name)
        if (!warned.has(`skin:${sourceName}`)) {
          warned.add(`skin:${sourceName}`)
          issues.push({
            severity: 'warning',
            code: `${options.issuePrefix}-bone-influence-out-of-range`,
            message: `Westwood mesh "${sourceName}" contains a bone influence outside hierarchy "${hierarchyName}"; invalid weights were ignored.`,
          })
        }
      }
    } else {
      const boundBone = Number(mesh.metadata?.['w3xBoneIndex'])
      if (Number.isInteger(boundBone) && boundBone >= 0) {
        const matrix = bindPose.worldMatrices[boundBone]
        if (matrix) {
          referenceMatrices = Array.from({ length: vertexCount }, () => matrix)
          referenceKind = 'rigid'
        } else {
          const sourceName = String(mesh.metadata?.['sourceMeshName'] ?? mesh.name)
          if (!warned.has(`rigid:${sourceName}`)) {
            warned.add(`rigid:${sourceName}`)
            issues.push({
              severity: 'warning',
              code: `${options.issuePrefix}-${options.rigidBindingName}-bone-out-of-range`,
              message: `Westwood mesh "${sourceName}" is bound to missing hierarchy pivot ${boundBone}.`,
            })
          }
        }
      }
    }

    if (!referenceMatrices || !referenceMatrices.some(Boolean)) continue
    applyWestwoodVertexTransforms(mesh, referenceMatrices)
    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      westwoodBindPoseApplied: true,
      westwoodBindHierarchy: hierarchyName,
      westwoodBindReference: referenceKind,
      [appliedKey]: true,
      [hierarchyKey]: hierarchyName,
      [referenceKey]: referenceKind,
    }
  }
}

export function normalizeWestwoodQuaternion(value: WestwoodVec4): WestwoodVec4 {
  const length = Math.hypot(value[0], value[1], value[2], value[3])
  return length > 0 && Number.isFinite(length)
    ? [value[0] / length, value[1] / length, value[2] / length, value[3] / length]
    : [0, 0, 0, 1]
}

export function multiplyWestwoodQuaternions(left: WestwoodVec4, right: WestwoodVec4): WestwoodVec4 {
  const a = normalizeWestwoodQuaternion(left)
  const b = normalizeWestwoodQuaternion(right)
  return normalizeWestwoodQuaternion([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ])
}

export function rotateWestwoodVectorByQuaternion(
  value: WestwoodVec3,
  rotation: WestwoodVec4,
): WestwoodVec3 {
  const [x, y, z, w] = normalizeWestwoodQuaternion(rotation)
  const uvx = y * value[2] - z * value[1]
  const uvy = z * value[0] - x * value[2]
  const uvz = x * value[1] - y * value[0]
  const uuvx = y * uvz - z * uvy
  const uuvy = z * uvx - x * uvz
  const uuvz = x * uvy - y * uvx
  return [
    value[0] + 2 * (w * uvx + uuvx),
    value[1] + 2 * (w * uvy + uuvy),
    value[2] + 2 * (w * uvz + uuvz),
  ]
}

export function westwoodQuaternionFromEulerXyz(angles: WestwoodVec3): WestwoodVec4 {
  const x = Math.sin(angles[0] / 2)
  const y = Math.sin(angles[1] / 2)
  const z = Math.sin(angles[2] / 2)
  const qx: WestwoodVec4 = [x, 0, 0, Math.cos(angles[0] / 2)]
  const qy: WestwoodVec4 = [0, y, 0, Math.cos(angles[1] / 2)]
  const qz: WestwoodVec4 = [0, 0, z, Math.cos(angles[2] / 2)]
  return multiplyWestwoodQuaternions(qz, multiplyWestwoodQuaternions(qy, qx))
}

function applyWestwoodVertexTransforms(
  mesh: RenderMesh,
  matrices: readonly (Float32Array | undefined)[],
): void {
  const vertexCount = Math.floor(mesh.positions.length / 3)
  const positions = new Float32Array(mesh.positions)
  const normals = mesh.normals?.length === vertexCount * 3 ? new Float32Array(mesh.normals) : null
  const tangents =
    mesh.tangents?.length === vertexCount * 4 ? new Float32Array(mesh.tangents) : null
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const matrix = matrices[vertex]
    if (!matrix) continue
    const offset = vertex * 3
    const position = westwoodTransformPoint(
      matrix,
      positions[offset] ?? 0,
      positions[offset + 1] ?? 0,
      positions[offset + 2] ?? 0,
    )
    positions[offset] = position[0]
    positions[offset + 1] = position[1]
    positions[offset + 2] = position[2]
    if (normals) {
      const normal = normalizeWestwoodVec3(
        westwoodTransformVector(
          matrix,
          normals[offset] ?? 0,
          normals[offset + 1] ?? 0,
          normals[offset + 2] ?? 1,
        ),
      )
      normals[offset] = normal[0]
      normals[offset + 1] = normal[1]
      normals[offset + 2] = normal[2]
    }
    if (tangents) {
      const tangentOffset = vertex * 4
      const tangent = normalizeWestwoodVec3(
        westwoodTransformVector(
          matrix,
          tangents[tangentOffset] ?? 1,
          tangents[tangentOffset + 1] ?? 0,
          tangents[tangentOffset + 2] ?? 0,
        ),
      )
      tangents[tangentOffset] = tangent[0]
      tangents[tangentOffset + 1] = tangent[1]
      tangents[tangentOffset + 2] = tangent[2]
    }
  }
  mesh.positions = positions
  if (normals) mesh.normals = normals
  if (tangents) mesh.tangents = tangents
}

function westwoodIdentityMatrix4(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

function westwoodTransformMatrix(translation: WestwoodVec3, rotation: WestwoodVec4): Float32Array {
  const [x, y, z, w] = normalizeWestwoodQuaternion(rotation)
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  return new Float32Array([
    1 - yy - zz,
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - xx - zz,
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - xx - yy,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ])
}

function westwoodMultiplyMatrix4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      out[column * 4 + row] =
        (a[row] ?? 0) * (b[column * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[column * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[column * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[column * 4 + 3] ?? 0)
    }
  }
  return out
}

function westwoodInvertRigidMatrix4(matrix: Float32Array): Float32Array {
  const out = westwoodIdentityMatrix4()
  out[0] = matrix[0] ?? 1
  out[1] = matrix[4] ?? 0
  out[2] = matrix[8] ?? 0
  out[4] = matrix[1] ?? 0
  out[5] = matrix[5] ?? 1
  out[6] = matrix[9] ?? 0
  out[8] = matrix[2] ?? 0
  out[9] = matrix[6] ?? 0
  out[10] = matrix[10] ?? 1
  const x = matrix[12] ?? 0
  const y = matrix[13] ?? 0
  const z = matrix[14] ?? 0
  out[12] = -((out[0] ?? 0) * x + (out[4] ?? 0) * y + (out[8] ?? 0) * z)
  out[13] = -((out[1] ?? 0) * x + (out[5] ?? 0) * y + (out[9] ?? 0) * z)
  out[14] = -((out[2] ?? 0) * x + (out[6] ?? 0) * y + (out[10] ?? 0) * z)
  return out
}

function westwoodTransformPoint(
  matrix: Float32Array,
  x: number,
  y: number,
  z: number,
): WestwoodVec3 {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ]
}

function westwoodTransformVector(
  matrix: Float32Array,
  x: number,
  y: number,
  z: number,
): WestwoodVec3 {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z,
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z,
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z,
  ]
}

function normalizeWestwoodVec3(value: WestwoodVec3): WestwoodVec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0]
}
