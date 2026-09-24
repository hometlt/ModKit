/**
 * Resources as the chain of loaded mods: one node per package in load order, each expanding into
 * that package's own tree. The layers here are plain tree data sources, because that is all a layer
 * is — the chain knows nothing about SC2, only about order.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TreeDataSource, TreeNodeFacts, TreeNodeRef } from '@modkit/sdk'

import {
  createChainTreeDataSource,
  createFileListTree,
  LAYER_KIND,
  OPENED_LAYER_KIND,
  type ResourceChainLayer,
} from '../src/resource-chain.js'

interface Node {
  readonly id: string
  readonly label: string
  readonly preview?: string
  readonly children?: readonly Node[]
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected test fixture value')
  return value
}

function treeOf(nodes: readonly Node[], rootId = 'root'): TreeDataSource {
  const index = new Map<string, Node>()
  const walk = (items: readonly Node[]) => {
    for (const item of items) {
      index.set(item.id, item)
      walk(item.children ?? [])
    }
  }
  walk(nodes)
  const childrenOf = (id: string): readonly Node[] =>
    id === rootId ? nodes : (index.get(id)?.children ?? [])
  return {
    async root() {
      return { id: rootId, hasChildren: true }
    },
    async children(node: TreeNodeRef, request) {
      const items = childrenOf(node.id)
      const start = request.cursor === undefined ? 0 : Number(request.cursor)
      const slice = items.slice(start, start + request.limit)
      return {
        items: slice.map(item => ({ id: item.id, hasChildren: (item.children ?? []).length > 0 })),
        ...(start + slice.length < items.length
          ? { nextCursor: String(start + slice.length) }
          : {}),
      }
    },
    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      const found = index.get(node.id)
      if (found === undefined) throw new TypeError(`unknown ${node.id}`)
      return {
        kind: 'x',
        label: found.label,
        ...(found.preview === undefined ? {} : { preview: found.preview }),
      }
    },
    async *search(query) {
      for (const node of index.values()) {
        if (node.label.toLowerCase().includes(query.pattern.toLowerCase())) {
          yield { id: node.id, hasChildren: (node.children ?? []).length > 0 }
        }
      }
    },
  }
}

const layerOf = (
  label: string,
  nodes: readonly Node[],
  opened?: () => void,
): ResourceChainLayer => ({
  label,
  detail: label === 'Mine' ? 'opened' : 'dependency',
  ...(label === 'Mine' ? { opened: true } : {}),
  async open() {
    opened?.()
    return { value: treeOf(nodes), release: async () => undefined }
  },
})

async function labels(
  tree: ReturnType<typeof createChainTreeDataSource>,
  node: TreeNodeRef,
): Promise<string[]> {
  const answer = await tree.children(node, { limit: 100 })
  return Promise.all(answer.items.map(async item => (await tree.facts(item)).label))
}

describe('Resources as the chain of loaded mods', () => {
  it('lists the mods in load order and marks the opened one', async () => {
    const tree = createChainTreeDataSource([
      layerOf('Core', [{ id: 'data', label: 'GameData' }]),
      layerOf('Mine', [{ id: 'data', label: 'GameData' }]),
    ])
    const root = await tree.root()
    const layers = (await tree.children(root, { limit: 10 })).items
    expect(await labels(tree, root)).toEqual(['Core', 'Mine'])
    expect(await tree.facts(required(layers[0]))).toMatchObject({
      kind: LAYER_KIND,
      preview: 'dependency',
    })
    expect(await tree.facts(required(layers[1]))).toMatchObject({
      kind: OPENED_LAYER_KIND,
      preview: 'opened',
    })
    await tree.dispose()
  })

  it('expands each mod into its own tree without merging equal ids', async () => {
    const tree = createChainTreeDataSource([
      layerOf('Core', [
        { id: 'data', label: 'GameData', children: [{ id: 'unit', label: 'Unit (500)' }] },
      ]),
      layerOf('Mine', [
        { id: 'data', label: 'GameData', children: [{ id: 'unit', label: 'Unit (2)' }] },
      ]),
    ])
    const [core, mine] = (await tree.children(await tree.root(), { limit: 10 })).items
    const coreData = required((await tree.children(required(core), { limit: 10 })).items[0])
    const mineData = required((await tree.children(required(mine), { limit: 10 })).items[0])
    expect(coreData.id).not.toBe(mineData.id)
    expect(await labels(tree, coreData)).toEqual(['Unit (500)'])
    expect(await labels(tree, mineData)).toEqual(['Unit (2)'])
    await tree.dispose()
  })

  it('opens a mod only when something asks for its children', async () => {
    const opened = vi.fn()
    const tree = createChainTreeDataSource([
      layerOf('Core', [{ id: 'data', label: 'GameData' }], opened),
      layerOf('Mine', [{ id: 'data', label: 'GameData' }]),
    ])
    const [core] = (await tree.children(await tree.root(), { limit: 10 })).items
    await tree.facts(required(core))
    expect(opened).not.toHaveBeenCalled()
    await tree.children(required(core), { limit: 10 })
    expect(opened).toHaveBeenCalledTimes(1)
    await tree.dispose()
  })

  it('shows an unavailable mod as an empty, marked node', async () => {
    const tree = createChainTreeDataSource([
      { label: 'Core', detail: 'dependency', open: async () => undefined },
      layerOf('Mine', [{ id: 'data', label: 'GameData' }]),
    ])
    const root = await tree.root()
    const [core] = (await tree.children(root, { limit: 10 })).items
    expect((await tree.children(required(core), { limit: 10 })).items).toEqual([])
    expect(await tree.facts(required(core))).toMatchObject({ preview: 'dependency · unavailable' })
    expect((await tree.facts(root)).preview).toBe('2 mods · 1 unavailable')
    await tree.dispose()
  })

  it('pages a large mod through the provider cursor', async () => {
    const nodes = Array.from({ length: 50_001 }, (_, index) => ({
      id: String(index),
      label: String(index),
    }))
    const tree = createChainTreeDataSource([layerOf('Mine', nodes)])
    const [mine] = (await tree.children(await tree.root(), { limit: 10 })).items
    const first = await tree.children(required(mine), { limit: 50_000 })
    expect(first.items).toHaveLength(50_000)
    const tail = await tree.children(required(mine), {
      limit: 20,
      cursor: required(first.nextCursor),
    })
    expect(tail.items).toHaveLength(1)
    expect(await tree.facts(required(tail.items[0]))).toMatchObject({ label: '50000' })
    expect(tail.nextCursor).toBeUndefined()
    await tree.dispose()
  })

  it('searches every mod and answers with a node of the mod that holds it', async () => {
    const tree = createChainTreeDataSource([
      layerOf('Core', [{ id: 'marine', label: 'Marine' }]),
      layerOf('Mine', [{ id: 'marine', label: 'Marine' }]),
    ])
    const found: TreeNodeRef[] = []
    for await (const node of tree.search({ pattern: 'marine' })) found.push(node)
    expect(found).toHaveLength(2)
    expect(new Set(found.map(node => node.id)).size).toBe(2)
    for (const node of found) expect((await tree.facts(node)).label).toBe('Marine')
    await tree.dispose()
  })

  it('lists the files of a layer no package codec opens, each opening its own subject', async () => {
    const tree = createFileListTree(['b/Tool.BlizWiz', 'A.BlizWiz'], path => `root?vfs-path=${path}`)
    const page = await tree.children(await tree.root(), { limit: 10 })
    const facts = await Promise.all(page.items.map(item => tree.facts(item)))
    expect(facts.map(item => [item.label, item.subjectId])).toEqual([
      ['A.BlizWiz', 'root?vfs-path=A.BlizWiz'],
      ['b/Tool.BlizWiz', 'root?vfs-path=b/Tool.BlizWiz'],
    ])
  })

  it('surfaces operational failure and retries instead of caching it', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({
        value: treeOf([{ id: 'data', label: 'Data' }]),
        release: async () => undefined,
      })
    const tree = createChainTreeDataSource([{ label: 'Mine', detail: 'opened', open }])
    const [mine] = (await tree.children(await tree.root(), { limit: 10 })).items
    await expect(tree.children(required(mine), { limit: 10 })).rejects.toThrow('temporary failure')
    expect((await tree.children(required(mine), { limit: 10 })).items).toHaveLength(1)
    await tree.dispose()
  })

  it('propagates cancellation', async () => {
    const controller = new AbortController()
    const value = treeOf([{ id: 'data', label: 'Data' }])
    const original = value.children
    vi.spyOn(value, 'children').mockImplementationOnce(async (...args) => {
      controller.abort(new Error('cancelled read'))
      return original(...args)
    })
    const tree = createChainTreeDataSource([
      {
        label: 'Mine',
        detail: 'opened',
        open: async () => ({ value, release: async () => undefined }),
      },
    ])
    const [mine] = (await tree.children(await tree.root(), { limit: 10 })).items
    await expect(tree.children(required(mine), { limit: 10 }, controller.signal)).rejects.toThrow(
      'cancelled read',
    )
    expect((await tree.children(required(mine), { limit: 10 })).items).toHaveLength(1)
    await tree.dispose()
  })

  it('aborts in-flight opens on disposal, releases once, and cannot reopen', async () => {
    let finish!: () => void
    let started!: () => void
    let openingSignal: AbortSignal | undefined
    const ready = new Promise<void>(resolve => {
      started = resolve
    })
    const pending = new Promise<void>(resolve => {
      finish = resolve
    })
    const release = vi.fn(async () => undefined)
    const open = vi.fn(async (signal?: AbortSignal) => {
      openingSignal = signal
      started()
      await pending
      return { value: treeOf([]), release }
    })
    const tree = createChainTreeDataSource([{ label: 'Mine', detail: 'opened', open }])
    const root = await tree.root()
    const [mine] = (await tree.children(root, { limit: 10 })).items
    const reading = tree.children(required(mine), { limit: 10 })
    const rejected = expect(reading).rejects.toThrow('disposed')
    await ready
    const disposed = tree.dispose()
    expect(openingSignal?.aborted).toBe(true)
    finish()
    await Promise.all([disposed, rejected, tree.dispose()])
    expect(release).toHaveBeenCalledTimes(1)
    await expect(tree.root()).rejects.toThrow('disposed')
    await expect(tree.children(required(mine), { limit: 10 })).rejects.toThrow('disposed')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
