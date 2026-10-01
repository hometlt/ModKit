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

/** The most shades an indexed team-colour ramp has here (SC1 8, Dune 2000 and RA2/TS 16). */
export const TEAM_RAMP_MAX = 16

/**
 * How a team colour's mask weighs it at one sample (UV_game_material_team_color, Runtime 02.10):
 * - `data`: the mask's data channel (`channel` 0–3, or `rgb` for one weight per channel);
 * - `key`: the stored texel under the sample is keyed when each channel is at most its threshold
 *   (255 for a channel the key does not test): weight 1 and the colour times its `intensity`
 *   channel, else weight 0 (Emperor's blue key);
 * - `ramp`: the stored texel's `channel` is a palette index, floor(data × `scale` + 0.5); from
 *   `first` on it takes its shade, weight 1, else weight 0 (SC1, Dune 2000, RA2/TS houses).
 * `tintRgb` multiplies the colour by the mask's own colour. TEAM_MASK_GLSL is the same for
 * shaders; the two change together.
 */
export interface TeamMaskRule {
  readonly mode: 'data' | 'key' | 'ramp'
  readonly channel: 0 | 1 | 2 | 3 | 'rgb'
  readonly thresholds?: readonly [number, number, number]
  readonly intensity?: 0 | 1 | 2 | 3
  readonly shades?: readonly (readonly [number, number, number])[]
  readonly first?: number
  readonly scale?: number
  readonly tintRgb?: boolean
}

/**
 * The weight per channel and the colour of one sample: `filtered` is the mask as drawn there (0..1),
 * `stored` the texel under the sample as stored (0–255), which keys and indices read.
 */
export function teamMaskSample(
  rule: TeamMaskRule,
  filtered: readonly number[],
  stored: readonly number[],
  team: readonly [number, number, number],
): {
  readonly weight: readonly [number, number, number]
  readonly color: readonly [number, number, number]
} {
  const tint = (color: readonly [number, number, number]) =>
    rule.tintRgb === true
      ? ([0, 1, 2].map(index => color[index]! * (filtered[index] ?? 0)) as [number, number, number])
      : color
  if (rule.mode === 'ramp') {
    const data = (stored[rule.channel === 'rgb' ? 0 : rule.channel] ?? 0) / 255
    const index = Math.floor(data * (rule.scale ?? 255) + 0.5) - (rule.first ?? 0)
    const shade = rule.shades?.[index]
    return shade === undefined || index < 0 || index >= TEAM_RAMP_MAX
      ? { weight: [0, 0, 0], color: team }
      : { weight: [1, 1, 1], color: tint(shade) }
  }
  if (rule.mode === 'key') {
    const thresholds = rule.thresholds ?? [0, 0, 255]
    const keyed = [0, 1, 2].every(index => (stored[index] ?? 0) <= thresholds[index]!)
    const shade = (stored[rule.intensity ?? 2] ?? 0) / 255
    return {
      weight: keyed ? [1, 1, 1] : [0, 0, 0],
      color: tint([team[0] * shade, team[1] * shade, team[2] * shade]),
    }
  }
  const weight =
    rule.channel === 'rgb'
      ? ([filtered[0] ?? 0, filtered[1] ?? 0, filtered[2] ?? 0] as const)
      : ([0, 0, 0].map(() => filtered[rule.channel as number] ?? 0) as [number, number, number])
  return { weight, color: tint(team) }
}

/**
 * teamMaskSample for shaders, returning the weight and updating `team`: `mode` 0 data, 1 key, 2 ramp;
 * `channel` 0–3, or 4 per channel; `key` the thresholds; `intensity` the key's shade channel.
 */
export const TEAM_MASK_GLSL = `float modkitTeamChannel(vec4 texel, float channel) {
  return channel < 0.5 ? texel.r : channel < 1.5 ? texel.g : channel < 2.5 ? texel.b : texel.a;
}
vec3 modkitTeamMask(sampler2D mask, vec2 uv, float mode, float channel, vec3 key, float intensity,
    vec3 shades[${TEAM_RAMP_MAX}], float rampCount, float rampFirst, float rampScale, float tintRgb,
    inout vec3 team) {
  vec4 texel = texture(mask, uv);
  vec3 weight = vec3(0.0);
  if (mode > 0.5) {
    // keys and indices read the texel under the sample, as stored: never a blend of two
    ivec2 size = textureSize(mask, 0);
    vec4 stored = texelFetch(mask, clamp(ivec2(floor(fract(uv) * vec2(size))), ivec2(0), size - ivec2(1)), 0);
    if (mode > 1.5) {
      float index = floor(modkitTeamChannel(stored, channel) * rampScale + 0.5) - rampFirst;
      for (int i = 0; i < ${TEAM_RAMP_MAX}; i++)
        if (float(i) == index && float(i) < rampCount) {
          team = shades[i];
          weight = vec3(1.0);
        }
    } else {
      bool keyed = all(lessThanEqual(floor(stored.rgb * 255.0 + 0.5), key));
      weight = keyed ? vec3(1.0) : vec3(0.0);
      team *= modkitTeamChannel(stored, intensity);
    }
  } else {
    weight = channel > 3.5 ? texel.rgb : vec3(modkitTeamChannel(texel, channel));
  }
  if (tintRgb > 0.5) team *= texel.rgb;
  return weight;
}`
