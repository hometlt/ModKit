import type {
  JsonObject,
  ModelAnimationChannel,
  ModelAnimationClip,
  ModelBoneBinding,
  ModelNode,
} from '@modkit/sdk'
import type { UvmAccessor } from '@modkit/uv/model/accessor'
import { readUvmKeyTimes } from '@modkit/uv/model/key-times'
import type { ModelNodePose } from '../model/node-pose.js'
import {
  readUvmAnimationClips,
  readUvmPrimitiveVisibility,
  uvmAnimationEvents,
  uvmAnimationPlayback,
  uvmVisibilityTarget,
} from '@modkit/uv/model/animation-clips'
import {
  array as list,
  field,
  object,
  safeIndex as index,
  required,
  vector3,
  vector4,
} from './values.js'

export interface UvmRig {
  readonly bindings: readonly ModelBoneBinding[]
  readonly nodePoses: readonly ModelNodePose[]
  readonly clips: readonly ModelAnimationClip[]
  readonly incompleteBindings: number
  readonly decodedBytes: number
}
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** An animation's events as the facet names them: a socket by its node id. */
function clipEvents(animation: JsonObject, nodeCount: number) {
  const events = uvmAnimationEvents(
    field(animation['extensions'], 'UV_game_animation_events'),
    nodeCount,
  )
  return events.length === 0
    ? {}
    : {
        events: events.map(event => ({
          timeSeconds: event.t,
          name: event.name,
          ...(event.socket === undefined ? {} : { nodeId: `node-${event.socket}` }),
          ...(event.payload === undefined ? {} : { payload: event.payload }),
          ...(event.duration === undefined ? {} : { durationSeconds: event.duration }),
        })),
      }
}

function uvMetadata(value: JsonObject): JsonObject {
  const extras = value['extras']
  if (extras === undefined) return {}
  const uv = object(extras, 'UVM extras')['uv']
  return uv === undefined ? {} : object(uv, 'UVM metadata')
}

/** Read standard skins without inventing missing node names or decomposing authored matrices. */
export function decodeUvmRig(
  document: JsonObject,
  readAccessor: (accessor: unknown, remainingBytes: number, label: string) => UvmAccessor,
  maxScalarBytes: number,
  sceneNodes: readonly ModelNode[],
  signal?: AbortSignal,
): UvmRig {
  signal?.throwIfAborted()
  const nodes = list(document, 'nodes').map(value => object(value, 'UVM node'))
  const skins = list(document, 'skins').map(value => object(value, 'UVM skin'))
  const parents = new Map<number, number>()
  for (const [parent, node] of nodes.entries()) {
    for (const child of list(node, 'children')) {
      const childIndex = index(child, nodes.length, 'joint parent')
      if (parents.has(childIndex)) throw new TypeError('UVM node has multiple parents')
      parents.set(childIndex, parent)
    }
  }
  const done = new Set<number>()
  const rootByNode = new Map<number, number>()
  for (let node = 0; node < nodes.length; node++) {
    const path = new Set<number>()
    let cursor: number | undefined = node
    let root = node
    while (cursor !== undefined && !done.has(cursor)) {
      if (path.has(cursor)) throw new TypeError('UVM node hierarchy is cyclic')
      path.add(cursor)
      root = cursor
      cursor = parents.get(cursor)
    }
    if (cursor !== undefined) root = required(rootByNode.get(cursor), 'hierarchy root')
    for (const item of path) {
      done.add(item)
      rootByNode.set(item, root)
    }
  }
  let decodedBytes = 0
  const read = (accessor: unknown, label: string): UvmAccessor => {
    signal?.throwIfAborted()
    const result = readAccessor(accessor, maxScalarBytes - decodedBytes, label)
    decodedBytes += result.values.byteLength
    if (!result.values.every(Number.isFinite))
      throw new TypeError(`UVM ${label} contains non-finite values`)
    return result
  }
  const bindings: ModelBoneBinding[] = []
  const animations = list(document, 'animations').map(value => object(value, 'UVM animation'))
  const catalog = readUvmAnimationClips(document, signal)
  const visibility = readUvmPrimitiveVisibility(document, signal)
  const animatedNodes = new Set<number>()
  for (const animation of animations) {
    for (const candidate of list(animation, 'channels')) {
      const channel = object(candidate, 'UVM animation channel')
      const target = object(channel['target'] ?? {}, 'UVM animation target')
      if (
        typeof target['path'] === 'string' &&
        ['translation', 'rotation', 'scale'].includes(target['path'])
      )
        animatedNodes.add(index(target['node'], nodes.length, 'animation target'))
    }
  }
  let incompleteBindings = 0
  for (const [skinIndex, skin] of skins.entries()) {
    const joints = list(skin, 'joints').map(joint => index(joint, nodes.length, 'skin joint'))
    if (joints.length === 0 || new Set(joints).size !== joints.length)
      throw new TypeError('UVM skin needs unique joints')
    const slots = new Map(
      joints.map((joint, slot) => [index(joint, nodes.length, 'skin joint'), slot]),
    )
    if (
      joints.some(
        joint => rootByNode.get(joint) !== rootByNode.get(required(joints[0], 'first joint')),
      )
    )
      throw new TypeError('UVM skin joints have no common root')
    if (skin['skeleton'] !== undefined) {
      const skeletonRoot = index(skin['skeleton'], nodes.length, 'skeleton root')
      const descendants = new Set<number>([skeletonRoot])
      for (const joint of joints) {
        const path: number[] = []
        let current: number | undefined = joint
        while (current !== undefined && !descendants.has(current)) {
          path.push(current)
          current = parents.get(current)
        }
        if (current === undefined)
          throw new TypeError('UVM declared skeleton root is not a common ancestor')
        for (const child of path) descendants.add(child)
      }
    }
    const matrices =
      skin['inverseBindMatrices'] === undefined
        ? undefined
        : read(skin['inverseBindMatrices'], 'inverse bind matrices')
    if (
      matrices !== undefined &&
      (matrices.width !== 16 ||
        matrices.componentType !== 5126 ||
        matrices.normalized ||
        matrices.count < joints.length)
    )
      throw new TypeError('UVM inverse bind matrices must be float MAT4 values for every joint')
    for (const [boneIndex, joint] of joints.entries()) {
      const node = required(nodes[joint], 'skin joint')
      let parent = parents.get(joint)
      // The scene sampler evaluates common static frames above the roots. Transformed groups
      // between joints and animated non-joint ancestors still need richer pose bindings.
      let identityChain = true
      while (parent !== undefined && !slots.has(parent) && !animatedNodes.has(parent)) {
        identityChain &&= required(sceneNodes[parent], 'parent scene node').transform.every(
          (value, index) => value === (index % 5 === 0 ? 1 : 0),
        )
        parent = parents.get(parent)
      }
      const parentBoneIndex =
        parent === undefined ? null : identityChain ? slots.get(parent) : undefined
      const localPose =
        node['matrix'] === undefined
          ? {
              translation: vector3(node['translation'] ?? [0, 0, 0]),
              rotation: vector4(node['rotation'] ?? [0, 0, 0, 1]),
              scale: vector3(node['scale'] ?? [1, 1, 1]),
            }
          : undefined
      if (parentBoneIndex === undefined || localPose === undefined) incompleteBindings++
      // glTF explicitly specifies identity for an omitted inverseBindMatrices accessor.
      const inverseBindMatrix =
        matrices === undefined
          ? identity()
          : Array.from(matrices.values.subarray(boneIndex * 16, boneIndex * 16 + 16))
      if (
        inverseBindMatrix[3] !== 0 ||
        inverseBindMatrix[7] !== 0 ||
        inverseBindMatrix[11] !== 0 ||
        inverseBindMatrix[15] !== 1
      )
        throw new TypeError('UVM inverse bind matrix must be affine')
      bindings.push({
        partId: `skin-${skinIndex}`,
        hierarchyId: `skin-${skinIndex}`,
        boneIndex,
        boneName: typeof node['name'] === 'string' ? node['name'] : null,
        provenance: 'direct',
        nodeId: `node-${joint}`,
        inverseBindMatrix,
        ...(parentBoneIndex === undefined ? {} : { parentBoneIndex }),
        ...(localPose === undefined ? {} : { localPose }),
      })
    }
  }
  const clips: ModelAnimationClip[] = []
  for (const [clipIndex, animation] of animations.entries()) {
    const samplers = list(animation, 'samplers').map(value =>
      object(value, 'UVM animation sampler'),
    )
    const channels: ModelAnimationChannel[] = []
    const targets = new Set<string>()
    const frames = new Set<number>()
    let unsupportedChannels = 0
    let durationSeconds = 0
    for (const candidate of list(animation, 'channels')) {
      const channel = object(candidate, 'UVM animation channel')
      const sampler = required(
        samplers[index(channel['sampler'], samplers.length, 'animation sampler')],
        'animation sampler',
      )
      const input = read(sampler['input'], 'animation time')
      if (
        input.width !== 1 ||
        input.componentType !== 5126 ||
        input.normalized ||
        input.count === 0
      )
        throw new TypeError('UVM animation time accessor shape is invalid')
      let previous = -Infinity
      for (const time of input.values) {
        if (time < 0 || time <= previous)
          throw new TypeError('UVM animation times must be nonnegative and strictly increasing')
        previous = time
        frames.add(time)
        durationSeconds = Math.max(durationSeconds, time)
      }
      const target = object(channel['target'] ?? {}, 'UVM animation target')
      const targetPath = target['path']
      const visible =
        targetPath === 'pointer'
          ? uvmVisibilityTarget(
              field(field(target['extensions'], 'KHR_animation_pointer'), 'pointer'),
              visibility,
            )
          : undefined
      if (
        visible === undefined &&
        (typeof targetPath !== 'string' ||
          !['translation', 'rotation', 'scale', 'weights'].includes(targetPath))
      ) {
        unsupportedChannels++
        continue
      }
      const node =
        visible === undefined ? index(target['node'], nodes.length, 'animation target') : undefined
      const morphWeights = targetPath === 'weights'
      if (
        node !== undefined &&
        !morphWeights &&
        required(nodes[node], 'animation target')['matrix'] !== undefined
      )
        throw new TypeError('UVM animated node cannot use matrix')
      // a weights channel keys one weight per morph target of the node's mesh
      const morphTargets = (() => {
        if (!morphWeights || node === undefined) return 0
        const meshes = list(document, 'meshes')
        const mesh = required(nodes[node], 'morph node')['mesh']
        if (mesh === undefined)
          throw new TypeError('UVM weights channel targets a node without a mesh')
        const primitive = list(
          object(meshes[index(mesh, meshes.length, 'morph mesh')], 'morph mesh'),
          'primitives',
        )[0]
        const targets =
          primitive === undefined ? [] : list(object(primitive, 'morph primitive'), 'targets')
        if (targets.length === 0)
          throw new TypeError('UVM weights channel targets a mesh without morph targets')
        return targets.length
      })()
      const targetId =
        visible === undefined
          ? `node-${node}`
          : 'node' in visible
            ? `node-${visible.node}`
            : `mesh-${visible.mesh}-primitive-${visible.primitive}`
      const key = `${targetId}/${targetPath}`
      if (targets.has(key)) throw new TypeError('UVM animation repeats a node property')
      targets.add(key)
      const interpolation = sampler['interpolation'] ?? 'LINEAR'
      if (
        typeof interpolation !== 'string' ||
        !['STEP', 'LINEAR', 'CUBICSPLINE'].includes(interpolation)
      )
        throw new TypeError('UVM animation interpolation is invalid')
      // CUBICSPLINE stores [in-tangent, value, out-tangent] per key
      const cubic = interpolation === 'CUBICSPLINE'
      const output = read(sampler['output'], 'animation value')
      const width = morphWeights
        ? morphTargets
        : visible !== undefined
          ? 1
          : targetPath === 'rotation'
            ? 4
            : 3
      if (
        output.width !== (morphWeights ? 1 : width) ||
        output.count * output.width !== input.count * (cubic ? 3 : 1) * width ||
        output.componentType !== 5126 ||
        output.normalized
      )
        throw new TypeError('UVM animation input/output accessor shape is invalid')
      const metadata = uvMetadata(channel)
      const keyTimes = readUvmKeyTimes(
        metadata['keyTimes'],
        { values: input.values, maxScalarBytes: maxScalarBytes - decodedBytes },
        signal,
      )
      if (keyTimes !== undefined) decodedBytes += keyTimes.length * 8
      const samples = Array.from(keyTimes ?? input.values, (timeSeconds, frame) => {
        const at = (slot: number) => {
          const start = (cubic ? frame * 3 + slot : frame) * width
          return Array.from(output.values.subarray(start, start + width))
        }
        const value = at(cubic ? 1 : 0)
        if (width === 4 && !morphWeights && Math.abs(Math.hypot(...value) - 1) > 0.0001)
          throw new TypeError('UVM animation quaternion is not a unit quaternion')
        return cubic
          ? { frame, timeSeconds, value, inTangent: at(0), outTangent: at(2) }
          : { frame, timeSeconds, value }
      })
      if (metadata['globalSeqId'] !== undefined) {
        unsupportedChannels++
        continue
      }
      if (metadata['concurrent'] !== undefined && typeof metadata['concurrent'] !== 'boolean')
        throw new TypeError('UVM animation concurrent flag is invalid')
      if (
        metadata['wrapSeconds'] !== undefined &&
        (metadata['concurrent'] !== true ||
          typeof metadata['wrapSeconds'] !== 'number' ||
          !Number.isFinite(metadata['wrapSeconds']) ||
          metadata['wrapSeconds'] <= 0)
      )
        throw new TypeError('UVM animation independent wrap duration is invalid')
      if (
        metadata['repeatCount'] !== undefined &&
        (metadata['concurrent'] !== true ||
          typeof metadata['repeatCount'] !== 'number' ||
          !Number.isSafeInteger(metadata['repeatCount']) ||
          metadata['repeatCount'] < 0 ||
          metadata['wrapSeconds'] === undefined)
      )
        throw new TypeError('UVM animation independent repeat count is invalid')
      channels.push({
        target: targetId,
        kind: visible !== undefined ? 'visibility' : String(targetPath),
        firstFrame: 0,
        lastFrame: samples.length - 1,
        samples,
        interpolation:
          interpolation === 'STEP'
            ? 'step'
            : cubic
              ? 'cubic-spline'
              : width === 4 && !morphWeights
                ? 'spherical-linear'
                : 'linear',
        ...(metadata['concurrent'] === undefined ? {} : { concurrent: metadata['concurrent'] }),
        ...(metadata['wrapSeconds'] === undefined ? {} : { wrapSeconds: metadata['wrapSeconds'] }),
        ...(metadata['repeatCount'] === undefined ? {} : { repeatCount: metadata['repeatCount'] }),
      })
    }
    const metadata = uvMetadata(animation)
    if (metadata['sourceDurationSeconds'] !== undefined) {
      if (
        typeof metadata['sourceDurationSeconds'] !== 'number' ||
        !Number.isFinite(metadata['sourceDurationSeconds']) ||
        metadata['sourceDurationSeconds'] < 0
      )
        throw new TypeError('UVM source animation duration is invalid')
      durationSeconds = metadata['sourceDurationSeconds']
    }
    if (metadata['looping'] !== undefined && typeof metadata['looping'] !== 'boolean')
      throw new TypeError('UVM animation looping flag is invalid')
    if (
      metadata['repeatCount'] !== undefined &&
      (typeof metadata['repeatCount'] !== 'number' ||
        !Number.isSafeInteger(metadata['repeatCount']) ||
        metadata['repeatCount'] < 0)
    )
      throw new TypeError('UVM animation repeat count is invalid')
    const sequenceIndex = metadata['sourceSequenceIndex']
    if (
      sequenceIndex !== undefined &&
      (typeof sequenceIndex !== 'number' ||
        !Number.isSafeInteger(sequenceIndex) ||
        sequenceIndex < 0)
    )
      throw new TypeError('UVM animation sequence index is invalid')
    clips.push({
      id: `animation-${clipIndex}`,
      name: typeof animation['name'] === 'string' ? animation['name'] : '',
      kind: frames.size > 1 ? 'animation' : 'rest-pose',
      provenance: 'direct',
      frames: frames.size,
      durationSeconds,
      channels,
      ...(metadata['looping'] === undefined ? {} : { looping: metadata['looping'] }),
      ...(metadata['repeatCount'] === undefined ? {} : { repeatCount: metadata['repeatCount'] }),
      ...uvmAnimationPlayback(field(animation['extensions'], 'UV_game_animation_clips')),
      ...clipEvents(animation, nodes.length),
      ...(unsupportedChannels === 0 ? {} : { unsupportedChannels }),
      ...(sequenceIndex === undefined ? {} : { sequenceIndex }),
    })
  }
  const selectable =
    catalog === undefined
      ? clips
      : catalog.map((entry): ModelAnimationClip => {
          const sampled =
            entry.animation === undefined
              ? undefined
              : required(clips[entry.animation], 'catalog animation')
          return {
            ...sampled,
            id: entry.id,
            name: entry.name,
            durationSeconds: entry.durationSeconds,
            sequenceIndex: entry.sourceSequenceIndex,
            kind:
              entry.kind ??
              sampled?.kind ??
              (entry.durationSeconds > 0 ? 'animation' : 'rest-pose'),
            provenance: 'direct' as const,
            frames: entry.frames ?? sampled?.frames ?? 0,
            channels: sampled?.channels ?? [],
            ...(entry.looping === undefined ? {} : { looping: entry.looping }),
            ...(entry.repeatCount === undefined ? {} : { repeatCount: entry.repeatCount }),
          }
        })
  const jointNodes = new Set(bindings.map(binding => binding.nodeId))
  const nodePoses = [...animatedNodes]
    .filter(node => !jointNodes.has(`node-${node}`))
    .map(node => {
      const source = required(nodes[node], 'animated node')
      return {
        nodeId: `node-${node}`,
        localPose: {
          translation: vector3(source['translation'] ?? [0, 0, 0]),
          rotation: vector4(source['rotation'] ?? [0, 0, 0, 1]),
          scale: vector3(source['scale'] ?? [1, 1, 1]),
        },
      }
    })
  return { bindings, nodePoses, clips: selectable, incompleteBindings, decodedBytes }
}

/** A mesh-level facet can name one skin; differing per-instance skins require an instance facet. */
export function uvmMeshSkins(document: JsonObject): ReadonlyMap<number, number | null> {
  const result = new Map<number, number | null>()
  const skins = list(document, 'skins')
  for (const candidate of list(document, 'nodes')) {
    const node = object(candidate, 'UVM node')
    if (node['mesh'] === undefined) continue
    const mesh = index(node['mesh'], list(document, 'meshes').length, 'skinned mesh')
    const skin = node['skin'] === undefined ? null : index(node['skin'], skins.length, 'mesh skin')
    if (result.has(mesh) && result.get(mesh) !== skin)
      throw new TypeError(
        'UVM mesh instances use different skin bindings, which the mesh facet cannot represent',
      )
    result.set(mesh, skin)
  }
  return result
}
