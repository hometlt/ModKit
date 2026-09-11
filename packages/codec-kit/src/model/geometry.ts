import type { ModelPrimitive } from '@modkit/sdk'

/** Bytes in one owned primitive, including the compatibility UV0 copy and every authored UV set. */
export function modelPrimitiveByteLength(primitive: ModelPrimitive): number {
  return primitive.positions.byteLength +
    (primitive.indices?.byteLength ?? 0) +
    (primitive.normals?.byteLength ?? 0) +
    (primitive.tangents?.byteLength ?? 0) +
    (primitive.colors?.byteLength ?? 0) +
    (primitive.boneIndices?.byteLength ?? 0) +
    (primitive.boneWeights?.byteLength ?? 0) +
    (primitive.textureCoordinates?.byteLength ?? 0) +
    (primitive.textureCoordinateSets?.reduce((total, channel) => total + channel.coordinates.byteLength, 0) ?? 0)
}
