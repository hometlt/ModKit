import type { JsonObject, SceneRendererLight } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { readPreviewLighting } from '../render/preview-lighting.js'
import { array, field, object, safeIndex } from './values.js'

/** Native-free static/animated source frame join. Direction/position/distance units enter
 * the renderer together; nonuniform frames refuse rather than guessing a light radius. */
export function readUvmSceneLights(
  document: JsonObject,
  transforms: ReadonlyMap<string, Float32Array>,
  activeNodes: ReadonlySet<string>,
  options: { maxBytes: number; maxNodes: number; signal?: AbortSignal },
) {
  const source = field(document['extensions'], 'UV_scene_lights')
  if (source === undefined) return undefined
  const ext = object(
    snapshotJson(
      source,
      { maxBytes: options.maxBytes, maxNodes: options.maxNodes, maxDepth: 16 },
      options.signal,
    ),
    'scene lights',
  )
  if (
    ext['version'] !== 1 ||
    Object.keys(ext).some(key => !['version', 'spaceNode', 'lights', 'ambient'].includes(key))
  )
    throw new TypeError('invalid UV_scene_lights')
  const node = safeIndex(ext['spaceNode'], array(document, 'nodes').length, 'light space'),
    id = `node-${node}`
  const sourceLights = ext['lights']
  if (!Array.isArray(sourceLights)) throw new TypeError('scene lights list absent')
  const rig = readPreviewLighting(
    sourceLights as unknown as readonly SceneRendererLight[],
    ext['ambient'] as readonly [number, number, number] | undefined,
  )
  if (rig === undefined) throw new TypeError('scene lights absent')
  if (!activeNodes.has(id)) return undefined
  const matrix = transforms.get(id)
  if (
    matrix === undefined ||
    matrix.length !== 16 ||
    !matrix.every(Number.isFinite) ||
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  )
    throw new TypeError('invalid scene light world frame')
  const column = (offset: number) =>
    [matrix[offset] ?? 0, matrix[offset + 1] ?? 0, matrix[offset + 2] ?? 0] as const
  const columns = [column(0), column(4), column(8)] as const
  const scale = Math.hypot(...columns[0])
  if (scale <= 1e-8 || columns.some(v => Math.abs(Math.hypot(...v) - scale) > 1e-5 * scale))
    throw new TypeError('scene light frame requires uniform scale')
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    const first = columns[a],
      second = columns[b]
    if (
      Math.abs(first[0] * second[0] + first[1] * second[1] + first[2] * second[2]) >
      1e-5 * scale * scale
    )
      throw new TypeError('scene light frame must be orthogonal')
  }
  const transform = (
    v: readonly [number, number, number],
    point: boolean,
  ): readonly [number, number, number] => {
    const at = (axis: number) =>
      (matrix[axis] ?? 0) * v[0] +
      (matrix[axis + 4] ?? 0) * v[1] +
      (matrix[axis + 8] ?? 0) * v[2] +
      (point ? (matrix[axis + 12] ?? 0) : 0)
    return [at(0), at(1), at(2)]
  }
  const world = rig.lights.map(light => ({
    ...light,
    direction: transform(light.direction, false),
    ...(light.position === undefined ? {} : { position: transform(light.position, true) }),
    ...(light.range === undefined ? {} : { range: light.range * scale }),
    ...(light.attenuationStart === undefined
      ? {}
      : { attenuationStart: light.attenuationStart * scale }),
    ...(light.attenuationEnd === undefined ? {} : { attenuationEnd: light.attenuationEnd * scale }),
  }))
  const result = readPreviewLighting(world, rig.ambient)
  if (result === undefined) throw new TypeError('scene light frame absent')
  return { lights: result.lights, ambientLight: result.ambient }
}
