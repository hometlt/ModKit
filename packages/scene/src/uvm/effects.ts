import {
  readUvmEffectSplines,
  EFFECT_SPLINE_FIELDS,
  assertUvmEffectSplineWork,
} from './effect-splines.js'
import { createUvmParticleGeometry, type UvmModelParticleDraw } from './effect-particles.js'
import { createUvmRibbonGeometry } from './ribbon-geometry.js'
import { bindUvmEffectLinks } from './effect-links.js'
import { projectorMaterial } from './projector-material.js'
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
import { selectUvmEffectSquirt } from './effect-modes.js'
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
/** Deterministic bounded effect preview over the public UVM extension. Native extras are never read.
 * The existing simulator owns emission/integration. This adapter owns node anchors and neutral quads.
 * Unsupported properties stay in the document and receive explicit per-emitter diagnostics. */
export function createUvmEffectFrame(document: JsonObject, options: UvmEffectFrameOptions) {
  const { signal } = options
  signal?.throwIfAborted()
  const primitives: SceneRendererPrimitive[] = [],
    materials: SceneRendererMaterial[] = []
  const diagnostics: SceneRendererDiagnostic[] = []
  let collisionSplats: readonly UvmCollisionSplat[] = []
  const modelParticles: (UvmModelParticleDraw & { readonly transform: readonly number[] })[] = []
  const warn = (message: string, code = 'common.uvm/effect-preview-limitation') => {
    if (diagnostics.length >= (options.maxDiagnostics ?? options.maxNodes))
      throw new RangeError('effect diagnostics exceed budget')
    diagnostics.push({ severity: 'warning', code, message })
  }
  const extension = field(document['extensions'], 'UV_game_effects')
  if (extension === undefined)
    return { primitives, materials, diagnostics, collisionSplats, modelParticles }
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 0 ||
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 0 ||
    !Number.isFinite(options.time) ||
    options.time < 0
  )
    throw new RangeError('invalid effect budget/time')
  const effect = object(
    snapshotJson(
      extension,
      {
        maxBytes: options.maxBytes,
        maxNodes: options.maxNodes,
        maxDepth: 64,
      },
      signal,
    ),
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
  if (particles.length + ribbons.length === 0)
    return { primitives, materials, diagnostics, collisionSplats, modelParticles }
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
  const worldRight: Vec3 = [number(view[0], 0), number(view[4], 0), number(view[8], 0)]
  const worldUp: Vec3 = [number(view[1], 0), number(view[5], 0), number(view[9], 0)]
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
  const trailWork = capacity * maxTrailRate * options.time
  if (!Number.isFinite(trailWork) || trailWork > options.maxNodes - emitterCount - meshNodes)
    throw new RangeError('effect trail emission exceeds seek work budget')
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
  assertUvmEffectSplineWork(
    particleSplineWork,
    ribbonSplineWork,
    options.time,
    Math.min(capacity, 256),
  )
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
      maxSpawnPerStep: Math.min(capacity, 256),
      maxSeekSteps: 3600,
    },
  )
  const stats = simulation.seek(
    options.time,
    (time, frame) => {
      signal?.throwIfAborted()
      transforms = options.nodeTransformsAt(time)
      validateSplineFrames()
      fields.sample(time, options.sequenceIndex ?? null)
      frame.anchorProvider = simulationProvider
    },
    options.sequenceIndex ?? null,
  )
  if (stats.seekClamped)
    warn(
      'Effect seek exceeded 3600 fixed steps; integration uses a coarser bounded step.',
      'common.uvm/effect-seek-clamped',
    )
  if (stats.droppedParticles + stats.droppedRibbons + stats.droppedProjectorSplats > 0)
    warn(
      'Effect capacity/spawn budget dropped emitted objects.',
      'common.uvm/effect-capacity-clamped',
    )
  transforms = options.nodeTransformsAt(options.time)
  validateSplineFrames()
  const toWorld = simulationFrame(),
    toLocal = invertMaterialFrame(toWorld)
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
  let bytes = emitterCount * 4096 + meshBytes
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
    time: options.time,
    ...(options.sequenceIndex === undefined ? {} : { sequenceIndex: options.sequenceIndex }),
    anchorProvider: provide,
    maxBytes: options.maxBytes - bytes - particleMaterialBytes,
    maxNodes: options.maxNodes - emitterCount - meshNodes,
    ...(signal === undefined ? {} : { signal }),
  })
  bytes += particleGeometry.bytes + particleMaterialBytes
  meshNodes += particleGeometry.nodes
  for (const geometry of particleGeometry.entries) {
    signal?.throwIfAborted()
    const emitter = particles[geometry.emitter]
    if (emitter === undefined) throw new TypeError('particle geometry emitter absent')
    const base = materialById.get(`material-${emitter.materialIndex}`)
    if (base === undefined) throw new TypeError('particle geometry material absent')
    const id = `uvm-effect-particle-${geometry.slot}`,
      material = projectorMaterial(
        base,
        id,
        1,
        options.maxNodes - emitterCount - meshNodes - primitives.length,
        options.maxBytes - bytes,
        signal,
      ),
      uv = emitter.screenSpaceUv
    materials.push(
      uv === undefined
        ? material
        : {
            ...material,
            simpleEffect: {
              ...material.simpleEffect,
              screenUv: {
                offset: uv.offset,
                tiling: uv.tiling,
                angle: uv.angle[2],
                threshold: Math.max(0, uv.threshold),
              },
            },
          },
    )
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
    materials.push(
      projectorMaterial(
        base,
        id,
        1,
        options.maxNodes - emitterCount - meshNodes - primitives.length,
        options.maxBytes - bytes,
        signal,
      ),
    )
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
