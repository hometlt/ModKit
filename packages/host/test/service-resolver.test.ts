import { describe, expect, it } from 'vitest'
import { contractId, diagnostic } from '@modkitx-x3/core'
import type {
  DefinitionInventoryProvenance,
  ProviderOffer,
  RuntimeTarget,
  ServiceFacetMatcherProfile,
} from '@modkitx-x3/sdk'
import { createServiceContractDefinitionRegistry, resolveServiceProvider } from '@modkitx-x3/host'

const JSON_CONTRACT = contractId('org.example/json-syntax')
const MATCHER = contractId('org.modkitx/exact-dialect-matcher')
const target: RuntimeTarget = {
  environment: 'node',
  operatingSystem: 'linux',
  architecture: 'x64',
}
const provenance: DefinitionInventoryProvenance = {
  ownerExtensionId: 'org.example/contracts',
  extensionVersion: '1.0.0',
  inventoryRecordId: 'record:contracts',
  manifestDigest: 'sha256:manifest',
  artifactDigest: 'sha256:artifact',
  artifactRoot: 'file:///contracts/',
  manifestPath: 'definitions/json.json',
}

function registry() {
  const matcher: ServiceFacetMatcherProfile = {
    profile: MATCHER,
    major: 1,
    match(context) {
      const offer = context.offerFacet as { dialect?: unknown } | undefined
      const request = context.requestFacet as { dialect?: unknown } | undefined
      return offer?.dialect === request?.dialect
        ? { state: 'match', selectionKey: `dialect:${String(offer?.dialect)}` }
        : { state: 'no-match' }
    },
  }
  return createServiceContractDefinitionRegistry({
    matcherProfiles: {
      lookup: (profile, major) => (profile === MATCHER && major === 1 ? matcher : undefined),
      list: () => [matcher],
    },
    isNamespaceOwner: owner => owner === provenance.ownerExtensionId,
    validateJsonSchemaRef: (_schema, value) => {
      const record = value as Readonly<Record<string, unknown>>
      return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof record['dialect'] === 'string'
        ? []
        : [diagnostic('error', 'x3.test/invalid-facet', 'dialect is required')]
    },
  })
}

const offer: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.example/providers',
  extensionVersion: '1.0.0',
  providerId: 'org.example/json-provider',
  runtimeVariant: 'portable',
  target: { environments: ['node'] },
  provides: [
    {
      offerId: 'jsonc',
      contract: JSON_CONTRACT,
      major: 1,
      version: '1.2.0',
      facet: { dialect: 'jsonc' },
    },
  ],
}

describe('service contract definitions and facet-aware resolution (A-2)', () => {
  it('validates asymmetric facets and retains only a non-secret selection key', async () => {
    const definitions = registry()
    expect(
      await definitions.replaceOwnerInventory(provenance.ownerExtensionId, [
        {
          definition: {
            schemaVersion: 1,
            kind: 'service',
            contract: JSON_CONTRACT,
            major: 1,
            offerFacet: { presence: 'required', schema: { $ref: './offer.schema.json' } },
            requestFacet: { presence: 'required', schema: { $ref: './request.schema.json' } },
            matching: { profile: MATCHER, major: 1 },
            conformanceProfile: 'org.example/json-syntax-v1',
          },
          provenance,
        },
      ]),
    ).toEqual({ state: 'committed' })

    const result = await resolveServiceProvider(
      {
        contract: { contract: JSON_CONTRACT, major: 1 },
        target,
        requestFacet: { dialect: 'jsonc' },
      },
      [offer],
      definitions,
    )
    expect(result.state).toBe('resolved')
    if (result.state === 'resolved') {
      expect(result.selected.contractSelectionKey).toBe('dialect:jsonc')
      expect(result.selected).not.toHaveProperty('requestFacet')
      expect(result.selected).not.toHaveProperty('offerFacet')
    }

    const mismatch = await resolveServiceProvider(
      {
        contract: { contract: JSON_CONTRACT, major: 1 },
        target,
        requestFacet: { dialect: 'json' },
      },
      [offer],
      definitions,
    )
    expect(mismatch.state).toBe('unresolved')
  })

  it('fails closed when the selected matcher profile is unavailable', async () => {
    const definitions = createServiceContractDefinitionRegistry({
      matcherProfiles: { lookup: () => undefined, list: () => [] },
      isNamespaceOwner: () => true,
      validateJsonSchemaRef: () => [],
    })
    const result = await definitions.replaceOwnerInventory(provenance.ownerExtensionId, [
      {
        definition: {
          schemaVersion: 1,
          kind: 'service',
          contract: JSON_CONTRACT,
          major: 1,
          offerFacet: { presence: 'forbidden' },
          requestFacet: { presence: 'forbidden' },
          matching: { profile: MATCHER, major: 1 },
          conformanceProfile: 'org.example/json-syntax-v1',
        },
        provenance,
      },
    ])
    expect(result).toMatchObject({ state: 'rejected', reason: 'matcher-unavailable' })
  })
})
