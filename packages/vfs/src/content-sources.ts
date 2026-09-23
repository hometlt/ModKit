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
  /** Compile the next revision of one of this account's publications and return it for review. */
  prepareRevision?(sourceId: string, path: string, options: {
    readonly archivePath?: string
    readonly visibility?: 'private' | 'public'
    readonly locked?: boolean
  }): Promise<unknown>
  /** Resolve a local source row for an OS-native reveal action. Remote sources return undefined. */
  resolveLocalPath?(sourceId: string, path: string): Promise<ContentSourceLocalPath | undefined>
  /** Resolve a codec-discovered dependency set to ordered, read-only roots owned by this source. */
  resolveDependencies?(request: ContentDependencyRequest): Promise<ContentDependencyResolution>
  /**
   * Read-only roots a game loads regardless of the open subject (for example editor add-on folders),
   * as the same resolution shape a dependency closure uses so a host projects both identically.
   */
  languageMounts?(): Promise<ContentDependencyResolution> | ContentDependencyResolution
  dispose(): void | Promise<void>
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
  'prepareRevision',
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
    case 'prepareRevision': {
      if (!source.prepareRevision) throw new Error('Publishing is not configured')
      const raw: unknown = args[2]
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new TypeError('Invalid revision options')
      }
      const options = raw as { archivePath?: unknown; visibility?: unknown; locked?: unknown }
      if (options.visibility !== undefined && options.visibility !== 'private' && options.visibility !== 'public') {
        throw new TypeError('Invalid revision visibility')
      }
      if (options.locked !== undefined && typeof options.locked !== 'boolean') {
        throw new TypeError('Invalid revision lock')
      }
      if (options.archivePath !== undefined &&
        (typeof options.archivePath !== 'string' || !options.archivePath ||
          options.archivePath.length > 4096 || /[\u0000-\u001f]/u.test(options.archivePath))) {
        throw new TypeError('Invalid revision archive path')
      }
      return source.prepareRevision(string(0), path(1), {
        ...(options.archivePath === undefined ? {} : { archivePath: options.archivePath as string }),
        ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
        ...(options.locked === undefined ? {} : { locked: options.locked }),
      })
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
