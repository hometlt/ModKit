import { ModkitError } from '@modkit/core'
import {
  RUNTIME_PROVIDER_CONTRACT,
  RUNTIME_SESSION_CONTRACT,
  type RuntimeProvider,
  type RuntimeExecutionResult,
} from '@modkit/sdk/runtime'
import type {
  RuntimeProvider as LegacyProvider,
  RuntimeProviderCreateOptions,
} from './runtime/contracts.js'
import { cancellationTokenFromAbortSignal } from './assets/cancellation.js'
import { adaptLegacyError } from './diagnostics.js'

/** Publish through common.runtime/provider; never installs a legacy runtime registry. */
export function adaptRuntimeProvider<T extends RuntimeProviderCreateOptions>(
  legacy: LegacyProvider<T>,
  options: {
    providerId: string
    runtimeIds: readonly string[]
    createOptions: (request: RuntimeProviderCreateOptions) => T
  },
): RuntimeProvider {
  return {
    contract: RUNTIME_PROVIDER_CONTRACT,
    providerId: options.providerId,
    runtimeIds: options.runtimeIds,
    async createSession(request) {
      for (const value of Object.values(request.budget))
        if (!Number.isSafeInteger(value) || value < 0)
          throw new RangeError('Runtime budgets require nonnegative safe integers')
      request.signal?.throwIfAborted()
      const budget = Object.freeze({ ...request.budget })
      const session = await Promise.resolve()
        .then(() =>
          legacy.createSession(
            options.createOptions({
              budget,
              ...(request.signal === undefined
                ? {}
                : { cancellation: cancellationTokenFromAbortSignal(request.signal) }),
            }),
          ),
        )
        .catch(error => {
          throw adaptLegacyError(error)
        })
      let disposed = false,
        executing = false,
        executions = 0,
        ticks = 0,
        memoryBytes = 0
      const usage = () => ({ wallTimeMs: 0, ticks: 0, memoryBytes: 0 })
      return {
        value: {
          contract: RUNTIME_SESSION_CONTRACT,
          sessionId: request.sessionId,
          providerId: options.providerId,
          budget,
          async status() {
            return {
              state: disposed ? 'disposed' : executing ? 'executing' : 'ready',
              executions,
              ticks,
              memoryBytes,
            }
          },
          async execute(call): Promise<RuntimeExecutionResult> {
            const refused = (
              reason: 'cancelled' | 'session-disposed' | 'unsupported-runtime-subset',
              message: string,
            ): RuntimeExecutionResult => ({
              state: 'refused',
              reason,
              message,
              usage: usage(),
              diagnostics: [],
            })
            if (disposed)
              return refused('session-disposed', 'Legacy runtime lease has been released')
            if (call.signal?.aborted)
              return refused('cancelled', 'Execution cancelled before admission')
            if (executing)
              throw new ModkitError({
                code: 'codec-kit/runtime-busy',
                message: 'Concurrent legacy executions are not admitted',
              })
            if (!session.capabilities.includes('execute'))
              return refused('unsupported-runtime-subset', 'Legacy provider does not offer execute')
            for (const value of Object.values(call.resources))
              if (!Number.isSafeInteger(value) || value < 0)
                throw new RangeError('Runtime reservations require nonnegative safe integers')
            for (const [reason, requested, limit] of [
              ['max-wall-time-ms', call.resources.wallTimeMs, budget.maxWallTimeMs],
              ['max-ticks', ticks + call.resources.ticks, budget.maxTicks],
              ['max-memory-bytes', memoryBytes + call.resources.memoryBytes, budget.maxMemoryBytes],
            ] as const)
              if (requested > limit)
                return {
                  state: 'refused',
                  reason,
                  requested,
                  limit,
                  message: 'Runtime reservation exceeds the session budget',
                  usage: usage(),
                  diagnostics: [],
                }
            executing = true
            // Reservations remain charged on failures: attempted execution may already have mutated state.
            executions++
            ticks += call.resources.ticks
            memoryBytes += call.resources.memoryBytes
            try {
              const result = await session.execute({
                entrypoint: call.entrypoint,
                ...(call.arguments === undefined ? {} : { arguments: call.arguments }),
                budget: {
                  maxWallTimeMs: call.resources.wallTimeMs,
                  maxTicks: call.resources.ticks,
                  maxMemoryBytes: call.resources.memoryBytes,
                },
                ...(call.signal === undefined
                  ? {}
                  : { cancellation: cancellationTokenFromAbortSignal(call.signal) }),
              })
              const diagnostics = result.diagnostics.map(item => ({
                code: item.code,
                severity: item.severity === 'info' ? ('information' as const) : item.severity,
                message: item.message,
              }))
              if (result.state === 'failed' || result.state === 'disposed')
                return {
                  state: 'refused',
                  reason: 'unsupported-runtime-subset',
                  message: `Legacy runtime ended in ${result.state}`,
                  usage: call.resources,
                  diagnostics,
                }
              return {
                state: 'completed',
                ...(result.value === undefined ? {} : { value: result.value }),
                usage: call.resources,
                diagnostics,
              }
            } catch (error) {
              throw adaptLegacyError(error)
            } finally {
              executing = false
            }
          },
        },
        async release() {
          if (disposed) return
          if (executing)
            throw new ModkitError({
              code: 'codec-kit/runtime-busy',
              message: 'Await execution before releasing its lease',
            })
          disposed = true
          await session.dispose()
        },
      }
    },
  }
}
