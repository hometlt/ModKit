/** Shared world-water depth tint and shore fade, matching the common GPU water shader. */
export const WATER_SHORE_FADE = 0.04
export const WATER_COLOR_FALLOFF = 0.1

/** Depth is in world-plan units; dry fragments carry no water coverage. */
export function waterDepthColor(
  color: readonly [number, number, number, number],
  depth: number,
  falloff = WATER_COLOR_FALLOFF,
): readonly [number, number, number, number] {
  depth = Math.max(0, depth)
  const saturation = falloff === 0 ? 0 : 1 - Math.exp(-depth * falloff)
  return [
    color[0] * (1 - 0.35 * saturation),
    color[1] * (1 - 0.35 * saturation),
    color[2] * (1 - 0.35 * saturation),
    (color[3] + (1 - color[3]) * saturation) * Math.min(1, depth / WATER_SHORE_FADE),
  ]
}
