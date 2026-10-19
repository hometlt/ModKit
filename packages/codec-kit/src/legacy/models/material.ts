import type { RenderScalarAnimationTrack } from '../../legacy-model-support.js'

// P4 material model (docs/tasks-active/model-renderer/subtasks/OPUS_TASK_P4_M3_MATERIALS.md, D1).
// Layer op values follow mdx-m3-viewer combineLayerColor:
// 0 MOD, 1 MOD2X, 2 ADD, 3 LERP, 4/5 TEAMCOLOR_*_ADD, 6 ADD_NO_ALPHA.
export type LayerColorOp = 0 | 1 | 2 | 3 | 4 | 5 | 6

// 0 RGB (alpha forced 1), 1 RGBA, 2 AAAA, 3 RRRR, 4 GGGG, 5 BBBB.
export type LayerChannelSelect = 0 | 1 | 2 | 3 | 4 | 5

export type NormalMapFormat = 'dxt5nm' | 'bc5' | 'rgb8' | 'luminance-alpha'

export type RenderTextureChannel = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function isRenderTextureChannel(value: unknown): value is RenderTextureChannel {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

export type StandardLayerSlot =
  | 'diffuse'
  /**
   * A stack over `diffuse`: each `diffuseN` (N 2..5) mixed over the colour by channel N − 2 (r, g,
   * b, a) of `diffuseWeights`, in order — Diablo III's multi-layer ground,
   * lerp(lerp(lerp(lerp(L1, L2, w.r), L3, w.g), L4, w.b), L5, w.a).
   */
  | 'diffuse2'
  | 'diffuse3'
  | 'diffuse4'
  | 'diffuse5'
  | 'diffuseWeights'
  | 'decal'
  | 'specular'
  | 'gloss'
  | 'emissive1'
  | 'emissive2'
  | 'emissiveMask'
  | 'envi'
  | 'enviMask'
  | 'alpha1'
  | 'alpha2'
  | 'normal'
  | 'normalBlend1Mask'
  | 'normalBlend2Mask'
  | 'normalBlend1'
  | 'normalBlend2'
  | 'height'
  | 'lightMap'
  | 'ao'
  /** Renderer-neutral red-channel mask for post-light team-colour grain merge. */
  | 'teamColorMask'
  /** The `pbr-metallic-roughness` lighting model's metalness and roughness, by the layer's channel. */
  | 'metalness'
  | 'roughness'

/** A sparse material-property track for one RenderModel animation index. */
export interface SequenceIndexedAnimationTrack {
  sequenceIndex: number
  track: RenderScalarAnimationTrack
  /** M3 concurrent STCs use their independent SD timeline. */
  concurrent?: boolean
  /** Independent concurrent-track duration, in seconds. */
  wrapSeconds?: number
}

export interface AnimatedValueTracks {
  /** Legacy/global single-track representation retained for compatibility. */
  track?: RenderScalarAnimationTrack
  /** Sparse per-sequence tracks; an absent sequence uses the static value. */
  sequenceTracks?: readonly SequenceIndexedAnimationTrack[]
}

// Animatable value convention (P4 D2): static value plus optional playback tracks.
export interface AnimatedScalar extends AnimatedValueTracks {
  value: number
}

export interface AnimatedVec2 extends AnimatedValueTracks {
  value: readonly [number, number]
}

/** Three-component authored value (for example M3 LAYR.uv_angle Euler radians). */
export interface AnimatedVec3 extends AnimatedValueTracks {
  value: readonly [number, number, number]
}

export interface AnimatedColor extends AnimatedValueTracks {
  value: readonly [number, number, number, number]
}

const ANIMATED_TRACK_INDEX_CACHE = new WeakMap<
  readonly SequenceIndexedAnimationTrack[],
  ReadonlyMap<number, SequenceIndexedAnimationTrack>
>()

/** Find the authored track for a RenderModel animation index, if any. */
export function animatedTrackForSequence(
  value: AnimatedValueTracks,
  sequenceIndex: number,
): SequenceIndexedAnimationTrack | undefined {
  const sequenceTracks = value.sequenceTracks
  // Map uses SameValueZero while the previous Array.find lookup used strict
  // equality, so retain the legacy NaN lookup result even for malformed input.
  if (!sequenceTracks || Number.isNaN(sequenceIndex)) return undefined

  let tracksBySequence = ANIMATED_TRACK_INDEX_CACHE.get(sequenceTracks)
  if (!tracksBySequence) {
    const index = new Map<number, SequenceIndexedAnimationTrack>()
    for (const entry of sequenceTracks) {
      // Map treats NaN as equal to itself; Array.find did not.
      if (Number.isNaN(entry.sequenceIndex) || index.has(entry.sequenceIndex)) continue
      index.set(entry.sequenceIndex, entry)
    }
    tracksBySequence = index
    ANIMATED_TRACK_INDEX_CACHE.set(sequenceTracks, tracksBySequence)
  }
  return tracksBySequence.get(sequenceIndex)
}

export interface StandardMaterialLayer {
  slot: StandardLayerSlot
  /** null → constant color layer (LAYR flags & 0x400 use color_value). */
  texturePath: string | null
  /** Frame-local render target sampled by this layer; independent of uvSource and material masks. */
  renderTextureChannel?: RenderTextureChannel
  constantColor?: AnimatedColor
  /** Raw LAYR.uv_source value; renderers map per the P4 table 1.4. */
  uvSource: number
  channels: LayerChannelSelect
  /** Slot default 2 (ADD); emissive1/2 come from MAT_.blend_mode_emis1/2. */
  op: LayerColorOp
  teamColorMode: 0 | 1 | 2
  invert: boolean
  clampResult: boolean
  wrapX: boolean
  wrapY: boolean
  colorMultiply?: AnimatedScalar
  colorAdd?: AnimatedScalar
  /** LAYR.color_brightness / game map-alpha factor; scales the selected layer alpha. */
  alphaFactor?: AnimatedScalar
  /** Static LAYR Fresnel modulation applied after color operations and clamping. */
  fresnel?: StandardLayerFresnel
  /**
   * The texture is read at coordinates of the view and light angles, in place of the uv source: a
   * ramp by how edge-on the surface is, or a lighting table (StandardLayerAngleLookup).
   */
  angleLookup?: StandardLayerAngleLookup
  uvOffset?: AnimatedVec2
  /** M3 stores this as a Vector3 animation reference, not a scalar/vec2 angle. */
  uvAngle?: AnimatedVec3
  uvTiling?: AnimatedVec2
  /** Axis-specific offset used by M3 triplanar UV sources 16-18. */
  uvTriplanarOffset?: AnimatedVec3
  /** Axis-specific scale used by M3 triplanar UV sources 16-18. */
  uvTriplanarScale?: AnimatedVec3
  flipbook?: {
    rows: number
    cols: number
    frame: AnimatedScalar
    /** Optional atlas stride. When present, frame selection offsets authored UVs without scaling them. */
    frameSize?: readonly [number, number]
  }
}

export interface StandardLayerFresnel {
  mode: 1 | 2
  exponent: number
  min: number
  /** Stored scale term; authored maximum is min + maxOffset. */
  maxOffset: number
  /** 0=none, 1=transformed, 2=transformed+normalized (LAYR flags 0x4000/0x8000). */
  transformMode: 0 | 1 | 2
  localTransform: boolean
  doNotMirror: boolean
  /** Raw v25+ transform components retained for editors and future matrix parity. */
  translation: readonly [number, number, number]
  invertMask: readonly [number, number, number]
  rotation: readonly [number, number]
}

/**
 * Texture coordinates from angles at the surface, on its geometric normal, cosines clamped to 0..1:
 * u is `edge`, (1 − |N·V|) to `exponent` (default 1), or `reflection`, R·V with R the light
 * reflected about N; v is the fixed `row` or `light`, N·L. Supreme Commander's Seraphim ramp is
 * { u: 'edge', exponent: 0.6, v: 'row' }, its Cybran and Metal tables { u: 'reflection', v: 'light' }.
 * The layer's uv transform still applies.
 */
export interface StandardLayerAngleLookup {
  u: 'edge' | 'reflection'
  v: 'row' | 'light'
  exponent?: number
  row?: number
}

export interface StandardMaterialModel {
  layers: Partial<Record<StandardLayerSlot, StandardMaterialLayer>>
  /** Raw MAT_.flags, retained so renderers can honor flags not yet normalized below. */
  sourceFlags?: number
  /** Raw MAT_.additional_flags (derived vertex color/alpha and depth-blend flags). */
  sourceAdditionalFlags?: number
  /** Raw MAT_.material_class (unit/building/doodad/special-FX). */
  materialClass?: number
  /** Raw MAT_.blend_mode; renderers map per the P4 table 1.10. */
  blendMode: number
  priority: number
  specularity: number
  specMult: number
  emisMult: number
  /** MAT_ v20 environment constant/diffuse/specular multipliers. */
  environmentMultipliers?: readonly [number, number, number]
  /**
   * The environment is multiplied by the base colour (diffuse and decal) before its layer op: with
   * op 2 the reflection tints by the surface, `base × env × mask × k` added (Supreme Commander's
   * metal; k is the constant multiplier). Absent: the environment as sampled.
   */
  environmentTintByBase?: boolean
  /**
   * The team colour mask (layer `teamColorMask`) mixes the base colour toward the team colour
   * before light, as Warcraft III Reforged's HD shader does with its ORM alpha: the hue moves by
   * sqrt(mask), the brightness toward min(max(base), max(team)) by 0.95·mask². Absent: StarCraft II's
   * grain merge after light, `final += (team − 0.5) × mask`.
   */
  teamColorMaskMix?: boolean
  /**
   * The team colour mask (layer `teamColorMask`, its channel-selected red) colours the base colour
   * before light by the one formula of `UV_game_material_team_color` (codec-kit `teamColorChannel`):
   * `multiply`, `add`, `replace`, `overlay` or `lerp`, weighed by `teamColorStrength` (default 1).
   * It replaces both other readings of the mask; not with `teamColorMaskMix`.
   */
  teamColorBlend?: 'multiply' | 'add' | 'replace' | 'overlay' | 'lerp'
  teamColorStrength?: number
  /**
   * The emissive layers take the team colour by the same mask and formula as the base, before
   * their colour enters the light (BAR adds its team-coloured albedo as the glow). Without
   * `teamColorBlend` it has nothing to read and changes nothing.
   */
  teamColorEmissive?: boolean
  /** The team colour drawn when the frame names none (`UV_game_material_team_color.defaultColor`). */
  teamColorDefault?: [number, number, number]
  /**
   * Fade at grazing angles: smoothstep(0, edgeFadeOut, |N·V|) on the geometric normal multiplies an
   * additive material's colour (its fade) and any other material's alpha (Kane's Wrath DefaultW3D
   * `EdgeFadeOut`). A layer's fresnel cannot state it: its curve is a power, and it scales the layer.
   */
  edgeFadeOut?: number
  /** RGB multiplier applied to accumulated emissive light. Defaults to white. */
  emissiveTint?: readonly [number, number, number]
  /** Signed parallax displacement applied when the height layer is active. */
  parallaxHeight?: AnimatedScalar
  /** Eight animated RGBA channel weights from MAT_.normal_blend_mask_factor (SR32). */
  normalBlendFactors?: readonly [
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
    AnimatedScalar,
  ]
  specMode: 0 | 1
  /** Already divided by 255; 0 = alpha test off. */
  alphaTestThreshold: number
  twoSided: boolean
  unshaded: boolean
  /** MAT_ depth-prepass flag: fill depth before rendering a translucent color pass. */
  depthPrepass?: boolean
  doubleLambert: boolean
  clampOutput: boolean
  usesVertexColor: boolean
  usesVertexAlpha: boolean
  /**
   * StarCraft II's FakeEnergyConservingSpec (psmaterial.fx): the specular dims by a polynomial of
   * its exponent, so broad highlights stay dim and tight ones keep their energy. M3 materials have
   * it unless they set SimulateRoughness; absent means no dim.
   */
  specularEnergyConservation?: boolean
  /** Filled by the texture pipeline at bind time. */
  normalMapFormat?: NormalMapFormat
  /** Coordinate space of the decoded primary normal layer. Tangent remains the default. */
  normalMapSpace?: 'tangent' | 'object'
  /** Column-major mapping from decoded RGB axes into the authored object frame. */
  normalMapTransform?: readonly [number, number, number, number, number, number, number, number, number]
  /**
   * `m3` (the default): StarCraft II's lighting. `pbr-metallic-roughness`: the glTF BRDF of
   * codec-kit model-math/pbr over the composed base colour, metallic `metallicFactor` × the
   * `metalness` layer and roughness `roughnessFactor` × the `roughness` layer (each 0..1, default 1).
   */
  lightingModel?: 'm3' | 'pbr-metallic-roughness'
  metallicFactor?: number
  roughnessFactor?: number
  /**
   * `m3` (the default): colours as stored. `linear-srgb` (pbr only): textures are sRGB, light is
   * summed linear, then `tonemap` (a curve, else a clamp) and sRGB again.
   */
  colorPipeline?: 'm3' | 'linear-srgb'
  tonemap?: readonly [number, number, number, number, number]
}

export interface CompositeMaterialModel {
  passes: { material: StandardMaterialModel; alphaFactor: AnimatedScalar }[]
  priority: number
}

export interface MaterialValidationIssue {
  code: string
  message: string
}

const LAYER_SLOTS: readonly StandardLayerSlot[] = [
  'diffuse',
  'diffuse2',
  'diffuse3',
  'diffuse4',
  'diffuse5',
  'diffuseWeights',
  'decal',
  'specular',
  'gloss',
  'emissive1',
  'emissive2',
  'emissiveMask',
  'envi',
  'enviMask',
  'alpha1',
  'alpha2',
  'normal',
  'normalBlend1Mask',
  'normalBlend2Mask',
  'normalBlend1',
  'normalBlend2',
  'height',
  'lightMap',
  'ao',
  'teamColorMask',
  'metalness',
  'roughness',
]

export function isStandardLayerSlot(value: string): value is StandardLayerSlot {
  return (LAYER_SLOTS as readonly string[]).includes(value)
}

function validateAnimatedSequenceTracks(
  value: AnimatedValueTracks | undefined,
  property: string,
  vectorLength: number,
): MaterialValidationIssue[] {
  const issues: MaterialValidationIssue[] = []
  const sequenceTracks = value?.sequenceTracks
  if (!sequenceTracks) return issues

  const seenSequenceIndices = new Set<number>()
  for (let trackIndex = 0; trackIndex < sequenceTracks.length; trackIndex += 1) {
    const sequenceTrack = sequenceTracks[trackIndex]
    if (!sequenceTrack) continue

    const sequenceIndex = sequenceTrack.sequenceIndex
    if (!Number.isInteger(sequenceIndex) || sequenceIndex < 0) {
      issues.push({
        code: 'material-track-sequence-index-invalid',
        message: `${property} sequenceTracks[${trackIndex}] sequenceIndex must be a non-negative integer, got ${sequenceIndex}`,
      })
    }
    if (seenSequenceIndices.has(sequenceIndex)) {
      issues.push({
        code: 'material-track-sequence-index-duplicate',
        message: `${property} has multiple tracks for sequenceIndex ${sequenceIndex}`,
      })
    }
    seenSequenceIndices.add(sequenceIndex)

    const wrapSeconds = sequenceTrack.wrapSeconds
    if (
      sequenceTrack.concurrent &&
      (typeof wrapSeconds !== 'number' || !Number.isFinite(wrapSeconds) || wrapSeconds <= 0)
    ) {
      issues.push({
        code: 'material-track-concurrent-wrap-invalid',
        message: `${property} sequence ${sequenceIndex} concurrent track needs finite wrapSeconds > 0`,
      })
    }

    const keys = sequenceTrack.track?.keys
    if (!keys || keys.length === 0) {
      issues.push({
        code: 'material-track-keys-empty',
        message: `${property} sequence ${sequenceIndex} track must have at least one key`,
      })
      continue
    }

    let previousFrame = Number.NEGATIVE_INFINITY
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex]
      if (!key) continue
      if (!Number.isFinite(key.frame)) {
        issues.push({
          code: 'material-track-key-frame-invalid',
          message: `${property} sequence ${sequenceIndex} key ${keyIndex} frame must be finite, got ${key.frame}`,
        })
      } else if (key.frame < previousFrame) {
        issues.push({
          code: 'material-track-key-frame-order-invalid',
          message: `${property} sequence ${sequenceIndex} key frames must be in ascending order`,
        })
      } else {
        previousFrame = key.frame
      }

      const vector = key.vector
      if (
        !vector ||
        vector.length !== vectorLength ||
        vector.some(component => !Number.isFinite(component))
      ) {
        issues.push({
          code: 'material-track-key-vector-invalid',
          message: `${property} sequence ${sequenceIndex} key ${keyIndex} vector must contain exactly ${vectorLength} finite value${vectorLength === 1 ? '' : 's'}`,
        })
      }
    }
  }
  return issues
}

export function validateStandardMaterial(
  material: StandardMaterialModel,
): MaterialValidationIssue[] {
  const issues: MaterialValidationIssue[] = []
  if (material.alphaTestThreshold < 0 || material.alphaTestThreshold > 1) {
    issues.push({
      code: 'alpha-test-threshold-out-of-range',
      message: `alphaTestThreshold must be within [0, 1], got ${material.alphaTestThreshold}`,
    })
  }
  if (!Number.isInteger(material.blendMode) || material.blendMode < 0) {
    issues.push({
      code: 'blend-mode-invalid',
      message: `blendMode must be a non-negative integer, got ${material.blendMode}`,
    })
  }
  issues.push(
    ...validateAnimatedSequenceTracks(material.parallaxHeight, 'material parallaxHeight', 1),
  )
  for (const [index, factor] of (material.normalBlendFactors ?? []).entries()) {
    issues.push(
      ...validateAnimatedSequenceTracks(factor, `material normalBlendFactors[${index}]`, 1),
    )
  }
  for (const [slotKey, layer] of Object.entries(material.layers)) {
    if (!layer) continue
    if (!isStandardLayerSlot(slotKey) || layer.slot !== slotKey) {
      issues.push({
        code: 'layer-slot-mismatch',
        message: `layer stored under "${slotKey}" declares slot "${layer.slot}"`,
      })
    }
    if (layer.op < 0 || layer.op > 6) {
      issues.push({
        code: 'layer-op-out-of-range',
        message: `layer "${slotKey}" op must be 0-6, got ${layer.op}`,
      })
    }
    if (layer.channels < 0 || layer.channels > 5) {
      issues.push({
        code: 'layer-channels-out-of-range',
        message: `layer "${slotKey}" channels must be 0-5, got ${layer.channels}`,
      })
    }
    if (layer.renderTextureChannel !== undefined && !isRenderTextureChannel(layer.renderTextureChannel)) {
      issues.push({
        code: 'layer-render-texture-channel-out-of-range',
        message: `layer "${slotKey}" renderTextureChannel must be an integer in 0-6`,
      })
    }
    if (layer.texturePath === null && !layer.constantColor && layer.renderTextureChannel === undefined) {
      issues.push({
        code: 'layer-missing-source',
        message: `layer "${slotKey}" has neither a texture path nor a constant color`,
      })
    }
    const animatedProperties: readonly [string, AnimatedValueTracks | undefined, number][] = [
      ['constantColor', layer.constantColor, 4],
      ['colorMultiply', layer.colorMultiply, 1],
      ['colorAdd', layer.colorAdd, 1],
      ['alphaFactor', layer.alphaFactor, 1],
      ['uvOffset', layer.uvOffset, 2],
      ['uvAngle', layer.uvAngle, 3],
      ['uvTiling', layer.uvTiling, 2],
      ['uvTriplanarOffset', layer.uvTriplanarOffset, 3],
      ['uvTriplanarScale', layer.uvTriplanarScale, 3],
      ['flipbook.frame', layer.flipbook?.frame, 1],
    ]
    for (const [property, value, vectorLength] of animatedProperties) {
      issues.push(
        ...validateAnimatedSequenceTracks(value, `layer "${slotKey}" ${property}`, vectorLength),
      )
    }
  }
  return issues
}

export function validateCompositeMaterial(
  material: CompositeMaterialModel,
): MaterialValidationIssue[] {
  const issues: MaterialValidationIssue[] = []
  if (material.passes.length === 0) {
    issues.push({ code: 'composite-empty', message: 'composite material has no passes' })
  }
  for (let i = 0; i < material.passes.length; i += 1) {
    const pass = material.passes[i]
    if (!pass) continue
    for (const issue of validateStandardMaterial(pass.material)) {
      issues.push({ code: issue.code, message: `pass ${i}: ${issue.message}` })
    }
    for (const issue of validateAnimatedSequenceTracks(pass.alphaFactor, 'alphaFactor', 1)) {
      issues.push({ code: issue.code, message: `pass ${i}: ${issue.message}` })
    }
  }
  return issues
}
