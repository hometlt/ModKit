import { describe, expect, it } from 'vitest'
import type { PageRequest, RelationGraphSource } from '@modkitx-x3/sdk'
import { loadRelationGraphOptions } from '../src/graph/index.js'

function page<T>(items: readonly T[], request: PageRequest) {
  const offset = request.cursor === undefined ? 0 : Number(request.cursor)
  const end = Math.min(items.length, offset + request.limit)
  return {
    items: items.slice(offset, end),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  }
}

describe('relation graph data-source adapter', () => {
  it('loads bounded pages while preserving full-graph counts and dead references', async () => {
    const nodes = [
      { id: 'a', label: 'A', type: 'entity' },
      { id: 'b', label: 'B', type: 'entity' },
      { id: 'missing', label: 'Missing C', type: 'unresolved' },
    ] as const
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'missing', role: 'reference', dead: true },
    ] as const
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'fixture-v1',
          totalNodes: nodes.length,
          totalEdges: edges.length,
          completeness: 'complete',
          types: [
            { id: 'entity', label: 'Entities', count: 2, tone: 0 },
            { id: 'unresolved', label: 'Invalid references', count: 1, tone: 1 },
          ],
        }
      },
      async nodes(request) {
        return page(nodes, request)
      },
      async edges(request) {
        return page(edges, request)
      },
    }

    const complete = await loadRelationGraphOptions(source, {
      label: 'fixture',
      nodeLimit: 10,
      edgeLimit: 10,
      pageSize: 1,
    })
    expect(complete).toMatchObject({
      totalNodes: 3,
      totalEdges: 2,
      sourceCompleteness: 'complete',
    })
    expect(complete.edges[1]).toMatchObject({ dead: true, role: 'reference' })

    const capped = await loadRelationGraphOptions(source, {
      label: 'fixture',
      nodeLimit: 2,
      edgeLimit: 1,
    })
    expect(capped.nodes).toHaveLength(2)
    expect(capped.edges).toHaveLength(1)
    expect(capped.sourceCompleteness).toBe('capped')
    expect(capped.types.find(type => type.id === 'entity')?.count).toBe(2)
  })
})
