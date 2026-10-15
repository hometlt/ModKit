/** Derived top-down cliff midlines over published terrain quads; no native/gameplay inference.
 * A single shared half-cell graph measures horizontal distances from height-qualified bank edges.
 * Unknown banks, pinched corner fans are separated; unknown banks and ambiguous scalar cells are omitted and counted explicitly.
 */
import {
  weightedDistanceField,
  DistanceBudgetError,
} from '@modkit/codec-kit/graph/weighted-distance'

type Point = readonly [number, number]
interface Vertex {
  readonly point: Point
  readonly height: number
}
export interface CliffLatticeQuad {
  readonly layerId: string
  readonly x: number
  readonly y: number
  readonly vertices: readonly [Vertex, Vertex, Vertex, Vertex]
  readonly cliffFace?: boolean
  readonly ramp: boolean
  readonly authoredLevels: boolean
}
export interface CliffMidlineStats {
  method: 'bank-geodesic-midline'
  components: number
  omittedComponents: number
  splitCornerComponents: number
  oneBankComponents: number
  flatCells: number
  ambiguousCells: number
  mixedBoundaryVertices: number
  unknownBoundaryEdges: number
  nodes: number
  edges: number
  queuePushes: number
  peakQueue: number
  typedPeakBytes: number
  budgetExceeded: boolean
  refusalReason?: string
  complete: boolean
}
interface Node {
  point: Point
  bank: number
  bankHeight: number
}
/** A visual side of the bisector, coloured with its nearest qualified bank's height. */
export interface CliffBankFill {
  readonly points: readonly Point[]
  readonly height: number
  readonly side: 'low' | 'high'
}
const SIDES = [
  [0, 1, 3, 2, 0, -1],
  [1, 2, 0, 3, 1, 0],
  [2, 3, 1, 0, 0, 1],
  [3, 0, 2, 1, -1, 0],
] as const
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const
const MAX_CELLS = 50_000,
  MAX_NODES = 250_000,
  MAX_EDGES = 400_000
const MAX_TYPED_BYTES = 64 * 1024 * 1024,
  MAX_KEY_UNITS = 8_000_000

/** Calculate a visual bank bisector; caps bound graph/registry growth, not total JavaScript RSS. */
export function deriveCliffMidlines(quads: readonly CliffLatticeQuad[]): {
  readonly segments: readonly (readonly [Point, Point])[]
  readonly fills: readonly CliffBankFill[]
  readonly stats: Readonly<CliffMidlineStats>
} {
  const stats: CliffMidlineStats = {
    method: 'bank-geodesic-midline',
    components: 0,
    omittedComponents: 0,
    splitCornerComponents: 0,
    oneBankComponents: 0,
    flatCells: 0,
    ambiguousCells: 0,
    mixedBoundaryVertices: 0,
    unknownBoundaryEdges: 0,
    nodes: 0,
    edges: 0,
    queuePushes: 0,
    peakQueue: 0,
    typedPeakBytes: 0,
    budgetExceeded: false,
    complete: true,
  }
  const segments: (readonly [Point, Point])[] = []
  const fills: CliffBankFill[] = []
  let fillVertices = 0
  const layers = new Map<string, Map<string, CliffLatticeQuad>>()
  const key = (x: number, y: number) => `${x},${y}`
  let cells = 0,
    keyUnits = 0
  try {
    if (quads.length > MAX_NODES) throw new DistanceBudgetError('terrain registry budget exceeded')
    for (const quad of quads) {
      if (
        !Number.isSafeInteger(quad.x * 2) ||
        !Number.isSafeInteger(quad.y * 2) ||
        quad.vertices.some(
          vertex => !Number.isFinite(vertex.height) || !vertex.point.every(Number.isFinite),
        )
      )
        throw new DistanceBudgetError('invalid terrain sample/frame')
      let layer = layers.get(quad.layerId)
      if (!layer) {
        keyUnits += quad.layerId.length
        layer = new Map()
        layers.set(quad.layerId, layer)
      }
      const id = key(quad.x, quad.y)
      if (!layer.has(id)) keyUnits += id.length
      if (keyUnits > MAX_KEY_UNITS) throw new DistanceBudgetError('terrain key budget exceeded')
      layer.set(id, quad)
    }
    for (const layer of layers.values()) {
      const active = new Map<string, CliffLatticeQuad>()
      for (const [id, quad] of layer) {
        if (!quad.cliffFace || quad.ramp || quad.authoredLevels) continue
        const h = quad.vertices.map(vertex => vertex.height)
        if (Math.max(...h) === Math.min(...h)) {
          stats.flatCells++
          continue
        }
        if (++cells > MAX_CELLS) throw new DistanceBudgetError('cliff cell budget exceeded')
        active.set(id, quad)
      }
      const remaining = new Set(active.keys())
      while (remaining.size) {
        const first = remaining.values().next().value!
        const component = [active.get(first)!]
        const members = new Set([first])
        remaining.delete(first)
        for (let i = 0; i < component.length; i++) {
          const quad = component[i]!
          for (const [dx, dy] of DIRECTIONS) {
            const id = key(quad.x + dx, quad.y + dy)
            if (remaining.delete(id)) {
              component.push(active.get(id)!)
              members.add(id)
            }
          }
        }
        stats.components++
        const splitCorners = new Set<string>()
        const nodes: Node[] = [],
          ids = new Map<string, number>(),
          edgePairs = new Map<string, readonly [number, number]>()
        const grid: number[][] = []
        /** Store each geometric sample once, so adjacent cells cannot choose different thresholds. */
        const nodeAt = (quad: CliffLatticeQuad, u: number, v: number): number => {
          let id = key(quad.x * 2 + u, quad.y * 2 + v)
          if (u % 2 === 0 && v % 2 === 0) {
            const x = quad.x + u / 2,
              y = quad.y + v / 2
            const fan = [
              [x - 1, y - 1],
              [x, y - 1],
              [x, y],
              [x - 1, y],
            ].map(([a, b]) => members.has(key(a!, b!)))
            if (
              (fan[0] && fan[2] && !fan[1] && !fan[3]) ||
              (fan[1] && fan[3] && !fan[0] && !fan[2])
            ) {
              splitCorners.add(id)
              id += `/fan:${quad.x},${quad.y}`
            }
          }
          const found = ids.get(id)
          if (found !== undefined) return found
          keyUnits += id.length
          if (stats.nodes + nodes.length >= MAX_NODES || keyUnits > MAX_KEY_UNITS)
            throw new DistanceBudgetError('node registry budget exceeded')
          const s = u / 2,
            t = v / 2,
            p = quad.vertices
          const weights = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t]
          const point: Point = [0, 1].map(axis =>
            p.reduce((sum, vertex, i) => sum + vertex.point[axis]! * weights[i]!, 0),
          ) as unknown as Point
          const index = nodes.length
          nodes.push({ point, bank: 0, bankHeight: 0 })
          ids.set(id, index)
          return index
        }
        for (const quad of component) {
          const indices: number[] = []
          for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) indices.push(nodeAt(quad, x, y))
          grid.push(indices)
          for (let y = 0; y < 3; y++)
            for (let x = 0; x < 3; x++)
              for (const [dx, dy] of [
                [1, 0],
                [0, 1],
              ]) {
                if (x + dx! > 2 || y + dy! > 2) continue
                const a = indices[y * 3 + x]!,
                  b = indices[(y + dy!) * 3 + x + dx!]!,
                  id = a < b ? `${a},${b}` : `${b},${a}`
                if (!edgePairs.has(id)) {
                  keyUnits += id.length
                  if (stats.edges + edgePairs.size >= MAX_EDGES || keyUnits > MAX_KEY_UNITS)
                    throw new DistanceBudgetError('edge registry budget exceeded')
                  edgePairs.set(id, [a, b])
                }
              }
        }
        if (splitCorners.size) stats.splitCornerComponents++
        const boundaryLabels = new Map<string, number>()
        for (let i = 0; i < component.length; i++) {
          const q = component[i]!,
            indices = grid[i]!
          for (const [a, b, c, d, dx, dy] of SIDES) {
            if (members.has(key(q.x + dx, q.y + dy))) continue
            const neighbor = layer.get(key(q.x + dx, q.y + dy))
            if (neighbor?.cliffFace !== false || neighbor.ramp) {
              stats.unknownBoundaryEdges++
              continue
            }
            const delta =
              q.vertices[a].height +
              q.vertices[b].height -
              (q.vertices[c].height + q.vertices[d].height)
            if (delta === 0) {
              stats.unknownBoundaryEdges++
              continue
            }
            const bank = delta > 0 ? 2 : 1
            const midpoint = dx === 0 ? indices[dy < 0 ? 1 : 7]! : indices[dx < 0 ? 3 : 5]!
            nodes[midpoint]!.bank |= bank
            nodes[midpoint]!.bankHeight = (q.vertices[a].height + q.vertices[b].height) / 2
            for (const corner of [a, b]) {
              const cx = corner === 1 || corner === 2 ? 1 : 0,
                cy = corner >= 2 ? 1 : 0
              const id = key(q.x + cx, q.y + cy)
              boundaryLabels.set(id, (boundaryLabels.get(id) ?? 0) | bank)
            }
          }
        }
        const mixed = [...boundaryLabels.values()].filter(value => value === 3).length
        stats.mixedBoundaryVertices += mixed
        if (mixed) stats.complete = false
        const low: number[] = [],
          high: number[] = []
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i]!.bank === 1) low.push(i)
          else if (nodes[i]!.bank === 2) high.push(i)
        }
        if (!low.length || !high.length) {
          stats.oneBankComponents++
          stats.omittedComponents++
          stats.complete = false
          continue
        }
        const n = nodes.length,
          a = 2 * edgePairs.size,
          capacity = Math.max(low.length, high.length) + a
        const csrBytes = 4 * (n + 1) + 12 * a
        const fieldBytes = 44 * n + 40 * capacity
        if (!Number.isSafeInteger(csrBytes + fieldBytes) || csrBytes + fieldBytes > MAX_TYPED_BYTES)
          throw new DistanceBudgetError('typed allocation budget exceeded')
        const offsets = new Uint32Array(n + 1)
        for (const [i, j] of edgePairs.values()) {
          offsets[i + 1]!++
          offsets[j + 1]!++
        }
        for (let i = 1; i <= n; i++) offsets[i]! += offsets[i - 1]!
        const neighbors = new Uint32Array(a),
          costs = new Float64Array(a),
          cursor = offsets.slice(0, n)
        for (const [i, j] of edgePairs.values()) {
          const p = nodes[i]!.point,
            q = nodes[j]!.point,
            cost = Math.hypot(p[0] - q[0], p[1] - q[1])
          if (!(cost > 0) || !Number.isFinite(cost))
            throw new DistanceBudgetError('degenerate projected edge')
          for (const [from, to] of [
            [i, j],
            [j, i],
          ]) {
            const at = cursor[from!]!++
            neighbors[at] = to!
            costs[at] = cost
          }
        }
        /** The same shared relaxation kernel as SC2, with explicit finite derived-domain caps. */
        const field = (sources: readonly number[], heights: Float64Array) =>
          weightedDistanceField(
            n,
            sources,
            (node, emit) => {
              for (let at = offsets[node]!; at < offsets[node + 1]!; at++)
                emit(neighbors[at]!, costs[at]!)
            },
            {
              onSource: node => {
                heights[node] = nodes[node]!.bankHeight
              },
              onImprove: (from, to) => {
                heights[to] = heights[from]!
              },
              budgets: {
                queueEntries: capacity,
                pushes: sources.length + a,
                pops: sources.length + a,
                expansions: n,
                edges: a,
                comparisons: 4 * capacity * (Math.ceil(Math.log2(Math.max(1, capacity))) + 1),
                allocatedBytes: 8 * n + 20 * capacity,
              },
            },
          )
        const lowHeights = new Float64Array(n),
          highHeights = new Float64Array(n)
        const lo = field(low, lowHeights),
          hi = field(high, highHeights)
        stats.nodes += n
        stats.edges += edgePairs.size
        stats.queuePushes += lo.counters.pushes + hi.counters.pushes
        stats.peakQueue = Math.max(stats.peakQueue, lo.counters.peakQueue, hi.counters.peakQueue)
        stats.typedPeakBytes = Math.max(stats.typedPeakBytes, csrBytes + fieldBytes)
        const values = lo.distances.map((value, i) => value - hi.distances[i]!)
        const crossings = new Map<string, Point>(),
          seen = new Set<string>()
        /** Canonical edge interpolation makes every shared endpoint numerically identical. */
        const cross = (i: number, j: number): Point => {
          if (values[i] === 0) return nodes[i]!.point
          if (values[j] === 0) return nodes[j]!.point
          if (i > j) [i, j] = [j, i]
          const id = `${i},${j}`,
            found = crossings.get(id)
          if (found) return found
          const t = values[i]! / (values[i]! - values[j]!),
            p = nodes[i]!.point,
            q = nodes[j]!.point
          const point: Point = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
          crossings.set(id, point)
          return point
        }
        for (const indices of grid)
          for (let y = 0; y < 2; y++)
            for (let x = 0; x < 2; x++) {
              const corners = [
                indices[y * 3 + x]!,
                indices[y * 3 + x + 1]!,
                indices[(y + 1) * 3 + x + 1]!,
                indices[(y + 1) * 3 + x]!,
              ]
              const v = corners.map(i => values[i]!)
              if (v.some(value => !Number.isFinite(value)) || v.every(value => value === 0)) {
                stats.ambiguousCells++
                stats.complete = false
                continue
              }
              const hits: Point[] = []
              const edgeHits: (Point | undefined)[] = []
              for (let edge = 0; edge < 4; edge++) {
                const i = corners[edge]!,
                  j = corners[(edge + 1) % 4]!
                if (values[i]! >= 0 !== values[j]! >= 0) {
                  const point = cross(i, j)
                  hits.push(point)
                  edgeHits[edge] = point
                }
              }
              let determinant = 0
              if (hits.length === 4) {
                determinant = v[0]! * v[2]! - v[1]! * v[3]!
                if (determinant === 0) {
                  stats.ambiguousCells++
                  stats.complete = false
                  continue
                }
                if (determinant < 0) hits.unshift(hits.pop()!)
              }
              // Boundary walks use the very same crossings and saddle pairing as the white line.
              for (const positive of [false, true]) {
                const selected = corners.map(i => values[i]! >= 0 === positive)
                if (!selected.some(Boolean)) continue
                const fieldHeights = positive ? highHeights : lowHeights
                const height = corners.reduce((sum, i) => sum + fieldHeights[i]!, 0) / 4
                const polygons: Point[][] = []
                const disconnected =
                  hits.length === 4 && (determinant > 0 ? selected[1] : selected[0]) === true
                if (disconnected) {
                  for (let i = 0; i < 4; i++)
                    if (selected[i])
                      polygons.push([
                        nodes[corners[i]!]!.point,
                        edgeHits[i]!,
                        edgeHits[(i + 3) % 4]!,
                      ])
                } else {
                  const polygon: Point[] = []
                  for (let i = 0; i < 4; i++) {
                    if (selected[i]) polygon.push(nodes[corners[i]!]!.point)
                    if (edgeHits[i]) polygon.push(edgeHits[i]!)
                  }
                  polygons.push(polygon)
                }
                for (const points of polygons)
                  if (points.length >= 3) {
                    fillVertices += points.length
                    if (fillVertices > 2_000_000)
                      throw new DistanceBudgetError('fill vertex budget exceeded')
                    fills.push({ points, height, side: positive ? 'high' : 'low' })
                  }
              }
              for (let i = 0; i + 1 < hits.length; i += 2) {
                const p = hits[i]!,
                  q = hits[i + 1]!
                if (p[0] === q[0] && p[1] === q[1]) continue
                const pk = JSON.stringify(p),
                  qk = JSON.stringify(q),
                  id = pk < qk ? `${pk}/${qk}` : `${qk}/${pk}`
                if (!seen.has(id)) {
                  seen.add(id)
                  segments.push([p, q])
                }
              }
            }
      }
    }
    if (stats.flatCells || stats.unknownBoundaryEdges) stats.complete = false
  } catch (error) {
    if (!(error instanceof DistanceBudgetError)) throw error
    stats.budgetExceeded = error.reason.includes('budget')
    stats.refusalReason = error.reason
    stats.complete = false
    return { segments: [], fills: [], stats }
  }
  return { segments, fills, stats }
}
