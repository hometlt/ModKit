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
 *  - enabled immutable package roots returned by the Node extension manager at activation.
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

/** A manager-owned artifact always carries the exact coordinate verified at installation. */
export interface ManagedExtensionRootRequest extends ExtensionRootRequestLike {
  readonly expectedId: string
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
/** One root of the generated catalog: what the build says it ships, and where it lives. */
export interface BundledCatalogRoot {
  readonly name: string
  /** Path under `extensions/`, e.g. `common/images`. */
  readonly directory: string
  /** False when the product ships it and `READY_APP_EXTENSIONS` does not list it. */
  readonly declared: boolean
}

export interface BundledCatalogResolution {
  readonly roots: readonly string[]
  /** Roots the catalog names that are not on disk — reported, never silently dropped. */
  readonly missing: readonly string[]
  /** Which candidate directory the roots were resolved under, for the output channel. */
  readonly base?: string
}

/**
 * Resolve the generated catalog against the directories this build might hold it in.
 *
 * The difference from `discoverCatalogRoots` is the direction of authority. Discovery asked the
 * disk what the product contains; this asks the *catalog*, and uses the disk only to find where
 * those named roots are — `dist-app/extensions` in a packaged build, the repository's own
 * `extensions/` in a checkout.
 *
 * A named root that is nowhere is returned in `missing` rather than skipped. That is the whole
 * point: the old behaviour composed an empty catalog and opened every asset as hex, which looks
 * exactly like a product that works and can read nothing (block-9 receipt, defect 6).
 */
export function resolveBundledCatalog(
  catalog: readonly BundledCatalogRoot[],
  candidates: readonly string[],
  probe: DirectoryProbe,
): BundledCatalogResolution {
  for (const candidate of candidates) {
    const found: string[] = []
    const missing: string[] = []
    for (const root of catalog) {
      // The catalog stores `common/images`; a packaged build flattens to `<base>/common/images`
      // exactly as it was copied, so one join serves both layouts.
      const path = probe.join(candidate, ...root.directory.split('/'))
      if (looksLikeExtensionDirectory(path, probe)) found.push(path)
      else missing.push(root.name)
    }
    if (found.length > 0) {
      return Object.freeze({
        roots: Object.freeze(found),
        missing: Object.freeze(missing),
        base: candidate,
      })
    }
  }
  return Object.freeze({
    roots: Object.freeze([]),
    missing: Object.freeze(catalog.map(root => root.name)),
  })
}

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

/**
 * Append one directory to a `modkit.extensions` value, keeping everything the user authored.
 *
 * The setting is hand-written as often as not — a mix of bare strings and entry objects, in an
 * order that may mean something to whoever wrote it. Rewriting it into a canonical shape would
 * lose that, so the new folder is appended as a plain string and every existing item is passed
 * through untouched.
 *
 * `caseSensitive` is asked for rather than guessed: on Windows two spellings of one path are the
 * same directory and adding both would load it twice, on Linux they are two directories and
 * refusing the second would be wrong.
 */
export function withExtensionRoot(
  value: unknown,
  root: string,
  options: { readonly caseSensitive: boolean },
): { readonly next: readonly unknown[]; readonly added: boolean; readonly reason?: string } {
  const existing = Array.isArray(value) ? value : []
  if (!Array.isArray(value) && value !== undefined && value !== null) {
    return {
      next: [root],
      added: true,
      reason: 'modkit.extensions was not a list; it has been replaced with this one folder',
    }
  }
  const fold = (path: string): string => (options.caseSensitive ? path : path.toLowerCase())
  const wanted = fold(root)
  const already = existing.some(item => {
    if (typeof item === 'string') return fold(item) === wanted
    if (typeof item !== 'object' || item === null) return false
    const path = (item as ConfiguredExtensionEntry).path
    return typeof path === 'string' && fold(path) === wanted
  })
  if (already) {
    return { next: existing, added: false, reason: `${root} is already in modkit.extensions` }
  }
  return { next: [...existing, root], added: true }
}

/**
 * Read the `modkit.disabledContributions` setting.
 *
 * A list of contribution ids the user switched off — one level below `modkit.extensions`, which
 * switches whole directories. The value is a set, so it is deduplicated and sorted here and a
 * malformed entry is reported rather than silently ignored: a typo that quietly disables nothing
 * is worse than a typo that says so, because the user's next move is to look for the bug in the
 * codec.
 */
export function configuredDisabledContributions(value: unknown): {
  readonly ids: readonly string[]
  readonly problems: readonly string[]
} {
  if (value === undefined || value === null) return { ids: Object.freeze([]), problems: [] }
  if (!Array.isArray(value)) {
    return {
      ids: Object.freeze([]),
      problems: Object.freeze(['modkit.disabledContributions must be a list of contribution ids']),
    }
  }
  const ids: string[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      problems.push(`modkit.disabledContributions[${index}] is not a contribution id`)
      continue
    }
    const id = item.trim()
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids: Object.freeze(ids.sort()), problems: Object.freeze(problems) }
}

/** Read extension-coordinate enablement without removing the extension from the inventory. */
export function configuredDisabledExtensions(value: unknown): {
  readonly ids: readonly string[]
  readonly problems: readonly string[]
} {
  const result = configuredDisabledContributions(value)
  return {
    ids: result.ids,
    problems: Object.freeze(
      result.problems.map(problem =>
        problem
          .replaceAll('modkit.disabledContributions', 'modkit.disabledExtensions')
          .replaceAll('contribution ids', 'extension coordinates')
          .replaceAll('contribution id', 'extension coordinate'),
      ),
    ),
  }
}

/**
 * One entry of `modkit.extensions` as a settings surface shows it.
 *
 * `index` is the position in the raw setting, and it is the only handle the webview ever gets: the
 * page describes *which* entry the user pointed at, and the extension side — the only side that
 * may touch configuration — does the array surgery. A page that rewrote the array itself would be
 * deciding what the user's hand-written setting looks like.
 */
export interface ConfiguredExtensionView {
  readonly index: number
  readonly path: string
  readonly id?: string
  readonly enabled: boolean
}

/** Describe `modkit.extensions` for display, keeping the positions the writers below need. */
export function describeConfiguredExtensions(value: unknown): readonly ConfiguredExtensionView[] {
  if (!Array.isArray(value)) return Object.freeze([])
  const views: ConfiguredExtensionView[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item === 'string') {
      if (item.length > 0) views.push({ index, path: item, enabled: true })
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const entry = item as ConfiguredExtensionEntry
    if (typeof entry.path !== 'string' || entry.path.length === 0) continue
    views.push({
      index,
      path: entry.path,
      ...(typeof entry.id === 'string' && entry.id.length > 0 ? { id: entry.id } : {}),
      enabled: entry.enabled !== false,
    })
  }
  return Object.freeze(views)
}

/**
 * Switch one entry of `modkit.extensions` on or off.
 *
 * A bare string has nowhere to record "off", so it becomes the entry-object form — the only
 * rewrite this function ever performs, and the only one it can perform without losing the answer.
 * Every other item is passed through exactly as the user wrote it.
 */
export function withExtensionEnabled(
  value: unknown,
  index: number,
  enabled: boolean,
): { readonly next: readonly unknown[]; readonly changed: boolean } {
  if (!Array.isArray(value) || index < 0 || index >= value.length) {
    return { next: Array.isArray(value) ? value : [], changed: false }
  }
  const next = value.map((item, position) => {
    if (position !== index) return item
    if (typeof item === 'string') return { path: item, enabled }
    if (typeof item !== 'object' || item === null) return item
    return { ...(item as ConfiguredExtensionEntry), enabled }
  })
  return { next, changed: true }
}

/** Drop one entry of `modkit.extensions`, leaving every other item as it was. */
export function withoutExtension(
  value: unknown,
  index: number,
): { readonly next: readonly unknown[]; readonly changed: boolean } {
  if (!Array.isArray(value) || index < 0 || index >= value.length) {
    return { next: Array.isArray(value) ? value : [], changed: false }
  }
  return { next: value.filter((_item, position) => position !== index), changed: true }
}

/**
 * Switch one contribution on or off in a `modkit.disabledContributions` value.
 *
 * The setting is a set, so the result is deduplicated and sorted — the same normalisation
 * `configuredDisabledContributions` applies when reading it, so a write and a read agree.
 */
export function withContributionDisabled(
  value: unknown,
  id: string,
  disabled: boolean,
): { readonly next: readonly string[]; readonly changed: boolean } {
  const current = configuredDisabledContributions(value).ids
  const has = current.includes(id)
  if (has === disabled) return { next: current, changed: false }
  const next = disabled ? [...current, id].sort() : current.filter(other => other !== id)
  return { next: Object.freeze(next), changed: true }
}

/** Toggle one extension coordinate while preserving every contribution's own switch. */
export function withExtensionDisabled(
  value: unknown,
  id: string,
  disabled: boolean,
): { readonly next: readonly string[]; readonly changed: boolean } {
  return withContributionDisabled(value, id, disabled)
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
