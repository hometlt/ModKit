import { collisionSplatFrame, type UvmCollisionSplat } from './collision-splats.js'
import { readEffectProjectors } from './effect-projectors.js'
import { projectorMaterial } from './projector-material.js'
import type { JsonObject } from '@modkit/sdk'
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

interface Options {
  readonly collisionSplats?: readonly UvmCollisionSplat[]
  readonly receivers: readonly SceneRendererPrimitive[]
  readonly nodeTransforms: ReadonlyMap<string, Float32Array>
  readonly activeNodes: ReadonlySet<string>
  readonly materials: readonly SceneRendererMaterial[]
  readonly maxBytes: number
  readonly maxNodes: number
  readonly time?: number
  readonly sequenceIndex?: number
  readonly signal?: AbortSignal
  readonly warn: (message: string) => void
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
export function createUvmProjectorFrame(document: JsonObject, options: Options) {
  options.signal?.throwIfAborted()
  for (const value of [options.maxBytes, options.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid projector budget')
  const effect = object(object(document['extensions'], 'extensions')['UV_game_effects'], 'effects')
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
      const parsed = readUvmEffectAnimation(
        entry['sequenceAnimation'],
        true,
        timeUnit,
        options.maxNodes - work,
        options.signal,
      )
      const allowed = [
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
      for (const [key, list] of Object.entries(parsed)) {
        if (!allowed.includes(key)) throw new TypeError(`unsupported projector track ${key}`)
        for (const rawTrack of array({ list }, 'list')) {
          if (++work > options.maxNodes) throw new RangeError('projector track work exceeds budget')
          for (const rawKey of array(
            object(object(rawTrack, 'sequence')['track'], 'track'),
            'keys',
          )) {
            if (++work > options.maxNodes)
              throw new RangeError('projector track work exceeds budget')
            const frameKey = object(rawKey, 'key')
            for (const component of ['vector', 'inTan', 'outTan'])
              if (
                frameKey[component] !== undefined &&
                array(frameKey, component).length !== (key === 'offset' ? 3 : 1)
              )
                throw new TypeError('projector track component count differs')
          }
        }
        const tracks = list as unknown as RenderEffectSequenceTracks
        entry[key] =
          key === 'offset'
            ? [
                ...sampleEffectSequenceVector(
                  tracks,
                  options.sequenceIndex ?? null,
                  time,
                  vec(entry[key]),
                ),
              ]
            : sampleEffectSequenceScalar(
                tracks,
                undefined,
                options.sequenceIndex ?? null,
                time,
                scalar(entry[key]),
              )
      }
    }
    if (scalar(entry['active']) <= 0) continue
    const world = options.nodeTransforms.get(`node-${node}`)
    if (world === undefined) throw new TypeError('projector node pose absent')
    const matrix = multiplyMaterialFrames(fromWorld, Array.from(world))
    const basis = [
      unit([valueAt(matrix, 0), valueAt(matrix, 1), valueAt(matrix, 2)]),
      unit([valueAt(matrix, 4), valueAt(matrix, 5), valueAt(matrix, 6)]),
      unit([valueAt(matrix, 8), valueAt(matrix, 9), valueAt(matrix, 10)]),
    ] as const
    const rotate = (v: ProjectorVec3): ProjectorVec3 => {
      const pitch = scalar(entry['pitch']),
        yaw = scalar(entry['yaw']),
        roll = scalar(entry['roll'])
      const x1 = v[0],
        y1 = v[1] * Math.cos(pitch) - v[2] * Math.sin(pitch),
        z1 = v[1] * Math.sin(pitch) + v[2] * Math.cos(pitch)
      const x2 = x1 * Math.cos(yaw) + z1 * Math.sin(yaw),
        y2 = y1,
        z2 = -x1 * Math.sin(yaw) + z1 * Math.cos(yaw)
      const local = unit([
        x2 * Math.cos(roll) - y2 * Math.sin(roll),
        x2 * Math.sin(roll) + y2 * Math.cos(roll),
        z2,
      ])
      return unit([
        basis[0][0] * local[0] + basis[1][0] * local[1] + basis[2][0] * local[2],
        basis[0][1] * local[0] + basis[1][1] * local[1] + basis[2][1] * local[2],
        basis[0][2] * local[0] + basis[1][2] * local[1] + basis[2][2] * local[2],
      ])
    }
    const offset = vec(entry['offset']),
      origin: ProjectorVec3 = [
        valueAt(matrix, 12) +
          basis[0][0] * offset[0] +
          basis[1][0] * offset[1] +
          basis[2][0] * offset[2],
        valueAt(matrix, 13) +
          basis[0][1] * offset[0] +
          basis[1][1] * offset[1] +
          basis[2][1] * offset[2],
        valueAt(matrix, 14) +
          basis[0][2] * offset[0] +
          basis[1][2] * offset[1] +
          basis[2][2] * offset[2],
      ]
    const projectionType = entry['projectionType']
    if (projectionType !== 'orthographic' && projectionType !== 'perspective')
      throw new TypeError('unknown projector type')
    const near = scalar(entry['near']),
      far = scalar(entry['far']),
      tangentY = Math.tan(fov(scalar(entry['fieldOfView'])) * 0.5)
    let left = Math.min(scalar(entry['boxOffsetXLeft']), scalar(entry['boxOffsetXRight'])),
      rightExtent = Math.max(scalar(entry['boxOffsetXLeft']), scalar(entry['boxOffsetXRight']))
    let bottom = Math.min(scalar(entry['boxOffsetYBack']), scalar(entry['boxOffsetYFront'])),
      top = Math.max(scalar(entry['boxOffsetYBack']), scalar(entry['boxOffsetYFront']))
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
      origin,
      rightAxis: rotate([1, 0, 0]),
      upAxis: rotate([0, 1, 0]),
      forwardAxis: rotate([0, 0, 1]),
      near: Math.max(0.0001, Math.min(Math.abs(near), Math.abs(far))),
      far: Math.max(0.001, Math.max(Math.abs(near), Math.abs(far))),
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
    const geometry = clipProjectorReceivers(frame, receivers, {
      maxBytes: options.maxBytes - bytes,
      maxTriangles: options.maxNodes - work,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    work += geometry.triangles
    bytes += geometry.byteLength
    if (geometry.indices.length === 0) continue
    const id = `uvm-projector-${index}`
    // The pinned live-effect shader uses white vertex RGB and one alpha factor.
    // Keep the referenced material untouched; this is a separate simple effect draw.
    materials.push(
      projectorMaterial(
        base,
        id,
        alpha,
        options.maxNodes - work,
        options.maxBytes - bytes,
        options.signal,
      ),
    )
    primitives.push({
      id,
      materialId: id,
      topology: 'triangles',
      positions: geometry.positions,
      indices: geometry.indices,
      textureCoordinates: geometry.textureCoordinates,
      transform: Float32Array.from(toWorld),
      depthBias: { slopeScale: -1, units: -1 },
    })
    for (const key of [
      'falloff',
      'attenuationDistance',
      'flags',
      'layer',
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
      const geometry = clipProjectorReceivers(frame, receivers, {
        maxBytes: options.maxBytes - bytes,
        maxTriangles: options.maxNodes - work,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      work += geometry.triangles
      bytes += geometry.byteLength
      if (geometry.indices.length === 0) continue
      const id = `uvm-projector-impact-${splat.slot}`
      materials.push(
        projectorMaterial(
          base,
          id,
          splat.alpha,
          options.maxNodes - work,
          options.maxBytes - bytes,
          options.signal,
        ),
      )
      primitives.push({
        id,
        materialId: id,
        topology: 'triangles',
        positions: geometry.positions,
        indices: geometry.indices,
        textureCoordinates: geometry.textureCoordinates,
        transform: Float32Array.from(toWorld),
        depthBias: { slopeScale: -1, units: -1 },
      })
    }
  }
  return { primitives, materials }
}
