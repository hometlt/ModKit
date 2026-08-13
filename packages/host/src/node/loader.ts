/**
 * Node filesystem adapter for the data-only loader: reads the two candidate authored
 * containers, the file listing and every declared contribution document, and hands the
 * pre-read data to the portable inventory. Reading is the only thing that happens here —
 * no execution, no globbing beyond the declared patterns (expansion is pure sdk code).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
  // Pre-read only the documents the declared patterns select; the inventory re-runs the
  // same pure expansion, so both sides see one declared set.
  const normalized = await normalizeExtensionManifest(containers)
  if (normalized.manifest) {
    throwIfAborted(signal)
    const expansion = expandContributionManifests(normalized.manifest.contributionManifests, files)
    for (const entry of expansion.entries) {
      const document = readJsonIfExists(join(dir, entry.path))
      if (document !== undefined) documents.set(entry.path, document)
    }
  }
  return { source: dir.split(sep).join('/'), containers, files, documents }
}
