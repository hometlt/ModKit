import type { ServiceProviderContributionSpecV1 } from '@modkit/sdk/formats'
import type {
  ModWorkspaceComposition,
  ModWorkspaceCompositionRequest,
  ModWorkspaceProviderModule,
} from '@modkit/sdk/mods'
import type { TypedServiceContractRequest } from '@modkit/sdk/service-contracts'

export const gamealphaWorkspaceRoute = {
  contract: 'common.mod/workspace-composition',
  major: 1,
  facet: { gameId: 'org.example/game-alpha' },
} satisfies TypedServiceContractRequest<'common.mod/workspace-composition', 1>

export const gamealphaWorkspaceContribution = {
  provides: [
    {
      offerId: 'gamealpha-workspace-v1',
      contract: 'common.mod/workspace-composition',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.example/game-alpha'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.mod/workspace-composition'>

export const invalidWorkspaceRequest = {
  workspaceId: 'test',
  gameId: 'org.example/game-alpha',
  activeRootId: 'active',
  sources: [],
  roots: [],
  // @ts-expect-error Workspace limits cross the service boundary as bounded numbers.
  maxRoots: 32n,
  maxDepth: 16,
} satisfies ModWorkspaceCompositionRequest

export declare const composition: ModWorkspaceComposition
export declare const providerModule: ModWorkspaceProviderModule
export const lock = composition.compose({
  workspaceId: 'test',
  gameId: 'org.example/game-alpha',
  activeRootId: 'active',
  sources: [{ sourceId: 'local', kind: 'directory', location: 'file:///mods' }],
  roots: [
    {
      rootId: 'active',
      sourceId: 'local',
      sourcePath: 'mods/active.alphamod',
      displayName: 'Active.ALPHAMod',
      kind: 'mod',
      declaredDependencies: [],
    },
  ],
  maxRoots: 32,
  maxDepth: 16,
})
