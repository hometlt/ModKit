/** Host definition, exact game-id matcher and activation adapter for semantic maps. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  type MapSemanticAnalysis,
  type MapSemanticOfferFacet,
  type MapSemanticRequestFacet,
} from '@modkitx-x3/sdk/maps'
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

/** Owner id under which the standard semantic-map definition is registered. */
export const STANDARD_MAPS_OWNER = 'org.modkitx/maps'

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

function parseOffer(value: unknown): MapSemanticOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key))) {
    return undefined
  }
  const gameIds = stringList(record['gameIds'])
  return gameIds === undefined ? undefined : { gameIds }
}

function parseRequest(value: unknown): MapSemanticRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key))) {
    return undefined
  }
  return nonEmptyString(record['gameId']) ? { gameId: record['gameId'] } : undefined
}

function matchMapSemanticFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/map-semantic-facet-invalid',
          `${context.contract}@${context.major}: semantic map routes must be well formed`,
        ),
      ],
    }
  }
  return offer.gameIds.includes(request.gameId)
    ? { state: 'match', selectionKey: `game=${request.gameId}` }
    : { state: 'no-match' }
}

/** Host-trusted deterministic router for named-game semantic map providers. */
export const MAP_SEMANTIC_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(MAP_SEMANTIC_MATCHER_PROFILE),
  major: 1,
  match: matchMapSemanticFacets,
})

/** Standard bounded semantic map definition. */
export const MAP_SEMANTIC_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze({
  schemaVersion: 1,
  kind: 'service',
  contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkitx.org/x3/map-semantic-offer.v1.schema.json',
    }),
  }),
  requestFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkitx.org/x3/map-semantic-request.v1.schema.json',
    }),
  }),
  matching: Object.freeze({ profile: MAP_SEMANTIC_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: 'common.map/semantic-analysis-v1',
  surface: Object.freeze({
    fields: Object.freeze(['contract', 'analyzerId', 'gameIds']),
    methods: Object.freeze({
      open: Object.freeze({
        kind: 'value',
        signal: Object.freeze({ arg: 0, key: 'signal' }),
        limits: Object.freeze({ maxBytes: 33_554_432, maxStringLength: 4_194_304 }),
      }),
    }),
  }),
}) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardMapDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = MAP_SEMANTIC_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_MAPS_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_MAPS_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-map-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-map-definitions',
      },
    },
  ])
}

export interface MapHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface ResolveMapSemanticRequest extends MapSemanticRequestFacet {
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type MapSemanticResolution =
  | Readonly<{
      state: 'resolved'
      analysis: MapSemanticAnalysis
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isMapSemanticAnalysis(value: unknown): value is MapSemanticAnalysis {
  const record = recordOf(value)
  return (
    record?.['contract'] === MAP_SEMANTIC_ANALYSIS_CONTRACT &&
    nonEmptyString(record['analyzerId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['open'] === 'function'
  )
}

/** Resolve and activate semantic map opening for one named game. */
export async function resolveMapSemanticAnalysis(
  request: ResolveMapSemanticRequest,
): Promise<MapSemanticResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/map-semantic-unavailable',
          'this host registered no service-contract definitions, so maps cannot be opened semantically',
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
      contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isMapSemanticAnalysis(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/map-semantic-invalid',
            `the selected provider does not implement ${MAP_SEMANTIC_ANALYSIS_CONTRACT}@1 for ${request.gameId}`,
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
          'x3.host/map-semantic-selected',
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
          'x3.host/map-semantic-unresolved',
          `no semantic map provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
