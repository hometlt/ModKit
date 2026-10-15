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
