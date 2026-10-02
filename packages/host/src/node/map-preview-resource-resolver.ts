/** Node-only resolver for generic installed-game archive locators in map-preview plans. */

import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  diagnostic,
  type Diagnostic,
} from '@modkit/core'
import {
  revisionIdFromRef,
  type ArtifactNamespaceSource,
  type AssetSession,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type PermissionGrant,
  type RevisionId,
} from '@modkit/sdk'
import type { GameInstallation } from '@modkit/sdk/games'
import type { MapPreviewHostResourceRoot } from '@modkit/sdk/maps'
import { VirtualFileSystem } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import { discoverGameInstallations } from '../games/index.js'
import {
  createCompositeWorkspaceNamespaceCompanionOrigin,
  storedEntrySource,
  type CompositeWorkspaceNamespaceRoot,
  type StoredSourceOpener,
} from '../namespace-origin.js'
import { openSubject } from '../subject-open.js'
import type {
  MapPreviewResourcePlanResolution,
  MapPreviewResourcePlanResolver,
  ResolveMapPreviewResourcePlanRequest,
} from '../maps/index.js'
import type { SubjectServices } from '../subject-services.js'
import { artifactNamespaceSourceFromVfsMount } from '../vfs-source.js'
import { openFileArtifactSource } from './file-artifact-source.js'
import { createFilesystemInputResolver } from './subject-opener.js'

/** One installed archive shared by the concurrent passes of a single map open. */
interface SharedArchive {
  readonly mount: NamespaceMount
  readonly close: () => Promise<void>
}

/** A named refusal from the shared opening, carried to whichever pass awaited it. */
class ArchiveOpenFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: readonly Diagnostic[] = [],
  ) {
    super(message)
    this.name = 'ArchiveOpenFailure'
  }
}

const LOCATOR_KIND = 'game-installation-archive'
const SUBJECT_LOCATOR_KIND = 'game-installation-subject'
/** The files beside a map that is one file on disk (DN7: a Dune 2000 map's `_A1V1.MIS`). */
const SIBLINGS_LOCATOR_KIND = 'subject-siblings'
export const NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID =
  'modkit.node/game-installation-archive-map-preview'
export const NODE_GAME_INSTALLATION_RESOURCE_MAP_PREVIEW_RESOLVER_ID =
  'modkit.node/game-installation-resource-map-preview'
const LOCATOR_KEYS = new Set([
  'schemaVersion',
  'kind',
  'gameId',
  'archiveRelativePaths',
  'openedSubjectPolicy',
])
const SUBJECT_LOCATOR_KEYS = new Set([
  'schemaVersion',
  'kind',
  'gameId',
  'relativePaths',
  'namespaceFallbackPrefix',
  'openedSubjectPolicy',
])
const MAXIMUM_ARCHIVE_PATHS = 16
const MAXIMUM_LOGICAL_PATH_CHARS = 4096

type OpenedSubjectPolicy = 'installation-only' | 'prefer-matching-opened-subject'

interface GameInstallationArchiveLocator {
  readonly schemaVersion: 1
  readonly kind: typeof LOCATOR_KIND
  readonly gameId: string
  /** Exact alternatives for known installation layouts; more than one existing match is ambiguous. */
  readonly archiveRelativePaths: readonly string[]
  readonly openedSubjectPolicy: OpenedSubjectPolicy
}

interface GameInstallationSubjectLocator {
  readonly schemaVersion: 1
  readonly kind: typeof SUBJECT_LOCATOR_KIND
  readonly gameId: string
  /** Exact loose directory or packed-file alternatives below the confirmed installation root. */
  readonly relativePaths: readonly string[]
  /** When exact alternatives are absent, open the installation namespace at this prefix. */
  readonly namespaceFallbackPrefix?: string
  readonly openedSubjectPolicy: OpenedSubjectPolicy
}

/** The folder of the opened map file, read by the host as a plain folder. */
interface SubjectSiblingsLocator {
  readonly schemaVersion: 1
  readonly kind: typeof SIBLINGS_LOCATOR_KIND
  readonly gameId: string
}

type GameInstallationResourceLocator =
  GameInstallationArchiveLocator | GameInstallationSubjectLocator | SubjectSiblingsLocator

export interface NamespaceMount {
  /** The container's session; absent for a plain folder read by the host itself. */
  readonly session?: AssetSession
  readonly namespace: NamespaceEntrySource
  readonly namespaceRelease: () => Promise<void>
  readonly revision: RevisionId
  readonly extract: (entryId: string, signal?: AbortSignal) => Promise<Uint8Array>
  /** The container's bytes, of which its uncompressed entries are ranges. */
  readonly openStoredSource?: StoredSourceOpener
}

export interface NodeMapPreviewResourcePlanResolverOptions {
  /** Ordinary subject services; archive format selection remains inventory-owned. */
  readonly subjects: Pick<SubjectServices, 'open'> &
    Partial<
      Pick<
        SubjectServices,
        'inventory' | 'target' | 'executionBackends' | 'serviceDefinitions' | 'contributionSettings'
      >
    >
  /** User/app settings, keyed by the same extension-owned game id used for discovery routing. */
  readonly configuredPaths?: Readonly<Record<string, readonly string[]>>
  /**
   * The folders the host's folder search found for a game (`searchInstallationFolders`); its
   * provider confirms them after its own probes, as any installation discovery does.
   */
  readonly searchPaths?: (
    gameId: string,
  ) => readonly string[] | undefined | Promise<readonly string[] | undefined>
  /*
   * Installation discovery is a filesystem/registry probe, not a subject read, so it needs its own
   * narrow grant: a map opened with `read-source` alone made every discovery provider reject with
   * `permission-required` and the preview fell back to the archive entry list. Only the discovery
   * call receives it; installed archives are still opened under the caller's subject grant.
   */
  readonly installationDiscoveryGrant?: PermissionGrant
  /**
   * How long a finished installation mount is kept after its last holder released it, so the
   * sequential passes of one map open share it. 0 closes it immediately. Default 60000.
   */
  readonly installationRetentionMs?: number
  readonly maxInstallationCandidates?: number
  readonly pageLimit?: number
  readonly maxPages?: number
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function confinedRelativePath(value: unknown, label: string): string {
  if (!nonEmptyString(value) || value.length > MAXIMUM_LOGICAL_PATH_CHARS || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty confined path`)
  }
  const normalized = value.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) {
    throw new TypeError(`${label} must be relative`)
  }
  const parts: string[] = []
  for (const part of normalized.split('/')) {
    if (part.length === 0 || part === '.') continue
    if (part === '..') throw new TypeError(`${label} must not escape the installation`)
    parts.push(part)
  }
  if (parts.length === 0) throw new TypeError(`${label} must name an archive`)
  return parts.join('/')
}

function parseLocator(root: MapPreviewHostResourceRoot): GameInstallationArchiveLocator {
  const value = recordOf(root.locator)
  if (
    value === undefined ||
    Object.keys(value).some(key => !LOCATOR_KEYS.has(key)) ||
    value['schemaVersion'] !== 1 ||
    value['kind'] !== LOCATOR_KIND ||
    !nonEmptyString(value['gameId']) ||
    !Array.isArray(value['archiveRelativePaths']) ||
    value['archiveRelativePaths'].length === 0 ||
    value['archiveRelativePaths'].length > MAXIMUM_ARCHIVE_PATHS ||
    !['installation-only', 'prefer-matching-opened-subject'].includes(
      String(value['openedSubjectPolicy']),
    )
  ) {
    throw new TypeError(`resource root ${root.rootId} has an invalid ${LOCATOR_KIND} locator`)
  }
  const archiveRelativePaths = value['archiveRelativePaths'].map((item, index) =>
    confinedRelativePath(item, `${root.rootId}.archiveRelativePaths[${index}]`),
  )
  const folded = archiveRelativePaths.map(item =>
    process.platform === 'win32' ? item.toLowerCase() : item,
  )
  if (new Set(folded).size !== folded.length) {
    throw new TypeError(`resource root ${root.rootId} archive paths must be unique`)
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: LOCATOR_KIND,
    gameId: value['gameId'],
    archiveRelativePaths: Object.freeze(archiveRelativePaths),
    openedSubjectPolicy: value['openedSubjectPolicy'] as OpenedSubjectPolicy,
  })
}

function parseSubjectLocator(root: MapPreviewHostResourceRoot): GameInstallationSubjectLocator {
  const value = recordOf(root.locator)
  if (
    value === undefined ||
    Object.keys(value).some(key => !SUBJECT_LOCATOR_KEYS.has(key)) ||
    value['schemaVersion'] !== 1 ||
    value['kind'] !== SUBJECT_LOCATOR_KIND ||
    !nonEmptyString(value['gameId']) ||
    !Array.isArray(value['relativePaths']) ||
    value['relativePaths'].length === 0 ||
    value['relativePaths'].length > MAXIMUM_ARCHIVE_PATHS ||
    // '' is the whole installation namespace, as an empty data root is its whole source
    (value['namespaceFallbackPrefix'] !== undefined &&
      value['namespaceFallbackPrefix'] !== '' &&
      !nonEmptyString(value['namespaceFallbackPrefix'])) ||
    !['installation-only', 'prefer-matching-opened-subject'].includes(
      String(value['openedSubjectPolicy']),
    )
  ) {
    throw new TypeError(
      `resource root ${root.rootId} has an invalid ${SUBJECT_LOCATOR_KIND} locator`,
    )
  }
  const relativePaths = value['relativePaths'].map((item, index) =>
    confinedRelativePath(item, `${root.rootId}.relativePaths[${index}]`),
  )
  const folded = relativePaths.map(item =>
    process.platform === 'win32' ? item.toLowerCase() : item,
  )
  if (new Set(folded).size !== folded.length) {
    throw new TypeError(`resource root ${root.rootId} subject paths must be unique`)
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: SUBJECT_LOCATOR_KIND,
    gameId: value['gameId'],
    relativePaths: Object.freeze(relativePaths),
    ...(value['namespaceFallbackPrefix'] === undefined
      ? {}
      : {
          namespaceFallbackPrefix:
            value['namespaceFallbackPrefix'] === ''
              ? ''
              : confinedRelativePath(
                  value['namespaceFallbackPrefix'],
                  `${root.rootId}.namespaceFallbackPrefix`,
                ),
        }),
    openedSubjectPolicy: value['openedSubjectPolicy'] as OpenedSubjectPolicy,
  })
}

function parseResourceLocator(root: MapPreviewHostResourceRoot): GameInstallationResourceLocator {
  const kind = recordOf(root.locator)?.['kind']
  if (kind === SIBLINGS_LOCATOR_KIND) {
    const value = recordOf(root.locator)!
    if (
      Object.keys(value).some(key => !['schemaVersion', 'kind', 'gameId'].includes(key)) ||
      value['schemaVersion'] !== 1 ||
      !nonEmptyString(value['gameId'])
    )
      throw new TypeError(
        `resource root ${root.rootId} has an invalid ${SIBLINGS_LOCATOR_KIND} locator`,
      )
    return Object.freeze({
      schemaVersion: 1,
      kind: SIBLINGS_LOCATOR_KIND,
      gameId: value['gameId'],
    })
  }
  return kind === SUBJECT_LOCATOR_KIND ? parseSubjectLocator(root) : parseLocator(root)
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function missingPathError(value: unknown): boolean {
  const code = recordOf(value)?.['code']
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** A file VFS listing refused because its directory is not there, or is a file. */
function absentDirectory(error: unknown): boolean {
  const code = recordOf(error)?.['code']
  return (
    code === 'x3.vfs/not-a-directory' ||
    (code === 'x3.vfs/file-path-unavailable' && missingPathError(recordOf(error)?.['cause']))
  )
}

async function exactArchivePath(
  installation: GameInstallation,
  locator: Pick<GameInstallationArchiveLocator, 'archiveRelativePaths'>,
): Promise<{ state: 'resolved'; path: string } | { state: 'missing' } | { state: 'ambiguous' }> {
  const installationRoot = await realpath(resolve(installation.installPath))
  const matches: string[] = []
  for (const relativePath of locator.archiveRelativePaths) {
    try {
      const candidate = await realpath(resolve(installationRoot, ...relativePath.split('/')))
      if (!inside(installationRoot, candidate)) continue
      matches.push(candidate)
    } catch (error) {
      // An absent exact alternative is expected; access/I/O failures remain explicit failures.
      if (!missingPathError(error)) throw error
    }
  }
  if (matches.length === 0) return { state: 'missing' }
  if (matches.length > 1) return { state: 'ambiguous' }
  return { state: 'resolved', path: matches[0] as string }
}

function filePathFromSubjectUri(subjectUri: string): string | undefined {
  try {
    const url = new URL(subjectUri)
    return url.protocol === 'file:' ? fileURLToPath(url) : undefined
  } catch {
    return undefined
  }
}

function releaseOnce(release: () => Promise<void>): () => Promise<void> {
  let released = false
  return async () => {
    if (released) return
    released = true
    await release()
  }
}

async function releaseAll(releases: readonly (() => Promise<void>)[]): Promise<void> {
  let firstError: unknown
  for (const release of [...releases].reverse()) {
    try {
      await release()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

/**
 * A folder on disk as a map's resource namespace, read by the host itself: every file under it,
 * `/` separated, ids = paths, extracted whole within `maxBytes`. For a game's data folder that no
 * codec opens, so a game does not write a folder codec of its own.
 */
async function folderNamespaceMount(
  folder: ArtifactNamespaceSource,
  maxBytes: bigint,
): Promise<NamespaceMount> {
  const lease = await folder.openNamespace()
  const namespace = lease.value
  const entryOf = (item: { readonly path: string; readonly size?: bigint }): NamespaceEntry =>
    Object.freeze({
      id: item.path,
      path: item.path,
      name: item.path.slice(item.path.lastIndexOf('/') + 1),
      kind: 'file' as const,
      ...(item.size === undefined ? {} : { size: item.size }),
      revision: namespace.revision,
    })
  const filesUnder = async (prefix: string, signal?: AbortSignal): Promise<NamespaceEntry[]> => {
    // the folder listing takes a directory: list the one a prefix sits in, then narrow to it
    const directory = prefix.slice(0, prefix.lastIndexOf('/') + 1).replace(/\/$/u, '')
    const folded = prefix.toLowerCase()
    const files: NamespaceEntry[] = []
    try {
      for await (const item of namespace.list(directory, signal))
        if (item.kind === 'file' && item.path.toLowerCase().startsWith(folded))
          files.push(entryOf(item))
    } catch (error) {
      // a directory the folder has not holds no files: the next root is asked, the world stands
      if (!absentDirectory(error)) throw error
    }
    return files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
  }
  const entries: NamespaceEntrySource = Object.freeze({
    async list(
      prefix: string,
      page: { readonly cursor?: string; readonly limit: number },
      signal?: AbortSignal,
    ) {
      const files = await filesUnder(prefix, signal)
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const end = start + page.limit
      return Object.freeze({
        items: Object.freeze(files.slice(start, end)),
        ...(end < files.length ? { nextCursor: String(end) } : {}),
      })
    },
    async lookup(path: string, signal?: AbortSignal) {
      return (await filesUnder(path, signal)).find(
        entry => entry.path.toLowerCase() === path.toLowerCase(),
      )
    },
    async openEntry(entryId: string) {
      const uri = `${folder.ref.uri.replace(/\/+$/u, '')}/${entryId.split('/').map(encodeURIComponent).join('/')}`
      return {
        value: Object.freeze({ id: `${folder.ref.id}!/${entryId}`, uri }),
        release: async () => undefined,
      }
    },
  }) as NamespaceEntrySource
  return Object.freeze({
    namespace: entries,
    namespaceRelease: () => lease.release(),
    revision: namespace.revision,
    async extract(entryId: string, signal?: AbortSignal): Promise<Uint8Array> {
      const opened = await namespace.open(entryId, signal)
      try {
        const source = opened.value
        if (source.kind !== 'bytes') throw new TypeError(`${entryId} is not a file`)
        if (source.size !== undefined && source.size > maxBytes)
          throw new RangeError(`${entryId} (${source.size} bytes) exceeds the preview input budget`)
        const chunks: Uint8Array[] = []
        let length = 0
        for await (const chunk of source.stream(undefined, signal)) {
          length += chunk.byteLength
          if (BigInt(length) > maxBytes)
            throw new RangeError(`${entryId} exceeds the preview input budget`)
          chunks.push(chunk)
        }
        const bytes = new Uint8Array(length)
        let at = 0
        for (const chunk of chunks) {
          bytes.set(chunk, at)
          at += chunk.byteLength
        }
        return bytes
      } finally {
        await opened.release()
      }
    },
  })
}

export async function namespaceMount(session: AssetSession): Promise<NamespaceMount> {
  const descriptor = await session.descriptor()
  if (
    !descriptor.dataSources.some(
      item => item.contract === 'common.view/namespace-entry-source' && item.major === 1,
    )
  ) {
    throw new ModkitError({
      code: 'x3.host/map-preview-archive-namespace-unavailable',
      message: 'an installed archive did not expose common.view/namespace-entry-source@1',
    })
  }
  const operation = descriptor.operations.find(
    item => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === 'available',
  )
  if (operation === undefined) {
    throw new ModkitError({
      code: 'x3.host/map-preview-archive-extract-unavailable',
      message: `an installed archive did not expose ${CONTAINER_EXTRACT_OPERATION_ID}`,
    })
  }
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  const namespaceRelease = releaseOnce(() => lease.release())
  const openStoredSource = storedEntrySource(session, descriptor)
  return Object.freeze({
    session,
    namespace: lease.value as NamespaceEntrySource,
    namespaceRelease,
    revision: descriptor.revision,
    ...(openStoredSource === undefined ? {} : { openStoredSource }),
    async extract(entryId: string, signal?: AbortSignal): Promise<Uint8Array> {
      signal?.throwIfAborted()
      const result = await session
        .operations()
        .invoke(operation.handlerId, { entryId }, signal === undefined ? {} : { signal })
      if (result.state !== 'ok' || result.output.kind !== 'bytes') {
        throw new ModkitError({
          code: 'x3.host/map-preview-entry-unreadable',
          message: `the installed archive refused to extract entry ${entryId}`,
          context: { entryId, state: result.state },
        })
      }
      return result.output.value
    },
  })
}

function unresolved(
  code: string,
  message: string,
  findings: readonly Diagnostic[] = [],
): MapPreviewResourcePlanResolution {
  return Object.freeze({
    state: 'unresolved' as const,
    diagnostics: Object.freeze([...findings, diagnostic('error', code, message)]),
  })
}

function discoveryFindings(
  diagnostics: readonly {
    readonly severity: 'error' | 'warning' | 'information'
    readonly code: string
    readonly message: string
  }[],
): Diagnostic[] {
  return diagnostics.map(item =>
    diagnostic(
      item.severity,
      'x3.host/map-preview-installation-diagnostic',
      `${item.code}: ${item.message}`,
    ),
  )
}

/**
 * Create a trusted desktop resolver for the generic `game-installation-archive` locator.
 *
 * Game ids only route extension-owned discovery providers. Archive paths and layouts remain data
 * supplied by the preparation provider; this common adapter has no game-specific branch or id.
 */
export function createNodeMapPreviewResourcePlanResolver(
  options: NodeMapPreviewResourcePlanResolverOptions,
): MapPreviewResourcePlanResolver {
  const maxInstallationCandidates = positiveLimit(
    options.maxInstallationCandidates ?? 32,
    'maxInstallationCandidates',
  )
  const pageLimit = positiveLimit(options.pageLimit ?? 256, 'pageLimit')
  const maxPages = positiveLimit(options.maxPages ?? 4096, 'maxPages')

  const idleRetentionMs = options.installationRetentionMs ?? 60_000

  /*
   * An installed game is opened and indexed once, not once per resolve.
   *
   * One map open resolves its plan twice — a warm pass and the mount pass — and each pass opened
   * and indexed the whole installation again: measured at 26 s per pass, and the second pass
   * carried enough heap to kill the archive worker with ERR_WORKER_OUT_OF_MEMORY, which dropped
   * the preview back to the container entry list on roughly every other open.
   *
   * Two things are shared. The opening itself, so passes that overlap wait instead of indexing
   * twice; and the finished mount for a short idle period, because the two passes are usually
   * sequential and pure reference counting would close it in the gap between them. An installation
   * does not change while a window is open, so the retention only bounds how long its memory and
   * handles are held after the last map that wanted it.
   */
  const sharedArchives = new Map<
    string,
    { readonly opening: Promise<SharedArchive>; refs: number; idle?: NodeJS.Timeout | undefined }
  >()
  const closeShared = async (key: string): Promise<void> => {
    const entry = sharedArchives.get(key)
    if (entry === undefined || entry.refs > 0) return
    sharedArchives.delete(key)
    // A rejected opening owns its own cleanup; there is nothing left to close.
    await entry.opening.then(archive => archive.close()).catch(() => undefined)
  }
  const releaseShared = async (key: string): Promise<void> => {
    const entry = sharedArchives.get(key)
    if (entry === undefined) return
    entry.refs -= 1
    if (entry.refs > 0) return
    if (idleRetentionMs <= 0) {
      await closeShared(key)
      return
    }
    // Never a reason to keep the process alive on its own.
    entry.idle = setTimeout(() => void closeShared(key), idleRetentionMs)
    entry.idle.unref?.()
  }

  return Object.freeze({
    async resolve(
      request: ResolveMapPreviewResourcePlanRequest,
    ): Promise<MapPreviewResourcePlanResolution> {
      request.signal?.throwIfAborted()
      const releases: (() => Promise<void>)[] = []
      const fail = async (
        code: string,
        message: string,
        findings: readonly Diagnostic[] = [],
      ): Promise<MapPreviewResourcePlanResolution> => {
        try {
          await releaseAll(releases)
        } catch {
          // Cleanup failure cannot hide the named resolution refusal.
        }
        return unresolved(code, message, findings)
      }

      if (
        request.plan.resolverId !== NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID &&
        request.plan.resolverId !== NODE_GAME_INSTALLATION_RESOURCE_MAP_PREVIEW_RESOLVER_ID
      ) {
        return fail(
          'x3.host/map-preview-resource-resolver-unknown',
          `this resolver does not implement ${request.plan.resolverId}`,
        )
      }

      let locatedRoots: readonly Readonly<{
        root: MapPreviewHostResourceRoot
        locator: GameInstallationResourceLocator
      }>[]
      try {
        locatedRoots = request.plan.roots.map(root =>
          Object.freeze({ root, locator: parseResourceLocator(root) }),
        )
      } catch (error) {
        return fail(
          'x3.host/map-preview-resource-locator-invalid',
          error instanceof Error ? error.message : String(error),
        )
      }
      if (locatedRoots.some(item => item.locator.gameId !== request.workspace.gameId)) {
        return fail(
          'x3.host/map-preview-resource-game-mismatch',
          'every installed archive locator must match the prepared workspace game id',
        )
      }

      const findings: Diagnostic[] = []
      /*
       * Phase timings, reported as ordinary diagnostics.
       *
       * A cold preview of an installed map spends its time in two places this resolver owns:
       * locating the installation, and opening and indexing each installed archive. Without a
       * receipt per phase an open that ends at the caller's deadline says only that it was slow.
       */
      const startedAt = Date.now()
      const timing = (label: string, since: number): void => {
        findings.push(
          diagnostic(
            'information',
            'x3.host/map-preview-resource-timing',
            `${label}: ${String(Date.now() - since)} ms`,
          ),
        )
      }
      let discovery: Awaited<ReturnType<typeof discoverGameInstallations>>
      try {
        const searchPaths = await options.searchPaths?.(request.workspace.gameId)
        discovery = await discoverGameInstallations({
          services: request.services,
          gameId: request.workspace.gameId,
          ...(options.configuredPaths === undefined ||
          !Object.hasOwn(options.configuredPaths, request.workspace.gameId)
            ? {}
            : { configuredPaths: options.configuredPaths[request.workspace.gameId] }),
          ...(searchPaths === undefined ? {} : { searchPaths }),
          maxCandidates: maxInstallationCandidates,
          grant: options.installationDiscoveryGrant ?? request.grant,
          budgets: request.budgets,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        })
      } catch (error) {
        return fail(
          'x3.host/map-preview-installation-discovery-failed',
          `installation discovery failed (${error instanceof Error ? error.message : String(error)})`,
        )
      }
      if (discovery.state === 'unresolved') {
        return fail(
          'x3.host/map-preview-installation-discovery-unresolved',
          `installation discovery did not resolve for ${request.workspace.gameId}`,
          discovery.diagnostics,
        )
      }
      findings.push(...discovery.diagnostics, ...discoveryFindings(discovery.result.diagnostics))
      timing('installation discovery', startedAt)
      if (!discovery.result.complete) {
        return fail(
          'x3.host/map-preview-installation-discovery-truncated',
          'installation discovery reached a boundary before uniqueness was proved',
          findings,
        )
      }
      if (
        discovery.result.gameId !== request.workspace.gameId ||
        discovery.result.installations.some(installation => {
          if (
            installation.gameId !== request.workspace.gameId ||
            !nonEmptyString(installation.installPath) ||
            !isAbsolute(installation.installPath) ||
            !nonEmptyString(installation.normalizedPath) ||
            !Array.isArray(installation.evidence)
          ) {
            return true
          }
          return !discovery.result.probes.some(
            probe =>
              probe.confirmed === true &&
              isAbsolute(probe.candidate.path) &&
              probe.normalizedPath === installation.normalizedPath &&
              probe.candidate.path === installation.installPath,
          )
        })
      ) {
        return fail(
          'x3.host/map-preview-installation-discovery-invalid',
          'installation discovery returned an unconfirmed or mismatched installation',
          findings,
        )
      }
      if (discovery.result.installations.length === 0) {
        return fail(
          'x3.host/map-preview-installation-not-found',
          `no confirmed installation was found for ${request.workspace.gameId}`,
          findings,
        )
      }
      // A configured path is the user's choice: among confirmed installations, one they named wins.
      // Ambiguity remains only when several are configured, or none is and several were found.
      const samePath = (left: string, right: string) =>
        process.platform === 'win32'
          ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
          : resolve(left) === resolve(right)
      const configured = options.configuredPaths?.[request.workspace.gameId] ?? []
      const chosen = discovery.result.installations.filter(installation =>
        configured.some(path => samePath(path, installation.installPath)),
      )
      // Without a choice, a file opened inside one installation belongs to it (Warzone's mp.wz
      // under F:\GAMES, not the Store copy).
      const descriptor = await request.original.descriptor()
      const subjectPath = filePathFromSubjectUri(descriptor.subjectUri)
      const inside = (root: string) => {
        if (subjectPath === undefined) return false
        const path = relative(
          process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root),
          process.platform === 'win32' ? resolve(subjectPath).toLowerCase() : resolve(subjectPath),
        )
        return path !== '' && !path.startsWith('..') && !isAbsolute(path)
      }
      const containing = discovery.result.installations.filter(installation =>
        inside(installation.installPath),
      )
      const candidates =
        chosen.length > 0
          ? chosen
          : containing.length === 1
            ? containing
            : discovery.result.installations
      if (candidates.length > 1) {
        return fail(
          'x3.host/map-preview-installation-ambiguous',
          `${candidates.length} confirmed installations were found; choose one in settings`,
          findings,
        )
      }
      const installation = candidates[0] as GameInstallation

      if (
        String(descriptor.revision) !== request.subject.revision ||
        descriptor.subjectUri !== request.subject.subjectUri
      ) {
        return fail(
          'x3.host/map-preview-subject-snapshot-mismatch',
          'the opened subject no longer matches the prepared subject snapshot',
          findings,
        )
      }
      let openedSubjectPath = filePathFromSubjectUri(descriptor.subjectUri)
      if (openedSubjectPath !== undefined) {
        try {
          openedSubjectPath = await realpath(openedSubjectPath)
        } catch {
          openedSubjectPath = undefined
        }
      }

      const subjectRootIds = new Set(request.plan.subjectNamespaceRoots.map(root => root.rootId))
      const rootsById = new Map<string, CompositeWorkspaceNamespaceRoot>()
      let originalMount: NamespaceMount | undefined
      if (request.plan.subjectNamespaceRoots.length > 0) {
        try {
          originalMount = await namespaceMount(request.original)
          releases.push(originalMount.namespaceRelease)
        } catch (error) {
          return fail(
            'x3.host/map-preview-subject-namespace-unavailable',
            error instanceof Error ? error.message : String(error),
            findings,
          )
        }
        for (const root of request.plan.subjectNamespaceRoots) {
          const workspaceRoot = request.workspace.loadOrder.find(
            item => item.rootId === root.rootId,
          )
          if (workspaceRoot === undefined) {
            return fail(
              'x3.host/map-preview-resource-root-mismatch',
              `subject namespace root ${root.rootId} is absent from the workspace`,
              findings,
            )
          }
          rootsById.set(
            root.rootId,
            Object.freeze({
              rootId: root.rootId,
              pathPrefix: root.namespacePrefix,
              logicalPrefix: workspaceRoot.sourcePath,
              namespace: originalMount.namespace,
              containerRevision: descriptor.revision,
              extract: originalMount.extract,
              ...(originalMount.openStoredSource === undefined
                ? {}
                : { openStoredSource: originalMount.openStoredSource }),
              ...(root.assetRoots === undefined ? {} : { assetRoots: root.assetRoots }),
            }),
          )
        }
      }

      const externalMounts = new Map<string, NamespaceMount>()
      // Optional roots the installation does not have: the workspace keeps them, empty.
      const absentOptionalRoots = new Set<string>()
      for (const item of locatedRoots) {
        const workspaceRoot = request.workspace.loadOrder.find(
          root => root.rootId === item.root.rootId,
        )
        if (workspaceRoot === undefined || subjectRootIds.has(item.root.rootId)) {
          return fail(
            'x3.host/map-preview-resource-root-mismatch',
            `external resource root ${item.root.rootId} is not mapped exactly once`,
            findings,
          )
        }
        if (item.locator.kind === SIBLINGS_LOCATOR_KIND) {
          if (openedSubjectPath === undefined) {
            if (item.root.optional === true) {
              absentOptionalRoots.add(item.root.rootId)
              findings.push(
                diagnostic(
                  'information',
                  'x3.host/map-preview-optional-root-absent',
                  `${item.root.rootId} names the files beside the opened map, which is no file on disk`,
                ),
              )
              continue
            }
            return fail(
              'x3.host/map-preview-subject-siblings-unavailable',
              `${item.root.rootId} names the files beside the opened map, which is no file on disk`,
              findings,
            )
          }
          const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
          let siblings: NamespaceMount
          try {
            const folder = await vfs.openMount(
              pathToFileURL(dirname(openedSubjectPath)).href,
              request.signal === undefined ? {} : { signal: request.signal },
            )
            siblings = await folderNamespaceMount(
              artifactNamespaceSourceFromVfsMount(folder),
              request.budgets.maxInputBytes,
            )
          } catch (error) {
            await vfs.dispose()
            return fail(
              'x3.host/map-preview-subject-siblings-unreadable',
              error instanceof Error ? error.message : String(error),
              findings,
            )
          }
          releases.push(() => releaseAll([async () => vfs.dispose(), siblings.namespaceRelease]))
          rootsById.set(
            item.root.rootId,
            Object.freeze({
              rootId: item.root.rootId,
              pathPrefix: '',
              logicalPrefix: workspaceRoot.sourcePath,
              namespace: siblings.namespace,
              containerRevision: siblings.revision,
              extract: siblings.extract,
            }),
          )
          continue
        }
        let resource: Awaited<ReturnType<typeof exactArchivePath>>
        try {
          resource = await exactArchivePath(
            installation,
            item.locator.kind === LOCATOR_KIND
              ? item.locator
              : { archiveRelativePaths: item.locator.relativePaths },
          )
        } catch (error) {
          return fail(
            'x3.host/map-preview-installation-path-invalid',
            `the confirmed installation path could not be confined (${error instanceof Error ? error.message : String(error)})`,
            findings,
          )
        }
        if (resource.state === 'ambiguous') {
          return fail(
            'x3.host/map-preview-installation-archive-ambiguous',
            `${item.root.rootId} matched more than one exact installed resource path`,
            findings,
          )
        }
        let resourcePath: string
        let resourcePrefix = ''
        if (resource.state === 'resolved') {
          resourcePath = resource.path
        } else if (
          item.locator.kind === SUBJECT_LOCATOR_KIND &&
          item.locator.namespaceFallbackPrefix !== undefined
        ) {
          resourcePath = await realpath(resolve(installation.installPath))
          resourcePrefix = item.locator.namespaceFallbackPrefix
          findings.push(
            diagnostic(
              'information',
              'x3.host/map-preview-installation-namespace-fallback',
              `${item.root.rootId} has no exact loose subject; using the confirmed installation namespace prefix ${resourcePrefix}`,
            ),
          )
        } else if (item.root.optional === true) {
          absentOptionalRoots.add(item.root.rootId)
          findings.push(
            diagnostic(
              'information',
              'x3.host/map-preview-optional-root-absent',
              `${item.root.rootId} is optional and the installation has none of its exact paths`,
            ),
          )
          continue
        } else {
          return fail(
            'x3.host/map-preview-installation-archive-missing',
            `${item.root.rootId} matched none of its exact installed resource paths`,
            findings,
          )
        }

        let mount: NamespaceMount
        if (
          item.locator.openedSubjectPolicy === 'prefer-matching-opened-subject' &&
          openedSubjectPath !== undefined &&
          pathKey(openedSubjectPath) === pathKey(resourcePath)
        ) {
          if (originalMount === undefined) {
            try {
              originalMount = await namespaceMount(request.original)
              releases.push(originalMount.namespaceRelease)
            } catch (error) {
              return fail(
                'x3.host/map-preview-subject-namespace-unavailable',
                error instanceof Error ? error.message : String(error),
                findings,
              )
            }
          }
          mount = originalMount
        } else {
          const key = pathKey(resourcePath)
          const sharedKey = `${request.grant.id}\u0000${key}`
          const existing = externalMounts.get(key)
          if (existing !== undefined) {
            mount = existing
          } else {
            /*
             * The two passes of one map open run side by side, so sharing a finished mount never
             * hit: the second pass looked before the first had opened anything. What is shared is
             * the opening itself, so the second pass waits for the first instead of indexing the
             * installation a second time. The first pass owns the abort signal for that open.
             */
            let entry = sharedArchives.get(sharedKey)
            if (entry === undefined) {
              const archiveStartedAt = Date.now()
              entry = {
                refs: 0,
                opening: (async (): Promise<SharedArchive> => {
                  let opened: Awaited<ReturnType<SubjectServices['open']>>
                  let releaseSource = async (): Promise<void> => undefined
                  let folder: ArtifactNamespaceSource | undefined
                  try {
                    const resourceInfo = await stat(resourcePath)
                    if (resourceInfo.isDirectory()) {
                      if (
                        options.subjects.inventory === undefined ||
                        options.subjects.target === undefined ||
                        options.subjects.executionBackends === undefined
                      ) {
                        throw new TypeError(
                          'directory resource opening requires inventory, target and execution backends',
                        )
                      }
                      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
                      try {
                        const vfsMount = await vfs.openMount(
                          pathToFileURL(resourcePath).href,
                          request.signal === undefined ? {} : { signal: request.signal },
                        )
                        releaseSource = async () => vfs.dispose()
                        folder = artifactNamespaceSourceFromVfsMount(vfsMount)
                        opened = await openSubject({
                          inventory: options.subjects.inventory,
                          source: folder,
                          path: resourcePath,
                          intent: 'inspect',
                          target: options.subjects.target,
                          grant: request.grant,
                          budget: request.budgets,
                          executionBackends: options.subjects.executionBackends,
                          ...(options.subjects.serviceDefinitions === undefined
                            ? {}
                            : { serviceDefinitions: options.subjects.serviceDefinitions }),
                          ...(options.subjects.contributionSettings === undefined
                            ? {}
                            : { contributionSettings: options.subjects.contributionSettings }),
                          ...(request.signal === undefined ? {} : { signal: request.signal }),
                        })
                      } catch (error) {
                        await vfs.dispose()
                        throw error
                      }
                    } else {
                      // an installation archive may keep its data in a sibling (an Emperor RFH in
                      // its RFD): companions resolve inside the confirmed installation, as an
                      // ordinary open of that file does
                      const inventory = options.subjects.inventory
                      const resolveInput =
                        inventory === undefined
                          ? undefined
                          : createFilesystemInputResolver({
                              primaryPath: resourcePath,
                              roots: [await realpath(resolve(installation.installPath))],
                              inventory,
                            })
                      opened = await options.subjects.open({
                        source: await openFileArtifactSource(
                          resourcePath,
                          request.signal === undefined ? {} : { signal: request.signal },
                        ),
                        path: resourcePath,
                        intent: 'inspect',
                        grant: request.grant,
                        budget: request.budgets,
                        ...(resolveInput === undefined ? {} : { resolveInput }),
                        ...(request.signal === undefined ? {} : { signal: request.signal }),
                      })
                    }
                  } catch (error) {
                    await releaseSource()
                    throw new ArchiveOpenFailure(
                      'x3.host/map-preview-installation-archive-open-failed',
                      `ordinary subject opening failed for ${resourcePath} (${error instanceof Error ? error.message : String(error)})`,
                    )
                  }
                  // a data folder no codec claims (Dune 2000's `data`) is read as a plain folder
                  if (opened.state !== 'opened' && folder !== undefined) {
                    try {
                      const plain = await folderNamespaceMount(
                        folder,
                        request.budgets.maxInputBytes,
                      )
                      timing(`open and index ${resourcePath} as a folder`, archiveStartedAt)
                      return Object.freeze({
                        mount: plain,
                        close: () => releaseAll([plain.namespaceRelease, releaseSource]),
                      })
                    } catch (error) {
                      await releaseSource()
                      throw new ArchiveOpenFailure(
                        'x3.host/map-preview-installation-folder-unreadable',
                        error instanceof Error ? error.message : String(error),
                        opened.diagnostics,
                      )
                    }
                  }
                  if (opened.state !== 'opened') {
                    await releaseSource()
                    throw new ArchiveOpenFailure(
                      'x3.host/map-preview-installation-archive-unresolved',
                      `ordinary subject opening did not resolve ${resourcePath}`,
                      opened.diagnostics,
                    )
                  }
                  let openedMount: NamespaceMount
                  try {
                    openedMount = await namespaceMount(opened.session)
                  } catch (error) {
                    await opened.session.dispose()
                    await releaseSource()
                    throw new ArchiveOpenFailure(
                      'x3.host/map-preview-installation-archive-unusable',
                      error instanceof Error ? error.message : String(error),
                      opened.diagnostics,
                    )
                  }
                  timing(`open and index ${resourcePath}`, archiveStartedAt)
                  return Object.freeze({
                    mount: openedMount,
                    close: () =>
                      releaseAll([
                        releaseSource,
                        async () => openedMount.session?.dispose(),
                        openedMount.namespaceRelease,
                      ]),
                  })
                })(),
              }
              sharedArchives.set(sharedKey, entry)
            } else {
              if (entry.idle !== undefined) {
                clearTimeout(entry.idle)
                entry.idle = undefined
              }
              findings.push(
                diagnostic(
                  'information',
                  'x3.host/map-preview-resource-timing',
                  `reused the open index of ${resourcePath} (${sharedKey})`,
                ),
              )
            }
            entry.refs += 1
            releases.push(() => releaseShared(sharedKey))
            let acquired: SharedArchive
            try {
              acquired = await entry.opening
            } catch (error) {
              // A refused open is not cached: the next map may still find the installation.
              sharedArchives.delete(sharedKey)
              const failure = error instanceof ArchiveOpenFailure ? error : undefined
              return fail(
                failure?.code ?? 'x3.host/map-preview-installation-archive-open-failed',
                failure === undefined
                  ? error instanceof Error
                    ? error.message
                    : String(error)
                  : failure.message,
                [...findings, ...(failure?.diagnostics ?? [])],
              )
            }
            mount = acquired.mount
            externalMounts.set(key, mount)
          }
        }
        rootsById.set(
          item.root.rootId,
          Object.freeze({
            rootId: item.root.rootId,
            pathPrefix: resourcePrefix,
            logicalPrefix: workspaceRoot.sourcePath,
            namespace: mount.namespace,
            containerRevision: mount.revision,
            extract: mount.extract,
            ...(mount.openStoredSource === undefined
              ? {}
              : { openStoredSource: mount.openStoredSource }),
          }),
        )
      }

      const logicalWorkspaceRoots =
        request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse()
      const originRoots = logicalWorkspaceRoots.flatMap(root => {
        const mapped = rootsById.get(root.rootId)
        return mapped === undefined ? [] : [mapped]
      })
      if (originRoots.length !== request.workspace.loadOrder.length - absentOptionalRoots.size) {
        return fail(
          'x3.host/map-preview-resource-root-mismatch',
          'the installed archive resolver did not map every workspace root',
          findings,
        )
      }

      const release = releaseOnce(() => releaseAll(releases))
      const revision = revisionIdFromRef({
        kind: 'provider-token',
        value: JSON.stringify(
          originRoots.map(root => [root.rootId, String(root.containerRevision)]),
        ),
      })
      timing('resource plan resolved', startedAt)
      return Object.freeze({
        state: 'resolved' as const,
        origin: createCompositeWorkspaceNamespaceCompanionOrigin({
          primaryLogicalId:
            logicalWorkspaceRoots.find(root => root.rootId === request.workspace.activeRootId)
              ?.sourcePath ?? request.workspace.activeRootId,
          roots: originRoots,
          pageLimit,
          maxPages,
        }),
        revision,
        diagnostics: Object.freeze([
          ...findings,
          diagnostic(
            'information',
            'x3.host/map-preview-installation-resources-selected',
            `selected one confirmed ${request.workspace.gameId} installation and ${externalMounts.size} external archive(s)`,
          ),
        ]),
        release,
      })
    },
  })
}
