/**
 * Standard editing definitions (ADR-HOST-002 §3): `common.edit/writer@1` is a contract of the
 * platform, so its contract definition — facets, matcher profile, method surface — is host
 * code, not something every extension must ship. The matcher is a deterministic, host-trusted
 * profile wrapping the SDK's facet rule (`writerOfferSatisfies`); the definition is registered
 * under the platform owner before any inventory definitions, so writer providers resolve by
 * facet (`resolveServiceProvider`) and cross execution boundaries like any provider.
 */

import { contractId, diagnostic } from '@modkit/core'
import {
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  writerOfferSatisfies,
  writerSelectionKey,
  type DefinitionInventoryResult,
  type ServiceContractDefinitionRegistry,
  type ServiceContractDefinitionSpecV1Wire,
  type ServiceFacetMatchContext,
  type ServiceFacetMatchResult,
  type ServiceFacetMatcherProfile,
  type WriterOffer,
  type WriterRequirement,
} from '@modkit/sdk'

/** Owner id the standard editing definitions are registered under. */
export const STANDARD_EDITING_OWNER = 'modkit/editing'

const REQUIREMENT_KEYS = ['formatId', 'representationId', 'mutationMode', 'minimumRoundTrip']
const OFFER_KEYS = [...REQUIREMENT_KEYS, 'providerId', 'fidelityEvidenceId']
const MUTATION_MODES = new Set(['export-only', 'mutate'])
const ROUND_TRIPS = new Set(['byte-identical', 'semantic', 'lossy', 'none'])

function facetOf(value: unknown, keys: readonly string[]): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const own = Object.keys(record)
  if (own.length !== keys.length || !keys.every(key => own.includes(key))) return undefined
  for (const key of keys) {
    if (typeof record[key] !== 'string' || (record[key] as string).length === 0) return undefined
  }
  if (!MUTATION_MODES.has(record['mutationMode'] as string)) return undefined
  if (!ROUND_TRIPS.has(record['minimumRoundTrip'] as string)) return undefined
  return record as Record<string, string>
}

function matchWriterFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const request = facetOf(context.requestFacet, REQUIREMENT_KEYS)
  const offer = facetOf(context.offerFacet, OFFER_KEYS)
  if (request === undefined || offer === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/writer-facet-invalid',
          `${context.contract}@${context.major}: writer request and offer facets must both be complete`,
        ),
      ],
    }
  }
  return writerOfferSatisfies(
    request as unknown as WriterRequirement,
    offer as unknown as WriterOffer,
  )
    ? {
        state: 'match',
        selectionKey: writerSelectionKey(request as unknown as WriterRequirement),
      }
    : { state: 'no-match' }
}

/** The host-trusted matcher profile the standard writer definition selects. */
export const WRITER_FACET_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(WRITER_FACET_MATCHER_PROFILE),
  major: 1,
  match: matchWriterFacets,
})

/** The standard definition of `common.edit/writer@1` as the registry ingests it. */
export const WRITER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze({
  schemaVersion: 1,
  kind: 'service',
  contract: WRITER_CONTRACT_ID,
  major: 1,
  offerFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({ $ref: 'https://schemas.modkit.org/x3/writer-offer.v1.schema.json' }),
  }),
  requestFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkit.org/x3/writer-requirement.v1.schema.json',
    }),
  }),
  matching: Object.freeze({ profile: WRITER_FACET_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: 'common.edit/writer-v1',
  surface: WRITER_SURFACE,
}) as ServiceContractDefinitionSpecV1Wire

export const STANDARD_EDITING_DEFINITIONS: readonly ServiceContractDefinitionSpecV1Wire[] =
  Object.freeze([WRITER_CONTRACT_DEFINITION])

/** Register the platform's editing definitions; a registry without the matcher fails closed here. */
export function registerStandardEditingDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  return definitions.replaceOwnerInventory(
    STANDARD_EDITING_OWNER,
    STANDARD_EDITING_DEFINITIONS.map(definition => ({
      definition,
      // host code, not an inventoried artifact: the provenance names the platform, digests are
      // the contract's own coordinates so a lookalike registration is distinguishable
      provenance: {
        ownerExtensionId: STANDARD_EDITING_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-editing-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-editing-definitions',
      },
    })),
  )
}
