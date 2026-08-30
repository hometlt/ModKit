/**
 * A URI shape that names one entry inside a container, and the directory index behind it.
 *
 * Until now this product had no way to say "the W3D at `art/w3d/bowl.w3d` inside `Misc.big`". Every
 * door the extension opens takes a `vscode.Uri`, `describeOpenTarget` accepted only `file:`, and so
 * descending into an archive was an action inside the webview and nowhere else: the smoke receipt's
 * scenario 4 fails on exactly that sentence. The owner's requirement (REQUEST_VSCODE_NATIVE_SHELL
 * §3) names the mechanism — a `FileSystemProvider` over the host's `openNestedSubject` route, so
 * the *native* Explorer lists archive members — and a filesystem provider is addressed by URI. This
 * module is that address, kept free of the `vscode` module so the rule is unit-testable in Node.
 *
 * The shape is `modkit-container:/<token>/<entry path>`:
 *
 *  - **The token is the container's own path, hex-encoded.** Hex rather than base64url because a
 *    URI authority folds case in some editors' comparisons and a path segment must survive being
 *    round-tripped through `Uri.parse` unchanged; `[0-9a-f]` is invariant under both. It is an
 *    encoding, never a secret: anyone holding the URI already holds the path, and pretending
 *    otherwise would invite a handle table that outlives the window.
 *  - **The entry path is the container's own**, with the `/` separators a namespace listing uses.
 *    It is never a platform path, so nothing here joins it with `node:path`.
 *
 * Everything is derived: no registry, no counter, no state. The same container yields the same URI
 * in every window, which is what lets a workspace folder for an archive be saved and reopened.
 */

/** The scheme the extension registers a read-only filesystem provider for. */
export const CONTAINER_SCHEME = 'modkit-container'

/** A container path and an entry inside it, as parsed out of one URI path. */
export interface ContainerLocation {
  /** Platform path of the container file on disk, exactly as it was encoded. */
  readonly container: string
  /** Slash-separated path inside the container; empty means the container root itself. */
  readonly entry: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function toHex(text: string): string {
  return [...encoder.encode(text)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(token: string): string | undefined {
  if (token.length === 0 || token.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(token)) return undefined
  const bytes = new Uint8Array(token.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(token.slice(index * 2, index * 2 + 2), 16)
  }
  try {
    return decoder.decode(bytes)
  } catch {
    return undefined
  }
}

/**
 * Drop empty and `.`/`..` segments.
 *
 * A container entry path is data a codec read out of a file on disk, so it is not trusted to be
 * well-behaved: an archive naming `../../etc/passwd` must address nothing rather than climb. There
 * is no filesystem underneath to climb *to* — the entries all come from one listing — but a path
 * that resolves differently from how it reads would still be a lie told to the Explorer.
 */
export function normalizeEntryPath(entry: string): string {
  return entry
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/')
}

/** The `path` component of the URI addressing an entry (or the container root, for an empty entry). */
export function containerUriPath(container: string, entry = ''): string {
  const normalized = normalizeEntryPath(entry)
  return `/${toHex(container)}${normalized === '' ? '' : `/${normalized}`}`
}

/** The whole URI as text — what a `SubjectOpener` receives, and what the smoke asserts on. */
export function containerUriText(container: string, entry = ''): string {
  return `${CONTAINER_SCHEME}:${containerUriPath(container, entry)}`
}

/** Parse a URI `path` back into the container and entry it names, or `undefined` when it is not one. */
export function parseContainerUriPath(path: string): ContainerLocation | undefined {
  const segments = path.split('/').filter(segment => segment.length > 0)
  const token = segments[0]
  if (token === undefined) return undefined
  const container = fromHex(token)
  if (container === undefined) return undefined
  return Object.freeze({ container, entry: segments.slice(1).join('/') })
}

/** Parse a whole `modkit-container:` URI text; anything else answers `undefined`. */
export function parseContainerUriText(text: string): ContainerLocation | undefined {
  const prefix = `${CONTAINER_SCHEME}:`
  if (!text.startsWith(prefix)) return undefined
  // `Uri.toString()` renders an authority-less URI as `scheme:/path`; a hand-written `scheme:///`
  // (or a `//`-authority someone appended) names the same thing, so both are accepted.
  const rest = text.slice(prefix.length).replace(/^\/\/+/u, '/')
  return parseContainerUriPath(rest.startsWith('/') ? rest : `/${rest}`)
}

/** True for a subject path that names a container member rather than a file on disk. */
export function isContainerUriText(text: string): boolean {
  return text.startsWith(`${CONTAINER_SCHEME}:`)
}

// ---------------------------------------------------------------------------------------------
// the directory index

/** One row of a container listing, in the vocabulary a filesystem provider answers with. */
export interface ContainerNode {
  readonly name: string
  readonly kind: 'file' | 'directory'
  /** Extracted size, when the container recorded one. */
  readonly size?: number
  /** Last modification the container recorded, epoch milliseconds UTC. */
  readonly modifiedAt?: number
  /** The container's own opaque entry id — files only, and only for entries it actually listed. */
  readonly entryId?: string
}

/** A container's flat listing, indexed so a directory can be answered without rescanning it. */
export interface ContainerIndex {
  /** Directory path (empty for the root) → its children by name. */
  readonly directories: ReadonlyMap<string, ReadonlyMap<string, ContainerNode>>
  /** Entry path → the row a `stat`/`read` needs. */
  readonly files: ReadonlyMap<string, ContainerNode>
}

/** The subset of `NamespaceEntry` this index reads; declared structurally, like `UriLike`. */
export interface ContainerEntryLike {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size?: bigint
  readonly modifiedAt?: number
}

/**
 * Index a flat container listing into directories.
 *
 * Containers list leaves: a BIG holds `art/w3d/bowl.w3d` and no record that `art` exists. An
 * Explorer asks for one directory at a time, so the intermediate directories are synthesised here —
 * once per container, not per expansion — and an entry the container *did* declare as a directory
 * keeps whatever it declared.
 *
 * A duplicate path (two members with the same name, which some containers permit) keeps the first
 * occurrence: the listing order is the container's own, and picking the last would make the answer
 * depend on how far the pagination happened to read.
 */
export function buildContainerIndex(entries: readonly ContainerEntryLike[]): ContainerIndex {
  const directories = new Map<string, Map<string, ContainerNode>>([['', new Map()]])
  const files = new Map<string, ContainerNode>()

  const directoryAt = (path: string): Map<string, ContainerNode> => {
    const known = directories.get(path)
    if (known !== undefined) return known
    const fresh = new Map<string, ContainerNode>()
    directories.set(path, fresh)
    const cut = path.lastIndexOf('/')
    const parent = cut === -1 ? '' : path.slice(0, cut)
    const name = cut === -1 ? path : path.slice(cut + 1)
    directoryAt(parent).set(name, { name, kind: 'directory' })
    return fresh
  }

  for (const entry of entries) {
    const path = normalizeEntryPath(entry.path)
    if (path === '') continue
    const cut = path.lastIndexOf('/')
    const parent = cut === -1 ? '' : path.slice(0, cut)
    const name = cut === -1 ? path : path.slice(cut + 1)
    if (entry.kind === 'directory') {
      directoryAt(path)
      continue
    }
    if (files.has(path)) continue
    const node: ContainerNode = {
      name,
      kind: 'file',
      entryId: entry.id,
      ...(entry.size === undefined ? {} : { size: Number(entry.size) }),
      ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
    }
    files.set(path, node)
    directoryAt(parent).set(name, node)
  }

  return Object.freeze({ directories, files })
}

/** Children of one directory, or `undefined` when the container has no such directory. */
export function listContainerDirectory(
  index: ContainerIndex,
  path: string,
): readonly ContainerNode[] | undefined {
  const children = index.directories.get(normalizeEntryPath(path))
  if (children === undefined) return undefined
  return [...children.values()]
}

/** The node one entry path names — a file, a synthesised directory, or nothing. */
export function statContainerEntry(index: ContainerIndex, path: string): ContainerNode | undefined {
  const normalized = normalizeEntryPath(path)
  if (normalized === '') return { name: '', kind: 'directory' }
  return (
    index.files.get(normalized) ??
    (index.directories.has(normalized)
      ? { name: normalized.slice(normalized.lastIndexOf('/') + 1), kind: 'directory' }
      : undefined)
  )
}
