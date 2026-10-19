/**
 * The UVW water surface boundary rule (multiverse SPEC_UVW_PROFILE water rule, its verifier
 * `specs/tools/uvw-water-boundary.ts` at c5b30b2; keep both in step): one ordered open ring of 3..4096 finite X/Z points in the
 * zone's parent space, simple, with area, either winding, no holes, inside the zone bounds. The
 * UVW reader admits a document by it and the reconstruction refuses to write a ring that breaks it;
 * neither repairs nor reorders the authored points.
 */
export const UVW_WATER_POLYGON_MAX_POINTS = 4096

type Point = readonly [number, number]
/** Thrown inside the check when an intermediate product is not finite; reported as a problem. */
class Unrepresentable extends Error {}
const cross = (o: Point, a: Point, b: Point): number => {
  const result = (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  if (!Number.isFinite(result)) throw new Unrepresentable()
  return result
}
const within = (a: Point, b: Point, p: Point): boolean =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])

/** Whether closed segments ab and cd share any point (touching and collinear overlap included). */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b))
    || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d))
}

/**
 * Why `polygon` is no admissible boundary of the zone `minimum..maximum`, or undefined when it is.
 * Edges are the consecutive points plus the implicit closing edge; adjacent edges share only their
 * vertex, other edges no point. Point count is checked before any point is read.
 */
export function waterBoundaryProblem(
  polygon: readonly Point[],
  minimum: Point,
  maximum: Point,
): string | undefined {
  try {
    return ringProblem(polygon, minimum, maximum)
  } catch (error) {
    if (error instanceof Unrepresentable) return 'water polygon arithmetic exceeds finite precision'
    throw error
  }
}

function ringProblem(polygon: readonly Point[], minimum: Point, maximum: Point): string | undefined {
  if (polygon.length < 3 || polygon.length > UVW_WATER_POLYGON_MAX_POINTS)
    return `water polygon requires 3..${String(UVW_WATER_POLYGON_MAX_POINTS)} ordered points`
  for (const point of polygon) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return 'water polygon points must be finite'
    if (point[0] < minimum[0] || point[0] > maximum[0] || point[1] < minimum[1] || point[1] > maximum[1])
      return 'water polygon extends outside its declared bounds'
  }
  const n = polygon.length
  let twiceArea = 0
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % n]!
    if (a[0] === b[0] && a[1] === b[1]) return 'water polygon repeats a point (the ring closes implicitly)'
    // Translate before multiplying: absolute shoelace products lose small areas far from zero.
    twiceArea += cross(polygon[0]!, a, b)
  }
  if (!Number.isFinite(twiceArea)) return 'water polygon arithmetic exceeds finite precision'
  if (!(Math.abs(twiceArea) > 0)) return 'water polygon has no area'
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % n]!, next = polygon[(i + 2) % n]!
    if (cross(a, b, next) === 0 && !within(a, next, b))
      return 'water polygon folds back on itself'
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsMeet(a, b, polygon[j]!, polygon[(j + 1) % n]!))
        return `water polygon is not simple: edges ${String(i)} and ${String(j)} meet`
    }
  }
  return undefined
}
