import {
  ModkitError,
  canonicalJsonStringify,
  diagnostic,
  isCancellation,
  throwIfAborted,
} from '@modkitx-x3/core'
import {
  grantValidity,
  validateSubjectDescriptorV2,
  type AnyDescriptor,
  type AnyDescriptorWire,
  type AssetDiagnostic,
  type AssetSession,
  type AssetSessionEvent,
  type DataSourceMajor,
  type DataSourceOf,
  type JsonValue,
  type KnownDataSourceId,
  type Lease,
  type OperationDecl,
  type OperationOutput,
  type OperationResult,
  type OperationSession,
  type PermissionGrant,
  type Progress,
  type RevisionId,
  type SessionState,
} from '@modkitx-x3/sdk'

export interface HostOperationContext {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Progress) => void
}

export type HostOperationHandler = (
  input: JsonValue,
  context: HostOperationContext,
) => Promise<OperationOutput>

export interface AssetSessionOptions {
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
  const descriptor = options.descriptor
  const operationByHandler = new Map(descriptor.operations.map(item => [item.handlerId, item]))
  const declarationByHandler = new Map(
    options.operationDeclarations.map(item => [item.handlerId, item]),
  )
  const handlers = new Map(options.handlers)
  const releases = [...(options.release ?? [])]
  const subscribers = new Set<EventSubscriber>()
  let state: SessionState = 'live'
  let disposal: Promise<void> | undefined

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
        const output = snapshotOutput(await handler(ownedInput, invokeOptions))
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
        return { state: 'ok', output, diagnostics: [] }
      } catch (error) {
        if (isCancellation(error) || invokeOptions.signal?.aborted) {
          return rejected('cancelled', 'the operation was cancelled')
        }
        if (error instanceof ModkitError) throw error
        throw new ModkitError({
          code: 'x3.host/operation-handler-failed',
          message: `operation handler ${handlerId} failed`,
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
