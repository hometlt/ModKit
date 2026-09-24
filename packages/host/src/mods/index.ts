/** Host definition, exact game-id matcher and activation adapter for mod workspaces. */
export { LoadedModResourceSessions } from './resource-sessions.js'

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  MOD_WORKSPACE_COMPOSITION_CONTRACT,
  MOD_WORKSPACE_MATCHER_PROFILE,
  type ModWorkspaceComposition,
  type ModWorkspaceOfferFacet,
  type ModWorkspaceRequestFacet,
} from '@modkit/sdk/mods'
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
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard mod-workspace definition is registered. */
export const STANDARD_MODS_OWNER = 'modkit/mods'

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

function parseOffer(value: unknown): ModWorkspaceOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key))) {
    return undefined
  }
  const gameIds = stringList(record['gameIds'])
  return gameIds === undefined ? undefined : { gameIds }
}

function parseRequest(value: unknown): ModWorkspaceRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key))) {
    return undefined
  }
  return nonEmptyString(record['gameId']) ? { gameId: record['gameId'] } : undefined
}

function matchModWorkspaceFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/mod-workspace-facet-invalid',
          `${context.contract}@${context.major}: mod workspace routes must be well formed`,
        ),
      ],
    }
  }
  return offer.gameIds.includes(request.gameId)
    ? { state: 'match', selectionKey: `game=${request.gameId}` }
    : { state: 'no-match' }
}

/** Host-trusted deterministic router for named-game workspace providers. */
export const MOD_WORKSPACE_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(MOD_WORKSPACE_MATCHER_PROFILE),
  major: 1,
  match: matchModWorkspaceFacets,
})

/** Standard bounded mod-workspace composition definition. */
export const MOD_WORKSPACE_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze(
  {
    schemaVersion: 1,
    kind: 'service',
    contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/mod-workspace-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/mod-workspace-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: MOD_WORKSPACE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.mod/workspace-composition-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'compositionId', 'gameIds']),
      methods: Object.freeze({
        compose: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 32_768 }),
        }),
      }),
    }),
  },
) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardModDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = MOD_WORKSPACE_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_MODS_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_MODS_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-mod-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-mod-definitions',
      },
    },
  ])
}

export interface ModsHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface ResolveModWorkspaceRequest extends ModWorkspaceRequestFacet {
  readonly services: ModsHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type ModWorkspaceResolution =
  | Readonly<{
      state: 'resolved'
      composition: ModWorkspaceComposition
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isModWorkspaceComposition(value: unknown): value is ModWorkspaceComposition {
  const record = recordOf(value)
  return (
    record?.['contract'] === MOD_WORKSPACE_COMPOSITION_CONTRACT &&
    nonEmptyString(record['compositionId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['compose'] === 'function'
  )
}

/** Resolve and activate workspace composition for one named game. */
export async function resolveModWorkspaceComposition(
  request: ResolveModWorkspaceRequest,
): Promise<ModWorkspaceResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/mod-workspace-unavailable',
          'this host registered no service-contract definitions, so workspaces cannot be composed',
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
      contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isModWorkspaceComposition(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/mod-workspace-invalid',
            `the selected provider does not implement ${MOD_WORKSPACE_COMPOSITION_CONTRACT}@1 for ${request.gameId}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      composition: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/mod-workspace-selected',
          `selected ${lease.value.compositionId} for ${request.gameId}`,
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
          'x3.host/mod-workspace-unresolved',
          `no mod workspace provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
