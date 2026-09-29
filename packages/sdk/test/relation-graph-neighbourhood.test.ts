import { describe, expect, it } from 'vitest'
import type {
  RelationGraphEdge,
  RelationGraphNode,
  RelationGraphSource,
} from '../src/asset-capabilities/data-sources.js'
import { relationGraphNeighbourhood } from '../src/relation-graph-neighbourhood.js'

// Marine uses its weapon, the weapon its effect, the effect a sound; a Barracks trains the Marine.
const nodes: RelationGraphNode[] = [
  { id: 'Unit/Marine', label: 'Marine', type: 'Unit' },
  { id: 'Weapon/GaussRifle', label: 'Gauss Rifle', type: 'Weapon' },
  { id: 'Effect/GaussRifle', label: 'Gauss Rifle damage', type: 'Effect' },
  { id: 'Sound/Gauss', label: 'Gauss sound', type: 'Sound' },
  { id: 'Unit/Barracks', label: 'Barracks', type: 'Unit' },
  { id: 'Actor/Marine', label: 'Marine actor', type: 'Actor' },
]
const edges: RelationGraphEdge[] = [
  { from: 'Unit/Marine', to: 'Weapon/GaussRifle', role: 'weapon' },
  { from: 'Weapon/GaussRifle', to: 'Effect/GaussRifle', role: 'effect' },
  { from: 'Effect/GaussRifle', to: 'Sound/Gauss', role: 'sound' },
  { from: 'Unit/Barracks', to: 'Unit/Marine', role: 'trains' },
  { from: 'Actor/Marine', to: 'Unit/Marine', role: 'unit' },
]

function source(options: { pageSize?: number; loopCursor?: boolean } = {}): RelationGraphSource {
  const size = options.pageSize ?? 2
  const page = <T>(items: readonly T[], cursor: string | undefined, limit: number) => {
    const start = cursor === undefined ? 0 : Number(cursor)
    const taken = items.slice(start, start + Math.min(limit, size))
    const next = start + taken.length
    return {
      items: taken,
      ...(next < items.length
        ? { nextCursor: options.loopCursor === true ? '0' : String(next) }
        : {}),
    }
  }
  return {
    summary: async () => ({
      snapshotId: 'liberty@1',
      totalNodes: nodes.length,
      totalEdges: edges.length,
      types: [],
      completeness: 'complete',
    }),
    nodes: async request => page(nodes, request.cursor, request.limit),
    edges: async request => page(edges, request.cursor, request.limit),
  }
}

const request = {
  roots: ['Unit/Marine'],
  depth: 2,
  direction: 'outgoing' as const,
  maxNodes: 100,
  maxEdges: 100,
  scanLimit: 1000,
}
const ids = (items: readonly { id: string }[]) => items.map(item => item.id).sort()

describe('the neighbourhood of a root in a relation graph', () => {
  it('walks two edges out from Marine, reading every page', async () => {
    const walk = await relationGraphNeighbourhood(source(), request)
    expect(ids(walk.nodes)).toEqual(['Effect/GaussRifle', 'Unit/Marine', 'Weapon/GaussRifle'])
    expect(walk.edges.map(edge => edge.role)).toEqual(['weapon', 'effect'])
    expect(walk.completeness).toBe('complete')
    expect(walk.scanned.edges).toEqual({ read: 5, exhausted: true, invalidCursor: false })
  })

  it('follows what uses the root, and keeps only the types asked for', async () => {
    const incoming = await relationGraphNeighbourhood(source(), {
      ...request,
      depth: 1,
      direction: 'incoming',
    })
    expect(ids(incoming.nodes)).toEqual(['Actor/Marine', 'Unit/Barracks', 'Unit/Marine'])
    const units = await relationGraphNeighbourhood(source(), {
      ...request,
      depth: 3,
      direction: 'both',
      types: ['Unit', 'Weapon'],
    })
    expect(ids(units.nodes)).toEqual(['Unit/Barracks', 'Unit/Marine', 'Weapon/GaussRifle'])
    expect(units.edges.every(edge => edge.role !== 'unit' && edge.role !== 'effect')).toBe(true)
  })

  it('says where it stopped: a node limit, a scan limit, a repeated cursor', async () => {
    const capped = await relationGraphNeighbourhood(source(), { ...request, maxNodes: 2 })
    expect(capped).toMatchObject({ capped: true, completeness: 'capped' })
    expect(capped.nodes).toHaveLength(2)
    const scanned = await relationGraphNeighbourhood(source(), { ...request, scanLimit: 1 })
    expect(scanned.completeness).toBe('capped')
    expect(scanned.scanned.edges).toMatchObject({ read: 1, exhausted: false })
    const looping = await relationGraphNeighbourhood(source({ loopCursor: true }), request)
    expect(looping.completeness).toBe('partial')
    expect(looping.scanned.nodes.invalidCursor).toBe(true)
    await expect(relationGraphNeighbourhood(source(), { ...request, depth: 9 })).rejects.toThrow(
      /depth/u,
    )
  })
})
