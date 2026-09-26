import {
  ModkitError,
  canonicalJsonStringify,
  diagnostic,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
/*
 * Value imports come from their own modules, not the package root.
 *
 * This module is on the codec path — `@modkit/host/codec` re-exports from it — and the root
 * barrel evaluates every schema, registry, language and renderer module of the SDK: ~45 ms in a
 * fresh worker, once per codec activation, for two functions. Types still come from the root,
 * because a type costs nothing to import.
 */
import { grantValidity } from '@modkit/sdk/security'
import { validateSubjectDescriptorV2 } from '@modkit/sdk/descriptor'
import type {
  AnyDescriptor,
  AnyDescriptorWire,
  AssetDiagnostic,
  AssetSession,
  AssetSessionEvent,
  DataSourceMajor,
  DataSourceOf,
  DataSourceOffer,
  JsonValue,
  KnownDataSourceId,
  Lease,
  OperationDecl,
  OperationOutput,
  OperationResult,
  OperationSession,
  PermissionGrant,
  Progress,
  RevisionId,
  SessionState,
  SubjectKindDefinitionSpecV1,
} from '@modkit/sdk'
import type {
  SubjectFieldReferenceResolver,
  SubjectRelationProjectionBudget,
} from './subject-projection.js'
import { metadataFieldProjections } from './subject-field-projections.js'

/**
 * The projection machinery, loaded when something asks for it.
 *
 * A session must know at once whether it can offer a relation graph — that is
 * `metadataFieldProjections` above, arithmetic over the descriptor — but the code that *builds*
 * graphs and composite facts sources is heavy, and a codec asked only for pixels never reaches it.
 * Importing it eagerly cost ~55 ms in every fresh worker, once per first open of every format.
 */
const projection = (): Promise<typeof import('./subject-projection.js')> =>
  import('./subject-projection.js')

export interface HostOperationContext {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Progress) => void
  /** Per-call diagnostics travel with OperationResult, including when the output is bytes. */
  readonly reportDiagnostic?: (value: Diagnostic) => void
}

export type HostOperationHandler = (
  input: JsonValue,
  context: HostOperationContext,
) => Promise<OperationOutput>

export interface AssetSessionOptions {
  /** Bounded per-call diagnostics, default 100; the last slot reports truncation. */
  readonly maxOperationDiagnostics?: number
  readonly revision: RevisionId
  readonly descriptor: AnyDescriptor
  readonly operationDeclarations: readonly OperationDecl[]
  readonly permissionGrant: PermissionGrant
  readonly handlers: ReadonlyMap<string, HostOperationHandler>
  readonly openDataSource: <
    Contract extends KnownDataSourceId,
    Major extends DataSourceMajor<Contract>,
  >(
    contract: Contract,
    major: Major,
  ) => Promise<Lease<DataSourceOf<Contract, Major>>>
  /** Optional host resolver for schema-typed subject, asset and localization references. */
  readonly subjectProjection?: {
    readonly references: SubjectFieldReferenceResolver
    readonly budget?: SubjectRelationProjectionBudget
    readonly kindDefinition?: SubjectKindDefinitionSpecV1
  }
  /** Host-owned resources released exactly once with the session. */
  readonly release?: readonly (() => void | Promise<void>)[]
}

export interface ManagedAssetSession {
  readonly session: AssetSession
  /** Notify the session that the backing source now has this revision. */
  updateSourceRevision(revision: RevisionId): void
}

interface EventSubscriber {
  readonly queue: AssetSessionEvent[]
  wake: (() => void) | undefined
}

function rejected(
  reason: Extract<OperationResult, { readonly state: 'rejected' }>['reason'],
  message: string,
): OperationResult {
  return {
    state: 'rejected',
    reason,
    diagnostics: [diagnostic('error', `x3.host/${reason}`, message)],
  }
}

function snapshotInput(input: JsonValue): JsonValue | undefined {
  try {
    return JSON.parse(canonicalJsonStringify(input)) as JsonValue
  } catch {
    return undefined
  }
}

function snapshotStructured<Value>(value: Value): Value {
  if (value instanceof Uint8Array) return value.slice() as Value
  if (Array.isArray(value))
    return Object.freeze(value.map(item => snapshotStructured(item))) as Value
  if (typeof value === 'object' && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Reflect.ownKeys(value).map(key => [
          key,
          snapshotStructured((value as Record<PropertyKey, unknown>)[key]),
        ]),
      ),
    ) as Value
  }
  return value
}

function snapshotOutput(output: OperationOutput): OperationOutput {
  switch (output.kind) {
    case 'json': {
      const value = snapshotInput(output.value)
      if (value === undefined) {
        throw new ModkitError({
          code: 'x3.host/non-json-operation-output',
          message: 'operation JSON output must be inert JSON data',
        })
      }
      return Object.freeze({ kind: 'json', value })
    }
    case 'bytes':
      return Object.freeze({ kind: 'bytes', value: output.value.slice() })
    case 'source':
      return Object.freeze({
        kind: 'source',
        source: Object.freeze({
          ...output.source,
          ...(output.source.parentIds === undefined
            ? {}
            : {
                parentIds: Object.freeze([...output.source.parentIds]) as readonly [
                  string,
                  ...string[],
                ],
              }),
        }),
      })
    case 'artifact':
      return Object.freeze({ ...output })
    case 'none':
      return Object.freeze({ kind: 'none' })
    case 'stream':
      return Object.freeze({ kind: 'stream', stream: output.stream })
    case 'edit-plan':
      return Object.freeze({ kind: 'edit-plan', plan: snapshotStructured(output.plan) })
    case 'transaction':
      return Object.freeze({ kind: 'transaction', receipt: snapshotStructured(output.receipt) })
  }
}

function staleDiagnostic(expected: RevisionId, actual: RevisionId): AssetDiagnostic {
  return Object.freeze({
    id: 'session-stale-revision',
    category: 'operation',
    ...diagnostic(
      'error',
      'x3.host/stale-revision',
      `asset session revision ${expected} no longer matches source revision ${actual}`,
    ),
  }) as AssetDiagnostic
}

/**
 * Assemble the portable descriptor through the one schema + semantic authority. The host never
 * publishes a descriptor assembled by casts or by copying an extension-owned object.
 */
export async function assembleSubjectDescriptor(value: AnyDescriptorWire): Promise<AnyDescriptor> {
  const result = await validateSubjectDescriptorV2(value)
  if (result.descriptor !== undefined) return result.descriptor
  throw new ModkitError({
    code: 'x3.host/invalid-subject-descriptor',
    message: 'subject descriptor assembly failed validation',
    context: {
      diagnostics: result.diagnostics.map(item => ({
        code: item.code,
        severity: item.severity,
        message: item.message,
        ...(item.path === undefined ? {} : { path: item.path }),
      })),
    },
  })
}

/** Host-owned session reference implementation for the A-3 lifecycle contract. */
export function createAssetSession(options: AssetSessionOptions): ManagedAssetSession {
  const maxOperationDiagnostics = options.maxOperationDiagnostics ?? 100
  if (!Number.isSafeInteger(maxOperationDiagnostics) || maxOperationDiagnostics < 0)
    throw new TypeError('invalid maxOperationDiagnostics')
  const originalDescriptor = options.descriptor
  const originalOffers = new Set(
    originalDescriptor.dataSources.map(item => `${item.contract}@${item.major}`),
  )
  const metadataFields =
    originalDescriptor.interpretation === 'codec'
      ? metadataFieldProjections(originalDescriptor.metadata)
      : Object.freeze([])
  const projectsRelations = options.subjectProjection !== undefined && metadataFields.length > 0
  const added: DataSourceOffer[] = []
  if (!originalOffers.has('common.view/subject-facts-source@1')) {
    added.push({ contract: 'common.view/subject-facts-source', major: 1 })
  }
  if (projectsRelations && !originalOffers.has('common.view/relation-graph-source@1')) {
    added.push({ contract: 'common.view/relation-graph-source', major: 1 })
  }
  const descriptor = Object.freeze({
    ...originalDescriptor,
    dataSources: Object.freeze([...originalDescriptor.dataSources, ...added]),
    ...(added.length === 0 ? {} : { hostDataSources: Object.freeze(added) }),
  }) as AnyDescriptor
  const operationByHandler = new Map(descriptor.operations.map(item => [item.handlerId, item]))
  const declarationByHandler = new Map(
    options.operationDeclarations.map(item => [item.handlerId, item]),
  )
  const handlers = new Map(options.handlers)
  const releases = [...(options.release ?? [])]
  const subscribers = new Set<EventSubscriber>()
  let state: SessionState = 'live'
  let disposal: Promise<void> | undefined

  let genericGraph: Promise<DataSourceOf<'common.view/relation-graph-source', 1>> | undefined
  const projectedGraph = (): Promise<DataSourceOf<'common.view/relation-graph-source', 1>> => {
    if (options.subjectProjection === undefined) {
      throw new TypeError('subject relation projection is unavailable')
    }
    const relations = options.subjectProjection
    genericGraph ??= (async () => {
      const built = await projection()
      return built.createFieldRelationGraphSource({
        owner: built.descriptorSubjectRef(originalDescriptor),
        ownerLabel:
          originalDescriptor.interpretation === 'codec'
            ? originalDescriptor.identity.formatLabel
            : originalDescriptor.subjectUri,
        ownerKind:
          originalDescriptor.interpretation === 'codec'
            ? `format:${originalDescriptor.identity.formatId}`
            : 'format:unknown',
        fields: metadataFields,
        resolver: relations.references,
        ...(relations.budget === undefined ? {} : { budget: relations.budget }),
      })
    })()
    return genericGraph
  }

  const releaseTogether = <Value>(
    value: Value,
    callbacks: readonly (() => Promise<void>)[],
  ): Lease<Value> => {
    let released = false
    return Object.freeze({
      value,
      async release() {
        if (released) return
        released = true
        const results = await Promise.allSettled(
          [...callbacks].reverse().map(callback => callback()),
        )
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      },
    })
  }

  const openGraph = async (): Promise<
    Lease<DataSourceOf<'common.view/relation-graph-source', 1>>
  > => {
    const authoritative = originalOffers.has('common.view/relation-graph-source@1')
      ? await options.openDataSource('common.view/relation-graph-source', 1)
      : undefined
    try {
      const generic = projectsRelations ? await projectedGraph() : undefined
      if (authoritative !== undefined && generic !== undefined) {
        const built = await projection()
        return releaseTogether(
          built.createCompositeRelationGraphSource([authoritative.value, generic]),
          [authoritative.release],
        )
      }
      if (authoritative !== undefined) return authoritative
      if (generic !== undefined) return releaseTogether(generic, [])
      throw new TypeError('relation graph source is unavailable')
    } catch (error) {
      await authoritative?.release()
      throw error
    }
  }

  const openFacts = async (): Promise<
    Lease<DataSourceOf<'common.view/subject-facts-source', 1>>
  > => {
    const graph =
      originalOffers.has('common.view/relation-graph-source@1') || projectsRelations
        ? await openGraph()
        : undefined
    let authoritative: Lease<DataSourceOf<'common.view/subject-facts-source', 1>> | undefined
    try {
      authoritative = originalOffers.has('common.view/subject-facts-source@1')
        ? await options.openDataSource('common.view/subject-facts-source', 1)
        : undefined
      const built = await projection()
      const fallback = built.createDescriptorFallbackSubjectFactsSource({
        descriptor: originalDescriptor,
        ...(graph === undefined ? {} : { relations: graph.value }),
        ...(options.subjectProjection?.kindDefinition === undefined
          ? {}
          : { kindDefinition: options.subjectProjection.kindDefinition }),
      })
      return releaseTogether(
        authoritative === undefined
          ? fallback
          : built.createCompositeSubjectFactsSource([authoritative.value, fallback]),
        [
          ...(authoritative === undefined ? [] : [authoritative.release]),
          ...(graph === undefined ? [] : [graph.release]),
        ],
      )
    } catch (error) {
      await Promise.allSettled([
        ...(authoritative === undefined ? [] : [authoritative.release()]),
        ...(graph === undefined ? [] : [graph.release()]),
      ])
      throw error
    }
  }

  const publish = (event: AssetSessionEvent) => {
    for (const subscriber of subscribers) {
      subscriber.queue.push(event)
      subscriber.wake?.()
      subscriber.wake = undefined
    }
  }

  const operations: OperationSession = {
    async invoke(handlerId, input, invokeOptions = {}) {
      const operation = operationByHandler.get(handlerId)
      const declaration = declarationByHandler.get(handlerId)
      if (operation === undefined || declaration === undefined || declaration.id !== operation.id) {
        return rejected('not-declared', `handler ${handlerId} is not declared by this asset`)
      }
      if (operation.state === 'disabled') {
        return rejected('disabled', operation.reason)
      }
      if (operation.state === 'dependency-required') {
        return rejected('dependency-required', operation.reason)
      }
      if (state === 'stale-revision') {
        return rejected('stale-revision', 'the source changed; reopen the asset explicitly')
      }
      if (state === 'disposed') {
        return rejected('cancelled', 'the asset session has been disposed')
      }
      if (invokeOptions.signal?.aborted) {
        return rejected('cancelled', 'the operation was cancelled before dispatch')
      }
      const required = declaration.requiredPermissions ?? []
      const validity = grantValidity(options.permissionGrant)
      const missing = required.filter(item => !options.permissionGrant.classes.includes(item))
      if (validity.state !== 'valid' || missing.length > 0) {
        return rejected(
          'permission-missing',
          validity.state === 'valid'
            ? `operation requires permissions: ${missing.join(', ')}`
            : 'the operation permission grant is not valid',
        )
      }
      const ownedInput = snapshotInput(input)
      if (ownedInput === undefined) {
        return rejected('input-not-serializable', 'operation input must be inert JSON data')
      }
      const handler = handlers.get(handlerId)
      if (handler === undefined) {
        return rejected('handler-unregistered', `handler ${handlerId} is not registered`)
      }
      try {
        throwIfAborted(invokeOptions.signal)
        const diagnostics: Diagnostic[] = []
        let reporting = true
        const reportDiagnostic = (value: Diagnostic) => {
          if (!reporting || maxOperationDiagnostics === 0) return
          if (diagnostics.length >= maxOperationDiagnostics) {
            diagnostics[maxOperationDiagnostics - 1] = diagnostic(
              'information',
              'x3.host/operation-diagnostics-truncated',
              'Further operation diagnostics were omitted by the session budget.',
            )
            return
          }
          try {
            const encoded = canonicalJsonStringify(value)
            if (encoded.length > 65_536) throw new TypeError('oversized diagnostic')
            const owned = JSON.parse(encoded) as Diagnostic
            if (
              !['error', 'warning', 'information', 'hint'].includes(owned.severity) ||
              typeof owned.message !== 'string' ||
              typeof owned.code !== 'string'
            )
              throw new TypeError('invalid diagnostic')
            // Validate the qualified code using the same public constructor.
            diagnostic(owned.severity, owned.code, owned.message)
            diagnostics.push(snapshotStructured(owned))
          } catch {
            diagnostics.push(
              diagnostic(
                'warning',
                'x3.host/invalid-operation-diagnostic',
                'An operation diagnostic was not bounded, serializable diagnostic data.',
              ),
            )
          }
        }
        let output: OperationOutput
        try {
          output = snapshotOutput(await handler(ownedInput, { ...invokeOptions, reportDiagnostic }))
        } finally {
          reporting = false
        }
        throwIfAborted(invokeOptions.signal)
        if (
          declaration.outputKinds !== undefined &&
          !declaration.outputKinds.includes(output.kind)
        ) {
          throw new ModkitError({
            code: 'x3.host/undeclared-operation-output',
            message: `handler ${handlerId} returned undeclared output kind ${output.kind}`,
            context: { handlerId, outputKind: output.kind },
          })
        }
        return { state: 'ok', output, diagnostics: Object.freeze(diagnostics) }
      } catch (error) {
        if (isCancellation(error) || invokeOptions.signal?.aborted) {
          return rejected('cancelled', 'the operation was cancelled')
        }
        if (error instanceof ModkitError) throw error
        // the cause never crosses an execution boundary (the protocol carries no stacks and no
        // causes), so the reason a codec refused has to travel in the message — otherwise a
        // worker-brokered caller sees only "operation handler … failed" and cannot tell a
        // deliberate refusal from a crash
        const reason = error instanceof Error ? error.message : String(error)
        throw new ModkitError({
          code: 'x3.host/operation-handler-failed',
          message: `operation handler ${handlerId} failed: ${reason}`,
          context: { handlerId },
          cause: error,
        })
      }
    },
    async dispose() {
      await dispose()
    },
  }

  const dispose = async (): Promise<void> => {
    if (disposal !== undefined) return disposal
    disposal = (async () => {
      state = 'disposed'
      publish({ kind: 'state', state })
      const failures: unknown[] = []
      for (const release of releases.reverse()) {
        try {
          await release()
        } catch (error) {
          failures.push(error)
        }
      }
      for (const subscriber of subscribers) {
        subscriber.wake?.()
        subscriber.wake = undefined
      }
      if (failures.length > 0) {
        throw new ModkitError({
          code: 'x3.host/session-dispose-failed',
          message: `${failures.length} asset session resource release(s) failed`,
          context: { failureCount: failures.length },
          cause: failures[0],
        })
      }
    })()
    return disposal
  }

  const session: AssetSession = Object.freeze({
    revision: options.revision,
    state: () => state,
    descriptor: async () => descriptor,
    async dataSource<Contract extends KnownDataSourceId, Major extends DataSourceMajor<Contract>>(
      contract: Contract,
      major: Major,
    ): Promise<Lease<DataSourceOf<Contract, Major>>> {
      if (state !== 'live') {
        throw new ModkitError({
          code: state === 'stale-revision' ? 'x3.host/stale-revision' : 'x3.host/session-disposed',
          message:
            state === 'stale-revision'
              ? 'the source changed; reopen the asset before accessing data sources'
              : 'the asset session has been disposed',
        })
      }
      if (contract === 'common.view/relation-graph-source' && major === 1) {
        return openGraph() as Promise<Lease<DataSourceOf<Contract, Major>>>
      }
      if (contract === 'common.view/subject-facts-source' && major === 1) {
        return openFacts() as Promise<Lease<DataSourceOf<Contract, Major>>>
      }
      return options.openDataSource(contract, major)
    },
    operations: () => operations,
    async *events(signal?: AbortSignal): AsyncIterable<AssetSessionEvent> {
      if (signal?.aborted) return
      yield { kind: 'descriptor', descriptor }
      if (state !== 'live') {
        yield { kind: 'state', state }
        return
      }
      const subscriber: EventSubscriber = { queue: [], wake: undefined }
      subscribers.add(subscriber)
      const onAbort = () => subscriber.wake?.()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        while (!signal?.aborted) {
          const event = subscriber.queue.shift()
          if (event !== undefined) {
            yield event
            if (event.kind === 'state' && event.state === 'disposed') return
            continue
          }
          if ((state as SessionState) === 'disposed') return
          await new Promise<void>(resolve => {
            subscriber.wake = resolve
          })
        }
      } finally {
        subscribers.delete(subscriber)
        signal?.removeEventListener('abort', onAbort)
      }
    },
    dispose,
  })

  return Object.freeze({
    session,
    updateSourceRevision(revision: RevisionId) {
      if (state !== 'live' || revision === options.revision) return
      state = 'stale-revision'
      const item = staleDiagnostic(options.revision, revision)
      publish({ kind: 'diagnostic', diagnostic: item })
      publish({ kind: 'state', state })
    },
  })
}
