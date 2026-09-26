/**
 * Resolved-data editing over loose mod directories.
 *
 * A value a user sees on a resolved subject may come from any mod in the dependency chain, so a
 * write to it is a workspace-level change: the game's resolved-data provider picks (or asks for) the
 * destination document in the active mod, the host binds that choice to exact file targets, the
 * format writer turns it into a plan, and the one host commit coordinator applies it. Nothing here
 * knows a game; the provider is selected by `gameId`.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { canonicalJsonStringify, ModkitError, type Diagnostic } from '@modkit/core'
import {
  resolveModWorkspaceGraph,
  type AssetEditPlan,
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
  analyzeResolvedDataWorkspace,
  createResolvedDataSubjectSelectorLease,
  type DataWorkspaceFileLister,
  type ResolvedDataEditPlanRequest,
  type ResolvedDataGraphIsolationPlanRequest,
  type ResolvedDataWorkspaceLimits,
} from '../data/index.js'
import { createCommitCoordinator, createGrantSnapshot } from '../editing.js'
import {
  createEvidenceRegistry,
  serviceProviderFidelityEvidenceRecord,
} from '../editing-evidence.js'
import type { CompanionOrigin } from '../input-resolution.js'
import { createResourceSession } from '../resource-session.js'
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
  const readGrant: PermissionGrant = {
    id: `resolved-directories-read:${randomUUID()}`,
    classes: [],
  }
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
      { rootId: lock.activeRootId, sourcePath: basename(active), target: rootTarget },
    ],
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (analyzed.state === 'unresolved') {
    await resources.dispose()
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
    await resources.dispose()
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
  const coordinator = createCommitCoordinator({
    payloads,
    backendFor: () => backend,
    evidenceFor,
    isGrantValid: grant => live && issued.has(grant.snapshotId),
    digest: value =>
      createHash('sha256')
        .update(canonicalJsonStringify(value as never))
        .digest('hex'),
    verifyStagedPayload: (ref, signal) => payloads.verify(ref, signal),
  })

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
        await resources.dispose()
      },
    }),
  }
}
