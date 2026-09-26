/** Standard definition of the optional `common.compression/oodle-decoder@1` service. */

import type {
  OodleDecoder,
  DefinitionInventoryResult,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
} from '@modkit/sdk'
import { FACETLESS_SERVICE_MATCHER_PROFILE } from './service-definitions.js'

export const STANDARD_COMPRESSION_OWNER = 'modkit/compression'
/** The sdk's `OODLE_DECODER_CONTRACT`, spelled here so the host needs no runtime sdk import for it. */
const OODLE_DECODER = 'common.compression/oodle-decoder' as const satisfies OodleDecoder['contract']

export const OODLE_DECODER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze(
  {
    schemaVersion: 1,
    kind: 'service',
    contract: OODLE_DECODER,
    major: 1,
    offerFacet: Object.freeze({ presence: 'forbidden' }),
    requestFacet: Object.freeze({ presence: 'forbidden' }),
    matching: Object.freeze({ profile: FACETLESS_SERVICE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.compression/oodle-decoder-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract']),
      methods: Object.freeze({
        decompressBlocks: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  },
) as ServiceContractDefinitionSpecV1Wire

export function registerStandardCompressionDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = OODLE_DECODER_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_COMPRESSION_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_COMPRESSION_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-compression-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-compression-definitions',
      },
    },
  ])
}
