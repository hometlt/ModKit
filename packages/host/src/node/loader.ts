/**
 * Node filesystem adapter for the data-only loader: reads the two candidate authored
 * containers, the file listing and every declared contribution document, and hands the
 * pre-read data to the portable inventory. Reading is the only thing that happens here —
 * no execution, no globbing beyond the declared patterns (expansion is pure sdk code).
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, watch } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { throwIfAborted } from '@modkit/core'
import { expandContributionManifests, normalizeExtensionManifest } from '@modkit/sdk'
import type { ExtensionInput } from '../inventory.js'

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

function listArtifactFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

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
  for (const path of listArtifactFiles(root)) {
    const pathBytes = Buffer.from(path, 'utf8')
    const contents = readFileSync(join(root, path))
    hash.update(Buffer.from(String(pathBytes.byteLength)))
    hash.update(Buffer.from([0]))
    hash.update(pathBytes)
    hash.update(Buffer.from([0]))
    hash.update(Buffer.from(String(contents.byteLength)))
    hash.update(Buffer.from([0]))
    hash.update(contents)
    fileDigests[path] = sha256(contents)
  }
  return { artifactDigest: `sha256:${hash.digest('hex')}`, fileDigests: Object.freeze(fileDigests) }
}

const verifiedDigests = new Map<string, { readonly fingerprint: string; readonly digest: string }>()
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
function artifactDigest(root: string): string {
  const cachedDigest = verifiedDigests.get(root)
  if (cachedDigest !== undefined && unchangedRoots.has(root)) return cachedDigest.digest
  watchArtifactRoot(root)
  if (watchedRoots.has(root)) unchangedRoots.add(root)
  const files = listArtifactFiles(root)
  const fingerprint = createHash('sha256')
  for (const path of files) {
    const info = statSync(join(root, path), { bigint: true })
    fingerprint.update(`${path}\u0000${String(info.size)}\u0000${String(info.mtimeNs)}\u0000`)
  }
  const key = fingerprint.digest('hex')
  const cached = verifiedDigests.get(root)
  if (cached?.fingerprint === key) return cached.digest
  const digest = artifactDigests(root).artifactDigest
  verifiedDigests.set(root, { fingerprint: key, digest })
  return digest
}

function readJsonIfExists(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
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
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`not a directory: ${dir}`)
  }
  const packageJson = readJsonIfExists(join(dir, 'package.json'))
  const standalone = readJsonIfExists(join(dir, 'modkit.extension.json'))
  const containers = {
    ...(packageJson === undefined ? {} : { packageJson }),
    ...(standalone === undefined ? {} : { standalone }),
  }
  const files = listFilesRecursive(dir)
  const documents = new Map<string, unknown>()
  const documentDigests = new Map<string, string>()
  // Pre-read only the documents the declared patterns select; the inventory re-runs the
  // same pure expansion, so both sides see one declared set.
  const normalized = await normalizeExtensionManifest(containers)
  if (normalized.manifest) {
    throwIfAborted(signal)
    const expansion = expandContributionManifests(normalized.manifest.contributionManifests, files)
    for (const entry of expansion.entries) {
      const documentPath = join(dir, entry.path)
      const document = readJsonIfExists(documentPath)
      if (document !== undefined) {
        documents.set(entry.path, document)
        documentDigests.set(entry.path, sha256(readFileSync(documentPath)))
      }
    }
  }
  const initial = artifactDigests(dir)
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
