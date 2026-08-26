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

import { ModkitError, throwIfAborted, type Diagnostic } from '@modkitx-x3/core'
import {
  type AnyDescriptor,
  type AssetSession,
  type HostPolicy,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type OpenIntent,
  type PermissionGrant,
  type ResourceBudget,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
} from '@modkitx-x3/sdk'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import type { Inventory } from './inventory.js'
import {
  createCompanionInputResolver,
  type CompanionCaseSensitivity,
  type CompanionResolutionLimits,
  type CompanionTraitProbe,
} from './input-resolution.js'
import {
  containerEntryRevision,
  containerEntrySource,
  createNamespaceCompanionOrigin,
  NESTED_ENTRY_NOT_FOUND,
} from './namespace-origin.js'
import { openSubject, type OpenSubjectResult } from './subject-open.js'
import type { SubjectServices } from './subject-services.js'

/** The parent subject publishes no entry listing, or no bounded extraction for its entries. */
export const NESTED_SUBJECT_UNSUPPORTED = 'x3.host/nested-subject-unsupported'
/** The parent's extraction refused, or answered with something other than bytes. */
export const NESTED_ENTRY_UNREADABLE = 'x3.host/nested-entry-unreadable'

/** The standard container operation this route needs; a container declares it or it is not one. */
const CONTAINER_EXTRACT = 'container.extract'
const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'

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
  readonly minimumConfidence?: number
  readonly maxCandidates?: number
  /** Bounded host-owned validation for requirements that declare `expected` traits. */
  readonly traitProbe?: CompanionTraitProbe
  readonly limits?: Partial<CompanionResolutionLimits>
  readonly caseSensitivity?: CompanionCaseSensitivity
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
    'inventory' | 'target' | 'executionBackends' | 'serviceDefinitions'
  >,
): Pick<NestedSubjectOptions, 'inventory' | 'target' | 'executionBackends' | 'serviceDefinitions'> {
  return {
    inventory: services.inventory,
    target: services.target,
    executionBackends: services.executionBackends,
    ...(services.serviceDefinitions === undefined
      ? {}
      : { serviceDefinitions: services.serviceDefinitions }),
  }
}

export interface NestedSubjectResult {
  readonly result: OpenSubjectResult
  /** The entry the child subject was opened from, as the container described it. */
  readonly entry: NamespaceEntry
}

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
    const previousRelease = release
    let refReleased = false
    const releaseAll = async (): Promise<void> => {
      if (!refReleased) {
        refReleased = true
        await refLease.release()
      }
      await previousRelease()
    }

    try {
      const bytes = await extract(entry.id, options.signal)
      const source = containerEntrySource(
        refLease.value,
        containerEntryRevision(descriptor.revision, entry.id, bytes.byteLength),
        bytes,
      )
      const origin = createNamespaceCompanionOrigin({
        namespace,
        primaryLogicalId: entry.path,
        containerRevision: descriptor.revision,
        extract,
        ...(options.caseSensitivity === undefined
          ? {}
          : { caseSensitivity: options.caseSensitivity }),
        pageLimit,
      })
      const result = await openSubject({
        inventory: options.inventory,
        source,
        path: entry.path,
        intent: options.intent ?? 'full',
        target: options.target,
        grant: options.grant,
        budget: options.budget,
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
