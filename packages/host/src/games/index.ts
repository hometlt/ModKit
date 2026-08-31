/** Host definition, exact game-id matcher and activation adapter for installation discovery. */

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  GAME_LAUNCH_PLAN_CONTRACT,
  type GameInstallation,
  type GameInstallationDiscovery,
  type GameInstallationDiscoveryResult,
  type GameInstallationOfferFacet,
  type GameInstallationOrigin,
  type GameInstallationRequestFacet,
  type GameLaunchPlan,
  type GameLaunchPlanner,
  type GameLaunchResource,
} from '@modkit/sdk/games'
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

/** Owner id under which the standard installation-discovery definition is registered. */
export const STANDARD_GAMES_OWNER = 'modkit/games'

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
        $ref: 'https://schemas.modkit.org/x3/game-installation-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/game-installation-request.v1.schema.json',
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

/** Standard side-effect-free native launch-plan definition. */
export const GAME_LAUNCH_PLAN_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: GAME_LAUNCH_PLAN_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/game-launch-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/game-launch-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.game/launch-plan-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'plannerId', 'gameIds']),
      methods: Object.freeze({
        plan: Object.freeze({
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
  return definitions.replaceOwnerInventory(
    STANDARD_GAMES_OWNER,
    [GAME_INSTALLATION_CONTRACT_DEFINITION, GAME_LAUNCH_PLAN_CONTRACT_DEFINITION].map(
      definition => ({
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
      }),
    ),
  )
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

/** One complete, host-owned installation-discovery operation. */
export interface DiscoverGameInstallationsRequest extends ResolveGameInstallationRequest {
  readonly configuredPaths?: readonly string[]
  readonly maxCandidates: number
}

export type GameInstallationsDiscovery =
  | Readonly<{
      state: 'discovered'
      result: GameInstallationDiscoveryResult
      diagnostics: readonly Diagnostic[]
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

function validEvidence(value: unknown): boolean {
  const record = recordOf(value)
  return (
    record !== undefined &&
    nonEmptyString(record['kind']) &&
    nonEmptyString(record['path']) &&
    typeof record['found'] === 'boolean' &&
    (record['detail'] === undefined || typeof record['detail'] === 'string')
  )
}

function validProbe(value: unknown): boolean {
  const record = recordOf(value)
  const candidate = recordOf(record?.['candidate'])
  return (
    record !== undefined &&
    candidate !== undefined &&
    typeof candidate['origin'] === 'string' &&
    ORIGINS.has(candidate['origin'] as GameInstallationOrigin) &&
    nonEmptyString(candidate['displayName']) &&
    nonEmptyString(candidate['path']) &&
    typeof record['confirmed'] === 'boolean' &&
    nonEmptyString(record['normalizedPath']) &&
    Array.isArray(record['evidence']) &&
    record['evidence'].every(validEvidence)
  )
}

function validInstallation(value: unknown, gameId: string): boolean {
  const record = recordOf(value)
  return (
    record !== undefined &&
    record['gameId'] === gameId &&
    nonEmptyString(record['displayName']) &&
    nonEmptyString(record['installPath']) &&
    nonEmptyString(record['normalizedPath']) &&
    originList(record['origins']) !== undefined &&
    Array.isArray(record['evidence']) &&
    record['evidence'].every(validEvidence)
  )
}

function validDiscoveryDiagnostic(value: unknown): boolean {
  const record = recordOf(value)
  return (
    record !== undefined &&
    ['error', 'warning', 'information'].includes(String(record['severity'])) &&
    nonEmptyString(record['code']) &&
    nonEmptyString(record['message'])
  )
}

function isGameInstallationDiscoveryResult(
  value: unknown,
  gameId: string,
): value is GameInstallationDiscoveryResult {
  const record = recordOf(value)
  const probes = record?.['probes']
  const installations = record?.['installations']
  return (
    record !== undefined &&
    record['gameId'] === gameId &&
    typeof record['complete'] === 'boolean' &&
    Array.isArray(probes) &&
    probes.every(validProbe) &&
    Array.isArray(installations) &&
    installations.every(item => validInstallation(item, gameId)) &&
    new Set(installations.map(item => String(recordOf(item)?.['normalizedPath'] ?? ''))).size ===
      installations.length &&
    installations.every(item => {
      const installation = recordOf(item)
      return probes.some(probe => {
        const candidate = recordOf(recordOf(probe)?.['candidate'])
        return (
          recordOf(probe)?.['confirmed'] === true &&
          recordOf(probe)?.['normalizedPath'] === installation?.['normalizedPath'] &&
          candidate?.['path'] === installation?.['installPath']
        )
      })
    }) &&
    Array.isArray(record['diagnostics']) &&
    record['diagnostics'].every(validDiscoveryDiagnostic)
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

/** Resolve, run and release one installation provider without exposing its lease to callers. */
export async function discoverGameInstallations(
  request: DiscoverGameInstallationsRequest,
): Promise<GameInstallationsDiscovery> {
  const resolution = await resolveGameInstallationDiscovery(request)
  if (resolution.state === 'unresolved') return resolution

  try {
    const result = await resolution.discovery.discover({
      gameId: request.gameId,
      ...(request.configuredPaths === undefined
        ? {}
        : { configuredPaths: request.configuredPaths }),
      maxCandidates: request.maxCandidates,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isGameInstallationDiscoveryResult(result, request.gameId)) {
      return Object.freeze({
        state: 'unresolved' as const,
        diagnostics: Object.freeze([
          ...resolution.diagnostics,
          diagnostic(
            'error',
            'x3.host/game-installation-result-invalid',
            `installation discovery returned an invalid or unversioned completeness result for ${request.gameId}`,
          ),
        ]),
      })
    }
    return Object.freeze({
      state: 'discovered',
      result,
      diagnostics: resolution.diagnostics,
    })
  } finally {
    await resolution.release()
  }
}

export interface ResolveGameLaunchPlannerRequest extends GameInstallationRequestFacet {
  readonly services: GamesHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type GameLaunchPlannerResolution =
  | Readonly<{
      state: 'resolved'
      planner: GameLaunchPlanner
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

export interface PlanGameLaunchRequest extends ResolveGameLaunchPlannerRequest {
  readonly installation: GameInstallation
  readonly resource: GameLaunchResource
}

export type GameLaunchPlanning =
  | Readonly<{
      state: 'planned'
      plan: GameLaunchPlan
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isGameLaunchPlanner(value: unknown): value is GameLaunchPlanner {
  const record = recordOf(value)
  return (
    record?.['contract'] === GAME_LAUNCH_PLAN_CONTRACT &&
    nonEmptyString(record['plannerId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['plan'] === 'function'
  )
}

function validRelativeProcessPath(value: unknown, allowDot: boolean): value is string {
  if (!nonEmptyString(value) || value.includes('\0')) return false
  const normalized = value.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)) return false
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..' || segment.length === 0)) return false
  return allowDot || segments.some(segment => segment !== '.')
}

function validConfirmedInstallation(value: GameInstallation, gameId: string): boolean {
  const installPath = value.installPath.trim().replace(/\\/gu, '/').replace(/\/+$/gu, '')
  const normalizedPath = value.normalizedPath.trim().replace(/\\/gu, '/').replace(/\/+$/gu, '')
  return (
    validInstallation(value, gameId) &&
    installPath === normalizedPath &&
    value.evidence.length > 0 &&
    value.evidence.every(item => item.found)
  )
}

function validGameLaunchPlan(
  value: unknown,
  request: PlanGameLaunchRequest,
): value is GameLaunchPlan {
  const record = recordOf(value)
  const resource = recordOf(record?.['resource'])
  const argumentsValue = record?.['arguments']
  const argumentIndex = record?.['resourceArgumentIndex']
  return (
    record !== undefined &&
    record['schemaVersion'] === 1 &&
    nonEmptyString(record['planId']) &&
    record['gameId'] === request.gameId &&
    record['installationRoot'] === request.installation.normalizedPath &&
    resource?.['kind'] === request.resource.kind &&
    resource['path'] === request.resource.path.trim() &&
    validRelativeProcessPath(record['executableRelativePath'], false) &&
    validRelativeProcessPath(record['workingDirectoryRelativePath'], true) &&
    Array.isArray(argumentsValue) &&
    argumentsValue.length > 0 &&
    argumentsValue.length <= 64 &&
    argumentsValue.every(
      argument =>
        typeof argument === 'string' && argument.length <= 32_767 && !argument.includes('\0'),
    ) &&
    Number.isSafeInteger(argumentIndex) &&
    (argumentIndex as number) >= 0 &&
    (argumentIndex as number) < argumentsValue.length &&
    argumentsValue[argumentIndex as number] === resource['path'] &&
    record['mode'] === 'detached' &&
    record['stdio'] === 'ignore'
  )
}

/** Resolve one named-game planner. The returned provider remains pure and cannot launch a process. */
export async function resolveGameLaunchPlanner(
  request: ResolveGameLaunchPlannerRequest,
): Promise<GameLaunchPlannerResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/game-launch-unavailable',
          'this host registered no service-contract definitions, so game launch cannot be planned',
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
      contract: GAME_LAUNCH_PLAN_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isGameLaunchPlanner(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/game-launch-planner-invalid',
            `the selected provider does not implement ${GAME_LAUNCH_PLAN_CONTRACT}@1 for ${request.gameId}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      planner: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/game-launch-planner-selected',
          `selected ${lease.value.plannerId} for ${request.gameId}`,
        ),
      ]),
      release: () => resolver.release(),
    })
  } catch (error) {
    await resolver.release()
    if (request.signal?.aborted === true) throw error
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/game-launch-planner-unresolved',
          `no launch planner resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

/** Resolve, validate and release one pure game-owned launch plan. */
export async function planGameLaunch(request: PlanGameLaunchRequest): Promise<GameLaunchPlanning> {
  if (
    !validConfirmedInstallation(request.installation, request.gameId) ||
    request.resource.kind !== 'map' ||
    !nonEmptyString(request.resource.path) ||
    request.resource.path.includes('\0')
  ) {
    return Object.freeze({
      state: 'unresolved' as const,
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'x3.host/game-launch-request-invalid',
          'game launch requires one confirmed installation and one non-empty map path',
        ),
      ]),
    })
  }
  const resource = Object.freeze({ ...request.resource, path: request.resource.path.trim() })
  const resolution = await resolveGameLaunchPlanner(request)
  if (resolution.state === 'unresolved') return resolution
  try {
    const plan = await resolution.planner.plan({
      gameId: request.gameId,
      installation: request.installation,
      resource,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!validGameLaunchPlan(plan, { ...request, resource })) {
      return Object.freeze({
        state: 'unresolved' as const,
        diagnostics: Object.freeze([
          ...resolution.diagnostics,
          diagnostic(
            'error',
            'x3.host/game-launch-plan-invalid',
            `the selected provider returned an unsafe or malformed ${GAME_LAUNCH_PLAN_CONTRACT}@1 plan`,
          ),
        ]),
      })
    }
    return Object.freeze({
      state: 'planned',
      plan,
      diagnostics: resolution.diagnostics,
    })
  } finally {
    await resolution.release()
  }
}
