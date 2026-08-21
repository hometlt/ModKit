/** Portable bridge from an explicitly opened VFS mount to the SDK namespace-source contract. */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import {
  revisionId,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetNamespace,
  type AssetSourceRef,
  type Lease,
} from '@modkitx-x3/sdk'
import { normalizeVfsPath, type VfsMount } from '@modkitx-x3/vfs'

import { artifactByteSourceFromRandomAccess } from './source-bridge.js'

export interface ArtifactNamespaceSourceFromVfsOptions {
  /** Directory inside the mount to expose as the namespace root. */
  readonly rootPath?: string
  /** Optional stable public identity; defaults to the mount identity and URI. */
  readonly ref?: AssetSourceRef
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
  return Object.freeze({
    id: `${root.id}#${encodeURIComponent(path)}`,
    uri: `${root.uri}#vfs-path=${encodeURIComponent(path)}`,
    parentIds: Object.freeze([...(root.parentIds ?? []), root.id]) as readonly [
      string,
      ...string[],
    ],
  })
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
