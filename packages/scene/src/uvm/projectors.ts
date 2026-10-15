import { collisionSplatFrame, type UvmCollisionSplat } from './collision-splats.js'
import { readEffectProjectors } from './effect-projectors.js'
import { projectorMaterial } from './projector-material.js'
import type { JsonObject, JsonValue } from '@modkit/sdk'
import type { SceneRendererPrimitive, SceneRendererMaterial } from '@modkit/sdk/renderer'
import { array, object, safeIndex } from './values.js'
import {
  invertMaterialFrame,
  multiplyMaterialFrames,
  IDENTITY_MATERIAL_FRAME,
} from '../materials/frame.js'
import {
  clipProjectorReceivers,
  type ProjectorFrame,
  type ProjectorVec3,
} from './projector-receivers.js'
import { readUvmEffectAnimation } from './effect-tracks.js'
import {
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector,
} from '@modkit/codec-kit/model-math/effects-sim'
import type { RenderEffectSequenceTracks } from '@modkit/codec-kit/legacy/models'

/** Depth, in projector units above and below its origin, a terrain bake reaches: past any relief. */
const TERRAIN_BAKE_DEPTH = 256

/** The receiver primitive that is the ground itself: a terrain bake lies on it at any depth. */
export const TERRAIN_RECEIVER_ID = 'world-terrain-receiver'

type ClippedReceivers = ReturnType<typeof clipProjectorReceivers>

/** One clip's geometry followed by another's, which takes the budget the first left. */
function joinedClips(
  first: ClippedReceivers,
  second: (bytes: number, triangles: number) => ClippedReceivers,
): ClippedReceivers {
  const next = second(first.byteLength, first.triangles)
  if (first.indices.length === 0) return next
  if (next.indices.length === 0) return first
  const offset = first.positions.length / 3
  const indices = new Uint32Array(first.indices.length + next.indices.length)
  indices.set(first.indices)
  for (let index = 0; index < next.indices.length; index++)
    indices[first.indices.length + index] = next.indices[index]! + offset
  const positions = new Float32Array(first.positions.length + next.positions.length)
  positions.set(first.positions)
  positions.set(next.positions, first.positions.length)
  const textureCoordinates = new Float32Array(
    first.textureCoordinates.length + next.textureCoordinates.length,
  )
  textureCoordinates.set(first.textureCoordinates)
  textureCoordinates.set(next.textureCoordinates, first.textureCoordinates.length)
  return {
    positions,
    textureCoordinates,
    indices,
    triangles: first.triangles + next.triangles,
    byteLength: first.byteLength + next.byteLength,
  }
}

/** The native material tag a render material names (UVM render-model metadata), e.g. STBM. */
function projectorMaterialTag(material: SceneRendererMaterial | undefined): unknown {
  const parameters = material?.shader?.parameters as
    | { readonly renderModel?: { readonly metadata?: { readonly sourceMaterialTag?: unknown } } }
    | undefined
  return parameters?.renderModel?.metadata?.sourceMaterialTag
}

interface Options {
  readonly collisionSplats?: readonly UvmCollisionSplat[]
  readonly receivers: readonly SceneRendererPrimitive[]
  readonly nodeTransforms: ReadonlyMap<string, Float32Array>
  readonly activeNodes: ReadonlySet<string>
  readonly materials: readonly SceneRendererMaterial[]
  readonly maxBytes: number
  readonly maxNodes: number
  readonly time?: number
  readonly globalTime?: number
  readonly sequenceIndex?: number
  readonly signal?: AbortSignal
  readonly warn: (message: string) => void
  /** One placement's projectors at its previous frame (see UvmProjectorFrameCache). */
  readonly cache?: UvmProjectorFrameCache
}

const PROJECTOR_TRACKS = [
  'offset',
  'pitch',
  'yaw',
  'roll',
  'fieldOfView',
  'aspectRatio',
  'near',
  'far',
  'boxOffsetZBottom',
  'boxOffsetZTop',
  'boxOffsetXLeft',
  'boxOffsetXRight',
  'boxOffsetYFront',
  'boxOffsetYBack',
  'active',
]

/**
 * Each projector animation read and checked per time unit, with the keys it read and the work its
 * checks count (a track and each of its keys). A projector's animation is its effect's own and never
 * changes, and a moving projector was read and checked again at every frame; a frame now only spends
 * the same budget on it.
 */
const projectorAnimations = new WeakMap<
  object,
  Map<string, Readonly<{ parsed: JsonObject; keys: number; work: number }>>
>()

function projectorAnimation(
  value: JsonValue,
  timeUnit: 'seconds' | 'milliseconds',
  maxKeys: number,
  signal?: AbortSignal,
): Readonly<{ parsed: JsonObject; work: number }> {
  const owner = value !== null && typeof value === 'object' ? value : undefined
  const kept = owner === undefined ? undefined : projectorAnimations.get(owner)?.get(timeUnit)
  if (kept !== undefined) {
    if (kept.keys > maxKeys) throw new RangeError('effect animation key budget exceeded')
    return kept
  }
  const parsed = readUvmEffectAnimation(value, true, timeUnit, maxKeys, signal)
  let keys = 0,
    work = 0
  for (const [key, list] of Object.entries(parsed)) {
    if (!PROJECTOR_TRACKS.includes(key)) throw new TypeError(`unsupported projector track ${key}`)
    for (const rawTrack of array({ list }, 'list')) {
      work += 1
      for (const rawKey of array(object(object(rawTrack, 'sequence')['track'], 'track'), 'keys')) {
        keys += 1
        work += 1
        const frameKey = object(rawKey, 'key')
        for (const component of ['vector', 'inTan', 'outTan'])
          if (
            frameKey[component] !== undefined &&
            array(frameKey, component).length !== (key === 'offset' ? 3 : 1)
          )
            throw new TypeError('projector track component count differs')
      }
    }
  }
  const read = Object.freeze({ parsed, keys, work })
  if (owner !== undefined) {
    let units = projectorAnimations.get(owner)
    if (units === undefined) projectorAnimations.set(owner, (units = new Map()))
    units.set(timeUnit, read)
  }
  return read
}

/**
 * What one placement's projectors clipped and which materials they made at its previous frame, by
 * projector. A projector on a node the clip moves is sampled again every frame, yet mostly stands
 * where it stood (on Amphion all 30 of them): the same projector volume over the same receiver
 * buffer, transform and budget clips the same triangles, and the same material, id, alpha and budget
 * make the same material, so both are taken as they were. Clip output and materials are immutable.
 * One cache belongs to one placement, so placements never share the arrays or materials they draw.
 */
export interface UvmProjectorFrameCache {
  readonly clips: Map<string, Readonly<{ key: string; geometry: ProjectorClip }>>
  readonly materials: Map<
    string,
    Readonly<{
      base: SceneRendererMaterial
      key: string
      material: SceneRendererMaterial | undefined
    }>
  >
}

export function createUvmProjectorFrameCache(): UvmProjectorFrameCache {
  return { clips: new Map(), materials: new Map() }
}

type ProjectorClip = ReturnType<typeof clipProjectorReceivers>

const bufferIds = new WeakMap<object, number>()
let bufferIdCount = 0
const bufferId = (buffer: object) => {
  let id = bufferIds.get(buffer)
  if (id === undefined) bufferIds.set(buffer, (id = ++bufferIdCount))
  return id
}
/** Every double apart: String keeps each value exactly except -0. */
const exact = (value: number) => (Object.is(value, -0) ? '-0' : String(value))

/** Everything clipProjectorReceivers reads: each field of the volume, each receiver, the budget. */
function projectorClipKey(
  frame: ProjectorFrame,
  receivers: readonly {
    readonly primitive: SceneRendererPrimitive
    readonly transform: readonly number[]
  }[],
  maxBytes: number,
  maxTriangles: number,
): string {
  const parts: string[] = []
  for (const [name, value] of Object.entries(frame))
    parts.push(
      name,
      typeof value === 'number'
        ? exact(value)
        : Array.isArray(value)
          ? value.map(exact).join(' ')
          : String(value),
    )
  for (const { primitive, transform } of receivers)
    parts.push(
      primitive.topology,
      String(bufferId(primitive.positions)),
      primitive.indices === undefined ? '-' : String(bufferId(primitive.indices)),
      transform.map(exact).join(' '),
    )
  parts.push(String(maxBytes), String(maxTriangles))
  return parts.join('|')
}
const scalar = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('invalid projector scalar')
  return value
}
const vec = (value: unknown): ProjectorVec3 => {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError('invalid projector vector')
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])]
}
const unit = (v: ProjectorVec3): ProjectorVec3 => {
  const length = Math.hypot(...v)
  if (length < 1e-12) throw new TypeError('singular projector basis')
  return [v[0] / length, v[1] / length, v[2] / length]
}
const fov = (value: number) =>
  Math.min(
    Math.PI - 0.001,
    Math.max(
      0.001,
      Math.abs(value) > Math.PI * 2 ? (Math.abs(value) * Math.PI) / 180 : Math.abs(value),
    ),
  )
const valueAt = (matrix: readonly number[], index: number) => scalar(matrix[index])
/** Native format is absent here. The source-to-world boundary and live receiver sample come
 * from ordinary UVM scene sampling; static frame conventions are the pinned preview contract. */
/**
 * The splat layer of the projector a projected primitive comes from (UV_game_effects
 * projectors[].layer, as the model carries it): an owner that draws splats as one ground layer
 * orders them by it.
 */
export function projectedSplatLayer(primitive: SceneRendererPrimitive): number | undefined {
  return (primitive as { readonly splatLayer?: number }).splatLayer
}

export function createUvmProjectorFrame(document: JsonObject, options: Options) {
  options.signal?.throwIfAborted()
  for (const value of [options.maxBytes, options.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid projector budget')
  // A model may bake its particles (UV_game_baked_particles) and state no effects of its own.
  const declared = object(document['extensions'], 'extensions')['UV_game_effects']
  const effect = declared === undefined ? {} : object(declared, 'effects')
  const nodes = array(document, 'nodes'),
    projectors = array(effect, 'projectors')
  const primitives: (SceneRendererPrimitive & {
    readonly depthBias: { readonly slopeScale: number; readonly units: number }
  })[] = []
  const materials: SceneRendererMaterial[] = []
  if (projectors.length === 0) return { primitives, materials }
  if (
    projectors.length + options.receivers.length > options.maxNodes ||
    options.receivers.length * 192 + 512 > options.maxBytes
  )
    throw new RangeError('projector input exceeds budget')
  const space =
    effect['spaceNode'] === undefined
      ? undefined
      : safeIndex(effect['spaceNode'], nodes.length, 'effect source node')
  const sourceToWorld =
    space === undefined ? IDENTITY_MATERIAL_FRAME : options.nodeTransforms.get(`node-${space}`)
  if (sourceToWorld === undefined) throw new TypeError('projector source transform absent')
  const toWorld = Array.from(sourceToWorld)
  const fromWorld = invertMaterialFrame(toWorld)
  const receivers = options.receivers
    .filter(primitive => primitive.topology === 'triangles')
    .map(primitive => ({
      primitive,
      transform: multiplyMaterialFrames(
        fromWorld,
        Array.from(primitive.transform ?? IDENTITY_MATERIAL_FRAME),
      ),
    }))
  let bytes = options.receivers.length * 192 + 512,
    work = options.receivers.length
  const clip = (
    slot: string,
    frame: ProjectorFrame,
    maxBytes: number,
    maxTriangles: number,
    onto: typeof receivers = receivers,
  ) => {
    const cache = options.cache
    const key = cache === undefined ? '' : projectorClipKey(frame, onto, maxBytes, maxTriangles)
    const kept = cache?.clips.get(slot)
    if (kept !== undefined && kept.key === key) return kept.geometry
    const geometry = clipProjectorReceivers(frame, onto, {
      maxBytes,
      maxTriangles,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    cache?.clips.set(slot, { key, geometry })
    return geometry
  }
  const materialOf = (
    slot: string,
    base: SceneRendererMaterial,
    id: string,
    alpha: number,
    maxNodes: number,
    maxBytes: number,
  ) => {
    const key = `${id}|${exact(alpha)}|${maxNodes}|${maxBytes}`
    const kept = options.cache?.materials.get(slot)
    if (kept !== undefined && kept.base === base && kept.key === key) return kept.material
    const material = projectorMaterial(base, id, alpha, maxNodes, maxBytes, options.signal)
    options.cache?.materials.set(slot, { base, key, material })
    return material
  }
  for (const [index, raw] of projectors.entries()) {
    options.signal?.throwIfAborted()
    if (++work > options.maxNodes) throw new RangeError('projector frame exceeds node budget')
    const entry = { ...object(raw, 'projector') },
      node = safeIndex(entry['node'], nodes.length, 'projector node')
    if (!options.activeNodes.has(`node-${node}`)) continue
    if (entry['sequenceAnimation'] !== undefined) {
      const time = options.time ?? 0
      if (!Number.isFinite(time) || time < 0) throw new TypeError('invalid projector sample time')
      const timeUnit = effect['trackTimeUnit'] ?? 'seconds'
      if (timeUnit !== 'seconds' && timeUnit !== 'milliseconds')
        throw new TypeError('invalid projector track unit')
      const animation = projectorAnimation(
        entry['sequenceAnimation'],
        timeUnit,
        options.maxNodes - work,
        options.signal,
      )
      work += animation.work
      if (work > options.maxNodes) throw new RangeError('projector track work exceeds budget')
      for (const [key, list] of Object.entries(animation.parsed)) {
        const tracks = list as unknown as RenderEffectSequenceTracks
        entry[key] =
          key === 'offset'
            ? [
                ...sampleEffectSequenceVector(
                  tracks,
                  options.sequenceIndex ?? null,
                  time,
                  vec(entry[key]),
                  undefined,
                  options.globalTime,
                ),
              ]
            : sampleEffectSequenceScalar(
                tracks,
                undefined,
                options.sequenceIndex ?? null,
                time,
                scalar(entry[key]),
                options.globalTime,
              )
      }
    }
    if (scalar(entry['active']) <= 0) continue
    const world = options.nodeTransforms.get(`node-${node}`)
    if (world === undefined) throw new TypeError('projector node pose absent')
    const matrix = multiplyMaterialFrames(fromWorld, Array.from(world))
    // The bone's frame, scale included: offsets, boxes and frustum distances are authored in bone
    // units, so a bone scaled 2.4× casts a splat 2.4× wider (Shakuras_City_Debris_Splat covers 11.6
    // cells in SC2; normalising the basis drew it over 4.9).
    const columns = [
      [valueAt(matrix, 0), valueAt(matrix, 1), valueAt(matrix, 2)],
      [valueAt(matrix, 4), valueAt(matrix, 5), valueAt(matrix, 6)],
      [valueAt(matrix, 8), valueAt(matrix, 9), valueAt(matrix, 10)],
    ] as const
    const basis = columns.map(unit) as unknown as readonly [ProjectorVec3, ProjectorVec3, ProjectorVec3]
    const apply = (axes: typeof columns | typeof basis, v: ProjectorVec3): ProjectorVec3 => [
      axes[0][0] * v[0] + axes[1][0] * v[1] + axes[2][0] * v[2],
      axes[0][1] * v[0] + axes[1][1] * v[1] + axes[2][1] * v[2],
      axes[0][2] * v[0] + axes[1][2] * v[1] + axes[2][2] * v[2],
    ]
    const throughBone = (v: ProjectorVec3): ProjectorVec3 => apply(columns, v)
    /** A projector-local axis (pitch, yaw, roll applied) in bone space. */
    const localAxis = (v: ProjectorVec3): ProjectorVec3 => {
      const pitch = scalar(entry['pitch']),
        yaw = scalar(entry['yaw']),
        roll = scalar(entry['roll'])
      const x1 = v[0],
        y1 = v[1] * Math.cos(pitch) - v[2] * Math.sin(pitch),
        z1 = v[1] * Math.sin(pitch) + v[2] * Math.cos(pitch)
      const x2 = x1 * Math.cos(yaw) + z1 * Math.sin(yaw),
        y2 = y1,
        z2 = -x1 * Math.sin(yaw) + z1 * Math.cos(yaw)
      return unit([
        x2 * Math.cos(roll) - y2 * Math.sin(roll),
        x2 * Math.sin(roll) + y2 * Math.cos(roll),
        z2,
      ])
    }
    // Axes turn with the bone's rotation only, so they stay orthonormal under a non-uniform scale.
    const rotate = (v: ProjectorVec3): ProjectorVec3 => unit(apply(basis, localAxis(v)))
    /** How many source units one bone unit spans along a projector axis. */
    const axisScale = (v: ProjectorVec3): number => Math.hypot(...throughBone(localAxis(v)))
    const scaleX = axisScale([1, 0, 0]),
      scaleY = axisScale([0, 1, 0]),
      scaleZ = axisScale([0, 0, 1])
    const offset = throughBone(vec(entry['offset'])),
      origin: ProjectorVec3 = [
        valueAt(matrix, 12) + offset[0],
        valueAt(matrix, 13) + offset[1],
        valueAt(matrix, 14) + offset[2],
      ]
    const authoredProjectionType = entry['projectionType']
    if (authoredProjectionType !== 'orthographic' && authoredProjectionType !== 'perspective')
      throw new TypeError('unknown projector type')
    let projectionType: 'orthographic' | 'perspective' = authoredProjectionType
    const near = scalar(entry['near']) * scaleZ,
      far = scalar(entry['far']) * scaleZ,
      tangentY = Math.tan(fov(scalar(entry['fieldOfView'])) * 0.5)
    // Terrain-bake projectors can carry a zero perspective frustum and an explicit signed box.
    // Keep that authored box instead of reducing its receiver volume to a near-zero cone.
    const zBottom = scalar(entry['boxOffsetZBottom']) * scaleZ,
      zTop = scalar(entry['boxOffsetZTop']) * scaleZ
    const boxed = near === 0 && far === 0 && zTop > zBottom
    if (boxed) projectionType = 'orthographic'
    const forwardAxis = rotate([0, 0, 1])
    const boxX = [scalar(entry['boxOffsetXLeft']) * scaleX, scalar(entry['boxOffsetXRight']) * scaleX],
      boxY = [scalar(entry['boxOffsetYBack']) * scaleY, scalar(entry['boxOffsetYFront']) * scaleY]
    let left = Math.min(boxX[0]!, boxX[1]!),
      rightExtent = Math.max(boxX[0]!, boxX[1]!)
    let bottom = Math.min(boxY[0]!, boxY[1]!),
      top = Math.max(boxY[0]!, boxY[1]!)
    const aspect = Math.max(0.001, Math.abs(scalar(entry['aspectRatio'])) || 1),
      distance = Math.max(0.001, Math.abs(near) || 0.01)
    const halfHeight =
      projectionType === 'perspective'
        ? Math.max(0.001, tangentY * distance)
        : Math.max(0.001, Math.abs(top - bottom) * 0.5)
    const halfWidth =
      projectionType === 'perspective'
        ? halfHeight * aspect
        : Math.max(0.001, Math.abs(rightExtent - left) * 0.5)
    if (rightExtent - left < 0.002) {
      left = -halfWidth
      rightExtent = halfWidth
    }
    if (top - bottom < 0.002) {
      bottom = -halfHeight
      top = halfHeight
    }
    const frame: ProjectorFrame = {
      projectionType,
      origin: boxed ? [origin[0] + forwardAxis[0] * zBottom, origin[1] + forwardAxis[1] * zBottom, origin[2] + forwardAxis[2] * zBottom] : origin,
      rightAxis: rotate([1, 0, 0]),
      upAxis: rotate([0, 1, 0]),
      forwardAxis,
      near: Math.max(0.0001, Math.min(Math.abs(near), Math.abs(far))),
      far: boxed ? zTop - zBottom : Math.max(0.001, Math.max(Math.abs(near), Math.abs(far))),
      left,
      rightExtent,
      bottom,
      top,
      tangentX: tangentY * aspect,
      tangentY,
    }
    const materialIndex = safeIndex(
        entry['material'],
        options.materials.length,
        'projector material',
      ),
      base = options.materials[materialIndex]
    if (base === undefined) throw new TypeError('projector material absent')
    const authoredAlpha = scalar(entry['alphaInit']) || 1,
      alpha = Math.min(1, Math.max(0, authoredAlpha > 1 ? authoredAlpha / 255 : authoredAlpha))
    bytes += 1024
    // A splat-terrain-bake material (STBM) is baked into the ground texture, which knows no height:
    // it lies on the ground wherever its footprint falls, down a ramp too. Washout's sidewalks author
    // a box 0.1 deep and showed on a ramp as the thin stripe where the ramp crossed it. Other
    // receivers (the rims of cliff pieces) keep the authored box: the bake does not reach them.
    const ground = receivers.filter(receiver => receiver.primitive.id === TERRAIN_RECEIVER_ID)
    const geometry =
      boxed && ground.length > 0 && projectorMaterialTag(base) === 'STBM'
        ? joinedClips(
            clip(
              `projector-${index}:ground`,
              {
                ...frame,
                origin: [
                  origin[0] - forwardAxis[0] * TERRAIN_BAKE_DEPTH * scaleZ,
                  origin[1] - forwardAxis[1] * TERRAIN_BAKE_DEPTH * scaleZ,
                  origin[2] - forwardAxis[2] * TERRAIN_BAKE_DEPTH * scaleZ,
                ],
                far: 2 * TERRAIN_BAKE_DEPTH * scaleZ,
              },
              options.maxBytes - bytes,
              options.maxNodes - work,
              ground,
            ),
            (joinedBytes, joinedTriangles) =>
              clip(
                `projector-${index}`,
                frame,
                options.maxBytes - bytes - joinedBytes,
                options.maxNodes - work - joinedTriangles,
                receivers.filter(receiver => !ground.includes(receiver)),
              ),
          )
        : clip(`projector-${index}`, frame, options.maxBytes - bytes, options.maxNodes - work)
    work += geometry.triangles
    bytes += geometry.byteLength
    if (geometry.indices.length === 0) continue
    const id = `uvm-projector-${index}`
    // The pinned live-effect shader uses white vertex RGB and one alpha factor.
    // Keep the referenced material untouched; this is a separate simple effect draw.
    const material = materialOf(
      `projector-${index}`,
      base,
      id,
      alpha,
      options.maxNodes - work,
      options.maxBytes - bytes,
    )
    if (material === undefined) continue
    materials.push(material)
    const primitive: (typeof primitives)[number] & { readonly splatLayer: number } = {
      id,
      materialId: id,
      topology: 'triangles',
      positions: geometry.positions,
      indices: geometry.indices,
      textureCoordinates: geometry.textureCoordinates,
      transform: Float32Array.from(toWorld),
      depthBias: { slopeScale: -1, units: -1 },
      ...(material.simpleEffect === undefined
        ? { tint: [1, 1, 1, alpha] as const }
        : {}),
      splatLayer: scalar(entry['layer']),
    }
    primitives.push(primitive)
    for (const key of [
      'falloff',
      'attenuationDistance',
      'flags',
      'boxOffsetZBottom',
      'boxOffsetZTop',
    ])
      if (scalar(entry[key]) !== 0)
        options.warn(`projector ${index}: pinned preview does not evaluate ${key}.`)
  }
  const splats = options.collisionSplats ?? []
  if (splats.length > 0) {
    const templates = readEffectProjectors(
      document,
      options.maxNodes - work,
      options.maxBytes - bytes,
      options.signal,
    )
    bytes += templates.length * 1024
    work += templates.length
    for (const splat of splats) {
      options.signal?.throwIfAborted()
      if (++work > options.maxNodes) throw new RangeError('impact projector count exceeds budget')
      const index = safeIndex(splat.projector, templates.length, 'impact projector'),
        template = templates[index]
      if (template === undefined) throw new TypeError('impact projector template absent')
      const frame = collisionSplatFrame(splat, template),
        base = options.materials[template.materialIndex]
      if (base === undefined) throw new TypeError('impact projector material absent')
      bytes += 1024
      const geometry = clip(
        `impact-${splat.slot}`,
        frame,
        options.maxBytes - bytes,
        options.maxNodes - work,
      )
      work += geometry.triangles
      bytes += geometry.byteLength
      if (geometry.indices.length === 0) continue
      const id = `uvm-projector-impact-${splat.slot}`
      const material = materialOf(
        `impact-${splat.slot}`,
        base,
        id,
        splat.alpha,
        options.maxNodes - work,
        options.maxBytes - bytes,
      )
      if (material === undefined) continue
      materials.push(material)
      primitives.push({
        id,
        materialId: id,
        topology: 'triangles',
        positions: geometry.positions,
        indices: geometry.indices,
        textureCoordinates: geometry.textureCoordinates,
        transform: Float32Array.from(toWorld),
        depthBias: { slopeScale: -1, units: -1 },
        ...(material.simpleEffect === undefined
          ? { tint: [1, 1, 1, splat.alpha] as const }
          : {}),
      })
    }
  }
  return { primitives, materials }
}
