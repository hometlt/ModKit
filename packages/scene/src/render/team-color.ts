import type {
  SceneRendererMaterial,
  SceneRendererMaterialContext,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import {
  TEAM_COLOR_BLENDS,
  teamColorChannel,
  type TeamColorBlend,
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
}

const CHANNELS = { r: 0, g: 1, b: 2, a: 3, rgb: 'rgb' } as const

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
  const color =
    context?.teamColor !== undefined
      ? rgb(context.teamColor, 'team colour')
      : rgb(team.defaultColor ?? [1, 1, 1], `material ${material.id} team colour default`)
  return {
    ...(mask === 'whole' ? {} : { maskTexture: mask.texture }),
    channel: mask === 'whole' ? 'rgb' : CHANNELS[mask.channel],
    blend: team.blend,
    blendIndex,
    strength,
    color,
  }
}

/** `rgb` with the team colour applied, the mask texel (or none, for `whole`) weighing it. */
export function applyDrawTeamColor(
  team: DrawTeamColor,
  color: readonly [number, number, number],
  maskTexel: readonly number[] | undefined,
): [number, number, number] {
  const weight = (channel: number) =>
    maskTexel === undefined ? 1 : (maskTexel[team.channel === 'rgb' ? channel : team.channel] ?? 0)
  return [0, 1, 2].map(channel =>
    teamColorChannel(
      color[channel]!,
      weight(channel),
      team.color[channel]!,
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
