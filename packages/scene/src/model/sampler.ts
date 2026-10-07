import {
  applyModelBillboards,
  applyModelFaceCameraBillboard,
  snapshotModelBillboards,
  type ModelBillboardConstraint,
  type BillboardPosition,
  type BillboardRotation,
} from './billboards.js'
import type {
  ModelAnimationClip,
  ModelBoneBinding,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  SceneRendererDiagnostic,
  SceneRendererPrimitive,
} from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { multiplyMat4 } from '@modkit/codec-kit/model-math/sequence-pose'
import {
  createModelPoseSampler,
  createModelPoseBlendSampler,
  snapshotModelSkeleton,
} from '@modkit/codec-kit/model/skeleton'
import {
  animationSnapshotBudget,
  clipEventsBetween,
  createModelAnimationSampler,
} from '@modkit/codec-kit/model/animation'
import type {
  ModelBonePoseSample,
  ModelPoseBlendSample,
  ModelPoseBone,
  ModelPoseMatrices,
} from '@modkit/codec-kit/model/skeleton'
import { createModelSkinDeformer } from '@modkit/codec-kit/model/skinning'
import { modelPrimitiveByteLength } from '@modkit/codec-kit/model/geometry'
import { createNodePoseSampler, type ModelNodePose } from './node-pose.js'

export interface ModelSceneProjection {
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives: readonly ModelPrimitive[]
  readonly skeleton?: readonly ModelBoneBinding[]
  readonly nodePoses?: readonly ModelNodePose[]
}
export interface ModelRenderJoint {
  readonly hierarchyId: string
  readonly boneIndex: number
  readonly name: string | null
  readonly position: readonly [number, number, number]
  readonly parent?: number
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/**
 * The camera one sample is drawn from, for the model's camera-facing nodes: its rotation from camera
 * to the model's frame (`billboardCameraRotation` of the view the model is drawn with) and its
 * position in that frame. An interactive viewer hands it to every `sample`; either part it leaves
 * out falls back to the sampler's own.
 */
export interface ModelSceneCamera {
  readonly rotation?: BillboardRotation
  readonly position?: BillboardPosition
}

/**
 * A skinned primitive posed on the GPU (option `skinning: 'gpu'`): its vertex arrays stay in the
 * bind pose and the vertex stage blends the palette's matrices by `joints` and `weights`, as the CPU
 * kernel does: the weights over their sum, and a vertex without weight left where it is.
 */
export interface ModelSceneSkin {
  /** Four palette slots per vertex. An influence without weight names the identity slot, the last. */
  readonly joints: Uint8Array | Uint16Array
  /** Four weights per vertex over their sum; a vertex without weight has 1, 0, 0, 0. */
  readonly weights: Float32Array
  /**
   * This pose's skinning matrices, column-major 4x4 in float32: the hierarchy's bones in binding
   * order, then the identity. Every sample has its own; primitives of one hierarchy share it.
   */
  readonly palette: Float32Array
  /** This pose on the CPU (positions, normals and tangents), computed when first asked for. */
  deformed(): ModelPrimitive
}

/** Palette slots and weights of a skin's vertices (see ModelSceneSkin), for a validated skin. */
function skinVertices(
  primitive: ModelPrimitive,
  slots: ReadonlyMap<number, number>,
): Pick<ModelSceneSkin, 'joints' | 'weights'> {
  const authored = present(primitive.boneIndices, 'skin indices')
  const source = present(primitive.boneWeights, 'skin weights')
  const identity = slots.size
  const joints = identity < 256 ? new Uint8Array(authored.length) : new Uint16Array(authored.length)
  const weights = new Float32Array(authored.length)
  for (let vertex = 0; vertex < authored.length; vertex += 4) {
    // The kernel's sum: the influences in order, weights being finite and not negative.
    let sum = 0
    for (let influence = 0; influence < 4; influence++) sum += source[vertex + influence]!
    for (let influence = 0; influence < 4; influence++) {
      const weight = source[vertex + influence]!
      joints[vertex + influence] =
        weight > 0 ? present(slots.get(authored[vertex + influence]!), 'skin slot') : identity
      weights[vertex + influence] = weight > 0 ? weight / sum : 0
    }
    if (sum === 0) weights[vertex] = 1
  }
  return { joints, weights }
}

/** A pose's skinning matrices by slot, then the identity (see ModelSceneSkin.palette). */
function skinPalette(
  bones: readonly ModelBonePoseSample[],
  slots: ReadonlyMap<number, number>,
): Float32Array {
  const palette = new Float32Array((slots.size + 1) * 16)
  const filled = new Uint8Array(slots.size)
  for (const bone of bones) {
    const slot = slots.get(bone.boneIndex)
    if (slot === undefined) continue
    const matrix = bone.skinningMatrix
    if (filled[slot] === 1 || matrix?.length !== 16)
      throw new TypeError('skin needs a unique explicit inverse-bind pose for each bone')
    // checked and copied in one pass: every unit posed on the GPU makes its palette each frame
    for (let index = 0; index < 16; index++) {
      const value = matrix[index]!
      if (!Number.isFinite(value))
        throw new TypeError('skin needs a unique explicit inverse-bind pose for each bone')
      palette[slot * 16 + index] = value
    }
    filled[slot] = 1
  }
  if (filled.includes(0)) throw new TypeError('skin pose is incomplete')
  palette.set(IDENTITY, slots.size * 16)
  for (let index = 0; index < palette.length; index++)
    if (!Number.isFinite(palette[index]!))
      throw new RangeError('deformed skin exceeds finite float range')
  return palette
}

/**
 * skinPalette of a pose sampled as matrices (ModelPoseMatrices, its sampler's `bones`): the same
 * palette, checked alike, without the frozen bones.
 */
function skinPaletteOf(
  sampled: ModelPoseMatrices,
  bones: readonly ModelPoseBone[],
  slots: ReadonlyMap<number, number>,
): Float32Array {
  const palette = new Float32Array((slots.size + 1) * 16)
  const filled = new Uint8Array(slots.size)
  const skinning = bones.length * 16
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index]!
    const slot = slots.get(bone.boneIndex)
    if (slot === undefined) continue
    if (filled[slot] === 1 || !bone.skinned)
      throw new TypeError('skin needs a unique explicit inverse-bind pose for each bone')
    for (let value = 0; value < 16; value++) {
      const entry = sampled.matrices[skinning + index * 16 + value]!
      if (!Number.isFinite(entry))
        throw new TypeError('skin needs a unique explicit inverse-bind pose for each bone')
      palette[slot * 16 + value] = entry
    }
    filled[slot] = 1
  }
  if (filled.includes(0)) throw new TypeError('skin pose is incomplete')
  palette.set(IDENTITY, slots.size * 16)
  for (let index = 0; index < palette.length; index++)
    if (!Number.isFinite(palette[index]!))
      throw new RangeError('deformed skin exceeds finite float range')
  return palette
}

/** Whether every value of a matrix is finite. */
function finiteValues(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index++)
    if (!Number.isFinite(values[index]!)) return false
  return true
}

/**
 * A primitive as a sample draws it: `base` with the transform, the skin and the fade (a tint's
 * alpha) it has, in that order.
 */
function placedPrimitive(
  base: ModelPrimitive,
  transform: Float32Array | undefined,
  skin: ModelSceneSkin | undefined,
  fade: number | undefined,
): SceneRendererPrimitive & { readonly skin?: ModelSceneSkin } {
  if (transform === undefined && fade === undefined)
    return skin === undefined ? { ...base } : { ...base, skin }
  return {
    ...base,
    ...(transform === undefined ? {} : { transform }),
    ...(skin === undefined ? {} : { skin }),
    ...(fade === undefined ? {} : { tint: [1, 1, 1, fade] as const }),
  }
}

function present<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new TypeError(`missing scene ${label}`)
  return value
}

/**
 * A primitive with its morph targets added in proportion to their weights (glTF: position and
 * normal deltas, before any skin). Only the weights that are not zero cost anything, so a one-hot
 * vertex animation stays one pass over the vertices.
 */
function morphPrimitive(primitive: ModelPrimitive, weights: readonly number[]): ModelPrimitive {
  const targets = present(primitive.morphTargets, 'morph targets')
  const positions = Float32Array.from(primitive.positions)
  const normals = primitive.normals === undefined ? undefined : Float32Array.from(primitive.normals)
  let normalsMoved = false
  for (let target = 0; target < targets.length; target++) {
    const weight = weights[target] ?? 0
    if (weight === 0) continue
    const deltas = present(targets[target], 'morph target')
    for (let index = 0; index < positions.length; index++)
      positions[index] = (positions[index] ?? 0) + weight * (deltas.positions[index] ?? 0)
    if (normals !== undefined && deltas.normals !== undefined) {
      normalsMoved = true
      for (let index = 0; index < normals.length; index++)
        normals[index] = (normals[index] ?? 0) + weight * (deltas.normals[index] ?? 0)
    }
  }
  if (normals !== undefined && normalsMoved)
    for (let index = 0; index + 2 < normals.length; index += 3) {
      const x = normals[index] ?? 0
      const y = normals[index + 1] ?? 0
      const z = normals[index + 2] ?? 0
      const length = Math.hypot(x, y, z)
      if (length > 0) {
        normals[index] = x / length
        normals[index + 1] = y / length
        normals[index + 2] = z / length
      }
    }
  if (!positions.every(Number.isFinite))
    throw new RangeError('morphed positions exceed finite float range')
  const { bounds: _bounds, ...rest } = primitive
  return { ...rest, positions, ...(normals === undefined ? {} : { normals }) }
}

/** What a renderer draws of a primitive: its morph targets and default visibility end here. */
function drawn(primitive: ModelPrimitive): ModelPrimitive {
  if (primitive.morphTargets === undefined && primitive.hidden === undefined) return primitive
  const { morphTargets: _targets, hidden: _hidden, ...rest } = primitive
  return rest
}

/** Prepare a neutral render snapshot. Native restMatrix is descriptive and is never guessed. */
export function createModelSceneSampler(
  projection: ModelSceneProjection,
  options: {
    /** Constraints the caller states; a node's own `ModelNode.billboard` applies where none is. */
    readonly billboards?: readonly ModelBillboardConstraint[]
    readonly billboardCameraRotation?: BillboardRotation
    readonly billboardCameraPosition?: BillboardPosition
    /**
     * The camera comes with every `sample` (a viewer the user orbits), so its absence at creation
     * is not a missing camera.
     */
    readonly billboardCameraPerSample?: boolean
    readonly clip?: ModelAnimationClip
    readonly poseSamples?: readonly ModelPoseBlendSample[]
    /** Reference render time; historical anchors add their signed offset to every explicit sample. */
    readonly poseTime?: number
    readonly maxBytes?: number
    readonly signal?: AbortSignal
    /**
     * Where skins take their pose: `cpu` (the default) samples deformed vertex arrays, `gpu` keeps
     * the bind-pose arrays and gives each skinned primitive its pose as a `skin` (ModelSceneSkin).
     */
    readonly skinning?: 'cpu' | 'gpu'
  } = {},
) {
  const { signal, clip } = options
  const gpuSkinning = options.skinning === 'gpu'
  const poseTime = options.poseTime ?? 0
  if (!Number.isFinite(poseTime)) throw new TypeError('pose reference time must be finite')
  const maxBytes = options.maxBytes ?? 134_217_728
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('invalid scene maxBytes')
  const budget = {
    maxDepth: 64,
    maxNodes: Math.max(
      1_000_000,
      clip === undefined ? 0 : animationSnapshotBudget([clip]).maxNodes,
    ),
    maxBytes,
  }
  const owned = snapshotJson(
    { nodes: projection.nodes, meshes: projection.meshes },
    budget,
    signal,
  ) as unknown as Pick<ModelSceneProjection, 'nodes' | 'meshes'>
  const bindings = snapshotModelSkeleton(projection.skeleton ?? [], budget, signal)
  // A node's own camera rule stands unless the caller states one for that node. A rule its node
  // cannot take — inverse-camera without a pose binding, face-camera on a bound bone — keeps the
  // authored pose and says so instead of refusing the whole scene.
  const stated = new Set((options.billboards ?? []).map(item => item.nodeId))
  const unusable: string[] = []
  const declared = projection.nodes.flatMap((node): ModelBillboardConstraint[] => {
    if (node.billboard === undefined || stated.has(node.id)) return []
    const bound = bindings.some(bone => bone.nodeId === node.id)
    if (node.billboard.mode === 'face-camera' ? bound : !bound) {
      unusable.push(node.id)
      return []
    }
    return [{ nodeId: node.id, ...node.billboard } as ModelBillboardConstraint]
  })
  const billboards = snapshotModelBillboards(
    [...(options.billboards ?? []), ...declared],
    maxBytes,
    signal,
  )
  const billboardBytes =
    billboards.length === 0 ? 0 : bindings.length * 2048 + billboards.length * 512
  if (billboardBytes > maxBytes) throw new RangeError('scene billboards exceed byte budget')
  const billboardCamera =
    options.billboardCameraRotation === undefined
      ? undefined
      : ([...options.billboardCameraRotation] as BillboardRotation)
  const billboardPosition =
    options.billboardCameraPosition === undefined
      ? undefined
      : ([...options.billboardCameraPosition] as BillboardPosition)
  if (
    billboardPosition !== undefined &&
    (billboardPosition.length !== 3 || !billboardPosition.every(Number.isFinite))
  )
    throw new TypeError('billboard camera position must contain three finite numbers')
  for (const constraint of billboards)
    if (
      constraint.mode === 'inverse-camera' &&
      !bindings.some(bone => bone.nodeId === constraint.nodeId)
    )
      throw new TypeError('billboard node has no explicit pose binding')
    else if (
      constraint.mode === 'face-camera' &&
      bindings.some(bone => bone.nodeId === constraint.nodeId)
    )
      throw new TypeError('face-camera billboard currently requires a rigid scene node')
  const diagnostics: SceneRendererDiagnostic[] = []
  const report = (code: string, message: string, primitiveId?: string) => {
    diagnostics.push({
      severity: 'warning',
      code: `common.model/${code}`,
      message,
      ...(primitiveId === undefined ? {} : { primitiveId }),
    })
  }
  if (unusable.length > 0)
    report(
      'billboard-node-unsupported',
      `Nodes ${unusable.join(', ')} declare a camera rule their binding cannot take; authored poses are retained.`,
    )
  if (
    billboards.some(item => item.mode === 'inverse-camera' || item.mode === 'aim') &&
    billboardCamera === undefined &&
    options.billboardCameraPerSample !== true
  )
    report(
      'billboard-camera-required',
      'Node billboard constraints require an explicit camera orientation; authored poses are retained.',
    )
  if (
    billboards.some(item => item.mode === 'face-camera') &&
    billboardPosition === undefined &&
    options.billboardCameraPerSample !== true
  )
    report(
      'billboard-camera-position-required',
      'Position-facing billboard constraints require an explicit camera position; authored poses are retained.',
    )
  const nodes = new Map<string, ModelNode>()
  const parents = new Map<string, string>()
  for (const node of owned.nodes) {
    if (
      !node.id ||
      nodes.has(node.id) ||
      node.transform.length !== 16 ||
      !node.transform.every(Number.isFinite) ||
      [3, 7, 11].some(i => node.transform[i] !== 0) ||
      node.transform[15] !== 1
    )
      throw new TypeError('scene needs unique nodes with finite affine transforms')
    nodes.set(node.id, node)
    for (const child of node.childIds) {
      if (parents.has(child)) throw new TypeError('scene node has multiple parents')
      parents.set(child, node.id)
    }
  }
  for (const child of parents.keys())
    if (!nodes.has(child)) throw new TypeError('scene child is absent')
  for (const constraint of billboards) {
    if (!nodes.has(constraint.nodeId)) throw new TypeError('billboard scene node is absent')
    if (constraint.mode !== 'face-camera') continue
    for (const bone of bindings) {
      let cursor = bone.nodeId
      while (cursor !== undefined) {
        if (cursor === constraint.nodeId)
          throw new TypeError('face-camera billboard cannot contain a skinned hierarchy')
        cursor = parents.get(cursor)
      }
    }
  }
  const nodeMatrixBytes = nodes.size * 16 * Float32Array.BYTES_PER_ELEMENT * 2
  if (nodeMatrixBytes > maxBytes) throw new RangeError('scene matrices exceed maxBytes')
  const worlds = new Map<string, Float32Array>()
  for (const node of owned.nodes) {
    const chain: string[] = []
    const visiting = new Set<string>()
    let id: string | undefined = node.id
    while (id !== undefined && !worlds.has(id)) {
      if (visiting.has(id)) throw new TypeError('cyclic scene nodes')
      visiting.add(id)
      chain.push(id)
      id = parents.get(id)
    }
    for (const child of chain.reverse()) {
      const parent = parents.get(child)
      const matrix = new Float32Array(16)
      multiplyMat4(
        matrix,
        0,
        parent === undefined ? IDENTITY : present(worlds.get(parent), 'parent world'),
        0,
        present(nodes.get(child), 'child node').transform,
        0,
      )
      if (!matrix.every(Number.isFinite))
        throw new RangeError('scene transform exceeds finite float range')
      worlds.set(child, matrix)
    }
  }
  const meshes = new Map(owned.meshes.map(mesh => [mesh.id, mesh]))
  if (meshes.size !== owned.meshes.length) throw new TypeError('ambiguous scene mesh')
  const instances = new Map<string, string[]>()
  for (const node of owned.nodes)
    for (const mesh of node.meshIds) {
      if (!meshes.has(mesh)) throw new TypeError('scene node references an absent mesh')
      const ids = instances.get(mesh) ?? []
      ids.push(node.id)
      instances.set(mesh, ids)
    }
  const primitiveNodes = new Map<string, (string | undefined)[]>()
  let projectedInstances = 0
  for (const mesh of owned.meshes)
    for (const primitive of mesh.primitiveIds) {
      const ids = primitiveNodes.get(primitive) ?? []
      const meshInstances = instances.get(mesh.id) ?? [undefined]
      projectedInstances += meshInstances.length
      if (projectedInstances > 65_536) throw new RangeError('render instances exceed budget')
      ids.push(...meshInstances)
      primitiveNodes.set(primitive, ids)
    }
  const hierarchyBindings = new Map<string, Map<number, ModelBoneBinding>>()
  for (const bone of bindings)
    if (bone.hierarchyId !== undefined) {
      if (typeof bone.hierarchyId !== 'string' || !bone.hierarchyId)
        throw new TypeError('invalid bone hierarchy')
      const entries = hierarchyBindings.get(bone.hierarchyId) ?? new Map<number, ModelBoneBinding>()
      if (entries.has(bone.boneIndex)) throw new TypeError('ambiguous skeleton binding')
      entries.set(bone.boneIndex, bone)
      hierarchyBindings.set(bone.hierarchyId, entries)
    }
  const poseSamples =
    options.poseSamples === undefined
      ? undefined
      : (snapshotJson(
          options.poseSamples,
          { ...budget, maxBytes: Math.floor(maxBytes / 4) },
          signal,
        ) as unknown as readonly ModelPoseBlendSample[])
  const poseBlendBytes = poseSamples === undefined ? 0 : Math.floor(maxBytes / 2)
  // Each hierarchy's pose sampler, and the same one where it is no blend (its poses as matrices).
  const poseSamplers = new Map<
    string,
    Readonly<{
      sampler: {
        sample(
          time: number,
          signal?: AbortSignal,
        ): { readonly bones: readonly ModelBonePoseSample[] }
      }
      matrices: ReturnType<typeof createModelPoseSampler> | undefined
    }>
  >()
  const hierarchyFrames = new Map<string, Float32Array>()
  const bindingsByNode = new Map<string, ModelBoneBinding[]>()
  for (const bone of bindings)
    if (bone.nodeId) {
      const entries = bindingsByNode.get(bone.nodeId) ?? []
      entries.push(bone)
      bindingsByNode.set(bone.nodeId, entries)
    }
  const nodePoses = projection.nodePoses ?? []
  const poseNodeIds = new Set(nodePoses.map(node => node.nodeId))
  for (const id of poseNodeIds)
    if (!nodes.has(id) || bindingsByNode.has(id))
      throw new TypeError('scene node pose is absent or overlaps a skin binding')
  if (poseSamples !== undefined) {
    if (hierarchyBindings.size === 0 && nodePoses.length === 0)
      throw new TypeError('poseSamples requires explicit node or skeleton poses')
    for (const sample of poseSamples)
      for (const channel of sample.clip.channels)
        if (
          ['translation', 'rotation', 'scale'].includes(channel.kind) &&
          !bindingsByNode.has(channel.target) &&
          !poseNodeIds.has(channel.target)
        )
          throw new TypeError('pose sample target has no explicit bone binding')
  }
  const blendBudget = {
    ...budget,
    maxBytes: Math.floor(
      maxBytes / (4 * Math.max(1, hierarchyBindings.size + (nodePoses.length ? 1 : 0))),
    ),
  }
  const nodeSampler =
    nodePoses.length === 0
      ? undefined
      : createNodePoseSampler(nodePoses, {
          poseTime,
          budget: blendBudget,
          ...(clip === undefined ? {} : { clip }),
          ...(poseSamples === undefined ? {} : { poseSamples }),
          ...(signal === undefined ? {} : { signal }),
        })
  const trs =
    clip?.channels.filter(channel => ['translation', 'rotation', 'scale'].includes(channel.kind)) ??
    []
  const visibility = clip?.channels.filter(channel => channel.kind === 'visibility') ?? []
  const morphs = clip?.channels.filter(channel => channel.kind === 'weights') ?? []
  if (
    (clip?.channels.length ?? 0) > trs.length + visibility.length + morphs.length ||
    (clip?.unsupportedChannels ?? 0) > 0
  )
    report(
      'animation-channels-unrendered',
      'Some animation channels are not bone TRS, primitive visibility or morph weights; their effects are not rendered.',
    )
  for (const channel of trs)
    if (!bindingsByNode.has(channel.target) && !poseNodeIds.has(channel.target))
      report(
        'animation-target-unrendered',
        `Animation target ${channel.target} has no explicit bone binding.`,
      )
  for (const [hierarchyId, entries] of hierarchyBindings) {
    try {
      const bones = [...entries.values()]
      // A common static frame above the roots changes the whole model's basis. Keep the
      // frozen bone sampler in its authored frame, then apply this frame once to its output.
      let frame: Float32Array | undefined
      for (const bone of bones) {
        let parent = bone.nodeId === undefined ? undefined : parents.get(bone.nodeId)
        if (bone.parentBoneIndex === null) {
          const rootFrame = parent === undefined ? IDENTITY : worlds.get(parent)
          if (rootFrame === undefined) throw new TypeError('skin root frame is absent')
          if (frame !== undefined && !frame.every((value, i) => value === rootFrame[i]))
            throw new TypeError('skin roots need the same external frame')
          frame = rootFrame
          while (parent !== undefined) {
            if (bindingsByNode.get(parent)?.some(item => item.hierarchyId === hierarchyId))
              throw new TypeError('skin root has an external bone ancestor')
            parent = parents.get(parent)
          }
        } else {
          while (
            parent !== undefined &&
            !bindingsByNode.get(parent)?.some(item => item.hierarchyId === hierarchyId)
          ) {
            const node = nodes.get(parent)
            if (node === undefined || !node.transform.every((value, i) => value === IDENTITY[i]))
              throw new TypeError('transformed node between bones needs pose rebasing')
            parent = parents.get(parent)
          }
          const parentBinding =
            parent === undefined
              ? undefined
              : bindingsByNode.get(parent)?.find(item => item.hierarchyId === hierarchyId)
          if (
            parentBinding?.hierarchyId !== hierarchyId ||
            parentBinding.boneIndex !== bone.parentBoneIndex
          )
            throw new TypeError('scene bone parent differs from the skin hierarchy')
        }
      }
      const boneNodes = new Set(bones.map(bone => bone.nodeId))
      const channels = trs.filter(channel => boneNodes.has(channel.target))
      const primarySampler =
        poseSamples === undefined
          ? createModelPoseSampler({
              bindings: bones,
              hierarchyId,
              budget,
              ...(signal === undefined ? {} : { signal }),
              ...(clip !== undefined &&
              (clip.hierarchyId === undefined || clip.hierarchyId === hierarchyId)
                ? { clip: { ...clip, channels } }
                : {}),
            })
          : undefined
      const blended =
        poseSamples === undefined
          ? undefined
          : createModelPoseBlendSampler({
              bindings: bones,
              hierarchyId,
              budget: blendBudget,
              ...(signal === undefined ? {} : { signal }),
              samples: poseSamples.map(sample => ({
                ...sample,
                clip: {
                  ...sample.clip,
                  hierarchyId,
                  channels:
                    sample.clip.hierarchyId !== undefined && sample.clip.hierarchyId !== hierarchyId
                      ? []
                      : sample.clip.channels.filter(
                          channel =>
                            boneNodes.has(channel.target) &&
                            ['translation', 'rotation', 'scale'].includes(channel.kind),
                        ),
                },
              })),
            })
      const sampler =
        blended === undefined
          ? present(primarySampler, 'primary pose sampler')
          : {
              sample: (time: number, requestSignal?: AbortSignal) =>
                blended.sample(time - poseTime, requestSignal),
            }
      sampler.sample(0, signal)
      poseSamplers.set(hierarchyId, { sampler, matrices: primarySampler })
      hierarchyFrames.set(hierarchyId, new Float32Array(frame ?? IDENTITY))
    } catch (error) {
      if (signal?.aborted) throw error
      if (poseSamples !== undefined) throw error
      report(
        'pose-unavailable',
        `${hierarchyId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const deformers = new Map<ModelPrimitive, ReturnType<typeof createModelSkinDeformer>>()
  // Posed on the GPU: each skin's bind-pose arrays without its skin buffers, and its vertices'
  // palette slots and weights; each hierarchy's slot of every bone, in binding order.
  const gpuSkins = new Map<
    ModelPrimitive,
    Readonly<{ bindPose: ModelPrimitive; vertices: Pick<ModelSceneSkin, 'joints' | 'weights'> }>
  >()
  const hierarchySlots = new Map<string, ReadonlyMap<number, number>>()
  let workingBytes = projection.primitives.reduce(
    (sum, primitive) => sum + modelPrimitiveByteLength(primitive),
    nodeMatrixBytes + billboardBytes,
  )
  workingBytes += poseBlendBytes
  if (workingBytes > maxBytes) throw new RangeError('render geometry exceeds maxBytes')
  const primitiveIds = new Set<string>()
  let instanceCount = 0
  for (const primitive of projection.primitives) {
    if (primitiveIds.has(primitive.id)) throw new TypeError('ambiguous scene primitive')
    primitiveIds.add(primitive.id)
    instanceCount += primitiveNodes.get(primitive.id)?.length ?? 1
    if (instanceCount > 65_536) throw new RangeError('render instances exceed budget')
    if (primitive.boneIndices === undefined && primitive.boneWeights === undefined) continue
    try {
      const hierarchyId = primitive.hierarchyId
      if (hierarchyId === undefined || !poseSamplers.has(hierarchyId))
        throw new TypeError('skin has no complete pose hierarchy')
      const bones = [...present(hierarchyBindings.get(hierarchyId), 'hierarchy bindings').values()]
      if (bones.some(bone => bone.inverseBindMatrix === undefined))
        throw new TypeError('skin has no explicit inverse bind matrix')
      const deformer = createModelSkinDeformer(
        primitive,
        bones.map(bone => bone.boneIndex),
        maxBytes - workingBytes,
        signal,
      )
      workingBytes += deformer.workingBytes
      // A skin without authored normals stays on the CPU: the renderer derives them from the posed
      // triangles. Tangents it lacks the renderer generates from the bind pose, where a normal map
      // needs them, and the GPU turns them with the skin.
      // Eight-influence skins use the same CPU kernel; the GPU vertex layout remains four-wide.
      if (
        gpuSkinning &&
        (primitive.boneInfluences ?? 4) === 4 &&
        primitive.normals !== undefined
      ) {
        // Slots and weights: a byte or two and four floats per influence.
        workingBytes += primitive.positions.length * 8
        if (workingBytes > maxBytes) throw new RangeError('skin deformation exceeds maxBytes')
        let slots = hierarchySlots.get(hierarchyId)
        if (slots === undefined)
          hierarchySlots.set(
            hierarchyId,
            (slots = new Map(bones.map((bone, slot) => [bone.boneIndex, slot]))),
          )
        const {
          bounds: _bounds,
          boneIndices: _indices,
          boneWeights: _weights,
          boneInfluences: _influences,
          hierarchyId: _hierarchy,
          ...bindPose
        } = primitive
        gpuSkins.set(primitive, { bindPose, vertices: skinVertices(primitive, slots) })
      }
      deformers.set(primitive, deformer)
      if (deformer.zeroWeightVertices > 0)
        report(
          'skin-zero-weights',
          `${deformer.zeroWeightVertices} vertices retain source positions under MK2 CPU skinning.`,
          primitive.id,
        )
      if (deformer.normalizedWeightVertices > 0)
        report(
          'skin-weight-normalization',
          `${deformer.normalizedWeightVertices} vertices use MK2 CPU weight normalization.`,
          primitive.id,
        )
    } catch (error) {
      // Budget refusal is not permission to draw a partial animated model.
      if (error instanceof RangeError || signal?.aborted) throw error
      report(
        'skin-unavailable',
        `${primitive.id}: ${error instanceof Error ? error.message : String(error)}`,
        primitive.id,
      )
    }
  }
  // Morph weights: a clip's weights channel on a node, else the mesh's default weights.
  const meshOfPrimitive = new Map<string, ModelMesh>()
  for (const mesh of owned.meshes)
    for (const primitive of mesh.primitiveIds) meshOfPrimitive.set(primitive, mesh)
  const morphed = projection.primitives.filter(
    primitive => primitive.morphTargets !== undefined && primitive.morphTargets.length > 0,
  )
  for (const primitive of morphed) {
    if (deformers.has(primitive)) {
      report(
        'morph-skinned-unrendered',
        `${primitive.id}: morph targets under a skin are drawn without their weights.`,
        primitive.id,
      )
      continue
    }
    // each drawn instance owns its morphed positions and normals
    workingBytes +=
      (primitive.positions.byteLength + (primitive.normals?.byteLength ?? 0)) *
      (primitiveNodes.get(primitive.id)?.length ?? 1)
    if (workingBytes > maxBytes) throw new RangeError('morphed geometry exceeds maxBytes')
  }
  const morphTargetCounts = new Map<string, number>()
  for (const primitive of morphed)
    for (const node of primitiveNodes.get(primitive.id) ?? [])
      if (node !== undefined) morphTargetCounts.set(node, primitive.morphTargets?.length ?? 0)
  let morphSampler: ReturnType<typeof createModelAnimationSampler> | undefined
  if (morphs.length > 0) {
    for (const channel of morphs)
      if (!morphTargetCounts.has(channel.target))
        report(
          'animation-target-unrendered',
          `Morph weights target ${channel.target} is not a scene node drawing morph targets.`,
        )
    try {
      morphSampler = createModelAnimationSampler(
        { ...present(clip, 'morph clip'), channels: morphs },
        { ...budget, maxBytes: Math.floor(maxBytes / 4) },
        signal,
      )
    } catch (error) {
      if (signal?.aborted || error instanceof RangeError) throw error
      report(
        'morph-unavailable',
        `Morph weights are not sampleable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  let visibilitySampler: ReturnType<typeof createModelAnimationSampler> | undefined
  if (visibility.length > 0) {
    for (const channel of visibility)
      if (!primitiveIds.has(channel.target))
        report(
          'animation-target-unrendered',
          `Visibility target ${channel.target} is not an exact scene primitive id.`,
        )
    try {
      visibilitySampler = createModelAnimationSampler(
        { ...present(clip, 'visibility clip'), channels: visibility },
        { ...budget, maxBytes: Math.floor(maxBytes / 4) },
        signal,
      )
    } catch (error) {
      if (signal?.aborted || error instanceof RangeError) throw error
      report(
        'visibility-unavailable',
        `Primitive visibility is not sampleable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  // What every sample takes the same: the primitives stored hidden, the nodes facing the camera's
  // position, each hierarchy, the nodes that are no bone and each primitive's draw.
  const storedHidden: ReadonlySet<string> = new Set(
    projection.primitives
      .filter(primitive => primitive.hidden === true)
      .map(primitive => primitive.id),
  )
  const faceBillboards = new Map(
    billboards.flatMap(item => (item.mode === 'face-camera' ? [[item.nodeId, item] as const] : [])),
  )
  // A camera rule turning bones makes each pose of the sampler first (applyModelBillboards).
  const turnsBones = billboards.some(item => item.mode === 'inverse-camera' || item.mode === 'aim')
  const hierarchies = [...poseSamplers].map(([hierarchyId, { sampler, matrices }]) => {
    const entries = present(hierarchyBindings.get(hierarchyId), 'hierarchy bindings')
    const frame = present(hierarchyFrames.get(hierarchyId), 'skin frame')
    return {
      hierarchyId,
      sampler,
      // sampled as matrices: the frozen bones are made only when asked for
      matrices: turnsBones ? undefined : matrices,
      entries,
      bindings: [...entries.values()],
      frame,
      transformed: !frame.every((value, i) => value === IDENTITY[i]),
    }
  })
  type SceneHierarchy = (typeof hierarchies)[number]
  /** A hierarchy's pose in one sample: its matrices where sampled so, and its frozen bones. */
  type ScenePose = Readonly<{
    hierarchy: SceneHierarchy
    sampled: ModelPoseMatrices | undefined
    bones: () => readonly ModelBonePoseSample[]
  }>
  const boneNodes = new Set<string>()
  for (const { entries } of hierarchies)
    for (const bone of entries.values()) if (bone.nodeId !== undefined) boneNodes.add(bone.nodeId)
  // The nodes that are no bone, parents first. One that no bone, node pose or camera moves (nor any
  // of its ancestors) takes its world at rest: what the parent's world times its own transform
  // makes there.
  const moved = new Set<string>()
  const rigidNodes = [...worlds.keys()]
    .filter(id => !boneNodes.has(id))
    .map(id => {
      const parent = parents.get(id)
      const face = faceBillboards.get(id)
      const still =
        !poseNodeIds.has(id) &&
        face === undefined &&
        (parent === undefined || (!boneNodes.has(parent) && !moved.has(parent)))
      if (!still) moved.add(id)
      return {
        id,
        parent,
        face,
        transform: present(nodes.get(id), 'animated node').transform,
        rest: present(worlds.get(id), 'node world'),
        still,
      }
    })
  const hierarchyIndices = new Map(
    hierarchies.map(({ hierarchyId }, index) => [hierarchyId, index]),
  )
  const draws = projection.primitives.map(primitive => {
    const nodes = primitiveNodes.get(primitive.id) ?? [undefined]
    const deformer = deformers.get(primitive)
    if (deformer === undefined) return { primitive, nodes, skinned: undefined }
    const gpu = gpuSkins.get(primitive)
    return {
      primitive,
      nodes,
      skinned: {
        deformer,
        hierarchy: present(
          hierarchyIndices.get(present(primitive.hierarchyId, 'skin hierarchy')),
          'skin pose',
        ),
        gpu: gpu === undefined ? undefined : { ...gpu, drawn: drawn(gpu.bindPose) },
      },
    }
  })
  // The joints of a sample's poses (ModelRenderJoint), made when first read: the world reads none.
  const sampleJoints = (poses: readonly ScenePose[]): readonly ModelRenderJoint[] => {
    const joints: ModelRenderJoint[] = []
    for (const { hierarchy, bones } of poses) {
      const pose = bones()
      const offset = joints.length
      const byIndex = new Map(pose.map((bone, i) => [bone.boneIndex, offset + i]))
      for (const bone of pose) {
        const world = new Float32Array(16)
        multiplyMat4(world, 0, hierarchy.frame, 0, bone.worldMatrix, 0)
        const binding = present(hierarchy.entries.get(bone.boneIndex), 'bone binding')
        const parent =
          binding.parentBoneIndex == null ? undefined : byIndex.get(binding.parentBoneIndex)
        joints.push({
          hierarchyId: hierarchy.hierarchyId,
          boneIndex: bone.boneIndex,
          name: binding.boneName,
          position: [
            present(world[12], 'joint x'),
            present(world[13], 'joint y'),
            present(world[14], 'joint z'),
          ],
          ...(parent === undefined ? {} : { parent }),
        })
      }
    }
    return Object.freeze(joints)
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    /** The clip's events passed after `fromSeconds` up to `toSeconds` (see clipEventsBetween). */
    eventsBetween: (fromSeconds: number, toSeconds: number) =>
      clip === undefined ? [] : clipEventsBetween(clip, fromSeconds, toSeconds),
    sample(timeSeconds: number, requestSignal?: AbortSignal, camera?: ModelSceneCamera) {
      if (!Number.isFinite(timeSeconds)) throw new TypeError('scene time must be finite')
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const cameraRotation =
        camera?.rotation === undefined ? billboardCamera : sampleRotation(camera.rotation)
      const cameraPosition =
        camera?.position === undefined ? billboardPosition : samplePosition(camera.position)
      const animatedWorlds = new Map<string, Float32Array>()
      // stored invisible until a clip shows it; a sampled visibility decides either way
      let hiddenPrimitives = storedHidden
      // a visibility between 0 and 1 fades the primitive (WC3 geoset alpha): its tint's alpha
      let fades: Map<string, number> | undefined
      if (visibilitySampler !== undefined) {
        const hidden = new Set(storedHidden)
        fades = new Map()
        for (const value of visibilitySampler.sample(timeSeconds, requestSignal))
          if (primitiveIds.has(value.target)) {
            const visibility = value.value[0] ?? 0
            if (visibility > 0) hidden.delete(value.target)
            else hidden.add(value.target)
            if (visibility > 0 && visibility < 1) fades.set(value.target, visibility)
          }
        hiddenPrimitives = hidden
      }
      let nodeWeights: Map<string, readonly number[]> | undefined
      if (morphSampler !== undefined) {
        nodeWeights = new Map()
        for (const value of morphSampler.sample(timeSeconds, requestSignal))
          if (value.value.length === morphTargetCounts.get(value.target))
            nodeWeights.set(value.target, value.value)
      }
      const localPoses = nodeSampler?.sample(timeSeconds, requestSignal)
      const poses: ScenePose[] = []
      for (const hierarchy of hierarchies) {
        const { frame } = hierarchy
        if (hierarchy.matrices !== undefined) {
          const sampled = hierarchy.matrices.sampleMatrices(timeSeconds, requestSignal)
          const { bones } = hierarchy.matrices
          for (let slot = 0; slot < bones.length; slot++) {
            const world = new Float32Array(16)
            multiplyMat4(world, 0, frame, 0, sampled.matrices, slot * 16)
            if (!finiteValues(world))
              throw new RangeError('animated bone transform exceeds finite float range')
            animatedWorlds.set(bones[slot]!.nodeId, world)
          }
          poses.push({ hierarchy, sampled, bones: () => sampled.pose() })
          continue
        }
        const pose = applyModelBillboards(
          hierarchy.sampler.sample(timeSeconds, requestSignal).bones,
          hierarchy.bindings,
          billboards,
          cameraRotation,
          frame,
          billboardBytes,
          requestSignal,
          cameraPosition,
        )
        for (const bone of pose) {
          const world = new Float32Array(16)
          multiplyMat4(world, 0, frame, 0, bone.worldMatrix, 0)
          if (!finiteValues(world))
            throw new RangeError('animated bone transform exceeds finite float range')
          animatedWorlds.set(bone.nodeId, world)
        }
        poses.push({ hierarchy, sampled: undefined, bones: () => pose })
      }
      // Rigid descendants of animated bones inherit their current world transforms too.
      for (const node of rigidNodes) {
        if (node.still) {
          animatedWorlds.set(node.id, new Float32Array(node.rest))
          continue
        }
        const matrix = new Float32Array(16)
        multiplyMat4(
          matrix,
          0,
          node.parent === undefined
            ? IDENTITY
            : present(animatedWorlds.get(node.parent), 'animated parent'),
          0,
          localPoses?.get(node.id) ?? node.transform,
          0,
        )
        const adjusted =
          node.face === undefined || cameraPosition === undefined
            ? matrix
            : applyModelFaceCameraBillboard(matrix, node.face, cameraPosition)
        if (!finiteValues(adjusted))
          throw new RangeError('animated scene transform exceeds finite float range')
        animatedWorlds.set(node.id, adjusted)
      }
      // Each hierarchy's palette of this sample, shared by its skins (see ModelSceneSkin).
      const palettes: (Float32Array | undefined)[] = []
      const primitives: SceneRendererPrimitive[] = []
      for (const { primitive, nodes: instances, skinned } of draws) {
        if (hiddenPrimitives.has(primitive.id)) continue
        const fade = fades?.get(primitive.id)
        if (skinned !== undefined) {
          const { deformer, gpu } = skinned
          const pose = present(poses[skinned.hierarchy], 'skin pose')
          const { hierarchy } = pose
          // Bone world × inverse bind produces geometry in the hierarchy's authored frame.
          // Only its external frame is applied here, never the mesh node transform a second time.
          let deformed: ModelPrimitive | undefined
          let skin: ModelSceneSkin | undefined
          if (gpu === undefined) deformed = deformer.deform(pose.bones(), requestSignal)
          else {
            const palette = (palettes[skinned.hierarchy] ??=
              pose.sampled === undefined
                ? skinPalette(
                    pose.bones(),
                    present(hierarchySlots.get(hierarchy.hierarchyId), 'skin slots'),
                  )
                : skinPaletteOf(
                    pose.sampled,
                    present(hierarchy.matrices, 'pose bones').bones,
                    present(hierarchySlots.get(hierarchy.hierarchyId), 'skin slots'),
                  ))
            skin = Object.freeze({
              joints: gpu.vertices.joints,
              weights: gpu.vertices.weights,
              palette,
              deformed: () => (deformed ??= deformer.deform(pose.bones())),
            })
          }
          const base = skin === undefined ? drawn(present(deformed, 'deformed skin')) : gpu!.drawn
          for (let instance = 0; instance < instances.length; instance++)
            primitives.push(
              placedPrimitive(
                base,
                hierarchy.transformed ? new Float32Array(hierarchy.frame) : undefined,
                skin,
                fade,
              ),
            )
        } else {
          const targets = primitive.morphTargets?.length ?? 0
          const defaults = meshOfPrimitive.get(primitive.id)?.morphWeights
          for (const node of instances) {
            const transform =
              node === undefined ? undefined : (animatedWorlds.get(node) ?? worlds.get(node))
            const weights = (node === undefined ? undefined : nodeWeights?.get(node)) ?? defaults
            const shaped =
              targets > 0 && weights !== undefined && weights.some(weight => weight !== 0)
                ? morphPrimitive(primitive, weights)
                : primitive
            primitives.push(
              placedPrimitive(
                drawn(shaped),
                transform === undefined ? undefined : new Float32Array(transform),
                undefined,
                fade,
              ),
            )
          }
        }
      }
      let joints: readonly ModelRenderJoint[] | undefined
      return {
        // Each sample owns these matrices. Sockets, emitters and other node-based features use
        // the same full world transforms as geometry and bones, without format-specific math.
        nodeTransforms: animatedWorlds as ReadonlyMap<string, Float32Array>,
        primitives: Object.freeze(primitives),
        get joints(): readonly ModelRenderJoint[] {
          return (joints ??= sampleJoints(poses))
        },
        diagnostics: Object.freeze(diagnostics),
      }
    },
  })
}

/** A sample's own camera rotation, owned and checked like the creation-time one. */
function sampleRotation(value: BillboardRotation): BillboardRotation {
  if (value.length !== 4 || !value.every(Number.isFinite) || Math.hypot(...value) === 0)
    throw new TypeError('sample camera rotation must be a finite nonzero quaternion')
  return [value[0], value[1], value[2], value[3]]
}

/** A sample's own camera position, owned and checked like the creation-time one. */
function samplePosition(value: BillboardPosition): BillboardPosition {
  if (value.length !== 3 || !value.every(Number.isFinite))
    throw new TypeError('sample camera position must contain three finite numbers')
  return [value[0], value[1], value[2]]
}
