/** Shared decoded-model geometry helpers: byte accounting, voxel surfaces and rigid cell binding.
 * Portable; no native game semantics, resource loading, or UVM serialization.
 */
import type { ModelPrimitive } from '@modkit/sdk'

export { decodeVl32, voxelSurface, type VoxelGrid, type VoxelGeometryOptions } from './voxel.js'
export {
  bindVoxelCellsToParts,
  type VoxelBindingPoint,
  type VoxelBindingTriangle,
  type VoxelBindingOptions,
  type VoxelPartBinding,
} from './voxel-binding.js'

/** Bytes in one owned primitive, including the compatibility UV0 copy and every authored UV set. */
export function modelPrimitiveByteLength(primitive: ModelPrimitive): number {
  return (
    primitive.positions.byteLength +
    (primitive.indices?.byteLength ?? 0) +
    (primitive.normals?.byteLength ?? 0) +
    (primitive.tangents?.byteLength ?? 0) +
    (primitive.colors?.byteLength ?? 0) +
    (primitive.boneIndices?.byteLength ?? 0) +
    (primitive.boneWeights?.byteLength ?? 0) +
    (primitive.textureCoordinates?.byteLength ?? 0) +
    (primitive.textureCoordinateSets?.reduce(
      (total, channel) => total + channel.coordinates.byteLength,
      0,
    ) ?? 0)
  )
}
