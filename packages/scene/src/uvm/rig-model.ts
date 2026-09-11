// Intended for packages/scene/src/uvm. No native schema, packing or basis conversion.
import type { JsonObject, JsonValue, ModelBoneBinding } from '@modkit/sdk'
import type { UvmContainer } from '@modkit/uv/model/container'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { readUvmModel } from './model.js'
import { projectUvmStaticModel, type StaticModelBudget } from './static-model.js'
import { array, object } from './values.js'
import { invertMaterialFrame } from '../materials/frame.js'
import { boundUvmRig, boundUvmRootFrame } from './rig-bounds.js'

function only(value: JsonObject, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new TypeError(`${label}.${key} is outside explicit rig authoring`)
}
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new TypeError(`missing ${label}`)
  return value
}
function copy(value: JsonValue, budget: StaticModelBudget, signal?: AbortSignal): JsonValue {
  return snapshotJson(
    value,
    {
      maxDepth: 96,
      maxNodes: budget.maxNodes,
      maxBytes: budget.maxScalarBytes,
    },
    signal,
  )
}
function identity(values: readonly number[]): boolean {
  return values.every((value, index) => value === (index % 5 === 0 ? 1 : 0))
}

/** One explicit skin; identity mesh frames; named TRS joints. Multiple mesh regions and
 * arbitrary source skin-slot order are mapped to one parent-before-child skeleton. */
export function projectUvmRigModel(
  container: UvmContainer,
  budget: StaticModelBudget & { readonly spatialRoundoff?: number },
  signal?: AbortSignal,
) {
  const document = container.document,
    skins = array(document, 'skins')
  if (skins.length !== 1) throw new TypeError('rig authoring requires one explicit skin')
  const skin = object(skins[0], 'skin')
  only(skin, ['joints', 'inverseBindMatrices', 'skeleton'], 'skin')
  const parsed = readUvmModel(document, container.binary, budget, signal)
  if (parsed.rig.incompleteBindings || parsed.rig.bindings.length === 0)
    throw new TypeError('rig authoring requires complete TRS bindings')
  const bindings = parsed.rig.bindings
  if (bindings.length > Math.min(65535, budget.maxNodes))
    throw new RangeError('rig bone count exceeds bounded index range')
  const jointIds = new Set(bindings.map(binding => binding.nodeId))
  const nodes = array(document, 'nodes'),
    meshes = array(document, 'meshes'),
    cameras = array(document, 'cameras')
  const nodeParents = new Map<number, number>()
  for (const [parent, raw] of nodes.entries())
    for (const child of array(object(raw, 'node'), 'children')) {
      if (typeof child !== 'number') throw new TypeError('invalid child index')
      if (nodeParents.has(child)) throw new TypeError('rig node has multiple parents')
      nodeParents.set(child, parent)
    }
  const meshNodes: JsonObject[] = [],
    primitiveIds: string[] = [],
    usedMeshes = new Set<number>()
  const sceneRoots = array(object(array(document, 'scenes')[0], 'scene'), 'nodes')
  const reachable = new Set<number>()
  const visit = (node: number, depth = 0, jointAncestor = false): void => {
    if (
      !Number.isSafeInteger(node) ||
      node < 0 ||
      node >= nodes.length ||
      reachable.has(node) ||
      depth > 96
    )
      throw new TypeError('rig scene has invalid/repeated nodes')
    signal?.throwIfAborted()
    reachable.add(node)
    if (jointAncestor && object(nodes[node], 'node')['mesh'] !== undefined)
      throw new TypeError(
        'a skinned mesh below an animated joint needs an instance-frame correspondence',
      )
    for (const child of array(object(nodes[node], 'node'), 'children')) {
      if (typeof child !== 'number') throw new TypeError('invalid child index')
      visit(child, depth + 1, jointAncestor || jointIds.has(`node-${node}`))
    }
  }
  for (const root of sceneRoots) {
    if (typeof root !== 'number') throw new TypeError('invalid scene root')
    visit(root)
  }
  if (reachable.size !== nodes.length)
    throw new TypeError('rig authoring refuses unreachable nodes')
  for (const [index, raw] of nodes.entries()) {
    const node = object(raw, 'node'),
      joint = jointIds.has(`node-${index}`)
    only(
      node,
      joint
        ? ['name', 'children', 'translation', 'rotation', 'scale', 'extensions']
        : [
            'name',
            'children',
            'mesh',
            'skin',
            'camera',
            'translation',
            'rotation',
            'scale',
            'matrix',
            'extensions',
          ],
      'node',
    )
    if (node['extensions'] !== undefined)
      only(
        object(node['extensions'], 'node extensions'),
        joint ? ['UV_node_billboard'] : ['UV_game_socket', 'UV_game_collision'],
        'node.extensions',
      )
    if (joint) {
      if (
        typeof node['name'] !== 'string' ||
        !node['name'].trim() ||
        node['name'] !== node['name'].trim() ||
        node['name'].includes('\0')
      )
        throw new TypeError('joint requires an exact nonempty name')
      continue
    }
    if (node['camera'] !== undefined) {
      if (
        !Number.isSafeInteger(node['camera']) ||
        Number(node['camera']) < 0 ||
        Number(node['camera']) >= cameras.length ||
        node['mesh'] !== undefined ||
        node['skin'] !== undefined ||
        array(node, 'children').length !== 0
      )
        throw new TypeError('rig camera helper must reference one camera without geometry or children')
      // Static scene cameras are consumed by the calling format projection. Their frame is
      // intentionally independent from the native skeleton and need not be identity.
      continue
    }
    if (!identity(required(parsed.scene.nodes[index], 'scene node').transform))
      throw new TypeError('fresh skinned mesh/helper frames must be identity')
    if (node['mesh'] === undefined) continue
    if (node['skin'] !== 0 || typeof node['mesh'] !== 'number')
      throw new TypeError('every rig mesh must use the declared skin')
    const meshIndex = node['mesh']
    if (usedMeshes.has(meshIndex))
      throw new TypeError('skinned mesh instances require an explicit instance binding projection')
    usedMeshes.add(meshIndex)
    const mesh = object(meshes[meshIndex], 'mesh')
    for (const [primitiveIndex] of array(mesh, 'primitives').entries())
      primitiveIds.push(`mesh-${meshIndex}-primitive-${primitiveIndex}`)
    meshNodes.push({
      ...(typeof node['name'] === 'string' ? { name: node['name'] } : {}),
      mesh: meshIndex,
    })
  }
  if (usedMeshes.size !== meshes.length) throw new TypeError('rig authoring refuses unused meshes')
  const sorted: ModelBoneBinding[] = [],
    done = new Set<number>(),
    active = new Set<number>()
  const byIndex = new Map(bindings.map(binding => [binding.boneIndex, binding]))
  const append = (binding: ModelBoneBinding): void => {
    if (done.has(binding.boneIndex)) return
    if (active.has(binding.boneIndex)) throw new TypeError('rig parent cycle')
    active.add(binding.boneIndex)
    if (binding.parentBoneIndex !== null && binding.parentBoneIndex !== undefined)
      append(required(byIndex.get(binding.parentBoneIndex), 'parent bone'))
    active.delete(binding.boneIndex)
    done.add(binding.boneIndex)
    sorted.push(binding)
  }
  for (const binding of bindings) append(binding)
  const remap = new Map(sorted.map((binding, index) => [binding.boneIndex, index]))
  const nodeToBone = new Map(sorted.map((binding, index) => [binding.nodeId, index]))
  const restPoses = sorted.map((binding, index) => {
    const pose = required(binding.localPose, 'joint local pose')
    invertMaterialFrame(required(binding.inverseBindMatrix, 'inverse bind matrix'))
    if (pose.scale.some(value => value === 0)) throw new TypeError('singular joint scale')
    return {
      index,
      name: required(binding.boneName ?? undefined, 'bone name'),
      parentIndex:
        binding.parentBoneIndex === null || binding.parentBoneIndex === undefined
          ? -1
          : required(remap.get(binding.parentBoneIndex), 'parent remapping'),
      translation: [...pose.translation],
      rotation: [...pose.rotation],
      scale: [...pose.scale],
      inverseBindMatrix: [...required(binding.inverseBindMatrix, 'inverse bind matrix')],
    }
  })
  // Validate/retain the full common standard material and geometry profile in the existing
  // shared projection; only the explicitly mapped skin, nodes and clips are detached here.
  // snapshotJson returns a deeply frozen owned snapshot. Only its root is edited;
  // mapped node/scene/mesh arrays below are rebuilt without mutating nested values.
  const detached: Record<string, JsonValue> = {
    ...object(copy(document, budget, signal), 'detached document'),
  }
  delete detached['skins']
  delete detached['animations']
  const detachedExtensions = object(detached['extensions'] ?? {}, 'detached extensions')
  if (Object.hasOwn(detachedExtensions, 'UV_game_animation_clips')) {
    const { UV_game_animation_clips: _clips, ...extensions } = detachedExtensions
    detached['extensions'] = extensions
    detached['extensionsUsed'] = array(detached, 'extensionsUsed').filter(
      name => name !== 'UV_game_animation_clips',
    )
    detached['extensionsRequired'] = array(detached, 'extensionsRequired').filter(
      name => name !== 'UV_game_animation_clips',
    )
  }
  const sceneOnlyExtensions = new Set([
    'UV_game_effects',
    'UV_scene_lights',
    'UV_game_socket',
    'UV_game_collision',
  ])
  detached['extensions'] = Object.fromEntries(
    Object.entries(object(detached['extensions'] ?? {}, 'detached extensions')).filter(
      ([name]) => !sceneOnlyExtensions.has(name),
    ),
  )
  detached['extensionsUsed'] = array(detached, 'extensionsUsed').filter(
    name => !sceneOnlyExtensions.has(String(name)),
  )
  detached['extensionsRequired'] = array(detached, 'extensionsRequired').filter(
    name => !sceneOnlyExtensions.has(String(name)),
  )
  detached['nodes'] = meshNodes
  detached['scenes'] = [{ nodes: meshNodes.map((_node, index) => index) }]
  detached['scene'] = 0
  // Original scene restrictions must be validated before replacing its node list.
  if (array(document, 'scenes').length !== 1 || (document['scene'] ?? 0) !== 0)
    throw new TypeError('rig authoring requires one scene')
  only(object(array(document, 'scenes')[0], 'scene'), ['nodes'], 'scene')
  detached['meshes'] = meshes.map(raw => {
    const mesh = object(raw, 'mesh')
    only(mesh, ['name', 'primitives'], 'mesh')
    return {
      ...(typeof mesh['name'] === 'string' ? { name: mesh['name'] } : {}),
      primitives: array(mesh, 'primitives').map(rawPrimitive => {
        const primitive = object(rawPrimitive, 'primitive'),
          attributes = object(primitive['attributes'], 'attributes')
        const geometry = { ...attributes }
        delete geometry['JOINTS_0']
        delete geometry['WEIGHTS_0']
        if (attributes['JOINTS_0'] === undefined || attributes['WEIGHTS_0'] === undefined)
          throw new TypeError('rig geometry requires paired influences')
        return { ...primitive, attributes: geometry }
      }),
    }
  })
  const projected =
    meshes.length === 0
      ? {
          model: {
            meshes: [],
            materials: [],
            skeleton: { bones: [] },
            animations: [],
            effects: { particles: [], ribbons: [] },
            bounds: null,
            metadata: { coordinateSystem: 'Y_UP' },
          } satisfies JsonObject,
          materialRequirements: [] as JsonObject[],
        }
      : projectUvmStaticModel({ ...container, document: detached }, budget, signal)
  const primitives = new Map(parsed.scene.primitives.map(primitive => [primitive.id, primitive]))
  const projectedMeshes = projected.model.meshes.map((mesh, index) => {
    const primitive = required(
      primitives.get(required(primitiveIds[index], 'primitive order')),
      'primitive',
    )
    const boneIndices = [...required(primitive.boneIndices, 'skin indices')].map(value =>
      required(remap.get(value), 'skin index mapping'),
    )
    return {
      ...mesh,
      boneIndices,
      boneWeights: [...required(primitive.boneWeights, 'skin weights')],
    }
  })
  for (const rawAnimation of array(document, 'animations')) {
    const animation = object(rawAnimation, 'animation')
    only(animation, ['name', 'channels', 'samplers', 'extras'], 'animation')
    if (animation['extras'] !== undefined) {
      const extras = object(animation['extras'], 'clip extras')
      only(extras, ['uv'], 'clip extras')
      only(
        object(extras['uv'], 'clip metadata'),
        ['sourceDurationSeconds', 'sourceSequenceIndex', 'looping'],
        'clip metadata',
      )
    }
    for (const raw of array(animation, 'channels')) {
      const channel = object(raw, 'channel')
      only(channel, ['sampler', 'target', 'extras'], 'channel')
      const target = object(channel['target'], 'channel target')
      only(target, ['node', 'path', 'extensions'], 'channel target')
      if (target['extensions'] !== undefined)
        only(
          object(target['extensions'], 'channel target extensions'),
          ['KHR_animation_pointer'],
          'channel target.extensions',
        )
      if (channel['extras'] !== undefined) {
        const extras = object(channel['extras'], 'channel extras')
        only(extras, ['uv'], 'channel extras')
        only(
          object(extras['uv'], 'channel metadata'),
          ['keyTimes', 'sourceLineType', 'concurrent', 'wrapSeconds'],
          'channel metadata',
        )
      }
    }
    for (const raw of array(animation, 'samplers'))
      only(object(raw, 'sampler'), ['input', 'output', 'interpolation'], 'sampler')
  }
  const animations = parsed.rig.clips.map((clip, clipIndex) => {
    if (
      clip.unsupportedChannels ||
      clip.durationSeconds === undefined ||
      clip.durationSeconds <= 0 ||
      !clip.name.trim() ||
      clip.name !== clip.name.trim() ||
      clip.name.includes('\0')
    )
      throw new TypeError('clip requires positive duration, exact name and supported channels')
    if (clip.sequenceIndex !== undefined && clip.sequenceIndex !== clipIndex)
      throw new TypeError('rig authoring requires dense ordered sequence indices')
    const nodeTracks = new Map<number, Record<string, JsonValue>>()
    for (const channel of clip.channels ?? []) {
      if (
        !['translation', 'rotation', 'scale', 'visibility'].includes(channel.kind) ||
        (channel.concurrent !== undefined && typeof channel.concurrent !== 'boolean') ||
        (channel.wrapSeconds !== undefined &&
          (!Number.isFinite(channel.wrapSeconds) || channel.wrapSeconds <= 0))
      )
        throw new TypeError('clip requires supported bone TRS/visibility channels')
      const boneIndex = required(nodeToBone.get(channel.target), 'animation bone target')
      const track = nodeTracks.get(boneIndex) ?? { boneIndex }
      if (!['step', 'linear', 'spherical-linear'].includes(channel.interpolation ?? ''))
        throw new TypeError('unsupported clip interpolation')
      track[channel.kind] = {
        lineType: channel.interpolation === 'step' ? 0 : 1,
        ...(channel.concurrent === undefined ? {} : { concurrent: channel.concurrent }),
        ...(channel.wrapSeconds === undefined ? {} : { wrapSeconds: channel.wrapSeconds }),
        keys: required(channel.samples, 'channel samples').map(sample => ({
          frame: required(sample.timeSeconds, 'sample time'),
          vector: [...sample.value],
        })),
      }
      nodeTracks.set(boneIndex, track)
    }
    return {
      name: clip.name,
      durationSeconds: clip.durationSeconds,
      looping: clip.looping ?? false,
      nodeTracks: [...nodeTracks.values()],
    }
  })
  const bounds = boundUvmRig(sorted, parsed.scene.primitives, parsed.rig.clips, budget, signal)
  const rootBounds = boundUvmRootFrame(
    required(sorted[0], 'bounds root'),
    parsed.rig.clips,
    bounds.radius,
    budget,
    signal,
  )
  return {
    ...projected,
    model: {
      ...projected.model,
      meshes: projectedMeshes,
      skeleton: {
        bones: restPoses.map(pose => ({
          index: pose.index,
          name: pose.name,
          parentIndex: pose.parentIndex,
          inverseBindMatrix: pose.inverseBindMatrix,
        })),
      },
      animations,
    },
    restPoses,
    bounds: { ...bounds, msecRadius: rootBounds.radius },
    nodeBoneIndices: Object.freeze(
      Object.fromEntries(
        [...nodeToBone].map(([id, bone]) => [
          Number(required(id, 'bone node id').slice('node-'.length)),
          bone,
        ]),
      ),
    ),
    nodeParents: Object.freeze(Object.fromEntries(nodeParents)),
  }
}
