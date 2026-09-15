import type {
  LayerChannelSelect,
  LayerColorOp,
  NormalMapFormat,
  StandardLayerFresnel,
  StandardLayerSlot,
  StandardMaterialModel,
} from '../legacy/models/material.js'

/**
 * P4-S4 — shared SC2 standard-material shader builder + CPU mirror
 * (OPUS_TASK_P4_M3_MATERIALS.md D3/D4).
 *
 * One string-only GLSL source builder consumed by BOTH renderer backends
 * (Three wraps the sources in a ShaderMaterial, model-webgl compiles its own
 * program), plus a TypeScript mirror of the exact same layer math for the CPU
 * pixel oracle. GLSL and TS live side by side in this module so they cannot
 * drift silently — the spec tables (1.4–1.9) and mdx-m3-viewer's
 * layers.glsl.ts / standard.frag.ts are the ported ground truth; math is kept
 * identical, uniform names are modernized.
 *
 * Disabled layers are stripped at build time (D5): every enabled layer costs
 * exactly one sampler; ops/channels/flags are baked as compile-time constants
 * so the program cache can key on `canonicalDefineKey`.
 */

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]
export type Vec4 = readonly [number, number, number, number]

/** All SC2 standard-material layers consumed by the shared fragment composition. */
export const FRAGMENT_LAYER_SLOTS: readonly StandardLayerSlot[] = [
  'diffuse',
  'decal',
  'specular',
  'gloss',
  'emissive1',
  'emissive2',
  'emissiveMask',
  'envi',
  'enviMask',
  'normal',
  'normalBlend1Mask',
  'normalBlend2Mask',
  'normalBlend1',
  'normalBlend2',
  'height',
  'lightMap',
  'ao',
  'teamColorMask',
  'alpha1',
  'alpha2',
]

export interface StandardLayerDefines {
  slot: StandardLayerSlot
  /** false → constant-color layer (LAYR flags 0x400); no sampler is emitted. */
  hasTexture: boolean
  /** Raw LAYR.uv_source (table 1.4). All known values 0-18 have dedicated shader paths. */
  uvSource: number
  channels: LayerChannelSelect
  op: LayerColorOp
  teamColorMode: 0 | 1 | 2
  invert: boolean
  clampResult: boolean
  /** color_multiply / color_add / map-alpha constants enabled (1.7). */
  hasColorMultiply: boolean
  hasColorAdd: boolean
  hasAlphaFactor: boolean
  fresnel?: StandardLayerFresnel
  /** uv offset/tiling uniforms emitted (animated by P5-S9). */
  hasUvTransform: boolean
}

export interface StandardMaterialDefines {
  /** Enabled fragment layers only, in FRAGMENT_LAYER_SLOTS order. */
  layers: StandardLayerDefines[]
  normalMapFormat: NormalMapFormat
  normalMapSpace: 'tangent' | 'object'
  specMode: 0 | 1
  unshaded: boolean
  doubleLambert: boolean
  clampOutput: boolean
  usesVertexColor: boolean
  usesVertexAlpha: boolean
  /** alpha_test_threshold > 0 — fragment emits the discard. */
  alphaTest: boolean
  /** Highest explicit uv set any layer reads (0..3) — drives vertex attributes/varyings. */
  uvSetCount: 1 | 2 | 3 | 4
  /** Vertex-texture matrix palette path used by the raw WebGL renderer. */
  gpuSkinning?: boolean
  /** Per-instance clip matrices supplied as four divisor attributes. */
  hardwareInstancing?: boolean
  /**
   * Baked-pose crowd path (P10): the bone texture holds every sequence frame
   * as rows; per-instance divisor attributes select two rows to blend and a
   * per-instance team color. Requires gpuSkinning + hardwareInstancing.
   */
  bakedPoseInstancing?: boolean
  /**
   * World scene lighting: diffuse × (ambient color + light color × lambert) and emissive on every
   * face. The default viewer model adds a constant ambient and assumes a camera headlight.
   */
  sceneLighting?: boolean
}

const TEXTURE_FALLBACK_PRIORITY: readonly StandardLayerSlot[] = [
  'diffuse',
  'alpha1',
  'alpha2',
  'normal',
  'normalBlend1',
  'normalBlend2',
  'normalBlend1Mask',
  'normalBlend2Mask',
  'emissive1',
  'emissive2',
  'emissiveMask',
  'specular',
  'gloss',
  'decal',
  'lightMap',
  'ao',
  'envi',
  'enviMask',
  'height',
  'teamColorMask',
]

/** UV source → explicit uv set index, or 'sphere' for the spherical-env sources (1.4). */
type UvSourceKind =
  | { kind: 'explicit'; set: 0 | 1 | 2 | 3 }
  | { kind: 'reflectCube' | 'reflectSphere' | 'cube' | 'sphere' }
  | { kind: 'planarLocal' | 'planarWorld'; axis: 0 | 1 | 2 }
  | {
      kind: 'particle' | 'screen' | 'triplanarLocal' | 'triplanarWorld' | 'triplanarWorldLocalZ'
    }
  | { kind: 'unknown' | 'approximated' }

function uvSourceKind(uvSource: number): UvSourceKind {
  if (uvSource === 0) return { kind: 'explicit', set: 0 }
  if (uvSource === 1) return { kind: 'explicit', set: 1 }
  if (uvSource === 2) return { kind: 'reflectCube' }
  if (uvSource === 3) return { kind: 'reflectSphere' }
  if (uvSource === 4) return { kind: 'planarLocal', axis: 2 }
  if (uvSource === 5) return { kind: 'planarWorld', axis: 2 }
  if (uvSource === 6) return { kind: 'particle' }
  if (uvSource === 7) return { kind: 'cube' }
  if (uvSource === 8) return { kind: 'sphere' }
  if (uvSource === 9) return { kind: 'explicit', set: 2 }
  if (uvSource === 10) return { kind: 'explicit', set: 3 }
  if (uvSource === 11) return { kind: 'planarLocal', axis: 0 }
  if (uvSource === 12) return { kind: 'planarLocal', axis: 1 }
  if (uvSource === 13) return { kind: 'planarWorld', axis: 0 }
  if (uvSource === 14) return { kind: 'planarWorld', axis: 1 }
  if (uvSource === 15) return { kind: 'screen' }
  if (uvSource === 16) return { kind: 'triplanarLocal' }
  if (uvSource === 17) return { kind: 'triplanarWorld' }
  if (uvSource === 18) return { kind: 'triplanarWorldLocalZ' }
  return { kind: 'approximated' } // Unknown future values retain a safe uv0 fallback.
}

/** Build defines from a converted material; the renderer decides normalMapFormat at texture-bind time. */
export function buildMaterialDefines(
  material: StandardMaterialModel,
  options: {
    normalMapFormat?: NormalMapFormat
    maxTextureSamplers?: number
    gpuSkinning?: boolean
    hardwareInstancing?: boolean
    bakedPoseInstancing?: boolean
    sceneLighting?: boolean
  } = {},
): StandardMaterialDefines {
  const layers: StandardLayerDefines[] = []
  const textureBudget = Number.isFinite(options.maxTextureSamplers)
    ? Math.max(0, Math.floor(options.maxTextureSamplers ?? 0))
    : Number.POSITIVE_INFINITY
  const texturedSlots = new Set(
    TEXTURE_FALLBACK_PRIORITY.filter(slot => material.layers[slot]?.texturePath != null).slice(
      0,
      textureBudget,
    ),
  )
  let maxUvSet = 0
  for (const slot of FRAGMENT_LAYER_SLOTS) {
    const layer = material.layers[slot]
    if (!layer) continue
    const source = uvSourceKind(layer.uvSource)
    if (source.kind === 'explicit') maxUvSet = Math.max(maxUvSet, source.set)
    layers.push({
      slot,
      hasTexture: layer.texturePath !== null && texturedSlots.has(slot),
      uvSource: layer.uvSource,
      channels: layer.channels,
      op: layer.op,
      teamColorMode: layer.teamColorMode,
      invert: layer.invert,
      clampResult: layer.clampResult,
      hasColorMultiply: layer.colorMultiply !== undefined,
      hasColorAdd: layer.colorAdd !== undefined,
      hasAlphaFactor: layer.alphaFactor !== undefined,
      ...(layer.fresnel ? { fresnel: layer.fresnel } : {}),
      hasUvTransform:
        layer.uvOffset !== undefined ||
        layer.uvAngle !== undefined ||
        layer.uvTiling !== undefined ||
        layer.uvTriplanarOffset !== undefined ||
        layer.uvTriplanarScale !== undefined ||
        layer.flipbook !== undefined,
    })
  }
  return {
    layers,
    normalMapFormat: options.normalMapFormat ?? material.normalMapFormat ?? 'dxt5nm',
    normalMapSpace: material.normalMapSpace ?? 'tangent',
    specMode: material.specMode,
    unshaded: material.unshaded,
    doubleLambert: material.doubleLambert,
    clampOutput: material.clampOutput,
    usesVertexColor: material.usesVertexColor,
    usesVertexAlpha: material.usesVertexAlpha,
    alphaTest: material.alphaTestThreshold > 0,
    uvSetCount: (maxUvSet + 1) as 1 | 2 | 3 | 4,
    ...(options.gpuSkinning === true ? { gpuSkinning: true } : {}),
    ...(options.hardwareInstancing === true ? { hardwareInstancing: true } : {}),
    ...(options.bakedPoseInstancing === true &&
    options.gpuSkinning === true &&
    options.hardwareInstancing === true
      ? { bakedPoseInstancing: true }
      : {}),
    ...(options.sceneLighting === true ? { sceneLighting: true } : {}),
  }
}

/** Canonical program-cache key: every compile-time constant, order-stable. */
export function canonicalDefineKey(defines: StandardMaterialDefines): string {
  const layerKeys = defines.layers
    .map(
      layer =>
        `${layer.slot}:${layer.hasTexture ? 't' : 'c'}${layer.uvSource}.${layer.channels}.${layer.op}.${layer.teamColorMode}` +
        `${layer.invert ? 'i' : ''}${layer.clampResult ? 'k' : ''}${layer.hasColorMultiply ? 'm' : ''}` +
        `${layer.hasColorAdd ? 'a' : ''}${layer.hasAlphaFactor ? 'f' : ''}${layer.hasUvTransform ? 'u' : ''}` +
        `${layer.fresnel ? `;fr=${layer.fresnel.mode},${layer.fresnel.exponent},${layer.fresnel.min},${layer.fresnel.maxOffset},${layer.fresnel.transformMode},${layer.fresnel.localTransform ? 1 : 0},${layer.fresnel.doNotMirror ? 1 : 0},${layer.fresnel.translation.join(',')},${layer.fresnel.invertMask.join(',')},${layer.fresnel.rotation.join(',')}` : ''}`,
    )
    .join('|')
  return (
    `layers[${layerKeys}]` +
    `;n=${defines.normalMapFormat}.${defines.normalMapSpace};spec=${defines.specMode}` +
    `;${defines.unshaded ? 'U' : ''}${defines.doubleLambert ? 'D' : ''}${defines.clampOutput ? 'C' : ''}` +
    `${defines.usesVertexColor ? 'vc' : ''}${defines.usesVertexAlpha ? 'va' : ''}${defines.alphaTest ? 'at' : ''}` +
    `;uv=${defines.uvSetCount};${defines.gpuSkinning ? 'skin' : ''}${defines.hardwareInstancing ? 'inst' : ''}${defines.bakedPoseInstancing ? 'baked' : ''}` +
    `${defines.sceneLighting ? ';scene' : ''}`
  )
}

// ── Blend table (1.10) ────────────────────────────────────────────────────────

export type StandardBlendName =
  'opaque' | 'alpha-test' | 'blend' | 'premultiplied' | 'additive' | 'add-alpha' | 'modulate' | 'modulate2x'

/**
 * MAT_.blend_mode → render-state name. Names match `WebGlBlendMode` in
 * @modkitx/rendering-3d/webgl; Three maps them onto its blending constants.
 * Depth-write off for all blended modes; `two_sided` → cull off; draw order:
 * opaque/alpha-test first, then blended by priority.
 */
export function standardBlendModeName(
  blendMode: number,
  alphaTestThreshold: number,
): StandardBlendName {
  switch (blendMode) {
    case 1:
      return 'blend'
    case 2:
      return 'additive'
    case 3:
      return 'add-alpha'
    case 4:
      return 'modulate'
    case 5:
      return 'modulate2x'
    case 6:
      return 'premultiplied'
    default:
      return alphaTestThreshold > 0 ? 'alpha-test' : 'opaque'
  }
}

// ── CPU mirror (D4) — the exact layer math as TypeScript ─────────────────────

/** chooseChannel (1.5, layers.glsl.ts): 0 RGB(alpha→1), 1 RGBA, 2 AAAA, 3 RRRR, 4 GGGG, 5 BBBB. */
export function chooseChannelCpu(
  channels: LayerChannelSelect,
  texel: Vec4,
): [number, number, number, number] {
  switch (channels) {
    case 2:
      return [texel[3], texel[3], texel[3], texel[3]]
    case 3:
      return [texel[0], texel[0], texel[0], texel[0]]
    case 4:
      return [texel[1], texel[1], texel[1], texel[1]]
    case 5:
      return [texel[2], texel[2], texel[2], texel[2]]
    case 0:
      return [texel[0], texel[1], texel[2], 1]
    default:
      return [texel[0], texel[1], texel[2], texel[3]]
  }
}

export interface CpuLayerSample {
  /** Sampled texel, or the constant color for textureless layers. Components 0..1. */
  texel: Vec4
  channels: LayerChannelSelect
  op: LayerColorOp
  teamColorMode: 0 | 1 | 2
  invert: boolean
  clampResult: boolean
  colorMultiply?: number
  colorAdd?: number
  alphaFactor?: number
  fresnel?: StandardLayerFresnel
}

/**
 * Per-layer color pipeline (1.7) — order matters:
 * channel select → team color (uses the RAW texel alpha) → invert → ×multiply
 * → +add → ×alpha → clamp.
 */
export function computeLayerColorCpu(
  sample: CpuLayerSample,
  teamColor: Vec3,
  viewNormal: Vec3 = [0, 0, 1],
  eyeToVertex: Vec3 = [0, 0, -1],
): [number, number, number, number] {
  const texel = sample.texel
  let c = chooseChannelCpu(sample.channels, texel)
  if (sample.teamColorMode === 1 || sample.teamColorMode === 2) {
    c = [
      teamColor[0] + (c[0] - teamColor[0]) * texel[3],
      teamColor[1] + (c[1] - teamColor[1]) * texel[3],
      teamColor[2] + (c[2] - teamColor[2]) * texel[3],
      1,
    ]
  }
  if (sample.invert) c = [1 - c[0], 1 - c[1], 1 - c[2], 1 - c[3]]
  if (sample.colorMultiply !== undefined) {
    c = [
      c[0] * sample.colorMultiply,
      c[1] * sample.colorMultiply,
      c[2] * sample.colorMultiply,
      c[3] * sample.colorMultiply,
    ]
  }
  if (sample.colorAdd !== undefined) {
    c = [
      c[0] + sample.colorAdd,
      c[1] + sample.colorAdd,
      c[2] + sample.colorAdd,
      c[3] + sample.colorAdd,
    ]
  }
  if (sample.alphaFactor !== undefined) c = [c[0], c[1], c[2], c[3] * sample.alphaFactor]
  if (sample.clampResult) {
    c = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2]), clamp01(c[3])]
  }
  if (sample.fresnel) {
    const factor = calculateLayerFresnelCpu(sample.fresnel, viewNormal, eyeToVertex)
    c = [c[0] * factor, c[1] * factor, c[2] * factor, c[3] * factor]
  }
  return c
}

/** Exact psmateriallayer.fx Fresnel scalar for the non-matrix path. */
export function calculateLayerFresnelCpu(
  fresnel: StandardLayerFresnel,
  viewNormal: Vec3,
  eyeToVertex: Vec3,
): number {
  const normal = normalize3(viewNormal)
  const direction = normalize3(eyeToVertex)
  const dot = dot3(normal, direction)
  const edge = fresnel.doNotMirror ? 1 - clamp01(-dot) : 1 - Math.abs(dot)
  let factor = Math.pow(Math.max(edge, 0.0001), Math.max(fresnel.exponent, 0))
  if (fresnel.mode === 2) factor = 1 - factor
  return clamp01(factor * fresnel.maxOffset + fresnel.min)
}

/** combineLayerColor (1.6): fold a layer's color into the running result. */
export function combineLayerColorCpu(
  op: LayerColorOp,
  color: Vec4,
  result: Vec3,
  teamColor: Vec3,
): [number, number, number] {
  switch (op) {
    case 0:
      return [result[0] * color[0], result[1] * color[1], result[2] * color[2]]
    case 1:
      return [result[0] * color[0] * 2, result[1] * color[1] * 2, result[2] * color[2] * 2]
    case 2:
      return [
        result[0] + color[0] * color[3],
        result[1] + color[1] * color[3],
        result[2] + color[2] * color[3],
      ]
    case 3:
      return [
        result[0] + (color[0] - result[0]) * color[3],
        result[1] + (color[1] - result[1]) * color[3],
        result[2] + (color[2] - result[2]) * color[3],
      ]
    case 4:
    case 5:
      return [
        result[0] + color[3] * teamColor[0],
        result[1] + color[3] * teamColor[1],
        result[2] + color[3] * teamColor[2],
      ]
    case 6:
      return [result[0] + color[0], result[1] + color[1], result[2] + color[2]]
    default:
      return [result[0], result[1], result[2]]
  }
}

/** Per-format tangent-space normal decode (1.9). NO green negation. */
export function decodeNormalCpu(texel: Vec4, format: NormalMapFormat): [number, number, number] {
  if (format === 'rgb8') {
    return [texel[0] * 2 - 1, texel[1] * 2 - 1, texel[2] * 2 - 1]
  }
  const x = format === 'bc5' || format === 'luminance-alpha' ? texel[0] * 2 - 1 : texel[3] * 2 - 1 // dxt5nm keeps x in alpha
  const y = (format === 'luminance-alpha' ? texel[3] : texel[1]) * 2 - 1
  const z = Math.sqrt(Math.max(0, 1 - (x * x + y * y)))
  return [x, y, z]
}

export interface CpuPixelInput {
  /** Pre-sampled enabled layers; the oracle owns texture sampling + uv mapping. */
  layers: Partial<Record<StandardLayerSlot, CpuLayerSample>>
  normalMapFormat?: NormalMapFormat
  /** RGBA weights for normal-blend masks 1 and 2. */
  normalBlendFactors?: readonly [number, number, number, number, number, number, number, number]
  /** Tangent-space vertex normal when no normal layer is present. */
  vertexNormal?: Vec3
  /** Tangent-space light direction (default straight-on). */
  lightDir?: Vec3
  /** Tangent-space half vector (reference convention: spec uses -dot(halfVec, normal)). */
  halfVec?: Vec3
  ambient?: Vec4
  teamColor?: Vec3
  vertexColor?: Vec4
  usesVertexColor?: boolean
  usesVertexAlpha?: boolean
  /** Composite CMS_ pass opacity; defaults to fully opaque. */
  materialAlpha?: number
  specularity: number
  specMult: number
  emisMult: number
  emissiveTint?: Vec3
  environmentMultipliers?: Vec3
  specMode: 0 | 1
  unshaded: boolean
  doubleLambert: boolean
  clampOutput: boolean
  /** 0 = alpha test off (already /255). */
  alphaTestThreshold: number
}

export interface CpuPixelResult {
  rgba: [number, number, number, number]
  /** false → the fragment would be discarded by alpha test. */
  alphaTestPassed: boolean
}

const DEFAULT_AMBIENT: Vec4 = [0.02, 0.02, 0.02, 0]

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize3(value: Vec3): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2])
  return length > 1e-8 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1]
}

/**
 * Blizzard common.fx triplanar blend curve. Keeping a CPU copy makes the
 * procedural UV path testable without relying on a browser shader compiler.
 */
export function computeTriPlanarWeightsCpu(normalValue: Vec3): [number, number, number] {
  const normal = normalize3(normalValue)
  const weight = (component: number): number =>
    Math.pow(clamp01((Math.abs(component) - 0.2) * 7), 3)
  const weights: [number, number, number] = [
    weight(normal[0]),
    weight(normal[1]),
    weight(normal[2]),
  ]
  const total = weights[0] + weights[1] + weights[2]
  return total > 1e-8 ? [weights[0] / total, weights[1] / total, weights[2] / total] : [0, 0, 1]
}

/** Exact PSUVMapping.fx spherical-environment projection. */
export function sphericalEnvironmentUvCpu(
  viewPosition: Vec3,
  viewNormal: Vec3,
  reflected: boolean,
): [number, number] {
  const normal = normalize3(viewNormal)
  const position = normalize3(viewPosition)
  const lookup = reflected
    ? normalize3([
        position[0] - 2 * dot3(position, normal) * normal[0],
        position[1] - 2 * dot3(position, normal) * normal[1],
        position[2] - 2 * dot3(position, normal) * normal[2],
      ])
    : normal
  return [lookup[0] * 0.5 + 0.5, lookup[2] * -0.5 + 0.5]
}

/** Exact VSUVMapping.fx local-planar basis, including its fixed density and V flip. */
export function planarLocalUvCpu(position: Vec3, axis: 0 | 1 | 2): [number, number] {
  const projected: Vec2 =
    axis === 0
      ? [position[1], position[2]]
      : axis === 1
        ? [position[0], position[2]]
        : [position[0], position[1]]
  return [projected[0] * 0.09375, 1 - projected[1] * 0.09375]
}

function blendNormalCpu(base: Vec3, detail: Vec3, factor: number): [number, number, number] {
  const amount = clamp01(factor)
  return normalize3([
    base[0] + (detail[0] - base[0]) * amount,
    base[1] + (detail[1] - base[1]) * amount,
    base[2] + (detail[2] - base[2]) * amount,
  ])
}

/**
 * Fragment composition (1.8) — port of standard.frag.ts main(), extended per
 * the spec with: constant-color layers, color mult/add/map alpha, spec_mode
 * alpha-only, double_lambert, lightMap ×2 + AO multiplied into the diffuse
 * term, unshaded, clamp_output, and alpha from diffuse.a × alpha1/alpha2
 * masks with alpha-test. The emissive1/emissive2 branch logic (including the
 * addEmissive latch and the asymmetric emis2 condition) is ported verbatim.
 */
export function composeStandardPixelCpu(input: CpuPixelInput): CpuPixelResult {
  const teamColor = input.teamColor ?? [1, 0, 0]
  const ambient = input.ambient ?? DEFAULT_AMBIENT
  const lightDir = input.lightDir ?? [0, 0, 1]
  const halfVec = input.halfVec ?? [0, 0, -1]
  const layers = input.layers

  let normal: Vec3 = layers.normal
    ? decodeNormalCpu(layers.normal.texel, input.normalMapFormat ?? 'dxt5nm')
    : (input.vertexNormal ?? [0, 0, 1])
  const normalBlendFactors = input.normalBlendFactors ?? [1, 0, 0, 0, 1, 0, 0, 0]
  for (const blendIndex of [1, 2] as const) {
    const detailSlot: 'normalBlend1' | 'normalBlend2' =
      blendIndex === 1 ? 'normalBlend1' : 'normalBlend2'
    const maskSlot: 'normalBlend1Mask' | 'normalBlend2Mask' =
      blendIndex === 1 ? 'normalBlend1Mask' : 'normalBlend2Mask'
    const detail = layers[detailSlot]
    if (!detail) continue
    const mask = layers[maskSlot]
      ? computeLayerColorCpu(layers[maskSlot]!, teamColor)
      : ([1, 0, 0, 0] as const)
    const factorOffset = blendIndex === 1 ? 0 : 4
    const factor =
      mask[0] * normalBlendFactors[factorOffset]! +
      mask[1] * normalBlendFactors[factorOffset + 1]! +
      mask[2] * normalBlendFactors[factorOffset + 2]! +
      mask[3] * normalBlendFactors[factorOffset + 3]!
    normal = blendNormalCpu(
      normal,
      decodeNormalCpu(detail.texel, input.normalMapFormat ?? 'dxt5nm'),
      factor,
    )
  }

  // Base color from diffuse + decal (black start, reference convention).
  let color: [number, number, number] = [0, 0, 0]
  if (layers.diffuse) {
    color = combineLayerColorCpu(
      layers.diffuse.op,
      computeLayerColorCpu(layers.diffuse, teamColor),
      color,
      teamColor,
    )
  }
  if (layers.decal) {
    color = combineLayerColorCpu(
      layers.decal.op,
      computeLayerColorCpu(layers.decal, teamColor),
      color,
      teamColor,
    )
  }
  // lightMap (×2.0) and AO multiply into the diffuse term (1.8).
  if (layers.lightMap) {
    const lm = computeLayerColorCpu(layers.lightMap, teamColor)
    color = [color[0] * lm[0] * 2, color[1] * lm[1] * 2, color[2] * lm[2] * 2]
  }
  if (layers.ao) {
    const ao = computeLayerColorCpu(layers.ao, teamColor)
    color = [color[0] * ao[0], color[1] * ao[1], color[2] * ao[2]]
  }

  // Emissive branch (standard.frag.ts:47–75, ported exactly).
  const applyEmissive = (base: [number, number, number]): [number, number, number] => {
    let final: [number, number, number] = [base[0], base[1], base[2]]
    let addEmissive = false
    let emissive: [number, number, number] = [0, 0, 0]
    if (layers.emissive1) {
      const temp = computeLayerColorCpu(layers.emissive1, teamColor)
      const op = layers.emissive1.op
      if (op === 0 || op === 1 || op === 3) {
        final = combineLayerColorCpu(op, temp, final, teamColor)
      } else {
        emissive = combineLayerColorCpu(op, temp, emissive, teamColor)
        addEmissive = true
      }
    }
    if (layers.emissive2) {
      const temp = computeLayerColorCpu(layers.emissive2, teamColor)
      const op = layers.emissive2.op
      if (!addEmissive && (op === 0 || op === 1 || op === 3)) {
        final = combineLayerColorCpu(op, temp, final, teamColor)
      } else {
        emissive = combineLayerColorCpu(op, temp, emissive, teamColor)
        addEmissive = true
      }
    }
    if (addEmissive) {
      const mask = layers.emissiveMask ? computeLayerColorCpu(layers.emissiveMask, teamColor)[0] : 1
      const tint = input.emissiveTint ?? [1, 1, 1]
      final = [
        final[0] + emissive[0] * tint[0] * input.emisMult * mask,
        final[1] + emissive[1] * tint[1] * input.emisMult * mask,
        final[2] + emissive[2] * tint[2] * input.emisMult * mask,
      ]
    }
    return final
  }

  const applyEnvironment = (
    base: [number, number, number],
    diffuseLight: number,
    specularLight: Vec3,
  ): [number, number, number] => {
    if (!layers.envi) return base
    const environment = computeLayerColorCpu(layers.envi, teamColor)
    let mask: [number, number, number, number]
    if (layers.enviMask) {
      const sampledMask = computeLayerColorCpu(layers.enviMask, teamColor)
      const rgbaMaskScale = layers.enviMask.channels === 1 ? sampledMask[3] : 1
      mask = [
        sampledMask[0] * rgbaMaskScale * environment[3],
        sampledMask[1] * rgbaMaskScale * environment[3],
        sampledMask[2] * rgbaMaskScale * environment[3],
        sampledMask[3] * environment[3],
      ]
    } else {
      mask = [environment[3], environment[3], environment[3], environment[3]]
    }
    const multipliers = input.environmentMultipliers ?? [1, 0, 0]
    const environmentValue: [number, number, number] = [
      environment[0] *
        (multipliers[0] + diffuseLight * multipliers[1] + specularLight[0] * multipliers[2]),
      environment[1] *
        (multipliers[0] + diffuseLight * multipliers[1] + specularLight[1] * multipliers[2]),
      environment[2] *
        (multipliers[0] + diffuseLight * multipliers[1] + specularLight[2] * multipliers[2]),
    ]
    if (layers.envi.op === 0) {
      return [
        base[0] * environmentValue[0] * mask[0],
        base[1] * environmentValue[1] * mask[1],
        base[2] * environmentValue[2] * mask[2],
      ]
    }
    if (layers.envi.op === 2) {
      return [
        base[0] + environmentValue[0] * mask[0],
        base[1] + environmentValue[1] * mask[1],
        base[2] + environmentValue[2] * mask[2],
      ]
    }
    if (layers.envi.op === 3) {
      return [
        base[0] + (environmentValue[0] - base[0]) * mask[3],
        base[1] + (environmentValue[1] - base[1]) * mask[3],
        base[2] + (environmentValue[2] - base[2]) * mask[3],
      ]
    }
    return base
  }

  let final: [number, number, number, number] = [ambient[0], ambient[1], ambient[2], ambient[3]]

  if (input.unshaded) {
    // 0x10: skip lambert/spec entirely — color + emissive.
    const rgb = applyEmissive(applyEnvironment(color, 0, [0, 0, 0]))
    final = [final[0] + rgb[0], final[1] + rgb[1], final[2] + rgb[2], final[3]]
  } else {
    const nl = dot3(normal, lightDir)
    const lambert = input.doubleLambert ? clamp01(-1 + 2 * nl) : Math.max(nl, 0)
    if (lambert > 0) {
      // Specular: reference factor with the spec_mode channel choice; the
      // sign-clamp (lightingmodels.fx:41) is implied by the lambert>0 guard.
      let spec: [number, number, number] = [0, 0, 0]
      if (layers.specular) {
        const specColor = computeLayerColorCpu(layers.specular, teamColor)
        const gloss = layers.gloss
          ? Math.max(computeLayerColorCpu(layers.gloss, teamColor)[0], 0.001)
          : 1
        const factor =
          Math.pow(Math.max(-dot3(halfVec, normal), 0), Math.max(input.specularity * gloss, 1)) *
          input.specMult
        spec =
          input.specMode === 1
            ? [specColor[3] * factor, specColor[3] * factor, specColor[3] * factor]
            : [specColor[0] * factor, specColor[1] * factor, specColor[2] * factor]
      }
      let rgb: [number, number, number] = [
        (color[0] + spec[0]) * lambert,
        (color[1] + spec[1]) * lambert,
        (color[2] + spec[2]) * lambert,
      ]
      rgb = applyEnvironment(rgb, lambert, spec)
      // Reference keeps emissive inside the lambert>0 guard — game-accurate
      // even though emissive vanishes at grazing light (spec gotcha).
      rgb = applyEmissive(rgb)
      final = [final[0] + rgb[0], final[1] + rgb[1], final[2] + rgb[2], final[3]]
    }
  }

  // Alpha starts with the channel-selected diffuse result. In particular,
  // channels=0 is RGB-only and forces alpha to one; SC2 resource crystals
  // then supply opacity once through alpha1 from the same DDS alpha channel.
  let alpha = layers.diffuse ? computeLayerColorCpu(layers.diffuse, teamColor)[3] : 1
  if (layers.alpha1) alpha *= computeLayerColorCpu(layers.alpha1, teamColor)[3]
  if (layers.alpha2) alpha *= computeLayerColorCpu(layers.alpha2, teamColor)[3]
  final[3] = alpha * (input.materialAlpha ?? 1)

  // Common masked team-colour operation. Unlike M3's per-layer teamColorMode, the red-channel
  // mask performs grain merge after lighting.
  if (layers.teamColorMask) {
    const mask = computeLayerColorCpu(layers.teamColorMask, teamColor)[0]
    final = [
      final[0] + (teamColor[0] - 0.5) * mask,
      final[1] + (teamColor[1] - 0.5) * mask,
      final[2] + (teamColor[2] - 0.5) * mask,
      final[3],
    ]
  }

  if (input.vertexColor) {
    const usesColor = input.usesVertexColor ?? true
    const usesAlpha = input.usesVertexAlpha ?? true
    if (usesColor) {
      final = [
        final[0] * input.vertexColor[0],
        final[1] * input.vertexColor[1],
        final[2] * input.vertexColor[2],
        final[3],
      ]
    }
    if (usesAlpha) final[3] *= input.vertexColor[3]
  }
  if (input.clampOutput) {
    final = [clamp01(final[0]), clamp01(final[1]), clamp01(final[2]), clamp01(final[3])]
  }

  const alphaTestPassed = input.alphaTestThreshold <= 0 || final[3] >= input.alphaTestThreshold
  return { rgba: final, alphaTestPassed }
}

// ── GLSL source builders (D3) ─────────────────────────────────────────────────

function layerUniformName(slot: StandardLayerSlot, suffix: string): string {
  return `u_${slot}${suffix}`
}

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`
}

/** Per-layer uv expression from the baked uv source (1.4). */
function uvExpression(layer: StandardLayerDefines): string {
  const source = uvSourceKind(layer.uvSource)
  let base = 'v_uv0'
  let angleComponent: 'x' | 'y' | 'z' = 'z'
  if (source.kind === 'explicit') base = `v_uv${source.set}`
  else if (source.kind === 'reflectCube') base = 'cubeUv(reflectionDirection())'
  else if (source.kind === 'reflectSphere') base = 'sphereUvDirection(reflectionDirection())'
  else if (source.kind === 'cube') base = 'cubeUv(normalize(v_viewNormal))'
  else if (source.kind === 'sphere') base = 'sphereUvDirection(normalize(v_viewNormal))'
  else if (source.kind === 'planarLocal') {
    base = `planarLocalUv(v_modelPosition, ${glslFloat(source.axis)})`
    angleComponent = axisComponent(source.axis)
  } else if (source.kind === 'planarWorld') {
    base = `planarWorldUv(v_worldPosition, ${glslFloat(source.axis)})`
    angleComponent = axisComponent(source.axis)
  } else if (source.kind === 'screen') {
    base = '(v_clipPosition.xy / max(abs(v_clipPosition.w), 0.0001) * vec2(0.5, -0.5) + 0.5)'
  } else base = 'v_uv0' // Unknown future source value.
  return transformUvExpression(layer, base, angleComponent, layer.slot !== 'height')
}

function axisComponent(axis: 0 | 1 | 2): 'x' | 'y' | 'z' {
  return axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'
}

function planarUvExpression(position: string, axis: 0 | 1 | 2): string {
  return axis === 0 ? `${position}.yz` : axis === 1 ? `${position}.xz` : `${position}.xy`
}

function transformUvExpression(
  layer: StandardLayerDefines,
  base: string,
  angleComponent: 'x' | 'y' | 'z',
  parallax: boolean,
): string {
  if (!layer.hasUvTransform) return parallax ? `(${base} + g_parallaxOffset)` : base
  const rotated = `rotateUv(${base}, ${layerUniformName(layer.slot, 'UvAngle')}.${angleComponent})`
  const transformed = `(${rotated} * ${layerUniformName(layer.slot, 'UvTiling')} + ${layerUniformName(layer.slot, 'UvOffset')})`
  return parallax ? `(${transformed} + g_parallaxOffset)` : transformed
}

function triplanarUvExpression(
  layer: StandardLayerDefines,
  position: string,
  axis: 0 | 1 | 2,
  parallax: boolean,
): string {
  let transformedPosition = position
  if (layer.hasUvTransform) {
    const scale = layerUniformName(layer.slot, 'UvTriplanarScale')
    const offset = layerUniformName(layer.slot, 'UvTriplanarOffset')
    // VSUVMapping.fx ComputeTriPlanarUVs: (position + offset) * scale.
    transformedPosition = `((${position} + ${offset}) * ${scale})`
  }
  const base = planarUvExpression(transformedPosition, axis)
  return transformUvExpression(layer, base, axisComponent(axis), parallax)
}

function layerTexelFunction(layer: StandardLayerDefines): string {
  if (!layer.hasTexture) return ''
  const source = uvSourceKind(layer.uvSource)
  const map = layerUniformName(layer.slot, 'Map')
  const functionName = `sampleLayerTexel_${layer.slot}`
  if (
    source.kind !== 'triplanarLocal' &&
    source.kind !== 'triplanarWorld' &&
    source.kind !== 'triplanarWorldLocalZ'
  ) {
    return `vec4 ${functionName}() {\n  return texture2D(${map}, ${uvExpression(layer)});\n}`
  }
  const local = source.kind === 'triplanarLocal'
  const hybrid = source.kind === 'triplanarWorldLocalZ'
  const position = local ? 'v_modelPosition' : 'v_worldPosition'
  const normal = local
    ? 'v_modelNormal'
    : hybrid
      ? 'vec3(v_worldNormal.xy, v_modelNormal.z)'
      : 'v_worldNormal'
  const parallax = layer.slot !== 'height'
  const uvX = triplanarUvExpression(layer, position, 0, parallax)
  const uvY = triplanarUvExpression(layer, position, 1, parallax)
  const uvZ = triplanarUvExpression(layer, hybrid ? 'v_modelPosition' : position, 2, parallax)
  return `vec4 ${functionName}() {
  vec3 weights = computeTriPlanarWeights(${normal});
  return texture2D(${map}, ${uvX}) * weights.x +
    texture2D(${map}, ${uvY}) * weights.y +
    texture2D(${map}, ${uvZ}) * weights.z;
}`
}

/** Generate the compile-time-specialized computeLayer function for one layer (1.7). */
function layerFunction(layer: StandardLayerDefines): string {
  const lines: string[] = []
  const name = `computeLayer_${layer.slot}`
  const texelFunction = layerTexelFunction(layer)
  if (texelFunction) lines.push(texelFunction)
  lines.push(`vec4 ${name}() {`)
  if (layer.hasTexture) {
    lines.push(`  vec4 texel = sampleLayerTexel_${layer.slot}();`)
  } else {
    lines.push(`  vec4 texel = ${layerUniformName(layer.slot, 'Color')};`)
  }
  lines.push(`  vec4 result = chooseChannel(${glslFloat(layer.channels)}, texel);`)
  if (layer.teamColorMode !== 0) {
    lines.push('  result = vec4(mix(u_teamColor, result.rgb, texel.a), 1.0);')
  }
  if (layer.invert) lines.push('  result = vec4(1.0) - result;')
  if (layer.hasColorMultiply) lines.push(`  result *= ${layerUniformName(layer.slot, 'Multiply')};`)
  if (layer.hasColorAdd) lines.push(`  result += ${layerUniformName(layer.slot, 'Add')};`)
  if (layer.hasAlphaFactor)
    lines.push(`  result.a *= ${layerUniformName(layer.slot, 'AlphaFactor')};`)
  if (layer.clampResult) lines.push('  result = clamp(result, 0.0, 1.0);')
  if (layer.fresnel) {
    lines.push(
      `  result *= calculateLayerFresnel(v_viewNormal, v_viewPosition, ${glslFloat(layer.fresnel.exponent)}, ${glslFloat(layer.fresnel.min)}, ${glslFloat(layer.fresnel.maxOffset)}, ${glslFloat(layer.fresnel.mode)}, ${layer.fresnel.doNotMirror ? '1.0' : '0.0'});`,
    )
  }
  lines.push('  return result;')
  lines.push('}')
  return lines.join('\n')
}

function layerUniformDeclarations(layer: StandardLayerDefines): string {
  const lines: string[] = []
  if (layer.hasTexture) lines.push(`uniform sampler2D ${layerUniformName(layer.slot, 'Map')};`)
  else lines.push(`uniform vec4 ${layerUniformName(layer.slot, 'Color')};`)
  if (layer.hasColorMultiply)
    lines.push(`uniform float ${layerUniformName(layer.slot, 'Multiply')};`)
  if (layer.hasColorAdd) lines.push(`uniform float ${layerUniformName(layer.slot, 'Add')};`)
  if (layer.hasAlphaFactor)
    lines.push(`uniform float ${layerUniformName(layer.slot, 'AlphaFactor')};`)
  if (layer.hasUvTransform) {
    lines.push(`uniform vec2 ${layerUniformName(layer.slot, 'UvOffset')};`)
    lines.push(`uniform vec2 ${layerUniformName(layer.slot, 'UvTiling')};`)
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, 'UvAngle')};`)
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, 'UvTriplanarOffset')};`)
    lines.push(`uniform vec3 ${layerUniformName(layer.slot, 'UvTriplanarScale')};`)
  }
  return lines.join('\n')
}

function combineExpression(op: LayerColorOp, colorVar: string, resultVar: string): string {
  switch (op) {
    case 0:
      return `${resultVar} *= ${colorVar}.rgb;`
    case 1:
      return `${resultVar} *= ${colorVar}.rgb * 2.0;`
    case 2:
      return `${resultVar} += ${colorVar}.rgb * ${colorVar}.a;`
    case 3:
      return `${resultVar} = mix(${resultVar}, ${colorVar}.rgb, ${colorVar}.a);`
    case 4:
    case 5:
      return `${resultVar} += ${colorVar}.a * u_teamColor;`
    case 6:
      return `${resultVar} += ${colorVar}.rgb;`
    default:
      return ''
  }
}

const SHARED_FRAGMENT_HELPERS = `
vec4 chooseChannel(float channel, vec4 texel) {
  if (channel == 3.0) {
    texel = texel.rrrr;
  } else if (channel == 4.0) {
    texel = texel.gggg;
  } else if (channel == 5.0) {
    texel = texel.bbbb;
  } else if (channel == 2.0) {
    texel = texel.aaaa;
  } else if (channel == 0.0) {
    texel.a = 1.0;
  }
  return texel;
}

vec2 g_parallaxOffset = vec2(0.0);

float calculateLayerFresnel(
  vec3 viewNormal,
  vec3 eyeToVertex,
  float exponent,
  float minimum,
  float maxOffset,
  float mode,
  float doNotMirror
) {
  vec3 normal = normalize(viewNormal);
  vec3 direction = normalize(eyeToVertex);
  float edge = doNotMirror > 0.5
    ? 1.0 - clamp(-dot(normal, direction), 0.0, 1.0)
    : 1.0 - abs(dot(normal, direction));
  float factor = pow(max(edge, 0.0001), max(exponent, 0.0));
  if (mode == 2.0) factor = 1.0 - factor;
  return clamp(factor * maxOffset + minimum, 0.0, 1.0);
}

vec3 blendNormal(vec3 baseNormal, vec3 detailNormal, float amount) {
  return normalize(mix(baseNormal, detailNormal, clamp(amount, 0.0, 1.0)));
}

vec2 rotateUv(vec2 uv, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 centered = uv - vec2(0.5);
  return mat2(c, -s, s, c) * centered + vec2(0.5);
}

vec3 reflectionDirection() {
  return reflect(normalize(v_viewPosition), normalize(v_viewNormal));
}

vec2 sphereUvDirection(vec3 direction) {
  vec3 r = normalize(direction);
  return r.xz * vec2(0.5, -0.5) + 0.5;
}

vec2 planarComponents(vec3 position, float axis) {
  if (axis == 0.0) return position.yz;
  if (axis == 1.0) return position.xz;
  return position.xy;
}

vec2 planarLocalUv(vec3 position, float axis) {
  vec2 uv = planarComponents(position, axis) * 0.09375;
  uv.y = 1.0 - uv.y;
  return uv;
}

vec2 planarWorldUv(vec3 position, float axis) {
  vec2 uv = planarComponents(position, axis) * u_terrainTiling.xy + u_terrainTiling.zw;
  uv.y = 1.0 - uv.y;
  return uv;
}

vec3 computeTriPlanarWeights(vec3 normalValue) {
  vec3 weights = clamp((abs(normalize(normalValue)) - vec3(0.2)) * 7.0, 0.0, 1.0);
  weights = weights * weights * weights;
  float total = weights.x + weights.y + weights.z;
  return total > 0.0001 ? weights / total : vec3(0.0, 0.0, 1.0);
}

vec2 cubeUv(vec3 direction) {
  vec3 d = normalize(direction);
  vec3 a = abs(d);
  vec2 faceUv;
  vec2 cell;
  if (a.x >= a.y && a.x >= a.z) {
    faceUv = vec2(d.x > 0.0 ? -d.z : d.z, d.y) / max(a.x, 0.0001);
    cell = d.x > 0.0 ? vec2(2.0, 1.0) : vec2(0.0, 1.0);
  } else if (a.y >= a.z) {
    faceUv = vec2(d.x, d.y > 0.0 ? -d.z : d.z) / max(a.y, 0.0001);
    cell = d.y > 0.0 ? vec2(1.0, 2.0) : vec2(1.0, 0.0);
  } else {
    faceUv = vec2(d.z > 0.0 ? d.x : -d.x, d.y) / max(a.z, 0.0001);
    cell = d.z > 0.0 ? vec2(1.0, 1.0) : vec2(3.0, 1.0);
  }
  return (faceUv * 0.5 + 0.5 + cell) / vec2(4.0, 3.0);
}
`

function normalDecodeGlsl(format: NormalMapFormat): string {
  if (format === 'rgb8') {
    return `vec3 decodeNormal(vec4 texel) {
  return texel.xyz * 2.0 - 1.0;
}`
  }
  const xy = format === 'bc5' ? 'texel.xy' : format === 'luminance-alpha' ? 'texel.xw' : 'texel.wy'
  return `vec3 decodeNormal(vec4 texel) {
  vec3 n;
  n.xy = 2.0 * ${xy} - 1.0;
  n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
  return n;
}`
}

export interface FragmentSourceOptions {
  /**
   * Precision header line; pass null when the host prepends its own
   * (Three.js ShaderMaterial injects `precision highp float;`).
   */
  precision?: string | null
}

/**
 * Fragment shader for the material's define set. Lighting happens in tangent
 * space (light dir + half vector arrive as varyings from the vertex stage).
 * Any backend vertex stage works as long as it fulfills the varying contract
 * (v_uv0..3, v_normal, v_lightDir, v_halfVec, v_viewPosition, v_viewNormal,
 * v_vertexColor when vertex color is enabled).
 */
export function buildStandardFragmentSource(
  defines: StandardMaterialDefines,
  options: FragmentSourceOptions = {},
): string {
  const layerBySlot = new Map(defines.layers.map(layer => [layer.slot, layer]))
  const hasDecodedNormal =
    layerBySlot.has('normal') || layerBySlot.has('normalBlend1') || layerBySlot.has('normalBlend2')
  const precision =
    options.precision === undefined
      ? '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif'
      : options.precision
  const parts: string[] = precision ? [precision, ''] : []

  for (let i = 0; i < defines.uvSetCount; i += 1) parts.push(`varying vec2 v_uv${i};`)
  parts.push('varying vec3 v_normal;')
  parts.push('varying vec3 v_lightDir;')
  parts.push('varying vec3 v_halfVec;')
  parts.push('varying vec3 v_viewDir;')
  parts.push('varying vec3 v_viewPosition;')
  parts.push('varying vec3 v_viewNormal;')
  parts.push('varying vec3 v_modelPosition;')
  parts.push('varying vec3 v_modelNormal;')
  parts.push('varying vec3 v_worldPosition;')
  parts.push('varying vec3 v_worldNormal;')
  parts.push('varying vec4 v_clipPosition;')
  if (defines.usesVertexColor || defines.usesVertexAlpha) parts.push('varying vec4 v_vertexColor;')
  parts.push('')
  if (defines.bakedPoseInstancing) {
    // Per-instance team color rides a varying; the alias keeps every fragment
    // usage of u_teamColor untouched (the vertex stage falls back to the real
    // uniform for non-instanced draws through the same program).
    parts.push('varying vec3 v_instanceTeamColor;')
    parts.push('#define u_teamColor v_instanceTeamColor')
  } else {
    parts.push('uniform vec3 u_teamColor;')
  }
  parts.push('uniform vec4 u_ambient;')
  if (defines.sceneLighting) {
    parts.push('uniform vec3 u_sceneAmbientColor;')
    parts.push('uniform vec3 u_sceneLightColor;')
  }
  parts.push('uniform float u_specularity;')
  parts.push('uniform float u_specMult;')
  parts.push('uniform float u_emisMult;')
  parts.push('uniform vec3 u_emissiveTint;')
  parts.push('uniform vec3 u_environmentMultipliers;')
  parts.push('uniform vec4 u_terrainTiling;')
  parts.push('uniform float u_materialAlpha;')
  if (layerBySlot.has('normalBlend1')) parts.push('uniform vec4 u_normalBlend1Factors;')
  if (layerBySlot.has('normalBlend2')) parts.push('uniform vec4 u_normalBlend2Factors;')
  if (layerBySlot.has('height')) parts.push('uniform float u_parallaxHeight;')
  if (defines.alphaTest) parts.push('uniform float u_alphaTestThreshold;')
  for (const layer of defines.layers) parts.push(layerUniformDeclarations(layer))
  parts.push(SHARED_FRAGMENT_HELPERS)
  if (hasDecodedNormal) parts.push(normalDecodeGlsl(defines.normalMapFormat))
  for (const layer of defines.layers) parts.push(layerFunction(layer))

  const body: string[] = []
  body.push('void main() {')
  body.push(defines.sceneLighting ? '  vec4 final = vec4(0.0);' : '  vec4 final = u_ambient;')
  if (layerBySlot.has('height')) {
    body.push('  float parallaxSample = computeLayer_height().r - 0.5;')
    body.push('  vec3 parallaxView = normalize(v_viewDir);')
    body.push(
      '  g_parallaxOffset = parallaxView.xy / max(abs(parallaxView.z), 0.15) * parallaxSample * u_parallaxHeight;',
    )
  }
  if (layerBySlot.has('normal')) {
    body.push(
      layerBySlot.get('normal')?.hasTexture
        ? '  vec3 normal = decodeNormal(sampleLayerTexel_normal());'
        : '  vec3 normal = decodeNormal(u_normalColor);',
    )
  } else if (hasDecodedNormal) {
    body.push('  vec3 normal = vec3(0.0, 0.0, 1.0);')
  } else {
    body.push('  vec3 normal = v_normal;')
  }
  for (const blendIndex of [1, 2] as const) {
    const detailSlot: 'normalBlend1' | 'normalBlend2' =
      blendIndex === 1 ? 'normalBlend1' : 'normalBlend2'
    const detail = layerBySlot.get(detailSlot)
    if (!detail) continue
    const maskSlot: 'normalBlend1Mask' | 'normalBlend2Mask' =
      blendIndex === 1 ? 'normalBlend1Mask' : 'normalBlend2Mask'
    const detailTexel = detail.hasTexture
      ? `sampleLayerTexel_${detailSlot}()`
      : `u_${detailSlot}Color`
    const mask = layerBySlot.has(maskSlot)
      ? `computeLayer_${maskSlot}()`
      : 'vec4(1.0, 0.0, 0.0, 0.0)'
    body.push(`  vec4 ${maskSlot}Value = ${mask};`)
    body.push(`  float ${detailSlot}Factor = dot(${maskSlot}Value, u_${detailSlot}Factors);`)
    body.push(`  normal = blendNormal(normal, decodeNormal(${detailTexel}), ${detailSlot}Factor);`)
  }
  body.push('  vec3 color = vec3(0.0);')
  const diffuse = layerBySlot.get('diffuse')
  if (diffuse) {
    body.push('  vec4 diffuseColor = computeLayer_diffuse();')
    body.push(`  ${combineExpression(diffuse.op, 'diffuseColor', 'color')}`)
  }
  const decal = layerBySlot.get('decal')
  if (decal) {
    body.push('  vec4 decalColor = computeLayer_decal();')
    body.push(`  ${combineExpression(decal.op, 'decalColor', 'color')}`)
  }
  if (layerBySlot.has('lightMap')) body.push('  color *= computeLayer_lightMap().rgb * 2.0;')
  if (layerBySlot.has('ao')) body.push('  color *= computeLayer_ao().rgb;')

  const emissiveBlock = (indent: string, target: string): string[] => {
    const lines: string[] = []
    const emis1 = layerBySlot.get('emissive1')
    const emis2 = layerBySlot.get('emissive2')
    if (!emis1 && !emis2) return lines
    lines.push(`${indent}vec3 emissive = vec3(0.0);`)
    lines.push(`${indent}bool addEmissive = false;`)
    if (emis1) {
      lines.push(`${indent}vec4 emis1Color = computeLayer_emissive1();`)
      if (emis1.op === 0 || emis1.op === 1 || emis1.op === 3) {
        lines.push(`${indent}${combineExpression(emis1.op, 'emis1Color', target)}`)
      } else {
        lines.push(`${indent}${combineExpression(emis1.op, 'emis1Color', 'emissive')}`)
        lines.push(`${indent}addEmissive = true;`)
      }
    }
    if (emis2) {
      lines.push(`${indent}vec4 emis2Color = computeLayer_emissive2();`)
      // The emis2 mod/mod2x/lerp fold only applies when emis1 didn't latch (reference asymmetry).
      if (emis2.op === 0 || emis2.op === 1 || emis2.op === 3) {
        lines.push(`${indent}if (!addEmissive) {`)
        lines.push(`${indent}  ${combineExpression(emis2.op, 'emis2Color', target)}`)
        lines.push(`${indent}} else {`)
        lines.push(`${indent}  ${combineExpression(2, 'emis2Color', 'emissive')}`)
        lines.push(`${indent}}`)
      } else {
        lines.push(`${indent}${combineExpression(emis2.op, 'emis2Color', 'emissive')}`)
        lines.push(`${indent}addEmissive = true;`)
      }
    }
    const mask = layerBySlot.has('emissiveMask') ? 'computeLayer_emissiveMask().r' : '1.0'
    lines.push(
      `${indent}if (addEmissive) { ${target} += emissive * u_emissiveTint * u_emisMult * ${mask}; }`,
    )
    return lines
  }

  const environmentBlock = (
    indent: string,
    target: string,
    diffuseLight: string,
    specularLight: string,
  ): string[] => {
    const environment = layerBySlot.get('envi')
    if (!environment || (environment.op !== 0 && environment.op !== 2 && environment.op !== 3)) {
      return []
    }
    const lines = [`${indent}vec4 environmentColor = computeLayer_envi();`]
    const maskLayer = layerBySlot.get('enviMask')
    if (maskLayer) {
      lines.push(`${indent}vec4 environmentMask = computeLayer_enviMask();`)
      if (maskLayer.channels === 1) lines.push(`${indent}environmentMask.rgb *= environmentMask.a;`)
      lines.push(`${indent}environmentMask *= environmentColor.a;`)
    } else {
      lines.push(`${indent}vec4 environmentMask = vec4(environmentColor.a);`)
    }
    lines.push(
      `${indent}vec3 environmentLight = vec3(u_environmentMultipliers.x + (${diffuseLight}) * u_environmentMultipliers.y) + (${specularLight}) * u_environmentMultipliers.z;`,
    )
    lines.push(`${indent}vec3 environmentValue = environmentColor.rgb * environmentLight;`)
    if (environment.op === 0) {
      lines.push(`${indent}${target} *= environmentValue * environmentMask.rgb;`)
    } else if (environment.op === 2) {
      lines.push(`${indent}${target} += environmentValue * environmentMask.rgb;`)
    } else {
      lines.push(`${indent}${target} = mix(${target}, environmentValue, environmentMask.a);`)
    }
    return lines
  }

  if (defines.unshaded) {
    body.push('  vec3 shaded = color;')
    body.push(...environmentBlock('  ', 'shaded', '0.0', 'vec3(0.0)'))
    body.push(...emissiveBlock('  ', 'shaded'))
    body.push('  final.rgb += shaded;')
  } else if (defines.sceneLighting) {
    body.push(
      defines.doubleLambert
        ? '  float lambert = clamp(-1.0 + 2.0 * dot(normal, v_lightDir), 0.0, 1.0);'
        : '  float lambert = max(dot(normal, v_lightDir), 0.0);',
    )
    const specular = layerBySlot.get('specular')
    if (specular) {
      body.push('  vec4 specColor = computeLayer_specular();')
      body.push(
        layerBySlot.has('gloss')
          ? '  float gloss = max(computeLayer_gloss().r, 0.001);'
          : '  float gloss = 1.0;',
      )
      body.push(
        '  float specFactor = lambert > 0.0 ? pow(max(-dot(v_halfVec, normal), 0.0), max(u_specularity * gloss, 1.0)) * u_specMult : 0.0;',
      )
      body.push(
        defines.specMode === 1
          ? '  vec3 spec = vec3(specColor.a) * specFactor;'
          : '  vec3 spec = specColor.rgb * specFactor;',
      )
    } else {
      body.push('  vec3 spec = vec3(0.0);')
    }
    body.push(
      '  vec3 shaded = color * (u_sceneAmbientColor + u_sceneLightColor * lambert) + spec * u_sceneLightColor * lambert;',
    )
    body.push(...environmentBlock('  ', 'shaded', 'lambert', 'spec'))
    body.push(...emissiveBlock('  ', 'shaded'))
    body.push('  final.rgb += shaded;')
  } else {
    if (defines.doubleLambert) {
      body.push('  float lambert = clamp(-1.0 + 2.0 * dot(normal, v_lightDir), 0.0, 1.0);')
    } else {
      body.push('  float lambert = max(dot(normal, v_lightDir), 0.0);')
    }
    body.push('  if (lambert > 0.0) {')
    const specular = layerBySlot.get('specular')
    if (specular) {
      body.push('    vec4 specColor = computeLayer_specular();')
      if (layerBySlot.has('gloss')) {
        body.push('    float gloss = max(computeLayer_gloss().r, 0.001);')
      } else {
        body.push('    float gloss = 1.0;')
      }
      body.push(
        '    float specFactor = pow(max(-dot(v_halfVec, normal), 0.0), max(u_specularity * gloss, 1.0)) * u_specMult;',
      )
      body.push(
        defines.specMode === 1
          ? '    vec3 spec = vec3(specColor.a) * specFactor;'
          : '    vec3 spec = specColor.rgb * specFactor;',
      )
    } else {
      body.push('    vec3 spec = vec3(0.0);')
    }
    body.push('    vec3 shaded = (color + spec) * lambert;')
    body.push(...environmentBlock('    ', 'shaded', 'lambert', 'spec'))
    body.push(...emissiveBlock('    ', 'shaded'))
    body.push('    final.rgb += shaded;')
    body.push('  }')
  }

  body.push(diffuse ? '  float alpha = computeLayer_diffuse().a;' : '  float alpha = 1.0;')
  if (layerBySlot.has('alpha1')) body.push('  alpha *= computeLayer_alpha1().a;')
  if (layerBySlot.has('alpha2')) body.push('  alpha *= computeLayer_alpha2().a;')
  body.push('  final.a = alpha * u_materialAlpha;')
  if (layerBySlot.has('teamColorMask')) {
    body.push('  float teamColorMask = computeLayer_teamColorMask().r;')
    body.push('  final.rgb += (u_teamColor - vec3(0.5)) * teamColorMask;')
  }
  if (defines.usesVertexColor) body.push('  final.rgb *= v_vertexColor.rgb;')
  if (defines.usesVertexAlpha) body.push('  final.a *= v_vertexColor.a;')
  if (defines.clampOutput) body.push('  final = clamp(final, 0.0, 1.0);')
  if (defines.alphaTest) body.push('  if (final.a < u_alphaTestThreshold) discard;')
  body.push('  gl_FragColor = final;')
  body.push('}')

  parts.push(body.join('\n'))
  return parts.join('\n')
}

/**
 * Vertex shader: positions/normals/tangents arrive ready to transform (CPU
 * skinning or pre-skinned buffers; GPU bone-texture skinning is a P10 concern
 * that will extend the defines). Lighting vectors are moved into tangent
 * space here, exactly like the reference (cheaper than per-pixel TBN).
 */
export function buildStandardVertexSource(defines: StandardMaterialDefines): string {
  const parts: string[] = []
  parts.push('uniform mat4 u_viewProjection;')
  parts.push('uniform mat4 u_modelView;')
  parts.push('uniform mat4 u_model;')
  parts.push('uniform vec3 u_lightPosition;')
  parts.push('uniform vec3 u_eyePosition;')
  parts.push('')
  parts.push('attribute vec3 a_position;')
  parts.push('attribute vec3 a_normal;')
  parts.push('attribute vec4 a_tangent;')
  if (defines.gpuSkinning) {
    parts.push('attribute vec4 a_boneIndices;')
    parts.push('attribute vec4 a_boneWeights;')
    parts.push('uniform sampler2D u_boneTexture;')
    parts.push('uniform vec2 u_boneTextureSize;')
    parts.push('uniform bool u_gpuSkinningEnabled;')
  }
  if (defines.hardwareInstancing) {
    parts.push('attribute vec4 a_instanceMatrix0;')
    parts.push('attribute vec4 a_instanceMatrix1;')
    parts.push('attribute vec4 a_instanceMatrix2;')
    parts.push('attribute vec4 a_instanceMatrix3;')
    parts.push('uniform bool u_hardwareInstancing;')
  }
  if (defines.bakedPoseInstancing) {
    parts.push('attribute vec4 a_instancePose;')
    parts.push('attribute vec4 a_instanceTeamColor;')
    parts.push('uniform bool u_bakedPoseInstancing;')
    parts.push('uniform vec3 u_teamColor;')
  }
  if (defines.usesVertexColor || defines.usesVertexAlpha) parts.push('attribute vec4 a_color;')
  for (let i = 0; i < defines.uvSetCount; i += 1) parts.push(`attribute vec2 a_uv${i};`)
  parts.push('')
  for (let i = 0; i < defines.uvSetCount; i += 1) parts.push(`varying vec2 v_uv${i};`)
  parts.push('varying vec3 v_normal;')
  parts.push('varying vec3 v_lightDir;')
  parts.push('varying vec3 v_halfVec;')
  parts.push('varying vec3 v_viewDir;')
  parts.push('varying vec3 v_viewPosition;')
  parts.push('varying vec3 v_viewNormal;')
  parts.push('varying vec3 v_modelPosition;')
  parts.push('varying vec3 v_modelNormal;')
  parts.push('varying vec3 v_worldPosition;')
  parts.push('varying vec3 v_worldNormal;')
  parts.push('varying vec4 v_clipPosition;')
  if (defines.usesVertexColor || defines.usesVertexAlpha) parts.push('varying vec4 v_vertexColor;')
  if (defines.bakedPoseInstancing) parts.push('varying vec3 v_instanceTeamColor;')
  parts.push('')
  if (defines.gpuSkinning)
    parts.push(`mat4 readBoneMatrix(float boneIndex, float row) {
  float base = boneIndex * 4.0;
  float y = (row + 0.5) / u_boneTextureSize.y;
  vec4 c0 = texture2D(u_boneTexture, vec2((base + 0.5) / u_boneTextureSize.x, y));
  vec4 c1 = texture2D(u_boneTexture, vec2((base + 1.5) / u_boneTextureSize.x, y));
  vec4 c2 = texture2D(u_boneTexture, vec2((base + 2.5) / u_boneTextureSize.x, y));
  vec4 c3 = texture2D(u_boneTexture, vec2((base + 3.5) / u_boneTextureSize.x, y));
  return mat4(c0, c1, c2, c3);
}
`)
  if (defines.bakedPoseInstancing && defines.gpuSkinning)
    parts.push(`mat4 weightedPoseMatrix(float row) {
  return readBoneMatrix(a_boneIndices.x, row) * a_boneWeights.x +
    readBoneMatrix(a_boneIndices.y, row) * a_boneWeights.y +
    readBoneMatrix(a_boneIndices.z, row) * a_boneWeights.z +
    readBoneMatrix(a_boneIndices.w, row) * a_boneWeights.w;
}
`)
  parts.push(`vec3 toTangentSpace(vec3 v, vec3 t, vec3 b, vec3 n) {
  return vec3(dot(v, t), dot(v, b), dot(v, n));
}

void main() {
  vec3 sourcePosition = a_position;
  vec3 sourceNormal = a_normal;
  vec3 sourceTangent = a_tangent.xyz;${
    defines.bakedPoseInstancing && defines.gpuSkinning
      ? `
  if (u_bakedPoseInstancing) {
    mat4 skinMatrix =
      weightedPoseMatrix(a_instancePose.x) * (1.0 - a_instancePose.z) +
      weightedPoseMatrix(a_instancePose.y) * a_instancePose.z;
    sourcePosition = vec3(skinMatrix * vec4(sourcePosition, 1.0));
    sourceNormal = mat3(skinMatrix) * sourceNormal;
    sourceTangent = mat3(skinMatrix) * sourceTangent;
  } else`
      : ''
  }${
    defines.gpuSkinning
      ? `
  if (u_gpuSkinningEnabled) {
    mat4 skinMatrix =
      readBoneMatrix(a_boneIndices.x, 0.0) * a_boneWeights.x +
      readBoneMatrix(a_boneIndices.y, 0.0) * a_boneWeights.y +
      readBoneMatrix(a_boneIndices.z, 0.0) * a_boneWeights.z +
      readBoneMatrix(a_boneIndices.w, 0.0) * a_boneWeights.w;
    sourcePosition = vec3(skinMatrix * vec4(sourcePosition, 1.0));
    sourceNormal = mat3(skinMatrix) * sourceNormal;
    sourceTangent = mat3(skinMatrix) * sourceTangent;
  }`
      : ''
  }
  vec4 worldPosition = u_model * vec4(sourcePosition, 1.0);
  vec3 positionMv = vec3(u_modelView * vec4(sourcePosition, 1.0));
  mat3 mv = mat3(u_modelView);

  // binormal = cross(normal, tangent) * handedness (normal.w convention, 1.9)
  vec3 tangent = normalize(mv * sourceTangent);
  vec3 normal = normalize(mv * sourceNormal);
  vec3 binormal = normalize(mv * (cross(sourceNormal, sourceTangent) * a_tangent.w));

  vec3 lightDir = normalize(u_lightPosition - positionMv);
  v_lightDir = normalize(toTangentSpace(lightDir, tangent, binormal, normal));

  vec3 eyeVec = normalize(u_eyePosition - positionMv);
  vec3 halfVec = normalize(eyeVec - u_lightPosition);
  v_halfVec = toTangentSpace(halfVec, tangent, binormal, normal);
  v_viewDir = toTangentSpace(eyeVec, tangent, binormal, normal);

  v_normal = normal;
  v_viewPosition = positionMv;
  v_viewNormal = normal;
  v_modelPosition = sourcePosition;
  v_modelNormal = normalize(sourceNormal);
  v_worldPosition = worldPosition.xyz;
  v_worldNormal = normalize(mat3(u_model) * sourceNormal);
  v_clipPosition = u_viewProjection * worldPosition;${
    defines.hardwareInstancing
      ? `
  if (u_hardwareInstancing) {
    mat4 instanceClipMatrix = mat4(
      a_instanceMatrix0,
      a_instanceMatrix1,
      a_instanceMatrix2,
      a_instanceMatrix3
    );
    v_clipPosition = instanceClipMatrix * vec4(sourcePosition, 1.0);
  }`
      : ''
  }`)
  for (let i = 0; i < defines.uvSetCount; i += 1) parts.push(`  v_uv${i} = a_uv${i};`)
  if (defines.usesVertexColor || defines.usesVertexAlpha) parts.push('  v_vertexColor = a_color;')
  if (defines.bakedPoseInstancing)
    parts.push(
      '  v_instanceTeamColor = u_bakedPoseInstancing ? a_instanceTeamColor.rgb : u_teamColor;',
    )
  parts.push(`  gl_Position = v_clipPosition;
}`)
  return parts.join('\n')
}
