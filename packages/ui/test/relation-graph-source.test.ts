import { describe, expect, it } from 'vitest'
import type { PageRequest, RelationGraphSource } from '@modkit/sdk'
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
      consumerCompleteness: 'complete',
    })
    expect(complete.edges[1]).toMatchObject({ dead: true, role: 'reference' })

    const capped = await loadRelationGraphOptions(source, {
      label: 'fixture',
      nodeLimit: 2,
      edgeLimit: 1,
    })
    expect(capped.nodes).toHaveLength(2)
    expect(capped.edges).toHaveLength(1)
    expect(capped.sourceCompleteness).toBe('complete')
    expect(capped.consumerCompleteness).toBe('capped')
    expect(capped.consumerReason).toBe('loaded 2 of 3 nodes and 1 of 2 edges')
    expect(capped.types.find(type => type.id === 'entity')?.count).toBe(2)
  })

  it('preserves producer partial state and reason separately from the bounded view', async () => {
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'partial-v1',
          totalNodes: 3,
          totalEdges: 0,
          completeness: 'partial',
          reason: 'dependency catalogue was unavailable',
          types: [{ id: 'entity', label: 'Entities', count: 3, tone: 0 }],
        }
      },
      async nodes() {
        return { items: [{ id: 'a', label: 'A', type: 'entity' }] }
      },
      async edges() {
        return { items: [] }
      },
    }

    const loaded = await loadRelationGraphOptions(source, { label: 'partial fixture' })
    expect(loaded).toMatchObject({
      sourceCompleteness: 'partial',
      sourceReason: 'dependency catalogue was unavailable',
      consumerCompleteness: 'partial',
      consumerReason: 'loaded 1 of 3 nodes and 0 of 0 edges',
    })
  })

  it('reports a consumer cap when the reported total exceeds an exactly full limit', async () => {
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'full-limit-v1',
          totalNodes: 3,
          totalEdges: 0,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: 3, tone: 0 }],
        }
      },
      async nodes() {
        return {
          items: [
            { id: 'a', label: 'A', type: 'entity' },
            { id: 'b', label: 'B', type: 'entity' },
          ],
        }
      },
      async edges() {
        return { items: [] }
      },
    }

    const loaded = await loadRelationGraphOptions(source, {
      label: 'full-limit fixture',
      nodeLimit: 2,
    })
    expect(loaded.consumerCompleteness).toBe('capped')
    expect(loaded.consumerReason).toBe('loaded 2 of 3 nodes and 0 of 0 edges')
  })

  it('never materializes more than its declared bounds even when a source overproduces', async () => {
    const nodes = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      label: `Node ${index}`,
      type: 'entity',
    }))
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'overproducing-v1',
          totalNodes: nodes.length,
          totalEdges: 0,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: nodes.length, tone: 0 }],
        }
      },
      async nodes() {
        return { items: nodes }
      },
      async edges() {
        return { items: [] }
      },
    }

    const loaded = await loadRelationGraphOptions(source, {
      label: 'bounded fixture',
      nodeLimit: 5,
      pageSize: 2,
    })
    expect(loaded.nodes).toHaveLength(2)
    expect(loaded.consumerCompleteness).toBe('capped')
    expect(loaded.consumerReason).toBe('loaded 2 of 10 nodes and 0 of 0 edges')
  })

  it('rejects a repeated page cursor instead of looping', async () => {
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'cursor-v1',
          totalNodes: 3,
          totalEdges: 0,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: 3, tone: 0 }],
        }
      },
      async nodes() {
        return {
          items: [{ id: 'a', label: 'A', type: 'entity' }],
          nextCursor: 'same',
        }
      },
      async edges() {
        return { items: [] }
      },
    }

    await expect(
      loadRelationGraphOptions(source, { label: 'cursor fixture', pageSize: 1 }),
    ).rejects.toThrow('relation graph source repeated a page cursor')
  })

  it('rejects an empty page with a continuation cursor instead of following it forever', async () => {
    let cursor = 0
    const source: RelationGraphSource = {
      async summary() {
        return {
          snapshotId: 'empty-page-v1',
          totalNodes: 1,
          totalEdges: 0,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: 1, tone: 0 }],
        }
      },
      async nodes() {
        cursor += 1
        return { items: [], nextCursor: String(cursor) }
      },
      async edges() {
        return { items: [] }
      },
    }

    await expect(loadRelationGraphOptions(source, { label: 'empty-page fixture' })).rejects.toThrow(
      'relation graph source returned an empty page with a continuation cursor',
    )
    expect(cursor).toBe(1)
  })

  it('observes cancellation between pages even when the source omits its own check', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const source: RelationGraphSource = {
      async summary(signal) {
        observedSignal = signal
        return {
          snapshotId: 'cancel-v1',
          totalNodes: 2,
          totalEdges: 0,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: 2, tone: 0 }],
        }
      },
      async nodes() {
        controller.abort(new Error('cancelled graph load'))
        return {
          items: [{ id: 'a', label: 'A', type: 'entity' }],
          nextCursor: '1',
        }
      },
      async edges() {
        return { items: [] }
      },
    }

    await expect(
      loadRelationGraphOptions(source, {
        label: 'cancel fixture',
        pageSize: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled graph load')
    expect(observedSignal).toBe(controller.signal)
  })
})
