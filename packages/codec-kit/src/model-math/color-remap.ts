import { hsvToRgb, linearToSrgb, rgbToHsv, srgbToLinear } from '../raster/ops.js'

/** Normalized sRGB display color used by renderer-neutral model materials. */
export type RenderRgba = readonly [number, number, number, number]

export type RenderMaterialColorRemapOperation = 'replace' | 'multiply' | 'hsv-shade' | 'grain-merge'

/**
 * Semantic color override for a material that does not depend on its source format.
 *
 * `hsv-shade` preserves the source color's value/brightness while taking hue,
 * saturation, and maximum value from the supplied team color. This matches the
 * palette-ramp behavior used by Westwood-style player colors.
 */
export interface RenderMaterialColorRemap {
  target: 'team-color'
  operation: RenderMaterialColorRemapOperation
}

/**
 * Resolve a solid material color against a semantic color remap. Alpha always
 * remains authored by the material; team color controls RGB only.
 */
export function applyRenderMaterialColorRemap(
  baseColor: RenderRgba,
  remap: RenderMaterialColorRemap | undefined,
  teamColor: readonly [number, number, number] | readonly [number, number, number, number],
): RenderRgba {
  const base: RenderRgba = [
    clamp01(baseColor[0]),
    clamp01(baseColor[1]),
    clamp01(baseColor[2]),
    clamp01(baseColor[3]),
  ]
  if (!remap || remap.target !== 'team-color') return base

  const team = [clamp01(teamColor[0]), clamp01(teamColor[1]), clamp01(teamColor[2])] as const
  if (remap.operation === 'replace') return [team[0], team[1], team[2], base[3]]
  if (remap.operation === 'multiply') {
    return [base[0] * team[0], base[1] * team[1], base[2] * team[2], base[3]]
  }
  if (remap.operation === 'grain-merge') {
    return [
      clamp01(base[0] + team[0] - 0.5),
      clamp01(base[1] + team[1] - 0.5),
      clamp01(base[2] + team[2] - 0.5),
      base[3],
    ]
  }

  const sourceLinear = base.slice(0, 3).map(srgbToLinear) as [number, number, number]
  const teamLinear = team.map(srgbToLinear) as [number, number, number]
  const sourceValue = Math.max(...sourceLinear)
  const [hue, saturation, teamValue] = rgbToHsv(teamLinear)
  const remapped = hsvToRgb(hue, saturation, sourceValue * teamValue)
  return [
    clamp01(linearToSrgb(remapped[0])),
    clamp01(linearToSrgb(remapped[1])),
    clamp01(linearToSrgb(remapped[2])),
    base[3],
  ]
}

function clamp01(value: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  if (clamped < 1e-12) return 0
  if (clamped > 1 - 1e-12) return 1
  return clamped
}

/** How `UV_game_material_team_color` combines the team colour (SPEC_UVM §11.2), in GLSL index order. */
export const TEAM_COLOR_BLENDS = ['multiply', 'add', 'replace', 'overlay', 'lerp'] as const
export type TeamColorBlend = (typeof TEAM_COLOR_BLENDS)[number]

/**
 * The one formula of `UV_game_material_team_color`, for one colour channel. `base` is the
 * material's colour, `mask` the mask's weight (1 for `maskSource: whole`), `team` the team colour,
 * `strength` the extension's weight; with w = max(0, mask · strength):
 *
 * - `multiply`: base · mix(1, team, min(w, 1)) — the team colour tints where the mask is;
 * - `add`: base + team · w;
 * - `replace`, `lerp`: mix(base, team, min(w, 1)) — the team colour takes the masked part;
 * - `overlay`: mix(base, overlay(base, team), min(w, 1)), overlay as image editors define it.
 *
 * Alpha is never the team colour's: a caller keeps its own. TEAM_COLOR_GLSL is the same formula
 * for shaders; the two must change together.
 */
export function teamColorChannel(
  base: number,
  mask: number,
  team: number,
  blend: TeamColorBlend,
  strength = 1,
): number {
  const weight = Math.max(0, mask * strength)
  const mixed = Math.min(weight, 1)
  if (blend === 'add') return base + team * weight
  if (blend === 'multiply') return base * (1 + (team - 1) * mixed)
  const target =
    blend === 'overlay' ? (base < 0.5 ? 2 * base * team : 1 - 2 * (1 - base) * (1 - team)) : team
  return base + (target - base) * mixed
}

/** teamColorChannel for shaders: `blend` is the index in TEAM_COLOR_BLENDS. */
export const TEAM_COLOR_GLSL = `vec3 modkitTeamColor(vec3 base, vec3 mask, vec3 team, int blend, float strength) {
  vec3 weight = max(mask * strength, vec3(0.0));
  vec3 mixed = min(weight, vec3(1.0));
  if (blend == 1) return base + team * weight;
  if (blend == 0) return base * (vec3(1.0) + (team - vec3(1.0)) * mixed);
  vec3 target = team;
  if (blend == 3) target = mix(1.0 - 2.0 * (1.0 - base) * (1.0 - team), 2.0 * base * team, vec3(lessThan(base, vec3(0.5))));
  return base + (target - base) * mixed;
}`
