/**
 * glTF PBR materials as material programs (TASK_CORE_RTS_PREVIEW_RENDER C4, with C2): a scene
 * material of the glTF path - `shading: 'pbr'`, no program of its own - drawn by a renderer that
 * draws only programs (the world's shared GPU path, `render/material-webgl.ts`), with what the base
 * route (`render/browser.ts`, `render/headless.ts`) does for it:
 *
 * - base colour: its factor x COLOR_0 x its base-colour texture, in the texture's (sRGB) space, then
 *   its team colour (UV_game_material_team_color): `drawTeamColor`'s colour and mask rule, the
 *   formulas TEAM_COLOR_GLSL / TEAM_MASK_GLSL of codec-kit, the mask read at the base-colour UVs;
 * - coverage: opaque, mask (its cutoff, discarded below) or blend; both faces when `doubleSided`;
 * - light: the glTF BRDF of codec-kit model-math/pbr (owner decision С3: PBR metallic-roughness by
 *   glTF semantics, decided again for the world on 06.10) over the linear base colour, the metallic
 *   and roughness factors times the blue and green of its metallic-roughness texture, its emissive
 *   colour added, sRGB out clamped as the base route does. The scene's key light, ambient, fills and
 *   shadow are the renderer's (`sceneLighting`): its key-light text is the one PBR programs share.
 *
 * Not carried, so the material keeps its fallback (`createGltfMaterialPrograms` answers undefined):
 * normal, occlusion and emissive textures, UVs other than TEXCOORD_0, a mask cutoff above one, a
 * ramp longer than renderers draw. Owner: scene (materials). A program is made per moment (team
 * colour and ramp come from the moment's context); its shader sources are shared by every moment of
 * one layout.
 */
import type {
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { PBR_GLSL, SRGB_GLSL, shadePbr, type PbrVec3 } from '@modkit/codec-kit/model-math/pbr'
import {
  TEAM_COLOR_GLSL,
  TEAM_MASK_GLSL,
  TEAM_RAMP_MAX,
} from '@modkit/codec-kit/model-math/color-remap'
import type { StandardMaterialDefines } from '@modkit/codec-kit/model-math/standard-material-glsl'
import { linearToSrgb, srgbToLinear } from '@modkit/codec-kit/raster'
import { sceneMaterialVertexSource } from '../render/material-geometry.js'
import { applyDrawTeamColor, drawTeamColor, type DrawTeamColor } from '../render/team-color.js'
import { normalInBasis, type MaterialNormalBasis } from './normal-blending.js'
import type {
  MaterialPixel,
  MaterialTextureBinding,
  StandardMaterialProgram,
} from './standard-program.js'

/** A glTF material's programs: the textures they read and the program of each moment. */
export interface GltfMaterialPrograms {
  /** The scene textures the programs bind, by their ids (SceneMaterialPrograms.textures). */
  readonly textures: ReadonlyMap<string, SceneRendererTexture>
  sample(context: SceneRendererMaterialContext | undefined): StandardMaterialProgram
}

/** One layout: what the shader sources depend on. */
interface Layout {
  readonly textured: boolean
  readonly metallicRoughness: boolean
  /** 0 no team colour, 1 the whole material, 2 weighed by its mask texture. */
  readonly team: 0 | 1 | 2
  readonly coverage: 'opaque' | 'mask' | 'blend'
}

const layoutSources = new Map<string, Readonly<{ vertex: string; fragment: string }>>()

const DEFINES: StandardMaterialDefines = Object.freeze({
  layers: [],
  normalMapFormat: 'rgb8',
  normalMapSpace: 'tangent',
  specMode: 0,
  unshaded: false,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: true,
  usesVertexAlpha: true,
  uvSetCount: 1,
  sceneLighting: true,
  pbr: true,
  linearColor: true,
  alphaTest: false,
})

/**
 * The fragment of a layout. Its key-light statement is the PBR programs' own
 * (`pbrLight, u_sceneLightColor, u_sceneAmbientColor);`), which the renderer's scene lighting turns
 * into the shadowed key light and the fills.
 */
function fragmentSource(layout: Layout): string {
  const team =
    layout.team === 0
      ? ''
      : `uniform vec3 u_teamColor;
uniform float u_teamBlend, u_teamStrength;
${layout.team === 2 ? `uniform sampler2D u_teamMaskMap;
uniform float u_teamMaskMode, u_teamMaskChannel, u_teamKeyIntensity, u_teamRampCount, u_teamRampFirst, u_teamRampScale, u_teamTintRgb;
uniform vec3 u_teamKey;
uniform vec3 u_teamRamp[${TEAM_RAMP_MAX}];
${TEAM_MASK_GLSL}` : ''}
${TEAM_COLOR_GLSL}`
  return `#version 300 es
precision highp float;
in vec3 v_normal, v_lightDir, v_viewDir;
in vec2 v_uv0;
in vec4 v_vertexColor;
uniform vec3 u_sceneLightColor;
uniform vec3 u_sceneAmbientColor;
uniform vec4 u_baseColorFactor;
uniform float u_metallicFactor, u_roughnessFactor, u_alphaCutoff;
uniform vec3 u_emissiveFactor;
${layout.textured ? 'uniform sampler2D u_baseColorMap;' : ''}
${layout.metallicRoughness ? 'uniform sampler2D u_metallicRoughnessMap;' : ''}
${team}
${PBR_GLSL}
${SRGB_GLSL}
out vec4 materialColor;
void main() {
  vec4 base = u_baseColorFactor * v_vertexColor;
${layout.textured ? '  base *= texture(u_baseColorMap, v_uv0);' : ''}
${
  layout.team === 0
    ? ''
    : `  vec3 team = u_teamColor;
  vec3 teamMask = ${
    layout.team === 2
      ? 'modkitTeamMask(u_teamMaskMap, v_uv0, u_teamMaskMode, u_teamMaskChannel, u_teamKey, u_teamKeyIntensity, u_teamRamp, u_teamRampCount, u_teamRampFirst, u_teamRampScale, u_teamTintRgb, team)'
      : 'vec3(1.0)'
  };
  base.rgb = modkitTeamColor(base.rgb, teamMask, team, int(u_teamBlend + 0.5), u_teamStrength);`
}
${layout.coverage === 'mask' ? '  if (base.a < u_alphaCutoff) discard;' : ''}
  vec3 pbrBase = modkitSrgbToLinear(clamp(base.rgb, 0.0, 1.0));
${
  layout.metallicRoughness
    ? '  vec4 metallicRoughness = texture(u_metallicRoughnessMap, v_uv0);'
    : '  vec4 metallicRoughness = vec4(1.0);'
}
  float pbrMetallic = u_metallicFactor * metallicRoughness.b;
  float pbrRoughness = u_roughnessFactor * metallicRoughness.g;
  vec3 normal = v_normal;
  vec3 pbrNormal = normalize(normal);
  vec3 pbrLight = normalize(v_lightDir);
  vec3 pbrView = normalize(v_viewDir);
  vec3 shaded = modkitPbr(pbrBase, pbrMetallic, pbrRoughness, 1.0, modkitSrgbToLinear(u_emissiveFactor), pbrNormal, pbrView, pbrLight, u_sceneLightColor, u_sceneAmbientColor);
  materialColor = vec4(modkitLinearToSrgb(clamp(shaded, 0.0, 1.0)), base.a);
}`
}

function sourcesOf(layout: Layout): Readonly<{ key: string; vertex: string; fragment: string }> {
  const key = `gltf;${layout.textured ? 't' : ''}${layout.metallicRoughness ? 'm' : ''};team=${layout.team};${layout.coverage}`
  let sources = layoutSources.get(key)
  if (sources === undefined)
    layoutSources.set(
      key,
      (sources = Object.freeze({
        vertex: sceneMaterialVertexSource(DEFINES),
        fragment: fragmentSource(layout),
      })),
    )
  return { key, ...sources }
}

const unit = (value: number) => Math.min(1, Math.max(0, value))

/**
 * The programs of `material`, or undefined when it is not of the glTF path or uses what these
 * programs do not carry (see the module comment): the caller then keeps its own fallback for it.
 * `textures` are the scene's, by id; a texture the material names but the scene lacks is not drawn
 * from, as the base route reports and skips it.
 */
export function createGltfMaterialPrograms(
  material: SceneRendererMaterial,
  textures: ReadonlyMap<string, SceneRendererTexture>,
): GltfMaterialPrograms | undefined {
  if (
    material.shading !== 'pbr' ||
    material.shader !== undefined ||
    material.simpleEffect !== undefined ||
    material.context !== undefined
  )
    return undefined
  const pbr = material.pbr ?? { metallic: 1, roughness: 1 }
  if (
    pbr.normalTexture !== undefined ||
    pbr.occlusionTexture !== undefined ||
    pbr.emissiveTexture !== undefined
  )
    return undefined
  const coverage = material.alphaMode ?? 'opaque'
  const cutoff = material.alphaCutoff ?? 0.5
  if (coverage === 'mask' && !(cutoff <= 1)) return undefined
  // a depth write against the coverage is the base route's alone
  if (material.depthWrite !== undefined && material.depthWrite !== (coverage !== 'blend'))
    return undefined
  const texture2d = (id: string | undefined) => {
    const found = id === undefined ? undefined : textures.get(id)
    return found === undefined || found.dimension === 'cube' ? undefined : found
  }
  const base = texture2d(material.baseColorTexture)
  const metallicRoughness = texture2d(pbr.metallicRoughnessTexture)
  const team = material.teamColor
  const mask =
    team === undefined || team.mask === 'whole' ? undefined : texture2d(team.mask.texture)
  // a mask texture the scene lacks: no team colour, as the base route draws it
  const layout: Layout = Object.freeze({
    textured: base !== undefined,
    metallicRoughness: metallicRoughness !== undefined,
    team: team === undefined ? 0 : team.mask === 'whole' ? 1 : mask === undefined ? 0 : 2,
    coverage,
  })
  const bound = new Map<string, SceneRendererTexture>()
  const bindings: MaterialTextureBinding[] = []
  const bind = (slot: MaterialTextureBinding['slot'], uniform: string, texture: SceneRendererTexture) => {
    bound.set(texture.id, texture)
    bindings.push(
      Object.freeze({
        slot,
        resourceId: texture.id,
        uniform,
        wrapU: texture.wrapU ?? 'repeat',
        wrapV: texture.wrapV ?? 'repeat',
      }),
    )
  }
  if (base !== undefined) bind('diffuse', 'u_baseColorMap', base)
  if (metallicRoughness !== undefined) bind('metalness', 'u_metallicRoughnessMap', metallicRoughness)
  if (layout.team === 2) bind('teamColorMask', 'u_teamMaskMap', mask!)
  Object.freeze(bindings)
  const sources = sourcesOf(layout)
  const emissive = pbr.emissive ?? [0, 0, 0]
  const fixed = Object.freeze({
    u_baseColorFactor: material.baseColor,
    u_metallicFactor: unit(pbr.metallic),
    u_roughnessFactor: unit(pbr.roughness),
    u_emissiveFactor: emissive,
    u_alphaCutoff: coverage === 'mask' ? cutoff : 0,
  })
  const blend = coverage === 'blend' ? 'blend' : coverage === 'mask' ? 'alpha-test' : 'opaque'
  const defines: StandardMaterialDefines = Object.freeze({ ...DEFINES, alphaTest: coverage === 'mask' })
  return Object.freeze({
    textures: bound,
    sample(context: SceneRendererMaterialContext | undefined): StandardMaterialProgram {
      const drawn = layout.team === 0 ? undefined : drawTeamColor(material, context)
      const uniforms: Record<string, number | readonly number[]> = { ...fixed }
      if (layout.team !== 0) teamUniforms(uniforms, drawn)
      return Object.freeze({
        key: sources.key,
        vertexSource: sources.vertex,
        fragmentSource: sources.fragment,
        uniforms: Object.freeze(uniforms),
        textures: bindings,
        defines,
        blend,
        twoSided: material.doubleSided === true,
        depthPrepass: false,
        priority: material.priority ?? 0,
        diagnostics: Object.freeze([]),
        normalMapSpace: 'tangent' as const,
        sampleNormal: (_pixel: MaterialPixel = {}, basis?: MaterialNormalBasis) =>
          normalInBasis([0, 0, 1], basis),
        shade: (pixel: MaterialPixel = {}) => shadeGltf(layout, fixed, drawn, pixel),
      })
    },
  })
}

/**
 * The team colour of one moment as uniforms (render/browser.ts sets the same values for the base
 * route): none when the moment carries none (intensity 0), its blend weighing nothing.
 */
function teamUniforms(
  uniforms: Record<string, number | readonly number[]>,
  team: DrawTeamColor | undefined,
): void {
  uniforms['u_teamColor'] = team?.color ?? [1, 1, 1]
  uniforms['u_teamBlend'] = team?.blendIndex ?? 0
  uniforms['u_teamStrength'] = team === undefined ? 0 : team.strength
  const rule = team?.rule
  uniforms['u_teamMaskMode'] = rule?.mode === 'key' ? 1 : rule?.mode === 'ramp' ? 2 : 0
  uniforms['u_teamMaskChannel'] = team === undefined || team.channel === 'rgb' ? 4 : team.channel
  uniforms['u_teamKey'] = rule?.thresholds ?? [0, 0, 255]
  uniforms['u_teamKeyIntensity'] = rule?.intensity ?? 2
  const shades = rule?.shades ?? []
  uniforms['u_teamRamp'] = Array.from(
    { length: TEAM_RAMP_MAX * 3 },
    (_, index) => shades[Math.floor(index / 3)]?.[index % 3] ?? 0,
  )
  uniforms['u_teamRampCount'] = shades.length
  uniforms['u_teamRampFirst'] = rule?.first ?? 0
  uniforms['u_teamRampScale'] = rule?.scale ?? 255
  uniforms['u_teamTintRgb'] = rule?.tintRgb === true ? 1 : 0
}

/**
 * The CPU mirror of the fragment (render/material-sampling.ts asks programs for their pixels): the
 * texels by slot (`diffuse` base colour, `metalness` metallic-roughness, `teamColorMask`), the
 * vertex colour, the light and view in the frame of `normal`; the scene's light when given.
 */
function shadeGltf(
  layout: Layout,
  fixed: Readonly<{
    u_baseColorFactor: readonly number[]
    u_metallicFactor: number
    u_roughnessFactor: number
    u_emissiveFactor: readonly number[]
    u_alphaCutoff: number
  }>,
  team: DrawTeamColor | undefined,
  pixel: MaterialPixel,
): { rgba: [number, number, number, number]; alphaTestPassed: boolean } {
  const vertex = pixel.vertexColor ?? [1, 1, 1, 1]
  const texel = layout.textured ? (pixel.texels?.diffuse ?? [1, 1, 1, 1]) : [1, 1, 1, 1]
  const base = [0, 1, 2, 3].map(
    channel => (fixed.u_baseColorFactor[channel] ?? 1) * (vertex[channel] ?? 1) * (texel[channel] ?? 1),
  )
  let rgb: [number, number, number] = [base[0]!, base[1]!, base[2]!]
  if (layout.team !== 0 && team !== undefined)
    rgb = applyDrawTeamColor(
      team,
      rgb,
      layout.team === 2 ? (pixel.texels?.teamColorMask ?? [1, 1, 1, 1]) : undefined,
    )
  const alpha = base[3]!
  const passed = layout.coverage !== 'mask' || alpha >= fixed.u_alphaCutoff
  const metallicRoughness = layout.metallicRoughness
    ? (pixel.texels?.metalness ?? [1, 1, 1, 1])
    : [1, 1, 1, 1]
  const normal = normalInBasis(pixel.normal ?? [0, 0, 1])
  const light = normalInBasis(pixel.lightDirection ?? [0, 0, 1])
  const view = normalInBasis(pixel.viewDirection ?? [0, 0, 1])
  const scene = pixel.sceneLighting
  const shaded = shadePbr(
    {
      baseColor: rgb.map(value => srgbToLinear(unit(value))) as unknown as PbrVec3,
      metallic: fixed.u_metallicFactor * (metallicRoughness[2] ?? 1),
      roughness: fixed.u_roughnessFactor * (metallicRoughness[1] ?? 1),
      emissive: fixed.u_emissiveFactor.map(value => srgbToLinear(unit(value))) as unknown as PbrVec3,
    },
    normal as unknown as PbrVec3,
    view as unknown as PbrVec3,
    {
      direction: light as unknown as PbrVec3,
      color: (scene?.lightColor ?? [1, 1, 1]) as unknown as PbrVec3,
    },
    (scene?.ambientColor ?? [0, 0, 0]) as unknown as PbrVec3,
  )
  return {
    rgba: [
      linearToSrgb(unit(shaded[0])),
      linearToSrgb(unit(shaded[1])),
      linearToSrgb(unit(shaded[2])),
      alpha,
    ],
    alphaTestPassed: passed,
  }
}
