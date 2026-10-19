/**
 * Authored water surface boundary (SPEC_UVW_PROFILE water rule). One ordered open ring in the
 * parent space's X/Z plane: simple, non-zero area, either winding, no holes, inside the zone
 * bounds. Both the spatial profile and the glTF graph admit it here; no repair or reordering.
 */
export const UVW_WATER_POLYGON_MAX_POINTS = 4096

function refuse(message: string): never { throw new TypeError(`uvw-water-boundary: ${message}`) }

type Point = readonly [number, number]
const cross = (o: Point, a: Point, b: Point): number => {
  const result = (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  if (!Number.isFinite(result)) refuse('polygon arithmetic exceeds finite precision')
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
 * Admit one zone's optional `polygon`. Absent means the rectangle `minimum..maximum`. Edges are
 * the consecutive points plus the implicit closing edge; adjacent edges may share only their
 * common vertex, other edges no point at all.
 */
export function assertUvwWaterBoundary(zone: {
  readonly id: string
  readonly minimum: Point
  readonly maximum: Point
  readonly polygon?: readonly Point[]
}): void {
  const polygon = zone.polygon
  if (polygon === undefined) return
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > UVW_WATER_POLYGON_MAX_POINTS)
    refuse(`zone ${zone.id} polygon needs 3..${String(UVW_WATER_POLYGON_MAX_POINTS)} points`)
  for (const point of polygon) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))
      refuse(`zone ${zone.id} polygon points are finite X/Z pairs`)
    if (point[0] < zone.minimum[0] || point[0] > zone.maximum[0] || point[1] < zone.minimum[1] || point[1] > zone.maximum[1])
      refuse(`zone ${zone.id} polygon extends outside its declared bounds`)
  }
  const n = polygon.length
  let twiceArea = 0
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % n]!
    if (a[0] === b[0] && a[1] === b[1]) refuse(`zone ${zone.id} polygon repeats a point (the ring is closed implicitly)`)
    // Translate before multiplying: absolute shoelace products lose small areas far from zero.
    twiceArea += cross(polygon[0]!, a, b)
  }
  if (!Number.isFinite(twiceArea)) refuse(`zone ${zone.id} polygon arithmetic exceeds finite precision`)
  if (!(Math.abs(twiceArea) > 0)) refuse(`zone ${zone.id} polygon has no area`)
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % n]!
    // adjacent edge: meets at the shared vertex only, so it must not fold back over this edge
    const next = polygon[(i + 2) % n]!
    if (cross(a, b, next) === 0 && !within(a, next, b))
      refuse(`zone ${zone.id} polygon folds back on itself`)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsMeet(a, b, polygon[j]!, polygon[(j + 1) % n]!))
        refuse(`zone ${zone.id} polygon is not simple: edges ${String(i)} and ${String(j)} meet`)
    }
  }
}
