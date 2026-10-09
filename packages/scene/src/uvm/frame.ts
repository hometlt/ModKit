import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, object, required, safeIndex } from './values.js'
import { createRenderMaterialSampler, RENDER_MATERIAL_SHADER } from '../materials/index.js'
import {
  IDENTITY_MATERIAL_FRAME,
  invertMaterialFrame,
  multiplyMaterialFrames,
} from '../materials/frame.js'
import { field } from './values.js'

/** Apply a common affine frame to a single UVM scene, including its skin roots.
 * Local vertices, inverse binds and animation keys remain in their authored coordinate frame.
 * The normal glTF node transform carries the change; no native metadata is interpreted here.
 */
export function rebaseUvmScene(
  source: UvmContainer,
  transform: readonly number[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): UvmContainer {
  signal?.throwIfAborted()
  if (
    transform.length !== 16 ||
    !transform.every(Number.isFinite) ||
    [3, 7, 11].some(index => transform[index] !== 0) ||
    transform[15] !== 1
  )
    throw new TypeError('UVM scene frame must be a finite affine matrix')
  const value = (index: number) => required(transform[index], 'frame component')
  const determinant =
    value(0) * (value(5) * value(10) - value(9) * value(6)) -
    value(4) * (value(1) * value(10) - value(9) * value(2)) +
    value(8) * (value(1) * value(6) - value(5) * value(2))
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new TypeError('UVM scene frame must be invertible')
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  writeUvmContainer(source, budget, signal)
  const scenes = array(source.document, 'scenes')
  if (scenes.length !== 1 || source.document['scene'] !== 0)
    throw new TypeError('UVM scene rebasing requires one explicit default scene')
  const scene = object(scenes[0], 'scene')
  for (const [value, label] of [
    [source.document['nodes'], 'nodes'],
    [scene['nodes'], 'scene roots'],
  ] as const)
    if (value !== undefined && !Array.isArray(value))
      throw new TypeError(`UVM ${label} must be an array`)
  const nodes = array(source.document, 'nodes')
  const roots = array(scene, 'nodes')
  for (const root of roots) safeIndex(root, nodes.length, 'scene root')
  if (new Set(roots).size !== roots.length) throw new TypeError('UVM scene roots must be unique')
  const materials = array(source.document, 'materials').map(value => {
    const material = object(value, 'material'),
      extensions = field(material, 'extensions'),
      extension = field(extensions, 'UV_game_material')
    if (field(extension, 'shader') !== RENDER_MATERIAL_SHADER) return material
    const game = object(extension, 'game material'),
      params = object(game['params'], 'material params')
    const sampler = createRenderMaterialSampler(
      params,
      { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
      signal,
    )
    if (!sampler.usesWorldProjection && sampler.worldToMaterial === undefined) return material
    const frame = multiplyMaterialFrames(
      sampler.worldToMaterial ?? IDENTITY_MATERIAL_FRAME,
      invertMaterialFrame(transform),
    )
    return {
      ...material,
      extensions: {
        ...object(extensions, 'material extensions'),
        UV_game_material: {
          ...game,
          params: {
            ...params,
            renderModel: {
              ...object(params['renderModel'], 'render model'),
              worldToMaterial: [...frame],
            },
          },
        },
      },
    }
  })
  const document = snapshotJson(
    {
      ...source.document,
      ...(source.document['materials'] === undefined ? {} : { materials }),
      nodes: [
        ...nodes,
        { name: 'Source coordinate frame', matrix: [...transform], children: roots },
      ],
      scenes: [{ ...scene, nodes: [nodes.length] }],
    },
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  )
  const result: UvmContainer = {
    format: source.format,
    document: object(document, 'rebased document'),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(result.document, {
    binaryByteLength: result.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  writeUvmContainer(result, budget, signal)
  return result
}

/** Remove the exact frame previously added by rebaseUvmScene. Target exporters use this when
 * their encoder already performs the same units/basis conversion. An authored root that does not
 * match the expected matrix is never guessed or baked. */
export function removeUvmSceneFrame(
  source: UvmContainer,
  expectedTransform: readonly number[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
  expectedNode?: number,
): UvmContainer {
  signal?.throwIfAborted()
  const scenes = array(source.document, 'scenes')
  const nodes = array(source.document, 'nodes')
  if (scenes.length !== 1 || source.document['scene'] !== 0)
    throw new TypeError('UVM scene frame removal requires one explicit default scene')
  const scene = object(scenes[0], 'scene')
  const roots = array(scene, 'nodes')
  const frameIndex = expectedNode ?? nodes.length - 1
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= nodes.length)
    throw new TypeError('UVM scene frame index is invalid')
  if (roots.length !== 1 || roots[0] !== frameIndex)
    throw new TypeError('UVM scene frame is not the sole root')
  const frame = object(nodes[frameIndex], 'scene frame')
  const allowed = ['name', 'matrix', 'children']
  if (Object.keys(frame).some(key => !allowed.includes(key)))
    throw new TypeError('UVM scene frame has authored properties')
  const matrix = array(frame, 'matrix')
  if (
    frame['name'] !== 'Source coordinate frame' ||
    matrix.length !== 16 ||
    expectedTransform.length !== 16 ||
    matrix.some((value, index) => value !== expectedTransform[index])
  )
    throw new TypeError('UVM scene frame does not match the expected transform')
  const restoredRoots = array(frame, 'children')
  for (const root of restoredRoots) {
    safeIndex(root, nodes.length, 'restored scene root')
    if (root === frameIndex) throw new TypeError('scene frame cannot contain itself')
  }
  if (new Set(restoredRoots).size !== restoredRoots.length)
    throw new TypeError('restored UVM scene roots must be unique')
  const materials = array(source.document, 'materials').map(value => {
    const material = object(value, 'material')
    const extensions = field(material, 'extensions')
    const extension = field(extensions, 'UV_game_material')
    if (field(extension, 'shader') !== RENDER_MATERIAL_SHADER) return material
    const game = object(extension, 'game material')
    const params = object(game['params'], 'material params')
    const sampler = createRenderMaterialSampler(
      params,
      { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
      signal,
    )
    if (!sampler.usesWorldProjection && sampler.worldToMaterial === undefined) return material
    const restored = multiplyMaterialFrames(
      sampler.worldToMaterial ?? IDENTITY_MATERIAL_FRAME,
      expectedTransform,
    )
    return {
      ...material,
      extensions: {
        ...object(extensions, 'material extensions'),
        UV_game_material: {
          ...game,
          params: {
            ...params,
            renderModel: {
              ...object(params['renderModel'], 'render model'),
              worldToMaterial: [...restored],
            },
          },
        },
      },
    }
  })
  const extensions = { ...object(source.document['extensions'] ?? {}, 'extensions') }
  const remapNode = (value: unknown, label: string): number => {
    const index = safeIndex(value, nodes.length, label)
    if (index === frameIndex) throw new TypeError(`${label} cannot retain the removed scene frame`)
    return index > frameIndex ? index - 1 : index
  }
  for (const name of ['UV_game_effects', 'UV_game_baked_particles', 'UV_scene_lights']) {
    if (extensions[name] === undefined) continue
    const extension = object(extensions[name], name)
    if (extension['spaceNode'] === frameIndex) {
      const { spaceNode: _spaceNode, ...rest } = extension
      extensions[name] = rest
    } else if (extension['spaceNode'] !== undefined)
      extensions[name] = { ...extension, spaceNode: remapNode(extension['spaceNode'], `${name} spaceNode`) }
  }
  const restoredNodes = nodes.flatMap((value, index) => {
    if (index === frameIndex) return []
    const node = object(value, 'node')
    if (node['children'] === undefined) return [node]
    return [{ ...node, children: array(node, 'children').map(child => remapNode(child, 'node child')) }]
  })
  const skins = source.document['skins'] === undefined
    ? undefined
    : array(source.document, 'skins').map(value => {
        const skin = object(value, 'skin')
        return {
          ...skin,
          joints: array(skin, 'joints').map(joint => remapNode(joint, 'skin joint')),
          ...(skin['skeleton'] === undefined
            ? {}
            : { skeleton: remapNode(skin['skeleton'], 'skin skeleton') }),
        }
      })
  const animations = source.document['animations'] === undefined
    ? undefined
    : array(source.document, 'animations').map(value => {
        const animation = object(value, 'animation')
        return {
          ...animation,
          channels: array(animation, 'channels').map(value => {
            const channel = object(value, 'animation channel'), target = object(channel['target'], 'animation target')
            if (target['node'] === undefined) return channel
            return { ...channel, target: { ...target, node: remapNode(target['node'], 'animation target node') } }
          }),
        }
      })
  const document = snapshotJson(
    {
      ...source.document,
      ...(source.document['materials'] === undefined ? {} : { materials }),
      ...(skins === undefined ? {} : { skins }),
      ...(animations === undefined ? {} : { animations }),
      extensions,
      nodes: restoredNodes,
      scenes: [{ ...scene, nodes: restoredRoots.map(root => remapNode(root, 'restored scene root')) }],
    },
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  )
  const result: UvmContainer = {
    ...source,
    document: object(document, 'unframed document'),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(result.document, {
    binaryByteLength: result.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  writeUvmContainer(result, budget, signal)
  return result
}
