// Adapted from pinned MK2 webgl-core live particle preview; see artifact PROVENANCE.json.
// Geometry remains in simulation coordinates. The scene caller applies toWorld once.
import { snapshotJson, type JsonSnapshotOptions } from '@modkit/codec-kit/json-snapshot'
import type { JsonValue } from '@modkit/sdk'
import {
  effectVariationValue,
  sampleEffectSequenceScalar,
  sampleEffectSequenceVector,
  writeEffectParticleRenderPosition,
  writeEffectParticleRenderOrigin,
  type EffectParticleState,
  type EffectAnchorProvider,
  type MutableEffectEmitterAnchor,
} from '@modkit/codec-kit/model-math/effects-sim'
import type {
  RenderParticleEmitter,
  RenderParticleLifecycleSize,
} from '@modkit/codec-kit/legacy/models'

type Vec3 = readonly [number, number, number]
interface ParticlePreviewAnchor {
  readonly position: Vec3
  readonly localX: Vec3
  readonly localY: Vec3
  readonly localZ: Vec3
  readonly alpha: number
  readonly visibility: number | undefined
  readonly width: number | undefined
  readonly length: number | undefined
  readonly tailLength: number | undefined
  readonly tailClamped: boolean | undefined
  readonly tailFixed: boolean | undefined
  readonly timeMiddle: number | undefined
  readonly rows: number | undefined
  readonly columns: number | undefined
  readonly xyQuad: boolean | undefined
  readonly orientationMode: RenderParticleEmitter['orientationMode']
  readonly lifecycleSize: RenderParticleLifecycleSize | null
  readonly lifecycleSizeRandom: RenderParticleLifecycleSize | null
  readonly particleScaling: RenderParticleEmitter['particleScaling']
  readonly segmentColors: RenderParticleEmitter['segmentColors']
  readonly segmentAlphas: RenderParticleEmitter['segmentAlphas']
  readonly lifeSpanUvAnim: RenderParticleEmitter['lifeSpanUvAnim']
  readonly decayUvAnim: RenderParticleEmitter['decayUvAnim']
  readonly tailUvAnim: RenderParticleEmitter['tailUvAnim']
  readonly tailDecayUvAnim: RenderParticleEmitter['tailDecayUvAnim']
}
/** Exact pinned optional model-particle draw payload; coordinates remain in simulation space. */
export interface UvmModelParticleDraw {
  readonly path: string
  readonly emitterIndex: number
  readonly slot: number
  readonly ageSeconds: number
  readonly position: Vec3
  readonly right: Vec3
  readonly up: Vec3
  readonly forward: Vec3
  readonly scale: Vec3
  readonly color: readonly [number, number, number, number]
  readonly swapYZ: boolean
}
export interface UvmParticleGeometryOptions {
  /** Trusted callback; quad output is retained even when this consumer is supplied. */
  readonly drawModelParticle?: (instance: UvmModelParticleDraw) => void
  readonly cameraRight: Vec3
  readonly cameraUp: Vec3
  readonly cameraPosition: Vec3
  /**
   * The ground's normal in the effect's space: a terrain-oriented particle lies in that plane. Absent,
   * the emitter's own Z axis stands in for it.
   */
  readonly terrainNormal?: Vec3
  readonly time: number
  readonly sequenceIndex?: number
  readonly anchorProvider: EffectAnchorProvider
  /** Common fallback is one source unit. A caller can pass the pinned bounds-derived size. */
  readonly defaultSize?: number
  /**
   * Copies of the emitters kept across calls, for emitters that never change (see
   * UvmParticleEmitterSnapshots). Absent, every call copies the emitters it draws.
   */
  readonly emitterSnapshots?: UvmParticleEmitterSnapshots
  readonly maxBytes: number
  readonly maxNodes: number
  readonly signal?: AbortSignal
}
/**
 * Owned copies of emitters' preview fields and tracks, kept by an owner whose emitters never change
 * (a prepared effect, see UvmEffectFrameCache): each emitter is copied once instead of on every
 * call, with the nodes and bytes its copy charges a call's snapshot budget.
 */
export type UvmParticleEmitterSnapshots = WeakMap<
  RenderParticleEmitter,
  Readonly<{ emitter: RenderParticleEmitter; nodes: number; bytes: number }>
>
export interface UvmParticleGeometryEntry {
  readonly emitter: number
  readonly slot: number
  readonly positions: Float32Array
  readonly indices: Uint32Array
  readonly textureCoordinates: Float32Array
  readonly colors: Float32Array
}
const required = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null) throw new TypeError('particle preview value absent')
  return value
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('particle preview requires finite scalars')
  return value
}
function tuple(value: ArrayLike<number>, offset = 0): Vec3 {
  return [finite(value[offset]), finite(value[offset + 1]), finite(value[offset + 2])]
}
/** Checks what tuple checks, without making the tuple. */
function finiteTuple(value: ArrayLike<number>, offset: number): void {
  finite(value[offset])
  finite(value[offset + 1])
  finite(value[offset + 2])
}
/** Whether every value is finite, as every(Number.isFinite) says. */
function allFinite(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index++)
    if (!Number.isFinite(values[index])) return false
  return true
}
const previewFields = [
  'modelPaths',
  'swapModelParticleYZ',
  'name',
  'boneIndex',
  'materialIndex',
  'width',
  'length',
  'alpha',
  'visibility',
  'modelSpace',
  'boneAnchored',
  'tailLength',
  'tailClamped',
  'tailFixed',
  'timeMiddle',
  'rows',
  'columns',
  'xyQuad',
  'orientationMode',
  'lifecycleSize',
  'lifecycleSizeRandom',
  'lifecycleRotation',
  'lifecycleRotationRandom',
  'particleScaling',
  'segmentColors',
  'segmentAlphas',
  'segmentColorsRandom',
  'segmentAlphasRandom',
  'sizeVariation',
  'colorVariation',
  'alphaVariation',
  'rotationVariation',
  'lifeSpanUvAnim',
  'decayUvAnim',
  'tailUvAnim',
  'tailDecayUvAnim',
] as const
const sequenceFields = [
  'width',
  'length',
  'visibility',
  'lifecycleSizeStart',
  'lifecycleSizeMiddle',
  'lifecycleSizeEnd',
  'lifecycleSizeRandomStart',
  'lifecycleSizeRandomMiddle',
  'lifecycleSizeRandomEnd',
  'segmentColorStart',
  'segmentColorMiddle',
  'segmentColorEnd',
  'segmentAlphaStart',
  'segmentAlphaMiddle',
  'segmentAlphaEnd',
] as const
function projection(emitter: RenderParticleEmitter): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const field of previewFields)
    if (emitter[field] !== undefined) output[field] = emitter[field]
  if (emitter.animation !== undefined) {
    const animation: Record<string, unknown> = {}
    for (const field of ['width', 'length', 'visibility'] as const)
      if (emitter.animation[field] !== undefined) animation[field] = emitter.animation[field]
    output['animation'] = animation
  }
  if (emitter.sequenceAnimation !== undefined) {
    const animation: Record<string, unknown> = {}
    for (const field of sequenceFields)
      if (emitter.sequenceAnimation[field] !== undefined)
        animation[field] = emitter.sequenceAnimation[field]
    output['sequenceAnimation'] = animation
  }
  return output
}
/**
 * The used emitters' preview fields as one owned JSON list under the call's snapshot budget. With
 * kept copies (UvmParticleEmitterSnapshots) an emitter is copied once and later calls charge the
 * list what copying it would: the list's node, brackets and commas and each kept copy's size.
 */
function ownedEmitters(
  used: readonly RenderParticleEmitter[],
  budget: JsonSnapshotOptions,
  kept: UvmParticleEmitterSnapshots | undefined,
  signal: AbortSignal | undefined,
): readonly RenderParticleEmitter[] {
  if (kept === undefined)
    return snapshotJson(
      used.map(projection),
      budget,
      signal,
    ) as unknown as readonly RenderParticleEmitter[]
  let nodes = 1,
    bytes = 2 + Math.max(0, used.length - 1)
  const owned: RenderParticleEmitter[] = []
  for (const emitter of used) {
    let copy = kept.get(emitter)
    if (copy === undefined) {
      // An element of the list: a level down, its node and brackets charged already.
      const value = snapshotJson(
        projection(emitter),
        {
          maxDepth: budget.maxDepth - 1,
          maxNodes: budget.maxNodes - 1,
          maxBytes: budget.maxBytes - 2,
        },
        signal,
      )
      copy = Object.freeze({
        emitter: value as unknown as RenderParticleEmitter,
        nodes: jsonNodes(value),
        // A snapshot charges the UTF-8 size of its JSON text.
        bytes: new TextEncoder().encode(JSON.stringify(value)).length,
      })
      kept.set(emitter, copy)
    }
    nodes += copy.nodes
    bytes += copy.bytes
    if (nodes > budget.maxNodes) throw new RangeError('JSON snapshot exceeds maxNodes')
    if (bytes > budget.maxBytes) throw new RangeError('JSON snapshot exceeds maxBytes')
    owned.push(copy.emitter)
  }
  return Object.freeze(owned)
}
function jsonNodes(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 1
  let nodes = 1
  for (const item of Array.isArray(value) ? value : Object.values(value)) nodes += jsonNodes(item)
  return nodes
}
function identityAnchor(anchor: MutableEffectEmitterAnchor): void {
  anchor.position.fill(0)
  anchor.xAxis.set([1, 0, 0])
  anchor.yAxis.set([0, 1, 0])
  anchor.zAxis.set([0, 0, 1])
}
function validatePreviewEmitter(emitter: RenderParticleEmitter): void {
  for (const field of [
    'boneIndex',
    'materialIndex',
    'width',
    'length',
    'alpha',
    'visibility',
    'tailLength',
    'timeMiddle',
    'rows',
    'columns',
  ] as const)
    if (emitter[field] !== undefined) finite(emitter[field])
  if (
    emitter.modelPaths !== undefined &&
    (!Array.isArray(emitter.modelPaths) ||
      !emitter.modelPaths.every(
        path => typeof path === 'string' && path.length > 0 && !path.includes('\0'),
      ))
  )
    throw new TypeError('particle model references must be nonempty logical strings')
  for (const field of [
    'xyQuad',
    'modelSpace',
    'boneAnchored',
    'swapModelParticleYZ',
    'tailClamped',
    'tailFixed',
  ] as const)
    if (emitter[field] !== undefined && typeof emitter[field] !== 'boolean')
      throw new TypeError('particle preview flags must be booleans')
  const vector = (value: unknown): void => {
    if (!Array.isArray(value) || value.length !== 3)
      throw new TypeError('particle preview requires declared three-component vectors')
    for (const component of value) finite(component)
  }
  for (const field of [
    'particleScaling',
    'segmentAlphas',
    'segmentAlphasRandom',
    'lifeSpanUvAnim',
    'decayUvAnim',
    'tailUvAnim',
    'tailDecayUvAnim',
  ] as const)
    if (emitter[field] !== undefined) vector(emitter[field])
  for (const field of ['segmentColors', 'segmentColorsRandom'] as const) {
    const colors = emitter[field]
    if (colors === undefined) continue
    if (!Array.isArray(colors)) throw new TypeError('particle preview colors must be an array')
    for (const color of colors) vector(color)
  }
  for (const field of [
    'lifecycleSize',
    'lifecycleSizeRandom',
    'lifecycleRotation',
    'lifecycleRotationRandom',
  ] as const) {
    const value = emitter[field]
    if (value === undefined) continue
    vector(value.start)
    vector(value.middle)
    vector(value.end)
    finite(value.timeMiddle)
  }
  for (const field of [
    'sizeVariation',
    'colorVariation',
    'alphaVariation',
    'rotationVariation',
  ] as const) {
    const value = emitter[field]
    if (value === undefined) continue
    finite(value.amplitude)
    finite(value.frequency)
    if (value.phase !== undefined) finite(value.phase)
    if (typeof value.shape !== 'string') finite(value.shape)
  }
}
/** Emitter snapshots checked already (validatePreviewEmitter): a snapshot is immutable, checked once. */
const validPreviewEmitters = new WeakSet<RenderParticleEmitter>()
function prepareAnchor(
  emitter: RenderParticleEmitter,
  index: number,
  options: UvmParticleGeometryOptions,
  scratch: MutableEffectEmitterAnchor,
): ParticlePreviewAnchor {
  if (!validPreviewEmitters.has(emitter)) {
    validatePreviewEmitter(emitter)
    validPreviewEmitters.add(emitter)
  }
  identityAnchor(scratch)
  options.anchorProvider('particle', index, finite(emitter.boneIndex), options.time, scratch)
  options.signal?.throwIfAborted()
  const sequence = options.sequenceIndex ?? null
  const dimension = (key: 'width' | 'length'): number | undefined => {
    const raw = emitter[key],
      fallback = raw !== undefined && finite(raw) > 0 ? raw : Number.NaN
    const value = sampleEffectSequenceScalar(
      emitter.sequenceAnimation?.[key],
      emitter.animation?.[key],
      sequence,
      options.time,
      fallback,
    )
    return Number.isFinite(value) ? value : undefined
  }
  const segments = particleSegmentsForAnchor(emitter, sequence, options.time)
  const local = emitter.modelSpace && !emitter.boneAnchored
  const visibility = sampleEffectSequenceScalar(
    emitter.sequenceAnimation?.visibility,
    emitter.animation?.visibility,
    sequence,
    options.time,
    emitter.visibility ?? Number.NaN,
  )
  return {
    position: tuple(scratch.position),
    localX: local ? [1, 0, 0] : normalizeVec3(tuple(scratch.xAxis)),
    localY: local ? [0, 1, 0] : normalizeVec3(tuple(scratch.yAxis)),
    localZ: local ? [0, 0, 1] : normalizeVec3(tuple(scratch.zAxis)),
    alpha: clamp01(finite(emitter.alpha ?? 1)),
    visibility: Number.isFinite(visibility) ? visibility : undefined,
    width: dimension('width'),
    length: dimension('length'),
    tailLength: emitter.tailLength,
    tailClamped: emitter.tailClamped,
    tailFixed: emitter.tailFixed,
    timeMiddle: emitter.timeMiddle,
    rows: emitter.rows !== undefined && emitter.rows > 0 ? emitter.rows : undefined,
    columns: emitter.columns !== undefined && emitter.columns > 0 ? emitter.columns : undefined,
    xyQuad: emitter.xyQuad,
    orientationMode: emitter.orientationMode,
    lifecycleSize: particleLifecycleForAnchor(emitter, sequence, options.time, false),
    lifecycleSizeRandom: particleLifecycleForAnchor(emitter, sequence, options.time, true),
    particleScaling: emitter.particleScaling,
    segmentColors: segments.colors,
    segmentAlphas: segments.alphas,
    lifeSpanUvAnim: emitter.lifeSpanUvAnim,
    decayUvAnim: emitter.decayUvAnim,
    tailUvAnim: emitter.tailUvAnim,
    tailDecayUvAnim: emitter.tailDecayUvAnim,
  }
}
/** Reuses live simulator slots/random factors. Own output buffers; no simulation step,
 * reseeding, native format state, material work, nested-model or screen-UV claims.
 * bytes/nodes count retained geometry. Budgets also reserve bounded preview scratch
 * and a single aggregate JSON snapshot of used emitter preview fields/tracks. */
export function createUvmParticleGeometry(
  state: EffectParticleState,
  emitters: readonly RenderParticleEmitter[],
  options: UvmParticleGeometryOptions,
): {
  readonly entries: readonly UvmParticleGeometryEntry[]
  readonly bytes: number
  readonly nodes: number
} {
  options.signal?.throwIfAborted()
  for (const limit of [options.maxBytes, options.maxNodes, state.capacity, state.activeCount])
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new TypeError('invalid particle geometry bounds')
  finite(options.time)
  tuple(options.cameraPosition)
  if (lengthVec3(tuple(options.cameraRight)) === 0 || lengthVec3(tuple(options.cameraUp)) === 0)
    throw new TypeError('particle camera basis is singular')
  const defaultSize = finite(options.defaultSize ?? 1)
  if (defaultSize <= 0 || typeof options.anchorProvider !== 'function')
    throw new TypeError('invalid particle preview options')
  if (
    options.sequenceIndex !== undefined &&
    (!Number.isSafeInteger(options.sequenceIndex) || options.sequenceIndex < 0)
  )
    throw new TypeError('particle sequence index is invalid')
  if (
    state.activeCount > state.capacity ||
    state.activeCount > state.activeSlots.length ||
    state.activeCount > options.maxNodes
  )
    throw new RangeError('particle geometry exceeds active-slot budget')
  if (state.activeCount === 0) return { entries: [], bytes: 0, nodes: 0 }
  if (options.drawModelParticle !== undefined && typeof options.drawModelParticle !== 'function')
    throw new TypeError('model particle consumer must be a function')
  const modelReserve = options.drawModelParticle === undefined ? 0 : state.activeCount * 768
  if (
    state.activeCount + (options.drawModelParticle === undefined ? 0 : state.activeCount) >
    options.maxNodes
  )
    throw new RangeError('model particle descriptors exceed node budget')
  const bytes = state.activeCount * 168 + modelReserve
  if (!Number.isSafeInteger(bytes) || bytes > options.maxBytes)
    throw new RangeError('particle geometry exceeds maxBytes')
  const slots: number[] = [],
    used = new Map<number, number>(),
    seen = new Set<number>()
  for (let active = 0; active < state.activeCount; active++) {
    options.signal?.throwIfAborted()
    const slot = finite(state.activeSlots[active])
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= state.capacity || seen.has(slot))
      throw new TypeError('particle active slot is invalid or duplicated')
    seen.add(slot)
    slots.push(slot)
    const index = finite(state.emitterIndices[slot])
    if (!Number.isSafeInteger(index) || index < 0 || emitters[index] === undefined)
      throw new TypeError('particle emitter index absent')
    if (!used.has(index)) used.set(index, used.size)
    // Every slot is checked before any geometry is made, each value as it was (no scratch arrays).
    finite(state.ages[slot])
    finite(state.lifeSpans[slot])
    finite(state.facings[slot])
    finite(state.sizeRandomFactors[slot])
    finite(state.colorRandomFactors[slot])
    finite(state.alphaRandomFactors[slot])
    finite(state.rotationRandomFactors[slot])
    finite(state.randomSeeds[slot])
    finiteTuple(state.positions, slot * 3)
    finiteTuple(state.velocities, slot * 3)
    finiteTuple(state.spawnPositions, slot * 3)
    const space = required(state.spaces[slot])
    if (space !== 0 && space !== 1 && space !== 2)
      throw new TypeError('particle storage space or head/tail type is invalid')
    const type = required(state.types[slot])
    if (type !== 0 && type !== 1)
      throw new TypeError('particle storage space or head/tail type is invalid')
  }
  const scratchBytes = 256 + used.size * 512
  if (bytes + scratchBytes > options.maxBytes)
    throw new RangeError('particle preview scratch exceeds maxBytes')
  const owned = ownedEmitters(
    [...used.keys()].map(index => required(emitters[index])),
    {
      maxDepth: 96,
      maxNodes: options.maxNodes - slots.length,
      maxBytes: options.maxBytes - bytes - scratchBytes,
    },
    options.emitterSnapshots,
    options.signal,
  )
  const scratch: MutableEffectEmitterAnchor = {
    position: new Float32Array(3),
    xAxis: new Float32Array(3),
    yAxis: new Float32Array(3),
    zAxis: new Float32Array(3),
  }
  const anchors = new Map<number, ParticlePreviewAnchor>()
  for (const [index, ordinal] of used)
    anchors.set(index, prepareAnchor(required(owned[ordinal]), index, options, scratch))
  const positionBuffer = new Float32Array(3),
    originBuffer = new Float32Array(3)
  const entries: UvmParticleGeometryEntry[] = []
  const modelParticles: UvmModelParticleDraw[] = []
  let modelBytes = 0
  for (const slot of slots) {
    options.signal?.throwIfAborted()
    const index = required(state.emitterIndices[slot]),
      emitter = required(owned[required(used.get(index))]),
      anchor = required(anchors.get(index))
    if (anchor.visibility !== undefined && anchor.visibility <= 0) continue
    identityAnchor(scratch)
    if (state.spaces[slot] === 2) {
      scratch.position.set(anchor.position)
      scratch.xAxis.set(anchor.localX)
      scratch.yAxis.set(anchor.localY)
      scratch.zAxis.set(anchor.localZ)
    }
    writeEffectParticleRenderPosition(positionBuffer, 0, state, slot, scratch)
    const position = tuple(positionBuffer),
      rawVelocity = tuple(state.velocities, slot * 3)
    const velocity =
      state.spaces[slot] === 2
        ? tuple(
            addVec3(
              addVec3(
                scaleVec3(tuple(scratch.xAxis), rawVelocity[0]),
                scaleVec3(tuple(scratch.yAxis), rawVelocity[1]),
              ),
              scaleVec3(tuple(scratch.zAxis), rawVelocity[2]),
            ).map(Math.fround),
          )
        : rawVelocity
    const age = required(state.ages[slot]),
      seed = required(state.randomSeeds[slot]),
      phase = clamp01(age / Math.max(0.000001, required(state.lifeSpans[slot])))
    const baseSize = particlePreviewSize(
      anchor,
      phase,
      defaultSize,
      required(state.sizeRandomFactors[slot]),
    )
    const sizeVariation = Math.max(0, 1 + effectVariationValue(emitter.sizeVariation, age, seed))
    const size: readonly [number, number] = [
      baseSize[0] * sizeVariation,
      baseSize[1] * sizeVariation,
    ]
    const color = particlePreviewColor(
      anchor,
      emitter,
      phase,
      required(state.colorRandomFactors[slot]),
      required(state.alphaRandomFactors[slot]),
      age,
      seed,
    )
    const tail = state.types[slot] === 1
    let center: Vec3 = position,
      right: Vec3,
      up: Vec3
    if (!tail) {
      const axes = rotateParticlePreviewAxes(
        particleHeadAxes(
          anchor,
          required(state.facings[slot]),
          velocity,
          position,
          options.cameraRight,
          options.cameraUp,
          options.cameraPosition,
          options.terrainNormal,
        ),
        particlePreviewRotation(
          emitter,
          phase,
          required(state.rotationRandomFactors[slot]),
          age,
          seed,
        ),
      )
      const modelPaths = emitter.modelPaths
      if (
        options.drawModelParticle !== undefined &&
        modelPaths !== undefined &&
        modelPaths.length > 0
      ) {
        const pathIndex = Math.min(
            modelPaths.length - 1,
            Math.floor(clamp01(seed) * modelPaths.length),
          ),
          path = required(modelPaths[pathIndex])
        modelBytes += 768 + path.length * 2
        if (entries.length * 168 + modelBytes + scratchBytes > options.maxBytes)
          throw new RangeError('model particle descriptors exceed byte budget')
        modelParticles.push(
          Object.freeze({
            path,
            emitterIndex: index,
            slot,
            ageSeconds: age,
            position: Object.freeze([...position]) as Vec3,
            right: Object.freeze([...axes.right]) as Vec3,
            up: Object.freeze([...axes.up]) as Vec3,
            forward: Object.freeze(normalizeVec3(crossVec3(axes.right, axes.up))),
            scale: Object.freeze([size[0], size[1], Math.max(size[0], size[1])]) as Vec3,
            color: Object.freeze([...color]) as readonly [number, number, number, number],
            swapYZ: emitter.swapModelParticleYZ === true,
          }),
        )
      }
      // A Warcraft III segment scaling is the quad's half side (mdx-m3-viewer: corners ±1 × scale);
      // a lifecycle or authored size is its whole side.
      const half = anchor.lifecycleSize === null && anchor.particleScaling != null ? 1 : 0.5
      right = scaleVec3(axes.right, size[0] * half)
      up = scaleVec3(axes.up, size[1] * half)
    } else {
      const speed = lengthVec3(velocity),
        direction = speed > 0 ? velocity : anchor.localZ,
        normal = normalizeVec3(direction)
      if (anchor.orientationMode === 'tail' || anchor.orientationMode === 'trail') {
        // M3 tail and trail particles as Particle.fx draws them: a quad `size` to either side across
        // the view and `size × tail` along the travel, the tail being the authored length times the
        // speed when that is longer (or the authored length alone when fixed); a clamped tail is no
        // longer than the way travelled since birth, so a floodlight's beam starts at the lamp. A
        // tail quad stands on its particle; a trail's ends there. Drawn behind the particle, `tail ×
        // speed` long and a third of its size wide, the floodlights of Tokyo_Rooftops stood as bright
        // stars of spikes through their lamps.
        let tail = anchor.tailLength ?? 1
        const lengthOf = (value: number) =>
          anchor.tailFixed === true ? value : Math.max(value, value * speed)
        if (anchor.tailClamped === true && speed > 0) {
          writeEffectParticleRenderOrigin(originBuffer, 0, state, slot, scratch)
          const travelled = lengthVec3(subVec3(position, tuple(originBuffer)))
          const limit = (anchor.tailFixed === true ? tail * speed : lengthOf(tail)) * size[1]
          if (travelled < limit) tail = Math.min(travelled / (speed * size[1]), tail)
        }
        up = scaleVec3(normal, size[1] * lengthOf(tail))
        center = anchor.orientationMode === 'trail' ? subVec3(position, up) : position
        right = scaleVec3(
          particleTailSide(direction, options.cameraPosition, position, options.cameraRight),
          size[0],
        )
      } else {
        const tailLength = Math.max(size[1], (anchor.tailLength ?? defaultSize) * speed)
        let start: Vec3
        if (anchor.orientationMode === 'pinned') {
          writeEffectParticleRenderOrigin(originBuffer, 0, state, slot, scratch)
          start = tuple(originBuffer)
        } else start = subVec3(position, scaleVec3(normal, tailLength))
        center = scaleVec3(addVec3(start, position), 0.5)
        right = scaleVec3(
          particleTailSide(direction, options.cameraPosition, position, options.cameraRight),
          size[0] * 0.35,
        )
        up = scaleVec3(subVec3(position, start), 0.5)
      }
    }
    // The image's top row (v = uv[1], textures load top row first) goes on the +up side: up on screen
    // for a billboard, ahead for a quad along its travel. It went behind, so a shoreline wave's crest
    // trailed its foam and the waves ran away from the shore.
    const uv = particleUvRect(anchor, phase, tail),
      positions = new Float32Array(12),
      textureCoordinates = Float32Array.of(uv[0], uv[3], uv[0], uv[1], uv[2], uv[1], uv[2], uv[3]),
      colors = new Float32Array(16)
    // The corners -right -up, -right +up, +right +up and +right -up: center + right x + up y, each
    // with the colour.
    for (let corner = 0; corner < 4; corner++) {
      const x = corner < 2 ? -1 : 1,
        y = corner === 0 || corner === 3 ? -1 : 1
      for (let axis = 0; axis < 3; axis++)
        positions[corner * 3 + axis] = center[axis]! + right[axis]! * x + up[axis]! * y
      colors.set(color, corner * 4)
    }
    if (!allFinite(positions) || !allFinite(textureCoordinates) || !allFinite(colors))
      throw new RangeError('particle preview exceeds finite float32')
    entries.push({
      emitter: index,
      slot,
      positions,
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
      textureCoordinates,
      colors,
    })
  }
  options.signal?.throwIfAborted()
  if (entries.length * 168 + modelBytes > options.maxBytes)
    throw new RangeError('particle output exceeds byte budget')
  // Emit only after complete input/output validation, so a bad later slot cannot leak a partial descriptor batch.
  for (const instance of modelParticles) {
    options.signal?.throwIfAborted()
    options.drawModelParticle?.(instance)
  }
  return {
    entries,
    bytes: entries.length * 168 + modelBytes,
    nodes: entries.length + modelParticles.length,
  }
}

function particlePreviewSize(
  anchor: ParticlePreviewAnchor,
  phase: number,
  fallbackSize: number,
  randomFactor = 0,
): readonly [number, number] {
  const lifecycle = anchor.lifecycleSize
  if (lifecycle) {
    const randomLifecycle = anchor.lifecycleSizeRandom ?? lifecycle
    const factor = clamp01(randomFactor)
    return [
      Math.max(
        0.0001,
        lerpNumber(
          sampleLifecycleValue(
            lifecycle.start[0],
            lifecycle.middle[0],
            lifecycle.end[0],
            phase,
            lifecycle.timeMiddle,
          ),
          sampleLifecycleValue(
            randomLifecycle.start[0],
            randomLifecycle.middle[0],
            randomLifecycle.end[0],
            phase,
            randomLifecycle.timeMiddle,
          ),
          factor,
        ),
      ),
      Math.max(
        0.0001,
        lerpNumber(
          sampleLifecycleValue(
            lifecycle.start[1],
            lifecycle.middle[1],
            lifecycle.end[1],
            phase,
            lifecycle.timeMiddle,
          ),
          sampleLifecycleValue(
            randomLifecycle.start[1],
            randomLifecycle.middle[1],
            randomLifecycle.end[1],
            phase,
            randomLifecycle.timeMiddle,
          ),
          factor,
        ),
      ),
    ]
  }
  const scaling = anchor.particleScaling
  if (scaling) {
    const size = Math.max(
      0.0001,
      sampleLifecycleValue(scaling[0], scaling[1], scaling[2], phase, anchor.timeMiddle ?? 0.5),
    )
    return [size, size]
  }
  return [
    Math.max(0.0001, anchor.width ?? anchor.length ?? fallbackSize),
    Math.max(0.0001, anchor.length ?? anchor.width ?? fallbackSize),
  ]
}

function sampleLifecycleValue(
  start: number,
  middle: number,
  end: number,
  phase: number,
  timeMiddle: number,
): number {
  const split = clamp01(timeMiddle)
  if (phase < split && split > 0) return lerpNumber(start, middle, phase / split)
  if (split < 1) return lerpNumber(middle, end, (phase - split) / (1 - split))
  return middle
}

function particlePreviewColor(
  anchor: ParticlePreviewAnchor,
  emitter: RenderParticleEmitter | null,
  phase: number,
  colorRandomFactor = 0,
  alphaRandomFactor = 0,
  age = 0,
  seed = 0,
): readonly [number, number, number, number] {
  const colors = anchor.segmentColors ?? [
    [1, 0.72, 0.22],
    [1, 0.45, 0.12],
    [0.25, 0.08, 0.02],
  ]
  const alphas = anchor.segmentAlphas ?? [anchor.alpha, anchor.alpha, 0]
  const middle = clamp01(anchor.timeMiddle ?? 0.5)
  const firstIndex = phase < middle ? 0 : 1
  const secondIndex = phase < middle ? 1 : 2
  const t =
    phase < middle
      ? middle > 0
        ? phase / middle
        : 0
      : middle < 1
        ? (phase - middle) / (1 - middle)
        : 1
  const first = colors[firstIndex] ?? required(colors[0])
  const second = colors[secondIndex] ?? first
  const baseAlpha = anchor.segmentAlphas
    ? lerpNumber(alphas[firstIndex] ?? anchor.alpha, alphas[secondIndex] ?? 0, t)
    : lerpNumber(anchor.alpha, 0, phase)
  const randomColors = emitter?.segmentColorsRandom
  const randomFirst = randomColors?.[firstIndex] ?? first
  const randomSecond = randomColors?.[secondIndex] ?? randomFirst
  const colorFactor = clamp01(colorRandomFactor)
  const colorVariation = Math.max(0, 1 + effectVariationValue(emitter?.colorVariation, age, seed))
  const randomAlphas = emitter?.segmentAlphasRandom
  const randomAlpha = randomAlphas
    ? lerpNumber(randomAlphas[firstIndex] ?? baseAlpha, randomAlphas[secondIndex] ?? baseAlpha, t)
    : baseAlpha
  const alpha =
    lerpNumber(baseAlpha, randomAlpha, clamp01(alphaRandomFactor)) *
    Math.max(0, 1 + effectVariationValue(emitter?.alphaVariation, age, seed))
  return [
    clamp01(
      lerpNumber(
        lerpNumber(first[0], second[0], t),
        lerpNumber(randomFirst[0], randomSecond[0], t),
        colorFactor,
      ) * colorVariation,
    ),
    clamp01(
      lerpNumber(
        lerpNumber(first[1], second[1], t),
        lerpNumber(randomFirst[1], randomSecond[1], t),
        colorFactor,
      ) * colorVariation,
    ),
    clamp01(
      lerpNumber(
        lerpNumber(first[2], second[2], t),
        lerpNumber(randomFirst[2], randomSecond[2], t),
        colorFactor,
      ) * colorVariation,
    ),
    clamp01(alpha),
  ]
}

function particlePreviewRotation(
  emitter: RenderParticleEmitter,
  phase: number,
  randomFactor: number,
  age: number,
  seed: number,
): number {
  const lifecycle = emitter.lifecycleRotation
  const base = lifecycle
    ? sampleLifecycleValue(
        lifecycle.start[2],
        lifecycle.middle[2],
        lifecycle.end[2],
        phase,
        lifecycle.timeMiddle,
      )
    : 0
  const randomLifecycle = emitter.lifecycleRotationRandom
  const random = randomLifecycle
    ? sampleLifecycleValue(
        randomLifecycle.start[2],
        randomLifecycle.middle[2],
        randomLifecycle.end[2],
        phase,
        randomLifecycle.timeMiddle,
      )
    : base
  return (
    lerpNumber(base, random, clamp01(randomFactor)) +
    effectVariationValue(emitter.rotationVariation, age, seed)
  )
}

function rotateParticlePreviewAxes(
  axes: {
    right: readonly [number, number, number]
    up: readonly [number, number, number]
  },
  angle: number,
): {
  right: readonly [number, number, number]
  up: readonly [number, number, number]
} {
  if (!(Math.abs(angle) > 1e-8)) return axes
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    right: addVec3(scaleVec3(axes.right, cosine), scaleVec3(axes.up, sine)),
    up: addVec3(scaleVec3(axes.up, cosine), scaleVec3(axes.right, -sine)),
  }
}

function particleHeadAxes(
  anchor: ParticlePreviewAnchor,
  angle: number,
  velocity: readonly [number, number, number],
  position: readonly [number, number, number],
  cameraRight: readonly [number, number, number],
  cameraUp: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  terrainNormal?: readonly [number, number, number],
): {
  right: readonly [number, number, number]
  up: readonly [number, number, number]
} {
  if (!anchor.xyQuad) {
    switch (anchor.orientationMode) {
      case 'face-travel-direction': {
        const up = lengthVec3(velocity) > 1e-8 ? normalizeVec3(velocity) : anchor.localY
        return {
          right: particleTailSide(up, cameraPosition, position, cameraRight),
          up,
        }
      }
      case 'terrain-oriented': {
        // Flat on the ground, turned as the emitter's X axis is about the ground's normal.
        if (terrainNormal === undefined)
          return { right: normalizeVec3(anchor.localX), up: normalizeVec3(anchor.localY) }
        const normal = normalizeVec3(terrainNormal)
        let right = subVec3(anchor.localX, scaleVec3(normal, dotVec3(anchor.localX, normal)))
        if (lengthVec3(right) <= 1e-8)
          right = subVec3(anchor.localY, scaleVec3(normal, dotVec3(anchor.localY, normal)))
        right = normalizeVec3(right)
        return { right, up: normalizeVec3(crossVec3(normal, right)) }
      }
      case 'face-world-direction':
      case 'emitter-oriented':
      case 'physics-oriented':
        return { right: normalizeVec3(anchor.localX), up: normalizeVec3(anchor.localY) }
      case 'terrain-direction-oriented': {
        const normal = normalizeVec3(terrainNormal ?? anchor.localZ)
        const projected = subVec3(velocity, scaleVec3(normal, dotVec3(velocity, normal)))
        const up = lengthVec3(projected) > 1e-8 ? normalizeVec3(projected) : anchor.localY
        return { right: normalizeVec3(crossVec3(up, normal)), up }
      }
      case 'single-axis': {
        const up = normalizeVec3(anchor.localZ)
        const view = normalizeVec3(subVec3(cameraPosition, position))
        const right = normalizeVec3(crossVec3(up, view))
        return { right: lengthVec3(right) > 1e-8 ? right : cameraRight, up }
      }
      default:
        return { right: cameraRight, up: cameraUp }
    }
  }
  return {
    right: normalizeVec3(
      addVec3(scaleVec3(anchor.localX, Math.cos(angle)), scaleVec3(anchor.localY, Math.sin(angle))),
    ),
    up: normalizeVec3(
      addVec3(
        scaleVec3(anchor.localX, -Math.sin(angle)),
        scaleVec3(anchor.localY, Math.cos(angle)),
      ),
    ),
  }
}

function particleTailSide(
  velocity: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  particlePosition: readonly [number, number, number],
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const cameraVector = normalizeVec3(subVec3(cameraPosition, particlePosition))
  const side = normalizeVec3(crossVec3(velocity, cameraVector))
  return lengthVec3(side) > 0 ? side : fallback
}

function particleUvRect(
  anchor: ParticlePreviewAnchor,
  phase: number,
  tail: boolean,
): readonly [number, number, number, number] {
  const rows = Math.max(1, Math.trunc(anchor.rows ?? 1))
  const columns = Math.max(1, Math.trunc(anchor.columns ?? 1))
  const middle = clamp01(anchor.timeMiddle ?? 0.5)
  const firstHalf = phase < middle
  const t = firstHalf
    ? middle > 0
      ? phase / middle
      : 0
    : middle < 1
      ? (phase - middle) / (1 - middle)
      : 1
  const frames = tail
    ? firstHalf
      ? anchor.tailUvAnim
      : anchor.tailDecayUvAnim
    : firstHalf
      ? anchor.lifeSpanUvAnim
      : anchor.decayUvAnim
  const start = frames?.[0] ?? 0
  const end = frames?.[1] ?? start
  const repeat = frames?.[2] ?? 0
  // A Warcraft III interval [start, end, repeat] runs its sprites `repeat` times over the half,
  // short of `end` (mdx-m3-viewer getCell); without a repeat (M3) it runs start to end once.
  const frame =
    repeat > 0
      ? end > start
        ? Math.min(
            start + (Math.floor((end - start) * repeat * t) % (end - start)),
            columns * rows - 1,
          )
        : start
      : Math.max(0, Math.round(lerpNumber(start, end, t)))
  const cellWidth = 1 / columns
  const cellHeight = 1 / rows
  const column = frame % columns
  const row = Math.floor(frame / columns) % rows
  return [column * cellWidth, row * cellHeight, (column + 1) * cellWidth, (row + 1) * cellHeight]
}

function particleLifecycleForAnchor(
  effect: RenderParticleEmitter,
  sequenceId: number | null,
  animationTime: number,
  random: boolean,
): RenderParticleLifecycleSize | null {
  const lifecycle = random ? effect.lifecycleSizeRandom : effect.lifecycleSize
  if (!lifecycle) return null
  const animation = effect.sequenceAnimation
  const start = sampleEffectSequenceVector(
    random ? animation?.lifecycleSizeRandomStart : animation?.lifecycleSizeStart,
    sequenceId,
    animationTime,
    lifecycle.start,
  )
  const middle = sampleEffectSequenceVector(
    random ? animation?.lifecycleSizeRandomMiddle : animation?.lifecycleSizeMiddle,
    sequenceId,
    animationTime,
    lifecycle.middle,
  )
  const end = sampleEffectSequenceVector(
    random ? animation?.lifecycleSizeRandomEnd : animation?.lifecycleSizeEnd,
    sequenceId,
    animationTime,
    lifecycle.end,
  )
  return {
    start: [required(start[0]), required(start[1]), required(start[2])],
    middle: [required(middle[0]), required(middle[1]), required(middle[2])],
    end: [required(end[0]), required(end[1]), required(end[2])],
    timeMiddle: lifecycle.timeMiddle,
  }
}

function particleSegmentsForAnchor(
  effect: RenderParticleEmitter,
  sequenceId: number | null,
  animationTime: number,
): {
  colors: readonly (readonly [number, number, number])[]
  alphas: readonly [number, number, number]
} {
  const animation = effect.sequenceAnimation
  const colors: [number, number, number][] = []
  const alphas: [number, number, number] = [1, 1, 1]
  const colorTracks = [
    animation?.segmentColorStart,
    animation?.segmentColorMiddle,
    animation?.segmentColorEnd,
  ] as const
  const alphaTracks = [
    animation?.segmentAlphaStart,
    animation?.segmentAlphaMiddle,
    animation?.segmentAlphaEnd,
  ] as const
  for (let index = 0; index < 3; index += 1) {
    const fallbackColor = effect.segmentColors?.[index] ?? [1, 1, 1]
    const fallbackAlpha = normalizeEffectAlpha(effect.segmentAlphas?.[index] ?? 1)
    const sampled = sampleEffectSequenceVector(colorTracks[index], sequenceId, animationTime, [
      fallbackColor[0],
      fallbackColor[1],
      fallbackColor[2],
      fallbackAlpha,
    ])
    colors.push([required(sampled[0]), required(sampled[1]), required(sampled[2])])
    alphas[index] = sampleEffectSequenceScalar(
      alphaTracks[index],
      undefined,
      sequenceId,
      animationTime,
      normalizeEffectAlpha(sampled[3] ?? fallbackAlpha),
    )
  }
  return { colors, alphas }
}

function normalizeEffectAlpha(value: number): number {
  return value > 1 ? value / 255 : value
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerpNumber(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

function crossVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dotVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function addVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scaleVec3(
  value: readonly [number, number, number],
  scale: number,
): [number, number, number] {
  return [value[0] * scale, value[1] * scale, value[2] * scale]
}

function lengthVec3(value: readonly [number, number, number]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function normalizeVec3(value: readonly [number, number, number]): [number, number, number] {
  const length = lengthVec3(value)
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0]
}
