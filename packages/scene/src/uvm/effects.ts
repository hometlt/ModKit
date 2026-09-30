import {
  readUvmEffectSplines,
  EFFECT_SPLINE_FIELDS,
  assertUvmEffectSplineWork,
} from './effect-splines.js'
import {
  createUvmParticleGeometry,
  type UvmModelParticleDraw,
  type UvmParticleEmitterSnapshots,
  type UvmParticleGeometryEntry,
} from './effect-particles.js'
import { createUvmRibbonGeometry } from './ribbon-geometry.js'
import { bindUvmEffectLinks } from './effect-links.js'
import { effectSurfaceMaterial } from './projector-material.js'
import { readEffectCollisionShapes } from './effect-collisions.js'
import { readEffectProjectors } from './effect-projectors.js'
import { captureCollisionSplats, type UvmCollisionSplat } from './collision-splats.js'
import type { EffectParticleCollisionProvider } from '@modkit/codec-kit/model-math/effects-sim'
import { readUvmEffectFields } from './effect-fields.js'
import type { JsonObject, JsonValue } from '@modkit/sdk'
import type {
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererPrimitive,
} from '@modkit/sdk/renderer'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  ModelEffectSimulation,
  type MutableEffectEmitterAnchor,
} from '@modkit/codec-kit/model-math/effects-sim'
import type { RenderParticleEmitter, RenderRibbonEmitter } from '@modkit/codec-kit/legacy/models'
import { array, field, object, safeIndex } from './values.js'
import { readUvmEffectAnimation } from './effect-tracks.js'
import { selectUvmEffectSquirt, uvmEffectSquirtKeyed } from './effect-modes.js'
import { readUvmEffectMeshes } from './effect-mesh.js'
import {
  IDENTITY_MATERIAL_FRAME,
  invertMaterialFrame,
  multiplyMaterialFrames,
} from '../materials/frame.js'

type Vec3 = readonly [number, number, number]
export interface UvmEffectFrameOptions {
  /** Existing trusted provider, queried in effect simulation space. No implicit terrain plane. */
  readonly collisionProvider?: EffectParticleCollisionProvider
  /** Scene caller supplies the separate receiver-projection pass. */
  readonly projectorsHandled?: boolean
  /** Embedded UVM BIN bytes used by mesh emission accessors; decoded arrays are owned. */
  readonly binary?: Uint8Array
  readonly time: number
  readonly sequenceIndex?: number
  readonly viewMatrix?: Float32Array
  readonly materials: readonly SceneRendererMaterial[]
  readonly activeNodes: ReadonlySet<string>
  /** Full animated world transforms, sampled at each simulation step, not only at the final frame. */
  readonly nodeTransformsAt: (time: number) => ReadonlyMap<string, Float32Array>
  readonly maxBytes: number
  readonly maxNodes: number
  readonly maxDiagnostics?: number
  /**
   * `snapshotUvmEffectExtension(document, budget)` taken once by an owner whose document never
   * changes (a reusable effect source), so each frame does not copy the whole extension again.
   */
  readonly extensionSnapshot?: JsonValue
  /**
   * The caller's frame, for a cached owner: a simulation one frame took to a clock is not stepped
   * on to another clock of the same frame, so copies at several random start phases keep a
   * simulation each and step it from frame to frame (see cachedUvmEffectSimulation).
   */
  readonly pass?: unknown
  /**
   * One primitive per particle emitter instead of one per sprite: the emitter's sprites back to
   * front in the frame's view, each sprite's tint on its vertices (primitiveVertexTints).
   */
  readonly batchParticles?: boolean
  readonly signal?: AbortSignal
}

const numeric = new Set([
  'collisionEmitterIndex',
  'collisionEmitMin',
  'collisionEmitMax',
  'collisionEmitChance',
  'collisionEmitEnergy',
  'trailEmitterIndex',
  'trailEmitChance',
  'trailEmitRate',
  'bounceRibbonEmitterIndex',
  'bounceRibbonChance',
  'tailLength',
  'sides',
  'starRatio',
  'rows',
  'columns',
  'textureSlot',
  'parentVelocity',
  'noiseAmplitude',
  'noiseFrequency',
  'noiseCohesion',
  'noiseEdge',
  'maxCollisionEvents',
  'collisionProjectorIndex',
  'collisionProjectorChance',
  'localForceChannels',
  'worldForceChannels',
  'feedbackLocalForceChannels',
  'feedbackWorldForceChannels',
  'worldForceMassMultiplier',
  'windMultiplier',
  'emissionRate',
  'emitCount',
  'lifeSpan',
  'lifeSpanRandom',
  'speed',
  'speedRandom',
  'width',
  'length',
  'alpha',
  'visibility',
  'latitude',
  'variation',
  'mass',
  'massRandom',
  'drag',
  'friction',
  'bounce',
  'emitShapeRadius',
  'emitAngleX',
  'emitAngleY',
  'emitSpreadX',
  'emitSpreadY',
  'maxParticles',
  'heightAbove',
  'heightBelow',
  'pitch',
  'yaw',
  'spreadX',
  'spreadY',
  'timeMiddle',
  'colorTimeMiddle',
  'widthTimeMiddle',
  'maxLength',
])
const booleans = new Set([
  'lengthAndTime',
  'head',
  'tail',
  'lineEmitter',
  'xyQuad',
  'randomizeSize',
  'randomizeRotation',
  'randomizeColor',
  'randomizeAlpha',
  'collideObjects',
  'collideTerrain',
  'modelSpace',
  'boneAnchored',
  'swapModelParticleYZ',
  'randomizeSpeed',
  'randomizeLifeSpan',
  'randomizeMass',
  'squirt',
  'tailClamped',
  'tailFixed',
])
const structures = new Set([
  'lifecycleSizeRandom',
  'lifecycleRotation',
  'lifecycleRotationRandom',
  'segmentColorsRandom',
  'segmentAlphasRandom',
  'particleScaling',
  'lifeSpanUvAnim',
  'decayUvAnim',
  'tailUvAnim',
  'tailDecayUvAnim',
  'emitShapeSize',
  'lifecycleSize',
  'segmentColors',
  'segmentAlphas',
  'widths',
  'color',
])
const orientationNames = new Set([
  'billboard',
  'tail',
  'face-travel-direction',
  'face-world-direction',
  'single-axis',
  'terrain-oriented',
  'terrain-direction-oriented',
  'emitter-oriented',
  'physics-oriented',
  'pinned',
  'trail',
])
const shapeNames = new Set([
  'point',
  'plane',
  'sphere',
  'box',
  'disc',
  'cylinder',
  'mesh',
  'spline',
])
function number(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('effect scalar must be finite')
  return value
}
function vector(value: unknown, fallback: Vec3): Vec3 {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError('effect vector requires three scalars')
  return [number(value[0], 0), number(value[1], 0), number(value[2], 0)]
}
function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(...value)
  if (!(length > 0)) throw new TypeError('effect camera basis is singular')
  return [value[0] / length, value[1] / length, value[2] / length]
}
function setAnchor(out: MutableEffectEmitterAnchor, matrix: Float32Array | undefined): void {
  if (matrix === undefined || matrix.length !== 16 || !matrix.every(Number.isFinite))
    throw new TypeError('effect node world transform is absent or invalid')
  out.position.set(matrix.subarray(12, 15))
  out.xAxis.set(matrix.subarray(0, 3))
  out.yAxis.set(matrix.subarray(4, 7))
  out.zAxis.set(matrix.subarray(8, 11))
}
function transform(point: Vec3, matrix: ArrayLike<number>): Vec3 {
  return [0, 1, 2].map(
    row =>
      number(matrix[row], 0) * point[0] +
      number(matrix[row + 4], 0) * point[1] +
      number(matrix[row + 8], 0) * point[2] +
      number(matrix[row + 12], 0),
  ) as unknown as Vec3
}
/** Snapshot of a document's `UV_game_effects` under the frame budget, as createUvmEffectFrame reads it. */
export function snapshotUvmEffectExtension(
  document: JsonObject,
  budget: Readonly<{ maxBytes: number; maxNodes: number }>,
  signal?: AbortSignal,
): JsonValue {
  return snapshotJson(
    field(document['extensions'], 'UV_game_effects'),
    { maxBytes: budget.maxBytes, maxNodes: budget.maxNodes, maxDepth: 64 },
    signal,
  )
}
/** Deterministic bounded effect preview over the public UVM extension. Native extras are never read.
 * The existing simulator owns emission/integration. This adapter owns node anchors and neutral quads.
 * Unsupported properties stay in the document and receive explicit per-emitter diagnostics. */
/**
 * Keeps what an effect frame shares across calls of one owner whose document and options other than
 * the time, materials and view never change (a reusable effect source): the prepared emitters, and
 * the simulations of the latest clocks. All instances of a model at one clock then simulate once;
 * each view only builds its sprites, and a later clock continues a simulation (see UvmEffectLane).
 */
export interface UvmEffectFrameCache {
  preparation?: {
    readonly inputs: readonly unknown[]
    readonly prepared: ReturnType<typeof prepareUvmEffectFrame>
  }
  /** Least recently used first. */
  readonly lanes: { readonly inputs: readonly unknown[]; readonly lane: UvmEffectLane }[]
}

export function createUvmEffectFrameCache(): UvmEffectFrameCache {
  return { lanes: [] }
}

/**
 * Simulations a cache keeps: an owner's instances share one clock, or one per random start phase
 * (a world spreads a looping clip's copies over eight), and a clock whose steps no lane continues to
 * takes one more.
 */
const CACHED_EFFECT_SIMULATIONS = 10

type UvmEffectPreparation = Extract<ReturnType<typeof prepareUvmEffectFrame>, { empty: false }>
type UvmEffectSimulation = Readonly<{
  simulation: ModelEffectSimulation
  provide: (
    kind: string,
    index: number,
    node: number,
    time: number,
    out: MutableEffectEmitterAnchor,
  ) => void
  toWorld: readonly number[]
  toLocal: readonly number[]
  warnings: readonly { readonly message: string; readonly code: string }[]
}>

/**
 * An effect simulation that later clocks of its owner take on instead of simulating from time zero
 * again. `continueTo` steps it on to a later step of the 1/60 s grid, where it stands as a new
 * simulation would, and otherwise answers false; `time` is NaN once it stopped between clocks.
 */
interface UvmEffectLane {
  time: number
  simulated: UvmEffectSimulation
  /** The caller's frame that last took it (UvmEffectFrameOptions.pass). */
  pass?: unknown
  readonly continueTo: (options: UvmEffectFrameOptions) => boolean
  /** Whether a later clock on the step grid can continue it (a cache evicts other lanes first). */
  readonly continuable: () => boolean
}

const sameInputs = (left: readonly unknown[], right: readonly unknown[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

export function createUvmEffectFrame(
  document: JsonObject,
  options: UvmEffectFrameOptions & { readonly cache?: UvmEffectFrameCache },
) {
  const { signal, cache } = options
  signal?.throwIfAborted()
  const primitives: SceneRendererPrimitive[] = [],
    materials: SceneRendererMaterial[] = []
  const collisionSplats: readonly UvmCollisionSplat[] = []
  const modelParticles: (UvmModelParticleDraw & { readonly transform: readonly number[] })[] = []
  const extension = field(document['extensions'], 'UV_game_effects')
  if (extension === undefined)
    return { primitives, materials, diagnostics: [], collisionSplats, modelParticles }
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 0 ||
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 0 ||
    !Number.isFinite(options.time) ||
    options.time < 0
  )
    throw new RangeError('invalid effect budget/time')
  const preparationInputs = [
    document,
    options.activeNodes,
    options.sequenceIndex,
    options.maxBytes,
    options.maxNodes,
    options.maxDiagnostics,
    options.binary,
    options.projectorsHandled,
    options.collisionProvider,
    options.extensionSnapshot,
  ]
  const cached =
    cache?.preparation !== undefined && sameInputs(cache.preparation.inputs, preparationInputs)
      ? cache.preparation.prepared
      : undefined
  const preparation = cached ?? prepareUvmEffectFrame(document, options)
  if (cache !== undefined && cached === undefined) {
    cache.preparation = { inputs: preparationInputs, prepared: preparation }
    cache.lanes.length = 0
  }
  const diagnostics = [...preparation.diagnostics]
  if (preparation.empty)
    return { primitives, materials, diagnostics, collisionSplats, modelParticles }
  const warn = (message: string, code = 'common.uvm/effect-preview-limitation') => {
    if (diagnostics.length >= (options.maxDiagnostics ?? options.maxNodes))
      throw new RangeError('effect diagnostics exceed budget')
    diagnostics.push({ severity: 'warning', code, message })
  }
  const view = options.viewMatrix
  if (view === undefined) {
    warn(
      'Effect billboards require camera.viewMatrix; effect geometry was not drawn.',
      'common.uvm/effect-camera-required',
    )
    return { primitives, materials, diagnostics, collisionSplats, modelParticles }
  }
  if (view.length !== 16 || !view.every(Number.isFinite))
    throw new TypeError('effect viewMatrix must be finite')
  // Frames stop on the effect step grid (see gridEffectTime).
  const frame = { ...options, time: gridEffectTime(options.time) }
  const simulated =
    cache === undefined
      ? simulateUvmEffectFrame(preparation, frame).simulated
      : cachedUvmEffectSimulation(
          cache,
          preparation,
          [preparation, frame.nodeTransformsAt, frame.collisionProvider],
          frame,
        )
  for (const { message, code } of simulated.warnings) warn(message, code)
  return uvmEffectFrameGeometry(preparation, simulated, frame, view, diagnostics)
}

/**
 * A cached owner's simulation at a frame's clock: the lane standing at it, else the latest earlier
 * lane continued to it, else a new lane in place of the least recently used one (lanes no later
 * clock can continue go first). A lane the caller's frame (`pass`) already took to one clock is not
 * stepped on to another: the phases of one frame, taken in any order, each step their own lane.
 * Every lane stands where a new simulation stands at its step, so which lane a clock takes changes
 * only the work.
 */
function cachedUvmEffectSimulation(
  cache: UvmEffectFrameCache,
  prepared: UvmEffectPreparation,
  inputs: readonly unknown[],
  options: UvmEffectFrameOptions,
): UvmEffectSimulation {
  const { lanes } = cache
  const use = (entry: (typeof lanes)[number]) => {
    lanes.splice(lanes.indexOf(entry), 1)
    lanes.push(entry)
    entry.lane.pass = options.pass
    return entry.lane.simulated
  }
  const own = lanes.filter(entry => sameInputs(entry.inputs, inputs))
  const kept = own.find(entry => entry.lane.time === options.time)
  if (kept !== undefined) return use(kept)
  const earlier = own
    .filter(
      entry =>
        entry.lane.time < options.time &&
        (options.pass === undefined || entry.lane.pass !== options.pass),
    )
    .sort((left, right) => right.lane.time - left.lane.time)
  for (const entry of earlier) {
    let continued = false
    try {
      continued = entry.lane.continueTo(options)
    } finally {
      if (Number.isNaN(entry.lane.time)) lanes.splice(lanes.indexOf(entry), 1)
    }
    if (continued) return use(entry)
  }
  const entry = { inputs, lane: simulateUvmEffectFrame(prepared, options) }
  if (lanes.length >= CACHED_EFFECT_SIMULATIONS) {
    const stuck = lanes.findIndex(other => !other.lane.continuable())
    lanes.splice(stuck === -1 ? 0 : stuck, 1)
  }
  lanes.push(entry)
  entry.lane.pass = options.pass
  return entry.lane.simulated
}

/** Simulation steps per second (the simulator's default fixed step). */
const EFFECT_STEPS_PER_SECOND = 60
const EFFECT_STEP_SECONDS = 1 / EFFECT_STEPS_PER_SECOND
/**
 * Steps an effect simulates at most: a clock further from time zero starts this many steps before
 * it, from an empty effect.
 */
const EFFECT_MAX_SEEK_STEPS = 3600

/** Whole 1/60 s steps at or below a time: the steps a simulation takes to it. */
function effectSteps(time: number): number {
  return Math.max(0, Math.floor(time * EFFECT_STEPS_PER_SECOND + 1e-7))
}

/**
 * The time an effect shows at: the last whole 1/60 s step at or below the clock, at most 1/60 s
 * behind it. A simulation steps the grid, so its steps fall on the same times every frame and the
 * owner's pose cache answers them.
 */
function gridEffectTime(time: number): number {
  return effectSteps(time) / EFFECT_STEPS_PER_SECOND
}

/** Emitters, fields, projectors and collision shapes of an effect: the same for every frame. */
function prepareUvmEffectFrame(document: JsonObject, options: UvmEffectFrameOptions) {
  const { signal } = options
  const diagnostics: SceneRendererDiagnostic[] = []
  const warn = (message: string, code = 'common.uvm/effect-preview-limitation') => {
    if (diagnostics.length >= (options.maxDiagnostics ?? options.maxNodes))
      throw new RangeError('effect diagnostics exceed budget')
    diagnostics.push({ severity: 'warning', code, message })
  }
  const effect = object(
    options.extensionSnapshot ?? snapshotUvmEffectExtension(document, options, signal),
    'UV_game_effects',
  )
  const nodeCount = array(document, 'nodes').length
  const timeUnit = effect['trackTimeUnit'] ?? 'seconds'
  if (timeUnit !== 'seconds' && timeUnit !== 'milliseconds')
    throw new TypeError('invalid effect trackTimeUnit')
  if (
    options.sequenceIndex !== undefined &&
    (!Number.isSafeInteger(options.sequenceIndex) || options.sequenceIndex < 0)
  )
    throw new TypeError('invalid effect sequenceIndex')
  const materialCount = array(document, 'materials').length
  const particles: RenderParticleEmitter[] = [],
    ribbons: RenderRibbonEmitter[] = []
  const particleOrdinals: number[] = [],
    ribbonOrdinals: number[] = []
  const splineNodes = new Set<number>()
  let particleSplineWork = 0,
    ribbonSplineWork = 0
  let emitterCount = 0
  let meshBytes = 0,
    meshNodes = 0
  for (const kind of ['particles', 'ribbons'] as const) {
    for (const [index, value] of array(effect, kind).entries()) {
      signal?.throwIfAborted()
      const entry = object(value, 'effect emitter')
      const node = safeIndex(entry['node'], nodeCount, 'effect node')
      const material = safeIndex(entry['material'], materialCount, 'effect material')
      if (!options.activeNodes.has(`node-${node}`)) continue
      emitterCount++
      if (
        emitterCount + meshNodes > options.maxNodes ||
        emitterCount * 4096 + meshBytes > options.maxBytes
      )
        throw new RangeError('effect emitters exceed budget')
      const name = typeof entry['name'] === 'string' ? entry['name'] : `${kind}-${index}`
      const label = `${kind}/${index} (${name})`
      const output: Record<string, JsonValue> = { name, boneIndex: node, materialIndex: material }
      const splines = readUvmEffectSplines(entry, kind, {
        nodeCount,
        activeNodes: options.activeNodes,
        timeUnit,
        maxNodes: options.maxNodes - emitterCount - meshNodes,
        maxBytes: options.maxBytes - emitterCount * 4096 - meshBytes,
        ...(signal === undefined ? {} : { signal }),
      })
      Object.assign(output, splines.values)
      meshNodes += splines.nodes
      meshBytes += splines.bytes
      particleSplineWork += splines.particleWork
      ribbonSplineWork += splines.ribbonWork
      for (const endpoint of splines.nodeIndices) splineNodes.add(endpoint)
      const omitted: string[] = []
      for (const [key, value] of Object.entries(entry)) {
        if (['name', 'node', 'material'].includes(key) || EFFECT_SPLINE_FIELDS.has(key)) continue
        if (key === 'emitShapeMeshes' && kind === 'particles' && entry['emitShape'] === 'mesh')
          continue
        if (key === 'animation' || key === 'sequenceAnimation') {
          output[key] = readUvmEffectAnimation(
            value,
            key === 'sequenceAnimation',
            timeUnit,
            options.maxNodes,
            signal,
          )
          const unapplied = Object.keys(object(output[key], 'effect animation')).filter(
            property =>
              kind === 'particles' &&
              (property === 'textureSlot' ||
                property.startsWith('lifecycleRotation') ||
                property === 'alpha' ||
                property === 'color'),
          )
          if (unapplied.length > 0) omitted.push(...unapplied.map(property => `${key}.${property}`))
        } else if (key === 'modelPaths' && kind === 'particles') {
          if (
            !Array.isArray(value) ||
            value.some(path => typeof path !== 'string' || !path || path.includes('\0'))
          )
            throw new TypeError('model particle paths must be nonempty logical strings')
          output[key] = [...value]
        } else if (key === 'texturePath') {
          if (typeof value !== 'string' || value.trim() === '' || value.includes('\0'))
            throw new TypeError(`${label}.texturePath must be a nonempty logical string`)
          output[key] = value
        } else if (numeric.has(key)) {
          if (
            [
              'maxCollisionEvents',
              'collisionProjectorIndex',
              'collisionEmitterIndex',
              'trailEmitterIndex',
              'bounceRibbonEmitterIndex',
              'collisionEmitMin',
              'collisionEmitMax',
              'rows',
              'columns',
              'textureSlot',
              'sides',
            ].includes(key) &&
            (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
          )
            throw new TypeError('effect collision index/event limit must be a nonnegative integer')
          if (
            key.endsWith('ForceChannels') &&
            (typeof value !== 'number' ||
              !Number.isSafeInteger(value) ||
              value < 0 ||
              value > 0xffffffff)
          )
            throw new TypeError('effect force channels must be uint32')
          const scalar = number(value, 0)
          output[key] = scalar
        } else if (booleans.has(key)) {
          if (typeof value !== 'boolean') throw new TypeError(`${label}.${key} must be boolean`)
          output[key] = value
        } else if (key === 'gravity')
          output[key] = kind === 'particles' ? number(value, 0) : [...vector(value, [0, 0, 0])]
        else if (key === 'emitShape' && typeof value === 'string' && shapeNames.has(value))
          output[key] = value
        else if (
          key === 'orientationMode' &&
          typeof value === 'string' &&
          orientationNames.has(value)
        )
          output[key] = value
        else if (
          key === 'ribbonType' &&
          ['planar', 'billboard', 'cylinder', 'star'].includes(String(value))
        )
          output[key] = value
        else if (
          (kind === 'ribbons' &&
            ['scaleVariation', 'alphaVariation', 'lengthVariation'].includes(key)) ||
          [
            'pitchVariation',
            'yawVariation',
            'speedVariation',
            'spreadXVariation',
            'spreadYVariation',
            'sizeVariation',
            'alphaVariation',
            'colorVariation',
            'rotationVariation',
          ].includes(key)
        ) {
          const variation = object(value, 'effect variation'),
            shape = variation['shape']
          if (typeof shape !== 'string' && typeof shape !== 'number')
            throw new TypeError('effect variation shape must be named or numbered')
          if (
            !['none', 'sine', 'triangle', 'square', 'saw', 'noise'].includes(String(shape)) &&
            !(typeof shape === 'number' && Number.isSafeInteger(shape) && shape >= 0 && shape <= 5)
          )
            throw new TypeError('unsupported effect variation shape')
          output[key] = {
            shape,
            amplitude: number(variation['amplitude'], 0),
            frequency: number(variation['frequency'], 0),
            ...(variation['phase'] === undefined ? {} : { phase: number(variation['phase'], 0) }),
          }
        } else if (key === 'screenSpaceUv' && kind === 'particles') {
          const uv = object(value, 'particle screen-space UV'),
            pair = (raw: unknown) => {
              if (!Array.isArray(raw) || raw.length !== 2)
                throw new TypeError('screen UV requires two finite components')
              return [number(raw[0], 0), number(raw[1], 0)]
            }
          output[key] = {
            offset: pair(uv['offset']),
            tiling: pair(uv['tiling']),
            angle: [...vector(uv['angle'], [0, 0, 0])],
            threshold: number(uv['threshold'], 0),
          }
        } else if (structures.has(key)) {
          if (key === 'emitShapeSize') output[key] = [...vector(value, [0, 0, 0])]
          if (key === 'segmentColors' || key === 'segmentColorsRandom') {
            if (!Array.isArray(value) || value.length !== 3)
              throw new TypeError('effect colors require three stages')
            output[key] = value.map(item => [...vector(item, [1, 1, 1])])
          }
          if (
            [
              'segmentAlphas',
              'segmentAlphasRandom',
              'particleScaling',
              'lifeSpanUvAnim',
              'decayUvAnim',
              'tailUvAnim',
              'tailDecayUvAnim',
            ].includes(key)
          )
            output[key] = [...vector(value, [1, 1, 1])]
          if (key === 'widths' || key === 'color') output[key] = [...vector(value, [1, 1, 1])]
          if (
            [
              'lifecycleSize',
              'lifecycleSizeRandom',
              'lifecycleRotation',
              'lifecycleRotationRandom',
            ].includes(key)
          ) {
            const size = object(value, 'effect lifecycle size')
            output[key] = {
              start: [...vector(size['start'], [1, 1, 1])],
              middle: [...vector(size['middle'], [1, 1, 1])],
              end: [...vector(size['end'], [1, 1, 1])],
              timeMiddle: number(size['timeMiddle'], 0.5),
            }
          }
        } else if (
          value !== undefined &&
          value !== null &&
          value !== false &&
          value !== 0 &&
          value !== ''
        )
          omitted.push(key)
      }
      if (omitted.length > 0) warn(`${label}: preview does not apply ${omitted.join(', ')}.`)
      // A foreign orientation or shape is not silently drawn as a billboard/point.
      if (
        kind === 'particles' &&
        ((entry['orientationMode'] !== undefined &&
          !orientationNames.has(String(entry['orientationMode']))) ||
          (entry['emitShape'] !== undefined && !shapeNames.has(String(entry['emitShape']))))
      )
        continue
      if (
        kind === 'ribbons' &&
        entry['ribbonType'] !== undefined &&
        !['planar', 'billboard', 'cylinder', 'star'].includes(String(entry['ribbonType']))
      )
        continue
      if (kind === 'particles') {
        const squirt = selectUvmEffectSquirt(
          output,
          options.sequenceIndex,
          options.maxNodes,
          signal,
        )
        if (squirt !== undefined) output['squirt'] = squirt
        // No key in this clip: no burst (a death's debris stays out of the intact rocks' Stand).
        if (output['squirt'] === true && !uvmEffectSquirtKeyed(output, options.sequenceIndex))
          output['emitCount'] = 0
      }
      // Preserve source table identity independently of dense simulator filtering.
      if (kind === 'particles') particleOrdinals.push(index)
      else ribbonOrdinals.push(index)
      if (kind === 'particles' && entry['emitShape'] === 'mesh') {
        if (options.binary === undefined)
          throw new TypeError('effect mesh emission requires UVM BIN bytes')
        const geometry = readUvmEffectMeshes(
          document,
          options.binary,
          entry['emitShapeMeshes'],
          {
            maxBytes: options.maxBytes - emitterCount * 4096 - meshBytes,
            maxNodes: options.maxNodes - emitterCount - meshNodes,
          },
          signal,
        )
        meshBytes += geometry.bytes
        meshNodes += geometry.nodes
        particles.push({
          ...(output as unknown as RenderParticleEmitter),
          emitShapeMeshes: geometry.meshes,
        })
      } else if (kind === 'particles') particles.push(output as unknown as RenderParticleEmitter)
      else ribbons.push(output as unknown as RenderRibbonEmitter)
    }
  }
  const linked = bindUvmEffectLinks(
    particles,
    particleOrdinals,
    ribbonOrdinals,
    array(effect, 'particles').length,
    array(effect, 'ribbons').length,
    options.maxBytes - emitterCount * 4096 - meshBytes,
    options.maxNodes - emitterCount - meshNodes,
    signal,
  )
  meshBytes += linked.bytes
  meshNodes += linked.nodes
  const fields = readUvmEffectFields(effect, {
    nodeCount,
    activeNodes: options.activeNodes,
    timeUnit,
    maxNodes: options.maxNodes - emitterCount - meshNodes,
    maxBytes: options.maxBytes - emitterCount * 4096 - meshBytes,
    warn,
    ...(signal === undefined ? {} : { signal }),
  })
  emitterCount += fields.count
  if (array(effect, 'projectors').length > 0 && options.projectorsHandled !== true)
    warn('projectors: receiver geometry is not connected to the preview.')
  if (particles.length + ribbons.length === 0) return { diagnostics, empty: true as const }
  const projectorTemplates = readEffectProjectors(
    document,
    options.maxNodes - emitterCount - meshNodes,
    options.maxBytes - emitterCount * 4096 - meshBytes,
    signal,
  )
  emitterCount += projectorTemplates.length
  const collisionInput =
    particles.some(emitter => emitter.collideObjects) ||
    ribbons.some(emitter => emitter.collideObjects)
      ? readEffectCollisionShapes(document, options.binary ?? new Uint8Array(), {
          activeNodes: options.activeNodes,
          maxNodes: options.maxNodes - emitterCount - meshNodes,
          maxBytes: options.maxBytes - emitterCount * 4096 - meshBytes,
          warn,
          ...(signal === undefined ? {} : { signal }),
        })
      : { shapes: [], bytes: 0, nodes: 0 }
  meshBytes += collisionInput.bytes
  meshNodes += collisionInput.nodes
  for (const emitter of particles) {
    if (
      emitter.collisionProjectorIndex !== undefined &&
      emitter.collisionProjectorIndex >= projectorTemplates.length
    )
      throw new TypeError('effect collision projector target absent')
    if (emitter.collideTerrain && options.collisionProvider === undefined)
      warn(
        'terrain collision requires the existing trusted provider; no terrain surface was invented.',
      )
  }
  return {
    diagnostics,
    empty: false as const,
    effect,
    nodeCount,
    particles,
    ribbons,
    ribbonOrdinals,
    splineNodes,
    particleSplineWork,
    ribbonSplineWork,
    emitterCount,
    meshBytes,
    meshNodes,
    fields,
    projectorTemplates,
    collisionInput,
    // The emitters never change after this: their sprites copy each once (a cached preparation).
    particleSnapshots: new WeakMap() as UvmParticleEmitterSnapshots,
  }
}

/**
 * The effect simulated up to the frame time with the node transforms it read, as a lane later clocks
 * can continue. Nothing here depends on the view, so every view and instance at one clock shares it.
 */
function simulateUvmEffectFrame(
  prepared: UvmEffectPreparation,
  options: UvmEffectFrameOptions,
): UvmEffectLane {
  let { signal } = options
  const {
    effect,
    nodeCount,
    particles,
    ribbons,
    splineNodes,
    particleSplineWork,
    ribbonSplineWork,
    emitterCount,
    meshBytes,
    meshNodes,
    fields,
    projectorTemplates,
    collisionInput,
  } = prepared
  let transforms = options.nodeTransformsAt(0)
  const spaceNode =
    effect['spaceNode'] === undefined
      ? undefined
      : safeIndex(effect['spaceNode'], nodeCount, 'effect spaceNode')
  const simulationFrame = () => {
    if (spaceNode === undefined) return IDENTITY_MATERIAL_FRAME
    const frame = transforms.get(`node-${spaceNode}`)
    if (frame === undefined) throw new TypeError('effect simulation space transform is absent')
    return Array.from(frame)
  }
  // Conservative allowance includes simulator pools, frame geometry/material objects and snapshots.
  const capacity = Math.min(
    1024,
    Math.floor(
      (options.maxBytes - emitterCount * 4096 - meshBytes) / (ribbons.length === 0 ? 4096 : 8192),
    ),
  )
  if (capacity < 1) throw new RangeError('effect simulation exceeds byte budget')
  const maxTrailRate = particles.reduce(
    (rate, emitter) =>
      emitter.trailEmitterIndex === undefined ? rate : Math.max(rate, emitter.trailEmitRate ?? 0),
    0,
  )
  // The work of simulating up to a time; a lane checks it again for every clock it continues to.
  const checkWork = (time: number) => {
    const trailWork = capacity * maxTrailRate * time
    if (!Number.isFinite(trailWork) || trailWork > options.maxNodes - emitterCount - meshNodes)
      throw new RangeError('effect trail emission exceeds seek work budget')
    assertUvmEffectSplineWork(particleSplineWork, ribbonSplineWork, time, Math.min(capacity, 256))
  }
  checkWork(options.time)
  const localMatrix = (node: number) => {
    const matrix = transforms.get(`node-${node}`)
    if (matrix === undefined) throw new TypeError('effect node world transform absent')
    return Float32Array.from(
      multiplyMaterialFrames(invertMaterialFrame(simulationFrame()), Array.from(matrix)),
    )
  }
  const provide = (
    _kind: string,
    _index: number,
    node: number,
    _time: number,
    out: MutableEffectEmitterAnchor,
  ) => {
    setAnchor(out, localMatrix(node))
    for (const axis of [out.xAxis, out.yAxis, out.zAxis]) {
      const length = Math.hypot(axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0)
      if (length > 0) {
        axis[0] = (axis[0] ?? 0) / length
        axis[1] = (axis[1] ?? 0) / length
        axis[2] = (axis[2] ?? 0) / length
      } else axis.fill(0)
    }
  }
  const simulationProvider = (
    kind: string,
    index: number,
    node: number,
    time: number,
    out: MutableEffectEmitterAnchor,
  ) => {
    if (kind === 'particle' && particles[index]?.modelSpace) {
      out.position.fill(0)
      out.xAxis.fill(0)
      out.yAxis.fill(0)
      out.zAxis.fill(0)
      out.xAxis[0] = 1
      out.yAxis[1] = 1
      out.zAxis[2] = 1
    } else provide(kind, index, node, time, out)
  }
  const splineAnchor: MutableEffectEmitterAnchor = {
    position: new Float32Array(3),
    xAxis: new Float32Array(3),
    yAxis: new Float32Array(3),
    zAxis: new Float32Array(3),
  }
  const validateSplineFrames = () => {
    for (const node of splineNodes) {
      signal?.throwIfAborted()
      setAnchor(splineAnchor, localMatrix(node))
    }
  }
  validateSplineFrames()
  const simulation = new ModelEffectSimulation(
    {
      particles,
      ribbons,
      forces: fields.forces,
      warps: fields.warps,
      projectors: projectorTemplates,
      trackTimeUnit: 'seconds',
    },
    {
      maxParticles: particles.length === 0 ? 0 : capacity,
      maxRibbons: ribbons.length === 0 ? 0 : capacity,
      maxParticlesPerEmitter: capacity,
      maxRibbonsPerEmitter: capacity,
      maxProjectorSplats: projectorTemplates.length === 0 ? 0 : Math.min(capacity, 128),
      collisionShapes: collisionInput.shapes,
      collisionAnchorProvider: provide,
      ...(options.collisionProvider === undefined
        ? {}
        : { collisionProvider: options.collisionProvider }),
      // Every step spends a spawn budget of its own, as a player's frames do (MK2 updated its
      // effects once a frame): an emitter keeps emitting at any clock, not only in a first stretch.
      maxSpawnPerStep: Math.min(capacity, 256),
      fixedStepSeconds: EFFECT_STEP_SECONDS,
      maxSeekSteps: EFFECT_MAX_SEEK_STEPS,
    },
  )
  const sequenceId = options.sequenceIndex ?? null
  const sampleAt = (time: number) => {
    signal?.throwIfAborted()
    transforms = options.nodeTransformsAt(time)
    validateSplineFrames()
    fields.sample(time, sequenceId)
  }
  // A step of the grid, as `update` takes it.
  const stepFrame = {
    sequenceId,
    sequenceTimeSeconds: 0,
    animationTime: 0,
    allowSpawn: true,
    anchorProvider: simulationProvider,
  }
  let dropped = 0
  // Whole 1/60 s steps from time zero, each an `update` with its own spawn budget.
  const target = effectSteps(options.time)
  const clamped = target > EFFECT_MAX_SEEK_STEPS
  let steps = clamped ? target - EFFECT_MAX_SEEK_STEPS : 0
  const stepTo = (last: number) => {
    for (let step = steps + 1; step <= last; step += 1) {
      const time = step / EFFECT_STEPS_PER_SECOND
      sampleAt(time)
      stepFrame.sequenceTimeSeconds = time
      stepFrame.animationTime = time
      const stats = simulation.update(EFFECT_STEP_SECONDS, stepFrame)
      dropped += stats.droppedParticles + stats.droppedRibbons + stats.droppedProjectorSplats
      steps = step
    }
  }
  simulation.reset(sequenceId)
  stepTo(target)
  const at = (time: number): UvmEffectSimulation => {
    const warnings: { message: string; code: string }[] = []
    const warn = (message: string, code: string) => warnings.push({ message, code })
    if (clamped)
      warn(
        `Effect clock is past ${EFFECT_MAX_SEEK_STEPS} fixed steps; the effect is simulated from ${EFFECT_MAX_SEEK_STEPS} steps before it.`,
        'common.uvm/effect-seek-clamped',
      )
    if (dropped > 0)
      warn(
        'Effect capacity/spawn budget dropped emitted objects.',
        'common.uvm/effect-capacity-clamped',
      )
    transforms = options.nodeTransformsAt(time)
    validateSplineFrames()
    const toWorld = simulationFrame(),
      toLocal = invertMaterialFrame(toWorld)
    return { simulation, provide, toWorld, toLocal, warnings }
  }
  const lane: UvmEffectLane = {
    time: options.time,
    simulated: at(options.time),
    continueTo(next) {
      // A clamped lane started past time zero: a later clock starts its own.
      const last = effectSteps(next.time)
      if (clamped || last <= steps || last > EFFECT_MAX_SEEK_STEPS) return false
      signal = next.signal
      checkWork(next.time)
      lane.time = Number.NaN
      stepTo(last)
      lane.simulated = at(next.time)
      lane.time = next.time
      return true
    },
    continuable: () => !clamped && steps < EFFECT_MAX_SEEK_STEPS,
  }
  return lane
}

/** An effect frame from its preparation and simulation, for one view. */
function uvmEffectFrameGeometry(
  prepared: UvmEffectPreparation,
  simulated: UvmEffectSimulation,
  options: UvmEffectFrameOptions,
  view: Float32Array,
  diagnostics: SceneRendererDiagnostic[],
) {
  const { signal } = options
  const { particles, ribbons, ribbonOrdinals, emitterCount } = prepared
  let { meshNodes } = prepared
  const { simulation, provide, toWorld, toLocal } = simulated
  const primitives: SceneRendererPrimitive[] = [],
    materials: SceneRendererMaterial[] = []
  let collisionSplats: readonly UvmCollisionSplat[] = []
  const modelParticles: (UvmModelParticleDraw & { readonly transform: readonly number[] })[] = []
  const worldRight: Vec3 = [number(view[0], 0), number(view[4], 0), number(view[8], 0)]
  const worldUp: Vec3 = [number(view[1], 0), number(view[5], 0), number(view[9], 0)]
  const direction = (value: Vec3): Vec3 =>
    normalize(
      [0, 1, 2].map(
        row =>
          number(toLocal[row], 0) * value[0] +
          number(toLocal[row + 4], 0) * value[1] +
          number(toLocal[row + 8], 0) * value[2],
      ) as unknown as Vec3,
    )
  const right = direction(worldRight),
    up = direction(worldUp)
  let bytes = emitterCount * 4096 + prepared.meshBytes
  const materialById = new Map(options.materials.map(material => [material.id, material]))
  const cameraWorld = transform([0, 0, 0], invertMaterialFrame(Array.from(view))),
    cameraLocal = transform(cameraWorld, toLocal)
  const particleMaterialBytes = simulation.particles.activeCount * 1024
  if (particleMaterialBytes > options.maxBytes - bytes)
    throw new RangeError('particle frame materials exceed budget')
  const particleGeometry = createUvmParticleGeometry(simulation.particles, particles, {
    ...(particles.some(emitter => (emitter.modelPaths?.length ?? 0) > 0)
      ? {
          drawModelParticle: (instance: UvmModelParticleDraw) =>
            modelParticles.push({ ...instance, transform: [...toWorld] }),
        }
      : {}),
    cameraRight: right,
    cameraUp: up,
    cameraPosition: cameraLocal,
    terrainNormal: direction([0, 1, 0]),
    time: options.time,
    ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex }),
    anchorProvider: provide,
    emitterSnapshots: prepared.particleSnapshots,
    maxBytes: options.maxBytes - bytes - particleMaterialBytes,
    maxNodes: options.maxNodes - emitterCount - meshNodes,
    ...(signal === undefined ? {} : { signal }),
  })
  bytes += particleGeometry.bytes + particleMaterialBytes
  meshNodes += particleGeometry.nodes
  // Every sprite of an emitter draws with its emitter's material (see emitterMaterial).
  const frameMaterials = new Map<number, SceneRendererMaterial | null>()
  const materialOf = (index: number) => {
    const emitter = particles[index]
    if (emitter === undefined) throw new TypeError('particle geometry emitter absent')
    const base = materialById.get(`material-${emitter.materialIndex}`)
    if (base === undefined) throw new TypeError('particle geometry material absent')
    let material = frameMaterials.get(index)
    if (material === undefined) {
      material =
        emitterMaterial(
          base,
          `uvm-effect-particle-emitter-${index}`,
          emitter.texturePath,
          emitter.screenSpaceUv,
          options.maxNodes - emitterCount - meshNodes - primitives.length,
          options.maxBytes - bytes,
          signal,
        ) ?? null
      frameMaterials.set(index, material)
      if (material !== null) materials.push(material)
    }
    return material
  }
  if (options.batchParticles === true) {
    const sprites = new Map<number, UvmParticleGeometryEntry[]>()
    for (const geometry of particleGeometry.entries) {
      const list = sprites.get(geometry.emitter)
      if (list === undefined) sprites.set(geometry.emitter, [geometry])
      else list.push(geometry)
    }
    const depth = viewDepthRow(view, toWorld)
    for (const [index, list] of sprites) {
      signal?.throwIfAborted()
      const material = materialOf(index)
      if (material === null) continue
      primitives.push(emitterSprites(index, list, material, depth, toWorld))
    }
  }
  for (const geometry of options.batchParticles === true ? [] : particleGeometry.entries) {
    signal?.throwIfAborted()
    const material = materialOf(geometry.emitter)
    if (material === null) continue
    const geometryPrimitive = {
      id: `uvm-effect-particle-${geometry.slot}`,
      materialId: material.id,
      topology: 'triangles' as const,
      positions: geometry.positions,
      indices: geometry.indices,
      textureCoordinates: geometry.textureCoordinates,
      colors: geometry.colors,
      transform: Float32Array.from(toWorld),
    }
    if (material.simpleEffect === undefined) {
      // Full material program: the sprite's lifecycle color and alpha are one per-sprite multiplier,
      // its tint, applied once. As vertex colours too, a material using them took the particle's
      // alpha twice (a floodlight streak's 0.08 became 0.006 and the beam vanished).
      // ponytail: sprites carry one UV rectangle; mask layers authored on UV1-3 reuse it.
      const c = geometry.colors
      const { colors: _vertexColors, ...uncolored } = geometryPrimitive
      primitives.push({
        ...uncolored,
        textureCoordinateSets: [1, 2, 3].map(set => ({
          set,
          coordinates: geometry.textureCoordinates,
        })),
        tint: [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1],
      })
      continue
    }
    primitives.push(geometryPrimitive)
  }
  const ribbonGeometry = createUvmRibbonGeometry(simulation.ribbons, ribbons, {
    cameraPosition: cameraLocal,
    time: options.time,
    ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex }),
    maxBytes: options.maxBytes - bytes,
    maxNodes: options.maxNodes - emitterCount - meshNodes - primitives.length,
    ...(signal === undefined ? {} : { signal }),
  })
  bytes += ribbonGeometry.bytes
  meshNodes += ribbonGeometry.nodes
  for (const geometry of ribbonGeometry.entries) {
    signal?.throwIfAborted()
    const emitter = ribbons[geometry.emitter]
    if (emitter === undefined) throw new TypeError('ribbon emitter absent')
    const base = materialById.get(`material-${emitter.materialIndex}`)
    if (base === undefined) throw new TypeError('ribbon material absent')
    const id = `uvm-effect-ribbon-${ribbonOrdinals[geometry.emitter]}`
    const material = emitterMaterial(
      base,
      id,
      emitter.texturePath,
      undefined,
      options.maxNodes - emitterCount - meshNodes - primitives.length,
      options.maxBytes - bytes,
      signal,
    )
    if (material === undefined) continue
    materials.push(material)
    // Ribbons are camera-facing strips too; see the particle note above.
    if (material.simpleEffect === undefined) {
      const c = geometry.colors
      primitives.push({
        id,
        materialId: id,
        topology: 'triangles',
        positions: geometry.positions,
        indices: geometry.indices,
        textureCoordinates: geometry.textureCoordinates,
        textureCoordinateSets: [1, 2, 3].map(set => ({
          set,
          coordinates: geometry.textureCoordinates,
        })),
        colors: geometry.colors,
        tint: [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1],
        transform: Float32Array.from(toWorld),
      })
      continue
    }
    primitives.push({
      id,
      materialId: id,
      topology: 'triangles',
      positions: geometry.positions,
      indices: geometry.indices,
      textureCoordinates: geometry.textureCoordinates,
      colors: geometry.colors,
      transform: Float32Array.from(toWorld),
    })
  }
  collisionSplats = captureCollisionSplats(
    simulation.projectorSplats,
    options.maxNodes - emitterCount - meshNodes - primitives.length,
    options.maxBytes - bytes,
    signal,
  )
  return { primitives, materials, diagnostics, collisionSplats, modelParticles }
}

/**
 * Row 2 of view x toWorld: the view-space depth of a point of the effect's simulation space
 * (dot with [x, y, z, 1]), which grows toward the camera.
 */
function viewDepthRow(view: Float32Array, toWorld: readonly number[]): readonly number[] {
  return [0, 1, 2, 3].map(
    column =>
      number(view[2], 0) * number(toWorld[column * 4], 0) +
      number(view[6], 0) * number(toWorld[column * 4 + 1], 0) +
      number(view[10], 0) * number(toWorld[column * 4 + 2], 0) +
      number(view[14], 0) * number(toWorld[column * 4 + 3], 0),
  )
}

/**
 * One emitter's sprites as one primitive, back to front: by the view depth of each sprite's box
 * centre, as the world orders sprite draws (ties in slot order). A program material takes each
 * sprite's colour as its tint, per vertex, as a sprite draw takes it as its `tint`.
 */
function emitterSprites(
  index: number,
  sprites: readonly UvmParticleGeometryEntry[],
  material: SceneRendererMaterial,
  depth: readonly number[],
  toWorld: readonly number[],
): SceneRendererPrimitive & { readonly vertexTints?: Float32Array } {
  const ordered = sprites
    .map((sprite, ordinal) => {
      const { positions } = sprite
      const centre = [0, 1, 2].map(axis => {
        let low = Infinity,
          high = -Infinity
        for (let at = axis; at < positions.length; at += 3) {
          low = Math.min(low, positions[at]!)
          high = Math.max(high, positions[at]!)
        }
        return (low + high) / 2
      })
      const key =
        depth[0]! * centre[0]! + depth[1]! * centre[1]! + depth[2]! * centre[2]! + depth[3]!
      return { sprite, ordinal, key }
    })
    .sort((left, right) => left.key - right.key || left.ordinal - right.ordinal)
  let vertexCount = 0,
    indexCount = 0
  for (const { sprite } of ordered) {
    vertexCount += sprite.positions.length / 3
    indexCount += sprite.indices.length
  }
  const positions = new Float32Array(vertexCount * 3),
    textureCoordinates = new Float32Array(vertexCount * 2),
    colors = new Float32Array(vertexCount * 4),
    indices = new Uint32Array(indexCount)
  let vertex = 0,
    corner = 0
  for (const { sprite } of ordered) {
    positions.set(sprite.positions, vertex * 3)
    textureCoordinates.set(sprite.textureCoordinates, vertex * 2)
    colors.set(sprite.colors, vertex * 4)
    for (const at of sprite.indices) indices[corner++] = at + vertex
    vertex += sprite.positions.length / 3
  }
  const primitive = {
    id: `uvm-effect-particles-${index}`,
    materialId: material.id,
    topology: 'triangles' as const,
    positions,
    indices,
    textureCoordinates,
    transform: Float32Array.from(toWorld),
  }
  if (material.simpleEffect !== undefined) return { ...primitive, colors }
  // As a sprite's tint (primitiveTint): four components in 0..1. Only as the tint: as vertex
  // colours too, a material using them took each sprite's colour and alpha twice.
  for (const value of colors)
    if (!(value >= 0 && value <= 1))
      throw new TypeError('primitive tint requires four finite components in 0..1')
  return {
    ...primitive,
    textureCoordinateSets: [1, 2, 3].map(set => ({ set, coordinates: textureCoordinates })),
    vertexTints: colors,
  }
}

/**
 * Effect emitter materials per base material, id, texture and screen-space UV: an emitter's
 * material depends on nothing else, so every sprite of every frame draws with one material object,
 * and an owner that keeps programs per material (the world) compiles each once, not per sprite and
 * frame.
 */
const emitterMaterials = new WeakMap<
  SceneRendererMaterial,
  Map<string, SceneRendererMaterial | null>
>()

/**
 * An emitter's material: effectSurfaceMaterial of its base material (whose simple pass is already
 * two-sided and carries the emitter's texture) with the emitter's screen-space UV on the simple
 * pass. Undefined for a colorless presentation.
 */
function emitterMaterial(
  base: SceneRendererMaterial,
  id: string,
  texturePath: string | undefined,
  // ponytail: screen-space UV (screenSpaceUv) is only applied by the simple pass.
  uv: RenderParticleEmitter['screenSpaceUv'],
  maxNodes: number,
  maxBytes: number,
  signal: AbortSignal | undefined,
): SceneRendererMaterial | undefined {
  let byEmitter = emitterMaterials.get(base)
  if (byEmitter === undefined) emitterMaterials.set(base, (byEmitter = new Map()))
  const key = `${id}\u0000${texturePath ?? ''}\u0000${uv === undefined ? '' : JSON.stringify(uv)}`
  const kept = byEmitter.get(key)
  if (kept !== undefined) return kept ?? undefined
  const surface = effectSurfaceMaterial(base, id, maxNodes, maxBytes, texturePath, signal)
  const material =
    surface?.simpleEffect === undefined || uv === undefined
      ? surface
      : {
          ...surface,
          simpleEffect: {
            ...surface.simpleEffect,
            screenUv: {
              offset: uv.offset,
              tiling: uv.tiling,
              angle: uv.angle[2],
              threshold: Math.max(0, uv.threshold),
            },
          },
        }
  byEmitter.set(key, material ?? null)
  return material
}
