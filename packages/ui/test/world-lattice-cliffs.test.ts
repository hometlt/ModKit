import { describe, it, expect } from 'vitest'
import { deriveCliffMidlines, type CliffLatticeQuad } from '../src/world/lattice-cliffs.js'

/** Full neighboring ground qualifies both banks; unequal reflected horizontal axes test coordinates. */
function strip(width = 3, rotate = 0): CliffLatticeQuad[] {
  const result: CliffLatticeQuad[] = []
  const point = (x: number, y: number): readonly [number, number] => {
    const a = 2 * x,
      b = -3 * y
    return [
      a * Math.cos(rotate) - b * Math.sin(rotate),
      a * Math.sin(rotate) + b * Math.cos(rotate),
    ]
  }
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < width + 4; x++)
      result.push({
        layerId: 'ground',
        x,
        y,
        vertices: [
          [x, y],
          [x + 1, y],
          [x + 1, y + 1],
          [x, y + 1],
        ].map(([a, b]) => ({
          point: point(a!, b!),
          height: Math.max(0, Math.min(width, a! - 2)) * 20,
        })) as unknown as CliffLatticeQuad['vertices'],
        cliffFace: x >= 2 && x < width + 2 && y >= 1 && y < 4,
        ramp: false,
        authoredLevels: false,
      })
  return result
}
describe('shared bank-distance cliff midline', () => {
  it('treats known tangent edges as neutral without inventing a missing bank', () => {
    const result = deriveCliffMidlines(strip())
    expect(result.stats.neutralBoundaryEdges).toBeGreaterThan(0)
    expect(result.stats.unknownBoundaryEdges).toBe(0)
    expect(result.stats.ambiguousCells).toBe(0)
    expect(result.segments.length).toBeGreaterThan(0)
    const incomplete = deriveCliffMidlines(strip().filter(q => q.x !== 1))
    expect(incomplete.stats.unknownBoundaryEdges).toBeGreaterThan(0)
  })

  it('resolves a clipped bank at the edge of a complete rectangle without inventing missing pages', () => {
    const clipped = strip(3).filter(q => q.x >= 2)
    const result = deriveCliffMidlines(clipped)
    expect(result.stats.oneBankComponents).toBe(0)
    expect(result.segments.length).toBeGreaterThan(0)
    for (const segment of result.segments)
      for (const point of segment) expect(point[0]).toBeCloseTo(7, 10)
    const hole = clipped.filter(q => q.x !== 3 || q.y !== 0)
    expect(deriveCliffMidlines(hole).stats.oneBankComponents).toBeGreaterThan(0)
  })
  it.each([1, -1])('retains a point bank at an internal summit/depression with sign %i', sign => {
    const quads = strip().map(q => ({ ...q,
      cliffFace: q.x >= 2 && q.x < 4 && q.y >= 1 && q.y < 3,
      vertices: q.vertices.map(v => ({ ...v,
        height: v.point[0] === 6 && v.point[1] === -6 ? sign * 40 : 0,
      })) as unknown as CliffLatticeQuad['vertices'],
    }))
    const result = deriveCliffMidlines(quads)
    expect(result.stats.oneBankComponents).toBe(0)
    expect(result.segments.length).toBeGreaterThan(0)
    expect(new Set(result.fills.map(fill => fill.height))).toEqual(new Set([0, sign * 40]))
  })
  it('keeps an internal bank when one transverse endpoint has a flat shoulder', () => {
    const quads = strip(4).map(q => ({
      ...q,
      vertices: q.vertices.map(v => {
        const x = v.point[0] / 2,
          y = -v.point[1] / 3
        return { ...v, height: x === 3 && y === 2 ? 0 : Math.min(40, Math.abs(x - 4) * 20) }
      }) as unknown as CliffLatticeQuad['vertices'],
    }))
    const result = deriveCliffMidlines(quads)
    expect(result.stats.internalBankEdges).toBeGreaterThanOrEqual(3)
    expect(result.stats.oneBankComponents).toBe(0)
    expect(result.segments.some(s => s.every(p => p[0] < 8))).toBe(true)
    expect(result.segments.some(s => s.every(p => p[0] > 8))).toBe(true)
  })
  it.each([false, true])(
    'retains both cliffs of an internal %s ridge/trough without an unflagged bank',
    inverted => {
      const quads = strip(4).map(q => ({
        ...q,
        vertices: q.vertices.map(v => {
          const x = v.point[0] / 2
          const height = Math.min(40, Math.abs(x - 4) * 20)
          return { ...v, height: inverted ? 40 - height : height }
        }) as unknown as CliffLatticeQuad['vertices'],
      }))
      const result = deriveCliffMidlines(quads)
      expect(result.stats.internalBankEdges).toBe(3)
      expect(result.stats.oneBankComponents).toBe(0)
      const xs = new Set(result.segments.flatMap(segment => segment.map(p => p[0])))
      expect([...xs].sort((a, b) => a - b)).toEqual([6, 10])
      expect(result.fills.length).toBeGreaterThan(0)
      for (const fill of result.fills) expect(fill.height).toBe(fill.side === 'low' ? 0 : 40)
    },
  )
  it('partitions the entire slope into bank-height fills with no area overlap or holes', () => {
    const plan = deriveCliffMidlines(strip(3))
    const area = (points: readonly (readonly [number, number])[]) =>
      Math.abs(
        points.reduce((sum, p, i) => {
          const q = points[(i + 1) % points.length]!
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0) / 2,
      )
    for (const side of ['low', 'high'] as const) {
      const fills = plan.fills.filter(fill => fill.side === side)
      expect(fills.reduce((sum, fill) => sum + area(fill.points), 0)).toBeCloseTo(27, 10)
      for (const fill of fills) {
        expect(fill.height).toBe(side === 'low' ? 0 : 60)
        for (const p of fill.points) expect(side === 'low' ? p[0] <= 7 : p[0] >= 7).toBe(true)
      }
    }
    const boundary = new Set(plan.fills.flatMap(fill => fill.points.map(p => JSON.stringify(p))))
    for (const segment of plan.segments)
      for (const p of segment) expect(boundary.has(JSON.stringify(p))).toBe(true)
  })
  it('takes the high side from heights rather than polygon inside/outside winding', () => {
    const plan = deriveCliffMidlines(
      strip(3).map(q => ({
        ...q,
        vertices: q.vertices.map(v => ({
          ...v,
          height: 60 - v.height,
        })) as unknown as CliffLatticeQuad['vertices'],
      })),
    )
    for (const fill of plan.fills) {
      expect(fill.height).toBe(fill.side === 'low' ? 0 : 60)
      for (const p of fill.points) expect(fill.side === 'low' ? p[0] >= 7 : p[0] <= 7).toBe(true)
    }
  })
  it('keeps a diagonal bank strip centered through shared cell edges', () => {
    const quads: CliffLatticeQuad[] = []
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++)
        quads.push({
          layerId: 'diagonal',
          x,
          y,
          vertices: [
            [x, y],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
          ].map(([a, b]) => ({
            point: [2 * a!, -3 * b!] as const,
            height: 20 * Math.max(0, Math.min(3, a! - b!)),
          })) as unknown as CliffLatticeQuad['vertices'],
          cliffFace: x - y >= 0 && x - y < 3,
          ramp: false,
          authoredLevels: false,
        })
    // The geometric strip occupies cell diagonals 0,1,2: its axis is x-y=1, not half-height 1.5.
    const plan = deriveCliffMidlines(quads)
    expect(plan.segments.length).toBeGreaterThan(10)
    for (const segment of plan.segments)
      for (const [x, y] of segment)
        if (x > 8 && x < 18 && y < -6 && y > -24) expect(x / 2 + y / 3).toBeCloseTo(1, 8)
  })
  it('separates opposite corner fans even when the component joins them by another route', () => {
    const faces = new Set(['1,1', '1,0', '2,0', '3,0', '3,1', '3,2', '2,2'])
    const quads = strip(3).map(q => ({
      ...q,
      cliffFace: faces.has(`${q.x},${q.y}`),
      vertices: q.vertices.map(v => ({
        ...v,
        height: v.point[0] / 2 - v.point[1] / 3,
      })) as unknown as CliffLatticeQuad['vertices'],
    }))
    const plan = deriveCliffMidlines(quads)
    expect(plan.stats.splitCornerComponents).toBe(1)
    expect(plan.stats.omittedComponents).toBe(0)
    expect(plan.segments.length).toBeGreaterThan(0)
  })
  it('refuses the terrain registry budget before constructing the graph', () => {
    const q = strip()[0]!
    const plan = deriveCliffMidlines(Array.from({ length: 250001 }, () => q))
    expect(plan.segments).toEqual([])
    expect(plan.stats.budgetExceeded).toBe(true)
    expect(plan.stats.nodes).toBe(0)
  })
  it.each([1, 3, 5])(
    'draws ONE centered line across a %i-cell uniform slope without seams',
    width => {
      const plan = deriveCliffMidlines(strip(width))
      expect(plan.stats.internalBankEdges).toBe(0)
      expect(plan.stats.budgetExceeded).toBe(false)
      expect(plan.segments.length).toBeGreaterThan(0)
      for (const segment of plan.segments)
        for (const p of segment) expect(p[0]).toBeCloseTo(4 + width, 10)
      const endpoints = new Map<string, number>()
      for (const segment of plan.segments)
        for (const p of segment) {
          const key = JSON.stringify(p)
          endpoints.set(key, (endpoints.get(key) ?? 0) + 1)
        }
      expect([...endpoints.values()].filter(n => n === 1)).toHaveLength(2)
      expect([...endpoints.values()].every(n => n === 1 || n === 2)).toBe(true)
    },
  )
  it('is invariant under rigid rotation of the physical horizontal frame', () => {
    const angle = Math.PI / 4,
      plan = deriveCliffMidlines(strip(3, angle))
    for (const segment of plan.segments)
      for (const [x, y] of segment)
        expect(x * Math.cos(angle) + y * Math.sin(angle)).toBeCloseTo(7, 10)
  })
  it('preserves layer isolation and ignores duplicated quads', () => {
    const a = strip(),
      one = deriveCliffMidlines(a)
    expect(deriveCliffMidlines([...a, ...a]).segments).toEqual(one.segments)
    const two = deriveCliffMidlines([...a, ...a.map(q => ({ ...q, layerId: 'other' }))])
    expect(two.segments).toHaveLength(2 * one.segments.length)
  })
  it('does not cross an explicitly published ramp gap', () => {
    const plan = deriveCliffMidlines(strip().map(q => ({ ...q, ramp: q.y === 2 })))
    expect(plan.segments.length).toBeGreaterThan(0)
    for (const [a, b] of plan.segments)
      expect((a[1] + b[1]) / 2 > -9 && (a[1] + b[1]) / 2 < -6).toBe(false)
  })
  it('omits flat flags and missing banks instead of falling back to a perimeter', () => {
    const flat = strip().map(q => ({
      ...q,
      vertices: q.vertices.map(v => ({
        ...v,
        height: 0,
      })) as unknown as CliffLatticeQuad['vertices'],
    }))
    expect(deriveCliffMidlines(flat).segments).toEqual([])
    const missing = strip().filter(q => q.x !== 1)
    const plan = deriveCliffMidlines(missing)
    expect(plan.segments).toEqual([])
    expect(plan.stats.oneBankComponents).toBe(1)
    expect(plan.stats.complete).toBe(false)
  })
  it('retains authored level contours as the authority', () => {
    expect(
      deriveCliffMidlines(strip().map(q => ({ ...q, authoredLevels: true }))).segments,
    ).toEqual([])
  })
})
