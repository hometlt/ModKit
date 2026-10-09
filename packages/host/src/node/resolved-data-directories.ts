/**
 * [MK] Core resolved-data editing over loader-owned package chains or explicit loose directories.
 *
 * A value a user sees on a resolved subject may come from any mod in the dependency chain, so a
 * write to it is a workspace-level change: the game's resolved-data provider picks (or asks for) the
 * destination document in the active mod, the host binds that choice to exact file targets, the
 * format writer turns it into a plan, and the one host commit coordinator applies it. Nothing here
 * knows a game; the provider is selected by `gameId`. Canonical inputs use the existing Data
 * workspace adapter; only the active confined host directory is writable. Physical bytes must
 * match context reads, read-only dependencies retain content-hash guards, and saved inputs refresh
 * before prepare/commit/replay. Refusal/close releases contexts, resources, selector, writers and
 * history backend. Packed active packages are not writable here. A root-scoped JSON query port
 * lets trusted providers project the loader's retained Data model through the existing resolver;
 * generic directory callers keep their standalone provider analysis. Read-only directory listings
 * are pinned as well as read bytes, so added dependency inputs cannot escape missed-watcher checks.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { canonicalJsonStringify, ModkitError, type Diagnostic } from '@modkit/core'
import {
  resolveModWorkspaceGraph,
  revisionId,
  isJsonValue,
  type ModContextQueryPort,
  type AssetEditPlan,
  type ArtifactNamespaceSource,
  type ModWorkspaceLock,
  type ResourceSessionPort,
  type ChangeSet,
  type CommitCoordinator,
  type DataEditIntent,
  type FidelityEvidence,
  type GrantSnapshot,
  type Lease,
  type PermissionGrant,
  type ResourceBudget,
  type SubjectSelectorSource,
  type Writer,
} from '@modkit/sdk'
import {
  HOST_LAYER_SOURCE_ID,
  modContextLayerPathKey,
  type ModContext,
} from '@modkit/vfs/content-sources'
import {
  analyzeResolvedDataWorkspace,
  type DataHostServices,
  createResolvedDataSubjectSelectorLease,
  type DataWorkspaceFileLister,
  type ResolvedDataEditPlanRequest,
  type ResolvedDataGraphIsolationPlanRequest,
  type ResolvedDataWorkspaceLimits,
} from '../data/index.js'
import { createCommitCoordinator, createGrantSnapshot, type EditingBackend } from '../editing.js'
import {
  createEvidenceRegistry,
  serviceProviderFidelityEvidenceRecord,
} from '../editing-evidence.js'
import type { CompanionOrigin } from '../input-resolution.js'
import { createResourceSession } from '../resource-session.js'
import { createModContextDataWorkspaceInputs } from '../mod-context-data-workspace.js'
import { createHostServiceResolver } from '../service-leases.js'
import { createFilesystemCompanionOrigin } from './companion-origin.js'
import { openDirectoryArtifactSource } from './directory-artifact-source.js'
import { createFileEditingBackend } from './file-editing-backend.js'
import { createFilePayloadStore } from './file-payload-store.js'
import type { NodeSubjectServices } from './subject-services.js'

export interface OpenDirectoryResolvedDataWorkspaceRequest {
  readonly services: NodeSubjectServices
  readonly gameId: string
  /** Mod directories in load order: dependencies first, the active (only writable) mod last. */
  readonly directories: readonly string[]
  /** Absolute directories the host granted; every mod directory must sit inside one. */
  readonly roots: readonly string[]
  readonly locales: readonly string[]
  readonly limits: ResolvedDataWorkspaceLimits
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

/** Canonical package chain; this function owns context disposal, including refusal and failure. */
export interface OpenModContextResolvedDataWorkspaceRequest extends Omit<
  OpenDirectoryResolvedDataWorkspaceRequest,
  'directories'
> {
  readonly context: ModContext
  /** Reopen the same target/settings/session through its owner to verify current dependency order. */
  readonly reopenContext: () => Promise<ModContext>
}

/**
 * Keep loader-owned order/provenance, bind only the active loose package to the existing Node
 * editing authority. Packed dependencies stay read-only. A stale/unsaved context read is refused
 * before it can acquire a physical revision; namespace confinement also rejects escaping links.
 */
export async function openModContextResolvedDataWorkspace(
  request: OpenModContextResolvedDataWorkspaceRequest,
): ReturnType<typeof openDirectoryResolvedDataWorkspace> {
  let disposeInputs: (() => Promise<void>) | undefined
  let contextDisposed = false
  try {
    request.signal?.throwIfAborted()
    if (request.context.gameId !== request.gameId)
      throw new TypeError('context game does not match the requested workspace')
    if (request.context.invalidate === undefined)
      throw new TypeError(
        'resolved editing requires saved-context invalidation for dependency revision guards',
      )
    const active = request.context.layers.at(-1)
    if (
      active?.role !== 'primary' ||
      active.sourceId !== HOST_LAYER_SOURCE_ID ||
      !isAbsolute(active.sourcePath)
    ) {
      throw new ModkitError({
        code: RESOLVED_DATA_EDIT_UNAVAILABLE,
        message: 'resolved editing requires an active package directory on the host filesystem',
      })
    }
    const directory = await realpath(active.sourcePath)
    const grantedRoots = await Promise.all(request.roots.map(root => realpath(root)))
    if (
      !grantedRoots.some(root => {
        const child = relative(root, directory)
        return (
          child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
        )
      })
    )
      throw new TypeError('resolved workspace package must be inside configured roots')
    const rootSource = await openDirectoryArtifactSource(directory, {
      fileUriPolicy: 'physical',
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const namespace = await rootSource.openNamespace(request.signal)
    disposeInputs = async () => {
      contextDisposed = true
      await Promise.allSettled([namespace.release(), request.context.dispose()])
    }
    // Only sources actually read through this context can become dependency guards. Hashes bind
    // saved bytes, rather than treating a context identity or an overlay epoch as a file revision.
    const guards = new Map<string, { layerId: string; path: string }>()
    let bindingFailure: unknown
    const contentRevision = (bytes: Uint8Array) =>
      revisionId(`content-hash.sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    /** Source addresses/order are authoritative; opaque layer ids need not survive reopening. */
    const topologyOf = (context: ModContext) =>
      canonicalJsonStringify({
        gameId: context.gameId,
        unresolved: [...context.unresolved],
        layers: context.layers.map(layer => ({
          sourceId: layer.sourceId,
          path: modContextLayerPathKey(layer, layer.sourcePath),
          caseSensitive: layer.caseSensitive === true,
          role: layer.role,
          provenance: layer.provenance,
          ...(layer.kind === undefined ? {} : { kind: layer.kind }),
          ...(layer.fingerprint === undefined ? {} : { fingerprint: layer.fingerprint }),
        })),
      })
    const topology = topologyOf(request.context)
    const inputs = createModContextDataWorkspaceInputs(request.context, {
      async sourceBinding(layerId, path, virtual, signal) {
        const bytes = await virtual.read(0n, Number(virtual.size), signal)
        if (layerId !== active.id) {
          guards.set(virtual.ref.id, { layerId, path })
          return Object.freeze({
            value: Object.freeze({ ...virtual, revision: contentRevision(bytes) }),
            release: async () => undefined,
          })
        }
        let lease: Awaited<ReturnType<typeof namespace.value.open>> | undefined
        try {
          lease = await namespace.value.open(path, signal)
          const source = lease.value
          if (source.kind !== 'bytes' || source.size !== BigInt(bytes.byteLength))
            throw new Error('context bytes differ from the saved editing source')
          const actual = await source.read(0n, bytes.byteLength, signal)
          if (actual.byteLength !== bytes.byteLength || Buffer.compare(actual, bytes) !== 0) {
            throw new Error('context bytes differ from the saved editing source')
          }
          return lease
        } catch (error) {
          bindingFailure = error
          await lease?.release()
          throw error
        }
      },
    })
    const listingGuards = new Map<string, {
      rootId: string; prefix: string; maximum: number; fingerprint: string
    }>()
    /** Compare declared bounded input names under the root's own case policy, ignoring order. */
    const listingFingerprint = (rootId: string, listed: Awaited<ReturnType<DataWorkspaceFileLister>>) => {
      const root = inputs.workspace.loadOrder.find(root => root.rootId === rootId)
      if (root === undefined) throw new TypeError('unknown dependency listing root')
      return canonicalJsonStringify({ complete: listed.complete,
        paths: listed.paths.map(path => root.caseSensitive === true ? path : path.toLowerCase()).sort(),
      })
    }
    /** Only read-only listings are pinned: active creation/deletion remains with editing history. */
    const listFiles: DataWorkspaceFileLister = async (rootId, prefix, maximum, signal) => {
      const listed = await inputs.listFiles(rootId, prefix, maximum, signal)
      if (rootId !== inputs.workspace.activeRootId) {
        const key = canonicalJsonStringify([rootId, prefix, maximum])
        const fingerprint = listingFingerprint(rootId, listed)
        const known = listingGuards.get(key)
        if (known !== undefined && known.fingerprint !== fingerprint)
          throw new Error('package dependency input listing changed during analysis')
        listingGuards.set(key, { rootId, prefix, maximum, fingerprint })
      }
      return listed
    }
    disposeInputs = async () => {
      contextDisposed = true
      await Promise.allSettled([
        inputs.resources.dispose(),
        namespace.release(),
        request.context.dispose(),
      ])
      guards.clear()
      listingGuards.clear()
    }
    /** Revision-only capability: the common coordinator never receives write authority here. */
    const guardBackend: EditingBackend = {
      profile: {
        backendId: 'mod-context-read-guards',
        guarantees: ['best-effort'],
        supportsPrepare: false,
        supportsRollback: false,
        supportsJournal: false,
        supportsRename: false,
      },
      writable: false,
      async currentRevision(target, signal) {
        signal?.throwIfAborted()
        const binding = guards.get(target.ownerSource.id)
        if (binding === undefined) throw new TypeError('unknown mod-context revision guard')
        const bytes = await request.context.read(binding.layerId, binding.path, 64 * 1024 * 1024)
        signal?.throwIfAborted()
        const revision = contentRevision(bytes)
        return {
          bindings: { [target.ownerSource.id]: revision },
          compositionFingerprint: canonicalJsonStringify({
            topology: 'single',
            bindingId: target.ownerSource.id,
            source: { id: target.ownerSource.id, uri: target.ownerSource.uri },
            revision,
          }),
        }
      },
      async apply() {
        throw new TypeError('mod-context dependency guards are read-only')
      },
    }
    /** Preserve the existing physical-binding refusal before any canonical semantic question. */
    const verifyReadBindings = () => {
      if (bindingFailure !== undefined)
        throw new ModkitError({
          code: 'x3.host/resolved-data-source-binding-failed',
          message: 'The package context could not bind its saved bytes to confined editing sources. Refresh and reopen the workspace.',
          cause: bindingFailure,
        })
    }
    const modContexts: ModContextQueryPort | undefined = request.context.query === undefined ? undefined : {
      /** Carry only JSON questions to this live selected context, never another workspace. */
      async query(scope, question, signal) {
        signal?.throwIfAborted()
        if (contextDisposed || scope !== request.context.contextId || inputs.resources.state() !== 'live')
          throw new TypeError('resolved Data mod-context scope is closed or foreign')
        verifyReadBindings()
        if (!isJsonValue(question)) throw new TypeError('a mod context question must be JSON')
        const answer = await request.context.query!(question, signal)
        signal?.throwIfAborted()
        if (contextDisposed || inputs.resources.state() !== 'live')
          throw new TypeError('resolved Data mod-context scope closed during the question')
        if (!isJsonValue(answer)) throw new TypeError('a mod context answer must be JSON')
        return answer
      },
    }
    const services: NodeSubjectServices & Pick<DataHostServices, 'modContexts' | 'preferTrustedInProcess'> =
      modContexts === undefined ? request.services : { ...request.services, modContexts, preferTrustedInProcess: true }
    return await openResolvedDataWorkspaceAuthority(
      { ...request, services, roots: grantedRoots },
      {
        lock: inputs.workspace,
        resources: inputs.resources,
        listFiles,
        rootSource,
        activeSourcePath: inputs.workspace.loadOrder.at(-1)!.sourcePath,
        dispose: disposeInputs,
        guardBackendFor: sourceId => (guards.has(sourceId) ? guardBackend : undefined),
        // Re-read saved inputs at every transaction boundary, including missed watcher events.
        beforeRevisionChecks: async () => {
          await request.context.invalidate!()
          const current = await request.reopenContext()
          try {
            if (topologyOf(current) !== topology)
              throw new ModkitError({
                code: 'x3.host/resolved-data-context-chain-changed',
                message:
                  'The package dependency chain changed. Reopen the resolved workspace before editing or replaying history.',
              })
          } finally {
            await current.dispose()
          }
          for (const guard of listingGuards.values()) {
            const listed = await inputs.listFiles(guard.rootId, guard.prefix, guard.maximum)
            if (listingFingerprint(guard.rootId, listed) !== guard.fingerprint)
              throw new ModkitError({
                code: 'x3.host/resolved-data-context-inputs-changed',
                message: 'The package dependency input listing changed. Reopen the resolved workspace before editing or replaying history.',
              })
          }
        },
        verifyReadBindings,
      },
    )
  } catch (error) {
    if (disposeInputs === undefined) await request.context.dispose()
    else await disposeInputs()
    throw error
  }
}

export type ResolvedDataChangeRequest =
  | Readonly<{
      kind: 'field'
      subjectId: string
      fieldPath: readonly string[]
      intent: DataEditIntent
      targetDocument?: Readonly<{ rootId: string; path: string }>
    }>
  | Readonly<{
      kind: 'isolation'
      ownerSubjectId: string
      targetSubjectId: string
      cloneSubjectId: string
      ownerFieldPath: readonly string[]
      maxEdges: number
      always?: boolean
      ownerTargetDocument?: Readonly<{ rootId: string; path: string }>
      cloneTargetDocument?: Readonly<{ rootId: string; path: string }>
    }>

/** The editing authority a retained plan needs, shared with subject editing. */
export interface ResolvedDataEditingAuthority {
  readonly coordinator: CommitCoordinator
  readonly grantSnapshot: GrantSnapshot
  releasePlan(plan: AssetEditPlan): Promise<void>
}

export interface DirectoryResolvedDataWorkspace {
  readonly snapshotId: string
  readonly activeRootId: string
  readonly rootIds: readonly string[]
  /** Confined logical prefix for explicit targetDocument paths in the active mod. */
  readonly activeSourcePath?: string
  readonly selector: SubjectSelectorSource
  readonly editing: ResolvedDataEditingAuthority
  readonly diagnostics: readonly Diagnostic[]
  /** Provider preview, host-bound ChangeSet, writer plan. Throws a structured refusal. */
  planChange(request: ResolvedDataChangeRequest, signal?: AbortSignal): Promise<AssetEditPlan>
  release(): Promise<void>
}

export const RESOLVED_DATA_EDIT_UNAVAILABLE = 'x3.host/resolved-data-edit-unavailable'

/** Split a selector subject id (`[prefix/]Namespace/EntityId`) into the provider's entity ref. */
const entityRef = (subjectId: string) => {
  const parts = subjectId.split('/')
  const entityId = parts.at(-1) ?? ''
  const namespace = parts.at(-2) ?? ''
  if (namespace === '' || entityId === '') {
    throw new ModkitError({
      code: RESOLVED_DATA_EDIT_UNAVAILABLE,
      message: `subject id «${subjectId}» does not name Namespace/EntityId`,
    })
  }
  return { namespace, entityId }
}

export async function openDirectoryResolvedDataWorkspace(
  request: OpenDirectoryResolvedDataWorkspaceRequest,
): Promise<
  | Readonly<{ state: 'resolved'; workspace: DirectoryResolvedDataWorkspace }>
  | Readonly<{ state: 'unresolved'; diagnostics: readonly Diagnostic[] }>
> {
  const directories = request.directories.map(value => resolve(value))
  const active = directories.at(-1)
  const parent = active === undefined ? undefined : dirname(active)
  if (
    active === undefined ||
    directories.some(value => dirname(value) !== parent) ||
    new Set(directories.map(value => basename(value).toLowerCase())).size !== directories.length
  ) {
    throw new ModkitError({
      code: RESOLVED_DATA_EDIT_UNAVAILABLE,
      message: 'resolved-data directories must be distinct siblings of one parent directory',
    })
  }
  // ponytail: one shared parent directory; packed or scattered dependencies need content sources.
  // The parent directory is the one mount every mod path is logical inside.
  const siblings = createFilesystemCompanionOrigin({ primaryPath: active, roots: request.roots })
  const origin: CompanionOrigin = Object.freeze({
    ...siblings,
    scopes: Object.freeze(['current-mount'] as const),
    enumerate: (
      _scope: unknown,
      options: Parameters<CompanionOrigin['enumerate']>[1],
      signal?: AbortSignal,
    ) => siblings.enumerate('sibling-directory', options, signal),
  })
  const rootIdOf = (directory: string) => basename(directory).replace(/\.[^.]+$/u, '')
  const graphRoots = directories.map((directory, index) => ({
    rootId: rootIdOf(directory),
    sourceId: `directory-${index}`,
    sourcePath: basename(directory),
    displayName: basename(directory),
    kind: 'mod',
    dependencies: directories.slice(0, index).map(dependency => ({
      targetRootId: rootIdOf(dependency),
      ref: rootIdOf(dependency),
      required: true,
      provenance: 'declared' as const,
    })),
  }))
  const lock = resolveModWorkspaceGraph({
    workspaceId: `directories:${randomUUID()}`,
    gameId: request.gameId,
    activeRootId: rootIdOf(active),
    sources: graphRoots.map(root => ({
      sourceId: root.sourceId,
      kind: 'directory' as const,
      location: root.sourcePath,
    })),
    roots: graphRoots,
    maxRoots: Math.max(1, directories.length),
    maxDepth: Math.max(1, directories.length),
  })
  const rootSource = await openDirectoryArtifactSource(active)
  // The session is pinned to the active mod's namespace revision observed at open.
  const resources = createResourceSession({ origin, revision: rootSource.revision })
  const directoryOf = new Map(directories.map(directory => [rootIdOf(directory), directory]))
  const listFiles: DataWorkspaceFileLister = async (rootId, prefix, maximum, signal) => {
    const directory = directoryOf.get(rootId)
    if (directory === undefined) throw new RangeError(`no directory for root ${rootId}`)
    // Segment by segment without case, as the game reads its packages on any file system.
    let base = directory
    for (const segment of prefix === '' ? [] : prefix.split('/')) {
      const entries = await readdir(base).catch(() => undefined)
      const found = entries?.find(entry => entry.toLowerCase() === segment.toLowerCase())
      if (found === undefined) return { paths: [], complete: true }
      base = join(base, found)
    }
    signal?.throwIfAborted()
    const entries = await readdir(base, { recursive: true, withFileTypes: true }).catch(() => [])
    const paths = entries
      .filter(entry => entry.isFile())
      .map(entry => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort()
    return paths.length > maximum
      ? { paths: paths.slice(0, maximum), complete: false }
      : { paths, complete: true }
  }
  // Both manual chains and loader-owned packages enter the same analyzer/writer/history owner.
  try {
    return await openResolvedDataWorkspaceAuthority(request, {
      lock,
      resources,
      listFiles,
      rootSource,
      activeSourcePath: basename(active),
      dispose: () => resources.dispose(),
    })
  } catch (error) {
    await resources.dispose()
    throw error
  }
}

/** One editing implementation for both workspace sources; inputs retain their original authority. */
async function openResolvedDataWorkspaceAuthority(
  request: Omit<OpenDirectoryResolvedDataWorkspaceRequest, 'directories'>,
  inputs: {
    readonly lock: ModWorkspaceLock
    readonly resources: ResourceSessionPort
    readonly listFiles: DataWorkspaceFileLister
    readonly rootSource: ArtifactNamespaceSource
    readonly activeSourcePath: string
    readonly dispose: () => Promise<void>
    readonly guardBackendFor?: (sourceId: string) => EditingBackend | undefined
    readonly beforeRevisionChecks?: () => Promise<void>
    readonly verifyReadBindings?: () => void
  },
): ReturnType<typeof openDirectoryResolvedDataWorkspace> {
  const { lock, resources, listFiles, rootSource } = inputs
  const rootTarget = {
    targetId: rootSource.ref.id,
    subjectUri: rootSource.ref.uri,
    ownerSource: rootSource.ref,
    semanticPath: [],
    expectedRevision: {
      bindings: { [rootSource.ref.id]: rootSource.revision },
      namespaceRevision: rootSource.revision,
      compositionFingerprint: canonicalJsonStringify({
        topology: 'namespace',
        root: { id: rootSource.ref.id, uri: rootSource.ref.uri },
        revision: rootSource.revision,
      }),
    },
  }
  const readGrant: PermissionGrant = { id: `resolved-workspace-read:${randomUUID()}`, classes: [] }
  const analyzed = await analyzeResolvedDataWorkspace({
    services: request.services,
    grant: readGrant,
    budgets: request.budgets,
    workspace: lock,
    resources,
    locales: request.locales,
    queries: [],
    limits: request.limits,
    listFiles,
    writableRoots: [
      { rootId: lock.activeRootId, sourcePath: inputs.activeSourcePath, target: rootTarget },
    ],
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  try {
    inputs.verifyReadBindings?.()
  } catch (error) {
    if (analyzed.state === 'resolved') await analyzed.release()
    throw error
  }
  if (analyzed.state === 'unresolved') {
    await inputs.dispose()
    return { state: 'unresolved', diagnostics: analyzed.diagnostics }
  }
  const selector = createResolvedDataSubjectSelectorLease(analyzed, {
    maxPageSize: request.limits.maxPageSize,
    maxEntities: request.limits.maxEntities,
    maxRelations: request.limits.maxEntities,
    maxCalculations: Math.min(request.limits.maxEntities, 256),
  })
  const buildEditChange = analyzed.buildEditChange
  if (selector === undefined || buildEditChange === undefined) {
    await analyzed.release()
    await inputs.dispose()
    return {
      state: 'unresolved',
      diagnostics: [
        ...analyzed.diagnostics,
        {
          severity: 'warning',
          code: RESOLVED_DATA_EDIT_UNAVAILABLE,
          message: `the ${request.gameId} resolved-data provider publishes no editable subjects`,
          path: [],
        },
      ],
    }
  }

  const backend = createFileEditingBackend({ roots: request.roots })
  const payloads = createFilePayloadStore()
  const writeGrant: PermissionGrant = {
    id: `resolved-directories-write:${randomUUID()}`,
    classes: ['read-source', 'write-source'],
  }
  const writers = new Map<string, Lease<Writer>>()
  const writerReleases: (() => Promise<void>)[] = []
  const writerFor = async (formatId: string): Promise<Writer> => {
    const known = writers.get(formatId)
    if (known !== undefined) return known.value
    if (request.services.serviceDefinitions === undefined) {
      throw new ModkitError({
        code: RESOLVED_DATA_EDIT_UNAVAILABLE,
        message: 'this host registered no service definitions, so no writer can be resolved',
      })
    }
    const resolver = createHostServiceResolver({
      inventory: request.services.inventory,
      target: request.services.target,
      executionBackends: request.services.executionBackends,
      definitions: request.services.serviceDefinitions,
      grant: writeGrant,
      budgets: request.budgets,
    })
    writerReleases.push(() => resolver.release())
    const lease = (await resolver.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId,
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
    })) as Lease<Writer>
    writers.set(formatId, lease)
    return lease.value
  }
  const evidence = createEvidenceRegistry()
  const planWriters = new Map<string, Writer>()
  const evidenceFor = (plan: AssetEditPlan): FidelityEvidence | undefined => {
    const registered = evidence.evidenceFor(plan)
    if (registered !== undefined) return registered
    const writer = planWriters.get(plan.planId)
    if (writer === undefined) return undefined
    const record = serviceProviderFidelityEvidenceRecord(request.services.inventory, {
      writer,
      acceptedOrigins: ['bundled', 'installed'],
    })
    if (record !== undefined) return evidence.with(record).evidenceFor(plan)
    // Same vouching rule as the library facade: a resolved writer claiming byte identity.
    if (
      plan.fidelity.roundTrip !== 'byte-identical' ||
      plan.fidelity.preservesUnknownData !== true
    ) {
      return undefined
    }
    return {
      roundTrip: 'byte-identical',
      preservesUnknownData: true,
      evidenceId: 'host:resolved-data-writer/byte-identical',
      corpusId: 'modkit/packages/host/test/text-writers.test.ts',
      corpusDigest: 'none:byte-identical-by-contract',
      conformanceProfile: 'common.edit/writer-v1' as never,
      writer: writer.identity,
      optionsFingerprint: 'options:none',
      inputClass: 'resolved-data-directory',
      provenAt: '2026-09-17T00:00:00Z',
    }
  }
  /*
   * The grant covers exactly the sources planned so far. It only grows, so an older transaction's
   * sources stay covered for undo/redo, and every issued snapshot remains valid while open.
   */
  const grantedSources = new Set<string>([rootSource.ref.id])
  const issued = new Set<string>()
  const issue = (): GrantSnapshot => {
    const snapshot = createGrantSnapshot({
      snapshotId: `resolved-directories-grant:${randomUUID()}`,
      permissions: ['write-source'],
      sourceIds: [...grantedSources],
    })
    issued.add(snapshot.snapshotId)
    return snapshot
  }
  let grantSnapshot = issue()
  let live = true
  const ownerCoordinator = createCommitCoordinator({
    payloads,
    backendFor: sourceId => inputs.guardBackendFor?.(sourceId) ?? backend,
    evidenceFor,
    isGrantValid: grant => live && issued.has(grant.snapshotId),
    digest: value =>
      createHash('sha256')
        .update(canonicalJsonStringify(value as never))
        .digest('hex'),
    verifyStagedPayload: (ref, signal) => payloads.verify(ref, signal),
  })
  /** Keep one transaction owner; canonical read guards refresh before its live revision checks. */
  /** Respect close/cancellation before refreshing a read capability for a live transaction. */
  const refreshGuardInputs = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (!live)
      throw new ModkitError({
        code: RESOLVED_DATA_EDIT_UNAVAILABLE,
        message: 'the resolved-data workspace is closed',
      })
    await inputs.beforeRevisionChecks!()
    signal?.throwIfAborted()
  }
  const coordinator: CommitCoordinator =
    inputs.beforeRevisionChecks === undefined
      ? ownerCoordinator
      : {
          async prepare(plan, options) {
            await refreshGuardInputs(options.signal)
            return ownerCoordinator.prepare(plan, options)
          },
          async commit(prepared, options) {
            await refreshGuardInputs(options.signal)
            return ownerCoordinator.commit(prepared, options)
          },
          async undo(transactionId, options) {
            await refreshGuardInputs(options.signal)
            return ownerCoordinator.undo(transactionId, options)
          },
          async redo(transactionId, options) {
            await refreshGuardInputs(options.signal)
            return ownerCoordinator.redo(transactionId, options)
          },
          discardHistory: transactionId => ownerCoordinator.discardHistory(transactionId),
        }

  const planChange = async (
    change: ResolvedDataChangeRequest,
    signal?: AbortSignal,
  ): Promise<AssetEditPlan> => {
    if (!live) {
      throw new ModkitError({
        code: RESOLVED_DATA_EDIT_UNAVAILABLE,
        message: 'the resolved-data workspace is closed',
      })
    }
    let built: ChangeSet
    if (change.kind === 'field') {
      const fieldRequest: ResolvedDataEditPlanRequest = {
        subject: entityRef(change.subjectId),
        fieldPath: change.fieldPath,
        intent: change.intent,
        ...(change.targetDocument === undefined ? {} : { targetDocument: change.targetDocument }),
        ...(signal === undefined ? {} : { signal }),
      }
      built = await buildEditChange(fieldRequest)
    } else {
      if (analyzed.buildIsolationChange === undefined) {
        throw new ModkitError({
          code: RESOLVED_DATA_EDIT_UNAVAILABLE,
          message: `the ${request.gameId} resolved-data provider cannot plan isolation`,
        })
      }
      const target = entityRef(change.targetSubjectId)
      const isolationRequest: ResolvedDataGraphIsolationPlanRequest = {
        schemaVersion: 1,
        owner: entityRef(change.ownerSubjectId),
        target,
        cloneEntityId: entityRef(change.cloneSubjectId).entityId,
        ownerFieldPath: change.ownerFieldPath,
        maxEdges: change.maxEdges,
        ...(change.always === undefined ? {} : { always: change.always }),
        ...(change.ownerTargetDocument === undefined
          ? {}
          : { ownerTargetDocument: change.ownerTargetDocument }),
        ...(change.cloneTargetDocument === undefined
          ? {}
          : { cloneTargetDocument: change.cloneTargetDocument }),
        ...(signal === undefined ? {} : { signal }),
      }
      built = await analyzed.buildIsolationChange(isolationRequest)
    }
    const intent = built.semanticIntent as { formatId?: unknown } | undefined
    if (typeof intent?.formatId !== 'string') {
      throw new ModkitError({
        code: RESOLVED_DATA_EDIT_UNAVAILABLE,
        message: 'the resolved-data change names no format for its writer',
      })
    }
    const writer = await writerFor(intent.formatId)
    const plan = await writer.plan(built, signal)
    planWriters.set(plan.planId, writer)
    const before = grantedSources.size
    for (const edit of plan.edits) grantedSources.add(edit.source.id)
    if (grantedSources.size !== before) grantSnapshot = issue()
    return plan
  }

  let released = false
  return {
    state: 'resolved',
    workspace: Object.freeze({
      snapshotId: analyzed.snapshot.snapshotId,
      activeRootId: lock.activeRootId,
      rootIds: Object.freeze(lock.loadOrder.map(root => root.rootId)),
      activeSourcePath: inputs.activeSourcePath,
      selector: selector.value,
      editing: Object.freeze({
        coordinator,
        get grantSnapshot() {
          return grantSnapshot
        },
        // Operation payloads here are inline text; nothing is staged per plan.
        releasePlan: async () => undefined,
      }),
      diagnostics: analyzed.diagnostics,
      planChange,
      async release() {
        if (released) return
        released = true
        live = false
        await Promise.allSettled([
          selector.release(),
          ...[...writers.values()].map(lease => lease.release()),
        ])
        await Promise.allSettled(writerReleases.map(release => release()))
        await Promise.allSettled([analyzed.release(), backend.dispose(), payloads.dispose()])
        await inputs.dispose()
      },
    }),
  }
}
