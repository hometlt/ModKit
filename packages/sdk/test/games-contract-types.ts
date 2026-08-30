import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  GameInstallationDiscovery,
  GameInstallationDiscoveryRequest,
  GameInstallationProviderModule,
  GameLaunchPlanner,
  GameLaunchProviderModule,
} from '@modkitx-x3/sdk/games'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

export const gamealphaRoute = {
  contract: 'common.game/installation-discovery',
  major: 1,
  facet: { gameId: 'org.example/game-alpha' },
} satisfies TypedServiceContractRequest<'common.game/installation-discovery', 1>

export const gamealphaContribution = {
  provides: [
    {
      offerId: 'gamealpha-installation-v1',
      contract: 'common.game/installation-discovery',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.example/game-alpha'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.game/installation-discovery'>

export const invalidDiscoveryRequest = {
  gameId: 'org.example/game-alpha',
  // @ts-expect-error Candidate ceilings cross the service boundary as bounded numbers.
  maxCandidates: 16n,
} satisfies GameInstallationDiscoveryRequest

export declare const discovery: GameInstallationDiscovery
export declare const providerModule: GameInstallationProviderModule
export const installations = discovery.discover({
  gameId: 'org.example/game-alpha',
  configuredPaths: ['C:/Games/Example Game Alpha'],
  maxCandidates: 16,
})

export const gamealphaLaunchRoute = {
  contract: 'common.game/launch-plan',
  major: 1,
  facet: { gameId: 'org.example/game-alpha' },
} satisfies TypedServiceContractRequest<'common.game/launch-plan', 1>

export const gamealphaLaunchContribution = {
  provides: [
    {
      offerId: 'gamealpha-native-map-launch-v1',
      contract: 'common.game/launch-plan',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.example/game-alpha'] },
    },
  ],
  lifecycleScope: 'operation',
} satisfies ServiceProviderContributionSpecV1<'common.game/launch-plan'>

export declare const launchPlanner: GameLaunchPlanner
export declare const launchProviderModule: GameLaunchProviderModule
export const launchPlan = launchPlanner.plan({
  gameId: 'org.example/game-alpha',
  installation: {
    gameId: 'org.example/game-alpha',
    displayName: 'Example Game Alpha',
    installPath: 'C:/Games/Example Game Alpha',
    normalizedPath: 'C:/Games/Example Game Alpha',
    origins: ['configured-path'],
    evidence: [{ kind: 'fixture', path: 'C:/Games/Example Game Alpha', found: true }],
  },
  resource: { kind: 'map', path: 'C:/Maps/Test.ALPHAMap' },
})
