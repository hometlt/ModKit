import { describe, expect, it } from 'vitest'

import { createOrbitController } from '../src/model/orbit.js'
import {
  depthFade,
  frame,
  layoutGalaxyGraph,
  layoutRelationGraph,
  pick,
  project,
  unproject,
  type Camera,
} from '../src/graph/projection.js'

const nodes = [
  { id: 'unit/Marine', type: 'unit' },
  { id: 'weapon/Gauss', type: 'weapon' },
  { id: 'effect/Damage', type: 'effect' },
  { id: 'upgrade/Weapons', type: 'upgrade' },
  { id: 'actor/Marine', type: 'actor' },
]
const edges = [
  { from: 'unit/Marine', to: 'weapon/Gauss' },
  { from: 'weapon/Gauss', to: 'effect/Damage' },
  { from: 'upgrade/Weapons', to: 'effect/Damage' },
  { from: 'actor/Marine', to: 'unit/Marine' },
]

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value')
  return value
}

const round = (points: readonly (readonly number[])[]) =>
  points.map(point => point.map(value => Math.round(value)))

function cameraFor(target: readonly number[], distance: number): Camera {
  const orbit = createOrbitController({ yaw: 0, pitch: 0 })
  return {
    target,
    eye: orbit.position(target, distance),
    basis: orbit.basis(),
    width: 400,
    height: 300,
  }
}

describe('relation graph pseudo-3D layout (MK2 port)', () => {
  it('is deterministic and pins the root at the origin', () => {
    const first = layoutRelationGraph({ nodes, edges })
    const second = layoutRelationGraph({ nodes, edges })
    expect(second).toEqual(first)
    expect(first[0]).toEqual([0, 0, 0])
    // Produced by MK2's original THREE.Vector3 implementation on the same fixture (hop depths
    // 0,1,2,3,1): the port must stay bit-for-bit on its trajectory.
    expect(round(first)).toEqual([
      [0, 0, 0],
      [177, 215, -116],
      [-89, 16, -207],
      [-51, -111, 265],
      [176, -340, -13],
    ])
  })

  it('stays finite when nodes coincide', () => {
    const twins = [defined(nodes[0]), { id: 'twin', type: 'unit' }, { id: 'twin', type: 'unit' }]
    for (const point of layoutRelationGraph({ nodes: twins, edges })) {
      expect(point.every(Number.isFinite)).toBe(true)
    }
  })

  it('switches to the clustered galaxy layout past the force limit', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({
      id: `n${index}`,
      type: `t${index % 4}`,
    }))
    const positions = layoutRelationGraph({ nodes: many, edges: [] })
    expect(positions).toEqual(layoutGalaxyGraph({ nodes: many, edges: [] }))
    expect(positions[0]).toEqual([0, 0, 0])
    expect(layoutGalaxyGraph({ nodes: many, edges: [], clustered: true })[0]).not.toEqual([0, 0, 0])
  })

  it('frames like MK2 resetView', () => {
    expect(frame([])).toEqual({ center: [0, 0, 0], distance: 360 })
    const framing = frame([
      [-500, 0, 0],
      [500, 0, 0],
    ])
    expect(framing.center).toEqual([0, 0, 0])
    expect(framing.distance).toBeCloseTo(1225, 6)
  })
})

describe('relation graph perspective projection', () => {
  const camera = cameraFor([0, 0, 0], 500)
  const at = (point: readonly [number, number, number]) => defined(project(point, camera))

  it('projects the target to the centre and shrinks with depth', () => {
    const centre = at([0, 0, 0])
    expect(centre.x).toBeCloseTo(200, 6)
    expect(centre.y).toBeCloseTo(150, 6)
    expect(centre.depth).toBeCloseTo(500, 6)
    const near = at([0, 0, 200])
    const far = at([0, 0, -200])
    expect(near.scale).toBeGreaterThan(centre.scale)
    expect(far.scale).toBeLessThan(centre.scale)
    const right = at([100, 100, 0])
    expect(right.x).toBeGreaterThan(200)
    expect(right.y).toBeLessThan(150)
    expect(project([0, 0, 600], camera)).toBeUndefined()
  })

  it('round-trips a pixel drag through unproject', () => {
    const offset = unproject(30, -20, 500, camera)
    const moved = at(offset)
    expect(moved.x).toBeCloseTo(230, 6)
    expect(moved.y).toBeCloseTo(130, 6)
  })

  it('fades with depth down to the floor', () => {
    expect(depthFade(100, 100, 300)).toBe(1)
    expect(depthFade(300, 100, 300)).toBeCloseTo(0.25, 6)
    expect(depthFade(5, 5, 5)).toBe(1)
  })
})

describe('relation graph hit testing', () => {
  it('picks the nearest node under the pointer and ignores culled ones', () => {
    const camera = cameraFor([0, 0, 0], 500)
    const world: (readonly [number, number, number])[] = [
      [0, 0, 0],
      [0, 0, 100],
      [300, 0, 0],
      [0, 0, 700],
    ]
    const hits = world.map(point => {
      const projected = project(point, camera)
      return projected && { ...projected, radius: 6 * projected.scale }
    })
    expect(hits[3]).toBeUndefined()
    const side = defined(hits[2])
    // Nodes 0 and 1 overlap at the centre; the nearer one wins.
    expect(pick(hits, 200, 150)).toBe(1)
    expect(pick(hits, side.x + 2, side.y - 2)).toBe(2)
    expect(pick(hits, 5, 5)).toBe(-1)
    // Slop extends the disc by a few pixels, no more.
    const edge = side.x + side.radius + 2
    expect(pick(hits, edge, side.y)).toBe(2)
    expect(pick(hits, edge + 5, side.y)).toBe(-1)
  })
})
