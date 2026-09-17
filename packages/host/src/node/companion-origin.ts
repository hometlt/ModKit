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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

/**
 * `sibling-directory` always. `enclosing-container` only when an ancestor directory is named like a
 * container format the inventory knows (a loose `Foo.SC2Mod` folder is the archive, unpacked); its
 * logical ids are then relative to that folder, exactly as they are inside the packed archive.
 */
const SIBLING_SCOPES: readonly InputSearchScope[] = Object.freeze(['sibling-directory'])
const CONTAINER_SCOPES: readonly InputSearchScope[] = Object.freeze([
  'sibling-directory',
  'enclosing-container',
])

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
  /**
   * Lower-case extensions (no dot) of container formats. The nearest ancestor directory inside a
   * granted root whose name ends in one of them is the `enclosing-container` scope.
   */
  readonly containerExtensions?: readonly string[]
  /**
   * Per container extension, the directories inside it that `enclosing-container` ids resolve
   * under, in lookup order (`''` the container root, `*.Suffix` every top-level directory with that
   * suffix). An extension without an entry serves its root only.
   */
  readonly containerAssetRoots?: Readonly<Record<string, readonly string[]>>
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
  const fold = (value: string): string =>
    caseSensitivity === 'insensitive' ? value.toLowerCase() : value
  const container = enclosingContainer(root, roots, options.containerExtensions ?? [])
  const assetRootPatterns =
    container === undefined
      ? ['']
      : (Object.entries(options.containerAssetRoots ?? {}).find(([extension]) =>
          basename(container).toLowerCase().endsWith(`.${extension.toLowerCase()}`),
        )?.[1] ?? [''])
  /** The container's asset directories that exist, in lookup order (resolved once). */
  let assetBases: Promise<readonly string[]> | undefined
  const containerBases = (): Promise<readonly string[]> =>
    (assetBases ??= (async () => {
      if (container === undefined) return []
      const bases: string[] = []
      for (const pattern of assetRootPatterns) {
        const names: string[] = []
        if (pattern.startsWith('*')) {
          const suffix = pattern.slice(1).toLowerCase()
          const directory = await opendir(container)
          try {
            for await (const entry of directory)
              if (entry.isDirectory() && entry.name.toLowerCase().endsWith(suffix))
                names.push(entry.name)
          } finally {
            await directory.close().catch(() => undefined)
          }
          names.sort()
        } else names.push(pattern)
        for (const name of names) {
          const base = name === '' ? container : await directoryPath(name, container)
          if (base !== undefined && !bases.some(item => fold(item) === fold(base))) bases.push(base)
        }
      }
      return bases
    })())
  /** Container-scope ids seen by `enumerate` → the asset base `open` reads them from. */
  const containerIds = new Map<string, string>()

  const confinedPath = (logicalId: string, base = root): string => {
    const normalized = normalizeCompanionLogicalId(logicalId)
    const path = resolve(join(base, normalized))
    if (!insideRoot(base, path)) {
      throw new ModkitError({
        code: COMPANION_PATH_REFUSED,
        message: `companion «${normalized}» resolves outside its confined origin root`,
        context: { logicalId: normalized },
      })
    }
    return path
  }

  const directoryPath = async (prefix: string, base = root): Promise<string | undefined> => {
    if (prefix === '') return base
    const normalized = normalizeCompanionLogicalId(prefix)
    let path = base
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
    scopes: container === undefined ? SIBLING_SCOPES : CONTAINER_SCOPES,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ): AsyncIterable<CompanionOriginEntry> {
      throwIfAborted(signal)
      const bases =
        scope === 'sibling-directory'
          ? [root]
          : scope === 'enclosing-container'
            ? await containerBases()
            : []
      // Asset directories overlay in order: the first spelling of a logical id wins.
      const yielded = new Set<string>()
      for (const base of bases) yield* enumerateBase(base, scope, yielded, enumeration, signal)
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      const normalized = normalizeCompanionLogicalId(logicalId)
      // ponytail: a container id that also spells a real sibling path opens the container file.
      const base = containerIds.get(fold(normalized)) ?? root
      const parent = normalized.slice(0, normalized.lastIndexOf('/') + 1)
      const directory = await directoryPath(parent, base)
      if (directory === undefined || !(await lstat(confinedPath(normalized, base))).isFile())
        throw new ModkitError({
          code: COMPANION_PATH_REFUSED,
          message: 'resource path is not a regular file inside the confined origin',
        })
      const source = await openFileArtifactSource(
        confinedPath(normalized, base),
        signal === undefined ? {} : { signal },
      )
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })

  async function* enumerateBase(
    base: string,
    scope: InputSearchScope,
    yielded: Set<string>,
    enumeration: CompanionEnumerationOptions,
    signal?: AbortSignal,
  ): AsyncIterable<CompanionOriginEntry> {
    const prefix = enumeration.prefix.replaceAll('\\', '/')
    const foldedPrefix = fold(prefix)
    const parent = prefix.slice(0, prefix.lastIndexOf('/') + 1)
    const path = await directoryPath(parent, base)
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
        if (scope !== 'sibling-directory') {
          const absolute = join(path, entry.name)
          // The primary is excluded by id in the sibling space; in the container space it is
          // excluded here, where its container-relative spelling is known.
          if (fold(absolute) === fold(primaryPath) || yielded.has(fold(logicalId))) continue
          yielded.add(fold(logicalId))
          containerIds.set(fold(logicalId), base)
        }
        yield Object.freeze({ logicalId })
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
  }
}

/** The nearest ancestor of `directory`, inside a granted root, named like a container format. */
function enclosingContainer(
  directory: string,
  roots: readonly string[],
  extensions: readonly string[],
): string | undefined {
  if (extensions.length === 0) return undefined
  const suffixes = extensions.map(extension => `.${extension.toLowerCase()}`)
  for (let current = directory; ; current = dirname(current)) {
    if (!roots.some(value => insideRoot(value, current))) return undefined
    const name = basename(current).toLowerCase()
    if (suffixes.some(suffix => name.endsWith(suffix) && name.length > suffix.length))
      return current
    if (dirname(current) === current) return undefined
  }
}
