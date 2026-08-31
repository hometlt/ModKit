import type {
  ContractOf,
  ContractResolverPort,
  ForeignServiceContractId,
  OpaqueServiceContractRequest,
  TypedServiceContractRequest,
} from '@modkit/sdk/service-contracts'
import { foreignServiceContractId } from '@modkit/sdk/service-contracts'
import type { ServiceProviderContributionSpecV1 } from '@modkit/sdk/formats'
import type {
  ContributionContext,
  JsonValue,
  SelectedServiceOffer,
  ServiceProviderModule,
} from '@modkit/sdk'
import type { ContributionManifestV1Wire } from '../src/manifest/contribution-types.js'
import type { ContractOfferWire } from '../src/resolution/types.js'
import { defineServiceProvider } from '@modkit/sdk/authoring'

export const nonJsonContributionManifest = {
  schemaVersion: 1,
  contract: { id: 'org.example/invalid', major: 1 },
  id: 'org.example/invalid',
  displayName: 'Invalid',
  // @ts-expect-error Exact wire manifests cannot carry executable spec data.
  spec: () => undefined,
} satisfies ContributionManifestV1Wire<() => void>

interface DeepExecutableSpec {
  readonly a: {
    readonly b: {
      readonly c: {
        readonly d: {
          readonly e: {
            readonly f: {
              readonly g: {
                readonly h: {
                  readonly i: { readonly j: { readonly callback: () => void } }
                }
              }
            }
          }
        }
      }
    }
  }
}
declare const deepExecutableSpec: DeepExecutableSpec
// @ts-expect-error Depth exhaustion must stay fail-closed for executable object members.
export const nonJsonDeepObject: ContributionManifestV1Wire<DeepExecutableSpec>['spec'] =
  deepExecutableSpec

type DeepExecutableArray =
  readonly (readonly (readonly (readonly (readonly (readonly (readonly (readonly (readonly (readonly (readonly (() => void)[])[])[])[])[])[])[])[])[])[])[]
declare const deepExecutableArray: DeepExecutableArray
// @ts-expect-error Deep arrays cannot hide executable values beyond the inspection depth.
export const nonJsonDeepArray: ContributionManifestV1Wire<DeepExecutableArray>['spec'] =
  deepExecutableArray

interface OptionalExecutableSpec {
  readonly value?: string | (() => void)
}
declare const optionalExecutableSpec: OptionalExecutableSpec
// @ts-expect-error Optional/union members remain JSON-only as well.
export const nonJsonOptionalUnion: ContributionManifestV1Wire<OptionalExecutableSpec>['spec'] =
  optionalExecutableSpec

type JsonDialect = 'json' | 'jsonc'
type XmlDialect = 'xml-1.0' | 'xml-1.1'

interface JsonRequestFacet {
  readonly dialect: JsonDialect
  readonly allowComments: boolean
}

interface XmlRequestFacet {
  readonly dialect: XmlDialect
  readonly preserveNamespaces: boolean
}

interface JsonSyntaxProvider {
  parse(input: string, facet: JsonRequestFacet): Promise<{ readonly kind: 'json' }>
}

interface XmlSyntaxProvider {
  parse(input: string, facet: XmlRequestFacet): Promise<{ readonly kind: 'xml' }>
}

interface SearchProvider {
  search(query: string): Promise<readonly string[]>
}

export const jsonSafeResolutionOffer = {
  offerId: 'json-safe',
  contract: 'org.example/json-syntax',
  major: 1,
  version: '1.0.0',
  facet: {
    dialect: 'json',
    options: { comments: false, limits: [1, 2, null] },
  },
} as const satisfies ContractOfferWire

export const executableResolutionOffer = {
  offerId: 'not-wire-data',
  contract: 'org.example/json-syntax',
  major: 1,
  version: '1.0.0',
  // @ts-expect-error Resolution offer facets are JSON wire data, never callbacks.
  facet: { select: () => 'json' },
} as const satisfies ContractOfferWire

declare module '@modkit/sdk/service-contracts' {
  interface ContractMap {
    'org.example/json-syntax': { 1: JsonSyntaxProvider }
    'org.example/xml-syntax': { 1: XmlSyntaxProvider }
    'org.example/optional-search': { 1: SearchProvider }
    'org.example/facetless': { 1: SearchProvider }
  }

  interface ContractRequestMap {
    'org.example/json-syntax': { 1: { presence: 'required'; facet: JsonRequestFacet } }
    'org.example/xml-syntax': { 1: { presence: 'required'; facet: XmlRequestFacet } }
    'org.example/optional-search': {
      1: { presence: 'optional'; facet: { readonly language: string } }
    }
    'org.example/facetless': { 1: { presence: 'forbidden' } }
  }

  interface ContractOfferMap {
    'org.example/json-syntax': { 1: { presence: 'required'; facet: JsonRequestFacet } }
    'org.example/xml-syntax': { 1: { presence: 'required'; facet: XmlRequestFacet } }
    'org.example/optional-search': {
      1: { presence: 'optional'; facet: { readonly language: string } }
    }
    'org.example/facetless': { 1: { presence: 'forbidden' } }
  }
}

export const selectedJsonOffer = {
  offerId: 'json-strict',
  contract: 'org.example/json-syntax',
  major: 1,
  contractSelectionKey: 'dialect=json',
} as const satisfies SelectedServiceOffer<'org.example/json-syntax', 1>

/** A second logical offer at the same contract@major remains independently activatable. */
export const selectedJsoncOffer = {
  offerId: 'json-comments',
  contract: 'org.example/json-syntax',
  major: 1,
  contractSelectionKey: 'dialect=jsonc',
} as const satisfies SelectedServiceOffer<'org.example/json-syntax', 1>

export const selectedOfferJsonProof: JsonValue = selectedJsonOffer

declare const serviceProviderModule: ServiceProviderModule<'org.example/json-syntax', 1>
declare const contributionContext: ContributionContext
export const authoredJsonProvider = defineServiceProvider({
  id: 'org.example/json-provider',
  contribution: {
    provides: [
      {
        offerId: 'json',
        contract: 'org.example/json-syntax',
        major: 1,
        version: '1.0.0',
        facet: { dialect: 'json', allowComments: false },
      },
    ],
    lifecycleScope: 'session',
  },
  module: serviceProviderModule,
  profile: 'source-reader',
  targets: [
    {
      variantId: 'portable',
      environments: ['browser-worker', 'node-worker'],
      entrypoint: './dist/provider.js',
    },
  ],
})
export const activatedJsonProvider = serviceProviderModule.createProvider(
  selectedJsonOffer,
  contributionContext,
)
export const activatedJsoncProvider = serviceProviderModule.createProvider(
  selectedJsoncOffer,
  contributionContext,
)

export const selectedOfferCannotCarryRawFacet = {
  offerId: 'unsafe',
  contract: 'org.example/json-syntax',
  major: 1,
  contractSelectionKey: 'dialect=json',
  // @ts-expect-error Raw request/offer facets do not cross the activation boundary.
  requestFacet: { dialect: 'json', allowComments: false },
} satisfies SelectedServiceOffer<'org.example/json-syntax', 1>

const selectedOfferWithLaunderedFacet = {
  ...selectedJsonOffer,
  requestFacet: { dialect: 'json', allowComments: false },
}
// @ts-expect-error A wider variable cannot launder a raw facet into the activation binding.
export const selectedOfferWithoutFacetLeak: SelectedServiceOffer<'org.example/json-syntax', 1> =
  selectedOfferWithLaunderedFacet

export const selectedOfferRequiresSupportedMajor = {
  offerId: 'wrong-major',
  contract: 'org.example/json-syntax',
  // @ts-expect-error The JSON syntax contract only defines major 1.
  major: 2,
} satisfies SelectedServiceOffer<'org.example/json-syntax', 1>

export const selectedOfferKeyIsJsonSafe = {
  offerId: 'unsafe-key',
  contract: 'org.example/json-syntax',
  major: 1,
  // @ts-expect-error Matcher selection keys are non-secret strings, never callbacks.
  contractSelectionKey: () => 'dialect=json',
} satisfies SelectedServiceOffer<'org.example/json-syntax', 1>

const selectedXmlOffer = {
  offerId: 'xml-1-1',
  contract: 'org.example/xml-syntax',
  major: 1,
  contractSelectionKey: 'dialect=xml-1.1',
} as const satisfies SelectedServiceOffer<'org.example/xml-syntax', 1>

// @ts-expect-error A JSON-only module cannot activate an XML logical offer.
serviceProviderModule.createProvider(selectedXmlOffer, contributionContext)

export const syntaxOffers = {
  provides: [
    {
      offerId: 'json',
      contract: 'org.example/json-syntax',
      major: 1,
      version: '1.0.0',
      facet: { dialect: 'jsonc', allowComments: true },
    },
    {
      offerId: 'xml',
      contract: 'org.example/xml-syntax',
      major: 1,
      version: '1.0.0',
      facet: { dialect: 'xml-1.1', preserveNamespaces: true },
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'org.example/json-syntax' | 'org.example/xml-syntax'>

export const jsonRequest = {
  contract: 'org.example/json-syntax',
  major: 1,
  facet: { dialect: 'json', allowComments: false },
} satisfies TypedServiceContractRequest<'org.example/json-syntax', 1>

export const optionalFacetAbsent = {
  contract: 'org.example/optional-search',
  major: 1,
} satisfies TypedServiceContractRequest<'org.example/optional-search', 1>

export const optionalFacetPresent = {
  contract: 'org.example/optional-search',
  major: 1,
  facet: { language: 'en' },
} satisfies TypedServiceContractRequest<'org.example/optional-search', 1>

export const facetlessRequest = {
  contract: 'org.example/facetless',
  major: 1,
} satisfies TypedServiceContractRequest<'org.example/facetless', 1>

export const optionalOfferWithoutFacet = {
  provides: [
    {
      offerId: 'search-default',
      contract: 'org.example/optional-search',
      major: 1,
      version: '1.0.0',
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'org.example/optional-search'>

export const facetlessOffer = {
  provides: [
    {
      offerId: 'search-facetless',
      contract: 'org.example/facetless',
      major: 1,
      version: '1.0.0',
    },
  ],
  lifecycleScope: 'session',
} satisfies ServiceProviderContributionSpecV1<'org.example/facetless'>

export const invalidFacetlessRequest = {
  contract: 'org.example/facetless',
  major: 1,
  // @ts-expect-error A forbidden request facet cannot be supplied.
  facet: { anything: true },
} satisfies TypedServiceContractRequest<'org.example/facetless', 1>

export declare const jsonProvider: ContractOf<'org.example/json-syntax', 1>
export const parsedJson = jsonProvider.parse('{}', jsonRequest.facet)

export const parsedJsonWithXmlDialect = jsonProvider.parse('{}', {
  // @ts-expect-error ContractOf keeps the JSON provider handle instead of widening to any provider.
  dialect: 'xml-1.0',
  allowComments: false,
})

const FOREIGN_SEARCH = foreignServiceContractId('org.foreign/search-provider')

export const foreignOffer = {
  provides: [
    {
      offerId: 'search',
      contract: FOREIGN_SEARCH,
      major: 2,
      version: '2.0.0',
      facet: { dialect: 'custom', options: { fuzzy: true, limit: 20 } },
    },
  ],
  lifecycleScope: 'operation',
} satisfies ServiceProviderContributionSpecV1<'org.foreign/search-provider'>

export const foreignRequest = {
  contract: FOREIGN_SEARCH,
  major: 2,
  facet: { dialect: 'custom', options: { fuzzy: true } },
} satisfies OpaqueServiceContractRequest<'org.foreign/search-provider'>

declare const resolver: ContractResolverPort
export const foreignResolution = resolver.resolveUnknown(foreignRequest)
declare const widenedContract: string
// @ts-expect-error Widened strings cannot bypass the nominal foreign-contract constructor.
resolver.resolveUnknown({ contract: widenedContract, major: 2 })
// @ts-expect-error A known contract cannot be issued as a foreign contract id.
foreignServiceContractId('org.example/json-syntax')

export const jsonOfferWithXmlFacet: ServiceProviderContributionSpecV1<'org.example/json-syntax'> = {
  provides: [
    {
      offerId: 'bad-json',
      contract: 'org.example/json-syntax',
      major: 1,
      version: '1.0.0',
      facet: {
        // @ts-expect-error A JSON offer cannot publish an XML request facet.
        dialect: 'xml-1.0',
        allowComments: false,
      },
    },
  ],
  lifecycleScope: 'session',
}

export const xmlRequestWithJsonFacet: TypedServiceContractRequest<'org.example/xml-syntax', 1> = {
  contract: 'org.example/xml-syntax',
  major: 1,
  facet: {
    // @ts-expect-error The XML resolver request cannot select a JSON dialect.
    dialect: 'jsonc',
    preserveNamespaces: true,
  },
}

// @ts-expect-error Known service contracts cannot use the foreign escape hatch.
export const knownAsForeign: ForeignServiceContractId<'org.example/json-syntax'> =
  'org.example/json-syntax'

export const foreignOfferWithFunction: ServiceProviderContributionSpecV1<'org.foreign/search-provider'> =
  {
    provides: [
      {
        offerId: 'bad-search',
        contract: FOREIGN_SEARCH,
        major: 2,
        version: '2.0.0',
        // @ts-expect-error Opaque foreign facets are JSON data, never executable callbacks.
        facet: {
          callback: () => undefined,
        },
      },
    ],
    lifecycleScope: 'operation',
  }

// @ts-expect-error The augmented JSON contract only defines major 1.
export type UnsupportedJsonMajor = ContractOf<'org.example/json-syntax', 2>
