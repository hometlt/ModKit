/** Host-owned terrain-cell geometry shared by world rendering and object placement. Corners are
 * (0,0), (1,0), (1,1), (0,1); coverage may select a diagonal only on a planar cell.
 * Operates on decoded numbers only, without game formats or SDK dependencies. */
export const TERRAIN_SPLIT_AC = [[0, 1, 2], [0, 2, 3]] as const
export const TERRAIN_SPLIT_BD = [[1, 2, 3], [1, 3, 0]] as const
type Heights = readonly [number, number, number, number]
type Layers = readonly { readonly cornerAlpha?: Heights }[]

/** Select the drawn diagonal. Texture coverage cannot change the shape of non-planar ground;
 * planar cells retain the first single-corner coverage override and the existing height tie rule. */
export function terrainCellSplit(heights: Heights, layers?: Layers) {
  const planar = heights[0] + heights[2] === heights[1] + heights[3]
  for (const layer of planar ? layers?.slice(1) ?? [] : []) {
    const alpha = layer.cornerAlpha
    if (alpha === undefined) continue
    const odd = alpha.findIndex((value, corner) => {
      const others = alpha.filter((_, index) => index !== corner)
      return others.every(other => other === others[0] && other !== value)
    })
    if (odd >= 0) return odd % 2 === 0 ? TERRAIN_SPLIT_BD : TERRAIN_SPLIT_AC
  }
  return Math.abs(heights[0] - heights[2]) <= Math.abs(heights[1] - heights[3])
    ? TERRAIN_SPLIT_AC : TERRAIN_SPLIT_BD
}

/** Height on the drawn triangle, for caller-bounded local coordinates in [0,1]. */
export function terrainCellHeight(heights: Heights, x: number, y: number, layers?: Layers): number {
  const [a, b, c, d] = heights
  if (terrainCellSplit(heights, layers) === TERRAIN_SPLIT_AC)
    return x >= y ? a * (1 - x) + b * (x - y) + c * y
      : a * (1 - y) + c * x + d * (y - x)
  return x + y >= 1 ? b * (1 - y) + c * (x + y - 1) + d * (1 - x)
    : a * (1 - x - y) + b * x + d * y
}
