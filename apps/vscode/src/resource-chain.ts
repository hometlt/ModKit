/**
 * Resources as the chain of loaded mods: one node per package in load order (Core → … → the opened
 * one), each expanding into that package's own tree as its codec publishes it — GameData by
 * namespace, strings by locale, Galaxy, layouts, files. Nothing is merged: a node belongs to exactly
 * one package, so where a unit, a string or a file comes from is where it is shown.
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
  /** Its place in the chain and where it was loaded from, shown beside the label. */
  readonly detail: string
  /** The package the active document belongs to; the view opens it expanded. */
  readonly opened?: boolean
  /** Return undefined for an unavailable layer; operational errors remain visible. */
  open(
    signal?: AbortSignal,
  ): Promise<{ readonly value: TreeDataSource; release(): Promise<void> } | undefined>
}

/** The kind of a layer node; the opened package's node uses {@link OPENED_LAYER_KIND}. */
export const LAYER_KIND = 'mod-layer'
export const OPENED_LAYER_KIND = 'mod-layer-opened'

const LAYER_SEPARATOR = '\u0001'
const ROOT = 'chain:root'
const LAYER = 'chain:layer:'

interface OpenLayer {
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

/** Open layer leases on first use and retain them only for the lifetime of this chain. */
export function createChainTreeDataSource(
  layers: readonly ResourceChainLayer[],
): TreeDataSource & { dispose(): Promise<void> } {
  const lifetime = new AbortController()
  const opened = new Map<number, Promise<OpenLayer | undefined>>()
  const unavailable = new Set<number>()
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
        return Object.freeze({ tree: lease.value, release: () => lease.release() })
      })
      .catch((error: unknown) => {
        opened.delete(index) // Retry transient failures rather than caching an empty layer.
        throw error
      })
    opened.set(index, opening)
    return opening
  }

  const layerIndexOf = (id: string): number | undefined => {
    if (!id.startsWith(LAYER)) return undefined
    const index = Number(id.slice(LAYER.length))
    return Number.isSafeInteger(index) && index >= 0 && index < layers.length ? index : undefined
  }

  const split = (id: string): { index: number; nodeId: string } | undefined => {
    const cut = id.indexOf(LAYER_SEPARATOR)
    if (cut <= 0) return undefined
    const index = Number(id.slice(0, cut))
    return Number.isSafeInteger(index) && index >= 0 && index < layers.length
      ? { index, nodeId: id.slice(cut + 1) }
      : undefined
  }

  const children = async (
    node: TreeNodeRef,
    request: PageRequest,
    signal?: AbortSignal,
  ): Promise<{ readonly items: readonly TreeNodeRef[]; readonly nextCursor?: string }> => {
    assertLive(signal)
    if (node.id === ROOT) {
      return page(
        layers.map((_layer, index) => Object.freeze({ id: LAYER + index, hasChildren: true })),
        request,
      )
    }
    const layerIndex = layerIndexOf(node.id)
    const target =
      layerIndex === undefined ? split(node.id) : { index: layerIndex, nodeId: undefined }
    if (target === undefined) throw new TypeError('unknown chain node ' + node.id)
    const layer = await layerAt(target.index)
    assertLive(signal)
    if (layer === undefined) return page([], request)
    const local =
      target.nodeId === undefined
        ? await layer.tree.root()
        : { id: target.nodeId, hasChildren: node.hasChildren }
    const readSignal =
      signal === undefined ? lifetime.signal : AbortSignal.any([lifetime.signal, signal])
    const answer = await layer.tree.children(local, request, readSignal)
    assertLive(signal)
    return Object.freeze({
      items: Object.freeze(
        answer.items.map(item =>
          Object.freeze({
            id: String(target.index) + LAYER_SEPARATOR + item.id,
            hasChildren: item.hasChildren,
          }),
        ),
      ),
      ...(answer.nextCursor === undefined ? {} : { nextCursor: answer.nextCursor }),
    })
  }

  const source = Object.freeze({
    async root(): Promise<TreeNodeRef> {
      assertLive()
      return Object.freeze({ id: ROOT, hasChildren: layers.length > 0 })
    },

    children,

    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      assertLive()
      if (node.id === ROOT) {
        return Object.freeze({
          kind: 'resources',
          label: 'Resources',
          preview:
            layers.length +
            ' mods' +
            (unavailable.size === 0 ? '' : ' · ' + unavailable.size + ' unavailable'),
        })
      }
      const layerIndex = layerIndexOf(node.id)
      if (layerIndex !== undefined) {
        const layer = layers[layerIndex]
        if (layer === undefined) throw new TypeError('unknown chain node ' + node.id)
        return Object.freeze({
          kind: layer.opened === true ? OPENED_LAYER_KIND : LAYER_KIND,
          label: layer.label,
          preview: unavailable.has(layerIndex) ? layer.detail + ' · unavailable' : layer.detail,
        })
      }
      const target = split(node.id)
      if (target === undefined) throw new TypeError('unknown chain node ' + node.id)
      const layer = await layerAt(target.index)
      if (layer === undefined) throw new TypeError('chain layer ' + target.index + ' is not open')
      return layer.tree.facts({ id: target.nodeId, hasChildren: node.hasChildren })
    },

    async *search(query: TreeQuery, signal?: AbortSignal): AsyncIterable<TreeNodeRef> {
      for (let index = 0; index < layers.length; index += 1) {
        assertLive(signal)
        const layer = await layerAt(index)
        if (layer === undefined) continue
        for await (const found of layer.tree.search(query, signal)) {
          assertLive(signal)
          yield Object.freeze({
            id: String(index) + LAYER_SEPARATOR + found.id,
            hasChildren: found.hasChildren,
          })
        }
      }
    },

    async dispose(): Promise<void> {
      if (disposing !== undefined) return disposing
      lifetime.abort(new Error('resource chain disposed'))
      const pending = [...opened.values()]
      opened.clear()
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

/**
 * A layer no package codec opens (the editor's wizard folder): its files as a flat list, each
 * naming its own subject so a click opens it.
 */
export function createFileListTree(
  paths: readonly string[],
  subjectIdOf: (path: string) => string,
): TreeDataSource {
  const sorted = [...paths].sort((left, right) => left.localeCompare(right))
  const ROOT_ID = 'files:root'
  const refs = sorted.map((_path, index) => Object.freeze({ id: String(index), hasChildren: false }))
  return Object.freeze({
    async root(): Promise<TreeNodeRef> {
      return Object.freeze({ id: ROOT_ID, hasChildren: refs.length > 0 })
    },
    async children(node: TreeNodeRef, request: PageRequest) {
      return page(node.id === ROOT_ID ? refs : [], request)
    },
    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      const path = sorted[Number(node.id)]
      if (path === undefined) throw new TypeError('unknown file node ' + node.id)
      return Object.freeze({ kind: 'file', label: path, subjectId: subjectIdOf(path) })
    },
    async *search(query: TreeQuery): AsyncIterable<TreeNodeRef> {
      const needle = query.pattern.toLocaleLowerCase()
      for (const [index, path] of sorted.entries()) {
        if (path.toLocaleLowerCase().includes(needle)) yield refs[index] as TreeNodeRef
      }
    },
  })
}
