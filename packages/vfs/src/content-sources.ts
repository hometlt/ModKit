/** Serializable desktop source catalogue. Credentials and VFS mounts stay in the host.
 * Optional atomic byte/context reads carry opaque native entry facts to the Host; VFS does not
 * interpret or validate these facts. Host owns bounded JSON snapshots and their revision identity.
 */
export interface ContentSourceRead {
  readonly bytes: Uint8Array
  /** Inert entry facts from the same winning copy; Host validates/snapshots before codec exposure. */
  readonly context?: unknown
}
export interface ContentSourceConnection {
  readonly id: string
  readonly accountId: string
  readonly label: string
  readonly region: string
}
export interface ContentSourceRoot {
  readonly id: string
  readonly label: string
  readonly region: string
  readonly kind: 'mine' | 'public' | 'local'
  /**
   * The installed game whose storage this root reads (its absolute directory), when it reads one
   * — an installation's CASC, say. A client about to open that directory as a container opens
   * this root instead: the storage is then indexed and held once, by the source, not a second
   * time by a container codec.
   */
  readonly storageOf?: string
  /**
   * Schemes of subject references this root can download (`['rbxassetid']`): a client asked to
   * fetch what a subject references finds the root by scheme and calls {@link ContentSources.download}.
   */
  readonly referenceSchemes?: readonly string[]
  /**
   * Changes whenever the root's files may have changed (a build number, a manifest hash). A client
   * keys caches of the root's contents by it — a content index is only kept for a root that has one.
   */
  readonly revision?: string
  /** The product or build line this root reads, for index caches (`s2`, `wow_classic`). */
  readonly product?: string
  /** The game or format family this root reads, for index caches (`starcraft2`, `roblox`). */
  readonly game?: string
  /**
   * Paths this root hides by its convention ({@link hiddenPathMatcher} patterns, such as
   * `versions.*archive`). Listings and file pages leave them out unless asked for hidden entries;
   * a read by exact path still reads them.
   */
  readonly hiddenPaths?: readonly string[]
}
/** A region; `credentialId` names the declared credential that signs it in. */
export interface ContentSourceRegion {
  readonly id: string
  readonly label: string
  /**
   * The declared credential (`modkit.credentials[].id` of the source's extension) that signs this
   * region in; a scoped one is kept per region (scope = `id`). An application finds the account of
   * a region here — for its accounts view and for moving older secrets — without knowing games.
   */
  readonly credentialId?: string
}
export interface ContentSourceSnapshot {
  readonly label: string
  readonly regions: readonly ContentSourceRegion[]
  readonly publishing?: boolean
  readonly deletion?: boolean
  readonly connections: readonly ContentSourceConnection[]
  readonly roots: readonly ContentSourceRoot[]
}
export interface ContentSourceSearchResult {
  readonly id: string
  readonly label: string
  readonly description: string
}
export interface ContentSourceEntry {
  readonly path: string
  readonly name: string
  readonly directory: boolean
  readonly size?: number
  /** Optional row actions; hosts render these only when their explorer supports actions. */
  readonly actions?: readonly ContentSourceEntryAction[]
  /**
   * Hidden by the source's convention; shown only when the user asks for hidden files. An entry
   * under a hidden folder is hidden too.
   */
  readonly hidden?: true
}
/** One file of a {@link ContentSources.files} page. */
export interface ContentSourceFile {
  /** The path inside the source, spelled as {@link ContentSources.list} spells it. */
  readonly path: string
  readonly size?: number
  /** Hidden itself or under a hidden folder — a flat page marks each file. */
  readonly hidden?: true
}
/** What a workspace search asks a source for; every field narrows, none widens. */
export interface ContentSourceFilesQuery {
  /** Characters the path holds in this order, case-insensitively — a quick-open query. */
  readonly pattern?: string
  /** Lower-case extensions without the dot: only files that have one of them; `''` is none. */
  readonly extensions?: readonly string[]
  /** Where the previous page stopped. */
  readonly cursor?: string
  /** Files one page may hold (1..10000). A page may hold fewer and still have a next one. */
  readonly limit: number
  /** Hidden files too, each marked `hidden`; by default a page leaves them out. */
  readonly includeHidden?: boolean
}
/** What a {@link ContentSources.list} asks about hidden entries. */
export interface ContentSourceListOptions {
  /** Hidden entries too, each marked `hidden`; by default a listing leaves them out. */
  readonly includeHidden?: boolean
}
export interface ContentSourceFilesPage {
  readonly items: readonly ContentSourceFile[]
  readonly nextCursor?: string
}
export interface ContentSourceEntryAction {
  readonly id: 'download' | 'clear-cache' | 'delete-publication'
}
/** A provider-owned local target which the desktop host may reveal in the operating system. */
export interface ContentSourceLocalPath {
  readonly path: string
  readonly kind: 'file' | 'directory'
}
export interface ContentDependencyMount {
  readonly dependencyId: string
  readonly order: number
  readonly sourceId: string
  readonly sourcePath: string
  readonly displayName: string
  readonly kind: string
  readonly fingerprint?: string
}
export interface ContentDependencyResolution {
  readonly schemaVersion: 1
  readonly gameId: string
  readonly complete: boolean
  readonly mounts: readonly ContentDependencyMount[]
  readonly dependencies: readonly unknown[]
  readonly diagnostics: readonly unknown[]
}
/**
 * A file, folder or package opened inside the mods it belongs to — the one way a host loads a
 * game's layered content.
 *
 * The game's loader resolves the dependencies in order, merges data and assets its own way, and
 * keeps each layer's file list with every file's original path: a read is served only when the
 * path is in that list. A file that belongs to no package is opened inside `baseMods` — a setting
 * of the host (per folder or file), with the game's own default when absent. Subjects that are no
 * package but depend on content (a replay naming the archives it was played on) open inside what
 * they name; the game's loader knows how.
 */
export interface ModContextRequest {
  readonly schemaVersion: 1
  /**
   * The subject: a host path (a package root, a file inside one — also inside a packed package — or
   * a file inside none), or a path inside one of this provider's content sources.
   */
  readonly target: ModContextTarget
  /** Packages a file outside any package is read inside, as the game names them. */
  readonly baseMods?: readonly string[]
  /** Only these locales' string files, when the consumer reads one language. */
  readonly locales?: readonly string[]
  /**
   * Opaque editor/workspace scope for unsaved state (1–128 characters, no control characters).
   * An overlay-capable loader must isolate this scope and echo it on the returned context.
   * Omission retains the provider's legacy scope; hosts supply one per client session.
   */
  readonly sessionId?: string
}

/** A host path, or a path inside one of the provider's content sources. */
export type ModContextTarget = string | { readonly sourceId: string; readonly path: string }

/**
 * `package` — the target lies in this package (its primary layer's source and path);
 * `loose` — it exists outside any package and opens over `baseMods`;
 * `missing` — `openModContext` would refuse it: a host path under which nothing exists. A path
 * absent inside a content source still opens loose and fails only on read, so it is `loose`;
 * `foreign` — the target is not this game's (an SC2 script to Dawn of War): another module in the
 * same window may place it. The composition never answers `foreign` itself.
 */
export type ModPackagePlacement =
  | {
      readonly kind: 'package'
      readonly sourceId: string
      readonly path: string
      readonly displayName: string
    }
  | { readonly kind: 'loose' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'foreign' }

/** The `sourceId` of a layer that lives on the host's own disk rather than in a content source. */
export const HOST_LAYER_SOURCE_ID = 'host'

/** One layer of a context, in load order: where it came from and why it is there. */
export interface ModContextLayer {
  readonly id: string
  readonly displayName: string
  /**
   * The content source holding it, and its original path there (`Mods/Core.SC2Mod`); or
   * {@link HOST_LAYER_SOURCE_ID} and the host path, for the opened package on disk.
   */
  readonly sourceId: string
  readonly sourcePath: string
  /**
   * Whether the source distinguishes path spelling by case. Case-sensitive sources declare true;
   * false or omission retains v1's case-insensitive content-source lookup. Host filesystem
   * addresses still follow their native path rules. The loader supplies the path policy.
   */
  readonly caseSensitive?: boolean
  /** `primary` is the opened package, `base` a setting-chosen package under a loose file. */
  readonly role: 'dependency' | 'base' | 'primary'
  readonly provenance: 'declared' | 'implicit' | 'setting' | 'opened'
  /**
   * What the game loader knows the layer to be: `package` — a mod or map loaded as a unit, with
   * its own context; `files` — a plain folder of files (editor wizards). Clients decide by this,
   * never by file extensions.
   */
  readonly kind?: 'package' | 'files'
  /** A revision identity of the layer's content (`content-hash.sha256:…`), when the game knows one. */
  readonly fingerprint?: string
}

/**
 * Source-address identity for a loader-owned layer. Separators/trailing slash are normalized;
 * content sources use their declared policy, host drive/UNC paths fold case and POSIX paths do not.
 * This compares addresses only: it does not validate, resolve or grant access to a path.
 */
export function modContextLayerPathKey(
  layer: Pick<ModContextLayer, 'sourceId' | 'caseSensitive'>,
  path: string,
): string {
  const slashed = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  const insensitive =
    layer.sourceId === HOST_LAYER_SOURCE_ID
      ? /^(?:[A-Za-z]:|\/\/)/u.test(slashed)
      : layer.caseSensitive !== true
  return insensitive ? slashed.toLowerCase() : slashed
}

export interface ModContextPage<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
}

export interface ModContext {
  readonly schemaVersion: 1
  /**
   * The retained server owns every semantic language feature of this game's contexts. Hosts keeping
   * this context must not create a parallel chain-document source. Omit until every installed
   * language consumer is migrated; standalone callers without a kept server retain the legacy path.
   */
  readonly languageModel?: 'server'
  readonly gameId: string
  /** Stable for the same target, settings, source path policies and session; revision tracks edits. */
  readonly contextId: string
  /** The request's isolated unsaved-state scope, when the loader supports session isolation. */
  readonly sessionId?: string
  /** Owner/transport incarnation. A new generation replaces a view even when its contextId matches. */
  readonly generation?: string
  /** Dependencies first, the opened package last. */
  readonly layers: readonly ModContextLayer[]
  /** Declared dependencies no source could provide. */
  readonly unresolved: readonly string[]
  readonly diagnostics: readonly unknown[]
  /**
   * One layer's files, by their paths relative to the layer's package root, components included
   * (`Base.SC2Data/TriggerLibs/LibraryList.xml`), in a stable order; `prefix` keeps only paths that
   * start with it, compared according to the layer's declared case sensitivity.
   */
  files(
    layerId: string,
    page: { readonly cursor?: string; readonly limit: number; readonly prefix?: string },
  ): Promise<ModContextPage<string>>
  /** Bytes of one listed file; a path the layer does not list is refused. */
  read(layerId: string, path: string, maxBytes: number): Promise<Uint8Array>
  /** Atomic optional companion read; old loaders need not implement metadata. */
  readWithContext?(layerId: string, path: string, maxBytes: number): Promise<ContentSourceRead>
  /** The layer that serves a layer-relative path, the last layer that has it winning. */
  locate(path: string): Promise<{ readonly layerId: string; readonly path: string } | undefined>
  /**
   * Game-defined questions over the merged content (an entity, the ids of a namespace, a string),
   * answered where the merged state lives and paged, so no host ever carries it whole.
   */
  query?(request: unknown, signal?: AbortSignal): Promise<unknown>
  /**
   * Revision of this session's view over the saved chain. Changes with its overlays and with
   * saved-content invalidation; another session's overlays do not change it.
   */
  readonly revision?: string
  /**
   * Unsaved editor text over a layer's file, or a file the editor has not saved yet; a change
   * without `text` removes the overlay. Every reader in the same session — `read`, `files`,
   * `query` — sees the text; other sessions continue to read their own view of the saved chain.
   * No changes change nothing and answer this view's revision now.
   */
  overlay?(changes: readonly ModContextOverlay[]): Promise<{ readonly revision: string }>
  /** The chain's files changed on disk: list and read them again. */
  invalidate?(): Promise<{ readonly revision: string }>
  /**
   * Build what answering questions needs before the first question (a loaded mod's Data), so an
   * editor's first request does not wait for it. Absent where a game builds nothing ahead.
   */
  prepare?(signal?: AbortSignal): Promise<void>
  dispose(): Promise<void>
}

/** Editor text over one file of a context layer (`path` is layer-relative), or its removal. */
export interface ModContextOverlay {
  readonly layerId: string
  readonly path: string
  readonly text?: string
}

/**
 * The one {@link ModContext.query} every game answers: resolved data entities by reference, a few
 * at a time — so a map world asks for the units, actors and models it places instead of receiving
 * a whole catalog. An entity the context does not define is left out of the answer.
 */
export interface ModContextEntitiesQuery {
  readonly kind: 'data.entities'
  readonly refs: readonly { readonly namespace: string; readonly entityId: string }[]
}
export interface ModContextEntitiesAnswer {
  /** Resolved entities in the game's data-catalog shape (`namespace`, `entityId`, `fields`, …). */
  readonly entities: readonly unknown[]
}
/**
 * Localized strings by key, a few at a time: each in the first of `locales` (else the context's)
 * that has it, then along the game's fallback chain. A key the context does not define is left out
 * of the answer; a game that keeps no strings does not answer the question.
 */
export interface ModContextStringsQuery {
  readonly kind: 'data.strings'
  readonly keys: readonly string[]
  readonly locales?: readonly string[]
}
export interface ModContextStringsAnswer {
  /** In the data-catalog shape (`key`, `requestedLocale`, `resolvedLocale`, `value`, `source`, `fallback`). */
  readonly strings: readonly unknown[]
}
/** References (or string keys) one query may carry. */
export const MOD_CONTEXT_MAX_QUERY_REFS = 1024

/** Source identifiers remain opaque; only an explicit trusted provider may reveal a local target. */
export interface ContentSources {
  snapshot(): Promise<ContentSourceSnapshot>
  /**
   * Connect an account. Keys, tickets and tokens are the credential broker's: the module reads
   * them through `ContentSourceModuleContext.credentials`, none crosses this call.
   */
  connect(region: string, accountId?: string): Promise<void>
  disconnect(connectionId: string): Promise<void>
  search(connectionId: string, name: string): Promise<readonly ContentSourceSearchResult[]>
  add(resultId: string): Promise<void>
  remove(sourceId: string, path: string): Promise<void>
  refresh(sourceId: string): Promise<void>
  list(
    sourceId: string,
    path: string,
    options?: ContentSourceListOptions,
  ): Promise<readonly ContentSourceEntry[]>
  read(sourceId: string, path: string, maxBytes: number): Promise<Uint8Array>
  /** Reads bytes and opaque entry facts from one winning copy, without a second metadata lookup. */
  readWithContext?(sourceId: string, path: string, maxBytes: number): Promise<ContentSourceRead>
  /**
   * The entry at exactly `path`, also one no listing names yet: a source that fetches on demand
   * (Roblox assets from the CDN) answers for an asset it has not downloaded, which `read` then
   * fetches. Undefined when there is no such entry; absent when the source answers only by `list`.
   * Like a read, it finds hidden entries.
   */
  lookup?(sourceId: string, path: string): Promise<ContentSourceEntry | undefined>
  /**
   * Every file beneath `path`, in pages, narrowed inside the source: what a workspace search walks
   * instead of listing folder after folder. The installed StarCraft II storage names 666k files in
   * 37k folders; a source that holds them indexed scans the index and makes no string for a file
   * the query rules out. `undefined` means this root cannot list in bulk — walk {@link list}.
   */
  files?(
    sourceId: string,
    path: string,
    query: ContentSourceFilesQuery,
  ): Promise<ContentSourceFilesPage | undefined>
  preparePublish?(connectionId: string, filePath: string, packagePath: string): Promise<unknown>
  publish?(reviewId: string): Promise<unknown>
  deletionCandidates?(connectionId: string): Promise<unknown>
  deletePublication?(reviewId: string): Promise<unknown>
  download?(sourceId: string, path: string): Promise<unknown>
  clearCache?(sourceId: string, path: string): Promise<unknown>
  prepareDeletePublication?(sourceId: string, path: string): Promise<unknown>
  /** What this account has left to publish into, in the connection's region. */
  storage?(connectionId: string): Promise<unknown>
  /** Compile a document's first publication and return it for review. */
  prepareFirstPublication?(connectionId: string, options: PublicationOptions): Promise<unknown>
  /** Compile the next revision of one of this account's publications and return it for review. */
  prepareRevision?(sourceId: string, path: string, options: PublicationOptions): Promise<unknown>
  /** Resolve a local source row for an OS-native reveal action. Remote sources return undefined. */
  resolveLocalPath?(sourceId: string, path: string): Promise<ContentSourceLocalPath | undefined>
  /** Open a subject inside the mods it belongs to — see {@link ModContextRequest}. */
  openModContext?(request: ModContextRequest): Promise<ModContext>
  /**
   * Where `openModContext` would place a target, without opening a context: the same loader
   * decides both. Asynchronous because it checks the sources.
   */
  locateModPackage?(target: ModContextTarget, signal?: AbortSignal): Promise<ModPackagePlacement>
  /**
   * Modules of a composed catalogue that have not started yet ({@link DeferredContentSources}):
   * what a host shows as a game it can start. Absent when every module started with the catalogue.
   */
  pendingModules?(): readonly ContentSourceModuleInfo[]
  /** Start one pending module now; its regions and roots are in the next snapshot. */
  startModule?(id: string): Promise<void>
  dispose(): void | Promise<void>
}

/** A content-source module as a host names it before it starts. */
export interface ContentSourceModuleInfo {
  /** The extension that declares the module (`publisher/id`). */
  readonly id: string
  /** What a host shows for it: the extension's display name. */
  readonly label: string
}

/**
 * A module a composed catalogue loads only when it is first needed (owner decision 13.10): a game
 * the window does not touch neither imports its module nor looks for its installation.
 */
export interface DeferredContentSources extends ContentSourceModuleInfo {
  load(): Promise<ContentSources>
}

/** What a host may choose about a publication. Both publication calls take the same options. */
export interface PublicationOptions {
  readonly archivePath?: string
  readonly name?: string
  readonly description?: string
  readonly locale?: string
  readonly visibility?: 'private' | 'public'
  readonly locked?: boolean
  /** Apply the "Locked By BadName" header protection to the archive that is sent. */
  readonly protectHeader?: boolean
  /** Publish as a major revision (1.4 becomes 2.0) rather than the next minor one. */
  readonly majorRevision?: boolean
}

const bounded = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && !!value && value.length <= limit && !/[\u0000-\u001f]/u.test(value)

/**
 * Check the options of a publication call.
 *
 * A field this boundary does not know is refused rather than dropped: a host that sends one is
 * asking for something, and silently publishing without it is the worse answer.
 */
function publicationOptions(raw: unknown, required: readonly string[]): PublicationOptions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('Invalid publication options')
  }
  const options = raw as Record<string, unknown>
  const checks: Record<string, (value: unknown) => boolean> = {
    archivePath: value => bounded(value, 4096),
    name: value => bounded(value, 80),
    description: value => typeof value === 'string' && value.length <= 4096,
    locale: value => typeof value === 'string' && /^[a-z]{2}[A-Z]{2}$/u.test(value),
    visibility: value => value === 'private' || value === 'public',
    locked: value => typeof value === 'boolean',
    protectHeader: value => typeof value === 'boolean',
    majorRevision: value => typeof value === 'boolean',
  }
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    const check = checks[key]
    if (!check) throw new TypeError(`Unknown publication option: ${key}`)
    if (!check(value)) throw new TypeError(`Invalid publication option: ${key}`)
  }
  for (const key of required) {
    if (options[key] === undefined) throw new TypeError(`Missing publication option: ${key}`)
  }
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as PublicationOptions
}

export const CONTENT_SOURCE_METHODS = [
  'snapshot',
  'connect',
  'disconnect',
  'search',
  'add',
  'remove',
  'refresh',
  'list',
  'read',
  'preparePublish',
  'publish',
  'deletionCandidates',
  'deletePublication',
  'download',
  'clearCache',
  'prepareDeletePublication',
  'prepareFirstPublication',
  'prepareRevision',
  'storage',
  'resolveLocalPath',
  'files',
] as const
export type ContentSourceMethod = (typeof CONTENT_SOURCE_METHODS)[number]

/** Check a {@link ContentSources.files} query crossing the IPC boundary. */
function filesQuery(raw: unknown): ContentSourceFilesQuery {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('Invalid source file query')
  }
  const { pattern, extensions, cursor, limit, includeHidden, ...rest } = raw as Record<
    string,
    unknown
  >
  if (
    Object.keys(rest).length > 0 ||
    (includeHidden !== undefined && typeof includeHidden !== 'boolean') ||
    (pattern !== undefined && (typeof pattern !== 'string' || pattern.length > 512)) ||
    (extensions !== undefined &&
      (!Array.isArray(extensions) ||
        extensions.length > 256 ||
        !extensions.every(item => typeof item === 'string' && /^[a-z0-9_-]{0,32}$/u.test(item)))) ||
    (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 256)) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10_000
  ) {
    throw new TypeError('Invalid source file query')
  }
  return {
    limit,
    ...(pattern === undefined ? {} : { pattern: pattern as string }),
    ...(extensions === undefined ? {} : { extensions: extensions as string[] }),
    ...(cursor === undefined ? {} : { cursor: cursor as string }),
    ...(includeHidden === undefined ? {} : { includeHidden: includeHidden as boolean }),
  }
}

/** Check {@link ContentSourceListOptions} crossing the IPC boundary. */
function listOptions(raw: unknown): ContentSourceListOptions | undefined {
  if (raw === undefined) return undefined
  const invalid = () => new TypeError('Invalid source list options')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid()
  const { includeHidden, ...rest } = raw as Record<string, unknown>
  if (
    Object.keys(rest).length > 0 ||
    (includeHidden !== undefined && typeof includeHidden !== 'boolean')
  )
    throw invalid()
  return includeHidden === undefined ? {} : { includeHidden: includeHidden as boolean }
}

/**
 * The one matcher of hidden-path rules ({@link ContentSourceRoot.hiddenPaths}): `/`-separated
 * patterns, `*` and `?` within one segment, `**` any number of folders, letter case ignored. A path
 * is hidden when a pattern names it or one of its folders.
 */
export function hiddenPathMatcher(patterns: readonly string[]): (path: string) => boolean {
  const sources = patterns.flatMap(pattern => {
    const segments = pattern.replaceAll('\\', '/').split('/').filter(Boolean)
    // a folder's contents are hidden with it, so a trailing `**` adds nothing
    while (segments.at(-1) === '**') segments.pop()
    if (segments.length === 0) return []
    return [
      segments
        .map((segment, index) =>
          segment === '**'
            ? '(?:[^/]+/)*'
            : segment
                .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
                .replaceAll('*', '[^/]*')
                .replaceAll('?', '[^/]') + (index < segments.length - 1 ? '/' : ''),
        )
        .join(''),
    ]
  })
  if (sources.length === 0) return () => false
  const expression = new RegExp(`^(?:${sources.join('|')})(?:/|$)`, 'iu')
  return path => expression.test(path.replaceAll('\\', '/').replace(/^\/+/u, ''))
}

/**
 * A source whose listings and file pages leave out what is hidden — marked `hidden` by the source or
 * named by its root's `hiddenPaths` — unless asked for hidden entries, which then come marked. The
 * one place the rule is applied; reads by exact path are untouched.
 */
function withHiddenEntries(part: ContentSources): ContentSources {
  let rules = new Map<string, (path: string) => boolean>()
  const snapshot = async (): Promise<ContentSourceSnapshot> => {
    const taken = await part.snapshot()
    rules = new Map(taken.roots.map(root => [root.id, hiddenPathMatcher(root.hiddenPaths ?? [])]))
    return taken
  }
  const hiddenIn = async (sourceId: string) => {
    if (!rules.has(sourceId)) await snapshot()
    return rules.get(sourceId) ?? (() => false)
  }
  const keep = <T extends { readonly path: string; readonly hidden?: true }>(
    items: readonly T[],
    hidden: (path: string) => boolean,
    include: boolean | undefined,
  ): T[] =>
    items.flatMap(item => {
      if (item.hidden !== true && !hidden(item.path)) return [item]
      if (include !== true) return []
      return [item.hidden === true ? item : { ...item, hidden: true as const }]
    })
  const list: ContentSources['list'] = async (sourceId, path, options) =>
    keep(await part.list(sourceId, path, options), await hiddenIn(sourceId), options?.includeHidden)
  const files: ContentSources['files'] = async (sourceId, path, query) => {
    const page = await part.files?.(sourceId, path, query)
    return page === undefined
      ? undefined
      : { ...page, items: keep(page.items, await hiddenIn(sourceId), query.includeHidden) }
  }
  return new Proxy(part, {
    get(target, key) {
      if (key === 'snapshot') return snapshot
      if (key === 'list') return list
      if (key === 'files') return target.files === undefined ? undefined : files
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

/** Validate the small IPC surface before invoking a trusted host-owned provider. */
export async function callContentSources(
  source: ContentSources,
  method: unknown,
  args: unknown,
): Promise<unknown> {
  if (!Array.isArray(args) || args.length > 3) throw new TypeError('Invalid source arguments')
  const string = (index: number): string => {
    const value: unknown = args[index]
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 4096 ||
      /[\u0000-\u001f]/u.test(value)
    ) {
      throw new TypeError('Invalid source identifier')
    }
    return value
  }
  const path = (index: number): string => (args[index] === '' ? '' : string(index))
  switch (method) {
    case 'snapshot':
      return source.snapshot()
    case 'connect':
      return source.connect(string(0), args[1] === undefined ? undefined : string(1))
    case 'disconnect':
      return source.disconnect(string(0))
    case 'search':
      return source.search(string(0), string(1))
    case 'add':
      return source.add(string(0))
    case 'remove':
      return source.remove(string(0), path(1))
    case 'refresh':
      return source.refresh(string(0))
    case 'preparePublish': {
      if (!source.preparePublish) throw new Error('Publishing is not configured')
      return source.preparePublish(string(0), string(1), string(2))
    }
    case 'publish': {
      if (!source.publish) throw new Error('Publishing is not configured')
      return source.publish(string(0))
    }
    case 'deletionCandidates': {
      if (!source.deletionCandidates) throw new Error('Deletion is not configured')
      return source.deletionCandidates(string(0))
    }
    case 'deletePublication': {
      if (!source.deletePublication) throw new Error('Deletion is not configured')
      return source.deletePublication(string(0))
    }
    case 'download': {
      if (!source.download) throw new Error('Download is not configured')
      return source.download(string(0), path(1))
    }
    case 'clearCache': {
      if (!source.clearCache) throw new Error('Cache removal is not configured')
      return source.clearCache(string(0), path(1))
    }
    case 'storage': {
      if (!source.storage) throw new Error('Publishing is not configured')
      return source.storage(string(0))
    }
    case 'prepareFirstPublication': {
      if (!source.prepareFirstPublication) throw new Error('Publishing is not configured')
      return source.prepareFirstPublication(
        string(0),
        publicationOptions(args[1], ['archivePath', 'name']),
      )
    }
    case 'prepareRevision': {
      if (!source.prepareRevision) throw new Error('Publishing is not configured')
      return source.prepareRevision(string(0), path(1), publicationOptions(args[2], []))
    }
    case 'prepareDeletePublication': {
      if (!source.prepareDeletePublication)
        throw new Error('Publication deletion is not configured')
      return source.prepareDeletePublication(string(0), path(1))
    }
    case 'resolveLocalPath': {
      if (!source.resolveLocalPath) throw new Error('Local path resolution is not configured')
      const value = await source.resolveLocalPath(string(0), path(1))
      if (value === undefined) return undefined
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        typeof value.path !== 'string' ||
        !value.path ||
        value.path.length > 4096 ||
        /[\u0000-\u001f]/u.test(value.path) ||
        (value.kind !== 'file' && value.kind !== 'directory')
      )
        throw new TypeError('Invalid local source path')
      return value
    }
    case 'list':
      return source.list(string(0), path(1), listOptions(args[2]))
    case 'lookup':
      return source.lookup === undefined ? undefined : source.lookup(string(0), path(1))
    case 'files': {
      if (!source.files) return undefined
      return source.files(string(0), path(1), filesQuery(args[2]))
    }
    case 'read': {
      const max: unknown = args[2]
      if (
        typeof max !== 'number' ||
        !Number.isSafeInteger(max) ||
        max < 0 ||
        max > 64 * 1024 * 1024
      ) {
        throw new TypeError('Source read exceeds the desktop preview limit')
      }
      return source.read(string(0), path(1), max)
    }
    default:
      throw new TypeError('Unknown source operation')
  }
}

/**
 * Several extensions' sources as one catalogue. Each part owns the regions, connections and roots
 * its snapshot names — an id two parts both name is refused — and every call keyed by one of them
 * goes to its owner. A host-path mod context goes to the first part whose `locateModPackage`
 * places it in a package, else to the first part that opens contexts (a loose file opens inside
 * that game's base mods, as a single provider did). One part is returned as it is, save that every
 * part's listings leave hidden entries out unless asked (`includeHidden`).
 *
 * `deferred` modules start when first needed: a call keyed by an id no started module names starts
 * them in order until one names it, and a host path no started module places (in a package or
 * loose) is offered to them the same way; `startModule` starts one on request. Until then they are
 * in no snapshot (`pendingModules` names them). A module that fails to start stays pending and is
 * tried again by the next call that needs it.
 */
export function composeContentSources(
  given: readonly ContentSources[],
  deferred: readonly DeferredContentSources[] = [],
): ContentSources {
  if (given.length === 1 && deferred.length === 0) return withHiddenEntries(given[0]!)
  interface Slot {
    part?: ContentSources
    readonly module?: DeferredContentSources
    loading?: Promise<ContentSources> | undefined
  }
  const slots: Slot[] = [
    ...given.map(part => ({ part: withHiddenEntries(part) })),
    ...deferred.map(module => ({ module })),
  ]
  let disposed = false
  /** The started modules, in declaration order: started ones first, deferred ones as they start. */
  const started = (): ContentSources[] => slots.flatMap(slot => (slot.part ? [slot.part] : []))
  const pending = (): Slot[] => slots.filter(slot => slot.part === undefined)
  const start = (slot: Slot): Promise<ContentSources> => {
    if (slot.part !== undefined) return Promise.resolve(slot.part)
    slot.loading ??= slot.module!.load().then(
      async loaded => {
        if (disposed) {
          await loaded.dispose()
          throw new Error('the content sources were disposed while a module started')
        }
        slot.part = withHiddenEntries(loaded)
        return slot.part
      },
      (error: unknown) => {
        slot.loading = undefined
        throw error
      },
    )
    return slot.loading
  }
  /**
   * Start pending modules in order until `found` answers for one; undefined when none does. A
   * module that cannot start is passed over, so one broken game never blocks another's file.
   */
  const firstPending = async <T>(
    found: (part: ContentSources) => Promise<T | undefined>,
  ): Promise<T | undefined> => {
    for (const slot of pending()) {
      const part = await start(slot).catch(() => undefined)
      if (part === undefined) continue
      const answer = await found(part)
      if (answer !== undefined) return answer
    }
    return undefined
  }
  const owners = {
    region: new Map<string, ContentSources>(),
    connection: new Map<string, ContentSources>(),
    source: new Map<string, ContentSources>(),
    result: new Map<string, ContentSources>(),
  }
  // ponytail: a review id is not in any snapshot; it belongs to the part that last prepared one.
  let publisher: ContentSources | undefined
  const snapshot = async (): Promise<ContentSourceSnapshot> => {
    const taken = await Promise.all(
      started().map(async part => ({ part, snapshot: await part.snapshot() })),
    )
    for (const map of [owners.region, owners.connection, owners.source]) map.clear()
    const claim = (
      map: Map<string, ContentSources>,
      kind: string,
      id: string,
      part: ContentSources,
    ) => {
      if (map.has(id) && map.get(id) !== part)
        throw new TypeError(`two content source modules name the ${kind} «${id}»`)
      map.set(id, part)
    }
    for (const { part, snapshot } of taken) {
      for (const region of snapshot.regions) claim(owners.region, 'region', region.id, part)
      for (const connection of snapshot.connections)
        claim(owners.connection, 'connection', connection.id, part)
      for (const root of snapshot.roots) claim(owners.source, 'source', root.id, part)
    }
    return {
      label: taken.map(item => item.snapshot.label).join(' · '),
      regions: taken.flatMap(item => item.snapshot.regions),
      ...(taken.some(item => item.snapshot.publishing) ? { publishing: true } : {}),
      ...(taken.some(item => item.snapshot.deletion) ? { deletion: true } : {}),
      connections: taken.flatMap(item => item.snapshot.connections),
      roots: taken.flatMap(item => item.snapshot.roots),
    }
  }
  const owner = async (map: Map<string, ContentSources>, id: string): Promise<ContentSources> => {
    if (!map.has(id) && map !== owners.result) await snapshot()
    // an id no started module names may be a pending module's: start them until one names it
    const part =
      map.get(id) ??
      (map === owners.result
        ? undefined
        : await firstPending(async () => {
            await snapshot()
            return map.get(id)
          }))
    if (part === undefined) throw new RangeError(`no content source module owns «${id}»`)
    return part
  }
  const bySource = (id: string) => owner(owners.source, id)
  const byConnection = (id: string) => owner(owners.connection, id)
  const optional = <K extends keyof ContentSources>(part: ContentSources, key: K) => {
    const method = part[key]
    if (typeof method !== 'function')
      throw new TypeError(`this content source module does not support ${String(key)}`)
    return (method as (...args: unknown[]) => unknown).bind(part)
  }
  // A host path goes to the module that places it in a package, else to the first that accepts it
  // loose; a module that calls it foreign or missing never receives it. Pending modules are asked
  // only when no started one accepted it, and one that cannot place targets only after them.
  const hostTarget = async (target: string): Promise<ContentSources | undefined> => {
    let loose: ContentSources | undefined
    for (const part of started()) {
      const placement = await part.locateModPackage?.(target)
      if (placement?.kind === 'package') return part
      if (placement?.kind === 'loose') loose ??= part
    }
    return (
      loose ??
      (await firstPending(async part => {
        const placement = await part.locateModPackage?.(target)
        return placement?.kind === 'package' || placement?.kind === 'loose' ? part : undefined
      })) ??
      started().find(part => part.openModContext !== undefined && part.locateModPackage === undefined)
    )
  }
  const composed: ContentSources = {
    snapshot,
    async connect(region, accountId) {
      return (await owner(owners.region, region)).connect(region, accountId)
    },
    async disconnect(connectionId) {
      return (await byConnection(connectionId)).disconnect(connectionId)
    },
    async search(connectionId, name) {
      const part = await byConnection(connectionId)
      const results = await part.search(connectionId, name)
      for (const result of results) owners.result.set(result.id, part)
      return results
    },
    async add(resultId) {
      return (await owner(owners.result, resultId)).add(resultId)
    },
    async remove(sourceId, path) {
      return (await bySource(sourceId)).remove(sourceId, path)
    },
    async refresh(sourceId) {
      // the host's own files (a mod folder on disk) belong to no part: each part that read them
      // forgets them; a part that never did refuses, and only all refusing is a failure
      if (sourceId === HOST_LAYER_SOURCE_ID) {
        const outcomes = await Promise.allSettled(started().map(part => part.refresh(sourceId)))
        const refused = outcomes.filter(outcome => outcome.status === 'rejected')
        if (refused.length === outcomes.length && refused[0] !== undefined) throw refused[0].reason
        return
      }
      return (await bySource(sourceId)).refresh(sourceId)
    },
    async list(sourceId, path, options) {
      return (await bySource(sourceId)).list(sourceId, path, options)
    },
    async read(sourceId, path, maxBytes) {
      return (await bySource(sourceId)).read(sourceId, path, maxBytes)
    },
    /** Keeps native entry context when the owning provider supports it; legacy reads stay valid. */
    async readWithContext(sourceId, path, maxBytes) {
      const part = await bySource(sourceId)
      return part.readWithContext === undefined
        ? { bytes: await part.read(sourceId, path, maxBytes) }
        : part.readWithContext(sourceId, path, maxBytes)
    },
    async lookup(sourceId, path) {
      const part = await bySource(sourceId)
      return part.lookup === undefined ? undefined : part.lookup(sourceId, path)
    },
    async files(sourceId, path, query) {
      const part = await bySource(sourceId)
      return part.files === undefined ? undefined : part.files(sourceId, path, query)
    },
    async preparePublish(connectionId, filePath, packagePath) {
      publisher = await byConnection(connectionId)
      return optional(publisher, 'preparePublish')(connectionId, filePath, packagePath)
    },
    async publish(reviewId) {
      if (publisher === undefined) throw new RangeError(`no publication «${reviewId}» was prepared`)
      return optional(publisher, 'publish')(reviewId)
    },
    async deletionCandidates(connectionId) {
      return optional(await byConnection(connectionId), 'deletionCandidates')(connectionId)
    },
    async deletePublication(reviewId) {
      if (publisher === undefined) throw new RangeError(`no deletion «${reviewId}» was prepared`)
      return optional(publisher, 'deletePublication')(reviewId)
    },
    async download(sourceId, path) {
      return optional(await bySource(sourceId), 'download')(sourceId, path)
    },
    async clearCache(sourceId, path) {
      return optional(await bySource(sourceId), 'clearCache')(sourceId, path)
    },
    async prepareDeletePublication(sourceId, path) {
      publisher = await bySource(sourceId)
      return optional(publisher, 'prepareDeletePublication')(sourceId, path)
    },
    async storage(connectionId) {
      return optional(await byConnection(connectionId), 'storage')(connectionId)
    },
    async prepareFirstPublication(connectionId, options) {
      publisher = await byConnection(connectionId)
      return optional(publisher, 'prepareFirstPublication')(connectionId, options)
    },
    async prepareRevision(sourceId, path, options) {
      publisher = await bySource(sourceId)
      return optional(publisher, 'prepareRevision')(sourceId, path, options)
    },
    async resolveLocalPath(sourceId, path) {
      const part = await bySource(sourceId)
      return part.resolveLocalPath === undefined ? undefined : part.resolveLocalPath(sourceId, path)
    },
    async openModContext(request) {
      const part =
        typeof request.target === 'string'
          ? await hostTarget(request.target)
          : await bySource(request.target.sourceId)
      if (part?.openModContext === undefined)
        throw new TypeError('no content source module opens mod contexts')
      return part.openModContext(request)
    },
    async locateModPackage(target, signal) {
      if (typeof target !== 'string') {
        const part = await bySource(target.sourceId)
        return part.locateModPackage === undefined
          ? { kind: 'missing' }
          : part.locateModPackage(target, signal)
      }
      let loose = false
      for (const part of started()) {
        const placement = await part.locateModPackage?.(target, signal)
        if (placement?.kind === 'package') return placement
        if (placement?.kind === 'loose') loose = true
      }
      if (loose) return { kind: 'loose' }
      const placed = await firstPending(async part => {
        const placement = await part.locateModPackage?.(target, signal)
        return placement?.kind === 'package' || placement?.kind === 'loose' ? placement : undefined
      })
      return placed ?? { kind: 'missing' }
    },
    pendingModules() {
      return pending().map(slot => ({ id: slot.module!.id, label: slot.module!.label }))
    },
    async startModule(id) {
      const slot = slots.find(item => item.module?.id === id)
      if (slot === undefined) throw new RangeError(`no content source module «${id}»`)
      await start(slot)
    },
    async dispose() {
      disposed = true
      const loading = slots.flatMap(slot =>
        slot.part === undefined && slot.loading !== undefined ? [slot.loading] : [],
      )
      await Promise.all([
        ...started().map(part => part.dispose()),
        ...loading.map(promise => promise.then(() => undefined, () => undefined)),
      ])
    },
  }
  // A client offers a command only when the method exists: keep just what some part supports. A
  // pending module's methods are not known before it starts, so with one pending every one stays.
  for (const key of OPTIONAL_CONTENT_SOURCE_METHODS) {
    if (deferred.length === 0 && !started().some(part => part[key] !== undefined))
      delete (composed as Partial<ContentSources>)[key]
  }
  if (deferred.length === 0) {
    delete (composed as Partial<ContentSources>).pendingModules
    delete (composed as Partial<ContentSources>).startModule
  }
  // Each game's Runtime preparer; the host picks the one for the opened context's game.
  const preparers = (): unknown[] =>
    started().flatMap(part => {
      const preparer = (part as { readonly runtimePreparer?: unknown }).runtimePreparer
      return preparer === undefined ? [] : [preparer]
    })
  if (deferred.length > 0) {
    // a module that starts later brings its preparer with it
    return Object.defineProperty(composed, 'runtimePreparers', { get: preparers, enumerable: true })
  }
  const runtimePreparers = preparers()
  return runtimePreparers.length === 0 ? composed : Object.assign(composed, { runtimePreparers })
}

const OPTIONAL_CONTENT_SOURCE_METHODS = [
  'files',
  'preparePublish',
  'publish',
  'deletionCandidates',
  'deletePublication',
  'download',
  'clearCache',
  'prepareDeletePublication',
  'storage',
  'prepareFirstPublication',
  'prepareRevision',
  'resolveLocalPath',
  'openModContext',
  'locateModPackage',
] as const satisfies readonly (keyof ContentSources)[]

export {
  createLayeredArchiveContentSources,
  openArchiveLayers,
  layeredModContext,
  type ArchiveLayers,
  type LayerArchive,
  type LayerArchiveEntry,
  type LayeredArchiveContentSources,
  type LayeredContextLayer,
  type LayeredModContextOptions,
  type LayeredRoot,
  type LayerOrigin,
} from './layered-archive-sources.js'
