/**
 * A URI shape that names one entry inside a container, and the directory index behind it.
 *
 * The shape is the one Java and many engines use for archive members, a path, `!/`, and the path
 * inside: `modkit-container:/C:/Games/data.zip!/textures/marine.dds`. It reads as what it is, and
 * VS Code's breadcrumbs, tab tooltips and Explorer show `Games › data.zip! › textures › marine.dds`.
 *
 *  - **The container is its own path**, with `/` separators and a leading `/` before a drive
 *    letter, so it survives `Uri.from({ scheme, path })` and comes back as the same platform path.
 *  - **The entry path is the container's own**, with the `/` separators a listing uses. It is never
 *    a platform path, so nothing here joins it with `node:path`.
 *  - **The text form is the scheme plus the decoded path.** A `vscode.Uri` is turned into it from
 *    `uri.path`, never `uri.toString()`, which percent-encodes the colon and the `!`.
 *
 * Everything is derived: no registry, no counter, no state. The same container yields the same URI
 * in every window, which is what lets a workspace folder for an archive be saved and reopened.
 * An archive inside an archive is one more level: `data.zip!/inner.zip!/readme.txt`.
 * ponytail: every `!/` is a level, so a folder whose name ends in `!` is not addressable; escape
 * it if such a path is ever met.
 */

/** The scheme the extension registers a filesystem provider for. */
export const CONTAINER_SCHEME = 'modkit-container'

/** A container path and an entry inside it, as parsed out of one URI path. */
export interface ContainerLocation {
  /** Platform path of the container file on disk, exactly as it was encoded. */
  readonly container: string
  /** Slash-separated path inside the container; empty means the container root itself. */
  readonly entry: string
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

/** Between a container and what is inside it, at every level of nesting. */
export const CONTAINER_SEPARATOR = '!/'
const BACKSLASH = String.fromCharCode(92)
/** A Windows path (`C:` then a separator), which a URI path spells `/C:/…`. */
const isDrivePath = (path: string): boolean =>
  /^[A-Za-z]:/u.test(path) && (path[2] === '/' || path[2] === BACKSLASH)

/**
 * A container that may itself be a member: the file on disk, then the member path at each level.
 * `C:\Folder\Z2.zip!/Z.zip` is `Z.zip` inside `Z2.zip`; a plain path has no members.
 */
export interface ContainerChain {
  readonly file: string
  readonly members: readonly string[]
}

export function splitContainer(container: string): ContainerChain {
  const [file = '', ...members] = container.split(CONTAINER_SEPARATOR)
  return { file, members: members.map(normalizeEntryPath) }
}

export function joinContainer(file: string, members: readonly string[]): string {
  return [file, ...members].join(CONTAINER_SEPARATOR)
}

/** Stable identity for duplicate checks; Windows paths differ in spelling more often than value. */
export function containerLocationIdentity(
  container: string,
  entry = '',
  caseSensitive = true,
): string {
  const fold = (value: string): string => (caseSensitive ? value : value.toLowerCase())
  const { file, members } = splitContainer(container)
  const normalizedFile = file.replaceAll(BACKSLASH, '/').replace(/\/+$/u, '')
  return JSON.stringify([
    fold(normalizedFile),
    ...members.map(member => fold(normalizeEntryPath(member))),
    fold(normalizeEntryPath(entry)),
  ])
}

/** The `path` component of the URI addressing an entry (or the container root, for an empty entry). */
export function containerUriPath(container: string, entry = ''): string {
  const { file, members } = splitContainer(container)
  const head = isDrivePath(file) ? `/${file.replaceAll(BACKSLASH, '/')}` : file
  return [head, ...members, normalizeEntryPath(entry)].join(CONTAINER_SEPARATOR)
}

/** The whole URI as text — what a `SubjectOpener` receives, and what the smoke asserts on. */
export function containerUriText(container: string, entry = ''): string {
  return `${CONTAINER_SCHEME}:${containerUriPath(container, entry)}`
}

/**
 * Parse a URI `path` back into the container and entry it names, or `undefined` when it is not one.
 * Every `!/` is a level: the last one separates the innermost container from the entry.
 */
export function parseContainerUriPath(path: string): ContainerLocation | undefined {
  const parts = (path.endsWith('!') ? `${path}/` : path).split(CONTAINER_SEPARATOR)
  const [head = '', ...rest] = parts
  if (rest.length === 0 || head === '' || head === '/') return undefined
  const drive = head.slice(1)
  const file = isDrivePath(drive) ? drive.replaceAll('/', BACKSLASH) : head
  const members = rest.slice(0, -1).map(normalizeEntryPath)
  if (members.some(member => member === '')) return undefined
  return Object.freeze({
    container: joinContainer(file, members),
    entry: normalizeEntryPath(rest.at(-1) ?? ''),
  })
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

/** The container a subject names: its file on disk, or — for a member URI — that member itself. */
export function containerOfSubject(subject: string): string {
  const location = parseContainerUriText(subject)
  return location === undefined ? subject : joinContainer(location.container, [location.entry])
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
  /** The codec calls it hidden (`__MACOSX`, a dot name); a listing leaves it out unless asked. */
  readonly hidden?: true
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
  readonly hidden?: true
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
 *
 * A synthesised directory is hidden when nothing visible lives under it — `__MACOSX` holds only
 * hidden files — and a declared one when its entry says so; either way it stays in the index, so a
 * path the reader asks for by name still resolves.
 */
export function buildContainerIndex(entries: readonly ContainerEntryLike[]): ContainerIndex {
  const directories = new Map<string, Map<string, ContainerNode>>([['', new Map()]])
  const files = new Map<string, ContainerNode>()
  const visible = new Set<string>([''])
  const declaredHidden = new Set<string>()
  const showAncestors = (path: string): void => {
    for (let cut = path.lastIndexOf('/'); cut !== -1; cut = path.lastIndexOf('/', cut - 1)) {
      visible.add(path.slice(0, cut))
    }
  }

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
      if (entry.hidden === true) declaredHidden.add(path)
      else {
        visible.add(path)
        showAncestors(path)
      }
      continue
    }
    if (files.has(path)) continue
    const node: ContainerNode = {
      name,
      kind: 'file',
      entryId: entry.id,
      ...(entry.size === undefined ? {} : { size: Number(entry.size) }),
      ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
      ...(entry.hidden === true ? { hidden: true as const } : {}),
    }
    files.set(path, node)
    directoryAt(parent).set(name, node)
    if (entry.hidden !== true) showAncestors(path)
  }

  for (const path of directories.keys()) {
    if (path === '' || (visible.has(path) && !declaredHidden.has(path))) continue
    const cut = path.lastIndexOf('/')
    const parent = directories.get(cut === -1 ? '' : path.slice(0, cut))
    const name = cut === -1 ? path : path.slice(cut + 1)
    const node = parent?.get(name)
    if (node !== undefined) parent?.set(name, { ...node, hidden: true })
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
