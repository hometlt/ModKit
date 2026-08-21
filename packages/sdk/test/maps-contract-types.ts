import type { ServiceProviderContributionSpecV1 } from '@modkitx-x3/sdk/formats'
import type {
  MapSemanticAnalysis,
  MapSemanticAnalysisRequest,
  MapSemanticProviderModule,
} from '@modkitx-x3/sdk/maps'
import type { TypedServiceContractRequest } from '@modkitx-x3/sdk/service-contracts'

export const mapRoute = {
  contract: 'common.map/semantic-analysis',
  major: 1,
  facet: { gameId: 'example/game' },
} satisfies TypedServiceContractRequest<'common.map/semantic-analysis', 1>

export const mapContribution = {
  provides: [
    {
      offerId: 'example-map-v1',
      contract: 'common.map/semantic-analysis',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['example/game'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.map/semantic-analysis'>

export const invalidMapRequest = {
  workspaceId: 'workspace',
  gameId: 'example/game',
  mapId: 'example/map',
  documents: [],
  maxDocuments: 8,
  maxDocumentBytes: 1_000_000,
  // @ts-expect-error Map transfer limits cross the service boundary as bounded numbers.
  maxTotalBytes: 1_000_000n,
  maxObjects: 1_000,
  maxRegions: 1_000,
  maxTerrainCells: 100_000,
  maxTerrainSamples: 16,
  maxDepth: 32,
} satisfies MapSemanticAnalysisRequest

export declare const analysis: MapSemanticAnalysis
export declare const providerModule: MapSemanticProviderModule
export const snapshot = analysis.open({
  workspaceId: 'workspace',
  gameId: 'example/game',
  mapId: 'example/map',
  documents: [{ path: 'Objects', bytes: new Uint8Array() }],
  maxDocuments: 8,
  maxDocumentBytes: 1_000_000,
  maxTotalBytes: 4_000_000,
  maxObjects: 1_000,
  maxRegions: 1_000,
  maxTerrainCells: 100_000,
  maxTerrainSamples: 16,
  maxDepth: 32,
})
