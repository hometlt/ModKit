/**
 * The frame the materializer puts around a projected scene, and its inverse for writers.
 *
 * Geometry stays as the source published it; up to three root nodes carry the frame: `uv:units`
 * (source units to metres, recorded by UV_units), `uv:up-axis` (+z up to +y up) and
 * `uv:handedness` (a mirror for a left-handed source), outermost first. A render material that
 * places a texture by world position keeps its `worldToMaterial` in the source frame, so the frame
 * is folded into it, as `rebaseUvmScene` does for its own frame node.
 */
import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { invertAffine, multiplyAffine } from '@modkit/codec-kit/model-math/transform'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from './container.js'
import { validateUvmDocument } from './validation/index.js'
import { array, field, object, safeIndex } from './validation/values.js'

/** UV sources of the render material program that place a texture by world position. */
export const WORLD_PROJECTION_UV_SOURCES: readonly number[] = Object.freeze([5, 13, 14, 17, 18])

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const UP_AXIS_ROTATION = Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])

const record = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined

/**
 * Whether render material params (`renderModel` version 1) follow a frame put around the scene:
 * they state a `worldToMaterial`, or a pass has a textured layer on a world-projection UV source.
 */
export function renderMaterialFollowsSceneFrame(params: unknown): boolean {
  const model = record(record(params)?.['renderModel'])
  if (model === undefined || model['version'] !== 1) return false
  if (model['worldToMaterial'] !== undefined) return true
  const composite = record(model['composite'])
  const materials =
    composite === undefined
      ? [model['standard']]
      : array(composite, 'passes').map(pass => record(pass)?.['material'])
  return materials.some(material =>
    Object.values(record(record(material)?.['layers']) ?? {}).some(layer => {
      const value = record(layer)
      return (
        typeof value?.['texturePath'] === 'string' &&
        typeof value['uvSource'] === 'number' &&
        WORLD_PROJECTION_UV_SOURCES.includes(value['uvSource'])
      )
    }),
  )
}

/**
 * A material whose render model follows the scene frame, its `worldToMaterial` multiplied by
 * `frame` on the right (`frame` maps the new scene coordinates to the old); any other as it is.
 */
export function withMaterialFrame<Material>(
  material: Material,
  frame: readonly number[],
): Material {
  const extensions = record(field(material, 'extensions'))
  const game = record(extensions?.['UV_game_material'])
  const params = record(game?.['params'])
  if (extensions === undefined || game === undefined || params === undefined) return material
  if (!renderMaterialFollowsSceneFrame(params)) return material
  const model = object(params['renderModel'], 'render model')
  const current = model['worldToMaterial']
  const worldToMaterial = multiplyAffine(
    Array.isArray(current) ? (current as readonly number[]) : IDENTITY,
    frame,
  )
  return {
    ...material,
    extensions: {
      ...extensions,
      UV_game_material: {
        ...game,
        params: { ...params, renderModel: { ...model, worldToMaterial } },
      },
    },
  }
}

export interface UvmSceneFrame {
  /** The scale `uv:units` applies (UV_units.metersPerSourceUnit); 1 without that node. */
  readonly metersPerSourceUnit: number
  readonly upAxis: '+y' | '+z'
  readonly handedness: 'right' | 'left'
}

/** Source coordinates to document coordinates under the wrappers: units · up axis · mirror. */
export function uvmSceneFrameMatrix(frame: UvmSceneFrame): number[] {
  const scale = frame.metersPerSourceUnit
  // prettier-ignore
  const units = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]
  // (x, y, z) → (x, z, -y): the rotation `uv:up-axis` states
  // prettier-ignore
  const upAxis = frame.upAxis === '+z' ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] : IDENTITY
  const mirror =
    frame.handedness !== 'left'
      ? IDENTITY
      : frame.upAxis === '+z'
        ? [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
  return multiplyAffine(units, multiplyAffine(upAxis, mirror))
}

/** The inverse of `uvmSceneFrameMatrix`, for the materials the materializer frames. */
export function uvmSceneFrameInverse(frame: UvmSceneFrame): number[] {
  return invertAffine(uvmSceneFrameMatrix(frame))
}

const sameNumbers = (value: unknown, expected: readonly number[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((item, index) => item === expected[index])

/**
 * Take the materializer's frame nodes off a UVM document: the scene is in source units and axes
 * again, render materials get their source `worldToMaterial` back, and UV_units (which says the
 * geometry is in metres) goes with the `uv:units` node and is returned. Writers whose format is in
 * the source frame call this instead of walking the wrappers. A document without them is returned
 * as it is; a node that has a wrapper's name but not exactly the materializer's form is refused.
 */
export function removeUvmFrameWrappers(
  source: UvmContainer,
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): {
  readonly container: UvmContainer
  readonly frame: UvmSceneFrame & { readonly units?: JsonObject }
} {
  signal?.throwIfAborted()
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  const document = source.document
  const scenes = array(document, 'scenes')
  if (scenes.length !== 1 || document['scene'] !== 0)
    throw new TypeError('UVM frame removal requires one explicit default scene')
  const scene = object(scenes[0], 'scene')
  const nodes = array(document, 'nodes')
  const roots = array(scene, 'nodes').map(root => safeIndex(root, nodes.length, 'scene root'))
  const extensions = record(document['extensions']) ?? {}
  const unitsRecord = record(extensions['UV_units'])
  const removed: number[] = []
  let metersPerSourceUnit = 1
  let upAxis: '+y' | '+z' = '+y'
  let handedness: 'right' | 'left' = 'right'
  // the chain's outermost node is one scene root; each wrapper holds the next as its only child
  const at = roots.findIndex(root =>
    ['uv:units', 'uv:up-axis', 'uv:handedness'].includes(String(record(nodes[root])?.['name'])),
  )
  let inner: number[] = at === -1 ? [] : [roots[at]!]
  for (const [name, property] of [
    ['uv:units', 'scale'],
    ['uv:up-axis', 'rotation'],
    ['uv:handedness', 'scale'],
  ] as const) {
    const index = inner.length === 1 ? inner[0]! : undefined
    const node = index === undefined ? undefined : record(nodes[index])
    if (node?.['name'] !== name) continue
    if (Object.keys(node).some(key => !['name', property, 'children'].includes(key)))
      throw new TypeError(`${name} carries more than the materializer writes`)
    const value = node[property]
    if (name === 'uv:units') {
      const scale = Array.isArray(value) ? value[0] : undefined
      if (
        typeof scale !== 'number' ||
        !(scale > 0) ||
        !sameNumbers(value, [scale, scale, scale]) ||
        unitsRecord?.['metersPerSourceUnit'] !== scale
      )
        throw new TypeError('uv:units is not the scale UV_units records')
      metersPerSourceUnit = scale
    } else if (name === 'uv:up-axis') {
      if (!sameNumbers(value, UP_AXIS_ROTATION))
        throw new TypeError('uv:up-axis is not the +z-up turn')
      upAxis = '+z'
    } else {
      if (!sameNumbers(value, upAxis === '+z' ? [1, -1, 1] : [1, 1, -1]))
        throw new TypeError('uv:handedness is not the mirror of its axis')
      handedness = 'left'
    }
    removed.push(index!)
    inner = array(node, 'children').map(child => safeIndex(child, nodes.length, `${name} child`))
  }
  if (removed.length === 0)
    return { container: source, frame: { metersPerSourceUnit, upAxis, handedness } }
  // ponytail: the materializer writes its wrappers last; a document that moved them is refused
  // rather than renumbered (renumber every node reference if a writer ever needs that)
  const first = nodes.length - removed.length
  if ([...removed].sort((a, b) => a - b).some((index, order) => index !== first + order))
    throw new TypeError("the materializer's frame nodes are not the document's last nodes")
  const outside = (index: unknown, label: string) => {
    if (typeof index === 'number' && index >= first)
      throw new TypeError(`${label} names a frame node of the materializer`)
  }
  for (const [index, node] of nodes.entries())
    if (index < first) for (const child of array(node, 'children')) outside(child, 'a node child')
  for (const skin of array(document, 'skins')) {
    for (const joint of array(skin, 'joints')) outside(joint, 'a skin joint')
    outside(field(skin, 'skeleton'), 'a skin skeleton')
  }
  for (const animation of array(document, 'animations'))
    for (const channel of array(animation, 'channels'))
      outside(field(field(channel, 'target'), 'node'), 'an animation target')
  for (const name of ['UV_game_effects', 'UV_scene_lights'])
    outside(field(extensions[name], 'spaceNode'), `${name} spaceNode`)
  const matrix = uvmSceneFrameMatrix({ metersPerSourceUnit, upAxis, handedness })
  const unframed = (value: JsonValue): JsonValue => withMaterialFrame(value, matrix)
  // without its scale node the geometry is in source units: UV_units no longer describes it
  const unitsRemoved = removed.some(index => record(nodes[index])?.['name'] === 'uv:units')
  const kept = Object.fromEntries(
    Object.entries(extensions).filter(([name]) => !(unitsRemoved && name === 'UV_units')),
  )
  const used = array(document, 'extensionsUsed').filter(
    name => !(unitsRemoved && name === 'UV_units'),
  )
  const result = snapshotJson(
    {
      ...document,
      ...(document['materials'] === undefined
        ? {}
        : { materials: array(document, 'materials').map(unframed) }),
      ...(document['extensionsUsed'] === undefined ? {} : { extensionsUsed: used }),
      ...(document['extensions'] === undefined ? {} : { extensions: kept }),
      nodes: nodes.slice(0, first),
      scenes: [{ ...scene, nodes: [...roots.slice(0, at), ...inner, ...roots.slice(at + 1)] }],
    },
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  )
  const container: UvmContainer = {
    ...source,
    document: object(result, 'unframed UVM document'),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(container.document, {
    binaryByteLength: container.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  writeUvmContainer(container, budget, signal)
  return {
    container,
    frame: {
      metersPerSourceUnit,
      upAxis,
      handedness,
      ...(unitsRemoved && unitsRecord !== undefined ? { units: unitsRecord } : {}),
    },
  }
}
