import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type { RuntimeBudget, RuntimeProvider, RuntimeProviderModule } from '@modkitx-x3/sdk/runtime'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

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
