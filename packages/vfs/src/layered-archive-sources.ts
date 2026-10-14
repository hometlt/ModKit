/**
 * An installation's archives as the one tree the game reads.
 *
 * Several games load a chain of archives and let a higher one replace a path a lower one holds: a
 * SAGE SkuDef names its BIG files, Warcraft III reads its MPQs up to the patch, Warzone its `.wz`
 * mods. A game module says which archives, in which order, and how to read one; this helper does
 * the rest once — merge the listings without case, serve each path from the highest archive that
 * holds it, spell it as the highest archive that names it, count what a patch hides, build the
 * folder tree, page and narrow `files`, open on first use and forget a refused open.
 *
 * An archive that finds a path it does not name (an MPQ without its file list, by hash) declares
 * `lookup`: it is asked for every path the others name, so a patch still serves a file only the
 * base archive's list spells, and for a path nobody names at all when it is read.
 *
 * The mod context a game's files open in is built here too ({@link layeredModContext}): the
 * installation as one `files` layer, the opened package or file over it. A game with no packages
 * of its own takes the default with `modContext: { gameId }`.
 */
import type {
  ContentSourceEntry,
  ContentSourceFile,
  ContentSourceFilesPage,
  ContentSourceFilesQuery,
  ContentSourceRoot,
  ContentSources,
  ContentSourceSnapshot,
  ContentSourceRead,
  ModContext,
  ModContextLayer,
  ModContextRequest,
  ModContextTarget,
  ModPackagePlacement,
} from './content-sources.js'

/** One file an archive names, or finds by path. */
export interface LayerArchiveEntry {
  /** As the archive spells it; `\` or `/` separated. */
  readonly path: string
  /** What the listing shows, when the archive knows it before reading. */
  readonly size?: number
  readonly hidden?: true
  /** Native inert facts; never mixed with a different layer's winning bytes. Host validates JSON. */
  /** Immutable facts owned by this entry; providers must not mutate them during a read lease. */
  readonly context?: unknown
}

export interface LayerArchive {
  /** Names the archive in `owner` and `shadowedBy`: its path under the installation, say. */
  readonly id: string
  /** The files the archive names. */
  readonly entries: readonly LayerArchiveEntry[]
  /**
   * A file `entries` does not name, found by its exact path: a hashed archive without its file
   * list. Asked for every path another archive names, and for an unnamed path being read.
   */
  lookup?(path: string, signal?: AbortSignal): Promise<LayerArchiveEntry | undefined>
  /** One file's bytes, whole; refuses one of more than `maxBytes`. */
  read(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
  close(): void | Promise<void>
}

export interface LayeredRoot {
  readonly root: ContentSourceRoot
  /**
   * The archives, highest priority first: the first that holds a path serves it. Called on first
   * use and again after `refresh`; an open that throws closes what it opened and is tried again
   * next time.
   */
  open(): Promise<readonly LayerArchive[]>
}

/** An archive of the chain and its place in it. */
export interface LayerOrigin {
  readonly archive: string
  /** 0 is the highest priority. */
  readonly rank: number
}

export interface ArchiveLayers {
  /** Exact membership, including unlisted lazy keys, without reading payload bytes. */
  lookup?(path: string): Promise<LayerArchiveEntry | undefined>
  /** Archive ids, highest priority first. */
  readonly archives: readonly string[]
  /** Paths whose copy in a lower archive a higher one hides. */
  readonly shadowedCount: number
  /** The archive that serves a path. */
  owner(path: string): LayerOrigin | undefined
  /** The archives whose copies of a path the owner hides, highest first. */
  shadowedBy(path: string): readonly LayerOrigin[]
  /** The copy at `rank`, a hidden one too; the served copy by default. */
  read(path: string, maxBytes: number, rank?: number): Promise<Uint8Array>
  /** Atomic read of a selected copy and its opaque entry facts; no repeated winner lookup. */
  readWithContext(path: string, maxBytes: number, rank?: number): Promise<ContentSourceRead>
}

/**
 * A layer of a {@link layeredModContext} and where its files come from: a root of the sources
 * whole (the installation), an opened archive (a map; closed with the context) or one file of the
 * layer's source, listed by its name.
 */
export interface LayeredContextLayer extends ModContextLayer {
  readonly content:
    { readonly root: string } | { readonly archive: LayerArchive } | { readonly file: string }
}

export interface LayeredModContextOptions {
  /** `ModContext.gameId`; by default the opened root's `game`, so one call serves several games. */
  readonly gameId?: string
}

export interface LayeredArchiveContentSources extends ContentSources {
  /** How a root's archives stack up. */
  layers(sourceId: string): Promise<ArchiveLayers>
  files(
    sourceId: string,
    path: string,
    query: ContentSourceFilesQuery,
  ): Promise<ContentSourceFilesPage>
}

interface Copy {
  readonly archive: LayerArchive
  readonly rank: number
  /** The path to ask this archive for. */
  readonly path: string
  readonly size?: number
  readonly hidden?: true
  readonly context?: unknown
}

/** A path of the tree: spelled as the highest archive that names it, and every copy of it. */
interface Merged {
  readonly spelling: string
  /** Highest priority first. */
  readonly copies: Copy[]
}

interface Served {
  readonly path: string
  readonly size?: number
  readonly hidden?: true
}

interface Tree {
  readonly archives: readonly LayerArchive[]
  /** Every served file once, by lower-case path. */
  readonly rows: readonly { readonly key: string; readonly file: Served }[]
  readonly children: ReadonlyMap<string, readonly ContentSourceEntry[]>
  readonly layers: ArchiveLayers
}

const normalized = (path: string): string => path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
const keyOf = (path: string): string => normalized(path).toLowerCase()

/** Whether `needle` occurs in `path` in order, not necessarily together — a quick-open query. */
function inOrder(path: string, needle: string): boolean {
  let at = 0
  for (const character of path) if (character === needle[at]) at += 1
  return at === needle.length
}

async function closeAll(archives: readonly LayerArchive[]): Promise<void> {
  for (const archive of archives) await archive.close()
}

/** Open in native precedence order; on failure close every completed layer and retain the cause. */
export async function openArchiveLayers(
  openers: Iterable<() => Promise<LayerArchive>>,
  signal?: AbortSignal,
): Promise<readonly LayerArchive[]> {
  const opened: LayerArchive[] = []
  try {
    signal?.throwIfAborted()
    for (const open of openers) {
      signal?.throwIfAborted()
      opened.push(await open())
    }
    signal?.throwIfAborted()
    return opened
  } catch (error) {
    await Promise.allSettled(opened.map(async archive => archive.close()))
    throw error
  }
}

function copyOf(
  archive: LayerArchive,
  rank: number,
  entry: LayerArchiveEntry,
  path = entry.path,
): Copy {
  return {
    archive,
    rank,
    path,
    ...(entry.size === undefined ? {} : { size: entry.size }),
    ...(entry.hidden === true ? { hidden: true } : {}),
    ...(entry.context === undefined ? {} : { context: entry.context }),
  }
}

const origin = (copy: Copy): LayerOrigin => ({ archive: copy.archive.id, rank: copy.rank })

async function merge(archives: readonly LayerArchive[], label: string): Promise<Tree> {
  const merged = new Map<string, Merged>()
  archives.forEach((archive, rank) => {
    for (const entry of archive.entries) {
      const key = keyOf(entry.path)
      if (key === '') continue
      const known = merged.get(key)
      if (known === undefined)
        merged.set(key, {
          spelling: normalized(entry.path),
          copies: [copyOf(archive, rank, entry)],
        })
      else if (known.copies.at(-1)?.rank !== rank) known.copies.push(copyOf(archive, rank, entry))
    }
  })
  for (const [rank, archive] of archives.entries()) {
    if (archive.lookup === undefined) continue
    for (const { spelling, copies } of merged.values()) {
      if (copies.some(copy => copy.rank === rank)) continue
      const found = await archive.lookup(spelling)
      if (found === undefined) continue
      copies.push(copyOf(archive, rank, found, spelling))
      copies.sort((left, right) => left.rank - right.rank)
    }
  }
  let shadowedCount = 0
  const rows = [...merged]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .flatMap(([key, { spelling, copies }]) => {
      const [first] = copies
      if (first === undefined) return []
      if (copies.length > 1) shadowedCount += 1
      const file: Served = {
        path: spelling,
        ...(first.size === undefined ? {} : { size: first.size }),
        ...(first.hidden === true ? { hidden: true } : {}),
      }
      return [{ key, file }]
    })
  const readCopy = (copy: Copy, maxBytes: number) => copy.archive.read(copy.path, maxBytes)
  /** Resolves exact membership without treating lookup failure as absence or reading payload bytes. */
  const findCopy = async (path: string, rank?: number): Promise<Copy | undefined> => {
    const copies = merged.get(keyOf(path))?.copies ?? []
    const copy = rank === undefined ? copies[0] : copies.find(item => item.rank === rank)
    if (copy !== undefined) return copy
    if (rank === undefined) {
      for (const [index, archive] of archives.entries()) {
        const found = await archive.lookup?.(normalized(path))
        if (found !== undefined) return copyOf(archive, index, found, normalized(path))
      }
    }
    return undefined
  }
  /** Both byte APIs retain the established missing-file refusal over the same winning copy. */
  const resolveCopy = async (path: string, rank?: number): Promise<Copy> => {
    const copy = await findCopy(path, rank)
    if (copy !== undefined) return copy
    if (rank === undefined) throw new RangeError(`${label} has no file «${path}»`)
    throw new RangeError(`${archives[rank]?.id ?? `archive ${String(rank)}`} holds no «${path}»`)
  }
  const layers: ArchiveLayers = {
    archives: archives.map(archive => archive.id),
    shadowedCount,
    owner(path) {
      const first = merged.get(keyOf(path))?.copies[0]
      return first === undefined ? undefined : origin(first)
    },
    shadowedBy: path => (merged.get(keyOf(path))?.copies ?? []).slice(1).map(origin),
    /** Exposes only membership facts of the same copy the byte APIs would serve. */
    async lookup(path) {
      const copy = await findCopy(path)
      return copy === undefined ? undefined : {
        path: copy.path,
        ...(copy.size === undefined ? {} : { size: copy.size }),
        ...(copy.hidden === true ? { hidden: true } : {}),
        ...(copy.context === undefined ? {} : { context: copy.context }),
      }
    },
    async read(path, maxBytes, rank) {
      return readCopy(await resolveCopy(path, rank), maxBytes)
    },
    /** Keeps the chosen Copy even if its asynchronous read refreshes the source's tree. */
    async readWithContext(path, maxBytes, rank) {
      const copy = await resolveCopy(path, rank)
      const bytes = await readCopy(copy, maxBytes)
      return { bytes, ...(copy.context === undefined ? {} : { context: copy.context }) }
    },
  }
  return { archives, rows, children: childrenOf(rows.map(row => row.file)), layers }
}

/** One collator for every comparison: `localeCompare` builds one per call (6.7 s of 13.5 s on D3). */
const byName = new Intl.Collator(undefined, { sensitivity: 'base' })

function childrenOf(files: readonly Served[]): ReadonlyMap<string, readonly ContentSourceEntry[]> {
  const folders = new Map<string, Map<string, ContentSourceEntry>>([['', new Map()]])
  for (const file of files) {
    // `file.path` is already normalized: each folder's key is a slice of one lower-cased string
    const lower = file.path.toLowerCase()
    let parent = ''
    for (let start = 0; ;) {
      const slash = file.path.indexOf('/', start)
      const end = slash === -1 ? file.path.length : slash
      const key = lower.slice(0, end)
      let siblings = folders.get(parent)
      if (siblings === undefined) folders.set(parent, (siblings = new Map()))
      if (!siblings.has(key)) {
        const path = file.path.slice(0, end)
        const name = file.path.slice(start, end)
        siblings.set(
          key,
          slash === -1
            ? {
                path,
                name,
                directory: false,
                ...(file.size === undefined ? {} : { size: file.size }),
                ...(file.hidden === true ? { hidden: true } : {}),
              }
            : { path, name, directory: true },
        )
      }
      if (slash === -1) break
      parent = key
      start = slash + 1
    }
  }
  return new Map(
    [...folders].map(([folder, entries]) => [
      folder,
      [...entries.values()].sort((left, right) =>
        left.directory !== right.directory
          ? left.directory
            ? -1
            : 1
          : byName.compare(left.name, right.name),
      ),
    ]),
  )
}

/**
 * The content sources of `roots`, one tree each, labelled `label` (`Warcraft III`). A local
 * installation has no accounts, catalogue or publications: those calls refuse.
 */
export function createLayeredArchiveContentSources(
  label: string,
  roots: readonly LayeredRoot[],
  options: {
    /**
     * Open a game's files in a context of their own (model textures, scripts): a path inside a
     * root opens as one file over the whole installation, and so does a host path inside the
     * folder a root reads (`storageOf`) — a member of one of its archives (`WDFiles/Models.wd/…`)
     * as the file the tree serves at the member's path. Other host paths stay another module's.
     */
    readonly modContext?: LayeredModContextOptions
  } = {},
): LayeredArchiveContentSources {
  const trees = new Map<string, Promise<Tree>>()
  const planOf = (sourceId: string): LayeredRoot => {
    const plan = roots.find(candidate => candidate.root.id === sourceId)
    if (plan === undefined) throw new RangeError(`no ${label} content source «${sourceId}»`)
    return plan
  }
  const open = (sourceId: string): Promise<Tree> => {
    let tree = trees.get(sourceId)
    if (tree === undefined) {
      const plan = planOf(sourceId)
      const opening = plan.open().then(async archives => {
        try {
          return await merge(archives, label)
        } catch (error) {
          await closeAll(archives)
          throw error
        }
      })
      // A refused open is not kept: the game may be repaired or finish patching.
      opening.catch(() => {
        if (trees.get(sourceId) === opening) trees.delete(sourceId)
      })
      trees.set(sourceId, opening)
      tree = opening
    }
    return tree
  }
  const refresh = async (sourceId: string): Promise<void> => {
    const tree = trees.get(sourceId)
    if (tree === undefined) return
    trees.delete(sourceId)
    const opened = await tree.catch(() => undefined)
    if (opened !== undefined) await closeAll(opened.archives)
  }
  const none = (what: string) => async (): Promise<never> => {
    throw new TypeError(`${label} content sources have no ${what}`)
  }
  const rootOf = (target: ModContextTarget) =>
    typeof target === 'string' ? undefined : roots.find(plan => plan.root.id === target.sourceId)
  /** The root whose installation folder holds a host path, and the path under that folder. */
  const storageHolding = (target: ModContextTarget) => {
    if (typeof target !== 'string') return undefined
    const path = normalized(target)
    for (const plan of roots) {
      const storage = plan.root.storageOf === undefined ? '' : normalized(plan.root.storageOf)
      if (storage !== '' && keyOf(path).startsWith(`${keyOf(storage)}/`))
        return { plan, path: path.slice(storage.length + 1) }
    }
    return undefined
  }
  const modContext = options.modContext
  const contexts =
    modContext === undefined
      ? {}
      : {
          async locateModPackage(target: ModContextTarget): Promise<ModPackagePlacement> {
            return rootOf(target) === undefined && storageHolding(target) === undefined
              ? { kind: 'foreign' }
              : { kind: 'loose' }
          },
          async openModContext(request: ModContextRequest): Promise<ModContext> {
            const held = storageHolding(request.target)
            const plan = held?.plan ?? rootOf(request.target)
            if (plan === undefined)
              throw new TypeError(`${label} opens only paths inside its own content sources`)
            let path = typeof request.target === 'string' ? '' : normalized(request.target.path)
            if (held !== undefined) {
              // a member of one of the root's archives is the file the tree serves at its path
              path = held.path
              for (const archive of (await open(plan.root.id)).layers.archives)
                if (keyOf(path).startsWith(`${keyOf(archive)}/`)) {
                  path = path.slice(normalized(archive).length + 1)
                  break
                }
            }
            const { root } = plan
            const gameId = modContext.gameId ?? root.game
            if (gameId === undefined)
              throw new TypeError(`${label} root ${root.id} names no game for its mod context`)
            const installation: LayeredContextLayer = {
              id: 'installation',
              displayName: root.label,
              sourceId: root.id,
              sourcePath: '',
              role: path === '' ? 'primary' : 'dependency',
              provenance: path === '' ? 'opened' : 'implicit',
              kind: 'files',
              content: { root: root.id },
            }
            const opened: LayeredContextLayer[] =
              path === ''
                ? []
                : [
                    {
                      id: 'opened',
                      displayName: path.slice(path.lastIndexOf('/') + 1),
                      sourceId: root.id,
                      sourcePath: path,
                      role: 'primary',
                      provenance: 'opened',
                      kind: 'files',
                      content: { file: path },
                    },
                  ]
            return layeredModContext(sources, {
              gameId,
              contextId: `${gameId}:${root.id}:${root.revision ?? '-'}:${keyOf(path)}`,
              layers: [installation, ...opened],
            })
          },
        }
  const sources: LayeredArchiveContentSources = {
    async snapshot(): Promise<ContentSourceSnapshot> {
      return { label, regions: [], connections: [], roots: roots.map(plan => plan.root) }
    },
    async list(sourceId, path) {
      const found = (await open(sourceId)).children.get(keyOf(path))
      if (found === undefined) throw new RangeError(`${label} folder «${path}» was not found`)
      return found
    },
    async read(sourceId, path, maxBytes) {
      return (await open(sourceId)).layers.read(path, maxBytes)
    },
    /** Retained root membership uses the canonical layered lookup, including lazy keys. */
    async lookup(sourceId, path) {
      const entry = await (await open(sourceId)).layers.lookup!(path)
      return entry === undefined ? undefined : {
        path: entry.path, name: entry.path.slice(entry.path.lastIndexOf('/') + 1), directory: false,
        ...(entry.size === undefined ? {} : { size: entry.size }),
        ...(entry.hidden === true ? { hidden: true } : {}),
      }
    },
    /** Native metadata is selected by the same retained layered tree as the file bytes. */
    async readWithContext(sourceId, path, maxBytes) {
      return (await open(sourceId)).layers.readWithContext(path, maxBytes)
    },
    async files(sourceId, path, query) {
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 10_000)
        throw new RangeError('Invalid file page limit')
      const { rows } = await open(sourceId)
      const prefix = keyOf(path) === '' ? '' : `${keyOf(path)}/`
      const pattern = (query.pattern ?? '').replace(/\s+/gu, '').replaceAll('\\', '/').toLowerCase()
      const extensions =
        query.extensions === undefined
          ? undefined
          : new Set(query.extensions.map(value => value.toLowerCase()))
      let row = query.cursor === undefined ? 0 : Number(query.cursor)
      if (!Number.isSafeInteger(row) || row < 0) throw new RangeError('Invalid file cursor')
      const items: ContentSourceFile[] = []
      for (; row < rows.length && items.length < query.limit; row += 1) {
        const { key: lower, file } = rows[row] ?? { key: '', file: { path: '' } }
        if (!lower.startsWith(prefix)) continue
        const name = lower.slice(lower.lastIndexOf('/') + 1)
        const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
        if (extensions !== undefined && !extensions.has(extension)) continue
        if (pattern !== '' && !inOrder(lower, pattern)) continue
        items.push(file)
      }
      return row < rows.length ? { items, nextCursor: String(row) } : { items }
    },
    async layers(sourceId) {
      return (await open(sourceId)).layers
    },
    refresh,
    async dispose() {
      for (const sourceId of [...trees.keys()]) await refresh(sourceId)
    },
    connect: none('accounts'),
    disconnect: none('accounts'),
    search: none('catalogue'),
    add: none('catalogue'),
    remove: none('catalogue'),
    ...contexts,
  }
  return sources
}

/**
 * A mod context over layered sources, lowest layer first, the opened one last: each layer's names
 * listed once for the context's life (hidden entries left out), pages of them narrowed by prefix
 * without case, exact lazy membership admitted without expanding listings, `locate` answered by
 * the highest layer that holds the path, opened archives closed on `dispose`. The game decides the
 * layers and adds what only it knows (`query` for its data); this is the rest, once.
 */
export function layeredModContext(
  sources: Pick<LayeredArchiveContentSources, 'files' | 'read' | 'readWithContext' | 'lookup'>,
  context: {
    readonly gameId: string
    readonly contextId: string
    readonly layers: readonly LayeredContextLayer[]
    readonly unresolved?: readonly string[]
    readonly diagnostics?: readonly unknown[]
  },
): ModContext {
  const byId = new Map(context.layers.map(layer => [layer.id, layer]))
  if (byId.size !== context.layers.length) throw new TypeError('context layer ids repeat')
  /** Each layer's names by lower-case path, sorted, listed on first use. */
  const listed = new Map<string, Promise<ReadonlyMap<string, string>>>()
  const namesOf = (layerId: string): Promise<ReadonlyMap<string, string>> => {
    const layer = byId.get(layerId)
    if (layer === undefined)
      return Promise.reject(new RangeError(`no layer «${layerId}» in context ${context.contextId}`))
    let names = listed.get(layerId)
    if (names === undefined) {
      const listing = (async () => {
        const paths: string[] = []
        const { content } = layer
        if ('archive' in content) {
          for (const entry of content.archive.entries)
            if (entry.hidden !== true) paths.push(normalized(entry.path))
        } else if ('file' in content) {
          const path = normalized(content.file)
          paths.push(path.slice(path.lastIndexOf('/') + 1))
        } else {
          let cursor: string | undefined
          do {
            const page = await sources.files(content.root, '', {
              limit: 10_000,
              ...(cursor === undefined ? {} : { cursor }),
            })
            for (const item of page.items) if (item.hidden !== true) paths.push(item.path)
            cursor = page.nextCursor
          } while (cursor !== undefined)
        }
        return new Map(
          paths.map(path => [keyOf(path), path] as const).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      })()
      // a refused listing is not kept: the next read tries again
      listing.catch(() => {
        if (listed.get(layerId) === listing) listed.delete(layerId)
      })
      listed.set(layerId, listing)
      names = listing
    }
    return names
  }
  /** Resolves listed or exact lazy membership in one layer, preserving hidden-entry refusal. */
  const member = async (layerId: string, path: string,
    knownNames?: ReadonlyMap<string, string>): Promise<LayerArchiveEntry | undefined> => {
    const names = knownNames ?? await namesOf(layerId)
    const layer = byId.get(layerId)!
    const spelled = names.get(keyOf(path))
    const { content } = layer
    if ('archive' in content) {
      const listedEntry = content.archive.entries.find(item => keyOf(item.path) === keyOf(path))
      const entry = listedEntry ?? await content.archive.lookup?.(normalized(path))
      if (entry?.hidden === true) return undefined
      return entry ?? (spelled === undefined ? undefined : { path: spelled })
    }
    if (spelled !== undefined) return { path: spelled }
    if ('root' in content) {
      const entry = await sources.lookup?.(content.root, normalized(path))
      return entry?.hidden === true ? undefined : entry
    }
    return undefined
  }
  return {
    schemaVersion: 1,
    gameId: context.gameId,
    contextId: context.contextId,
    layers: context.layers.map(({ content: _content, ...layer }) => Object.freeze(layer)),
    unresolved: context.unresolved ?? [],
    diagnostics: context.diagnostics ?? [],
    async files(layerId, page) {
      if (!Number.isSafeInteger(page.limit) || page.limit < 1)
        throw new RangeError('Invalid context file page limit')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new RangeError('Invalid context file cursor')
      const prefix = (page.prefix ?? '').toLowerCase()
      const all = [...(await namesOf(layerId))]
        .filter(([lower]) => lower.startsWith(prefix))
        .map(([, path]) => path)
      const items = all.slice(start, start + page.limit)
      return start + items.length < all.length
        ? { items, nextCursor: String(start + items.length) }
        : { items }
    },
    async read(layerId, path, maxBytes) {
      const entry = await member(layerId, path)
      if (entry === undefined)
        throw new RangeError(`«${path}» is not a file of layer «${layerId}»`)
      const { content, sourceId } = byId.get(layerId)!
      if ('archive' in content) {
        return content.archive.read(entry.path, maxBytes)
      }
      return 'file' in content
        ? sources.read(sourceId, normalized(content.file), maxBytes)
        : sources.read(content.root, entry.path, maxBytes)
    },
    /** Reads only a validated member of this retained layer and its own context, never a lower copy's. */
    async readWithContext(layerId, path, maxBytes) {
      const entry = await member(layerId, path)
      if (entry === undefined)
        throw new RangeError(`«${path}» is not a file of layer «${layerId}»`)
      const { content, sourceId } = byId.get(layerId)!
      if ('archive' in content) {
        const bytes = await content.archive.read(entry.path, maxBytes)
        return { bytes, ...(entry.context === undefined ? {} : { context: entry.context }) }
      }
      const root = 'file' in content ? sourceId : content.root
      const nativePath = 'file' in content ? normalized(content.file) : entry.path
      return sources.readWithContext === undefined
        ? { bytes: await sources.read(root, nativePath, maxBytes) }
        : sources.readWithContext(root, nativePath, maxBytes)
    },
    async locate(path) {
      for (const layer of [...context.layers].reverse()) {
        // Preserve listing-failure tolerance; a corrupt exact lookup is not an absent entry.
        const names = await namesOf(layer.id).catch(() => undefined)
        if (names === undefined) continue
        const entry = await member(layer.id, path, names)
        if (entry !== undefined) return { layerId: layer.id, path: entry.path }
      }
      return undefined
    },
    async dispose() {
      for (const { content } of context.layers)
        if ('archive' in content) await content.archive.close()
    },
  }
}
