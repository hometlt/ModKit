import { diagnostic, ModkitError } from '@modkit/core'
import type {
  AssetSession,
  AssetSessionEvent,
  DataSourceMajor,
  DataSourceOf,
  JsonValue,
  KnownDataSourceId,
  Lease,
  OperationResult,
  OperationSession,
  ResourceBudget,
  RevisionId,
} from '@modkit/sdk'
import { snapshotJson } from './json-snapshot.js'

/** Delay inspection until the host has bound this selected session's resource context.
 * Every consumer shares one initialization; failed initialization is never silently retried. */
export function deferAssetSession(
  revision: RevisionId,
  initialize: (signal: AbortSignal) => Promise<AssetSession>,
  budget: ResourceBudget,
  openingSignal?: AbortSignal,
): AssetSession {
  const controller = new AbortController()
  const signal =
    openingSignal === undefined
      ? controller.signal
      : AbortSignal.any([openingSignal, controller.signal])
  let pending: Promise<AssetSession> | undefined
  let resolved: AssetSession | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let release: Promise<void> | undefined
  const releaseResolved = (): Promise<void> => {
    if (release === undefined) release = resolved?.dispose() ?? Promise.resolve()
    return release
  }
  const requireLive = (): void => {
    if (disposed)
      throw new ModkitError({
        code: 'x3.host/session-disposed',
        message: 'the deferred asset session has been disposed',
      })
    signal.throwIfAborted()
  }
  const get = async (): Promise<AssetSession> => {
    requireLive()
    pending ??= Promise.resolve().then(async () => {
      requireLive()
      resolved = await initialize(signal)
      try {
        requireLive()
        if (resolved.revision !== revision)
          throw new ModkitError({
            code: 'x3.host/subject-session-identity-mismatch',
            message: 'deferred inspection changed the selected source revision',
          })
        return resolved
      } catch (error) {
        await releaseResolved()
        throw error
      }
    })
    const session = await pending
    requireLive()
    return session
  }
  const waitForSession = (waitSignal: AbortSignal): Promise<AssetSession | undefined> => {
    if (waitSignal.aborted) return Promise.resolve(undefined)
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (action: () => void): void => {
        if (finished) return
        finished = true
        waitSignal.removeEventListener('abort', onAbort)
        action()
      }
      const onAbort = (): void => finish(() => resolve(undefined))
      waitSignal.addEventListener('abort', onAbort, { once: true })
      void get().then(
        session => finish(() => resolve(session)),
        error => finish(() => reject(error)),
      )
    })
  }
  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal
    disposed = true
    controller.abort()
    disposal = (async () => {
      if (pending === undefined) return
      // Initialization owns its source leases until it returns a session. Its rejection has
      // already reached callers; disposal still waits for cleanup without starting another open.
      await pending.catch(() => undefined)
      if (resolved !== undefined) await releaseResolved()
    })()
    return disposal
  }
  const rejected = (
    reason: 'cancelled' | 'input-not-serializable',
    message: string,
  ): OperationResult => ({
    state: 'rejected',
    reason,
    diagnostics: [diagnostic('error', `x3.host/${reason}`, message)],
  })
  const operations = Object.freeze<OperationSession>({
    async invoke(handlerId, input, options) {
      if (disposed || signal.aborted || options?.signal?.aborted)
        return rejected('cancelled', 'the deferred operation was cancelled before dispatch')
      // Capture arguments before waiting for inspection; the caller may mutate its input while
      // companion resources are being resolved. The real session retains permission dispatch.
      let owned: JsonValue
      try {
        owned = snapshotJson(
          input,
          {
            maxDepth: budget.maxDepth,
            maxNodes: budget.maxNodes,
            maxBytes: budget.maxScalarBytes,
          },
          options?.signal,
        )
      } catch {
        return rejected('input-not-serializable', 'operation input must be bounded JSON data')
      }
      const invokeSignal =
        options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal])
      const invokeOptions = { ...options, signal: invokeSignal }
      try {
        const session = await waitForSession(invokeSignal)
        if (session === undefined || invokeSignal.aborted)
          return rejected('cancelled', 'the deferred operation was cancelled')
        const result = await session.operations().invoke(handlerId, owned, invokeOptions)
        if (disposed || invokeSignal.aborted)
          return rejected('cancelled', 'the deferred operation was cancelled')
        return result
      } catch (error) {
        if (disposed || signal.aborted || invokeOptions?.signal?.aborted)
          return rejected('cancelled', 'the deferred operation was cancelled')
        throw error
      }
    },
    dispose,
  })
  return Object.freeze<AssetSession>({
    revision,
    state: () => (disposed ? 'disposed' : (resolved?.state() ?? 'live')),
    async descriptor() {
      const descriptor = await (await get()).descriptor()
      requireLive()
      return descriptor
    },
    async dataSource<Contract extends KnownDataSourceId, Major extends DataSourceMajor<Contract>>(
      contract: Contract,
      major: Major,
    ): Promise<Lease<DataSourceOf<Contract, Major>>> {
      const lease = await (await get()).dataSource(contract, major)
      try {
        requireLive()
        return lease
      } catch (error) {
        await lease.release()
        throw error
      }
    },
    operations: () => operations,
    async *events(eventSignal?: AbortSignal): AsyncIterable<AssetSessionEvent> {
      const waitSignal = eventSignal === undefined ? signal : AbortSignal.any([signal, eventSignal])
      const session = await waitForSession(waitSignal)
      if (session === undefined || waitSignal.aborted) return
      yield* session.events(waitSignal)
    },
    dispose,
  })
}
