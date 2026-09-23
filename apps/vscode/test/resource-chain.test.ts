/**
 * Resources over a load chain: what an author sees is the result, with the layer it came from.
 *
 * The layers here are plain tree data sources, because that is all a layer is — the join must not
 * know anything about SC2, only about node ids and order.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TreeDataSource, TreeNodeFacts, TreeNodeRef } from '@modkit/sdk'

import { createChainTreeDataSource, type ResourceChainLayer } from '../src/resource-chain.js'

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
    async *search() {
      // not used here
    },
  }
}

const layerOf = (
  label: string,
  nodes: readonly Node[],
  opened?: () => void,
): ResourceChainLayer => ({
  label,
  async open() {
    opened?.()
    return { value: treeOf(nodes), release: async () => undefined }
  },
})

describe('Resources across a load chain', () => {
  it('shows every layer, lets the last one win and says which layer answered', async () => {
    const core = layerOf('Mods/Core.SC2Mod', [
      {
        id: 'category/layouts',
        label: 'Layouts',
        children: [{ id: 'file/ui.sc2layout', label: 'ui.sc2layout' }],
      },
      {
        id: 'category/gamedata',
        label: 'GameData',
        children: [{ id: 'entity/Unit/Marine', label: 'Marine', preview: 'core' }],
      },
    ])
    const active = layerOf('Mods/Void.SC2Mod', [
      {
        id: 'category/gamedata',
        label: 'GameData',
        children: [{ id: 'entity/Unit/Marine', label: 'Marine', preview: 'void' }],
      },
    ])

    const tree = createChainTreeDataSource([core, active])
    const root = await tree.root()
    const categories = await tree.children(root, { limit: 10 })
    const categoryFacts = await Promise.all(categories.items.map(ref => tree.facts(ref)))
    // Void carries no Layouts at all; the chain still shows Core's.
    expect(categoryFacts.map(item => item.label)).toEqual(['Layouts', 'GameData'])

    const gameData = required(
      categories.items[categoryFacts.findIndex(item => item.label === 'GameData')],
    )
    const entities = await tree.children(gameData, { limit: 10 })
    expect(entities.items).toHaveLength(1)
    const marine = await tree.facts(required(entities.items[0]))
    // The active package overrides Core, and the answer names the layer it came from.
    expect(marine).toMatchObject({ label: 'Marine', preview: 'void · Mods/Void.SC2Mod' })

    await tree.dispose()
  })

  /**
   * The bug this pins: a section the active package declares but never fills — `Layouts` in Void —
   * took its expandability and its count from that package, so 377 inherited layouts read as an
   * empty section that would not even open.
   */
  it('expands and counts a section the active package leaves empty', async () => {
    const core = layerOf('Mods/Core.SC2Mod', [
      {
        id: 'category/layouts',
        label: 'Layouts',
        preview: '2',
        children: [
          { id: 'file/a.sc2layout', label: 'a.sc2layout' },
          { id: 'file/b.sc2layout', label: 'b.sc2layout' },
        ],
      },
    ])
    const active = layerOf('Mods/Void.SC2Mod', [
      { id: 'category/layouts', label: 'Layouts', preview: '0' },
    ])

    const tree = createChainTreeDataSource([core, active])
    const categories = await tree.children(await tree.root(), { limit: 10 })
    const layouts = required(categories.items[0])
    expect(layouts.hasChildren).toBe(true)
    expect(await tree.facts(layouts)).toMatchObject({
      label: 'Layouts',
      preview: '2 children · 2 layers',
    })
    const files = await tree.children(layouts, { limit: 10 })
    expect(files.items).toHaveLength(2)
    await tree.dispose()
  })

  it('opens a layer only when something actually asks it for children', async () => {
    const heavy = vi.fn()
    const core = layerOf('Mods/Core.SC2Mod', [{ id: 'category/files', label: 'Files' }])
    const liberty = layerOf(
      'Mods/Liberty.SC2Mod',
      [{ id: 'category/files', label: 'Files' }],
      heavy,
    )
    const tree = createChainTreeDataSource([core, liberty])
    expect(heavy).not.toHaveBeenCalled()
    await tree.root()
    expect(heavy).not.toHaveBeenCalled()
    await tree.children(await tree.root(), { limit: 10 })
    expect(heavy).toHaveBeenCalledTimes(1)
    await tree.dispose()
  })

  it('marks unavailable layers as incomplete, including an unavailable active layer', async () => {
    const broken: ResourceChainLayer = {
      label: 'Mods/Missing.SC2Mod',
      async open() {
        return undefined
      },
    }
    const active = layerOf('Mods/Void.SC2Mod', [{ id: 'category/files', label: 'Files' }])
    const tree = createChainTreeDataSource([active, broken])
    const children = await tree.children(await tree.root(), { limit: 10 })
    expect((await tree.facts(required(children.items[0]))).label).toBe('Files')
    expect((await tree.facts(required(children.items[0]))).preview).toContain(
      'incomplete: 1 unavailable layers',
    )
    expect(await tree.facts(required(children.items[1]))).toMatchObject({
      kind: 'unavailable-layer',
      label: 'Mods/Missing.SC2Mod',
    })
    await tree.dispose()
  })

  it('uses each layer root and queries only nodes contributed by that layer', async () => {
    const coreTree = treeOf(
      [{ id: 'layouts', label: 'Layouts', children: [{ id: 'file/a', label: 'a' }] }],
      'core-root',
    )
    const activeTree = treeOf([{ id: 'data', label: 'Data' }], 'active-root')
    const activeChildren = vi.spyOn(activeTree, 'children')
    const tree = createChainTreeDataSource([
      { label: 'core', open: async () => ({ value: coreTree, release: async () => undefined }) },
      {
        label: 'active',
        open: async () => ({ value: activeTree, release: async () => undefined }),
      },
    ])
    const categories = await tree.children(await tree.root(), { limit: 10 })
    expect(categories.items).toHaveLength(2)
    expect((await tree.children(required(categories.items[0]), { limit: 10 })).items).toHaveLength(
      1,
    )
    expect(activeChildren).toHaveBeenCalledTimes(1)
    await tree.dispose()
  })

  it('counts unique immediate children instead of summing overlapping layer counts', async () => {
    const group = (items: readonly string[]): Node => ({
      id: 'data',
      label: 'Data',
      preview: String(items.length),
      children: items.map(id => ({ id, label: id })),
    })
    const tree = createChainTreeDataSource([
      layerOf('core', [group(['Marine', 'SCV'])]),
      layerOf('active', [group(['Marine', 'Custom'])]),
    ])
    const node = required((await tree.children(await tree.root(), { limit: 10 })).items[0])
    expect((await tree.facts(node)).preview).toBe('3 children · 2 layers')
    const first = await tree.children(node, { limit: 2 })
    const next = await tree.children(node, { limit: 2, cursor: required(first.nextCursor) })
    expect(first.items.length + next.items.length).toBe(3)
    await tree.dispose()
  })

  it('does not add numeric leaf values and searches only the visible winner', async () => {
    const tree = createChainTreeDataSource([
      layerOf('core', [
        { id: 'string', label: 'Tooltip', preview: 'Old text' },
        { id: 'number', label: 'Life', preview: '40' },
      ]),
      layerOf('active', [
        { id: 'string', label: 'Tooltip', preview: 'New text' },
        { id: 'number', label: 'Life', preview: '50' },
      ]),
    ])
    const nodes = (await tree.children(await tree.root(), { limit: 10 })).items
    expect((await tree.facts(required(nodes[1]))).preview).toBe('50 · active')
    const results = async (pattern: string) => {
      const items: TreeNodeRef[] = []
      for await (const item of tree.search({ pattern })) items.push(item)
      return items
    }
    expect(await results('Tooltip')).toEqual([nodes[0]])
    expect(await results('Old text')).toEqual([])
    expect(await results('New text')).toEqual([nodes[0]])
    await tree.dispose()
  })

  it('surfaces operational failure and retries instead of caching partial content', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue({
        value: treeOf([{ id: 'data', label: 'Data' }]),
        release: async () => undefined,
      })
    const tree = createChainTreeDataSource([{ label: 'active', open }])
    const root = await tree.root()
    await expect(tree.children(root, { limit: 10 })).rejects.toThrow('temporary failure')
    expect((await tree.children(root, { limit: 10 })).items).toHaveLength(1)
    await tree.dispose()
  })

  it('propagates cancellation without caching an empty branch', async () => {
    const controller = new AbortController()
    const value = treeOf([{ id: 'data', label: 'Data' }])
    const original = value.children
    vi.spyOn(value, 'children').mockImplementationOnce(async (...args) => {
      controller.abort(new Error('cancelled read'))
      return original(...args)
    })
    const tree = createChainTreeDataSource([
      { label: 'active', open: async () => ({ value, release: async () => undefined }) },
    ])
    const root = await tree.root()
    await expect(tree.children(root, { limit: 10 }, controller.signal)).rejects.toThrow(
      'cancelled read',
    )
    expect((await tree.children(root, { limit: 10 })).items).toHaveLength(1)
    await tree.dispose()
  })

  it('rejects a repeating provider cursor instead of truncating silently or hanging', async () => {
    const value = treeOf([])
    vi.spyOn(value, 'children').mockResolvedValue({ items: [], nextCursor: 'same' })
    const tree = createChainTreeDataSource([
      { label: 'active', open: async () => ({ value, release: async () => undefined }) },
    ])
    await expect(tree.children(await tree.root(), { limit: 10 })).rejects.toThrow(
      'pagination did not advance',
    )
    await tree.dispose()
  })

  it('does not silently truncate a provider with more than 50,000 nodes', async () => {
    const nodes = Array.from({ length: 50_001 }, (_, index) => ({
      id: String(index),
      label: String(index),
    }))
    const tree = createChainTreeDataSource([layerOf('active', nodes)])
    const root = await tree.root()
    const first = await tree.children(root, { limit: 50_000 })
    expect(first.items).toHaveLength(50_000)
    const tail = await tree.children(root, { limit: 20, cursor: required(first.nextCursor) })
    expect(tail.items).toHaveLength(1)
    expect(await tree.facts(required(tail.items[0]))).toMatchObject({ label: '50000' })
    expect(tail.nextCursor).toBeUndefined()
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
    const tree = createChainTreeDataSource([{ label: 'active', open }])
    const root = await tree.root()
    const reading = tree.children(root, { limit: 10 })
    const rejected = expect(reading).rejects.toThrow('disposed')
    await ready
    const disposed = tree.dispose()
    expect(openingSignal?.aborted).toBe(true)
    finish()
    await Promise.all([disposed, rejected, tree.dispose()])
    expect(release).toHaveBeenCalledTimes(1)
    await expect(tree.root()).rejects.toThrow('disposed')
    await expect(tree.children(root, { limit: 10 })).rejects.toThrow('disposed')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
