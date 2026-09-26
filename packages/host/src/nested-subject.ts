/**
 * Opening a container entry as a subject in its own right (block 9, step 1 — archive slice).
 *
 * Until now no product could do this. The web archive stage says so in as many words — "reopening
 * a nested source is the host's job and this host has no namespace routing yet" — and Electron's
 * says the same; both settle for extracting an entry's bytes to show a preview. This module is
 * that missing route, and it is deliberately a *host* route: a product hands over the parent
 * session and an entry id, and gets back the same `OpenSubjectResult` any other subject produces.
 *
 * Two things make it more than a convenience wrapper:
 *
 * 1. **The nested subject keeps its container.** The parent's entry listing is leased for as long
 *    as the child lives, and the child's companion resolution runs against *that* namespace — so a
 *    W3D inside a BIG finds its texture inside the same BIG, through the container's own bounded
 *    extraction, never through a temporary file on disk.
 * 2. **The container outlives the child, and not by accident.** Every lease taken here is released
 *    exactly once: immediately if the open does not resolve, and otherwise when the child session
 *    is disposed. The suite counts them at each failure point, because a retained parent lease that
 *    leaks is a file handle a long-running host never gets back.
 *
 * Nothing here knows what a BIG is. It asks the parent for a namespace listing and for the standard
 * `container.extract` operation; a ZIP, a CASC or anything else that publishes the same two
 * surfaces routes through this function unchanged.
 */

import { ModkitError, throwIfAborted, type Diagnostic } from '@modkit/core'
import {
  type AnyDescriptor,
  type AssetSession,
  type ByteRangeSource,
  type HostPolicy,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type OpenIntent,
  type PermissionGrant,
  type ResourceBudget,
  type ResourceRole,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type ContributionSettings,
  type VideoFrameDecoder,
} from '@modkit/sdk'
import { rootSubject, subjectRefEquals, type SubjectRef } from '@modkit/sdk/subjects'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import type { Inventory } from './inventory.js'
import {
  createCompanionInputResolver,
  normalizeCompanionLogicalId,
  type CompanionCaseSensitivity,
  type CompanionResolutionLimits,
  type CompanionTraitProbe,
} from './input-resolution.js'
import {
  containerEntryRangeSource,
  containerEntryRevision,
  containerEntrySource,
  createNamespaceCompanionOrigin,
  createWorkspaceNamespaceCompanionOrigin,
  createWorkspaceNamespaceCandidateDiscovery,
  type WorkspaceNamespaceCandidateSearch,
  type WorkspaceNamespaceCandidateDiscoveryLimits,
  type WorkspaceNamespaceLogicalRoot,
  NESTED_ENTRY_NOT_FOUND,
} from './namespace-origin.js'
import { openSubject, type OpenSubjectResult } from './subject-open.js'
import type { SubjectServices } from './subject-services.js'
import type {
  HostLogicalResourceDiscoveryPolicy,
  HostLogicalResourceDiscoveryContext,
} from './logical-resources.js'

/** The parent subject publishes no entry listing, or no bounded extraction for its entries. */
export const NESTED_SUBJECT_UNSUPPORTED = 'x3.host/nested-subject-unsupported'
/** The parent's extraction refused, or answered with something other than bytes. */
export const NESTED_ENTRY_UNREADABLE = 'x3.host/nested-entry-unreadable'

/** The standard container operation this route needs; a container declares it or it is not one. */
const CONTAINER_EXTRACT = 'container.extract'
const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'
const BYTE_RANGE_SOURCE = 'common.view/byte-range-source'

/** Host-selected discovery policies inside the same explicit roots as resource resolution. */
export interface NestedLogicalResourceSearch {
  readonly role: ResourceRole
  readonly extension: string
  readonly searches: readonly WorkspaceNamespaceCandidateSearch[]
  readonly limits: WorkspaceNamespaceCandidateDiscoveryLimits
}

export interface NestedSubjectOptions {
  /** The opened container subject. It stays the caller's to dispose; this route never disposes it. */
  readonly parent: AssetSession
  /** Opaque entry id from the parent's own `NamespaceEntrySource.list`. */
  readonly entryId: string
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  readonly intent?: Exclude<OpenIntent, 'probe'>
  readonly executionBackends?: ExecutionBackendRegistry
  readonly policy?: HostPolicy
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
  /** The host's settings for the entry's codec, as for any subject the host opens. */
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
  /** The desktop host's video frame decoder, so a video entry reads frames like a video file. */
  readonly videoFrames?: VideoFrameDecoder
  readonly minimumConfidence?: number
  readonly maxCandidates?: number
  /** Bounded host-owned validation for requirements that declare `expected` traits. */
  readonly traitProbe?: CompanionTraitProbe
  readonly limits?: Partial<CompanionResolutionLimits>
  readonly caseSensitivity?: CompanionCaseSensitivity
  /** Explicit active/dependency roots in this container, in precedence order. When supplied,
   * resource-relative names are confined to these roots instead of the whole archive. */
  readonly logicalRoots?: readonly WorkspaceNamespaceLogicalRoot[]
  /** Optional bounded searches chosen by the game/workspace host; never supplied by a codec. */
  readonly resourceDiscovery?: readonly NestedLogicalResourceSearch[]
  /** Entries per listing page requested from the container. */
  readonly pageLimit?: number
  /** Named non-fatal companion outcomes (an absent optional companion, an unserved scope). */
  readonly onDiagnostic?: (item: Diagnostic) => void
  readonly signal?: AbortSignal
}

/**
 * The four things a nested open needs from the composition that produced the parent.
 *
 * Assembling them by hand is a trap with one silent failure mode, and slice 13B walked into it: a
 * caller that passes `inventory`, `target` and `executionBackends` but forgets `serviceDefinitions`
 * opens most formats perfectly and fails *only* on the codecs that use a service contribution —
 * CSV, INI, JSON, TOML, XML, YAML — with `x3.host/service-contract-unregistered`. Three products
 * now open nested subjects; spelling this bundle out three times means two of them are one
 * oversight away from a format-shaped hole.
 */
export function nestedSubjectServices(
  services: Pick<
    SubjectServices,
    | 'inventory'
    | 'target'
    | 'executionBackends'
    | 'serviceDefinitions'
    | 'contributionSettings'
    | 'videoFrames'
  >,
): Pick<
  NestedSubjectOptions,
  | 'inventory'
  | 'target'
  | 'executionBackends'
  | 'serviceDefinitions'
  | 'contributionSettings'
  | 'videoFrames'
> {
  return {
    inventory: services.inventory,
    target: services.target,
    executionBackends: services.executionBackends,
    ...(services.serviceDefinitions === undefined
      ? {}
      : { serviceDefinitions: services.serviceDefinitions }),
    ...(services.contributionSettings === undefined
      ? {}
      : { contributionSettings: services.contributionSettings }),
    ...(services.videoFrames === undefined ? {} : { videoFrames: services.videoFrames }),
  }
}

export interface NestedSubjectResult {
  readonly result: OpenSubjectResult
  /** The entry the child subject was opened from, as the container described it. */
  readonly entry: NamespaceEntry
}

/** Exact root-subject target resolved from a container's own published entry references. */
export interface NestedSubjectRefOptions extends Omit<NestedSubjectOptions, 'entryId'> {
  readonly targetSubject: SubjectRef
}

/** The target is not a root asset, or no unique namespace entry publishes its source identity. */
export const NESTED_SUBJECT_REF_UNAVAILABLE = 'x3.host/nested-subject-ref-unavailable'

function extractHandlerOf(descriptor: AnyDescriptor): string {
  const operation = descriptor.operations.find(item => item.id === CONTAINER_EXTRACT)
  if (operation === undefined || operation.state !== 'available') {
    throw new ModkitError({
      code: NESTED_SUBJECT_UNSUPPORTED,
      message: `the parent subject publishes no available ${CONTAINER_EXTRACT} operation`,
      context: {
        operations: descriptor.operations.map(item => item.id),
        ...(operation === undefined ? {} : { state: operation.state, reason: operation.reason }),
      },
    })
  }
  return operation.handlerId
}

async function findEntry(
  namespace: NamespaceEntrySource,
  entryId: string,
  pageLimit: number,
  signal?: AbortSignal,
): Promise<NamespaceEntry> {
  // Entry ids of a container entry table are its paths: an exact lookup reaches an entry the
  // listing cannot enumerate (a hashed archive without its file list) and skips the walk.
  const looked = await namespace.lookup?.(entryId, signal)
  if (looked?.id === entryId) return looked
  let cursor: string | undefined
  do {
    throwIfAborted(signal)
    const page = await namespace.list(
      '',
      cursor === undefined ? { limit: pageLimit } : { cursor, limit: pageLimit },
      signal,
    )
    const found = page.items.find(item => item.id === entryId)
    if (found !== undefined) return found
    cursor = page.nextCursor
  } while (cursor !== undefined)
  throw new ModkitError({
    code: NESTED_ENTRY_NOT_FOUND,
    message: `the parent container has no entry ${entryId}`,
    context: { entryId },
  })
}

/**
 * Resolve a root asset target through the namespace provider's authoritative `openEntry` refs.
 *
 * This deliberately does not parse `source.id` or infer an entry path. Providers own both opaque
 * entry ids and source identities; the host walks a bounded listing, asks for each published ref,
 * and accepts exactly one full `SourceRef` match. The actual open remains `openNestedSubject`, so
 * extraction, companion resolution and parent/child lease ownership have one implementation.
 */
export async function openNestedSubjectRef(
  options: NestedSubjectRefOptions,
): Promise<NestedSubjectResult | undefined> {
  throwIfAborted(options.signal)
  if (options.targetSubject.identity.kind !== '' || options.targetSubject.identity.key !== '') {
    return undefined
  }
  const pageLimit = options.pageLimit ?? 256
  const descriptor = await options.parent.descriptor()
  if (
    !descriptor.dataSources.some(
      item => item.contract === NAMESPACE_ENTRY_SOURCE && item.major === 1,
    )
  ) {
    return undefined
  }
  const namespaceLease = await options.parent.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  try {
    const namespace = namespaceLease.value
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let visited = 0
    let matchedEntryId: string | undefined
    do {
      throwIfAborted(options.signal)
      if (cursor !== undefined && !seenCursors.add(cursor)) return undefined
      const page = await namespace.list(
        '',
        cursor === undefined ? { limit: pageLimit } : { cursor, limit: pageLimit },
        options.signal,
      )
      for (const entry of page.items) {
        visited += 1
        if (visited > options.budget.maxNodes) return undefined
        const refLease = await namespace.openEntry(entry.id, options.signal)
        let matches = false
        try {
          matches = subjectRefEquals(
            rootSubject({ id: refLease.value.uri }, options.targetSubject.workspace),
            options.targetSubject,
          )
        } finally {
          await refLease.release()
        }
        if (!matches) continue
        if (matchedEntryId !== undefined && matchedEntryId !== entry.id) return undefined
        matchedEntryId = entry.id
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
    if (matchedEntryId === undefined) return undefined
    return openNestedSubject({ ...options, entryId: matchedEntryId })
  } finally {
    await namespaceLease.release()
  }
}

/**
 * Opens one entry of an already-open container as a subject, with its companions resolved inside
 * the same container.
 *
 * The returned session owns the container leases this route took: dispose it and they go, in that
 * order. If the open does not resolve — no codec claimed the entry, a required companion was
 * missing, the codec threw — they are released here, before returning.
 */
export async function openNestedSubject(
  options: NestedSubjectOptions,
): Promise<NestedSubjectResult> {
  throwIfAborted(options.signal)
  // Capture caller-owned context before the parent descriptor/listing can yield.
  const caseSensitivity = options.caseSensitivity
  const logicalRoots = options.logicalRoots?.map(root => {
    if (typeof root.rootId !== 'string' || root.rootId.length === 0)
      throw new TypeError('nested logical root requires an id')
    return Object.freeze({
      rootId: root.rootId,
      pathPrefix: root.pathPrefix === '' ? '' : normalizeCompanionLogicalId(root.pathPrefix),
      ...(root.logicalPrefix === undefined
        ? {}
        : {
            logicalPrefix:
              root.logicalPrefix === '' ? '' : normalizeCompanionLogicalId(root.logicalPrefix),
          }),
    })
  })
  const resourceDiscovery = options.resourceDiscovery?.map(policy =>
    Object.freeze({
      role: policy.role,
      extension: policy.extension,
      searches: Object.freeze(
        policy.searches.map(search =>
          Object.freeze({
            rootId: search.rootId,
            logicalPrefix: search.logicalPrefix,
          }),
        ),
      ),
      limits: Object.freeze({ ...policy.limits }),
    }),
  )
  if (
    resourceDiscovery !== undefined &&
    (logicalRoots === undefined || resourceDiscovery.length > options.budget.maxNodes)
  )
    throw new TypeError(
      'nested discovery requires explicit logical roots and a bounded policy list',
    )
  if (
    logicalRoots !== undefined &&
    (logicalRoots.length === 0 ||
      logicalRoots.length > options.budget.maxNodes ||
      new Set(logicalRoots.map(root => root.rootId)).size !== logicalRoots.length)
  )
    throw new TypeError('nested logical roots must have unique ids within the node budget')
  const pageLimit = options.pageLimit ?? 256
  const descriptor = await options.parent.descriptor()
  const handlerId = extractHandlerOf(descriptor)
  if (
    !descriptor.dataSources.some(
      item => item.contract === NAMESPACE_ENTRY_SOURCE && item.major === 1,
    )
  ) {
    throw new ModkitError({
      code: NESTED_SUBJECT_UNSUPPORTED,
      message: `the parent subject publishes no ${NAMESPACE_ENTRY_SOURCE}@1`,
      context: { dataSources: descriptor.dataSources.map(item => item.contract) },
    })
  }

  const namespaceLease = await options.parent.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  /*
   * From here on every exit runs through `release`, including the successful one — which hands the
   * job to the child session's dispose instead of doing it now. `released` makes that idempotent:
   * a caller who disposes twice must not release a container lease twice.
   */
  let released = false
  const release = async (): Promise<void> => {
    if (released) return
    released = true
    await namespaceLease.release()
  }

  try {
    const namespace = namespaceLease.value
    const entry = await findEntry(namespace, options.entryId, pageLimit, options.signal)
    const primaryLogicalId =
      logicalRoots === undefined
        ? entry.path
        : logicalEntryPath(entry.path, logicalRoots, caseSensitivity)
    const extract = async (entryId: string, signal?: AbortSignal): Promise<Uint8Array> => {
      throwIfAborted(signal ?? options.signal)
      const invoked = await options.parent
        .operations()
        .invoke(handlerId, { entryId }, signal === undefined ? {} : { signal })
      if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') {
        throw new ModkitError({
          code: NESTED_ENTRY_UNREADABLE,
          message: `the container refused to extract entry ${entryId}`,
          context: {
            entryId,
            state: invoked.state,
            ...(invoked.state === 'rejected' ? { reason: invoked.reason } : {}),
            ...(invoked.state === 'ok' ? { outputKind: invoked.output.kind } : {}),
          },
        })
      }
      return invoked.output.value
    }

    const refLease = await namespace.openEntry(entry.id, options.signal)
    // An uncompressed entry is read in place from the parent's byte-range source, so an entry of any
    // size opens without being extracted; everything else is extracted within the open budget.
    const rangeLease =
      entry.storedRange !== undefined &&
      descriptor.dataSources.some(item => item.contract === BYTE_RANGE_SOURCE && item.major === 1)
        ? await options.parent.dataSource(BYTE_RANGE_SOURCE, 1)
        : undefined
    const previousRelease = release
    let refReleased = false
    const releaseAll = async (): Promise<void> => {
      if (!refReleased) {
        refReleased = true
        await refLease.release()
        await rangeLease?.release()
      }
      await previousRelease()
    }

    try {
      let source: ReturnType<typeof containerEntrySource>
      if (rangeLease !== undefined && entry.storedRange !== undefined) {
        source = containerEntryRangeSource(
          refLease.value,
          containerEntryRevision(descriptor.revision, entry.id, entry.storedRange.length),
          rangeLease.value as ByteRangeSource,
          entry.storedRange,
        )
      } else {
        const bytes = await extract(entry.id, options.signal)
        source = containerEntrySource(
          refLease.value,
          containerEntryRevision(descriptor.revision, entry.id, bytes.byteLength),
          bytes,
        )
      }
      const originOptions = {
        namespace,
        primaryLogicalId,
        containerRevision: descriptor.revision,
        extract,
        ...(caseSensitivity === undefined ? {} : { caseSensitivity }),
        pageLimit,
      }
      const origin =
        logicalRoots === undefined
          ? createNamespaceCompanionOrigin(originOptions)
          : createWorkspaceNamespaceCompanionOrigin({
              ...originOptions,
              logicalRoots,
            })
      const logicalResourceDiscovery: readonly HostLogicalResourceDiscoveryPolicy[] | undefined =
        resourceDiscovery?.map(policy =>
          Object.freeze({
            role: policy.role,
            extension: policy.extension,
            async discover(context: HostLogicalResourceDiscoveryContext) {
              if (logicalRoots === undefined)
                throw new TypeError('nested discovery roots are absent')
              const allowedBytes =
                context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes)
                  ? context.budget.maxInputBytes
                  : BigInt(context.budget.maxScalarBytes)
              const discovery = createWorkspaceNamespaceCandidateDiscovery({
                namespace,
                containerRevision: descriptor.revision,
                logicalRoots,
                searches: policy.searches,
                extension: policy.extension,
                ...(caseSensitivity === undefined ? {} : { caseSensitivity }),
                limits: {
                  pageItems: Math.min(policy.limits.pageItems, context.budget.maxNodes),
                  maxPages: Math.min(policy.limits.maxPages, context.budget.maxNodes),
                  maxEntries: Math.min(policy.limits.maxEntries, context.budget.maxNodes),
                  maxCandidates: Math.min(policy.limits.maxCandidates, context.budget.maxNodes),
                  maxBytes:
                    policy.limits.maxBytes < allowedBytes ? policy.limits.maxBytes : allowedBytes,
                },
              })
              const result = await discovery.discover(context.signal)
              if (result.state === 'refused') return result
              const fold = (id: string) => (caseSensitivity === 'sensitive' ? id : id.toLowerCase())
              // A source is not its own companion. Keep namespace enumeration statistics, while
              // the admitted candidate/byte counts describe exactly the returned source list.
              const candidates = result.candidates.filter(
                candidate => fold(candidate.logicalId) !== fold(primaryLogicalId),
              )
              return Object.freeze({
                state: 'complete' as const,
                context: Object.freeze({ primaryLogicalId }),
                candidates: Object.freeze(candidates),
                receipt: Object.freeze({
                  ...result.receipt,
                  candidates: candidates.length,
                  bytes: candidates.reduce((sum, candidate) => sum + candidate.size, 0n),
                }),
              })
            },
          }),
        )
      const result = await openSubject({
        inventory: options.inventory,
        source,
        path: entry.path,
        // An entry with no extension or signature (Emperor BAG sounds) says what it holds.
        ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
        intent: options.intent ?? 'full',
        target: options.target,
        grant: options.grant,
        budget: options.budget,
        ...(logicalResourceDiscovery === undefined ? {} : { logicalResourceDiscovery }),
        resolveInput: createCompanionInputResolver(origin, {
          ...(options.traitProbe === undefined ? {} : { traitProbe: options.traitProbe }),
          ...(options.limits === undefined ? {} : { limits: options.limits }),
          ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
          ...(options.budget.deadlineMs === undefined
            ? {}
            : { deadlineMs: options.budget.deadlineMs }),
        }),
        ...(options.executionBackends === undefined
          ? {}
          : { executionBackends: options.executionBackends }),
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        ...(options.serviceDefinitions === undefined
          ? {}
          : { serviceDefinitions: options.serviceDefinitions }),
        ...(options.contributionSettings === undefined
          ? {}
          : { contributionSettings: options.contributionSettings }),
        ...(options.videoFrames === undefined ? {} : { videoFrames: options.videoFrames }),
        ...(options.minimumConfidence === undefined
          ? {}
          : { minimumConfidence: options.minimumConfidence }),
        ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })

      if (result.state !== 'opened') {
        await releaseAll()
        return Object.freeze({ result, entry })
      }
      return Object.freeze({
        result: Object.freeze({
          ...result,
          session: sessionHoldingContainer(result.session, releaseAll),
        }),
        entry,
      })
    } catch (error) {
      await releaseAll()
      throw error
    }
  } catch (error) {
    await release()
    throw error
  }
}

/** The entry's resource-relative identity, using the same explicit prefix projection as its
 * companions. This keeps self-reference exclusion valid inside a projected archive root. */
function logicalEntryPath(
  entryPath: string,
  roots: readonly WorkspaceNamespaceLogicalRoot[],
  caseSensitivity: CompanionCaseSensitivity = 'insensitive',
): string {
  const normalized = normalizeCompanionLogicalId(entryPath)
  const fold = (value: string) => (caseSensitivity === 'insensitive' ? value.toLowerCase() : value)
  for (const root of roots) {
    const prefix = root.pathPrefix === '' ? '' : `${root.pathPrefix}/`
    if (!fold(normalized).startsWith(fold(prefix))) continue
    const relative = normalized.slice(prefix.length)
    if (relative === '') continue
    return root.logicalPrefix ? `${root.logicalPrefix}/${relative}` : relative
  }
  throw new TypeError('nested entry is outside the declared logical roots')
}

/** The child session, with the container leases it depends on attached to its own disposal. */
function sessionHoldingContainer(
  session: AssetSession,
  release: () => Promise<void>,
): AssetSession {
  let disposed = false
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource: session.dataSource.bind(session) as AssetSession['dataSource'],
    operations: () => session.operations(),
    events: (signal?: AbortSignal) => session.events(signal),
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      let firstError: unknown
      try {
        await session.dispose()
      } catch (error) {
        firstError = error
      }
      // the container is released even when the child's own disposal threw: a failed teardown
      // must not also strand the archive that outlives it
      try {
        await release()
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
    },
  })
}
