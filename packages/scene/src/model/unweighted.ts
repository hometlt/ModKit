import type { ModelBoneBinding, ModelNode, ModelPrimitive } from '@modkit/sdk'
import type { ModelProjection } from '@modkit/uv/model/materializer'
import { modelPrimitiveByteLength } from '@modkit/codec-kit/model/geometry'

export interface GeneratedSkinBinding {
  readonly hierarchyId: string
  readonly boneIndex: number
  readonly nodeId: string
  readonly primitives: readonly { readonly id: string; readonly vertices: number }[]
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Import preparation for formats whose CPU skinning leaves exactly unweighted vertices in
 * model space. Express that policy with a constant identity joint before UVM serialization.
 * This is opt-in: the UVM writer still rejects zero weights without this explicit preparation.
 *
 * Unchanged fields/buffers are borrowed. Only replacement skin buffers and generated nodes/bones
 * are owned here; consume the result synchronously or snapshot it before retaining it. Native
 * skeleton, frame and animation validity still belong to the common UVM materializer. Unknown
 * native bind transforms are never replaced. Directions retain the writer's unit-vector policy.
 */
export function preserveUnweightedVertices(
  projection: ModelProjection,
  options: { readonly maxBytes: number; readonly maxNodes: number; readonly signal?: AbortSignal },
): {
  readonly projection: ModelProjection
  readonly generatedBindings: readonly GeneratedSkinBinding[]
} {
  const { maxBytes, maxNodes, signal } = options
  signal?.throwIfAborted()
  for (const limit of [maxBytes, maxNodes])
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError('invalid skin preparation budget')
  const nodes = projection.nodes ?? []
  const bones = projection.skeleton ?? []
  const primitives = projection.primitives ?? []
  if (nodes.length + bones.length + primitives.length > maxNodes)
    throw new RangeError('skin preparation exceeds maxNodes')
  let bytes = 0
  const charge = (length: number) => {
    bytes += length
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
      throw new RangeError('skin preparation exceeds maxBytes')
  }
  // Reserve source and replacement storage before allocating a replacement typed array.
  for (const primitive of primitives) charge(modelPrimitiveByteLength(primitive))
  const indicesByHierarchy = new Map<string, Set<number>>()
  for (const bone of bones) {
    signal?.throwIfAborted()
    if (bone.hierarchyId === undefined) continue
    let indices = indicesByHierarchy.get(bone.hierarchyId)
    if (indices === undefined) indicesByHierarchy.set(bone.hierarchyId, (indices = new Set()))
    if (!Number.isSafeInteger(bone.boneIndex) || bone.boneIndex < 0 || indices.has(bone.boneIndex))
      throw new TypeError('invalid or duplicate bone index')
    indices.add(bone.boneIndex)
  }
  const affected = new Map<string, { id: string; vertices: number }[]>()
  const primitiveIds = new Set<string>()
  for (const primitive of primitives) {
    if (primitiveIds.has(primitive.id)) throw new TypeError('duplicate primitive id')
    primitiveIds.add(primitive.id)
    const { boneIndices, boneWeights, hierarchyId } = primitive
    if (boneIndices === undefined && boneWeights === undefined) continue
    const count = primitive.positions.length / 3
    const influences = primitive.boneInfluences ?? 4
    if (
      !Number.isSafeInteger(count) ||
      (influences !== 4 && influences !== 8) ||
      boneIndices?.length !== count * influences ||
      boneWeights?.length !== count * influences
    )
      throw new TypeError('skin requires matching indices and weights per vertex')
    const indices = hierarchyId === undefined ? undefined : indicesByHierarchy.get(hierarchyId)
    if (indices === undefined || hierarchyId === undefined)
      throw new TypeError('skin hierarchy is absent')
    let zeroVertices = 0
    for (let vertex = 0; vertex < count; vertex++) {
      if (vertex % 4096 === 0) signal?.throwIfAborted()
      let sum = 0
      for (let slot = 0; slot < influences; slot++) {
        const index = boneIndices[vertex * influences + slot]
        const weight = boneWeights[vertex * influences + slot]
        // Even zero-weight references must be authored and valid; do not hide corrupt bindings.
        if (index === undefined || !indices.has(index)) throw new TypeError('skin joint is absent')
        if (weight === undefined || !Number.isFinite(weight) || weight < 0 || weight > 1)
          throw new TypeError('invalid skin weight')
        sum += weight
      }
      if (sum === 0) zeroVertices++
      else if (Math.abs(sum - 1) > 0.0001) throw new TypeError('skin weights must sum to one')
    }
    if (zeroVertices === 0) continue
    charge(boneIndices.byteLength + boneWeights.byteLength)
    let entries = affected.get(hierarchyId)
    if (entries === undefined) affected.set(hierarchyId, (entries = []))
    entries.push({ id: primitive.id, vertices: zeroVertices })
  }
  if (affected.size === 0) return { projection, generatedBindings: [] }
  if (nodes.length + bones.length + primitives.length + affected.size * 2 > maxNodes)
    throw new RangeError('generated skin bindings exceed maxNodes')
  const nodeIds = new Set(nodes.map(node => node.id))
  if (nodeIds.size !== nodes.length) throw new TypeError('duplicate scene node id')
  const generatedBindings: GeneratedSkinBinding[] = []
  const addedNodes: ModelNode[] = []
  const addedBones: ModelBoneBinding[] = []
  const generatedByPrimitive = new Map<string, number>()
  let suffix = 0
  for (const [hierarchyId, entries] of affected) {
    const indices = indicesByHierarchy.get(hierarchyId)
    if (indices === undefined) throw new TypeError('skin hierarchy is absent')
    if (indices.size >= 65536) throw new RangeError('generated joint exceeds glTF skin joint limit')
    let boneIndex = 0
    while (indices.has(boneIndex)) boneIndex++
    let nodeId: string
    do {
      nodeId = `uvm-unweighted-${suffix++}`
    } while (nodeIds.has(nodeId))
    nodeIds.add(nodeId)
    addedNodes.push({
      id: nodeId,
      name: 'Unweighted vertices (generated)',
      childIds: [],
      meshIds: [],
      transform: identity(),
    })
    addedBones.push({
      partId: nodeId,
      hierarchyId,
      boneIndex,
      nodeId,
      boneName: null,
      provenance: 'absent',
      parentBoneIndex: null,
      localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      inverseBindMatrix: identity(),
    })
    generatedBindings.push({ hierarchyId, boneIndex, nodeId, primitives: entries })
    for (const entry of entries) generatedByPrimitive.set(entry.id, boneIndex)
  }
  const prepared = primitives.map((primitive): ModelPrimitive => {
    const index = generatedByPrimitive.get(primitive.id)
    if (index === undefined) return primitive
    signal?.throwIfAborted()
    if (primitive.boneIndices === undefined || primitive.boneWeights === undefined)
      throw new TypeError('skin buffers are absent')
    const boneIndices = new Uint32Array(primitive.boneIndices)
    const boneWeights = new Float32Array(primitive.boneWeights)
    const influences = primitive.boneInfluences ?? 4
    for (let offset = 0; offset < boneWeights.length; offset += influences) {
      if (offset % 16384 === 0) signal?.throwIfAborted()
      if (boneWeights.subarray(offset, offset + influences).every(weight => weight === 0)) {
        boneIndices.fill(index, offset, offset + influences)
        boneWeights[offset] = 1
      }
    }
    return { ...primitive, boneIndices, boneWeights }
  })
  return {
    projection: {
      ...projection,
      info: { ...projection.info, nodes: nodes.length + addedNodes.length },
      nodes: [...nodes, ...addedNodes],
      skeleton: [...bones, ...addedBones],
      primitives: prepared,
    },
    generatedBindings,
  }
}
