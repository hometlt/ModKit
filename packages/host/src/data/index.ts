/** Host definition, exact game-id matcher and activation adapter for semantic catalogs. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  type DataCatalogAnalysis,
  type DataCatalogOfferFacet,
  type DataCatalogRequestFacet,
} from '@modkitx-x3/sdk/data'
import type {
  DefinitionInventoryResult,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkitx-x3/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard catalog-analysis definition is registered. */
export const STANDARD_DATA_OWNER = 'org.modkitx/data'

const OFFER_KEYS = new Set(['gameIds'])
const REQUEST_KEYS = new Set(['gameId'])

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function parseOffer(value: unknown): DataCatalogOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key))) {
    return undefined
  }
  const gameIds = stringList(record['gameIds'])
  return gameIds === undefined ? undefined : { gameIds }
}

function parseRequest(value: unknown): DataCatalogRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key))) {
    return undefined
  }
  return nonEmptyString(record['gameId']) ? { gameId: record['gameId'] } : undefined
}

function matchDataCatalogFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/data-catalog-facet-invalid',
          `${context.contract}@${context.major}: data catalog routes must be well formed`,
        ),
      ],
    }
  }
  return offer.gameIds.includes(request.gameId)
    ? { state: 'match', selectionKey: `game=${request.gameId}` }
    : { state: 'no-match' }
}

/** Host-trusted deterministic router for named-game catalog providers. */
export const DATA_CATALOG_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(DATA_CATALOG_MATCHER_PROFILE),
  major: 1,
  match: matchDataCatalogFacets,
})

/** Standard bounded semantic catalog-analysis definition. */
export const DATA_CATALOG_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze({
  schemaVersion: 1,
  kind: 'service',
  contract: DATA_CATALOG_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkitx.org/x3/data-catalog-offer.v1.schema.json',
    }),
  }),
  requestFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkitx.org/x3/data-catalog-request.v1.schema.json',
    }),
  }),
  matching: Object.freeze({ profile: DATA_CATALOG_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: 'common.data/catalog-analysis-v1',
  surface: Object.freeze({
    fields: Object.freeze(['contract', 'analyzerId', 'gameIds']),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: 'value',
        signal: Object.freeze({ arg: 0, key: 'signal' }),
        limits: Object.freeze({ maxBytes: 16_777_216, maxStringLength: 4_194_304 }),
      }),
    }),
  }),
}) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardDataDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = DATA_CATALOG_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_DATA_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_DATA_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-data-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-data-definitions',
      },
    },
  ])
}

export interface DataHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface ResolveDataCatalogRequest extends DataCatalogRequestFacet {
  readonly services: DataHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type DataCatalogResolution =
  | Readonly<{
      state: 'resolved'
      analysis: DataCatalogAnalysis
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isDataCatalogAnalysis(value: unknown): value is DataCatalogAnalysis {
  const record = recordOf(value)
  return (
    record?.['contract'] === DATA_CATALOG_ANALYSIS_CONTRACT &&
    nonEmptyString(record['analyzerId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['analyze'] === 'function'
  )
}

/** Resolve and activate semantic catalog analysis for one named game. */
export async function resolveDataCatalogAnalysis(
  request: ResolveDataCatalogRequest,
): Promise<DataCatalogResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/data-catalog-unavailable',
          'this host registered no service-contract definitions, so catalogs cannot be analyzed',
        ),
      ],
    }
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  try {
    const lease = await resolver.port.resolve({
      contract: DATA_CATALOG_ANALYSIS_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isDataCatalogAnalysis(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/data-catalog-invalid',
            `the selected provider does not implement ${DATA_CATALOG_ANALYSIS_CONTRACT}@1 for ${request.gameId}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      analysis: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/data-catalog-selected',
          `selected ${lease.value.analyzerId} for ${request.gameId}`,
        ),
      ]),
      release: () => resolver.release(),
    })
  } catch (error) {
    await resolver.release()
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/data-catalog-unresolved',
          `no data catalog provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
