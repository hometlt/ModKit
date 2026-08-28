import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  GameInstallationDiscovery,
  GameInstallationDiscoveryRequest,
  GameInstallationProviderModule,
  GameLaunchPlanner,
  GameLaunchProviderModule,
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

export const starcraft2LaunchRoute = {
  contract: 'common.game/launch-plan',
  major: 1,
  facet: { gameId: 'org.modkitx/starcraft-2' },
} satisfies TypedServiceContractRequest<'common.game/launch-plan', 1>

export const starcraft2LaunchContribution = {
  provides: [
    {
      offerId: 'starcraft2-native-map-launch-v1',
      contract: 'common.game/launch-plan',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.modkitx/starcraft-2'] },
    },
  ],
  lifecycleScope: 'operation',
} satisfies ServiceProviderContributionSpecV1<'common.game/launch-plan'>

export declare const launchPlanner: GameLaunchPlanner
export declare const launchProviderModule: GameLaunchProviderModule
export const launchPlan = launchPlanner.plan({
  gameId: 'org.modkitx/starcraft-2',
  installation: {
    gameId: 'org.modkitx/starcraft-2',
    displayName: 'StarCraft II',
    installPath: 'C:/Games/StarCraft II',
    normalizedPath: 'C:/Games/StarCraft II',
    origins: ['configured-path'],
    evidence: [{ kind: 'fixture', path: 'C:/Games/StarCraft II', found: true }],
  },
  resource: { kind: 'map', path: 'C:/Maps/Test.SC2Map' },
})
