/** Structural input of the unchanged CPU skinning kernel; no browser or renderer authority. */
export interface WebGlMeshPlan {
  readonly vertexCount: number
  readonly attributes: {
    readonly strideBytes: number
    readonly positionOffsetBytes: number
    readonly normalOffsetBytes: number
    readonly tangentOffsetBytes: number
  }
  readonly skin?: {
    readonly maxInfluences: number
    readonly boneIndices: Uint32Array
    readonly boneWeights: Float32Array
  }
}
