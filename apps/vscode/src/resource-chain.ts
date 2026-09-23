/**
 * Navigation overlay, NOT a calculated model. Equal node ids share one visible node, whose
 * facts come from the last contributor. Domain owners still resolve inheritance and defaults.
 */
import type {
  PageRequest,
  TreeDataSource,
  TreeNodeFacts,
  TreeNodeRef,
  TreeQuery,
} from '@modkit/sdk'

export interface ResourceChainLayer {
  readonly label: string
  /** Return undefined for an unavailable layer; operational errors remain visible. */
  open(
    signal?: AbortSignal,
  ): Promise<{ readonly value: TreeDataSource; release(): Promise<void> } | undefined>
}

const LAYER_SEPARATOR = '\u0001'
const ROOT = 'chain:root'
const UNAVAILABLE = 'chain:unavailable:'

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
    ...(start + slice.length < items.length ? { nextCursor: String(start + slice.length) } : {}),
  })
}

/** Open layer leases on first use and retain them only for the lifetime of this overlay. */
export function createChainTreeDataSource(
  layers: readonly ResourceChainLayer[],
): TreeDataSource & { dispose(): Promise<void> } {
  const lifetime = new AbortController()
  const opened = new Map<number, Promise<OpenLayer | undefined>>()
  const unavailable = new Set<number>()
  const childrenCache = new Map<string, readonly TreeNodeRef[]>()
  const contributorsOf = new Map<string, ReadonlyMap<number, TreeNodeRef>>()
  let disposing: Promise<void> | undefined

  const assertLive = (signal?: AbortSignal): void => {
    lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
  }

  const layerAt = (index: number): Promise<OpenLayer | undefined> => {
    assertLive()
    const known = opened.get(index)
    if (known !== undefined) return known
    const layer = layers[index]
    if (layer === undefined) return Promise.resolve(undefined)
    // One reader cancelling must not cancel a shared lease. Unmount cancels its lifetime.
    const opening = Promise.resolve()
      .then(() => layer.open(lifetime.signal))
      .then(lease => {
        if (lease === undefined) {
          unavailable.add(index)
          return undefined
        }
        unavailable.delete(index)
        return Object.freeze({
          label: layer.label,
          tree: lease.value,
          release: () => lease.release(),
        })
      })
      .catch((error: unknown) => {
        opened.delete(index) // Retry transient failures rather than caching an empty layer.
        throw error
      })
    opened.set(index, opening)
    return opening
  }

  const split = (id: string): { index: number; nodeId: string } | undefined => {
    const cut = id.indexOf(LAYER_SEPARATOR)
    if (cut <= 0) return undefined
    const index = Number(id.slice(0, cut))
    return Number.isSafeInteger(index) && index >= 0 && index < layers.length
      ? { index, nodeId: id.slice(cut + 1) }
      : undefined
  }

  const layerChildren = async (
    layer: OpenLayer,
    node: TreeNodeRef,
    signal?: AbortSignal,
  ): Promise<readonly TreeNodeRef[]> => {
    if (!node.hasChildren) return []
    const collected: TreeNodeRef[] = []
    const cursors = new Set<string>()
    const readSignal =
      signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, signal])
    let cursor: string | undefined
    do {
      assertLive(signal)
      const answer = await layer.tree.children(
        node,
        { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
        readSignal,
      )
      assertLive(signal)
      collected.push(...answer.items)
      cursor = answer.nextCursor
      if (cursor !== undefined) {
        if (cursors.has(cursor))
          throw new Error('resource tree pagination did not advance: ' + layer.label)
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
    return collected
  }

  const joinedChildren = async (
    node: TreeNodeRef,
    signal?: AbortSignal,
  ): Promise<readonly TreeNodeRef[]> => {
    assertLive(signal)
    const cached = childrenCache.get(node.id)
    if (cached !== undefined) return cached
    const target = split(node.id)
    const contributors =
      contributorsOf.get(node.id) ??
      new Map(
        target === undefined
          ? []
          : [[target.index, { id: target.nodeId, hasChildren: node.hasChildren }]],
      )
    const members = new Map<string, Map<number, TreeNodeRef>>()
    for (let index = 0; index < layers.length; index += 1) {
      assertLive(signal)
      if (node.id !== ROOT && !contributors.has(index)) continue
      const layer = await layerAt(index)
      assertLive(signal)
      if (layer === undefined) continue
      const local = node.id === ROOT ? await layer.tree.root() : contributors.get(index)
      if (local === undefined) continue
      for (const item of await layerChildren(layer, local, signal)) {
        const found = members.get(item.id) ?? new Map<number, TreeNodeRef>()
        found.set(index, item)
        members.set(item.id, found)
      }
    }
    assertLive(signal)
    const joined: TreeNodeRef[] = []
    for (const [localId, definitions] of members) {
      const last = [...definitions.keys()].at(-1)
      if (last === undefined) continue
      const id = String(last) + LAYER_SEPARATOR + localId
      contributorsOf.set(id, definitions)
      joined.push(
        Object.freeze({
          id,
          hasChildren: [...definitions.values()].some(item => item.hasChildren),
        }),
      )
    }
    if (node.id === ROOT) {
      for (const index of unavailable) {
        joined.push(Object.freeze({ id: UNAVAILABLE + index, hasChildren: false }))
      }
    }
    const result = Object.freeze(joined)
    childrenCache.set(node.id, result)
    return result
  }

  const completeness = (): string =>
    unavailable.size === 0 ? '' : ' · incomplete: ' + unavailable.size + ' unavailable layers'
  const source = Object.freeze({
    async root(): Promise<TreeNodeRef> {
      assertLive()
      return Object.freeze({ id: ROOT, hasChildren: layers.length > 0 })
    },

    async children(node: TreeNodeRef, request: PageRequest, signal?: AbortSignal) {
      return page(await joinedChildren(node, signal), request)
    },

    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      assertLive()
      if (node.id === ROOT) {
        return Object.freeze({
          kind: 'resources',
          label: 'Resources',
          preview: layers.length + ' layers' + completeness(),
        })
      }
      if (node.id.startsWith(UNAVAILABLE)) {
        const index = Number(node.id.slice(UNAVAILABLE.length))
        const layer = layers[index]
        if (layer === undefined || !unavailable.has(index))
          throw new TypeError('unknown chain node ' + node.id)
        return Object.freeze({
          kind: 'unavailable-layer',
          label: layer.label,
          preview: 'Unavailable — dependency chain is incomplete',
        })
      }
      const target = split(node.id)
      if (target === undefined) throw new TypeError('unknown chain node ' + node.id)
      const layer = await layerAt(target.index)
      if (layer === undefined) throw new TypeError('chain layer ' + target.index + ' is not open')
      const contributors = contributorsOf.get(node.id)
      const local = contributors?.get(target.index) ?? {
        id: target.nodeId,
        hasChildren: node.hasChildren,
      }
      const facts = await layer.tree.facts(local)
      assertLive()
      // Numeric values may be stats or descendant counts. Never sum them: count unique children.
      const preview =
        node.hasChildren && contributors !== undefined && contributors.size > 1
          ? (await joinedChildren(node)).length + ' children · ' + contributors.size + ' layers'
          : facts.preview === undefined || facts.preview === ''
            ? layer.label
            : facts.preview + ' · ' + layer.label
      return Object.freeze({ ...facts, preview: preview + completeness() })
    },

    async *search(query: TreeQuery, signal?: AbortSignal): AsyncIterable<TreeNodeRef> {
      const needle = query.pattern.toLocaleLowerCase()
      const pending = [...(await joinedChildren(await source.root(), signal))].reverse()
      const seen = new Set<string>()
      while (pending.length > 0) {
        assertLive(signal)
        const node = pending.pop()
        if (node === undefined) break
        if (seen.has(node.id)) continue
        seen.add(node.id)
        const facts = await source.facts(node)
        assertLive(signal)
        if (
          [facts.label, facts.kind, facts.preview ?? ''].some(value =>
            value.toLocaleLowerCase().includes(needle),
          )
        )
          yield node
        if (node.hasChildren) {
          for (const child of [...(await joinedChildren(node, signal))].reverse())
            pending.push(child)
        }
      }
    },

    async dispose(): Promise<void> {
      if (disposing !== undefined) return disposing
      lifetime.abort(new Error('resource chain disposed'))
      const pending = [...opened.values()]
      opened.clear()
      childrenCache.clear()
      contributorsOf.clear()
      disposing = Promise.all(
        pending.map(async opening => {
          const layer = await opening.catch(() => undefined)
          await layer?.release()
        }),
      ).then(() => {
        unavailable.clear()
      })
      return disposing
    },
  })
  return source
}
