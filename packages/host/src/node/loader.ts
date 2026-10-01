/**
 * Node filesystem adapter for the data-only loader: reads the two candidate authored
 * containers, the file listing and every declared contribution document, and hands the
 * pre-read data to the portable inventory. Reading is the only thing that happens here —
 * no execution, no globbing beyond the declared patterns (expansion is pure sdk code).
 */

import { createHash, type Hash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, watch } from 'node:fs'
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

function listArtifactFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

/** listArtifactFiles without holding the thread: the same files in the same order. */
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

/**
 * One walk yields both the tree digest (paths + contents, the inventory identity) and per-file
 * digests: an execution backend that evaluates files inside a worker verifies each one against
 * this map right before evaluation, closing the window between the gate's check and the load.
 */
function artifactDigests(root: string): ArtifactDigests {
  const hash = createHash('sha256')
  const fileDigests: Record<string, string> = {}
  for (const path of listArtifactFiles(root))
    hashArtifactFile(hash, fileDigests, path, readFileSync(join(root, path)))
  return { artifactDigest: `sha256:${hash.digest('hex')}`, fileDigests: Object.freeze(fileDigests) }
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

/** artifactDigests over a listing, reading files in parallel: the same digests. */
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

function watchArtifactRoot(root: string): void {
  if (watchedRoots.has(root)) return
  watchedRoots.add(root)
  try {
    const watcher = watch(root, { recursive: true, persistent: false }, () =>
      unchangedRoots.delete(root),
    )
    watcher.on('error', () => {
      unchangedRoots.delete(root)
      watchedRoots.delete(root)
      watcher.close()
    })
  } catch {
    // No recursive watching here: every verification keeps taking the stat fingerprint.
    watchedRoots.delete(root)
  }
}

/**
 * Current artifact digest, re-hashed only when a file was added, removed, resized or touched.
 * Activation verifies the artifact on every codec open; hashing every file each time dominated
 * model loading (a 4700-file extension costs ~0.5 s per open, many opens per model). A recursive
 * watcher skips even the stat walk until something under the root changes.
 */
/** Paths, sizes and modification times: the cheap evidence that contents are unchanged. */
function statFingerprint(
  root: string,
  listed: readonly string[] = listArtifactFiles(root),
): string {
  const fingerprint = createHash('sha256')
  for (const path of listed)
    fingerprint.update(fingerprintLine(path, statSync(join(root, path), { bigint: true })))
  return fingerprint.digest('hex')
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

/**
 * Digests of this root, from the cheapest source that is still evidence.
 *
 * In-process memory first, then the application's persistent cache (a window start otherwise
 * re-hashes every file of every root), then the files themselves. A record is admitted only when
 * the stat fingerprint matches, so anything that changed is hashed again.
 */
function digestsFor(root: string, listed?: readonly string[]): ArtifactDigests {
  const fingerprint = statFingerprint(root, listed)
  return (
    knownDigests(root, fingerprint) ?? rememberDigests(root, fingerprint, artifactDigests(root))
  )
}

/** digestsFor without holding the thread, for loading a root. */
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

function artifactDigest(root: string): string {
  const live = verifiedDigests.get(root)
  if (live !== undefined && unchangedRoots.has(root)) return live.digests.artifactDigest
  watchArtifactRoot(root)
  if (watchedRoots.has(root)) unchangedRoots.add(root)
  return digestsFor(root).artifactDigest
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
    for (const entry of expansion.entries) {
      const documentPath = join(dir, entry.path)
      const document = await readJsonIfExists(documentPath)
      if (document !== undefined) {
        documents.set(entry.path, document)
        /*
         * The artifact walk above already hashed every file of this tree, this document among
         * them; reading and hashing it a second time is the same answer for twice the I/O. A file
         * the walk did not cover (it cannot happen for a declared document inside the root) is
         * still hashed here rather than left without a digest.
         */
        documentDigests.set(
          entry.path,
          initial.fileDigests[entry.path] ?? sha256(await readFile(documentPath)),
        )
      }
    }
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
      verifyArtifactDigest: expected => artifactDigest(dir) === expected,
    },
  }
}
