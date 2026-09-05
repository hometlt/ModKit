import type { ServiceProviderContributionSpecV1 } from '@modkit/sdk/formats'
import type {
  LanguageProvider,
  LanguageProviderCompletionList,
  LanguageProviderModule,
  LanguageProviderRequestFacet,
} from '@modkit/sdk/language'
import type { TypedServiceContractRequest } from '@modkit/sdk/service-contracts'

export const galaxyRoute = {
  contract: 'common.language/document-analysis',
  major: 1,
  facet: { languageId: 'galaxy', documentKind: 'galaxy-source', extension: 'galaxy' },
} satisfies TypedServiceContractRequest<'common.language/document-analysis', 1>

export const galaxyProviderContribution = {
  provides: [
    {
      offerId: 'galaxy',
      contract: 'common.language/document-analysis',
      major: 1,
      version: '1.0.0',
      facet: {
        languageIds: ['galaxy'],
        documentKinds: ['galaxy-source'],
        extensions: ['galaxy', 'ai'],
      },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'common.language/document-analysis'>

export const invalidLanguageRoute = {
  // @ts-expect-error Language ids in resolver facets are non-empty strings, never numbers.
  languageId: 7,
} satisfies LanguageProviderRequestFacet

export declare const provider: LanguageProvider
export declare const providerModule: LanguageProviderModule
export const analysis = provider.analyze({
  document: { uri: 'file:///x.galaxy', languageId: 'galaxy', version: 1, text: '' },
})

export const subjectReferenceCompletion = {
  items: [
    {
      kind: 'subject-ref',
      subjectKind: 'unit',
      filter: {
        type: 'structure',
        excludeTags: ['default'],
        predicate: { id: 'minimum-rank', params: { rank: 2 } },
      },
    },
  ],
  isIncomplete: true,
} satisfies LanguageProviderCompletionList
