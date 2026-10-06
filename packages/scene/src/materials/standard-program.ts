import type { JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'
import type { SceneRendererEnvironment } from '@modkit/sdk/renderer'
import type {
  StandardLayerSlot,
  StandardMaterialModel,
  NormalMapFormat,
} from '@modkit/codec-kit/legacy/models/material'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  buildStandardVertexSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
  computeLayerColorCpu,
  decodeNormalCpu,
  calculateLayerFresnelCpu,
  standardBlendModeName,
  type CpuLayerSample,
  type CpuPixelResult,
  type Vec3,
  type Vec4,
  type StandardMaterialDefines,
  type StandardBlendName,
} from '@modkit/codec-kit/model-math/standard-material-glsl'
import {
  createRenderMaterialSampler,
  type MaterialSampleTime,
  type RenderMaterialPass,
  type SceneStandardMaterial,
  type MaterialTangentGeneration,
} from './render-model.js'
import {
  materialNormalFormats,
  snapshotNormalFormats,
  normalLayerShader,
  normalTexelRgb,
  NORMAL_SLOTS,
  type NormalFormats,
  type NormalSlot,
} from './normal-maps.js'
import { cubeLayerShader, UnsupportedCubeCoordinatesError } from './cube-maps.js'
import { snapshotEnvironment, isEnvironmentBinding } from './environment.js'
import { sceneMaterialVertexSource } from '../render/material-geometry.js'
import {
  blendSignedNormals,
  signedNormalFactor,
  normalInBasis,
  signedNormalLayerShader,
  objectSpaceNormalLayerShader,
  WORLD_NORMAL_VARYINGS,
  type MaterialNormalBasis,
  type NormalBlendPolicy,
} from './normal-blending.js'

export interface MaterialLighting {
  readonly teamColor?: Vec3
  readonly ambient?: Vec4
  /** World-planar UV frequency x, y and offset x, y: the ground's texture tiling; [1, 1, 0, 0]. */
  readonly terrainTiling?: Vec4
}
export interface MaterialFrameOptions extends MaterialLighting {
  /** Decoder-derived conventions by logical resource id. Authored material formats override them. */
  readonly normalMapFormats?: ReadonlyMap<string, NormalMapFormat>
  readonly textureDimensions?: ReadonlyMap<string, '2d' | 'cube'>
  readonly environment?: SceneRendererEnvironment
  readonly sceneLighting?: boolean
  /**
   * Exponent on the texel alpha of diffuse team-color layers (`lerp(team, texel, a^intensity)`),
   * default 1. 0 means the object carries no team color: those layers keep the texel color.
   */
  readonly teamColorIntensity?: number
}

/** `a^0 = 1`: a diffuse team-color layer resolves to its texel RGB with alpha 1. */
function withoutDiffuseTeamColor(material: SceneStandardMaterial): SceneStandardMaterial {
  if (!Object.values(material.layers).some(layer => layer.teamColorMode === 1)) return material
  const layers: StandardMaterialModel['layers'] = {}
  for (const [slot, layer] of Object.entries(material.layers))
    layers[slot as StandardLayerSlot] =
      layer.teamColorMode !== 1
        ? layer
        : // ponytail: RGBA → RGB restores the forced alpha of 1; AAAA/RRRR/GGGG/BBBB team-colored
          // layers would keep their selected alpha. Add an explicit intensity uniform if one appears.
          { ...layer, teamColorMode: 0, channels: layer.channels === 1 ? 0 : layer.channels }
  return Object.freeze({ ...material, layers: Object.freeze(layers) })
}

/**
 * PSMaterial.fx reads an alpha-only specular (spec_mode 1) as the specular texel's alpha only on a
 * team-colored diffuse; any other material takes the specular layer's RGB. SC2's unbuildable rocks
 * keep a black specular RGB in an opaque DXT1: read as its alpha of one, their dark plates drew white.
 */
function specularOfTeamColor(material: SceneStandardMaterial): SceneStandardMaterial {
  return material.specMode === 1 && material.layers.diffuse?.teamColorMode !== 1
    ? Object.freeze({ ...material, specMode: 0 })
    : material
}

/**
 * An emissive layer that blends (LERP) through its RGB, whose alpha PSMaterial.fx forces to one,
 * would put the emissive texel in place of the lit color. The SC2 editor draws such a model lit:
 * Washout's SpacePlatformGenerator ("braxis doodads", a near-black DXT1 emissive) drew black. The
 * layer adds instead (owner's decision 30.09); four doodad materials in the game blend so.
 */
function emissiveBlendThroughRgb(material: SceneStandardMaterial): SceneStandardMaterial {
  const blendsRgb = (slot: 'emissive1' | 'emissive2') =>
    material.layers[slot]?.op === 3 && material.layers[slot]?.channels === 0
  if (!blendsRgb('emissive1') && !blendsRgb('emissive2')) return material
  const layers: StandardMaterialModel['layers'] = { ...material.layers }
  for (const slot of ['emissive1', 'emissive2'] as const) {
    const layer = material.layers[slot]
    if (layer !== undefined && blendsRgb(slot)) layers[slot] = Object.freeze({ ...layer, op: 2 })
  }
  return Object.freeze({ ...material, layers: Object.freeze(layers) })
}

export interface MaterialPixel extends MaterialLighting {
  /** Texture filtering, UV mapping and tangent-space geometry belong to the renderer adapter. */
  readonly texels?: Readonly<Partial<Record<StandardLayerSlot, Vec4>>>
  readonly normal?: Vec3
  /** Fully evaluated normal in the same frame as lightDirection/halfVector. Bypasses layer blending. */
  readonly shadingNormal?: Vec3
  readonly lightDirection?: Vec3
  readonly halfVector?: Vec3
  /** To the eye, in the frame of lightDirection; the pbr lighting model reads it. */
  readonly viewDirection?: Vec3
  readonly viewNormal?: Vec3
  readonly eyeToVertex?: Vec3
  readonly vertexColor?: Vec4
  /** Per-draw scene light colors for programs compiled with scene lighting. */
  readonly sceneLighting?: { readonly ambientColor: Vec3; readonly lightColor: Vec3 }
}

export interface MaterialTextureBinding {
  readonly dimension?: '2d' | 'cube'
  readonly slot: StandardLayerSlot
  readonly resourceId: string
  readonly uniform: string
  readonly wrapU: 'repeat' | 'clamp'
  readonly wrapV: 'repeat' | 'clamp'
}

export interface StandardMaterialProgram {
  /** Derived only from validated data, never from user-provided shader code. */
  readonly key: string
  readonly vertexSource: string
  readonly fragmentSource: string
  readonly uniforms: Readonly<Record<string, number | readonly number[]>>
  readonly textures: readonly MaterialTextureBinding[]
  readonly defines: StandardMaterialDefines
  readonly blend: StandardBlendName
  readonly twoSided: boolean
  readonly depthPrepass: boolean
  readonly priority: number
  /** Features that require additional renderer behavior; never silently marked as supported. */
  readonly diagnostics: readonly string[]
  /** Projection frame for world-generated UVs; independent of the geometry/camera transforms. */
  readonly worldToMaterial?: readonly number[]
  readonly environment?: SceneRendererEnvironment
  readonly normalBlendPolicy?: NormalBlendPolicy
  /** Geometry preparation input; independent of shader source and normal texture sampling UVs. */
  readonly tangentGeneration?: MaterialTangentGeneration
  readonly normalMapSpace: 'tangent' | 'object'
  /** Evaluated normal in the supplied basis, or tangent space when no basis is supplied. */
  sampleNormal(pixel?: MaterialPixel, basis?: MaterialNormalBasis): Vec3
  shade(pixel?: MaterialPixel): CpuPixelResult
}

type ShaderSources = Pick<StandardMaterialProgram, 'vertexSource' | 'fragmentSource' | 'defines'>

function finiteVector(value: readonly number[], size: number, name: string) {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some(
      component =>
        typeof component !== 'number' ||
        !Number.isFinite(component) ||
        !Number.isFinite(Math.fround(component)),
    )
  )
    throw new TypeError(`${name} requires ${size} finite float32 components`)
  return value
}

/** Prepare all authored passes over the shared material kernels, with no native codec imports. */
export function createStandardMaterialPrograms(
  parameters: unknown,
  options: {
    readonly budget: JsonSnapshotBudget
    readonly signal?: AbortSignal
  },
) {
  const sampler = createRenderMaterialSampler(parameters, options.budget, options.signal)
  // Compile-time properties are immutable. This cache is bounded by the authored pass variants;
  // changing playback time, lights or team color only creates a fresh uniform snapshot.
  const sources = new Map<string, ShaderSources>()
  // A material without tracks samples alike at every time: its last passes and the frame they were
  // compiled for, given again for the same frame at another time (an animated map samples each
  // model's materials at each clock; most of them do not move).
  let last:
    | Readonly<{ lighting: MaterialFrameOptions; passes: readonly StandardMaterialProgram[] }>
    | undefined
  return Object.freeze({
    resources: sampler.resources,
    usesSceneEnvironment: sampler.usesSceneEnvironment,
    sample(
      time: MaterialSampleTime,
      lighting: MaterialFrameOptions = {},
      signal?: AbortSignal,
    ): readonly StandardMaterialProgram[] {
      if (sampler.timeless && last !== undefined && sameMaterialFrame(last.lighting, lighting)) {
        signal?.throwIfAborted()
        return last.passes
      }
      const teamColor = Object.freeze([
        ...finiteVector(lighting.teamColor ?? [1, 0, 0], 3, 'team color'),
      ]) as Vec3
      const ambient = Object.freeze([
        ...finiteVector(lighting.ambient ?? [0.02, 0.02, 0.02, 0], 4, 'material ambient'),
      ]) as Vec4
      const terrainTiling = Object.freeze([
        ...finiteVector(lighting.terrainTiling ?? [1, 1, 0, 0], 4, 'terrain tiling'),
      ]) as Vec4
      const normalFormats = snapshotNormalFormats(lighting.normalMapFormats)
      const textureDimensions = new Map(lighting.textureDimensions)
      const environment = snapshotEnvironment(lighting.environment)
      for (const value of textureDimensions.values())
        if (value !== '2d' && value !== 'cube')
          throw new TypeError('invalid material texture dimension')
      const intensity = lighting.teamColorIntensity ?? 1
      // ponytail: only the two observed intensities; a fractional exponent needs a shader uniform.
      if (intensity !== 0 && intensity !== 1)
        throw new TypeError('team color intensity must be 0 or 1')
      const passes = Object.freeze(
        sampler
          .sample(time, signal)
          .map(pass =>
            compilePass(
              {
                ...pass,
                material: emissiveBlendThroughRgb(
                  specularOfTeamColor(
                    intensity === 0 ? withoutDiffuseTeamColor(pass.material) : pass.material,
                  ),
                ),
              },
              { teamColor, ambient, terrainTiling },
              sources,
              normalFormats,
              sampler.worldToMaterial,
              textureDimensions,
              environment,
              lighting.sceneLighting === true,
            ),
          ),
      )
      if (sampler.timeless) last = Object.freeze({ lighting: copyMaterialFrame(lighting), passes })
      return passes
    },
  })
}

/**
 * A copy of frame options for a later comparison (sameMaterialFrame): the caller may change its
 * vectors, maps and environment after a sample, which the next sample must see.
 */
function copyMaterialFrame(lighting: MaterialFrameOptions): MaterialFrameOptions {
  return {
    ...lighting,
    ...(lighting.teamColor === undefined ? {} : { teamColor: [...lighting.teamColor] as Vec3 }),
    ...(lighting.ambient === undefined ? {} : { ambient: [...lighting.ambient] as Vec4 }),
    ...(lighting.terrainTiling === undefined
      ? {}
      : { terrainTiling: [...lighting.terrainTiling] as Vec4 }),
    ...(lighting.normalMapFormats === undefined
      ? {}
      : { normalMapFormats: new Map(lighting.normalMapFormats) }),
    ...(lighting.textureDimensions === undefined
      ? {}
      : { textureDimensions: new Map(lighting.textureDimensions) }),
    ...(lighting.environment === undefined
      ? {}
      : {
          environment: {
            ...lighting.environment,
            worldToEnvironment: [...lighting.environment.worldToEnvironment],
          },
        }),
  }
}

/** The same frame options by value: vectors, maps, the environment frame and the flags. */
function sameMaterialFrame(left: MaterialFrameOptions, right: MaterialFrameOptions): boolean {
  const sameVector = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined) => {
    if (a === undefined || b === undefined) return a === b
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) if (!Object.is(a[index], b[index])) return false
    return true
  }
  const sameMap = (
    a: ReadonlyMap<string, unknown> | undefined,
    b: ReadonlyMap<string, unknown> | undefined,
  ) => {
    if (a === undefined || b === undefined) return a === b
    if (a.size !== b.size) return false
    for (const [key, value] of a) if (!b.has(key) || b.get(key) !== value) return false
    return true
  }
  const environment = (frame: MaterialFrameOptions) => frame.environment?.worldToEnvironment
  return (
    sameVector(left.teamColor, right.teamColor) &&
    sameVector(left.ambient, right.ambient) &&
    sameVector(left.terrainTiling, right.terrainTiling) &&
    sameMap(left.normalMapFormats, right.normalMapFormats) &&
    sameMap(left.textureDimensions, right.textureDimensions) &&
    (left.environment === undefined) === (right.environment === undefined) &&
    sameVector(environment(left), environment(right)) &&
    (left.sceneLighting === true) === (right.sceneLighting === true) &&
    (left.teamColorIntensity ?? 1) === (right.teamColorIntensity ?? 1)
  )
}

function compilePass(
  pass: RenderMaterialPass,
  lighting: Required<MaterialLighting>,
  sources: Map<string, ShaderSources>,
  bindings: ReadonlyMap<string, NormalMapFormat>,
  worldToMaterial?: readonly number[],
  textureDimensions: ReadonlyMap<string, '2d' | 'cube'> = new Map(),
  environment?: SceneRendererEnvironment,
  sceneLighting = false,
): StandardMaterialProgram {
  const { material, alpha } = pass
  const normalFormats = materialNormalFormats(material, bindings)
  const objectSpaceNormal = material.normalMapSpace === 'object'
  const defines = buildMaterialDefines(material, {
    ...(normalFormats === undefined ? {} : { normalMapFormat: 'rgb8' as const }),
    ...(sceneLighting ? { sceneLighting: true } : {}),
  })
  const uniforms: Record<string, number | readonly number[]> = {
    u_teamColor: lighting.teamColor,
    u_ambient: lighting.ambient,
    u_specularity: material.specularity,
    u_specMult: material.specMult,
    u_emisMult: material.emisMult,
    u_emissiveTint: material.emissiveTint ?? [1, 1, 1],
    u_environmentMultipliers: material.environmentMultipliers ?? [1, 0, 0],
    u_terrainTiling: lighting.terrainTiling,
    u_materialAlpha: alpha,
    u_alphaTestThreshold: material.alphaTestThreshold,
    u_parallaxHeight: material.parallaxHeight?.value ?? 0,
    u_normalBlend1Factors: material.normalBlendFactors?.slice(0, 4).map(factor => factor.value) ?? [
      1, 0, 0, 0,
    ],
    u_normalBlend2Factors: material.normalBlendFactors?.slice(4, 8).map(factor => factor.value) ?? [
      1, 0, 0, 0,
    ],
    u_normalMapTransform: material.normalMapTransform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...(defines.pbr === true
      ? {
          u_metallicFactor: material.metallicFactor ?? 1,
          u_roughnessFactor: material.roughnessFactor ?? 1,
        }
      : {}),
    ...(defines.tonemap === true && material.tonemap !== undefined
      ? { u_tonemapCurve: material.tonemap.slice(0, 4), u_tonemapE: material.tonemap[4] }
      : {}),
  }
  const textures: MaterialTextureBinding[] = [],
    diagnostics: string[] = []
  for (const definition of defines.layers) {
    const { slot } = definition,
      layer = material.layers[slot]
    if (layer === undefined) throw new TypeError(`missing material layer ${slot}`)
    const prefix = `u_${slot}`
    if (layer.texturePath !== null)
      textures.push(
        Object.freeze({
          slot,
          resourceId: layer.texturePath,
          uniform: `${prefix}Map`,
          wrapU: layer.wrapX ? 'repeat' : 'clamp',
          wrapV: layer.wrapY ? 'repeat' : 'clamp',
          ...(textureDimensions.get(layer.texturePath) === 'cube'
            ? { dimension: 'cube' as const }
            : {}),
        }),
      )
    else uniforms[`${prefix}Color`] = layer.constantColor?.value ?? [1, 1, 1, 1]
    uniforms[`${prefix}Multiply`] = layer.colorMultiply?.value ?? 1
    uniforms[`${prefix}Add`] = layer.colorAdd?.value ?? 0
    uniforms[`${prefix}AlphaFactor`] = layer.alphaFactor?.value ?? 1
    uniforms[`${prefix}UvAngle`] = layer.uvAngle?.value ?? [0, 0, 0]
    uniforms[`${prefix}UvTriplanarOffset`] = layer.uvTriplanarOffset?.value ?? [0, 0, 0]
    uniforms[`${prefix}UvTriplanarScale`] = layer.uvTriplanarScale?.value ?? [1, 1, 1]
    const tiling = layer.uvTiling?.value ?? [1, 1],
      offset = layer.uvOffset?.value ?? [0, 0]
    if (layer.flipbook === undefined) {
      uniforms[`${prefix}UvTiling`] = tiling
      uniforms[`${prefix}UvOffset`] = offset
    } else {
      const { rows, cols } = layer.flipbook
      const frame =
        ((Math.floor(layer.flipbook.frame.value) % (rows * cols)) + rows * cols) % (rows * cols)
      const frameSize = layer.flipbook.frameSize
      // The shader samples (uv - 0.5 - offset) * tiling + 0.5; the frame's cell lies after tiling, so
      // it enters the offset divided by the tiling (a zero tiling samples one texel whatever the
      // offset). A grid of n cells samples the layer's own window scaled into cell (i + 0.5) / n.
      const beforeTiling = (cell: number, scale: number) => (scale === 0 ? 0 : cell / scale)
      if (frameSize === undefined) {
        uniforms[`${prefix}UvTiling`] = [tiling[0] / cols, tiling[1] / rows]
        uniforms[`${prefix}UvOffset`] = [
          offset[0] - beforeTiling((frame % cols) + 0.5 - cols / 2, tiling[0]),
          offset[1] - beforeTiling(Math.floor(frame / cols) + 0.5 - rows / 2, tiling[1]),
        ]
      } else {
        uniforms[`${prefix}UvTiling`] = tiling
        uniforms[`${prefix}UvOffset`] = [
          offset[0] - beforeTiling((frame % cols) * frameSize[0], tiling[0]),
          offset[1] - beforeTiling(Math.floor(frame / cols) * frameSize[1], tiling[1]),
        ]
      }
    }
    if (layer.fresnel !== undefined && layer.fresnel.transformMode !== 0)
      diagnostics.push(
        `${slot}: Fresnel matrix transform is preserved but not evaluated by the shared kernel`,
      )
    if (layer.uvSource === 6)
      diagnostics.push(`${slot}: particle UV requires a particle geometry adapter`)
  }
  for (const binding of textures)
    if (
      binding.dimension === 'cube' &&
      !(environment !== undefined && isEnvironmentBinding(binding))
    ) {
      const slot = `u_${binding.slot}`
      const same = (key: string, expected: readonly number[]) => {
        const value = uniforms[key]
        return (
          Array.isArray(value) &&
          value.length === expected.length &&
          value.every((item, index) => item === expected[index])
        )
      }
      if (
        !same(`${slot}UvAngle`, [0, 0, 0]) ||
        !same(`${slot}UvOffset`, [0, 0]) ||
        !same(`${slot}UvTiling`, [1, 1]) ||
        uniforms['u_parallaxHeight'] !== 0
      )
        throw new UnsupportedCubeCoordinatesError(
          `${binding.slot}: transformed UV/flipbook/parallax sampling of a cube image requires a direction-space mapping`,
        )
    }
  // The CPU pixel function receives sampled texels; parallax and generated UVs must be supplied
  // by its geometry adapter. The GLSL builder already contains those sampling paths.
  const worldEnvironment = environment !== undefined && textures.some(isEnvironmentBinding)
  const policy = material.normalBlendPolicy
  if (worldEnvironment)
    for (const row of [0, 1, 2])
      uniforms[`u_sceneEnvironment${row}`] = [0, 4, 8, 12].map(
        column => environment.worldToEnvironment[row + column] ?? 0,
      )
  const key =
    canonicalDefineKey(defines) +
    (normalFormats === undefined
      ? ''
      : `;normals=${NORMAL_SLOTS.map(slot => normalFormats[slot]).join(',')}`) +
    textures
      .filter(binding => binding.dimension === 'cube')
      .map(binding => `;cube=${binding.slot}`)
      .join('') +
    (worldEnvironment ? ';environment=world' : '') +
    (policy === undefined ? '' : `;normals=signed-two-detail;mask2=${policy.secondMask}`)
  let compiled = sources.get(key)
  if (compiled === undefined) {
    let fragmentSource =
      '#version 300 es\n' +
      buildStandardFragmentSource(defines, { precision: 'precision highp float;' })
        .replaceAll('varying ', 'in ')
        .replaceAll('texture2D(', 'texture(')
        .replace('void main() {', 'out vec4 materialColor;\nvoid main() {')
        .replaceAll('gl_FragColor', 'materialColor')
    if (normalFormats !== undefined)
      fragmentSource = normalLayerShader(fragmentSource, normalFormats)
    if (policy !== undefined)
      fragmentSource = signedNormalLayerShader(
        fragmentSource,
        defines,
        policy,
        normalFormats !== undefined,
      )
    if (objectSpaceNormal) fragmentSource = objectSpaceNormalLayerShader(fragmentSource)
    fragmentSource = cubeLayerShader(
      fragmentSource,
      defines,
      textures,
      worldEnvironment,
      policy !== undefined,
    )
    if (worldEnvironment || policy !== undefined || objectSpaceNormal)
      fragmentSource = fragmentSource.replace(
        'precision highp float;',
        `precision highp float;\n${WORLD_NORMAL_VARYINGS}`,
      )
    const vertexSource =
      worldEnvironment || policy !== undefined || objectSpaceNormal
        ? sceneMaterialVertexSource(
            defines,
            worldEnvironment,
            policy !== undefined || objectSpaceNormal,
          )
        : '#version 300 es\nprecision highp float;\n' +
          buildStandardVertexSource(defines)
            .replaceAll('attribute ', 'in ')
            .replaceAll('varying ', 'out ')
            .replaceAll('texture2D(', 'texture(')
    for (const layer of defines.layers) Object.freeze(layer)
    Object.freeze(defines.layers)
    compiled = Object.freeze({ vertexSource, fragmentSource, defines: Object.freeze(defines) })
    sources.set(key, compiled)
  }
  for (const value of Object.values(uniforms)) if (Array.isArray(value)) Object.freeze(value)
  return Object.freeze({
    key,
    ...compiled,
    uniforms: Object.freeze(uniforms),
    textures: Object.freeze(textures),
    blend: standardBlendModeName(material.blendMode, material.alphaTestThreshold),
    twoSided: material.twoSided,
    depthPrepass: material.depthPrepass ?? false,
    priority: pass.priority,
    diagnostics: Object.freeze(diagnostics),
    normalMapSpace: material.normalMapSpace ?? 'tangent',
    ...(worldToMaterial === undefined ? {} : { worldToMaterial }),
    ...(worldEnvironment ? { environment } : {}),
    ...(policy === undefined ? {} : { normalBlendPolicy: policy }),
    ...(material.tangentGeneration === undefined
      ? {}
      : { tangentGeneration: material.tangentGeneration }),
    sampleNormal: (pixel: MaterialPixel = {}, basis?: MaterialNormalBasis) =>
      sampleNormal(material, lighting, pixel, normalFormats, basis),
    shade: (pixel: MaterialPixel = {}) =>
      shade(material, alpha, lighting, pixel, normalFormats, sceneLighting),
  })
}

function shade(
  material: SceneStandardMaterial,
  alpha: number,
  lighting: Required<MaterialLighting>,
  pixel: MaterialPixel,
  normalFormats?: NormalFormats,
  sceneLighting = false,
): CpuPixelResult {
  const teamColor = pixel.teamColor ?? lighting.teamColor,
    ambient = pixel.ambient ?? lighting.ambient
  finiteVector(teamColor, 3, 'team color')
  finiteVector(ambient, 4, 'material ambient')
  for (const vector of [
    pixel.normal,
    pixel.shadingNormal,
    pixel.lightDirection,
    pixel.halfVector,
    pixel.viewDirection,
    pixel.viewNormal,
    pixel.eyeToVertex,
  ])
    if (vector !== undefined) finiteVector(vector, 3, 'material lighting vector')
  if (pixel.vertexColor !== undefined) finiteVector(pixel.vertexColor, 4, 'material vertex color')
  const shadingNormal =
    pixel.shadingNormal ??
    (material.normalBlendPolicy === undefined
      ? undefined
      : sampleNormal(material, lighting, pixel, normalFormats))
  const layers = pixelLayers(
    material,
    pixel,
    teamColor,
    normalFormats,
    Object.keys(material.layers).filter(
      slot =>
        shadingNormal === undefined ||
        ![
          'normal',
          'normalBlend1',
          'normalBlend2',
          'normalBlend1Mask',
          'normalBlend2Mask',
        ].includes(slot),
    ),
  )
  const vertexNormal = shadingNormal ?? pixel.normal
  return composeStandardPixelCpu({
    layers,
    teamColor,
    ambient,
    ...(sceneLighting
      ? {
          sceneLighting: pixel.sceneLighting ?? {
            ambientColor: [ambient[0], ambient[1], ambient[2]],
            lightColor: [1, 1, 1],
          },
        }
      : {}),
    materialAlpha: alpha,
    specularity: material.specularity,
    specMult: material.specMult,
    emisMult: material.emisMult,
    specMode: material.specMode,
    ...(material.specularEnergyConservation === true ? { specularEnergyConservation: true } : {}),
    unshaded: material.unshaded,
    doubleLambert: material.doubleLambert,
    clampOutput: material.clampOutput,
    alphaTestThreshold: material.alphaTestThreshold,
    usesVertexColor: material.usesVertexColor,
    usesVertexAlpha: material.usesVertexAlpha,
    ...(material.blendMode === 2 ? { modAlpha: true } : {}),
    ...(normalFormats === undefined && material.normalMapFormat === undefined
      ? {}
      : { normalMapFormat: normalFormats === undefined ? material.normalMapFormat : 'rgb8' }),
    ...(material.environmentMultipliers === undefined
      ? {}
      : { environmentMultipliers: material.environmentMultipliers }),
    ...(material.environmentTintByBase === true ? { environmentTintByBase: true } : {}),
    ...(material.edgeFadeOut === undefined ? {} : { edgeFadeOut: material.edgeFadeOut }),
    ...(material.emissiveTint === undefined ? {} : { emissiveTint: material.emissiveTint }),
    ...(material.normalBlendFactors === undefined
      ? {}
      : {
          normalBlendFactors: material.normalBlendFactors.map(factor => factor.value) as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ],
        }),
    ...(vertexNormal === undefined ? {} : { vertexNormal }),
    ...(pixel.lightDirection === undefined ? {} : { lightDir: pixel.lightDirection }),
    ...(pixel.halfVector === undefined ? {} : { halfVec: pixel.halfVector }),
    ...(pixel.viewDirection === undefined ? {} : { viewDir: pixel.viewDirection }),
    ...(pixel.vertexColor === undefined ? {} : { vertexColor: pixel.vertexColor }),
    ...(material.lightingModel === 'pbr-metallic-roughness'
      ? {
          pbr: {
            metallicFactor: material.metallicFactor ?? 1,
            roughnessFactor: material.roughnessFactor ?? 1,
          },
        }
      : {}),
    // as buildMaterialDefines: an unshaded material is drawn as stored
    ...(material.lightingModel === 'pbr-metallic-roughness' &&
    material.colorPipeline === 'linear-srgb' &&
    !material.unshaded
      ? { linearColor: material.tonemap === undefined ? {} : { tonemap: material.tonemap } }
      : {}),
  })
}

function pixelLayers(
  material: SceneStandardMaterial,
  pixel: MaterialPixel,
  teamColor: Vec3,
  normalFormats?: NormalFormats,
  slots = Object.keys(material.layers),
): Partial<Record<StandardLayerSlot, CpuLayerSample>> {
  const layers: Partial<Record<StandardLayerSlot, CpuLayerSample>> = {}
  for (const slot of slots) {
    const layer = material.layers[slot as StandardLayerSlot]
    if (layer === undefined) continue
    const texel =
      layer.texturePath === null ? layer.constantColor?.value : pixel.texels?.[layer.slot]
    if (texel === undefined)
      throw new TypeError(`material ${slot} requires sampled texture ${layer.texturePath}`)
    finiteVector(texel, 4, `${slot} texel`)
    const sample: CpuLayerSample = {
      texel:
        normalFormats !== undefined && NORMAL_SLOTS.some(normal => normal === slot)
          ? normalTexelRgb(texel, normalFormats[slot as NormalSlot])
          : texel,
      channels: layer.channels,
      op: layer.op,
      teamColorMode: layer.teamColorMode,
      invert: layer.invert,
      clampResult: layer.clampResult,
      ...(layer.colorMultiply === undefined ? {} : { colorMultiply: layer.colorMultiply.value }),
      ...(layer.colorAdd === undefined ? {} : { colorAdd: layer.colorAdd.value }),
      ...(layer.alphaFactor === undefined ? {} : { alphaFactor: layer.alphaFactor.value }),
      ...(layer.fresnel === undefined
        ? {}
        : {
            fresnel: {
              ...layer.fresnel,
              // The frozen composition kernel has no view-vector argument. Resolve its Fresnel
              // scalar with the shared function, then supply that constant at the same pipeline
              // stage. Keep channel metadata: environment masks distinguish RGBA from AAAA.
              min: calculateLayerFresnelCpu(
                layer.fresnel,
                pixel.viewNormal ?? [0, 0, 1],
                pixel.eyeToVertex ?? [0, 0, -1],
              ),
              maxOffset: 0,
            },
          }),
    }
    layers[layer.slot] = sample
  }
  return layers
}

/** Evaluate the selected normal policy before color/environment composition. */
function sampleNormal(
  material: SceneStandardMaterial,
  lighting: Required<MaterialLighting>,
  pixel: MaterialPixel,
  formats?: NormalFormats,
  basis?: MaterialNormalBasis,
): Vec3 {
  const team = pixel.teamColor ?? lighting.teamColor
  finiteVector(team, 3, 'team color')
  for (const value of [pixel.normal, pixel.viewNormal, pixel.eyeToVertex])
    if (value !== undefined) finiteVector(value, 3, 'material normal vector')
  if (basis !== undefined)
    for (const value of [basis.tangent, basis.bitangent, basis.normal])
      finiteVector(value, 3, 'material normal basis')
  const layers = pixelLayers(material, pixel, team, formats, [
    'normal',
    'normalBlend1',
    'normalBlend2',
    'normalBlend1Mask',
    'normalBlend2Mask',
  ])
  const format = formats === undefined ? (material.normalMapFormat ?? 'dxt5nm') : 'rgb8'
  let normal: Vec3 =
    layers.normal === undefined
      ? (pixel.normal ?? [0, 0, 1])
      : decodeNormalCpu(layers.normal.texel, format)
  if (material.normalMapSpace === 'object' && layers.normal !== undefined) {
    const transform = material.normalMapTransform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
    normal = [
      transform[0] * normal[0] + transform[3] * normal[1] + transform[6] * normal[2],
      transform[1] * normal[0] + transform[4] * normal[1] + transform[7] * normal[2],
      transform[2] * normal[0] + transform[5] * normal[1] + transform[8] * normal[2],
    ]
  }
  const maskValue = (index: 0 | 1): Vec4 => {
    const mask = layers[index === 0 ? 'normalBlend1Mask' : 'normalBlend2Mask']
    return mask === undefined ? [1, 0, 0, 0] : computeLayerColorCpu(mask, team)
  }
  const maskFactors = (index: 0 | 1): Vec4 => {
    const read = (channel: number) =>
      material.normalBlendFactors?.[index * 4 + channel]?.value ?? (channel === 0 ? 1 : 0)
    return [read(0), read(1), read(2), read(3)]
  }
  const maskWeight = (index: 0 | 1): number => {
    const weights = maskValue(index)
    return weights.reduce(
      (sum, value, channel) =>
        sum +
        value *
          (material.normalBlendFactors?.[index * 4 + channel]?.value ?? (channel === 0 ? 1 : 0)),
      0,
    )
  }
  if (material.normalBlendPolicy !== undefined) {
    const first = layers.normalBlend1,
      second = layers.normalBlend2
    if (first === undefined || second === undefined)
      throw new TypeError('signed normal policy requires both detail layers')
    return blendSignedNormals(
      normal,
      decodeNormalCpu(first.texel, format),
      decodeNormalCpu(second.texel, format),
      signedNormalFactor(
        maskValue(0),
        maskFactors(0),
        material.normalBlendPolicy.secondMask ? maskValue(1) : [0, 0, 0, 0],
        material.normalBlendPolicy.secondMask ? maskFactors(1) : [0, 0, 0, 0],
      ),
      basis,
    )
  }
  for (const index of [0, 1] as const) {
    const detail = layers[index === 0 ? 'normalBlend1' : 'normalBlend2']
    if (detail === undefined) continue
    const factor = Math.min(1, Math.max(0, maskWeight(index)))
    const decoded = decodeNormalCpu(detail.texel, format)
    const mixed: Vec3 = [
      normal[0] + (decoded[0] - normal[0]) * factor,
      normal[1] + (decoded[1] - normal[1]) * factor,
      normal[2] + (decoded[2] - normal[2]) * factor,
    ]
    const length = Math.hypot(...mixed)
    normal = length > 1e-8 ? [mixed[0] / length, mixed[1] / length, mixed[2] / length] : [0, 0, 1]
  }
  return basis === undefined ? normal : normalInBasis(normal, basis)
}
