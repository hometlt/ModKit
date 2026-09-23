/**
 * Map preview resources through the product's content sources: a map is opened like a mod.
 *
 * The configured content sources open the map inside its mods (`openModContext`) — an installation
 * folder, the game's CASC storage, a player's own folders — and every layer of the preview reads
 * through those layers. Nothing here knows a game: the preparation provider still names the
 * workspace roots, and a root is backed by the mount at the same package path.
 */

import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  revisionIdFromRef,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type RevisionId,
} from '@modkit/sdk'
import {
  MOD_CONTEXT_MAX_QUERY_REFS,
  type ContentDependencyMount,
  type ContentDependencyResolution,
  type ContentSourceEntry,
  type ContentSources,
  type ModContext,
} from '@modkit/vfs/content-sources'
import type { DataEntityRef, DataResolvedEntity } from '@modkit/sdk'
import { entryRevision as contentDependencyMountRevision } from '../content-dependencies.js'
import { resolveSubjectClosure } from '../content-dependency-operations.js'
import type {
  MapCatalogEntities,
  MapPreviewResourcePlanResolution,
  MapPreviewResourcePlanResolver,
  ResolveMapPreviewResourcePlanRequest,
} from '../maps/index.js'
import {
  createCompositeWorkspaceNamespaceCompanionOrigin,
  type CompositeWorkspaceNamespaceRoot,
} from '../namespace-origin.js'
import { namespaceMount } from './map-preview-resource-resolver.js'

export interface ContentSourceMapPreviewResourcePlanResolverOptions {
  /** The product's source catalogue, or undefined when none is configured. */
  readonly contentSources: () => Promise<ContentSources | undefined>
  /** Answers a subject that names no dependencies, or a catalogue that cannot resolve them. */
  readonly fallback?: MapPreviewResourcePlanResolver
  readonly maximumEntryBytes?: number
  /** Entries one listing may walk below a mount; a larger subtree is refused, not truncated. */
  readonly maximumListingEntries?: number
}

/** The context's `data.entities` query, a bounded batch at a time; undefined if it has none. */
function contextCatalogEntities(context: ModContext): MapCatalogEntities | undefined {
  const query = context.query?.bind(context)
  if (query === undefined) return undefined
  return async (refs: readonly DataEntityRef[], signal?: AbortSignal) => {
    const entities: DataResolvedEntity[] = []
    for (let start = 0; start < refs.length; start += MOD_CONTEXT_MAX_QUERY_REFS) {
      const answer = (await query(
        { kind: 'data.entities', refs: refs.slice(start, start + MOD_CONTEXT_MAX_QUERY_REFS) },
        signal,
      )) as { readonly entities?: unknown } | undefined
      if (!Array.isArray(answer?.entities)) throw new TypeError('data.entities answered no entity list')
      for (const entity of answer.entities as readonly Partial<DataResolvedEntity>[]) {
        if (typeof entity?.namespace === 'string' && typeof entity.entityId === 'string') {
          entities.push(entity as DataResolvedEntity)
        }
      }
    }
    return entities
  }
}

const fold = (value: string): string => value.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '').toLowerCase()

/** One resolved mount as the namespace a workspace root reads: flat listings, bytes on extract. */
function mountNamespace(
  sources: ContentSources,
  mount: ContentDependencyMount,
  revision: RevisionId,
  limits: { readonly maximumEntryBytes: number; readonly maximumListingEntries: number },
): Pick<CompositeWorkspaceNamespaceRoot, 'namespace' | 'extract'> {
  /*
   * Each directory is listed once and kept sorted by folded path (a directory with its `/`), so a
   * file lookup is a binary search: a model asks for thousands of textures out of one directory.
   * ponytail: kept for the life of the preview, unbounded; evict if a session walks whole packages.
   */
  const directories = new Map<string, Promise<{ keys: readonly string[]; items: readonly ContentSourceEntry[] }>>()
  const directory = (path: string) => {
    const key = fold(path)
    let listed = directories.get(key)
    if (listed === undefined) {
      listed = sources.list(mount.sourceId, path).then(items => {
        const keyed = items.map(item => [`${fold(item.path)}${item.directory ? '/' : ''}`, item] as const)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        return { keys: keyed.map(([folded]) => folded), items: keyed.map(([, item]) => item) }
      })
      listed.catch(() => directories.delete(key))
      directories.set(key, listed)
    }
    return listed
  }
  const listings = new Map<string, Promise<readonly NamespaceEntry[]>>()
  const flat = async (prefix: string): Promise<readonly NamespaceEntry[]> => {
    // A trailing slash asks for a directory's contents and nothing that merely shares its name.
    const wanted = fold(prefix) + (/[\\/]$/u.test(prefix) && fold(prefix) !== '' ? '/' : '')
    const parent = fold(prefix).includes('/') ? prefix.replace(/[\\/]+$/u, '').replace(/[\\/][^\\/]*$/u, '') : ''
    const output: NamespaceEntry[] = []
    const add = (item: ContentSourceEntry) => {
      if (output.length >= limits.maximumListingEntries) {
        throw new RangeError(`${mount.displayName} lists more than ${limits.maximumListingEntries} entries below ${prefix}`)
      }
      output.push(Object.freeze({
        id: item.path, path: item.path, name: item.name, kind: 'file' as const, revision,
        ...(item.size === undefined ? {} : { size: BigInt(item.size) }),
      }))
    }
    const walk = async (path: string): Promise<void> => {
      for (const item of (await directory(path)).items) {
        if (item.directory) await walk(item.path)
        else add(item)
      }
    }
    let siblings
    try {
      siblings = await directory(parent)
    } catch {
      return Object.freeze([]) // a directory the mount does not have holds nothing
    }
    // A flat listing answers every path that starts with the prefix, the prefix itself included.
    let low = 0
    for (let high = siblings.keys.length; low < high;) {
      const middle = (low + high) >>> 1
      if (siblings.keys[middle]! < wanted) low = middle + 1
      else high = middle
    }
    for (let at = low; at < siblings.keys.length && siblings.keys[at]!.startsWith(wanted); at++) {
      const item = siblings.items[at]!
      if (item.directory) await walk(item.path)
      else add(item)
    }
    return Object.freeze(output)
  }
  return {
    namespace: Object.freeze({
      async list(prefix, page, signal) {
        signal?.throwIfAborted()
        const key = fold(prefix)
        let listing = listings.get(key)
        if (listing === undefined) {
          listing = flat(prefix)
          listings.set(key, listing)
          listing.catch(() => listings.delete(key))
          // ponytail: whole-listing memo per prefix, bounded by count; an LRU if maps grow past it
          if (listings.size > 4096) listings.delete(listings.keys().next().value!)
        }
        const items = await listing
        const start = page.cursor === undefined ? 0 : Number(page.cursor)
        if (!Number.isSafeInteger(start) || start < 0 || start > items.length) {
          throw new RangeError('content source listing cursor is invalid')
        }
        const end = Math.min(items.length, start + page.limit)
        return Object.freeze({
          items: Object.freeze(items.slice(start, end)),
          ...(end < items.length ? { nextCursor: String(end) } : {}),
        })
      },
      async openEntry(entryId) {
        const uri = `content-source://${encodeURIComponent(mount.sourceId)}/${entryId.split('/').map(encodeURIComponent).join('/')}`
        return Object.freeze({
          value: Object.freeze({ id: `${mount.dependencyId}:${entryId}`, uri }),
          release: async () => undefined,
        })
      },
    } satisfies NamespaceEntrySource),
    extract: (entryId, signal) => {
      signal?.throwIfAborted()
      return sources.read(mount.sourceId, entryId, limits.maximumEntryBytes)
    },
  }
}

export function createContentSourceMapPreviewResourcePlanResolver(
  options: ContentSourceMapPreviewResourcePlanResolverOptions,
): MapPreviewResourcePlanResolver {
  const limits = Object.freeze({
    maximumEntryBytes: options.maximumEntryBytes ?? 64 * 1024 * 1024,
    maximumListingEntries: options.maximumListingEntries ?? 262_144,
  })
  const fallback = async (
    request: ResolveMapPreviewResourcePlanRequest,
    findings: readonly Diagnostic[],
  ): Promise<MapPreviewResourcePlanResolution> => {
    if (options.fallback === undefined) {
      return Object.freeze({
        state: 'unresolved' as const,
        diagnostics: Object.freeze([...findings, diagnostic('error',
          'x3.host/map-preview-content-sources-unavailable',
          'map dependencies could not be resolved through the configured content sources')]),
      })
    }
    const answer = await options.fallback.resolve(request)
    return Object.freeze({ ...answer, diagnostics: Object.freeze([...findings, ...answer.diagnostics]) })
  }

  return Object.freeze({
    async resolve(request: ResolveMapPreviewResourcePlanRequest): Promise<MapPreviewResourcePlanResolution> {
      request.signal?.throwIfAborted()
      const descriptor = await request.original.descriptor()
      if (
        String(descriptor.revision) !== request.subject.revision ||
        descriptor.subjectUri !== request.subject.subjectUri
      ) {
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([diagnostic('error', 'x3.host/map-preview-subject-snapshot-mismatch',
            'the opened subject no longer matches the prepared subject snapshot')]),
        })
      }
      const sources = await options.contentSources().catch(() => undefined)
      if (sources === undefined) {
        return fallback(request, [diagnostic('information',
          'x3.host/content-dependency-resolver-unavailable',
          'no content source is configured to resolve map dependencies')])
      }
      const closure = await resolveSubjectClosure({
        contentSources: sources,
        subject: { descriptor },
        keepContext: true,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      // The map's context stays open for the preview's life: its catalog answers the map world.
      const context = closure.context
      const releaseContext = async () => {
        await context?.dispose()
      }
      if (closure.resolution === undefined) {
        await releaseContext()
        return fallback(request, closure.diagnostics)
      }
      try {
        request.signal?.throwIfAborted()
      } catch (error) {
        await releaseContext()
        throw error
      }
      const catalogEntities = context === undefined ? undefined : contextCatalogEntities(context)
      const resolution: ContentDependencyResolution = closure.resolution
      const findings: Diagnostic[] = [...closure.diagnostics]

      const sourcePathOf = (rootId: string) =>
        request.workspace.loadOrder.find(root => root.rootId === rootId)?.sourcePath
      const mountsByPath = new Map(resolution.mounts.map(mount => [fold(mount.sourcePath), mount] as const))
      // Sources that mount none of the map's layers (no installation configured, say) would open a
      // bare map; the fallback can still find the game on its own.
      if (request.plan.roots.length > 0 && !request.plan.roots.some(root =>
        mountsByPath.has(fold(sourcePathOf(root.rootId) ?? root.rootId)))) {
        await releaseContext()
        return fallback(request, [...findings, diagnostic('information',
          'x3.host/map-preview-content-sources-empty',
          'the configured content sources mounted none of the map dependencies')])
      }

      let subject: Awaited<ReturnType<typeof namespaceMount>> | undefined
      const rootsById = new Map<string, CompositeWorkspaceNamespaceRoot>()
      try {
        if (request.plan.subjectNamespaceRoots.length > 0) {
          subject = await namespaceMount(request.original)
          for (const root of request.plan.subjectNamespaceRoots) {
            rootsById.set(root.rootId, Object.freeze({
              rootId: root.rootId,
              pathPrefix: root.namespacePrefix,
              logicalPrefix: sourcePathOf(root.rootId) ?? root.rootId,
              namespace: subject.namespace,
              containerRevision: descriptor.revision,
              extract: subject.extract,
            }))
          }
        }
      } catch (error) {
        await subject?.namespaceRelease()
        await releaseContext()
        return Object.freeze({
          state: 'unresolved' as const,
          diagnostics: Object.freeze([...findings, diagnostic('error',
            'x3.host/map-preview-subject-namespace-unavailable',
            error instanceof Error ? error.message : String(error))]),
        })
      }

      // A workspace root reads the mount of the same package; one the sources did not find is empty.
      const used = new Set<ContentDependencyMount>()
      const empty: NamespaceEntrySource = Object.freeze({
        list: async () => Object.freeze({ items: Object.freeze([]) }),
        openEntry: async (entryId: string) => {
          throw new RangeError(`no content source holds ${entryId}`)
        },
      })
      for (const root of request.plan.roots) {
        const logicalPrefix = sourcePathOf(root.rootId) ?? root.rootId
        const mount = mountsByPath.get(fold(logicalPrefix))
        if (mount === undefined) {
          findings.push(diagnostic('warning', 'x3.host/map-preview-content-dependency-unmounted',
            `${logicalPrefix} was not found in any configured content source`))
          rootsById.set(root.rootId, Object.freeze({
            rootId: root.rootId, pathPrefix: '', logicalPrefix, namespace: empty,
            containerRevision: revisionIdFromRef({ kind: 'provider-token', value: `unmounted\0${logicalPrefix}` }),
            extract: async () => { throw new RangeError(`${logicalPrefix} is not mounted`) },
          }))
          continue
        }
        used.add(mount)
        const revision = contentDependencyMountRevision(mount)
        rootsById.set(root.rootId, Object.freeze({
          rootId: root.rootId, pathPrefix: mount.sourcePath, logicalPrefix,
          containerRevision: revision,
          ...mountNamespace(sources, mount, revision, limits),
        }))
      }
      // Strongest first: the map, then the workspace from the top down, then any layer the sources
      // found beneath a dependency that the preparation did not name (its assets still resolve).
      const originRoots = [
        ...(request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse())
          .flatMap(root => rootsById.get(root.rootId) ?? []),
        ...[...resolution.mounts].sort((left, right) => right.order - left.order)
          .filter(mount => !used.has(mount))
          .map(mount => {
            const revision = contentDependencyMountRevision(mount)
            return Object.freeze({
              rootId: `content-dependency:${mount.dependencyId}`, pathPrefix: mount.sourcePath,
              logicalPrefix: fold(mount.sourcePath), containerRevision: revision,
              ...mountNamespace(sources, mount, revision, limits),
            })
          }),
      ]
      const primaryLogicalId =
        sourcePathOf(request.workspace.activeRootId) ?? request.workspace.activeRootId
      findings.push(diagnostic('information', 'x3.host/map-preview-content-sources-selected',
        `map layers resolved through content sources: ${resolution.mounts
          .map(mount => `${mount.displayName} (${mount.sourceId})`).join(', ') || 'none'}`))
      return Object.freeze({
        state: 'resolved' as const,
        origin: createCompositeWorkspaceNamespaceCompanionOrigin({ primaryLogicalId, roots: originRoots }),
        revision: revisionIdFromRef({
          kind: 'provider-token',
          value: JSON.stringify(originRoots.map(root => [root.rootId, String(root.containerRevision)])),
        }),
        ...(catalogEntities === undefined ? {} : { catalogEntities }),
        diagnostics: Object.freeze(findings),
        release: async () => {
          await Promise.allSettled([subject?.namespaceRelease(), releaseContext()])
        },
      })
    },
  })
}
