/**
 * The filesystem origin backend for host-owned companion resolution (block 9, step 1).
 *
 * It is deliberately the smallest possible thing that can honestly answer "what else is next to
 * this file": one confined directory — the primary subject's own, and only when that directory is
 * itself inside the roots the product granted. An explicitly named relative subdirectory may be
 * listed too; there is no recursive search. Sources use the ordinary revision-pinned file adapter.
 *
 * It lives under `node/` and not beside the resolver on purpose: the algorithm must not import
 * `node:fs`, or every browser profile that opens a subject would carry a filesystem backend it can
 * never call.
 */

import { opendir, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ModkitError, throwIfAborted } from '@modkit/core'
import type { ArtifactSource, InputSearchScope, Lease } from '@modkit/sdk'
import {
  normalizeCompanionLogicalId,
  COMPANION_PATH_REFUSED,
  type CompanionCaseSensitivity,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
  type CompanionOriginEntry,
} from '../input-resolution.js'
import { openFileArtifactSource } from './file-artifact-source.js'

/** `sibling-directory` and nothing else: a directory is not a mount and not a container. */
const FILESYSTEM_SCOPES: readonly InputSearchScope[] = Object.freeze(['sibling-directory'])

/** The primary subject's directory lies outside every root the product granted. */
export const COMPANION_ORIGIN_OUTSIDE_ROOTS = 'x3.host/companion-origin-outside-roots'

export interface FilesystemCompanionOriginOptions {
  /** Absolute path of the primary subject. Its directory becomes the confined root. */
  readonly primaryPath: string
  /** Absolute directories the product granted; a subject outside every one of them is refused. */
  readonly roots: readonly string[]
  /**
   * Defaults to the platform's own rule — Windows and macOS fold case, Linux does not. Stated
   * explicitly rather than assumed, because it decides whether `Sample.HVA` and `sample.hva` are
   * one companion or two, and a test must be able to pin either answer.
   */
  readonly caseSensitivity?: CompanionCaseSensitivity
}

function insideRoot(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

const platformCaseSensitivity = (): CompanionCaseSensitivity =>
  process.platform === 'win32' || process.platform === 'darwin' ? 'insensitive' : 'sensitive'

/**
 * Binds one on-disk file to the directory it sits in. Everything the resolver may later reach is
 * fixed here, at construction time, by the product that knows the granted roots.
 */
export function createFilesystemCompanionOrigin(
  options: FilesystemCompanionOriginOptions,
): CompanionOrigin {
  const primaryPath = resolve(options.primaryPath)
  const root = dirname(primaryPath)
  const roots = options.roots.map(value => resolve(value))
  if (roots.length === 0 || !roots.some(value => insideRoot(value, root))) {
    /*
     * Its own code, not the editing backend's.
     *
     * Both refusals mean "outside the granted roots", and reusing `x3.host/edit-path-outside-roots`
     * here would have been shorter — but that code belongs to the editing backend, and a read-only
     * companion search reported under it would tell an operator that a *write* was refused. Two
     * boundaries that fail for the same reason still have to be distinguishable in a log.
     */
    throw new ModkitError({
      code: COMPANION_ORIGIN_OUTSIDE_ROOTS,
      message: 'the companion origin directory is outside every granted root',
    })
  }
  const primaryLogicalId = normalizeCompanionLogicalId(relative(root, primaryPath))
  const caseSensitivity = options.caseSensitivity ?? platformCaseSensitivity()

  const confinedPath = (logicalId: string): string => {
    const normalized = normalizeCompanionLogicalId(logicalId)
    const path = resolve(join(root, normalized))
    if (!insideRoot(root, path)) {
      throw new ModkitError({
        code: COMPANION_PATH_REFUSED,
        message: `companion «${normalized}» resolves outside its confined origin root`,
        context: { logicalId: normalized },
      })
    }
    return path
  }

  const directoryPath = async (prefix: string): Promise<string | undefined> => {
    if (prefix === '') return root
    const normalized = normalizeCompanionLogicalId(prefix)
    let path = root
    for (const segment of normalized.split('/')) {
      path = join(path, segment)
      try {
        const info = await lstat(path)
        if (info.isSymbolicLink() || !info.isDirectory()) return undefined
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
          return undefined
        throw error
      }
    }
    return path
  }

  return Object.freeze({
    primaryLogicalId,
    caseSensitivity,
    scopes: FILESYSTEM_SCOPES,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ): AsyncIterable<CompanionOriginEntry> {
      throwIfAborted(signal)
      if (scope !== 'sibling-directory') return
      const prefix = enumeration.prefix.replaceAll('\\', '/')
      const foldedPrefix = caseSensitivity === 'insensitive' ? prefix.toLowerCase() : prefix
      const parent = prefix.slice(0, prefix.lastIndexOf('/') + 1)
      const path = await directoryPath(parent)
      if (path === undefined) return
      const directory = await opendir(path)
      try {
        for await (const entry of directory) {
          throwIfAborted(signal)
          /*
           * Regular files only. `isFile()` on a Dirent is lstat-shaped, so a symlink reports
           * `isSymbolicLink()` and never `isFile()` — which is exactly the confinement rule the
           * block plan asks for ("do not follow a filesystem symlink out of the confined root")
           * expressed as a refusal to consider one at all, rather than as a resolve-then-check.
           */
          if (!entry.isFile()) continue
          const logicalId = parent + entry.name
          const candidate = caseSensitivity === 'insensitive' ? logicalId.toLowerCase() : logicalId
          // Each exact texture request has its own prefix. Returning unrelated siblings here
          // charges the same directory repeatedly and exhausts the resolver's entry budget.
          if (!candidate.startsWith(foldedPrefix)) continue
          yield Object.freeze({ logicalId })
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      const normalized = normalizeCompanionLogicalId(logicalId)
      const parent = normalized.slice(0, normalized.lastIndexOf('/') + 1)
      const directory = await directoryPath(parent)
      if (directory === undefined || !(await lstat(confinedPath(normalized))).isFile())
        throw new ModkitError({
          code: COMPANION_PATH_REFUSED,
          message: 'resource path is not a regular file inside the confined origin',
        })
      const source = await openFileArtifactSource(
        confinedPath(normalized),
        signal === undefined ? {} : { signal },
      )
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}
