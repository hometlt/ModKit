/**
 * One layer of a mod context as a namespace subject.
 *
 * The loader already found, listed and can read every package of a chain — a folder, a packed
 * archive, a mod inside the game's CASC storage, an archive of the Battle.net cache. Opening a layer
 * over the loader's own listing and reads lets that package's codec show it (its resource tree, its
 * card) the same way wherever it lives, without a second reader for any of those places. A layer is
 * read-only here: nothing writes through it.
 */
import { ModkitError, throwIfAborted } from '@modkit/core'
import {
  isRevisionId,
  revisionId,
  type ArtifactByteSource,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetNamespace,
  type AssetSourceRef,
  type Lease,
  type RevisionId,
} from '@modkit/sdk'
import type { ModContext } from '@modkit/vfs/content-sources'

const LIST_PAGE = 4096
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

interface Folder {
  /** Child name → whether it is a folder, in listing order. */
  readonly children: Map<string, boolean>
}

function nestedRef(root: AssetSourceRef, path: string): AssetSourceRef {
  const separator = root.uri.includes('?') ? '&' : '?'
  const uri = `${root.uri}${separator}vfs-path=${encodeURIComponent(path)}`
  return Object.freeze({ id: uri, uri, parentIds: Object.freeze([root.id] as const) })
}

const refused = (code: string, message: string, path: string): ModkitError =>
  new ModkitError({ code, message, context: { path } })

/**
 * The layer `layerId` of `context`, rooted at `ref` (the address its entries are named under).
 * The caller keeps the context open for as long as the subject opened over it lives.
 */
export async function openModContextLayerSource(options: {
  readonly context: ModContext
  readonly layerId: string
  readonly ref: AssetSourceRef
  readonly signal?: AbortSignal
}): Promise<ArtifactNamespaceSource> {
  const { context, layerId, ref, signal } = options
  const layer = context.layers.find(item => item.id === layerId)
  if (layer === undefined) {
    throw refused(
      'x3.host/mod-context-layer-unknown',
      `the mod context has no layer ${layerId}`,
      '',
    )
  }
  const folders = new Map<string, Folder>([['', { children: new Map() }]])
  const files = new Set<string>()
  const folderOf = (path: string): Folder => {
    const known = folders.get(path)
    if (known !== undefined) return known
    const created = { children: new Map<string, boolean>() }
    folders.set(path, created)
    const cut = path.lastIndexOf('/')
    folderOf(cut < 0 ? '' : path.slice(0, cut)).children.set(path.slice(cut + 1), true)
    return created
  }
  let cursor: string | undefined
  do {
    throwIfAborted(signal)
    const page = await context.files(layerId, {
      limit: LIST_PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    })
    for (const path of page.items) {
      const cut = path.lastIndexOf('/')
      folderOf(cut < 0 ? '' : path.slice(0, cut)).children.set(path.slice(cut + 1), false)
      files.add(path)
    }
    cursor = page.nextCursor
  } while (cursor !== undefined)

  /*
   * The context compares paths without case (a CASC mod lists `base.sc2data/…`, a codec asks for
   * `Base.SC2Data`): an exact path wins, a folded one answers otherwise.
   */
  const folded = new Map<string, string>()
  for (const path of [...folders.keys(), ...files]) {
    const key = path.toLowerCase()
    if (!folded.has(key)) folded.set(key, path)
  }
  const resolvePath = (path: string): string =>
    folders.has(path) || files.has(path) ? path : (folded.get(path.toLowerCase()) ?? path)

  const revision: RevisionId =
    layer.fingerprint !== undefined && isRevisionId(layer.fingerprint)
      ? revisionId(layer.fingerprint)
      : revisionId(`provider-token:${encodeURIComponent(`${context.contextId}/${layerId}`)}`)
  const join = (prefix: string, path: string): string =>
    [prefix, path].filter(part => part !== '').join('/')

  /*
   * The listing carries no sizes, and a reader sizes its buffer from the source (SC2's namespace
   * reader refuses an unsized file): an opened file is read once, whole, and answers its size.
   */
  const fileSource = async (path: string): Promise<ArtifactByteSource> => {
    const all = await context.read(layerId, path, MAX_ENTRY_BYTES)
    return Object.freeze({
      kind: 'bytes' as const,
      ref: nestedRef(ref, path),
      revision,
      size: BigInt(all.length),
      async read(offset: bigint, length: number, readSignal?: AbortSignal) {
        throwIfAborted(readSignal)
        if (offset < 0n || length < 0 || offset + BigInt(length) > BigInt(all.length)) {
          throw refused('x3.host/mod-context-read-out-of-bounds', 'read out of bounds', path)
        }
        return all.slice(Number(offset), Number(offset) + length)
      },
      async *stream(range?: { readonly offset: bigint; readonly length?: bigint }) {
        const start = Number(range?.offset ?? 0n)
        const end = range?.length === undefined ? all.length : start + Number(range.length)
        yield all.slice(start, end)
      },
    })
  }

  const namespaceAt = (prefix: string, at: AssetSourceRef): ArtifactNamespaceSource =>
    Object.freeze({
      kind: 'namespace' as const,
      ref: at,
      revision,
      async openNamespace(): Promise<Lease<AssetNamespace>> {
        const namespace: AssetNamespace = Object.freeze({
          revision,
          async *list(listPrefix: string, listSignal?: AbortSignal) {
            throwIfAborted(listSignal)
            const path = resolvePath(join(prefix, listPrefix.replace(/^\/+|\/+$/gu, '')))
            const folder = folders.get(path)
            if (folder === undefined) {
              throw refused(
                'x3.host/namespace-entry-not-directory',
                `namespace entry «${path}» is not a directory`,
                path,
              )
            }
            const base = path === prefix ? '' : path.slice(prefix === '' ? 0 : prefix.length + 1)
            for (const [name, directory] of folder.children) {
              yield Object.freeze({
                path: join(base, name),
                kind: directory ? ('directory' as const) : ('file' as const),
              })
            }
          },
          async open(entryPath: string, openSignal?: AbortSignal): Promise<Lease<ArtifactSource>> {
            throwIfAborted(openSignal)
            const path = resolvePath(join(prefix, entryPath.replace(/^\/+|\/+$/gu, '')))
            const value = folders.has(path)
              ? namespaceAt(path, nestedRef(ref, path))
              : files.has(path)
                ? await fileSource(path)
                : undefined
            if (value === undefined) {
              throw refused(
                'x3.host/namespace-entry-not-found',
                `the layer lists no «${path}»`,
                path,
              )
            }
            return Object.freeze({ value, release: async () => undefined })
          },
        })
        return Object.freeze({ value: namespace, release: async () => undefined })
      },
    })

  return namespaceAt('', ref)
}
