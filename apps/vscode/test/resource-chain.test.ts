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

function treeOf(nodes: readonly Node[]): TreeDataSource {
  const index = new Map<string, Node>()
  const walk = (items: readonly Node[]) => {
    for (const item of items) {
      index.set(item.id, item)
      walk(item.children ?? [])
    }
  }
  walk(nodes)
  const childrenOf = (id: string): readonly Node[] =>
    id === 'root' ? nodes : (index.get(id)?.children ?? [])
  return {
    async root() {
      return { id: 'root', hasChildren: true }
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
      return { kind: 'x', label: found.label, ...(found.preview === undefined ? {} : { preview: found.preview }) }
    },
    async *search() {
      // not used here
    },
  }
}

const layerOf = (label: string, nodes: readonly Node[], opened?: () => void): ResourceChainLayer => ({
  label,
  async open() {
    opened?.()
    return { value: treeOf(nodes), release: async () => undefined }
  },
})

describe('Resources across a load chain', () => {
  it('shows every layer, lets the last one win and says which layer answered', async () => {
    const core = layerOf('Mods/Core.SC2Mod', [
      { id: 'category/layouts', label: 'Layouts', children: [{ id: 'file/ui.sc2layout', label: 'ui.sc2layout' }] },
      { id: 'category/gamedata', label: 'GameData', children: [{ id: 'entity/Unit/Marine', label: 'Marine', preview: 'core' }] },
    ])
    const active = layerOf('Mods/Void.SC2Mod', [
      { id: 'category/gamedata', label: 'GameData', children: [{ id: 'entity/Unit/Marine', label: 'Marine', preview: 'void' }] },
    ])

    const tree = createChainTreeDataSource([core, active])
    const root = await tree.root()
    const categories = await tree.children(root, { limit: 10 })
    const categoryFacts = await Promise.all(categories.items.map(ref => tree.facts(ref)))
    // Void carries no Layouts at all; the chain still shows Core's.
    expect(categoryFacts.map(item => item.label)).toEqual(['Layouts', 'GameData'])

    const gameData = categories.items[categoryFacts.findIndex(item => item.label === 'GameData')]!
    const entities = await tree.children(gameData, { limit: 10 })
    expect(entities.items).toHaveLength(1)
    const marine = await tree.facts(entities.items[0]!)
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
    const layouts = categories.items[0]!
    expect(layouts.hasChildren).toBe(true)
    expect(await tree.facts(layouts)).toMatchObject({ label: 'Layouts', preview: '2 · 2 layers' })
    const files = await tree.children(layouts, { limit: 10 })
    expect(files.items).toHaveLength(2)
    await tree.dispose()
  })

  it('opens a layer only when something actually asks it for children', async () => {
    const heavy = vi.fn()
    const core = layerOf('Mods/Core.SC2Mod', [{ id: 'category/files', label: 'Files' }])
    const liberty = layerOf('Mods/Liberty.SC2Mod', [{ id: 'category/files', label: 'Files' }], heavy)
    const tree = createChainTreeDataSource([core, liberty])
    expect(heavy).not.toHaveBeenCalled()
    await tree.root()
    expect(heavy).not.toHaveBeenCalled()
    await tree.children(await tree.root(), { limit: 10 })
    expect(heavy).toHaveBeenCalledTimes(1)
    await tree.dispose()
  })

  it('keeps going when one layer cannot be opened', async () => {
    const broken: ResourceChainLayer = {
      label: 'Mods/Missing.SC2Mod',
      async open() {
        throw new Error('not available')
      },
    }
    const active = layerOf('Mods/Void.SC2Mod', [{ id: 'category/files', label: 'Files' }])
    const tree = createChainTreeDataSource([broken, active])
    const children = await tree.children(await tree.root(), { limit: 10 })
    expect((await tree.facts(children.items[0]!)).label).toBe('Files')
    await tree.dispose()
  })
})
