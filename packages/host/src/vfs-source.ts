/** Portable bridge from an explicitly opened VFS mount to the SDK namespace-source contract. */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import {
  revisionId,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetNamespace,
  type AssetSourceRef,
  type InputSearchScope,
  type Lease,
} from '@modkitx-x3/sdk'
import { normalizeVfsPath, type VfsMount } from '@modkitx-x3/vfs'

import {
  createCompanionInputResolver,
  type CompanionCaseSensitivity,
  type CompanionEnumerationOptions,
  type CompanionInputResolverOptions,
  type CompanionOrigin,
} from './input-resolution.js'
import { artifactByteSourceFromRandomAccess } from './source-bridge.js'

export interface ArtifactNamespaceSourceFromVfsOptions {
  /** Directory inside the mount to expose as the namespace root. */
  readonly rootPath?: string
  /** Optional stable public identity; defaults to the mount identity and URI. */
  readonly ref?: AssetSourceRef
}

export interface VfsCompanionOriginOptions {
  readonly mount: VfsMount
  /** Candidate path in the mount. It is never offered back as its own companion. */
  readonly primaryLogicalId: string
  /** Directory in the mount exposed as the logical companion root. */
  readonly rootPath?: string
  readonly caseSensitivity?: CompanionCaseSensitivity
  /** Counts both traversed directories and files when a non-exact prefix requires a walk. */
  readonly maxTraversalEntries?: number
}

function scopedPath(root: string, path: string): string {
  const normalized = normalizeVfsPath(path)
  return root === '' ? normalized : normalized === '' ? root : `${root}/${normalized}`
}

function relativePath(root: string, path: string): string {
  if (root === '') return path
  if (path === root) return ''
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  throw new ModkitError({
    code: 'x3.host/vfs-namespace-provider-escape',
    message: 'VFS provider returned an entry outside the bridged namespace root',
    context: { root, path },
  })
}

function nestedRef(root: AssetSourceRef, path: string): AssetSourceRef {
  if (path === '') return root
  const separator = root.uri.includes('?') ? '&' : '?'
  return Object.freeze({
    id: `${root.id}?vfs-path=${encodeURIComponent(path)}`,
    // A raw `#vfs-path=...` fragment is not a canonical SubjectRef: fragments are reserved for
    // qualified nested-subject identities. A query remains a restorable root source identity.
    uri: `${root.uri}${separator}vfs-path=${encodeURIComponent(path)}`,
    parentIds: Object.freeze([...(root.parentIds ?? []), root.id]) as readonly [
      string,
      ...string[],
    ],
  })
}

/**
 * Host-owned exact-path resolver over an already opened VFS mount.
 *
 * A codec receives only host-issued `AssetInput` bindings. The VFS mount, its protocol and any
 * backing installation paths stay captured here and never cross the codec boundary.
 */
export function createVfsCompanionOrigin(options: VfsCompanionOriginOptions): CompanionOrigin {
  const root = normalizeVfsPath(options.rootPath ?? '')
  const primaryLogicalId = normalizeVfsPath(options.primaryLogicalId)
  const caseSensitivity = options.caseSensitivity ?? 'insensitive'
  const maxTraversalEntries = options.maxTraversalEntries ?? 4096
  if (!Number.isSafeInteger(maxTraversalEntries) || maxTraversalEntries <= 0) {
    throw new ModkitError({
      code: 'x3.host/vfs-companion-limit-invalid',
      message: 'VFS companion traversal limit must be a positive safe integer',
      context: { maxTraversalEntries },
    })
  }

  const absolute = (logicalId: string): string => scopedPath(root, logicalId)
  const fileSource = async (logicalId: string, signal?: AbortSignal) => {
    const normalized = normalizeVfsPath(logicalId)
    const path = absolute(normalized)
    const node = await options.mount.stat(path, signal)
    if (node?.kind !== 'file') {
      throw new ModkitError({
        code: 'x3.host/vfs-companion-not-found',
        message: `VFS mount has no companion file «${normalized}»`,
        context: { logicalId: normalized },
      })
    }
    const random = await options.mount.open(path, signal)
    try {
      const ref = nestedRef(
        Object.freeze({ id: options.mount.id, uri: options.mount.rootUri }),
        relativePath(root, node.path),
      )
      const value = await artifactByteSourceFromRandomAccess(random, {
        ref,
        revision: revisionId(node.revision ?? options.mount.revision),
        ...(signal === undefined ? {} : { signal }),
      })
      return Object.freeze({
        value,
        async release() {
          await random.dispose()
        },
      })
    } catch (error) {
      await random.dispose()
      throw error
    }
  }

  return Object.freeze({
    primaryLogicalId,
    caseSensitivity,
    scopes: Object.freeze(['current-mount', 'enclosing-container'] as const),
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ) {
      throwIfAborted(signal)
      if (scope !== 'current-mount' && scope !== 'enclosing-container') return
      const prefix = normalizeVfsPath(enumeration.prefix)
      const exact = await options.mount.stat(absolute(prefix), signal)
      if (exact?.kind === 'file') {
        yield Object.freeze({
          logicalId: relativePath(root, exact.path),
          ...(exact.size === undefined ? {} : { size: exact.size }),
        })
        return
      }

      // Exact requirements take the branch above. This bounded walk exists for legitimate glob
      // requirements and remains host-owned; a codec cannot turn it into an unbounded namespace.
      const prefixKey = caseSensitivity === 'insensitive' ? prefix.toLowerCase() : prefix
      const prefixParent = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : ''
      const queue = exact?.kind === 'directory' ? [exact.path] : [absolute(prefixParent)]
      let traversed = 0
      while (queue.length > 0) {
        const directory = queue.shift()
        if (directory === undefined) break
        for await (const node of options.mount.list(directory, signal)) {
          throwIfAborted(signal)
          traversed += 1
          if (traversed > maxTraversalEntries) {
            throw new ModkitError({
              code: 'x3.host/vfs-companion-budget-exceeded',
              message: 'VFS companion origin exceeded its traversal boundary',
              context: { maxTraversalEntries, prefix },
            })
          }
          const logicalId = relativePath(root, node.path)
          const key = caseSensitivity === 'insensitive' ? logicalId.toLowerCase() : logicalId
          if (node.kind === 'directory') {
            if (prefixKey === '' || key.startsWith(prefixKey) || prefixKey.startsWith(`${key}/`)) {
              queue.push(node.path)
            }
          } else if (prefixKey === '' || key.startsWith(prefixKey)) {
            yield Object.freeze({
              logicalId,
              ...(node.size === undefined ? {} : { size: node.size }),
            })
          }
        }
      }
    },
    open: fileSource,
  })
}

export function createVfsInputResolver(
  options: VfsCompanionOriginOptions,
  resolverOptions: CompanionInputResolverOptions = {},
) {
  return createCompanionInputResolver(createVfsCompanionOrigin(options), resolverOptions)
}

/**
 * Expose a confined VFS directory as an SDK namespace. The caller retains ownership of the mount;
 * byte leases dispose only the random-access source opened for that entry.
 */
export function artifactNamespaceSourceFromVfsMount(
  mount: VfsMount,
  options: ArtifactNamespaceSourceFromVfsOptions = {},
): ArtifactNamespaceSource {
  const rootPath = normalizeVfsPath(options.rootPath ?? '')
  const rootRef = Object.freeze(
    options.ref ?? { id: mount.id, uri: mount.rootUri },
  ) as AssetSourceRef

  const sourceAt = (path: string, ref: AssetSourceRef, revision: string): ArtifactNamespaceSource =>
    Object.freeze({
      kind: 'namespace' as const,
      ref,
      revision: revisionId(revision),
      async openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>> {
        throwIfAborted(signal)
        const namespace: AssetNamespace = Object.freeze({
          revision: revisionId(revision),
          async *list(prefix: string, listSignal?: AbortSignal) {
            throwIfAborted(listSignal)
            const absolutePrefix = scopedPath(path, prefix)
            for await (const node of mount.list(absolutePrefix, listSignal)) {
              yield Object.freeze({
                path: relativePath(path, node.path),
                kind: node.kind,
                ...(node.size === undefined ? {} : { size: node.size }),
              })
            }
          },
          async open(entryPath: string, openSignal?: AbortSignal): Promise<Lease<ArtifactSource>> {
            throwIfAborted(openSignal)
            const absolute = scopedPath(path, entryPath)
            const node = await mount.stat(absolute, openSignal)
            if (node === undefined) {
              throw new ModkitError({
                code: 'x3.host/namespace-entry-not-found',
                message: `namespace entry «${entryPath}» does not exist`,
                context: { path: entryPath, root: path },
              })
            }
            const relative = relativePath(path, node.path)
            const childRef = nestedRef(ref, relative)
            const childRevision = node.revision ?? revision
            if (node.kind === 'directory') {
              return Object.freeze({
                value: sourceAt(absolute, childRef, childRevision),
                release: async () => undefined,
              })
            }
            const random = await mount.open(absolute, openSignal)
            try {
              const value = await artifactByteSourceFromRandomAccess(random, {
                ref: childRef,
                revision: revisionId(childRevision),
                ...(openSignal === undefined ? {} : { signal: openSignal }),
              })
              return Object.freeze({
                value,
                async release() {
                  await random.dispose()
                },
              })
            } catch (error) {
              await random.dispose()
              throw error
            }
          },
        })
        return Object.freeze({ value: namespace, release: async () => undefined })
      },
    })

  return sourceAt(rootPath, rootRef, mount.revision)
}
