/**
 * Which directories this host offers `loadExtensionRoots`, and where they come from.
 *
 * Three sources, kept apart because they carry different trust:
 *
 *  - the **first-party catalog** that ships beside the extension (or, in a checkout, the lab's
 *    `extensions/common`). Loaded as `bundled` but *without* `allowTrustedInProcess`: the VS Code
 *    extension host is a Node process shared with every other installed extension, so nothing here
 *    is admitted to it. Codecs resolve for the `node-worker` realm and run there.
 *  - the **workspace folders**, scanned one level deep. A workspace that carries its own codec
 *    directory gets it without a settings entry, which is how a mod project ships a format the
 *    lab does not know.
 *  - the **`modkit.extensions` setting**, an explicit list the user wrote.
 *
 * The last two are `installed` artifacts and never reach the in-process boundary at all.
 *
 * Everything here is pure over an injected probe, so the discovery rules are unit-testable in Node
 * without a `vscode` module and without touching a real filesystem.
 */

/** The filesystem questions discovery asks. `node:fs` answers them in `./host.js`. */
export interface DirectoryProbe {
  /** Entry names directly inside `path`, or `undefined` when it is not a readable directory. */
  readDirectory(path: string): readonly string[] | undefined
  /** True when `path` names an existing readable file. */
  isFile(path: string): boolean
  /** Parsed JSON at `path`, or `undefined` when it is missing or unparseable. */
  readJson(path: string): unknown
  join(...parts: readonly string[]): string
}

/** One directory the user or the workspace named, in the shape `loadExtensionRoots` accepts. */
export interface ExtensionRootRequestLike {
  readonly root: string
  readonly expectedId?: string
}

/**
 * Does this directory *declare* an extension?
 *
 * Not "does it have a package.json" — every JavaScript project has one, and a workspace folder
 * scanned on that rule would be offered to `loadExtensionRoots`, refused as
 * `x3.host/extension-not-an-extension`, and reported to a user who never asked for any of it.
 * The rule is the loader's own: a `modkit.extension.json`, or a `package.json` that carries a
 * `modkit` block. Discovery has to be silent about things that are not extensions.
 *
 * A path the *user* named in the setting is never filtered by this — an explicit request that
 * names a directory which turns out not to be an extension is exactly the case that must be
 * reported rather than dropped.
 */
export function looksLikeExtensionDirectory(path: string, probe: DirectoryProbe): boolean {
  if (probe.isFile(probe.join(path, 'modkit.extension.json'))) return true
  const manifest = probe.readJson(probe.join(path, 'package.json'))
  return typeof manifest === 'object' && manifest !== null && 'modkit' in manifest
}

/**
 * The first-party catalog.
 *
 * Candidates are tried in order and the first one that yields any extension wins, so a packaged
 * build (which carries its own copy) never silently picks up a checkout sitting above it. Names
 * are sorted, which makes the loaded set — and therefore every inventory identity derived from it
 * — independent of directory order on disk.
 */
export function discoverCatalogRoots(
  candidates: readonly string[],
  probe: DirectoryProbe,
): readonly string[] {
  for (const candidate of candidates) {
    const names = probe.readDirectory(candidate)
    if (names === undefined) continue
    const roots = [...names]
      .sort()
      .map(name => probe.join(candidate, name))
      .filter(path => looksLikeExtensionDirectory(path, probe))
    if (roots.length > 0) return Object.freeze(roots)
  }
  return Object.freeze([])
}

/**
 * Extensions a workspace ships with itself.
 *
 * One level under each folder, and only directories that already look like an extension: scanning
 * deeper would walk a whole project tree on every activation, and reporting every ordinary
 * subdirectory as a failed extension root would bury the one real failure in noise.
 */
export function discoverWorkspaceRoots(
  folders: readonly string[],
  probe: DirectoryProbe,
): readonly ExtensionRootRequestLike[] {
  const found: ExtensionRootRequestLike[] = []
  for (const folder of folders) {
    if (looksLikeExtensionDirectory(folder, probe)) found.push({ root: folder })
    const names = probe.readDirectory(folder)
    if (names === undefined) continue
    for (const name of [...names].sort()) {
      const path = probe.join(folder, name)
      if (looksLikeExtensionDirectory(path, probe)) found.push({ root: path })
    }
  }
  return Object.freeze(found)
}

/** One `modkit.extensions` entry as a user may write it. */
export interface ConfiguredExtensionEntry {
  readonly path?: unknown
  readonly id?: unknown
  readonly enabled?: unknown
}

/**
 * Read the `modkit.extensions` setting.
 *
 * A bare string is a path; an object may name the identity it expects and may be disabled. A
 * malformed entry is dropped here rather than handed on as an unreadable root, because
 * `loadExtensionRoots` would report it as a filesystem failure and the user would go looking for a
 * directory instead of at their settings. `problems` carries what was dropped, so nothing is
 * swallowed either.
 */
export function configuredExtensionRoots(
  value: unknown,
  resolve: (path: string) => string,
): { readonly roots: readonly ExtensionRootRequestLike[]; readonly problems: readonly string[] } {
  if (value === undefined || value === null) return { roots: Object.freeze([]), problems: [] }
  if (!Array.isArray(value)) {
    return {
      roots: Object.freeze([]),
      problems: Object.freeze(['modkit.extensions must be a list of paths or entries']),
    }
  }
  const roots: ExtensionRootRequestLike[] = []
  const problems: string[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item === 'string') {
      if (item.length === 0) problems.push(`modkit.extensions[${index}] is an empty path`)
      else roots.push({ root: resolve(item) })
      continue
    }
    if (typeof item !== 'object' || item === null) {
      problems.push(`modkit.extensions[${index}] is neither a path nor an entry object`)
      continue
    }
    const entry = item as ConfiguredExtensionEntry
    if (entry.enabled === false) continue
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      problems.push(`modkit.extensions[${index}] has no «path»`)
      continue
    }
    roots.push({
      root: resolve(entry.path),
      ...(typeof entry.id === 'string' && entry.id.length > 0 ? { expectedId: entry.id } : {}),
    })
  }
  return { roots: Object.freeze(roots), problems: Object.freeze(problems) }
}

/** Drop duplicates (a workspace folder that is also in the setting) keeping the first request. */
export function dedupeRoots(
  requests: readonly ExtensionRootRequestLike[],
): readonly ExtensionRootRequestLike[] {
  const seen = new Set<string>()
  const out: ExtensionRootRequestLike[] = []
  for (const request of requests) {
    if (seen.has(request.root)) continue
    seen.add(request.root)
    out.push(request)
  }
  return Object.freeze(out)
}
