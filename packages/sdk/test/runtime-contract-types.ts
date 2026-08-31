import type { ServiceProviderContributionSpecV1 } from '@modkit/sdk/formats'
import type {
  RuntimeBudget,
  RuntimeExecutionResult,
  RuntimeProvider,
  RuntimeProviderModule,
} from '@modkit/sdk/runtime'
import type { TypedServiceContractRequest } from '@modkit/sdk/service-contracts'

export const counterRoute = {
  contract: 'common.runtime/provider',
  major: 1,
  facet: { runtimeId: 'reference.counter' },
} satisfies TypedServiceContractRequest<'common.runtime/provider', 1>

export const counterProviderContribution = {
  provides: [
    {
      offerId: 'reference-counter',
      contract: 'common.runtime/provider',
      major: 1,
      version: '1.0.0',
      facet: { runtimeIds: ['reference.counter'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.runtime/provider'>

export const invalidRuntimeBudget = {
  maxWallTimeMs: 5,
  // @ts-expect-error Runtime budgets are numbers and cannot carry bigint across the boundary.
  maxTicks: 6n,
  maxMemoryBytes: 100,
} satisfies RuntimeBudget

export declare const provider: RuntimeProvider
export declare const providerModule: RuntimeProviderModule
export const session = provider.createSession({
  sessionId: 'counter',
  budget: { maxWallTimeMs: 5, maxTicks: 6, maxMemoryBytes: 100 },
})

/** Compile ratchet for the additive v1 capability-refusal result used by bounded runtimes. */
export const capabilityRefusal = {
  state: 'refused',
  reason: 'native-unavailable',
  message: 'the selected bounded profile does not implement this native',
  usage: { wallTimeMs: 0, ticks: 0, memoryBytes: 0 },
  diagnostics: [],
} as const satisfies RuntimeExecutionResult

/** The original numeric refusal stays admitted with its exact limit/requested evidence. */
export const numericRefusal = {
  state: 'refused',
  reason: 'max-ticks',
  message: 'tick budget exceeded',
  limit: 10,
  requested: 11,
  usage: { wallTimeMs: 0, ticks: 0, memoryBytes: 0 },
  diagnostics: [],
} as const satisfies RuntimeExecutionResult
