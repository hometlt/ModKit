/** Host-owned, fail-closed service-contract definition inventory (A-2). */

import {
  canonicalJsonStringify,
  compareUtf8,
  contractId,
  diagnostic,
  hasErrors,
  isQualifiedId,
  type Diagnostic,
} from '@modkitx-x3/core'
import { CONTRACT_DEFINITION_FACT } from '@modkitx-x3/sdk'
import type {
  DefinitionInventoryProvenance,
  DefinitionInventoryResult,
  FacetDefinitionWire,
  JsonSchemaRef,
  JsonValue,
  ServiceContractDefinitionRegistration,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfileRegistry,
  ServiceFacetValidationContext,
} from '@modkitx-x3/sdk'
import type { Inventory } from './inventory.js'

export interface ServiceContractDefinitionRegistryOptions {
  readonly matcherProfiles: ServiceFacetMatcherProfileRegistry
  readonly isNamespaceOwner: (
    ownerExtensionId: string,
    contract: string,
  ) => boolean | Promise<boolean>
  /** Resolves the ref relative to provenance.manifestPath and validates inert JSON. */
  readonly validateJsonSchemaRef: (
    schema: JsonSchemaRef,
    value: JsonValue,
    provenance: DefinitionInventoryProvenance,
  ) => readonly Diagnostic[] | Promise<readonly Diagnostic[]>
  readonly validateMatcherConfiguration?: (
    schema: JsonSchemaRef,
    configuration: JsonValue | undefined,
  ) => readonly Diagnostic[] | Promise<readonly Diagnostic[]>
}

function ownedJson<Value>(value: Value): Value {
  if (value === undefined) return value
  return JSON.parse(canonicalJsonStringify(value)) as Value
}

function rejection(
  reason: Extract<DefinitionInventoryResult, { state: 'rejected' }>['reason'],
  code: string,
  message: string,
): DefinitionInventoryResult {
  return { state: 'rejected', reason, diagnostics: [diagnostic('error', code, message)] }
}

function key(contract: string, major: number): string {
  return `${contract}@${major}`
}

function validDefinition(value: ServiceContractDefinitionSpecV1Wire): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.schemaVersion === 1 &&
    value.kind === 'service' &&
    typeof value.contract === 'string' &&
    isQualifiedId(value.contract) &&
    Number.isSafeInteger(value.major) &&
    value.major >= 0 &&
    typeof value.conformanceProfile === 'string' &&
    value.conformanceProfile.trim().length > 0 &&
    typeof value.matching === 'object' &&
    value.matching !== null &&
    typeof value.matching.profile === 'string' &&
    isQualifiedId(value.matching.profile) &&
    Number.isSafeInteger(value.matching.major) &&
    value.matching.major >= 0
  )
}

function normalize(
  value: ServiceContractDefinitionSpecV1Wire,
  provenance: DefinitionInventoryProvenance,
): ServiceContractDefinitionRegistration {
  const owned = ownedJson(value)
  return Object.freeze({
    ...owned,
    contract: contractId(owned.contract),
    matching: Object.freeze({
      ...owned.matching,
      profile: contractId(owned.matching.profile),
    }),
    provenance: Object.freeze(ownedJson(provenance)),
  })
}

function presenceDiagnostics(
  definition: FacetDefinitionWire,
  context: ServiceFacetValidationContext,
  label: 'offer' | 'request',
): Diagnostic[] {
  if (definition.presence === 'forbidden' && context.facet !== undefined) {
    return [
      diagnostic(
        'error',
        'x3.host/facet-forbidden',
        `${label} facet is forbidden for ${context.contract}@${context.major}`,
      ),
    ]
  }
  if (definition.presence === 'required' && context.facet === undefined) {
    return [
      diagnostic(
        'error',
        'x3.host/facet-required',
        `${label} facet is required for ${context.contract}@${context.major}`,
      ),
    ]
  }
  return []
}

export function createServiceContractDefinitionRegistry(
  options: ServiceContractDefinitionRegistryOptions,
): ServiceContractDefinitionRegistry {
  const matcherProfiles = options.matcherProfiles
  const isNamespaceOwner = options.isNamespaceOwner
  const validateJsonSchemaRef = options.validateJsonSchemaRef
  const validateMatcherConfiguration = options.validateMatcherConfiguration
  let registrations = new Map<string, ServiceContractDefinitionRegistration>()
  const ownerEpochs = new Map<string, number>()

  const validateFacet = async (
    side: 'offer' | 'request',
    context: ServiceFacetValidationContext,
  ): Promise<readonly Diagnostic[]> => {
    const registration = registrations.get(key(context.contract, context.major))
    if (registration === undefined) {
      return [
        diagnostic(
          'error',
          'x3.host/service-contract-unregistered',
          `service contract ${context.contract}@${context.major} is not registered`,
        ),
      ]
    }
    const definition = side === 'offer' ? registration.offerFacet : registration.requestFacet
    const diagnostics = presenceDiagnostics(definition, context, side)
    if (
      context.facet !== undefined &&
      definition.presence !== 'forbidden' &&
      !hasErrors(diagnostics)
    ) {
      try {
        diagnostics.push(
          ...(await validateJsonSchemaRef(
            definition.schema,
            ownedJson(context.facet),
            registration.provenance,
          )),
        )
      } catch (error) {
        diagnostics.push(
          diagnostic(
            'error',
            'x3.host/facet-schema-validation-failed',
            'facet schema validation failed closed',
            [],
            { error: error instanceof Error ? error.message : String(error) },
          ),
        )
      }
    }
    return Object.freeze(diagnostics)
  }

  return {
    async replaceOwnerInventory(ownerExtensionId, definitions) {
      const epoch = (ownerEpochs.get(ownerExtensionId) ?? 0) + 1
      ownerEpochs.set(ownerExtensionId, epoch)
      const pending: ServiceContractDefinitionRegistration[] = []
      const seen = new Set<string>()
      for (const entry of definitions) {
        if (!validDefinition(entry.definition)) {
          return rejection(
            'invalid-definition',
            'x3.host/invalid-service-contract-definition',
            'service contract definition is malformed',
          )
        }
        if ((await isNamespaceOwner(ownerExtensionId, entry.definition.contract)) !== true) {
          return rejection(
            'namespace-owner-mismatch',
            'x3.host/service-contract-owner-mismatch',
            `${ownerExtensionId} does not own ${entry.definition.contract}`,
          )
        }
        const definitionKey = key(entry.definition.contract, entry.definition.major)
        if (seen.has(definitionKey)) {
          return rejection(
            'duplicate',
            'x3.host/duplicate-service-contract-definition',
            `duplicate service contract definition ${definitionKey}`,
          )
        }
        seen.add(definitionKey)
        const profile = matcherProfiles.lookup(
          contractId(entry.definition.matching.profile),
          entry.definition.matching.major,
        )
        if (profile === undefined) {
          return rejection(
            'matcher-unavailable',
            'x3.host/facet-matcher-unavailable',
            `matcher ${entry.definition.matching.profile}@${entry.definition.matching.major} is unavailable`,
          )
        }
        if (
          profile.configurationSchema !== undefined &&
          validateMatcherConfiguration !== undefined
        ) {
          const diagnostics = await validateMatcherConfiguration(
            profile.configurationSchema,
            entry.definition.matching.configuration,
          )
          if (hasErrors(diagnostics)) {
            return {
              state: 'rejected',
              reason: 'matcher-configuration-invalid',
              diagnostics,
            }
          }
        }
        pending.push(normalize(entry.definition, entry.provenance))
      }
      if (ownerEpochs.get(ownerExtensionId) !== epoch) {
        return rejection(
          'version-conflict',
          'x3.host/stale-definition-replacement',
          'a newer owner inventory operation superseded this replacement',
        )
      }
      const next = new Map(
        [...registrations].filter(
          ([, registration]) => registration.provenance.ownerExtensionId !== ownerExtensionId,
        ),
      )
      for (const registration of pending) {
        const registrationKey = key(registration.contract, registration.major)
        if (next.has(registrationKey)) {
          return rejection(
            'duplicate',
            'x3.host/service-contract-conflict',
            `service contract ${registrationKey} is already owned by another extension`,
          )
        }
        next.set(registrationKey, registration)
      }
      registrations = next
      return { state: 'committed' }
    },
    unregisterOwner(ownerExtensionId) {
      ownerEpochs.set(ownerExtensionId, (ownerEpochs.get(ownerExtensionId) ?? 0) + 1)
      registrations = new Map(
        [...registrations].filter(
          ([, registration]) => registration.provenance.ownerExtensionId !== ownerExtensionId,
        ),
      )
    },
    lookup: (contract, major) => registrations.get(key(contract, major)),
    list: () =>
      Object.freeze(
        [...registrations.values()].sort(
          (left, right) => compareUtf8(left.contract, right.contract) || left.major - right.major,
        ),
      ),
    validateOfferFacet: context => validateFacet('offer', context),
    validateRequestFacet: context => validateFacet('request', context),
    async matchFacets(context: ServiceFacetMatchContext): Promise<ServiceFacetMatchResult> {
      const registration = registrations.get(key(context.contract, context.major))
      if (registration === undefined) {
        return {
          state: 'invalid',
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/service-contract-unregistered',
              `service contract ${context.contract}@${context.major} is not registered`,
            ),
          ],
        }
      }
      const offerDiagnostics = await validateFacet('offer', {
        contract: context.contract,
        major: context.major,
        ownerExtensionId: context.ownerExtensionId,
        facet: context.offerFacet,
      })
      const requestDiagnostics = await validateFacet('request', {
        contract: context.contract,
        major: context.major,
        ownerExtensionId: context.ownerExtensionId,
        facet: context.requestFacet,
      })
      const diagnostics = [...offerDiagnostics, ...requestDiagnostics]
      if (hasErrors(diagnostics)) return { state: 'invalid', diagnostics }
      const profile = matcherProfiles.lookup(
        registration.matching.profile,
        registration.matching.major,
      )
      if (profile === undefined) {
        return {
          state: 'invalid',
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/facet-matcher-unavailable',
              'the registered facet matcher profile is unavailable',
            ),
          ],
        }
      }
      try {
        const result = await profile.match(
          {
            ...context,
            offerFacet: ownedJson(context.offerFacet),
            requestFacet: ownedJson(context.requestFacet),
          },
          registration.matching.configuration,
        )
        if (
          result.state === 'match' &&
          (typeof result.selectionKey !== 'string' || result.selectionKey.trim().length === 0)
        ) {
          throw new TypeError('matcher returned a blank selection key')
        }
        return result
      } catch (error) {
        return {
          state: 'invalid',
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/facet-matcher-failed',
              'the host-trusted facet matcher failed closed',
              [],
              { error: error instanceof Error ? error.message : String(error) },
            ),
          ],
        }
      }
    },
  }
}

/** Apply all inventory-eligible service definition facts owner-atomically. */
export async function registerServiceContractDefinitionsFromInventory(
  inventory: Inventory,
  registry: ServiceContractDefinitionRegistry,
): Promise<readonly DefinitionInventoryResult[]> {
  const byOwner = new Map<
    string,
    {
      readonly definition: ServiceContractDefinitionSpecV1Wire
      readonly provenance: DefinitionInventoryProvenance
    }[]
  >()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.inventoryEligible) continue
      for (const fact of contribution.facts) {
        if (fact.contract.id !== CONTRACT_DEFINITION_FACT || fact.contract.major !== 1) continue
        if (typeof fact.value !== 'object' || fact.value === null || Array.isArray(fact.value)) {
          continue
        }
        const definitionValue = fact.value as Readonly<Record<string, JsonValue>>
        if (definitionValue['kind'] !== 'service') continue
        const owner = fact.provenance.ownerExtensionId
        const entries = byOwner.get(owner) ?? []
        entries.push({
          definition: definitionValue as unknown as ServiceContractDefinitionSpecV1Wire,
          provenance: fact.provenance,
        })
        byOwner.set(owner, entries)
      }
    }
  }
  const results: DefinitionInventoryResult[] = []
  for (const owner of [...byOwner.keys()].sort(compareUtf8)) {
    results.push(await registry.replaceOwnerInventory(owner, byOwner.get(owner) ?? []))
  }
  return Object.freeze(results)
}
