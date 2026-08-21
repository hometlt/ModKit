import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  ModWorkspaceComposition,
  ModWorkspaceCompositionRequest,
  ModWorkspaceProviderModule,
} from '@modkitx-x3/sdk/mods'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

export const starcraft2WorkspaceRoute = {
  contract: 'common.mod/workspace-composition',
  major: 1,
  facet: { gameId: 'org.modkitx/starcraft-2' },
} satisfies TypedServiceContractRequest<'common.mod/workspace-composition', 1>

export const starcraft2WorkspaceContribution = {
  provides: [
    {
      offerId: 'starcraft2-workspace-v1',
      contract: 'common.mod/workspace-composition',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['org.modkitx/starcraft-2'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.mod/workspace-composition'>

export const invalidWorkspaceRequest = {
  workspaceId: 'test',
  gameId: 'org.modkitx/starcraft-2',
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
  gameId: 'org.modkitx/starcraft-2',
  activeRootId: 'active',
  sources: [{ sourceId: 'local', kind: 'directory', location: 'file:///mods' }],
  roots: [
    {
      rootId: 'active',
      sourceId: 'local',
      sourcePath: 'mods/active.sc2mod',
      displayName: 'Active.SC2Mod',
      kind: 'mod',
      declaredDependencies: [],
    },
  ],
  maxRoots: 32,
  maxDepth: 16,
})
