/** Host definition, exact game-id matcher and activation adapter for installation discovery. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  type GameInstallationDiscovery,
  type GameInstallationOfferFacet,
  type GameInstallationOrigin,
  type GameInstallationRequestFacet,
} from '@modkitx-x3/sdk/games'
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

/** Owner id under which the standard installation-discovery definition is registered. */
export const STANDARD_GAMES_OWNER = 'org.modkitx/games'

const OFFER_KEYS = new Set(['gameIds'])
const REQUEST_KEYS = new Set(['gameId'])
const ORIGINS = new Set<GameInstallationOrigin>([
  'configured-path',
  'default-directory',
  'registry',
  'steam',
  'epic',
])

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

function originList(value: unknown): readonly GameInstallationOrigin[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const origins = value.flatMap(item =>
    typeof item === 'string' && ORIGINS.has(item as GameInstallationOrigin)
      ? [item as GameInstallationOrigin]
      : [],
  )
  return origins.length === value.length && new Set(origins).size === origins.length
    ? origins
    : undefined
}

function parseOffer(value: unknown): GameInstallationOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const gameIds = stringList(record['gameIds'])
  return gameIds === undefined ? undefined : { gameIds }
}

function parseRequest(value: unknown): GameInstallationRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key))) {
    return undefined
  }
  return nonEmptyString(record['gameId']) ? { gameId: record['gameId'] } : undefined
}

function matchGameInstallationFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/game-installation-facet-invalid',
          `${context.contract}@${context.major}: game installation routes must be well formed`,
        ),
      ],
    }
  }
  return offer.gameIds.includes(request.gameId)
    ? { state: 'match', selectionKey: `game=${request.gameId}` }
    : { state: 'no-match' }
}

/** Host-trusted deterministic router for named-game discovery providers. */
export const GAME_INSTALLATION_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(GAME_INSTALLATION_MATCHER_PROFILE),
  major: 1,
  match: matchGameInstallationFacets,
})

/** Standard bounded game-installation discovery definition. */
export const GAME_INSTALLATION_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/game-installation-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/game-installation-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.game/installation-discovery-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'discoveryId', 'gameIds', 'origins']),
      methods: Object.freeze({
        discover: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardGameDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = GAME_INSTALLATION_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_GAMES_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_GAMES_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-game-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-game-definitions',
      },
    },
  ])
}

export interface GamesHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface ResolveGameInstallationRequest extends GameInstallationRequestFacet {
  readonly services: GamesHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type GameInstallationResolution =
  | Readonly<{
      state: 'resolved'
      discovery: GameInstallationDiscovery
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isGameInstallationDiscovery(value: unknown): value is GameInstallationDiscovery {
  const record = recordOf(value)
  return (
    record?.['contract'] === GAME_INSTALLATION_DISCOVERY_CONTRACT &&
    nonEmptyString(record['discoveryId']) &&
    stringList(record['gameIds']) !== undefined &&
    originList(record['origins']) !== undefined &&
    typeof record['discover'] === 'function'
  )
}

/** Resolve and activate installation discovery for one named game. */
export async function resolveGameInstallationDiscovery(
  request: ResolveGameInstallationRequest,
): Promise<GameInstallationResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/game-installation-unavailable',
          'this host registered no service-contract definitions, so installations cannot be discovered',
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
      contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (
      !isGameInstallationDiscovery(lease.value) ||
      !lease.value.gameIds.includes(request.gameId)
    ) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/game-installation-invalid',
            `the selected provider does not implement ${GAME_INSTALLATION_DISCOVERY_CONTRACT}@1 for ${request.gameId}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      discovery: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/game-installation-selected',
          `selected ${lease.value.discoveryId} for ${request.gameId}`,
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
          'x3.host/game-installation-unresolved',
          `no installation discovery provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
