import type {
  CompositeMaterialModel,
  SequenceIndexedAnimationTrack,
  StandardMaterialModel,
} from './legacy/models/material.js'
import type { RenderMaterialColorRemap, RenderRgba } from './model-math/color-remap.js'
import type { AssetResolver } from './legacy/models/codec.js'
import type {
  Bounds,
  RenderMorphTarget,
  RenderPrimitiveTopology,
} from './legacy/models/render-contracts.js'

// M3 family support adapter. It restores the pinned renderer-neutral model contract without
// activating a concrete model codec, renderer, registry, or embedded-resource composition.
export * from './legacy/models/material.js'
export * from './model-math/color-remap.js'
export * from './legacy/models/animation.js'
export * from './model-math/animation-controller.js'
export * from './model-math/humanoid.js'
export * from './legacy/models/codec.js'
export * from './legacy/models/format-detection.js'
export * from './legacy/models/registry-detectors.js'
export * from './model-math/standard-material-glsl.js'
export * from './model-math/sequence-pose.js'
export * from './model-math/transport.js'
export * from './model-math/effects-sim.js'
export * from './legacy/models/texture-codec.js'
export * from './legacy/models/texture-cache.js'
export * from './legacy/models/preview-textures.js'
export * from './model-math/westwood-bind-pose.js'
export type {
  Bounds,
  RenderMorphTarget,
  RenderPrimitiveTopology,
  Vec2,
  Vec3,
} from './legacy/models/render-contracts.js'

/**
 * Per-backend capability report (P9): both renderer backends export one so
 * the unified viewer can populate its switch from data, not hardcoded lists.
 * Shape matches model-webgl's existing `WebGlRendererCapability`.
 */
export interface ModelRendererCapability {
  id: string
  label: string
  supportedFormats: ModelFormat[]
  staticMeshes: boolean
  skinnedMeshes: boolean
  particles: boolean
  materials: 'textured' | 'standard' | 'flat'
}

/**
 * A codec's own id for the format it read, as free text.
 *
 * This used to be a union of every model format the repository could open, which made this
 * package the one place that knew the whole list — the coupling `MODKIT_ARCHITECTURE.md` §6.0
 * forbids. The ids themselves belong to the codecs and reach consumers through the generated
 * catalog; nothing here enumerates them.
 *
 * **Provenance only.** It exists so a viewer can say "opened from `unit.m3`". Branching on it
 * is what this type replaced: a renderer that asks where a model came from is reading a
 * property the neutral model is supposed to have already normalised. When two sources really
 * do behave differently, the difference belongs on the neutral model as a named behaviour
 * (see {@link RenderModelEffects.trackTimeUnit} and {@link RenderSkeleton.skinningInverses}),
 * never as the source's name.
 */
export type ModelFormat = string

export interface RenderMesh {
  name: string
  materialIndex: number
  /** Omitted for the backwards-compatible triangle default. */
  primitiveTopology?: RenderPrimitiveTopology
  positions: Float32Array
  normals?: Float32Array
  /** xyzw per vertex; w = handedness for the bitangent (P3/P4 TBN convention). */
  tangents?: Float32Array
  uvs?: Float32Array
  uvs1?: Float32Array
  uvs2?: Float32Array
  uvs3?: Float32Array
  colors?: Float32Array
  indices: Uint16Array | Uint32Array
  boneIndices?: Uint16Array
  boneWeights?: Float32Array
  morphTargets?: RenderMorphTarget[]
  morphWeights?: Float32Array
  metadata?: Record<string, unknown>
}

export interface RenderBone {
  index: number
  name: string
  parentIndex: number
  /** Source-format node flags (for example M3 billboard/inheritance bits). */
  flags?: number
  inverseBindMatrix?: Float32Array
}

export interface RenderSkeleton {
  bones: RenderBone[]
  /**
   * How a renderer must obtain the skinning inverses for these bones.
   *
   * `'inverse-bind-matrices'` (the default when omitted) uses each bone's
   * {@link RenderBone.inverseBindMatrix} and lets the backend recompute inverses from the
   * current bind pose. `'identity'` says the source already expressed vertex positions
   * relative to their bone, so the skinning inverses must be identity and must not be
   * recomputed — a backend that recomputes them will double-apply the bind transform and
   * collapse the mesh.
   *
   * Codecs whose `inverseBindMatrix` values are published for sampling rather than for
   * skinning declare `'identity'` here. This is the neutral statement of a behaviour two
   * renderers previously derived by asking which format they were drawing.
   */
  skinningInverses?: 'inverse-bind-matrices' | 'identity'
}

export interface RenderTextureLayer {
  label: string
  path: string
  metadata?: Record<string, unknown>
}

export interface RenderMaterial {
  name: string
  layers: RenderTextureLayer[]
  /** Typed solid color; legacy codecs may also expose metadata.baseColor. */
  baseColor?: RenderRgba
  /** Semantic RGB override consumed uniformly by renderer backends. */
  colorRemap?: RenderMaterialColorRemap
  /** Full SC2 standard material model (P4); layers stay for legacy consumers. */
  standard?: StandardMaterialModel
  /** Composite material passes (MATM type 3 → CMP_/CMS_). */
  composite?: CompositeMaterialModel
  metadata?: Record<string, unknown>
}

export interface RenderAnimation {
  name: string
  durationSeconds: number
  startFrame?: number
  endFrame?: number
  priority?: number
  concurrent?: boolean
  metadata?: Record<string, unknown>
}

export interface RenderScalarAnimationKey {
  frame: number
  vector: readonly number[]
  inTan?: readonly number[]
  outTan?: readonly number[]
}

export interface RenderScalarAnimationTrack {
  lineType: number
  globalSeqId: number | null
  keys: readonly RenderScalarAnimationKey[]
}

export interface RenderParticleEmitterAnimation {
  width?: RenderScalarAnimationTrack
  length?: RenderScalarAnimationTrack
  visibility?: RenderScalarAnimationTrack
  emissionRate?: RenderScalarAnimationTrack
  lifeSpan?: RenderScalarAnimationTrack
  speed?: RenderScalarAnimationTrack
  gravity?: RenderScalarAnimationTrack
  latitude?: RenderScalarAnimationTrack
  variation?: RenderScalarAnimationTrack
}

export interface RenderRibbonEmitterAnimation {
  heightAbove?: RenderScalarAnimationTrack
  heightBelow?: RenderScalarAnimationTrack
  alpha?: RenderScalarAnimationTrack
  visibility?: RenderScalarAnimationTrack
  emissionRate?: RenderScalarAnimationTrack
  lifeSpan?: RenderScalarAnimationTrack
  textureSlot?: RenderScalarAnimationTrack
}

/** Sparse sequence-indexed tracks for a particle emitter property. */
export type RenderEffectSequenceTracks = readonly SequenceIndexedAnimationTrack[]

/**
 * Renderer-neutral per-sequence particle animation. This is separate from
 * `animation`, whose single tracks retain the MDX/global-sequence contract.
 */
export interface RenderParticleEmitterSequenceAnimation {
  width?: RenderEffectSequenceTracks
  length?: RenderEffectSequenceTracks
  visibility?: RenderEffectSequenceTracks
  emissionRate?: RenderEffectSequenceTracks
  lifeSpan?: RenderEffectSequenceTracks
  speed?: RenderEffectSequenceTracks
  gravity?: RenderEffectSequenceTracks
  latitude?: RenderEffectSequenceTracks
  variation?: RenderEffectSequenceTracks
  emitAngleX?: RenderEffectSequenceTracks
  emitAngleY?: RenderEffectSequenceTracks
  emitSpreadX?: RenderEffectSequenceTracks
  emitSpreadY?: RenderEffectSequenceTracks
  emitShapeRadius?: RenderEffectSequenceTracks
  emitShapeSize?: RenderEffectSequenceTracks
  lifecycleSizeStart?: RenderEffectSequenceTracks
  lifecycleSizeMiddle?: RenderEffectSequenceTracks
  lifecycleSizeEnd?: RenderEffectSequenceTracks
  lifecycleSizeRandomStart?: RenderEffectSequenceTracks
  lifecycleSizeRandomMiddle?: RenderEffectSequenceTracks
  lifecycleSizeRandomEnd?: RenderEffectSequenceTracks
  segmentColorStart?: RenderEffectSequenceTracks
  segmentColorMiddle?: RenderEffectSequenceTracks
  segmentColorEnd?: RenderEffectSequenceTracks
  segmentAlphaStart?: RenderEffectSequenceTracks
  segmentAlphaMiddle?: RenderEffectSequenceTracks
  segmentAlphaEnd?: RenderEffectSequenceTracks
  emitCount?: RenderEffectSequenceTracks
}

/** Renderer-neutral per-sequence ribbon animation. */
export interface RenderRibbonEmitterSequenceAnimation {
  heightAbove?: RenderEffectSequenceTracks
  heightBelow?: RenderEffectSequenceTracks
  alpha?: RenderEffectSequenceTracks
  visibility?: RenderEffectSequenceTracks
  emissionRate?: RenderEffectSequenceTracks
  lifeSpan?: RenderEffectSequenceTracks
  speed?: RenderEffectSequenceTracks
  pitch?: RenderEffectSequenceTracks
  yaw?: RenderEffectSequenceTracks
  spreadX?: RenderEffectSequenceTracks
  spreadY?: RenderEffectSequenceTracks
  maxLength?: RenderEffectSequenceTracks
  textureSlot?: RenderEffectSequenceTracks
  color?: RenderEffectSequenceTracks
  widthStart?: RenderEffectSequenceTracks
  widthMiddle?: RenderEffectSequenceTracks
  widthEnd?: RenderEffectSequenceTracks
  segmentColorStart?: RenderEffectSequenceTracks
  segmentColorMiddle?: RenderEffectSequenceTracks
  segmentColorEnd?: RenderEffectSequenceTracks
  segmentAlphaStart?: RenderEffectSequenceTracks
  segmentAlphaMiddle?: RenderEffectSequenceTracks
  segmentAlphaEnd?: RenderEffectSequenceTracks
}

export interface RenderParticleLifecycleSize {
  /** XYZ size at the three authored lifetime phases. */
  start: readonly [number, number, number]
  middle: readonly [number, number, number]
  end: readonly [number, number, number]
  /** Lifetime phase of `middle`, independent from the color midpoint. */
  timeMiddle: number
}

/** M3's deterministic lifetime modulation channels. Numeric shapes are kept for forward compatibility. */
export interface RenderEffectVariation {
  shape: 'none' | 'sine' | 'triangle' | 'square' | 'saw' | 'noise' | number
  amplitude: number
  frequency: number
  phase?: number
}

/** Screen-relative texture coordinates used by M3 particles such as impact and distortion effects. */
export interface RenderParticleScreenSpaceUv {
  threshold: number
  offset: readonly [number, number]
  angle: readonly [number, number, number]
  tiling: readonly [number, number]
}

/** One additional M3 spline-ribbon endpoint. */
export interface RenderRibbonSplineEndpointSequenceAnimation {
  velocity?: RenderEffectSequenceTracks
  velocityBaseFactor?: RenderEffectSequenceTracks
  velocityEndFactor?: RenderEffectSequenceTracks
  yaw?: RenderEffectSequenceTracks
  pitch?: RenderEffectSequenceTracks
}

export interface RenderRibbonSplineEndpoint {
  boneIndex: number
  emissionOffset: readonly [number, number, number]
  emissionVector: readonly [number, number, number]
  velocity: number
  velocityBaseFactor: number
  velocityEndFactor: number
  yaw: number
  pitch: number
  yawVariation?: RenderEffectVariation
  pitchVariation?: RenderEffectVariation
  velocityVariation?: RenderEffectVariation
  sequenceAnimation?: RenderRibbonSplineEndpointSequenceAnimation
}

/** Triangle geometry used as a particle emission surface without duplicating mesh buffers. */
export interface RenderParticleEmissionMesh {
  positions: Float32Array
  indices: Uint16Array | Uint32Array
}

export interface RenderParticleEmitter {
  name: string
  boneIndex: number
  materialIndex: number
  texturePath?: string
  width?: number
  length?: number
  alpha?: number
  visibility?: number
  squirt?: boolean
  /** Authored burst count (M3); MDX squirt continues to use emissionRate keys. */
  emitCount?: number
  emissionRate?: number
  lifeSpan?: number
  speed?: number
  speedRandom?: number
  randomizeSpeed?: boolean
  gravity?: number
  latitude?: number
  variation?: number
  lifeSpanRandom?: number
  randomizeLifeSpan?: boolean
  mass?: number
  massRandom?: number
  randomizeMass?: boolean
  tailLength?: number
  /**
   * M3 `tail_clamp`: a tail is never longer than the way its particle has travelled from where it
   * was born (Particle.fx CalculatePositionAndVelocity).
   */
  tailClamped?: boolean
  /** M3 `tail_fix`: the tail keeps `tailLength` whatever the particle's speed. */
  tailFixed?: boolean
  timeMiddle?: number
  rows?: number
  columns?: number
  filterMode?: number
  head?: boolean
  tail?: boolean
  lineEmitter?: boolean
  /** M3 particle instance/orientation mode. */
  orientationMode?:
    | 'billboard'
    | 'tail'
    | 'face-travel-direction'
    | 'face-world-direction'
    | 'single-axis'
    | 'terrain-oriented'
    | 'terrain-direction-oriented'
    | 'emitter-oriented'
    | 'physics-oriented'
    | 'pinned'
    | 'trail'
  /** M3 local/world force channel masks used to select FOR_ fields. */
  localForceChannels?: number
  worldForceChannels?: number
  feedbackLocalForceChannels?: number
  feedbackWorldForceChannels?: number
  worldForceMassMultiplier?: number
  noiseAmplitude?: number
  noiseFrequency?: number
  noiseCohesion?: number
  noiseEdge?: number
  windMultiplier?: number
  /** Source/runtime cap; the shared live simulator also applies its global budget. */
  maxParticles?: number
  /** Normalized name or source enum value (for example `point`, `sphere`, or `"2"`). */
  emitShape?: string
  emitShapeRadius?: number
  emitShapeSize?: readonly [number, number, number]
  /** Spline control-point defaults for M3 spline emission. */
  emitShapePoints?: readonly (readonly [number, number, number])[]
  /** Per-control-point SVC3 tracks for animated M3 spline emission. */
  emitShapePointSequenceAnimations?: readonly RenderEffectSequenceTracks[]
  /** One or more triangle surfaces for M3 mesh-region emission. */
  emitShapeMeshes?: readonly RenderParticleEmissionMesh[]
  /** Exclude the authored inner volume from plane/sphere/box/cylinder/disc emission. */
  emitShapeCutout?: boolean
  emitShapeCutoutRadius?: number
  emitShapeCutoutSize?: readonly [number, number, number]
  /** Initial pitch/yaw and random spreads in radians (M3-compatible convention). */
  emitAngleX?: number
  emitAngleY?: number
  emitSpreadX?: number
  emitSpreadY?: number
  /** Enable collision queries against host-provided terrain surfaces. */
  collideTerrain?: boolean
  /** Enable collision queries against host-provided object surfaces. */
  collideObjects?: boolean
  /** Collision normal restitution. Zero stops on impact; one is elastic. */
  bounce?: number
  /**
   * Cull a particle after this many impacts. Zero/undefined keeps it alive;
   * collision-linked child emitters are handled by the shared simulator.
   */
  maxCollisionEvents?: number
  /** Optional child emitter spawned when this particle collides. */
  collisionEmitterIndex?: number
  collisionEmitMin?: number
  collisionEmitMax?: number
  collisionEmitChance?: number
  collisionEmitEnergy?: number
  /** Optional projector emitted at an impact point. */
  collisionProjectorIndex?: number
  collisionProjectorChance?: number
  /** Optional ribbon emitter linked to v23+ M3 particle bounce events. */
  bounceRibbonEmitterIndex?: number
  bounceRibbonChance?: number
  /** Optional particle emitter sampled along each live particle path. */
  trailEmitterIndex?: number
  trailEmitChance?: number
  trailEmitRate?: number
  /** Collision tangent loss, interpreted as `1 - friction` retention. */
  friction?: number
  /** Linear drag coefficient; the shared simulator integrates it analytically. */
  drag?: number
  /**
   * Keep the emitter origin and axes attached to its bone even when
   * `modelSpace` selects local/model-space particle simulation. M3 emitters
   * use these as independent concepts; WC3 leaves this unset to preserve its
   * model-space pivot behavior.
   */
  boneAnchored?: boolean
  modelSpace?: boolean
  xyQuad?: boolean
  /** Full vector lifecycle size (M3); `particleScaling` remains the MDX scalar curve. */
  lifecycleSize?: RenderParticleLifecycleSize
  /** Alternate M3 start/middle/end size curve used for per-particle randomization. */
  lifecycleSizeRandom?: RenderParticleLifecycleSize
  randomizeSize?: boolean
  lifecycleRotation?: RenderParticleLifecycleSize
  lifecycleRotationRandom?: RenderParticleLifecycleSize
  randomizeRotation?: boolean
  rotationRelative?: boolean
  rotationAlwaysSet?: boolean
  /** Alternate color/alpha curve blended once per particle. */
  segmentColorsRandom?: readonly (readonly [number, number, number])[]
  segmentAlphasRandom?: readonly [number, number, number]
  randomizeColor?: boolean
  randomizeAlpha?: boolean
  pitchVariation?: RenderEffectVariation
  yawVariation?: RenderEffectVariation
  speedVariation?: RenderEffectVariation
  sizeVariation?: RenderEffectVariation
  alphaVariation?: RenderEffectVariation
  colorVariation?: RenderEffectVariation
  rotationVariation?: RenderEffectVariation
  spreadXVariation?: RenderEffectVariation
  spreadYVariation?: RenderEffectVariation
  parentVelocity?: number
  /** Nested model particle assets. Hosts may resolve these paths lazily. */
  modelPaths?: readonly string[]
  swapModelParticleYZ?: boolean
  screenSpaceUv?: RenderParticleScreenSpaceUv
  particleScaling?: readonly [number, number, number]
  segmentColors?: readonly (readonly [number, number, number])[]
  segmentAlphas?: readonly [number, number, number]
  lifeSpanUvAnim?: readonly [number, number, number]
  decayUvAnim?: readonly [number, number, number]
  tailUvAnim?: readonly [number, number, number]
  tailDecayUvAnim?: readonly [number, number, number]
  animation?: RenderParticleEmitterAnimation
  sequenceAnimation?: RenderParticleEmitterSequenceAnimation
}

export interface RenderRibbonEmitter {
  name: string
  boneIndex: number
  materialIndex: number
  texturePath?: string
  heightAbove?: number
  heightBelow?: number
  alpha?: number
  visibility?: number
  emissionRate?: number
  lifeSpan?: number
  lifeSpanRandom?: number
  randomizeLifeSpan?: boolean
  speed?: number
  speedRandom?: number
  randomizeSpeed?: boolean
  pitch?: number
  yaw?: number
  spreadX?: number
  spreadY?: number
  gravity?: readonly [number, number, number]
  drag?: number
  mass?: number
  massRandom?: number
  randomizeMass?: boolean
  localForceChannels?: number
  worldForceChannels?: number
  feedbackLocalForceChannels?: number
  feedbackWorldForceChannels?: number
  worldForceMassMultiplier?: number
  noiseAmplitude?: number
  noiseFrequency?: number
  noiseCohesion?: number
  noiseEdge?: number
  collideTerrain?: boolean
  collideObjects?: boolean
  friction?: number
  bounce?: number
  modelSpace?: boolean
  parentVelocity?: number
  rows?: number
  columns?: number
  textureSlot?: number
  color?: readonly [number, number, number]
  /** M3 start/middle/end width curve, expressed as complete ribbon widths. */
  widths?: readonly [number, number, number]
  widthTimeMiddle?: number
  segmentColors?: readonly (readonly [number, number, number])[]
  segmentAlphas?: readonly [number, number, number]
  colorTimeMiddle?: number
  /** M3 ribbon cross-section. Billboard/planar use two vertices per ring. */
  ribbonType?: 'billboard' | 'planar' | 'cylinder' | 'star'
  /** Polygon edges for cylinder/star cross-sections. Kept bounded by renderers. */
  sides?: number
  /** Inner/outer radius ratio for star cross-sections. */
  starRatio?: number
  /** Authored longitudinal subdivision hint (used by spline ribbons and editor tooling). */
  divisions?: number
  /** Maximum geometric chain length. `lengthAndTime` keeps the lifespan limit as well. */
  maxLength?: number
  lengthAndTime?: boolean
  emissionOffset?: readonly [number, number, number]
  emissionVector?: readonly [number, number, number]
  splineEndpoints?: readonly RenderRibbonSplineEndpoint[]
  pitchVariation?: RenderEffectVariation
  yawVariation?: RenderEffectVariation
  speedVariation?: RenderEffectVariation
  lengthVariation?: RenderEffectVariation
  scaleVariation?: RenderEffectVariation
  alphaVariation?: RenderEffectVariation
  animation?: RenderRibbonEmitterAnimation
  sequenceAnimation?: RenderRibbonEmitterSequenceAnimation
}

export interface RenderEffectForce {
  name: string
  boneIndex: number
  type: 'radial' | 'wind' | 'explosion'
  shape: 'sphere' | 'cylinder' | 'box' | 'hemisphere'
  channels: number
  strength: number
  width: number
  height: number
  length: number
  falloff?: boolean
  heightGradient?: boolean
  unbounded?: boolean
}

export interface RenderEffectWarp {
  name: string
  boneIndex: number
  warpType: number
  radius: number
  height: number
  strength: number
  angular: number
  axial: number
  radial: number
}

export interface RenderProjector {
  name: string
  boneIndex: number
  materialIndex: number
  projectionType: 'orthographic' | 'perspective'
  offset: readonly [number, number, number]
  pitch: number
  yaw: number
  roll: number
  fieldOfView: number
  aspectRatio: number
  near: number
  far: number
  boxOffsetZBottom: number
  boxOffsetZTop: number
  boxOffsetXLeft: number
  boxOffsetXRight: number
  boxOffsetYFront: number
  boxOffsetYBack: number
  falloff: number
  alphaInit: number
  alphaMid: number
  alphaEnd: number
  lifetimeAttack?: number
  lifetimeAttackTo?: number
  lifetimeHold?: number
  lifetimeHoldTo?: number
  lifetimeDecay?: number
  lifetimeDecayTo?: number
  attenuationDistance: number
  active: number
  layer: number
  flags: number
}

export interface RenderModelEffects {
  particles: RenderParticleEmitter[]
  ribbons: RenderRibbonEmitter[]
  forces?: RenderEffectForce[]
  warps?: RenderEffectWarp[]
  projectors?: RenderProjector[]
  /**
   * Unit of the keyframe times in every emitter `animation` and `sequenceAnimation` track
   * above. **Codecs should declare it.**
   *
   * Omitting it is not a neutral default: the two renderer backends disagree about what an
   * undeclared unit means — WebGL falls back to milliseconds, Three.js to seconds — because
   * that is what each already did for the sources it did not name. Normalising to one unit
   * here would have changed what one of them draws, so the fallbacks were left alone and the
   * disagreement is now visible in the data rather than encoded twice, in opposite
   * directions, as a test against the source format's name. Declaring the unit makes both
   * backends agree.
   */
  trackTimeUnit?: 'seconds' | 'milliseconds'
}

/** Collision primitive extracted from a model's authored physics metadata. */
export interface RenderCollisionShape {
  kind: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'convex-hull' | 'mesh'
  /** Bone whose current transform owns the local shape matrix. */
  boneIndex: number
  /** Column-major local transform, matching WebGL/Three.js Matrix4 storage. */
  matrix: readonly number[]
  /** Authored x/y/z sizes. Sphere uses x; capsule/cylinder use x radius and y length. */
  size: readonly [number, number, number]
  /** Optional local vertices for convex hull and mesh shapes. */
  vertices?: readonly (readonly [number, number, number])[]
  /** Effect collision channels accepted by this shape. Defaults to object collisions. */
  collisionMask?: number
}

export interface RenderModel {
  /** Provenance for display. Never branch on it — see {@link ModelFormat}. */
  format: ModelFormat
  meshes: RenderMesh[]
  skeleton: RenderSkeleton
  materials: RenderMaterial[]
  animations: RenderAnimation[]
  bounds: Bounds | null
  effects: RenderModelEffects
  collisionShapes?: readonly RenderCollisionShape[]
  metadata?: Record<string, unknown>
}

export interface ModelParseOptions {
  assetResolver?: AssetResolver
}

export interface ModelParser {
  readonly format: ModelFormat
  canParse(headerMagic: Uint8Array): boolean
  parse(
    bytes: Uint8Array,
    hint?: string,
    options?: ModelParseOptions,
  ): Promise<RenderModel> | RenderModel
}

export interface TextureDecoderResult {
  width: number
  height: number
  rgba: Uint8Array
}

export interface TextureDecoder {
  decode(bytes: Uint8Array, hint?: string): Promise<TextureDecoderResult> | TextureDecoderResult
}

export interface CascProvider {
  list(prefix: string): Promise<string[]>
  read(path: string): Promise<Uint8Array>
  has(path: string): Promise<boolean> | boolean
}

export interface ModelRenderer<TTarget = unknown> {
  readonly id: string
  render(model: RenderModel, target: TTarget): Promise<void> | void
  dispose?(): void
}
