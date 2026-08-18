/**
 * Node filesystem adapter for the data-only loader: reads the two candidate authored
 * containers, the file listing and every declared contribution document, and hands the
 * pre-read data to the portable inventory. Reading is the only thing that happens here —
 * no execution, no globbing beyond the declared patterns (expansion is pure sdk code).
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { throwIfAborted } from '@modkitx-x3/core'
import { expandContributionManifests, normalizeExtensionManifest } from '@modkitx-x3/sdk'
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

function artifactDigest(root: string): string {
  return artifactDigests(root).artifactDigest
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
