/**
 * Resources over the whole load chain, not one package.
 *
 * SC2 loads a package on top of everything it depends on: a mod that declares Void still runs with
 * Core, Liberty and Swarm underneath it, and most of what an author reads — layouts, font styles,
 * editor categories, inherited entities — lives in those layers, not in the package being edited.
 * A tree built from the active package alone shows empty sections and calls them empty, which is
 * how MK2 parity was lost here.
 *
 * Each layer is an ordinary subject with its own `common.view/tree-data-source`; this module only
 * joins them. The join is by node id, which every layer mints the same way for the same resource,
 * so the last layer to define a node wins — exactly the engine's own override order — and the one
 * that won is the one whose facts are shown. Nothing here knows what a layout or a unit is.
 */
import type { PageRequest, TreeDataSource, TreeNodeFacts, TreeNodeRef, TreeQuery } from '@modkit/sdk'

/** One package of the chain, Core first, the edited package last. */
export interface ResourceChainLayer {
  /** Display name of the layer, e.g. `Mods/Core.SC2Mod`. */
  readonly label: string
  /** Opens this layer's tree. `undefined` when the layer cannot be opened at all. */
  open(signal?: AbortSignal): Promise<
    { readonly value: TreeDataSource; release(): Promise<void> } | undefined
  >
}

const LAYER_SEPARATOR = ''

interface OpenLayer {
  readonly label: string
  readonly tree: TreeDataSource
  release(): Promise<void>
}

function page(items: readonly TreeNodeRef[], request: PageRequest) {
  const limit = request.limit
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('page limit must be positive')
  const start = request.cursor === undefined ? 0 : Number(request.cursor)
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length) {
    throw new RangeError('page cursor is invalid')
  }
  const slice = items.slice(start, start + limit)
  return Object.freeze({
    items: Object.freeze(slice),
    ...(start + slice.length < items.length
      ? { nextCursor: String(start + slice.length) }
      : {}),
  })
}

/**
 * Join several layer trees into one.
 *
 * Layers are opened lazily — the first request that needs a layer opens it — because a chain can
 * carry an installed package with six figures of entries, and a tree the reader never expands must
 * not pay for it.
 */
export function createChainTreeDataSource(
  layers: readonly ResourceChainLayer[],
): TreeDataSource & { dispose(): Promise<void> } {
  const opened = new Map<number, Promise<OpenLayer | undefined>>()
  /** Which layer owns each composite node, so facts and children go back to the right tree. */
  const ownerOf = new Map<string, number>()
  const childrenCache = new Map<string, readonly TreeNodeRef[]>()

  const layerAt = (index: number): Promise<OpenLayer | undefined> => {
    const known = opened.get(index)
    if (known !== undefined) return known
    const layer = layers[index]
    const opening =
      layer === undefined
        ? Promise.resolve(undefined)
        : layer.open().then(
            lease =>
              lease === undefined
                ? undefined
                : Object.freeze({
                    label: layer.label,
                    tree: lease.value,
                    release: () => lease.release(),
                  }),
            () => undefined,
          )
    opened.set(index, opening)
    return opening
  }

  /** Which layers define each composite node, in chain order, for counts and expansion. */
  const contributorsOf = new Map<string, number[]>()

  const compose = (index: number, node: TreeNodeRef): TreeNodeRef => {
    const id = `${String(index)}${LAYER_SEPARATOR}${node.id}`
    ownerOf.set(id, index)
    return Object.freeze({ id, hasChildren: node.hasChildren })
  }

  /** The layer-local node a composite id names, or the root of a layer. */
  const split = (id: string): { readonly index: number; readonly nodeId: string } | undefined => {
    const cut = id.indexOf(LAYER_SEPARATOR)
    if (cut <= 0) return undefined
    const index = Number(id.slice(0, cut))
    return Number.isSafeInteger(index) ? { index, nodeId: id.slice(cut + 1) } : undefined
  }

  /** Every child of `nodeId` in one layer, drained across its own pages. */
  const layerChildren = async (
    layer: OpenLayer,
    nodeId: string,
    hasChildren: boolean,
    signal?: AbortSignal,
  ): Promise<readonly TreeNodeRef[]> => {
    const collected: TreeNodeRef[] = []
    let cursor: string | undefined
    do {
      signal?.throwIfAborted()
      const answer = await layer.tree.children(
        Object.freeze({ id: nodeId, hasChildren }),
        cursor === undefined ? { limit: 200 } : { cursor, limit: 200 },
        signal,
      )
      collected.push(...answer.items)
      cursor = answer.nextCursor
      if (collected.length >= 50_000) break
    } while (cursor !== undefined)
    return Object.freeze(collected)
  }

  /**
   * Children of one logical node across every layer that has it.
   *
   * Later layers override earlier ones by node id, and the order the reader sees is the order the
   * deepest layer that defines the node used — an inherited resource keeps its place.
   */
  const joinedChildren = async (
    nodeId: string,
    hasChildren: boolean,
    signal?: AbortSignal,
  ): Promise<readonly TreeNodeRef[]> => {
    const cacheKey = `${nodeId}${LAYER_SEPARATOR}${hasChildren ? '1' : '0'}`
    const known = childrenCache.get(cacheKey)
    if (known !== undefined) return known
    const order: string[] = []
    const winner = new Map<string, TreeNodeRef>()
    /*
     * Expansion is a property of the chain, not of the layer that happens to win. Void defines
     * `Layouts` with no children of its own; Core fills it with 377. Taking the winner's flag
     * alone left the node unexpandable, which is exactly how an inherited section reads as empty.
     */
    const expandable = new Set<string>()
    const contributors = new Map<string, number[]>()
    for (let index = 0; index < layers.length; index += 1) {
      signal?.throwIfAborted()
      const layer = await layerAt(index)
      if (layer === undefined) continue
      let items: readonly TreeNodeRef[]
      try {
        items = await layerChildren(layer, nodeId, hasChildren, signal)
      } catch {
        // A layer that does not carry this node at all is not an error: Void has no Layouts.
        continue
      }
      for (const item of items) {
        if (!winner.has(item.id)) order.push(item.id)
        winner.set(item.id, compose(index, item))
        if (item.hasChildren) expandable.add(item.id)
        const seen = contributors.get(item.id)
        if (seen === undefined) contributors.set(item.id, [index])
        else seen.push(index)
      }
    }
    const joined = Object.freeze(
      order.flatMap(id => {
        const item = winner.get(id)
        if (item === undefined) return []
        const merged = Object.freeze({ id: item.id, hasChildren: expandable.has(id) })
        contributorsOf.set(item.id, contributors.get(id) ?? [])
        return [merged]
      }),
    )
    childrenCache.set(cacheKey, joined)
    return joined
  }

  const source = Object.freeze({
    async root(): Promise<TreeNodeRef> {
      return Object.freeze({ id: 'chain:root', hasChildren: true })
    },

    async children(node: TreeNodeRef, request: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (node.id === 'chain:root') {
        // The root of every layer is the same logical node; ask each layer for its own root id.
        const first = await layerAt(layers.length - 1)
        const rootRef = first === undefined ? undefined : await first.tree.root()
        if (rootRef === undefined) return page(Object.freeze([]), request)
        return page(await joinedChildren(rootRef.id, true, signal), request)
      }
      const target = split(node.id)
      if (target === undefined) return page(Object.freeze([]), request)
      return page(await joinedChildren(target.nodeId, node.hasChildren, signal), request)
    },

    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      if (node.id === 'chain:root') {
        return Object.freeze({ kind: 'resources', label: 'Resources', preview: chainPreview() })
      }
      const target = split(node.id)
      if (target === undefined) throw new TypeError(`unknown chain node ${node.id}`)
      const layer = await layerAt(target.index)
      if (layer === undefined) throw new TypeError(`chain layer ${target.index} is not open`)
      const facts = await layer.tree.facts(
        Object.freeze({ id: target.nodeId, hasChildren: node.hasChildren }),
      )
      const contributors = contributorsOf.get(node.id) ?? [target.index]
      /*
       * A count belongs to the chain too. `Layouts 0 · Void` is a lie when Core contributes 377,
       * so a node several layers define reports their total — when every layer states one. A
       * preview that is not a plain count (a path, a string value) stays the winner's own.
       */
      const total =
        contributors.length <= 1 ? undefined : await countAcrossLayers(contributors, target.nodeId)
      return Object.freeze({
        ...facts,
        preview:
          total === undefined
            ? withLayer(facts.preview, layer.label)
            : `${String(total)} · ${String(contributors.length)} layers`,
      })
    },

    async *search(query: TreeQuery, signal?: AbortSignal): AsyncIterable<TreeNodeRef> {
      for (let index = 0; index < layers.length; index += 1) {
        signal?.throwIfAborted()
        const layer = await layerAt(index)
        if (layer === undefined) continue
        for await (const found of layer.tree.search(query, signal)) {
          yield compose(index, found)
        }
      }
    },

    async dispose(): Promise<void> {
      const pending = [...opened.values()]
      opened.clear()
      ownerOf.clear()
      childrenCache.clear()
      for (const layer of pending) {
        await layer.then(value => value?.release()).catch(() => undefined)
      }
    },
  })

  /** The summed count of one node across the layers that define it, when all of them state one. */
  async function countAcrossLayers(
    contributors: readonly number[],
    nodeId: string,
  ): Promise<number | undefined> {
    let total = 0
    for (const index of contributors) {
      const layer = await layerAt(index)
      if (layer === undefined) return undefined
      let facts: TreeNodeFacts
      try {
        facts = await layer.tree.facts(Object.freeze({ id: nodeId, hasChildren: true }))
      } catch {
        return undefined
      }
      // The typed `value` is the count; `preview` is prose for a human («891 · 891 own») and must
      // not be parsed back into a number.
      const count = typeof facts.value === 'number' ? facts.value : Number(facts.preview)
      if (!Number.isFinite(count)) return undefined
      total += count
    }
    return total
  }

  function chainPreview(): string {
    return layers.length === 1 ? layers[0]?.label ?? '' : `${String(layers.length)} layers`
  }

  return source
}

function withLayer(preview: string | undefined, label: string): string {
  return preview === undefined || preview === '' ? label : `${preview} · ${label}`
}
