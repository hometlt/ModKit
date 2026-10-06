/**
 * The host's shared directory of index caches (sdk `index-caches.ts`): list and clear them for an
 * application, and keep content indexes of source roots in it, keyed by the root's revision. Kept
 * resolved Data contexts (`resolved-data-cache.ts`) live in the same directory and list here too.
 */
import { createHash } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { INDEX_CACHE_MANIFEST, type IndexCacheManifest } from '@modkit/sdk'
import { createContentIndexBuilder, openContentIndex, type ContentIndex } from '../content-index.js'

export interface IndexCacheEntry {
  /** The cache folder's name inside the shared directory. */
  readonly folder: string
  readonly manifest: IndexCacheManifest
  /** Bytes of all files in the folder. */
  readonly bytes: number
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

async function folderBytes(path: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await folderBytes(child) : (await stat(child)).size
  }
  return total
}

function manifestOf(value: unknown): IndexCacheManifest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  return typeof item['game'] === 'string' &&
    (item['kind'] === 'names' || item['kind'] === 'content' || item['kind'] === 'resolved-data') &&
    typeof item['installation'] === 'string' &&
    (item['product'] === undefined || typeof item['product'] === 'string')
    ? (item as unknown as IndexCacheManifest)
    : undefined
}

/** Every cache folder with a valid manifest, and its size; others are left alone. */
export async function listIndexCaches(directory: string): Promise<readonly IndexCacheEntry[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const caches: IndexCacheEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folder = join(directory, entry.name)
    let manifest: IndexCacheManifest | undefined
    try {
      manifest = manifestOf(JSON.parse(await readFile(join(folder, INDEX_CACHE_MANIFEST), 'utf8')))
    } catch {
      continue
    }
    if (manifest !== undefined)
      caches.push({ folder: entry.name, manifest, bytes: await folderBytes(folder) })
  }
  return caches.sort((a, b) => a.folder.localeCompare(b.folder))
}

/** Delete one cache folder; it is rebuilt the next time it is needed. */
export async function removeIndexCache(directory: string, folder: string): Promise<void> {
  if (folder !== basename(folder) || folder === '' || folder === '.' || folder === '..')
    throw new TypeError('an index cache is named by its folder inside the cache directory')
  await rm(join(directory, folder), { recursive: true, force: true })
}

export interface CachedContentIndexRequest {
  readonly directory: string
  readonly manifest: Omit<IndexCacheManifest, 'kind'>
  /** Identifies the root within the installation (`<sourceId>/<rootId>`, a subject id). */
  readonly root: string
  /** The root's revision; the index is rebuilt when it changes. */
  readonly revision: string
  /** The root's files, read only when the index for this revision is not stored yet. */
  readonly files: () => AsyncIterable<{ readonly path: string; readonly bytes: Uint8Array }>
  readonly signal?: AbortSignal
}

export interface CachedContentIndex extends ContentIndex {
  close(): Promise<void>
}

/**
 * The content index of a root at its revision: opened from the cache, or built from `files`,
 * stored, and opened. Indexes of older revisions of the same root are removed.
 */
export async function openCachedContentIndex(
  request: CachedContentIndexRequest,
): Promise<CachedContentIndex> {
  const { manifest } = request
  const folder = join(
    request.directory,
    `content-${digest(`${manifest.game}\n${manifest.product ?? ''}\n${manifest.installation}\n${request.root}`)}`,
  )
  const file = join(folder, `index-${digest(request.revision)}.mkci`)
  const present = await stat(file).then(
    () => true,
    () => false,
  )
  if (!present) {
    const builder = createContentIndexBuilder()
    for await (const entry of request.files()) {
      request.signal?.throwIfAborted()
      builder.add(entry.path, entry.bytes)
    }
    await mkdir(folder, { recursive: true })
    const partial = `${file}.${process.pid}.partial`
    await writeFile(partial, builder.encode())
    await rename(partial, file)
    const kept: IndexCacheManifest = { ...manifest, kind: 'content' }
    await writeFile(join(folder, INDEX_CACHE_MANIFEST), `${JSON.stringify(kept, null, 2)}\n`)
    for (const name of await readdir(folder))
      if (name.startsWith('index-') && join(folder, name) !== file)
        await rm(join(folder, name), { force: true })
  }
  const handle = await open(file, 'r')
  try {
    const index = await openContentIndex(async (offset, length) => {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (bytesRead !== length) throw new TypeError('content index file is truncated')
      return buffer
    })
    return Object.freeze({
      fileCount: index.fileCount,
      candidates: (query: string) => index.candidates(query),
      close: () => handle.close(),
    })
  } catch (error) {
    await handle.close()
    throw error
  }
}
