/** Node-only resolver for generic installed-game archive locators in map-preview plans. */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  diagnostic,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  revisionIdFromRef,
  type AssetSession,
  type NamespaceEntrySource,
  type RevisionId,
} from '@modkitx-x3/sdk'
import type { GameInstallation } from '@modkitx-x3/sdk/games'
import type { MapPreviewHostResourceRoot } from '@modkitx-x3/sdk/maps'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { discoverGameInstallations } from '../games/index.js'
import {
  createCompositeWorkspaceNamespaceCompanionOrigin,
  type CompositeWorkspaceNamespaceRoot,
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

const LOCATOR_KIND = 'game-installation-archive'
const SUBJECT_LOCATOR_KIND = 'game-installation-subject'
export const NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID =
  'org.modkitx.node/game-installation-archive-map-preview'
export const NODE_GAME_INSTALLATION_RESOURCE_MAP_PREVIEW_RESOLVER_ID =
  'org.modkitx.node/game-installation-resource-map-preview'
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

type GameInstallationResourceLocator =
  GameInstallationArchiveLocator | GameInstallationSubjectLocator

interface NamespaceMount {
  readonly session: AssetSession
  readonly namespace: NamespaceEntrySource
  readonly namespaceRelease: () => Promise<void>
  readonly revision: RevisionId
  readonly extract: (entryId: string, signal?: AbortSignal) => Promise<Uint8Array>
}

export interface NodeMapPreviewResourcePlanResolverOptions {
  /** Ordinary subject services; archive format selection remains inventory-owned. */
  readonly subjects: Pick<SubjectServices, 'open'> &
    Partial<
      Pick<SubjectServices, 'inventory' | 'target' | 'executionBackends' | 'serviceDefinitions'>
    >
  /** User/app settings, keyed by the same extension-owned game id used for discovery routing. */
  readonly configuredPaths?: Readonly<Record<string, readonly string[]>>
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
    (value['namespaceFallbackPrefix'] !== undefined &&
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
          namespaceFallbackPrefix: confinedRelativePath(
            value['namespaceFallbackPrefix'],
            `${root.rootId}.namespaceFallbackPrefix`,
          ),
        }),
    openedSubjectPolicy: value['openedSubjectPolicy'] as OpenedSubjectPolicy,
  })
}

function parseResourceLocator(root: MapPreviewHostResourceRoot): GameInstallationResourceLocator {
  return recordOf(root.locator)?.['kind'] === SUBJECT_LOCATOR_KIND
    ? parseSubjectLocator(root)
    : parseLocator(root)
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

async function namespaceMount(session: AssetSession): Promise<NamespaceMount> {
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
  return Object.freeze({
    session,
    namespace: lease.value as NamespaceEntrySource,
    namespaceRelease,
    revision: descriptor.revision,
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

      let discovery: Awaited<ReturnType<typeof discoverGameInstallations>>
      try {
        discovery = await discoverGameInstallations({
          services: request.services,
          gameId: request.workspace.gameId,
          ...(options.configuredPaths === undefined ||
          !Object.hasOwn(options.configuredPaths, request.workspace.gameId)
            ? {}
            : { configuredPaths: options.configuredPaths[request.workspace.gameId] }),
          maxCandidates: maxInstallationCandidates,
          grant: request.grant,
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
      const findings: Diagnostic[] = [
        ...discovery.diagnostics,
        ...discoveryFindings(discovery.result.diagnostics),
      ]
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
      if (discovery.result.installations.length > 1) {
        return fail(
          'x3.host/map-preview-installation-ambiguous',
          `${discovery.result.installations.length} confirmed installations were found; choose one in settings`,
          findings,
        )
      }
      const installation = discovery.result.installations[0] as GameInstallation

      const descriptor = await request.original.descriptor()
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
            }),
          )
        }
      }

      const externalMounts = new Map<string, NamespaceMount>()
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
          const existing = externalMounts.get(key)
          if (existing !== undefined) {
            mount = existing
          } else {
            let opened: Awaited<ReturnType<SubjectServices['open']>>
            let releaseSource = async (): Promise<void> => undefined
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
                  opened = await openSubject({
                    inventory: options.subjects.inventory,
                    source: artifactNamespaceSourceFromVfsMount(vfsMount),
                    path: resourcePath,
                    intent: 'inspect',
                    target: options.subjects.target,
                    grant: request.grant,
                    budget: request.budgets,
                    executionBackends: options.subjects.executionBackends,
                    ...(options.subjects.serviceDefinitions === undefined
                      ? {}
                      : { serviceDefinitions: options.subjects.serviceDefinitions }),
                    ...(request.signal === undefined ? {} : { signal: request.signal }),
                  })
                } catch (error) {
                  await vfs.dispose()
                  throw error
                }
              } else {
                opened = await options.subjects.open({
                  source: await openFileArtifactSource(
                    resourcePath,
                    request.signal === undefined ? {} : { signal: request.signal },
                  ),
                  path: resourcePath,
                  intent: 'inspect',
                  grant: request.grant,
                  budget: request.budgets,
                  ...(request.signal === undefined ? {} : { signal: request.signal }),
                })
              }
            } catch (error) {
              await releaseSource()
              return fail(
                'x3.host/map-preview-installation-archive-open-failed',
                `ordinary subject opening failed for ${resourcePath} (${error instanceof Error ? error.message : String(error)})`,
                findings,
              )
            }
            if (opened.state !== 'opened') {
              await releaseSource()
              return fail(
                'x3.host/map-preview-installation-archive-unresolved',
                `ordinary subject opening did not resolve ${resourcePath}`,
                [...findings, ...opened.diagnostics],
              )
            }
            let openedMount: NamespaceMount
            try {
              openedMount = await namespaceMount(opened.session)
            } catch (error) {
              await opened.session.dispose()
              await releaseSource()
              return fail(
                'x3.host/map-preview-installation-archive-unusable',
                error instanceof Error ? error.message : String(error),
                [...findings, ...opened.diagnostics],
              )
            }
            mount = openedMount
            externalMounts.set(key, mount)
            releases.push(() =>
              releaseAll([releaseSource, () => mount.session.dispose(), mount.namespaceRelease]),
            )
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
          }),
        )
      }

      const logicalWorkspaceRoots =
        request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse()
      const originRoots = logicalWorkspaceRoots.flatMap(root => {
        const mapped = rootsById.get(root.rootId)
        return mapped === undefined ? [] : [mapped]
      })
      if (originRoots.length !== request.workspace.loadOrder.length) {
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
