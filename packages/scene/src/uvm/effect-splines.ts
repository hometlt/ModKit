import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_EFFECT_SIMULATION_OPTIONS,
  MAX_EFFECT_SPLINE_DIVISIONS,
} from '@modkit/codec-kit/model-math/effects-sim'
import { array, object, safeIndex } from './values.js'
import { readUvmEffectAnimation } from './effect-tracks.js'

const particleFields = [
  'emitShapePoints',
  'emitShapePointSequenceAnimations',
  'emitShapeCutout',
  'emitShapeCutoutRadius',
  'emitShapeCutoutSize',
]
const ribbonFields = [
  'splineEndpoints',
  'emissionOffset',
  'emissionVector',
  'divisions',
  'lengthAndTime',
]
export const EFFECT_SPLINE_FIELDS: ReadonlySet<string> = new Set([
  ...particleFields,
  ...ribbonFields,
])
export interface UvmEffectSplineOptions {
  readonly nodeCount: number
  readonly activeNodes: ReadonlySet<string>
  readonly timeUnit: 'seconds' | 'milliseconds'
  readonly maxNodes: number
  readonly maxBytes: number
  readonly signal?: AbortSignal
}
export interface UvmEffectSplines {
  readonly values: JsonObject
  readonly nodes: number
  readonly bytes: number
  /** Upper bound on additional scalar/key inspections per step (per spawned particle below). */
  readonly particleWork: number
  readonly ribbonWork: number
  readonly nodeIndices: readonly number[]
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`invalid spline ${label}`)
  return value
}
function vector(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError(`spline ${label} requires a three-component vector`)
  return value.map(component => finite(component, label))
}
function variation(value: JsonValue): JsonObject {
  const raw = object(value, 'spline variation'),
    shape = raw['shape']
  if (Object.keys(raw).some(key => !['shape', 'amplitude', 'frequency', 'phase'].includes(key)))
    throw new TypeError('unknown spline variation field')
  if (
    !(typeof shape === 'number' && Number.isSafeInteger(shape)) &&
    !['none', 'sine', 'triangle', 'square', 'saw', 'noise'].includes(String(shape))
  )
    throw new TypeError('invalid spline variation shape')
  return {
    shape: shape as JsonValue,
    amplitude: finite(raw['amplitude'], 'variation amplitude'),
    frequency: finite(raw['frequency'], 'variation frequency'),
    ...(raw['phase'] === undefined ? {} : { phase: finite(raw['phase'], 'variation phase') }),
  }
}

/** Public UVM fields only. Native bone references have already become node references at conversion.
 * The existing ModelEffectSimulation owns all spline/variation sampling and cutout rejection. */
export function readUvmEffectSplines(
  entry: JsonObject,
  kind: 'particles' | 'ribbons',
  options: UvmEffectSplineOptions,
): UvmEffectSplines {
  options.signal?.throwIfAborted()
  if (
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 0 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 0
  )
    throw new RangeError('invalid spline budget')
  const selected: Record<string, JsonValue> = {}
  for (const key of kind === 'particles' ? ribbonFields : particleFields)
    if (entry[key] !== undefined) throw new TypeError(`spline field ${key} is invalid for ${kind}`)
  for (const key of kind === 'particles' ? particleFields : ribbonFields)
    if (entry[key] !== undefined) selected[key] = entry[key]
  // Snapshot validates the complete owned subtree before any authored points/keys/endpoints are mapped.
  const owned = object(
    snapshotJson(
      selected,
      { maxNodes: options.maxNodes, maxBytes: options.maxBytes, maxDepth: 32 },
      options.signal,
    ),
    'effect splines',
  )
  let nodes = 0,
    bytes = 0
  function count(value: JsonValue): void {
    options.signal?.throwIfAborted()
    nodes++
    bytes += 32 + (typeof value === 'string' ? value.length * 2 : 0)
    if (nodes > options.maxNodes || bytes > options.maxBytes)
      throw new RangeError('effect splines exceed budget')
    if (Array.isArray(value)) for (const item of value) count(item)
    else if (value !== null && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        bytes += key.length * 2
        count(item)
      }
  }
  if (Object.keys(owned).length > 0) count(owned)
  let trackWork = 0
  function animation(value: JsonValue, arity: number, allowed: readonly string[]): JsonObject {
    const parsed = readUvmEffectAnimation(
      value,
      true,
      options.timeUnit,
      options.maxNodes,
      options.signal,
    )
    for (const [property, sequences] of Object.entries(parsed)) {
      if (!allowed.includes(property)) throw new TypeError(`unsupported spline track ${property}`)
      for (const sequence of array({ sequences }, 'sequences')) {
        const track = object(object(sequence, 'spline sequence')['track'], 'spline track')
        trackWork++
        for (const value of array(track, 'keys')) {
          const key = object(value, 'spline key')
          trackWork += 8 * arity
          for (const field of ['vector', 'inTan', 'outTan']) {
            if (
              field !== 'vector' &&
              key[field] === undefined &&
              track['lineType'] !== 2 &&
              track['lineType'] !== 3
            )
              continue
            if (array(key, field).length !== arity)
              throw new TypeError(`spline track requires arity ${arity} including cubic tangents`)
          }
        }
      }
    }
    return parsed
  }
  const values: Record<string, JsonValue> = {},
    nodeIndices: number[] = []
  let particleWork = 0,
    ribbonWork = 0
  if (kind === 'particles') {
    const points = owned['emitShapePoints']
    if (points !== undefined) {
      if (!Array.isArray(points)) throw new TypeError('spline points must be an array')
      values['emitShapePoints'] = points.map(point => vector(point, 'point'))
      particleWork = points.length * 32
    }
    if (entry['emitShape'] === 'spline' && (!Array.isArray(points) || points.length === 0))
      throw new TypeError('spline emission requires authored control points')
    const tracks = owned['emitShapePointSequenceAnimations']
    if (tracks !== undefined) {
      if (!Array.isArray(tracks) || !Array.isArray(points) || tracks.length !== points.length)
        throw new TypeError('spline point tracks must match every authored point')
      values['emitShapePointSequenceAnimations'] = tracks.map(
        track => animation({ point: track }, 3, ['point'])['point'] ?? [],
      )
      particleWork += trackWork
    }
    const cutout = owned['emitShapeCutout']
    if (cutout !== undefined) {
      if (typeof cutout !== 'boolean') throw new TypeError('spline cutout flag must be boolean')
      values['emitShapeCutout'] = cutout
    }
    if (owned['emitShapeCutoutRadius'] !== undefined) {
      const radius = finite(owned['emitShapeCutoutRadius'], 'cutout radius')
      if (radius < 0) throw new TypeError('negative cutout radius')
      values['emitShapeCutoutRadius'] = radius
    }
    if (owned['emitShapeCutoutSize'] !== undefined) {
      const size = vector(owned['emitShapeCutoutSize'], 'cutout size')
      if (size.some(value => value < 0)) throw new TypeError('negative cutout size')
      values['emitShapeCutoutSize'] = size
    }
  } else {
    for (const key of ['emissionOffset', 'emissionVector'])
      if (owned[key] !== undefined) values[key] = vector(owned[key], key)
    if (owned['lengthAndTime'] !== undefined) {
      if (typeof owned['lengthAndTime'] !== 'boolean')
        throw new TypeError('ribbon lengthAndTime must be boolean')
      values['lengthAndTime'] = owned['lengthAndTime']
    }
    let divisions = 1
    if (owned['divisions'] !== undefined) {
      const raw = finite(owned['divisions'], 'divisions')
      if (raw < 0 || raw > MAX_EFFECT_SPLINE_DIVISIONS)
        throw new RangeError('spline divisions exceed existing kernel limit')
      values['divisions'] = raw
      divisions = Math.max(1, Math.ceil(raw))
    }
    const rawEndpoints = owned['splineEndpoints']
    if (rawEndpoints !== undefined) {
      if (!Array.isArray(rawEndpoints)) throw new TypeError('spline endpoints must be an array')
      const scalars = ['velocity', 'velocityBaseFactor', 'velocityEndFactor', 'yaw', 'pitch']
      const variations = ['yawVariation', 'pitchVariation', 'velocityVariation']
      const allowed = [
        'node',
        'emissionOffset',
        'emissionVector',
        ...scalars,
        ...variations,
        'sequenceAnimation',
      ]
      values['splineEndpoints'] = rawEndpoints.map(value => {
        const endpoint = object(value, 'spline endpoint')
        if (Object.keys(endpoint).some(key => !allowed.includes(key)))
          throw new TypeError('unknown spline endpoint field')
        const node = safeIndex(endpoint['node'], options.nodeCount, 'spline endpoint node')
        if (!options.activeNodes.has(`node-${node}`))
          throw new TypeError('spline endpoint node is outside the active scene')
        nodeIndices.push(node)
        const result: Record<string, JsonValue> = {
          boneIndex: node,
          emissionOffset: vector(endpoint['emissionOffset'], 'endpoint offset'),
          emissionVector: vector(endpoint['emissionVector'], 'endpoint vector'),
        }
        for (const key of scalars) result[key] = finite(endpoint[key], key)
        for (const key of variations)
          if (endpoint[key] !== undefined) result[key] = variation(endpoint[key])
        if (endpoint['sequenceAnimation'] !== undefined)
          result['sequenceAnimation'] = animation(endpoint['sequenceAnimation'], 1, scalars)
        return result
      })
      ribbonWork = (rawEndpoints.length * divisions + 1) * (256 + trackWork)
    }
  }
  return { values, nodes, bytes, particleWork, ribbonWork, nodeIndices }
}

/** Bound the existing seek and per-spawn spline work before allocating/running simulator pools. */
export function assertUvmEffectSplineWork(
  particleWork: number,
  ribbonWork: number,
  time: number,
  spawnPerStep: number,
): void {
  const steps =
    Math.min(
      3600,
      Math.max(1, Math.ceil(time / DEFAULT_EFFECT_SIMULATION_OPTIONS.fixedStepSeconds)),
    ) + 1
  const work = steps * (particleWork * spawnPerStep + ribbonWork)
  if (!Number.isFinite(work) || work < 0 || work > 32 * 1024 * 1024)
    throw new RangeError('effect spline sampling exceeds bounded frame work')
}
