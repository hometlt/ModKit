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
import type { ModelBonePoseSample, ModelPoseBlendSample } from '@modkit/codec-kit/model/skeleton'
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

function present<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new TypeError(`missing scene ${label}`)
  return value
}

/** Prepare a neutral render snapshot. Native restMatrix is descriptive and is never guessed. */
export function createModelSceneSampler(
  projection: ModelSceneProjection,
  options: {
    readonly billboards?: readonly ModelBillboardConstraint[]
    readonly billboardCameraRotation?: BillboardRotation
    readonly billboardCameraPosition?: BillboardPosition
    readonly clip?: ModelAnimationClip
    readonly poseSamples?: readonly ModelPoseBlendSample[]
    /** Reference render time; historical anchors add their signed offset to every explicit sample. */
    readonly poseTime?: number
    readonly maxBytes?: number
    readonly signal?: AbortSignal
  } = {},
) {
  const { signal, clip } = options
  const poseTime = options.poseTime ?? 0
  if (!Number.isFinite(poseTime)) throw new TypeError('pose reference time must be finite')
  const maxBytes = options.maxBytes ?? 134_217_728
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('invalid scene maxBytes')
  const budget = { maxDepth: 64, maxNodes: 1_000_000, maxBytes }
  const owned = snapshotJson(
    { nodes: projection.nodes, meshes: projection.meshes },
    budget,
    signal,
  ) as unknown as Pick<ModelSceneProjection, 'nodes' | 'meshes'>
  const bindings = snapshotModelSkeleton(projection.skeleton ?? [], budget, signal)
  const billboards = snapshotModelBillboards(options.billboards ?? [], maxBytes, signal)
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
  ) throw new TypeError('billboard camera position must contain three finite numbers')
  for (const constraint of billboards)
    if (constraint.mode === 'inverse-camera' && !bindings.some(bone => bone.nodeId === constraint.nodeId))
      throw new TypeError('billboard node has no explicit pose binding')
    else if (constraint.mode === 'face-camera' && bindings.some(bone => bone.nodeId === constraint.nodeId))
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
  if (billboards.some(item => item.mode === 'inverse-camera') && billboardCamera === undefined)
    report(
      'billboard-camera-required',
      'Node billboard constraints require an explicit camera orientation; authored poses are retained.',
    )
  if (billboards.some(item => item.mode === 'face-camera') && billboardPosition === undefined)
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
  const poseSamplers = new Map<string, ReturnType<typeof createModelPoseSampler>>()
  const hierarchyFrames = new Map<string, Float32Array>()
  const bindingByNode = new Map(
    bindings.flatMap(bone => (bone.nodeId ? [[bone.nodeId, bone] as const] : [])),
  )
  const nodePoses = projection.nodePoses ?? []
  const poseNodeIds = new Set(nodePoses.map(node => node.nodeId))
  for (const id of poseNodeIds)
    if (!nodes.has(id) || bindingByNode.has(id))
      throw new TypeError('scene node pose is absent or overlaps a skin binding')
  if (poseSamples !== undefined) {
    if (hierarchyBindings.size === 0 && nodePoses.length === 0)
      throw new TypeError('poseSamples requires explicit node or skeleton poses')
    for (const sample of poseSamples)
      for (const channel of sample.clip.channels)
        if (
          ['translation', 'rotation', 'scale'].includes(channel.kind) &&
          !bindingByNode.has(channel.target) &&
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
  if ((clip?.channels.length ?? 0) > trs.length || (clip?.unsupportedChannels ?? 0) > 0)
    report(
      'animation-channels-unrendered',
      'Some animation channels are not bone TRS; their effects are not rendered.',
    )
  for (const channel of trs)
    if (!bindingByNode.has(channel.target) && !poseNodeIds.has(channel.target))
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
            if (bindingByNode.has(parent))
              throw new TypeError('skin root has an external bone ancestor')
            parent = parents.get(parent)
          }
        } else {
          while (parent !== undefined && !bindingByNode.has(parent)) {
            const node = nodes.get(parent)
            if (node === undefined || !node.transform.every((value, i) => value === IDENTITY[i]))
              throw new TypeError('transformed node between bones needs pose rebasing')
            parent = parents.get(parent)
          }
          const parentBinding = parent === undefined ? undefined : bindingByNode.get(parent)
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
      poseSamplers.set(hierarchyId, sampler)
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
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    sample(timeSeconds: number, requestSignal?: AbortSignal) {
      if (!Number.isFinite(timeSeconds)) throw new TypeError('scene time must be finite')
      if (requestSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const poses = new Map<string, readonly ModelBonePoseSample[]>()
      const animatedWorlds = new Map<string, Float32Array>()
      const localPoses = nodeSampler?.sample(timeSeconds, requestSignal)
      const faceBillboards = new Map(
        billboards.flatMap(item => item.mode === 'face-camera' ? [[item.nodeId, item] as const] : []),
      )
      const joints: ModelRenderJoint[] = []
      for (const [hierarchyId, sampler] of poseSamplers) {
        const originalPose = sampler.sample(timeSeconds, requestSignal).bones
        const pose = applyModelBillboards(
          originalPose,
          [...present(hierarchyBindings.get(hierarchyId), 'billboard bindings').values()],
          billboards,
          billboardCamera,
          present(hierarchyFrames.get(hierarchyId), 'billboard frame'),
          billboardBytes,
          requestSignal,
        )
        poses.set(hierarchyId, pose)
        const offset = joints.length
        const byIndex = new Map(pose.map((bone, i) => [bone.boneIndex, offset + i]))
        for (const bone of pose) {
          const frame = hierarchyFrames.get(hierarchyId)
          if (frame === undefined) throw new TypeError('skin frame is absent')
          const world = new Float32Array(16)
          multiplyMat4(world, 0, frame, 0, bone.worldMatrix, 0)
          if (!world.every(Number.isFinite))
            throw new RangeError('animated bone transform exceeds finite float range')
          animatedWorlds.set(bone.nodeId, world)
          const binding = present(
            present(hierarchyBindings.get(hierarchyId), 'hierarchy bindings').get(bone.boneIndex),
            'bone binding',
          )
          const parent =
            binding.parentBoneIndex == null ? undefined : byIndex.get(binding.parentBoneIndex)
          joints.push({
            hierarchyId,
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
      // Rigid descendants of animated bones inherit their current world transforms too.
      for (const [id] of worlds)
        if (!animatedWorlds.has(id)) {
          const parent = parents.get(id)
          const matrix = new Float32Array(16)
          multiplyMat4(
            matrix,
            0,
            parent === undefined
              ? IDENTITY
              : present(animatedWorlds.get(parent), 'animated parent'),
            0,
            localPoses?.get(id) ?? present(nodes.get(id), 'animated node').transform,
            0,
          )
          const face = faceBillboards.get(id)
          const adjusted =
            face === undefined || billboardPosition === undefined
              ? matrix
              : applyModelFaceCameraBillboard(matrix, face, billboardPosition)
          if (!adjusted.every(Number.isFinite))
            throw new RangeError('animated scene transform exceeds finite float range')
          animatedWorlds.set(id, adjusted)
        }
      const primitives: SceneRendererPrimitive[] = []
      for (const primitive of projection.primitives) {
        const deformer = deformers.get(primitive)
        if (deformer !== undefined) {
          // Bone world × inverse bind produces geometry in the hierarchy's authored frame.
          // Only its external frame is applied here, never the mesh node transform a second time.
          const deformed = deformer.deform(
            present(poses.get(present(primitive.hierarchyId, 'skin hierarchy')), 'skin pose'),
            requestSignal,
          )
          const frame =
            primitive.hierarchyId === undefined
              ? undefined
              : hierarchyFrames.get(primitive.hierarchyId)
          const transformed =
            frame !== undefined && !frame.every((value, i) => value === IDENTITY[i])
          const instances = primitiveNodes.get(primitive.id)?.length ?? 1
          for (let instance = 0; instance < instances; instance++)
            primitives.push({
              ...deformed,
              ...(transformed ? { transform: new Float32Array(frame) } : {}),
            })
        } else {
          for (const node of primitiveNodes.get(primitive.id) ?? [undefined]) {
            const transform =
              node === undefined ? undefined : (animatedWorlds.get(node) ?? worlds.get(node))
            primitives.push({
              ...primitive,
              ...(transform === undefined ? {} : { transform: new Float32Array(transform) }),
            })
          }
        }
      }
      return {
        // Each sample owns these matrices. Sockets, emitters and other node-based features use
        // the same full world transforms as geometry and bones, without format-specific math.
        nodeTransforms: animatedWorlds as ReadonlyMap<string, Float32Array>,
        primitives: Object.freeze(primitives),
        joints: Object.freeze(joints),
        diagnostics: Object.freeze(diagnostics),
      }
    },
  })
}
