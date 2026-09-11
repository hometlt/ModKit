/** Standard definition and deterministic target-format routing for UVM native encoders. */

import { contractId, diagnostic } from '@modkit/core'
import {
  NATIVE_MODEL_ENCODER_CONTRACT,
  NATIVE_MODEL_ENCODER_MATCHER_PROFILE,
  type NativeModelEncoderOfferFacet,
  type NativeModelEncoderRequestFacet,
} from '@modkit/sdk/model-encoding'
import type {
  DefinitionInventoryResult,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkit/sdk'

export const STANDARD_MODEL_ENCODING_OWNER = 'modkit/model-encoding'

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function parseOffer(value: unknown): NativeModelEncoderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => key !== 'formatIds')) return undefined
  const values = record['formatIds']
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every(nonEmptyString) ||
    new Set(values).size !== values.length
  )
    return undefined
  return { formatIds: values as string[] }
}

function parseRequest(value: unknown): NativeModelEncoderRequestFacet | undefined {
  const record = recordOf(value)
  if (
    record === undefined ||
    Object.keys(record).some(key => key !== 'formatId') ||
    !nonEmptyString(record['formatId'])
  )
    return undefined
  return { formatId: record['formatId'] }
}

function matchNativeModelEncoder(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/native-model-encoder-facet-invalid',
          `${context.contract}@${context.major}: native model encoder route is malformed`,
        ),
      ],
    }
  }
  return offer.formatIds.includes(request.formatId)
    ? { state: 'match', selectionKey: `format=${request.formatId}` }
    : { state: 'no-match' }
}

export const NATIVE_MODEL_ENCODER_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(NATIVE_MODEL_ENCODER_MATCHER_PROFILE),
  major: 1,
  match: matchNativeModelEncoder,
})

export const NATIVE_MODEL_ENCODER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: NATIVE_MODEL_ENCODER_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/native-model-encoder-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/native-model-encoder-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: NATIVE_MODEL_ENCODER_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.model/native-encoder-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'formatId', 'extension', 'mediaType']),
      methods: Object.freeze({
        encode: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

export function registerStandardModelEncodingDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = NATIVE_MODEL_ENCODER_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_MODEL_ENCODING_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_MODEL_ENCODING_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-model-encoding-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-model-encoding-definitions',
      },
    },
  ])
}
