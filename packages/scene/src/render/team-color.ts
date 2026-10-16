import type {
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { linearToSrgb } from '@modkit/codec-kit/raster'
import {
  TEAM_COLOR_BLENDS,
  TEAM_RAMP_MAX,
  teamColorChannel,
  teamMaskSample,
  type TeamColorBlend,
  type TeamMaskRule,
} from '@modkit/codec-kit/model-math/color-remap'

/** A material's team colour as a base-route draw applies it (codec-kit teamColorChannel). */
export interface DrawTeamColor {
  /** Absent for `whole`. */
  readonly maskTexture?: string
  /** Channel index of the mask, or `rgb` for one weight per channel. */
  readonly channel: 0 | 1 | 2 | 3 | 'rgb'
  readonly blend: TeamColorBlend
  /** TEAM_COLOR_BLENDS index, for shaders. */
  readonly blendIndex: number
  readonly strength: number
  readonly color: readonly [number, number, number]
  /** Draw-space rule: indexed shades are already in stored sRGB texel space. */
  readonly rule: TeamMaskRule
}

const CHANNELS = { r: 0, g: 1, b: 2, a: 3, rgb: 'rgb' } as const

/**
 * The mask rule of a team colour (codec-kit TeamMaskRule): a key's thresholds per stored channel,
 * a ramp's linear shades — the draw's own when as long as the material's. Undefined for a ramp longer than
 * renderers draw (TEAM_RAMP_MAX).
 */
export function teamMaskRule(
  team: NonNullable<SceneRendererMaterial['teamColor']>,
  context: SceneRendererMaterialContext | undefined,
): TeamMaskRule | undefined {
  const channel = team.mask === 'whole' ? 'rgb' : CHANNELS[team.mask.channel]
  const tint = team.tint === 'mask-rgb' ? { tintRgb: true } : {}
  if (team.key !== undefined) {
    const thresholds = (['r', 'g', 'b'] as const).map(name =>
      team.key!.channels.includes(name) ? team.key!.threshold : 255,
    ) as [number, number, number]
    return { mode: 'key', channel, thresholds, intensity: CHANNELS[team.key.intensity], ...tint }
  }
  if (team.ramp !== undefined) {
    const own = context?.teamRamp
    const shades =
      own !== undefined && own.length === team.ramp.shades.length ? own : team.ramp.shades
    if (shades.length > TEAM_RAMP_MAX) return undefined
    return {
      mode: 'ramp',
      channel: channel === 'rgb' ? 0 : channel,
      shades,
      first: team.ramp.first,
      scale: team.ramp.scale,
      ...tint,
    }
  }
  return { mode: 'data', channel, ...tint }
}

/** Base/model/world draw routes blend stored sRGB texels before lighting. The authored ramp and
 * instance override stay linear; convert their selected shades once at the draw boundary.
 */
export function teamMaskRuleForSrgb(rule: TeamMaskRule): TeamMaskRule {
  if (rule.mode !== 'ramp' || rule.shades === undefined) return rule
  return { ...rule, shades: rule.shades.map(shade =>
    shade.map(linearToSrgb) as [number, number, number]) }
}

function rgb(value: unknown, label: string): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(item => typeof item === 'number' && item >= 0 && item <= 1)
  )
    throw new TypeError(`${label} must be three components in 0..1`)
  return [value[0], value[1], value[2]]
}

/**
 * The team colour a base-route draw of `material` applies, or undefined for none. The colour is
 * the material instance's, else the scene's (`materialContext`), else the extension's default. A
 * team colour intensity of 0 marks an object without one, as for material programs.
 */
export function drawTeamColor(
  material: SceneRendererMaterial,
  scene: SceneRendererMaterialContext | undefined,
): DrawTeamColor | undefined {
  const team = material.teamColor
  if (team === undefined) return undefined
  const blendIndex = TEAM_COLOR_BLENDS.indexOf(team.blend)
  if (blendIndex < 0) throw new TypeError(`material ${material.id} team colour blend is unknown`)
  const strength = team.strength ?? 1
  if (!Number.isFinite(strength) || strength < 0)
    throw new TypeError(`material ${material.id} team colour strength must be nonnegative`)
  const mask = team.mask
  if (mask !== 'whole' && (typeof mask.texture !== 'string' || !(mask.channel in CHANNELS)))
    throw new TypeError(`material ${material.id} team colour mask is invalid`)
  const context = material.context ?? scene
  if (context?.teamColorIntensity === 0) return undefined
  const rule = teamMaskRule(team, context)
  if (rule === undefined) return undefined
  // an object-tint colour is the object's, which a model drawn alone has not: the default
  const color =
    context?.teamColor !== undefined && team.source !== 'object-tint'
      ? rgb(context.teamColor, 'team colour')
      : rgb(team.defaultColor ?? [1, 1, 1], `material ${material.id} team colour default`)
  return {
    ...(mask === 'whole' ? {} : { maskTexture: mask.texture }),
    channel: mask === 'whole' ? 'rgb' : CHANNELS[mask.channel],
    blend: team.blend,
    blendIndex,
    strength,
    color,
    rule: teamMaskRuleForSrgb(rule),
  }
}

/**
 * `rgb` with the team colour applied: the mask texel as drawn (`maskTexel`, 0..1; none for `whole`)
 * weighing it, and for a key or a ramp the texel under the sample as stored (`storedTexel`, 0–255).
 */
export function applyDrawTeamColor(
  team: DrawTeamColor,
  color: readonly [number, number, number],
  maskTexel: readonly number[] | undefined,
  storedTexel: readonly number[] = (maskTexel ?? []).map(value => Math.round(value * 255)),
): [number, number, number] {
  const sample =
    maskTexel === undefined
      ? { weight: [1, 1, 1] as const, color: team.color }
      : teamMaskSample(team.rule, maskTexel, storedTexel, team.color)
  return [0, 1, 2].map(channel =>
    teamColorChannel(
      color[channel]!,
      sample.weight[channel]!,
      sample.color[channel]!,
      team.blend,
      team.strength,
    ),
  ) as [number, number, number]
}

/** The mask texture a team colour names, when the scene carries it as a 2D texture. */
export function teamMaskTexture(
  team: DrawTeamColor | undefined,
  textures: ReadonlyMap<string, SceneRendererTexture>,
): SceneRendererTexture | undefined {
  if (team?.maskTexture === undefined) return undefined
  const texture = textures.get(team.maskTexture)
  return texture?.dimension === 'cube' ? undefined : texture
}
