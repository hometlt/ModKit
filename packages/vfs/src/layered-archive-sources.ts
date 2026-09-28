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
 */
import type {
  ContentSourceEntry,
  ContentSourceFile,
  ContentSourceFilesPage,
  ContentSourceFilesQuery,
  ContentSourceRoot,
  ContentSources,
  ContentSourceSnapshot,
} from './content-sources.js'

/** One file an archive names, or finds by path. */
export interface LayerArchiveEntry {
  /** As the archive spells it; `\` or `/` separated. */
  readonly path: string
  /** What the listing shows, when the archive knows it before reading. */
  readonly size?: number
  readonly hidden?: true
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
  const layers: ArchiveLayers = {
    archives: archives.map(archive => archive.id),
    shadowedCount,
    owner(path) {
      const first = merged.get(keyOf(path))?.copies[0]
      return first === undefined ? undefined : origin(first)
    },
    shadowedBy: path => (merged.get(keyOf(path))?.copies ?? []).slice(1).map(origin),
    async read(path, maxBytes, rank) {
      const copies = merged.get(keyOf(path))?.copies ?? []
      const copy = rank === undefined ? copies[0] : copies.find(item => item.rank === rank)
      if (copy !== undefined) return readCopy(copy, maxBytes)
      if (rank === undefined) {
        // a file no archive names, found by hash: highest first
        for (const [index, archive] of archives.entries()) {
          const found = await archive.lookup?.(normalized(path))
          if (found !== undefined)
            return readCopy(copyOf(archive, index, found, normalized(path)), maxBytes)
        }
        throw new RangeError(`${label} has no file «${path}»`)
      }
      throw new RangeError(`${archives[rank]?.id ?? `archive ${String(rank)}`} holds no «${path}»`)
    },
  }
  return { archives, rows, children: childrenOf(rows.map(row => row.file)), layers }
}

function childrenOf(files: readonly Served[]): ReadonlyMap<string, readonly ContentSourceEntry[]> {
  const folders = new Map<string, Map<string, ContentSourceEntry>>([['', new Map()]])
  for (const file of files) {
    const parts = file.path.split('/')
    for (let depth = 0; depth < parts.length; depth += 1) {
      const parent = keyOf(parts.slice(0, depth).join('/'))
      const path = parts.slice(0, depth + 1).join('/')
      const name = parts[depth] ?? ''
      let siblings = folders.get(parent)
      if (siblings === undefined) folders.set(parent, (siblings = new Map()))
      if (siblings.has(keyOf(path))) continue
      siblings.set(
        keyOf(path),
        depth === parts.length - 1
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
  }
  return new Map(
    [...folders].map(([folder, entries]) => [
      folder,
      [...entries.values()].sort((left, right) =>
        left.directory !== right.directory
          ? left.directory
            ? -1
            : 1
          : left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
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
  return {
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
  }
}
