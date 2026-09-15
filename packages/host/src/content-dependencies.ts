import { diagnostic, throwIfAborted, type Diagnostic } from '@modkit/core'
import {
  isRevisionId,
  revisionId,
  revisionIdFromRef,
  type ArtifactByteSource,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type ModWorkspaceDiagnostic,
  type ModWorkspaceGraphRoot,
  type ModWorkspaceLock,
  type RevisionId,
} from '@modkit/sdk'
import type {
  ContentDependencyRequest,
  ContentDependencyMount,
  ContentDependencyResolution,
  ContentSourceEntry,
  ContentSources,
} from '@modkit/vfs/content-sources'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from './language/workspace.js'
import {
  analyzeResolvedDataWorkspace,
  type AnalyzedResolvedDataWorkspace,
  type AnalyzeResolvedDataWorkspaceRequest,
} from './data/index.js'
import {
  normalizeCompanionLogicalId,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
  type CompanionOriginEntry,
} from './input-resolution.js'
import { createResourceSession, type ResourceSessionLimits } from './resource-session.js'

const DEPENDENCY_SCOPE = Object.freeze(['workspace-dependency-layer'] as const)

export interface ReadOnlyContentDependencyWorkspaceOptions {
  readonly contentSources: ContentSources
  readonly resolution: ContentDependencyResolution
  readonly workspaceId: string
  readonly maximumEntryBytes?: number
  readonly resourceLimits?: Partial<ResourceSessionLimits>
  readonly signal?: AbortSignal
}

export interface ReadOnlyContentDependencyWorkspace {
  readonly workspace: ModWorkspaceLock
  readonly resources: ReturnType<typeof createResourceSession>
  dispose(): Promise<void>
}

export interface AnalyzeReadOnlyContentDependenciesRequest extends Omit<
  AnalyzeResolvedDataWorkspaceRequest,
  'workspace' | 'resources' | 'writableRoots'
> {
  readonly contentSources: ContentSources
  readonly dependencies: ContentDependencyRequest
  readonly workspaceId: string
  readonly maximumEntryBytes?: number
  readonly resourceLimits?: Partial<ResourceSessionLimits>
}

export interface ContentDependencyLanguageDocumentSourceOptions {
  readonly contentSources: ContentSources
  readonly resolution: ContentDependencyResolution
  readonly routes: readonly LanguageProviderRoute[]
  readonly maxDocumentBytes?: number
  readonly maxWorkspaceBytes?: number
  readonly maxEntries?: number
}

interface IndexedMount extends ContentDependencyMount {
  readonly rootId: string
  readonly logicalPrefix: string
  readonly revision: RevisionId
}

function nonEmpty(value: string, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${name} must be a bounded non-empty string`)
  }
  return value
}

function normalizeOpaquePath(value: string): string {
  return value === '' ? '' : normalizeCompanionLogicalId(value)
}

function joinPath(prefix: string, path: string): string {
  return prefix === '' ? path : path === '' ? prefix : `${prefix}/${path}`
}

function relativeEntry(mount: IndexedMount, entry: ContentSourceEntry): string | undefined {
  const path = normalizeOpaquePath(entry.path)
  if (mount.sourcePath === '') return path
  const prefix = `${mount.sourcePath}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined
}

function entryRevision(mount: ContentDependencyMount): RevisionId {
  return mount.fingerprint !== undefined && isRevisionId(mount.fingerprint)
    ? revisionId(mount.fingerprint)
    : revisionIdFromRef({
        kind: 'provider-token',
        value: `${mount.sourceId}\0${mount.sourcePath}\0${mount.dependencyId}`,
      })
}

function validateMounts(resolution: ContentDependencyResolution): readonly IndexedMount[] {
  if (resolution.schemaVersion !== 1 || !nonEmpty(resolution.gameId, 'gameId')) {
    throw new TypeError('invalid content dependency resolution')
  }
  if (
    !Array.isArray(resolution.mounts) ||
    resolution.mounts.length === 0 ||
    resolution.mounts.length > 256
  ) {
    throw new TypeError('content dependency workspace requires 1..256 resolved mounts')
  }
  const ids = new Set<string>()
  const roots = resolution.mounts.map((mount, index) => {
    const dependencyId = nonEmpty(mount.dependencyId, `mount ${index} dependencyId`)
    if (ids.has(dependencyId) || !Number.isSafeInteger(mount.order) || mount.order < 0) {
      throw new TypeError(`invalid content dependency mount ${index}`)
    }
    ids.add(dependencyId)
    return Object.freeze({
      ...mount,
      dependencyId,
      sourceId: nonEmpty(mount.sourceId, `mount ${index} sourceId`),
      sourcePath: normalizeOpaquePath(mount.sourcePath),
      displayName: nonEmpty(mount.displayName, `mount ${index} displayName`),
      kind: nonEmpty(mount.kind, `mount ${index} kind`),
      rootId: `content-dependency:${dependencyId}`,
      logicalPrefix: '',
      revision: entryRevision(mount),
    })
  })
  roots.sort((left, right) => left.order - right.order)
  return Object.freeze(
    roots.map((root, index) =>
      Object.freeze({
        ...root,
        logicalPrefix: `content-dependencies/${index}`,
      }),
    ),
  )
}

function workspaceDiagnostic(value: unknown): ModWorkspaceDiagnostic {
  const item =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : undefined
  const severity = item?.['severity']
  return Object.freeze({
    severity:
      severity === 'error' || severity === 'warning' || severity === 'information'
        ? severity
        : 'warning',
    code:
      typeof item?.['code'] === 'string' && item['code']
        ? item['code']
        : 'x3.host/content-dependency-diagnostic',
    message:
      typeof item?.['message'] === 'string' && item['message']
        ? item['message']
        : 'content dependency provider returned an unstructured diagnostic',
  })
}

export function contentDependencyDiagnostics(values: readonly unknown[]): readonly Diagnostic[] {
  return Object.freeze(
    values.map(value => {
      const item = workspaceDiagnostic(value)
      return diagnostic(item.severity, item.code, item.message)
    }),
  )
}

function createContentDependencyOrigin(
  contentSources: ContentSources,
  mounts: readonly IndexedMount[],
  maximumEntryBytes: number,
): CompanionOrigin {
  const overlay = Object.freeze([...mounts].reverse())
  const locations = new Map<string, IndexedMount>()
  const fold = (value: string) => value.toLowerCase()
  const relativeRequest = (mount: IndexedMount, logicalId: string): string | undefined => {
    if (logicalId === '') return ''
    if (fold(logicalId) === fold(mount.logicalPrefix)) return ''
    const prefix = `${mount.logicalPrefix}/`
    return fold(logicalId).startsWith(fold(prefix)) ? logicalId.slice(prefix.length) : undefined
  }
  const findEntries = async (
    mount: IndexedMount,
    logicalPrefix: string,
    signal?: AbortSignal,
  ): Promise<readonly CompanionOriginEntry[]> => {
    throwIfAborted(signal)
    const relativePrefix = relativeRequest(mount, logicalPrefix)
    if (relativePrefix === undefined) return Object.freeze([])
    const parent = relativePrefix.slice(0, relativePrefix.lastIndexOf('/') + 1).replace(/\/$/u, '')
    let entries: readonly ContentSourceEntry[]
    try {
      entries = await contentSources.list(mount.sourceId, joinPath(mount.sourcePath, parent))
    } catch {
      return Object.freeze([])
    }
    const output: CompanionOriginEntry[] = []
    for (const entry of entries) {
      throwIfAborted(signal)
      if (entry.directory) continue
      const relative = relativeEntry(mount, entry)
      if (relative === undefined || !fold(relative).startsWith(fold(relativePrefix))) continue
      const logicalId = joinPath(mount.logicalPrefix, relative)
      locations.set(fold(logicalId), mount)
      output.push(
        Object.freeze({
          logicalId,
          ...(entry.size === undefined ? {} : { size: BigInt(entry.size) }),
        }),
      )
    }
    return Object.freeze(output)
  }
  return Object.freeze({
    primaryLogicalId: '__content_dependency_workspace__',
    caseSensitivity: 'insensitive',
    scopes: DEPENDENCY_SCOPE,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ) {
      if (scope !== 'workspace-dependency-layer') return
      const prefix =
        enumeration.prefix === '' ? '' : normalizeCompanionLogicalId(enumeration.prefix)
      const emitted = new Set<string>()
      for (const mount of overlay) {
        const rootScoped = relativeRequest(mount, prefix) !== undefined
        const query = rootScoped ? prefix : joinPath(mount.logicalPrefix, prefix)
        for (const entry of await findEntries(mount, query, signal)) {
          const key = fold(entry.logicalId)
          if (emitted.has(key)) continue
          emitted.add(key)
          yield entry
        }
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      const normalized = normalizeCompanionLogicalId(logicalId)
      let mount = locations.get(fold(normalized))
      if (mount === undefined) {
        for (const candidate of overlay) {
          if (
            (await findEntries(candidate, normalized, signal)).some(
              entry => fold(entry.logicalId) === fold(normalized),
            )
          ) {
            mount = candidate
            break
          }
        }
      }
      if (mount === undefined) throw new RangeError(`content dependency has no entry ${normalized}`)
      const relative = relativeRequest(mount, normalized)
      if (relative === undefined || relative === '')
        throw new RangeError(`content dependency has no file ${normalized}`)
      const bytes = await contentSources.read(
        mount.sourceId,
        joinPath(mount.sourcePath, relative),
        maximumEntryBytes,
      )
      const uri = `content-source://${encodeURIComponent(mount.sourceId)}/${normalized.split('/').map(encodeURIComponent).join('/')}`
      const source: ArtifactByteSource = Object.freeze({
        kind: 'bytes',
        ref: Object.freeze({ id: `${mount.rootId}:${normalized}`, uri }),
        revision: mount.revision,
        size: BigInt(bytes.byteLength),
        async read(offset: bigint, length: number, readSignal?: AbortSignal) {
          throwIfAborted(readSignal)
          if (
            offset < 0n ||
            offset > BigInt(bytes.byteLength) ||
            !Number.isSafeInteger(length) ||
            length < 0
          ) {
            throw new RangeError('invalid content dependency byte range')
          }
          const start = Number(offset)
          return bytes.slice(start, Math.min(bytes.byteLength, start + length))
        },
        async *stream(
          range?: { readonly offset: bigint; readonly length?: bigint },
          streamSignal?: AbortSignal,
        ) {
          throwIfAborted(streamSignal)
          const start = range === undefined ? 0 : Number(range.offset)
          const end =
            range?.length === undefined
              ? bytes.byteLength
              : Math.min(bytes.byteLength, start + Number(range.length))
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start
          ) {
            throw new RangeError('invalid content dependency stream range')
          }
          for (let offset = start; offset < end; offset += 64 * 1024) {
            throwIfAborted(streamSignal)
            yield bytes.slice(offset, Math.min(end, offset + 64 * 1024))
          }
        },
      })
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}

/**
 * Project a provider-resolved dependency closure into protocol-neutral language documents.
 *
 * The adapter only uses ContentSources, so loose directories, MPQ and CASC mounts share the same
 * path. Physical cache paths and credentials remain in the provider, while virtual URIs preserve
 * dependency load order and revision identity. Extension-only routing is admitted only when the
 * extension identifies one language across the whole active inventory.
 */
export function createContentDependencyLanguageDocumentSource(
  options: ContentDependencyLanguageDocumentSourceOptions,
): LanguageWorkspaceDocumentSource {
  const mounts = validateMounts(options.resolution)
  const maxDocumentBytes = options.maxDocumentBytes ?? 4_194_304
  const maxWorkspaceBytes = options.maxWorkspaceBytes ?? 16_777_216
  const maxEntries = options.maxEntries ?? 16_384
  for (const [name, value] of Object.entries({ maxDocumentBytes, maxWorkspaceBytes, maxEntries })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`)
  }
  if (maxDocumentBytes > maxWorkspaceBytes) {
    throw new TypeError('maxDocumentBytes cannot exceed maxWorkspaceBytes')
  }
  const languageIdsByExtension = new Map<string, Set<string>>()
  for (const route of options.routes) {
    if (route.extension === undefined) continue
    const ids = languageIdsByExtension.get(route.extension) ?? new Set<string>()
    ids.add(route.languageId)
    languageIdsByExtension.set(route.extension, ids)
  }
  const uniqueLanguageByExtension = new Map<string, string>()
  for (const [extension, ids] of languageIdsByExtension) {
    if (ids.size === 1) uniqueLanguageByExtension.set(extension, [...ids][0]!)
  }
  const revisions = new Map<string, { readonly signature: string; readonly version: number }>()
  return Object.freeze({
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      request.signal.throwIfAborted()
      const accepted = new Set(request.workspaceLanguageIds)
      const openUris = new Set(request.workspaceDocuments.map(document => document.uri))
      const candidates: {
        readonly mount: IndexedMount
        readonly path: string
        readonly relative: string
      }[] = []
      let visited = 0
      let complete = options.resolution.complete
      const walk = async (mount: IndexedMount, path: string): Promise<void> => {
        if (candidates.length > request.maxDocuments || visited > maxEntries) return
        request.signal.throwIfAborted()
        let entries: readonly ContentSourceEntry[]
        try {
          entries = await options.contentSources.list(mount.sourceId, path)
        } catch {
          complete = false
          return
        }
        for (const entry of entries) {
          request.signal.throwIfAborted()
          visited += 1
          if (visited > maxEntries) {
            complete = false
            return
          }
          const relative = relativeEntry(mount, entry)
          if (relative === undefined) {
            complete = false
            continue
          }
          if (entry.directory) {
            await walk(mount, entry.path)
            continue
          }
          const extension = relative.slice(relative.lastIndexOf('.') + 1).toLowerCase()
          const languageId = uniqueLanguageByExtension.get(extension)
          if (languageId === undefined) {
            if ([...(languageIdsByExtension.get(extension) ?? [])].some(id => accepted.has(id))) {
              complete = false
            }
            continue
          }
          if (!accepted.has(languageId)) continue
          const logicalId = joinPath(mount.logicalPrefix, relative)
          const uri = `content-source://${encodeURIComponent(mount.sourceId)}/${logicalId.split('/').map(encodeURIComponent).join('/')}`
          if (!openUris.has(uri)) candidates.push({ mount, path: entry.path, relative })
          if (candidates.length > request.maxDocuments) {
            complete = false
            return
          }
        }
      }
      for (const mount of mounts) {
        if (candidates.length > request.maxDocuments || visited > maxEntries) break
        await walk(mount, mount.sourcePath)
      }
      const documents = []
      let totalBytes = 0
      for (const candidate of candidates.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const extension = candidate.relative
          .slice(candidate.relative.lastIndexOf('.') + 1)
          .toLowerCase()
        const languageId = uniqueLanguageByExtension.get(extension)!
        let bytes: Uint8Array
        try {
          bytes = await options.contentSources.read(
            candidate.mount.sourceId,
            candidate.path,
            Math.min(maxDocumentBytes, maxWorkspaceBytes - totalBytes),
          )
        } catch {
          complete = false
          continue
        }
        if (
          bytes.byteLength > maxDocumentBytes ||
          totalBytes + bytes.byteLength > maxWorkspaceBytes
        ) {
          complete = false
          continue
        }
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          complete = false
          continue
        }
        totalBytes += bytes.byteLength
        const logicalId = joinPath(candidate.mount.logicalPrefix, candidate.relative)
        const uri = `content-source://${encodeURIComponent(candidate.mount.sourceId)}/${logicalId.split('/').map(encodeURIComponent).join('/')}`
        const signature = String(candidate.mount.revision)
        const previous = revisions.get(uri)
        const version =
          previous === undefined
            ? 1
            : previous.signature === signature
              ? previous.version
              : previous.version + 1
        revisions.set(uri, { signature, version })
        documents.push(Object.freeze({ uri, languageId, version, text }))
      }
      return Object.freeze({ documents: Object.freeze(documents), isComplete: complete })
    },
  })
}

/** Bind provider-resolved content roots to a read-only workspace and revision-pinned resource port. */
export function createReadOnlyContentDependencyWorkspace(
  options: ReadOnlyContentDependencyWorkspaceOptions,
): ReadOnlyContentDependencyWorkspace {
  throwIfAborted(options.signal)
  const maximumEntryBytes = options.maximumEntryBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(maximumEntryBytes) || maximumEntryBytes <= 0) {
    throw new TypeError('maximumEntryBytes must be a positive safe integer')
  }
  const mounts = validateMounts(options.resolution)
  const roots: readonly ModWorkspaceGraphRoot[] = Object.freeze(
    mounts.map(mount =>
      Object.freeze({
        rootId: mount.rootId,
        sourceId: mount.sourceId,
        sourcePath: mount.logicalPrefix,
        displayName: mount.displayName,
        kind: mount.kind,
        ...(mount.fingerprint === undefined ? {} : { fingerprint: mount.fingerprint }),
        dependencies: Object.freeze([]),
      }),
    ),
  )
  const active = roots.at(-1)!
  const sources = [...new Set(roots.map(root => root.sourceId))].map(sourceId =>
    Object.freeze({
      sourceId,
      kind: 'content-source',
      location: `content-source:${sourceId}`,
    }),
  )
  const workspace: ModWorkspaceLock = Object.freeze({
    schemaVersion: 1,
    workspaceId: nonEmpty(options.workspaceId, 'workspaceId'),
    gameId: options.resolution.gameId,
    // This is the read-only overlay head required by ModWorkspaceLock; no writable root is granted.
    activeRootId: active.rootId,
    sources: Object.freeze(sources),
    loadOrder: roots,
    dependencyOrder: Object.freeze(roots.slice(0, -1)),
    logicalRoots: Object.freeze([...roots].reverse()),
    diagnostics: Object.freeze(options.resolution.diagnostics.map(workspaceDiagnostic)),
    complete: options.resolution.complete,
  })
  const sessionRevision = revisionIdFromRef({
    kind: 'provider-token',
    value: mounts.map(mount => `${mount.rootId}@${mount.revision}`).join('|'),
  })
  const resources = createResourceSession({
    origin: createContentDependencyOrigin(options.contentSources, mounts, maximumEntryBytes),
    revision: sessionRevision,
    revisionPolicy: 'pin',
    ...(options.resourceLimits === undefined ? {} : { limits: options.resourceLimits }),
  })
  return Object.freeze({
    workspace,
    resources,
    dispose: () => resources.dispose(),
  })
}

/** Resolve a dependency set through the configured content provider and run normal resolved Data. */
export async function analyzeReadOnlyContentDependencies(
  options: AnalyzeReadOnlyContentDependenciesRequest,
): Promise<AnalyzedResolvedDataWorkspace> {
  throwIfAborted(options.signal)
  const resolve = options.contentSources.resolveDependencies
  if (resolve === undefined) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'x3.host/content-dependency-resolver-unavailable',
          'the configured content source cannot resolve this dependency set',
        ),
      ]),
    })
  }
  let resolution: ContentDependencyResolution
  try {
    resolution = await resolve.call(options.contentSources, options.dependencies)
  } catch (error) {
    options.signal?.throwIfAborted()
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'warning',
          'x3.host/content-dependency-resolution-failed',
          error instanceof Error ? error.message : String(error),
        ),
      ]),
    })
  }
  const dependencyDiagnostics = contentDependencyDiagnostics(resolution.diagnostics)
  if (!resolution.complete || resolution.mounts.length === 0) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics:
        dependencyDiagnostics.length > 0
          ? dependencyDiagnostics
          : Object.freeze([
              diagnostic(
                'warning',
                'x3.host/content-dependency-workspace-incomplete',
                'the content dependency set did not resolve to a complete workspace',
              ),
            ]),
    })
  }
  let prepared: ReadOnlyContentDependencyWorkspace
  try {
    prepared = createReadOnlyContentDependencyWorkspace({
      contentSources: options.contentSources,
      resolution,
      workspaceId: options.workspaceId,
      ...(options.maximumEntryBytes === undefined
        ? {}
        : { maximumEntryBytes: options.maximumEntryBytes }),
      ...(options.resourceLimits === undefined ? {} : { resourceLimits: options.resourceLimits }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...dependencyDiagnostics,
        diagnostic(
          'warning',
          'x3.host/content-dependency-workspace-invalid',
          error instanceof Error ? error.message : String(error),
        ),
      ]),
    })
  }
  const analysis = await analyzeResolvedDataWorkspace({
    services: options.services,
    grant: options.grant,
    budgets: options.budgets,
    workspace: prepared.workspace,
    resources: prepared.resources,
    locales: options.locales,
    queries: options.queries,
    ...(options.localizationKeys === undefined
      ? {}
      : { localizationKeys: options.localizationKeys }),
    limits: options.limits,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (analysis.state === 'unresolved') {
    await prepared.dispose()
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([...dependencyDiagnostics, ...analysis.diagnostics]),
    })
  }
  let released = false
  return Object.freeze({
    ...analysis,
    diagnostics: Object.freeze([...dependencyDiagnostics, ...analysis.diagnostics]),
    async release() {
      if (released) return
      released = true
      const results = await Promise.allSettled([analysis.release(), prepared.dispose()])
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    },
  })
}
