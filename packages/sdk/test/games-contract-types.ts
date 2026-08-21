import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  GameInstallationDiscovery,
  GameInstallationDiscoveryRequest,
  GameInstallationProviderModule,
} from '@modkitx-x3/sdk/games'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

export const starcraft2Route = {
  contract: 'common.game/installation-discovery',
  major: 1,
  facet: { gameId: 'org.modkitx/starcraft-2' },
} satisfies TypedServiceContractRequest<'common.game/installation-discovery', 1>

export const starcraft2Contribution = {
  provides: [
    {
      offerId: 'starcraft2-installation-v1',
      contract: 'common.game/installation-discovery',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.modkitx/starcraft-2'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.game/installation-discovery'>

export const invalidDiscoveryRequest = {
  gameId: 'org.modkitx/starcraft-2',
  // @ts-expect-error Candidate ceilings cross the service boundary as bounded numbers.
  maxCandidates: 16n,
} satisfies GameInstallationDiscoveryRequest

export declare const discovery: GameInstallationDiscovery
export declare const providerModule: GameInstallationProviderModule
export const installations = discovery.discover({
  gameId: 'org.modkitx/starcraft-2',
  configuredPaths: ['C:/Games/StarCraft II'],
  maxCandidates: 16,
})
