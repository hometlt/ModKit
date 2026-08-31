import type { ServiceProviderContributionSpecV1 } from '@modkit/sdk/formats'
import type {
  DataCatalogAnalysis,
  DataCatalogAnalysisRequest,
  DataCatalogProviderModule,
} from '@modkit/sdk/data'
import type { TypedServiceContractRequest } from '@modkit/sdk/service-contracts'

export const catalogRoute = {
  contract: 'common.data/catalog-analysis',
  major: 1,
  facet: { gameId: 'example/game' },
} satisfies TypedServiceContractRequest<'common.data/catalog-analysis', 1>

export const catalogContribution = {
  provides: [
    {
      offerId: 'example-data-v1',
      contract: 'common.data/catalog-analysis',
      major: 1,
      version: '1.0.0',
      facet: { gameIds: ['example/game'] },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.data/catalog-analysis'>

export const invalidCatalogRequest = {
  workspaceId: 'test',
  gameId: 'example/game',
  documents: [],
  queries: [],
  maxDocuments: 16,
  // @ts-expect-error Catalog byte limits cross the service boundary as bounded numbers.
  maxTextBytes: 1_000_000n,
  maxEntities: 1_000,
  maxDepth: 32,
} satisfies DataCatalogAnalysisRequest

export declare const analysis: DataCatalogAnalysis
export declare const providerModule: DataCatalogProviderModule
export const snapshot = analysis.analyze({
  workspaceId: 'test',
  gameId: 'example/game',
  documents: [{ rootId: 'active', path: 'Catalog.xml', text: '<Catalog />' }],
  queries: [{ namespace: 'Unit', entityId: 'Example' }],
  maxDocuments: 16,
  maxTextBytes: 1_000_000,
  maxEntities: 1_000,
  maxDepth: 32,
})
