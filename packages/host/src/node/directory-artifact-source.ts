/**
 * A confined filesystem directory exposed as one bounded SDK namespace subject.
 *
 * The adapter is intentionally game-neutral: the host decides only that the requested path is a
 * directory. Codec contribution matching decides whether that namespace is an SC2 map, a mod, an
 * installed-game root, or nothing Modkit understands.
 */

import { realpath, readdir, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ModkitError, throwIfAborted } from '@modkit/core'
import {
  revisionId,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetNamespace,
  type AssetSourceRef,
  type Lease,
} from '@modkit/sdk'
import { normalizeVfsPath } from '@modkit/vfs'
import { openFileArtifactSource } from './file-artifact-source.js'

const PATH_ENCODER = new TextEncoder()

export interface DirectoryArtifactSourceOptions {
  /** Unique entries exposed during the lifetime of this source. */
  readonly maxEntries?: number
  /** Maximum logical path depth below the selected directory. */
  readonly maxDepth?: number
  /** Maximum UTF-8 bytes in one logical path. */
  readonly maxPathBytes?: number
  readonly signal?: AbortSignal
}

const DEFAULT_DIRECTORY_LIMITS = Object.freeze({
  maxEntries: 25_000,
  maxDepth: 256,
  maxPathBytes: 4096,
})

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new ModkitError({
      code: 'x3.host/directory-limit-invalid',
      message: `${name} must be a positive safe integer`,
      context: { name, value: selected },
    })
  }
  return selected
}

function directoryRevision(info: Awaited<ReturnType<typeof stat>>): string {
  return `provider-token:${info.dev}-${info.ino}-${info.size}-${BigInt(Math.trunc(Number(info.mtimeMs) * 1_000_000))}`
}

function nestedRef(root: AssetSourceRef, path: string): AssetSourceRef {
  const uri = `${root.uri}?vfs-path=${encodeURIComponent(path)}`
  return Object.freeze({ id: uri, uri, parentIds: Object.freeze([root.id] as const) })
}

export async function openDirectoryArtifactSource(
  directory: string,
  options: DirectoryArtifactSourceOptions = {},
): Promise<ArtifactNamespaceSource> {
  throwIfAborted(options.signal)
  const root = await realpath(directory)
  const rootInfo = await stat(root)
  if (!rootInfo.isDirectory()) {
    throw new ModkitError({
      code: 'x3.host/source-not-a-directory',
      message: `subject path «${directory}» is not a directory`,
      context: { path: directory },
    })
  }
  const limits = Object.freeze({
    maxEntries: positiveLimit(
      options.maxEntries,
      DEFAULT_DIRECTORY_LIMITS.maxEntries,
      'maxEntries',
    ),
    maxDepth: positiveLimit(options.maxDepth, DEFAULT_DIRECTORY_LIMITS.maxDepth, 'maxDepth'),
    maxPathBytes: positiveLimit(
      options.maxPathBytes,
      DEFAULT_DIRECTORY_LIMITS.maxPathBytes,
      'maxPathBytes',
    ),
  })
  const exposed = new Set<string>()
  const rootUri = pathToFileURL(root).href
  const rootRef: AssetSourceRef = Object.freeze({ id: rootUri, uri: rootUri })

  const normalize = (value: string): string => {
    if (value.includes('\0') || isAbsolute(value) || /^[a-z]:[/\\]/iu.test(value)) {
      throw new ModkitError({
        code: 'x3.host/namespace-path-refused',
        message: `namespace path «${value}» is outside the selected directory`,
        context: { path: value },
      })
    }
    let normalized: string
    try {
      normalized = normalizeVfsPath(value)
    } catch (cause) {
      throw new ModkitError({
        code: 'x3.host/namespace-path-refused',
        message: `namespace path «${value}» is outside the selected directory`,
        context: { path: value },
        cause,
      })
    }
    const depth = normalized === '' ? 0 : normalized.split('/').length
    const pathBytes = PATH_ENCODER.encode(normalized).byteLength
    if (depth > limits.maxDepth || pathBytes > limits.maxPathBytes) {
      throw new ModkitError({
        code: 'x3.host/namespace-path-budget-exceeded',
        message: 'namespace path exceeds the bounded directory source limits',
        context: {
          path: normalized,
          depth,
          maxDepth: limits.maxDepth,
          pathBytes,
          maxPathBytes: limits.maxPathBytes,
        },
      })
    }
    return normalized
  }

  const resolveInside = async (logicalPath: string): Promise<{ path: string; absolute: string }> => {
    const path = normalize(logicalPath)
    const candidate = resolve(root, ...path.split('/').filter(Boolean))
    let absolute: string
    try {
      absolute = await realpath(candidate)
    } catch (cause) {
      throw new ModkitError({
        code: 'x3.host/namespace-entry-not-found',
        message: `namespace entry «${path}» does not exist`,
        context: { path },
        cause,
      })
    }
    const inner = relative(root, absolute)
    if (inner.startsWith('..') || isAbsolute(inner)) {
      throw new ModkitError({
        code: 'x3.host/namespace-path-refused',
        message: `namespace path «${logicalPath}» is outside the selected directory`,
        context: { path: logicalPath },
      })
    }
    return { path, absolute }
  }

  const count = (path: string): void => {
    if (exposed.has(path)) return
    exposed.add(path)
    if (exposed.size > limits.maxEntries) {
      throw new ModkitError({
        code: 'x3.host/directory-entry-budget-exceeded',
        message: `directory source exceeded its ${limits.maxEntries}-entry budget`,
        context: { entries: exposed.size, maxEntries: limits.maxEntries },
      })
    }
  }

  const join = (prefix: string, path: string): string =>
    normalize(prefix === '' ? path : path === '' ? prefix : `${prefix}/${path}`)

  const relativeTo = (prefix: string, path: string): string =>
    prefix === '' ? path : path.slice(prefix.length + 1)

  const sourceAt = (
    prefix: string,
    ref: AssetSourceRef,
    revision: string,
  ): ArtifactNamespaceSource =>
    Object.freeze({
      kind: 'namespace' as const,
      ref,
      revision: revisionId(revision),
      async openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>> {
        throwIfAborted(signal)
        const namespace: AssetNamespace = Object.freeze({
          revision: revisionId(revision),
          async *list(listPrefix: string, listSignal?: AbortSignal) {
            throwIfAborted(listSignal)
            const requested = await resolveInside(join(prefix, listPrefix))
            const info = await stat(requested.absolute)
            if (!info.isDirectory()) {
              throw new ModkitError({
                code: 'x3.host/namespace-entry-not-directory',
                message: `namespace entry «${requested.path}» is not a directory`,
                context: { path: requested.path },
              })
            }
            const entries = await readdir(requested.absolute, { withFileTypes: true })
            for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
              throwIfAborted(listSignal)
              const childPath = normalize(
                requested.path === '' ? entry.name : `${requested.path}/${entry.name}`,
              )
              const child = await resolveInside(childPath)
              const childInfo = await stat(child.absolute)
              count(childPath)
              yield Object.freeze({
                path: relativeTo(prefix, childPath),
                kind: childInfo.isDirectory() ? ('directory' as const) : ('file' as const),
                ...(childInfo.isFile() ? { size: BigInt(childInfo.size) } : {}),
              })
            }
          },
          async open(entryPath: string, openSignal?: AbortSignal): Promise<Lease<ArtifactSource>> {
            throwIfAborted(openSignal)
            const child = await resolveInside(join(prefix, entryPath))
            const info = await stat(child.absolute)
            count(child.path)
            const childRef = nestedRef(rootRef, child.path)
            if (info.isDirectory()) {
              return Object.freeze({
                value: sourceAt(child.path, childRef, directoryRevision(info)),
                release: async () => undefined,
              })
            }
            if (!info.isFile()) {
              throw new ModkitError({
                code: 'x3.host/namespace-entry-type-refused',
                message: `namespace entry «${child.path}» is neither a file nor a directory`,
                context: { path: child.path },
              })
            }
            const value = await openFileArtifactSource(child.absolute, {
              uri: childRef.uri,
              ...(openSignal === undefined ? {} : { signal: openSignal }),
            })
            return Object.freeze({ value, release: async () => undefined })
          },
        })
        return Object.freeze({ value: namespace, release: async () => undefined })
      },
    })

  return sourceAt('', rootRef, directoryRevision(rootInfo))
}

export async function openPathArtifactSource(
  path: string,
  options: DirectoryArtifactSourceOptions = {},
): Promise<ArtifactSource> {
  throwIfAborted(options.signal)
  const info = await stat(path)
  return info.isDirectory()
    ? openDirectoryArtifactSource(path, options)
    : openFileArtifactSource(path, options.signal === undefined ? {} : { signal: options.signal })
}
