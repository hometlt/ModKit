/** Normalized sRGB display color used by renderer-neutral model materials. */
export type RenderRgba = readonly [number, number, number, number]

export type RenderMaterialColorRemapOperation = 'replace' | 'multiply' | 'hsv-shade'

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

function rgbToHsv(rgb: readonly [number, number, number]): readonly [number, number, number] {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return [0, 0, max]

  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  hue /= 6
  if (hue < 0) hue += 1
  return [hue, max === 0 ? 0 : delta / max, max]
}

function hsvToRgb(
  hue: number,
  saturation: number,
  value: number,
): readonly [number, number, number] {
  const chroma = value * saturation
  const sector = (((hue % 1) + 1) % 1) * 6
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1))
  let rgb: readonly [number, number, number]
  if (sector < 1) rgb = [chroma, secondary, 0]
  else if (sector < 2) rgb = [secondary, chroma, 0]
  else if (sector < 3) rgb = [0, chroma, secondary]
  else if (sector < 4) rgb = [0, secondary, chroma]
  else if (sector < 5) rgb = [secondary, 0, chroma]
  else rgb = [chroma, 0, secondary]
  const match = value - chroma
  return [rgb[0] + match, rgb[1] + match, rgb[2] + match]
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

function clamp01(value: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  if (clamped < 1e-12) return 0
  if (clamped > 1 - 1e-12) return 1
  return clamped
}
