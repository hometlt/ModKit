/** Serializable desktop source catalogue. Credentials and VFS mounts stay in the host. */
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
}
export interface ContentSourceSnapshot {
  readonly label: string
  readonly regions: readonly { readonly id: string; readonly label: string }[]
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
}
export interface ContentSourceEntryAction {
  readonly id: 'download' | 'clear-cache' | 'delete-publication'
}
/** A provider-owned local target which the desktop host may reveal in the operating system. */
export interface ContentSourceLocalPath {
  readonly path: string
  readonly kind: 'file' | 'directory'
}
export interface ContentDependencyRequest {
  readonly schemaVersion: 1
  readonly gameId: string
  readonly complete: boolean
  readonly dependencies: readonly unknown[]
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
 * of the host (per folder or file), with the game's own default when absent.
 */
export interface ModContextRequest {
  readonly schemaVersion: 1
  /** Host path of the subject: a package root, a file inside one, or a file inside none. */
  readonly target: string
  /** Packages a file outside any package is read inside, as the game names them. */
  readonly baseMods?: readonly string[]
  /** Only these locales' string files, when the consumer reads one language. */
  readonly locales?: readonly string[]
}

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
  /** `primary` is the opened package, `base` a setting-chosen package under a loose file. */
  readonly role: 'dependency' | 'base' | 'primary'
  readonly provenance: 'declared' | 'implicit' | 'setting' | 'opened'
}

export interface ModContextPage<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
}

export interface ModContext {
  readonly schemaVersion: 1
  readonly gameId: string
  /** Stable for the same target, settings and content; changes when any of them does. */
  readonly contextId: string
  /** Dependencies first, the opened package last. */
  readonly layers: readonly ModContextLayer[]
  /** Declared dependencies no source could provide. */
  readonly unresolved: readonly string[]
  readonly diagnostics: readonly unknown[]
  /** One layer's files, by their paths relative to the layer, in a stable order. */
  files(
    layerId: string,
    page: { readonly cursor?: string; readonly limit: number },
  ): Promise<ModContextPage<string>>
  /** Bytes of one listed file; a path the layer does not list is refused. */
  read(layerId: string, path: string, maxBytes: number): Promise<Uint8Array>
  /** The layer that serves a layer-relative path, the last layer that has it winning. */
  locate(path: string): Promise<{ readonly layerId: string; readonly path: string } | undefined>
  /**
   * Game-defined questions over the merged content (an entity, the ids of a namespace, a string),
   * answered where the merged state lives and paged, so no host ever carries it whole.
   */
  query?(request: unknown, signal?: AbortSignal): Promise<unknown>
  dispose(): Promise<void>
}

/** Source identifiers remain opaque; only an explicit trusted provider may reveal a local target. */
export interface ContentSources {
  snapshot(): Promise<ContentSourceSnapshot>
  /** A ticket kept by the host replaces the interactive login; a fresh one comes back to be kept. */
  connect(region: string, accountId?: string, ticket?: string): Promise<void | { ticket?: string }>
  disconnect(connectionId: string): Promise<void>
  search(connectionId: string, name: string): Promise<readonly ContentSourceSearchResult[]>
  add(resultId: string): Promise<void>
  remove(sourceId: string, path: string): Promise<void>
  refresh(sourceId: string): Promise<void>
  list(sourceId: string, path: string): Promise<readonly ContentSourceEntry[]>
  read(sourceId: string, path: string, maxBytes: number): Promise<Uint8Array>
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
  /** Resolve a codec-discovered dependency set to ordered, read-only roots owned by this source. */
  resolveDependencies?(request: ContentDependencyRequest): Promise<ContentDependencyResolution>
  /** Open a subject inside the mods it belongs to — see {@link ModContextRequest}. */
  openModContext?(request: ModContextRequest): Promise<ModContext>
  /**
   * Read-only roots a game loads regardless of the open subject (for example editor add-on folders),
   * as the same resolution shape a dependency closure uses so a host projects both identically.
   */
  languageMounts?(): Promise<ContentDependencyResolution> | ContentDependencyResolution
  dispose(): void | Promise<void>
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
  'resolveDependencies',
  'languageMounts',
] as const
export type ContentSourceMethod = (typeof CONTENT_SOURCE_METHODS)[number]

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
      return source.connect(
        string(0),
        args[1] === undefined ? undefined : string(1),
        args[2] === undefined ? undefined : string(2),
      )
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
    case 'languageMounts': {
      if (!source.languageMounts) throw new Error('Language mounts are not configured')
      return source.languageMounts()
    }
    case 'resolveDependencies': {
      if (!source.resolveDependencies) throw new Error('Dependency resolution is not configured')
      const value: unknown = args[0]
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
        typeof (value as { gameId?: unknown }).gameId !== 'string' ||
        !(value as { gameId: string }).gameId ||
        (value as { gameId: string }).gameId.length > 256 ||
        typeof (value as { complete?: unknown }).complete !== 'boolean' ||
        !Array.isArray((value as { dependencies?: unknown }).dependencies) ||
        (value as { dependencies: unknown[] }).dependencies.length > 256
      )
        throw new TypeError('Invalid content dependency request')
      return source.resolveDependencies(value as ContentDependencyRequest)
    }
    case 'list':
      return source.list(string(0), path(1))
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
