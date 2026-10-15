/**
 * Node filesystem adapter for the data-only loader: reads the two candidate authored
 * containers, the file listing and every declared contribution document, and hands the
 * pre-read data to the portable inventory. Reading is the only thing that happens here —
 * no execution, no globbing beyond the declared patterns (expansion is pure sdk code).
 */

import { createHash, type Hash } from 'node:crypto'
import { existsSync, readdirSync, watch } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { throwIfAborted } from '@modkit/core'
import { expandContributionManifests, normalizeExtensionManifest } from '@modkit/sdk'
import type { ExtensionInput } from '../inventory.js'
import { cachedArtifactDigest, rememberArtifactDigest } from './artifact-digest-cache.js'

export function listFilesRecursive(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

/** Sorted artifact paths, including build output, without holding the thread. */
async function listArtifactFilesAsync(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(byName)) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  await walk(root)
  return out
}

/**
 * `read` over `items` with at most `width` in flight, results in the items' order: an activation
 * that hashes every file of every root (after a snapshot rebuild) keeps the extension host
 * responsive and the disk busy, where the synchronous walk froze the window for a minute.
 */
async function inOrder<T, R>(
  items: readonly T[],
  width: number,
  read: (item: T) => Promise<R>,
  use: (item: T, value: R) => void,
): Promise<void> {
  for (let start = 0; start < items.length; start += width) {
    const chunk = items.slice(start, start + width)
    const values = await Promise.all(chunk.map(read))
    chunk.forEach((item, index) => use(item, values[index] as R))
  }
}

const IO_WIDTH = 32

function sha256(value: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

interface ArtifactDigests {
  readonly artifactDigest: string
  /** Every artifact file (posix path relative to the root) → `sha256:…` of its contents. */
  readonly fileDigests: Readonly<Record<string, string>>
}

/** One file of the tree digest (length-prefixed path and contents) and its own digest. */
function hashArtifactFile(
  hash: Hash,
  fileDigests: Record<string, string>,
  path: string,
  contents: Uint8Array,
): void {
  const pathBytes = Buffer.from(path, 'utf8')
  hash.update(Buffer.from(String(pathBytes.byteLength)))
  hash.update(Buffer.from([0]))
  hash.update(pathBytes)
  hash.update(Buffer.from([0]))
  hash.update(Buffer.from(String(contents.byteLength)))
  hash.update(Buffer.from([0]))
  hash.update(contents)
  fileDigests[path] = sha256(contents)
}

/** Tree and per-file digests from one ordered listing with bounded asynchronous reads. */
async function artifactDigestsAsync(
  root: string,
  listed: readonly string[],
): Promise<ArtifactDigests> {
  const hash = createHash('sha256')
  const fileDigests: Record<string, string> = {}
  await inOrder(
    listed,
    IO_WIDTH,
    path => readFile(join(root, path)),
    (path, contents) => hashArtifactFile(hash, fileDigests, path, contents),
  )
  return { artifactDigest: `sha256:${hash.digest('hex')}`, fileDigests: Object.freeze(fileDigests) }
}

const verifiedDigests = new Map<
  string,
  { readonly fingerprint: string; readonly digests: ArtifactDigests }
>()
/** Roots whose recursive watcher reported no change since their fingerprint was taken. */
const unchangedRoots = new Set<string>()
const watchedRoots = new Set<string>()
/** Digest work is shared, never the comparison with a caller's expected digest. */
const pendingVerifications = new Map<string, Promise<string>>()

function watchArtifactRoot(root: string): void {
  if (watchedRoots.has(root)) return
  watchedRoots.add(root)
  try {
    const stop = (): void => {
      unchangedRoots.delete(root)
      watchedRoots.delete(root)
      verifiedDigests.delete(root)
      watcher.close()
    }
    const watcher = watch(root, { recursive: true, persistent: false }, () => {
      unchangedRoots.delete(root)
      // Windows keeps a removed recursive root alive even with persistent:false.
      // Release it, and let a directory recreated at this path acquire a fresh watcher.
      if (!existsSync(root)) stop()
    })
    watcher.on('error', stop)
  } catch {
    // No recursive watching here: every verification keeps taking the stat fingerprint.
    watchedRoots.delete(root)
  }
}

const fingerprintLine = (
  path: string,
  info: { readonly size: bigint; readonly mtimeNs: bigint },
): string => `${path}\0${String(info.size)}\0${String(info.mtimeNs)}\0`

async function statFingerprintAsync(root: string, listed: readonly string[]): Promise<string> {
  const fingerprint = createHash('sha256')
  await inOrder(
    listed,
    IO_WIDTH,
    path => stat(join(root, path), { bigint: true }),
    (path, info) => fingerprint.update(fingerprintLine(path, info)),
  )
  return fingerprint.digest('hex')
}

/** Reuse memory or persistent digests only at the current stat fingerprint, otherwise hash. */
async function digestsForAsync(root: string, listed: readonly string[]): Promise<ArtifactDigests> {
  const fingerprint = await statFingerprintAsync(root, listed)
  return (
    knownDigests(root, fingerprint) ??
    rememberDigests(root, fingerprint, await artifactDigestsAsync(root, listed))
  )
}

/** In-process memory, then the application's persistent cache, at this fingerprint. */
function knownDigests(root: string, fingerprint: string): ArtifactDigests | undefined {
  const live = verifiedDigests.get(root)
  if (live?.fingerprint === fingerprint) return live.digests
  const stored = cachedArtifactDigest(root, fingerprint)
  if (stored === undefined) return undefined
  const digests: ArtifactDigests = {
    artifactDigest: stored.artifactDigest,
    fileDigests: stored.fileDigests,
  }
  verifiedDigests.set(root, { fingerprint, digests })
  return digests
}

function rememberDigests(
  root: string,
  fingerprint: string,
  digests: ArtifactDigests,
): ArtifactDigests {
  verifiedDigests.set(root, { fingerprint, digests })
  rememberArtifactDigest(root, {
    fingerprint,
    artifactDigest: digests.artifactDigest,
    fileDigests: digests.fileDigests,
  })
  return digests
}

/** Full async verification; watcher events invalidate a scan before its digest can be admitted. */
function artifactDigest(root: string): Promise<string> {
  const running = pendingVerifications.get(root)
  if (running !== undefined) return running
  const live = verifiedDigests.get(root)
  if (live !== undefined && unchangedRoots.has(root)) return Promise.resolve(live.digests.artifactDigest)
  watchArtifactRoot(root)
  const pending = (async () => {
    try {
      // One retry handles an event queued before/during the scan; continuous writes fail closed.
      for (let attempt = 0; attempt < 2; attempt++) {
        const watching = watchedRoots.has(root)
        if (watching) unchangedRoots.add(root)
        const listed = await listArtifactFilesAsync(root)
        const digests = await digestsForAsync(root, listed)
        if (!watching || unchangedRoots.has(root)) return digests.artifactDigest
        verifiedDigests.delete(root)
      }
      throw new Error(`artifact changed during verification: ${root}`)
    } catch (error) {
      unchangedRoots.delete(root)
      verifiedDigests.delete(root)
      throw error
    }
  })()
  pendingVerifications.set(root, pending)
  const release = (): void => { pendingVerifications.delete(root) }
  void pending.then(release, release)
  return pending
}

async function readJsonIfExists(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Reads one extension directory into a data-only inventory input. */
export async function loadExtensionDirectory(
  dir: string,
  signal?: AbortSignal,
): Promise<ExtensionInput> {
  throwIfAborted(signal)
  if (!(await stat(dir).catch(() => undefined))?.isDirectory()) {
    throw new Error(`not a directory: ${dir}`)
  }
  const packageJson = await readJsonIfExists(join(dir, 'package.json'))
  const standalone = await readJsonIfExists(join(dir, 'modkit.extension.json'))
  const containers = {
    ...(packageJson === undefined ? {} : { packageJson }),
    ...(standalone === undefined ? {} : { standalone }),
  }
  watchArtifactRoot(dir)
  /*
   * One walk serves both listings. The inventory sees the artifact without build output
   * (`listFilesRecursive` skips every entry named `dist`), and the stat fingerprint reuses the
   * artifact listing instead of walking the tree a second time — 7,000 files over 39 roots
   * cost the extension host about a second per extra walk.
   */
  const artifactFiles = await listArtifactFilesAsync(dir)
  const files = artifactFiles.filter(path => !path.split('/').includes('dist'))
  const documents = new Map<string, unknown>()
  const documentDigests = new Map<string, string>()
  // Pre-read only the documents the declared patterns select; the inventory re-runs the
  // same pure expansion, so both sides see one declared set.
  const initial = await digestsForAsync(dir, artifactFiles)
  const normalized = await normalizeExtensionManifest(containers)
  if (normalized.manifest) {
    throwIfAborted(signal)
    const expansion = expandContributionManifests(normalized.manifest.contributionManifests, files)
    // Use the same bounded IO as hashing. Settled reads retain the first declared error rather
    // than whichever malformed document happened to finish first; the inventory order is unchanged.
    await inOrder(
      expansion.entries,
      IO_WIDTH,
      async entry => {
        try {
          const documentPath = join(dir, entry.path)
          const document = await readJsonIfExists(documentPath)
          // The artifact walk already hashed these files; retain the existing fallback for a
          // document not covered by that walk rather than leaving its digest absent.
          const value = document === undefined ? undefined : ([
            document, initial.fileDigests[entry.path] ?? sha256(await readFile(documentPath)),
          ] as const)
          return { status: 'fulfilled' as const, value }
        } catch (reason) {
          return { status: 'rejected' as const, reason }
        }
      },
      (entry, result) => {
        if (result.status === 'rejected') throw result.reason
        if (result.value === undefined) return
        const [document, digest] = result.value
        documents.set(entry.path, document)
        documentDigests.set(entry.path, digest)
      },
    )
  }
  const initialArtifactDigest = initial.artifactDigest
  const artifactRoot = pathToFileURL(`${dir}${sep}`)
  return {
    source: dir.split(sep).join('/'),
    containers,
    files,
    documents,
    documentDigests,
    artifact: {
      inventoryRecordId: `artifact:${initialArtifactDigest}`,
      artifactDigest: initialArtifactDigest,
      artifactRoot,
      fileDigests: initial.fileDigests,
      verifyArtifactDigest: async expected => (await artifactDigest(dir)) === expected,
    },
  }
}
