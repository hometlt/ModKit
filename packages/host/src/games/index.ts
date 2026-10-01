/** Host definition, exact game-id matcher and activation adapter for installation discovery. */

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  GAME_INSTALLATION_DISCOVERY_CONTRACT,
  GAME_INSTALLATION_MATCHER_PROFILE,
  GAME_LAUNCH_PLAN_CONTRACT,
  type GameInstallation,
  type GameInstallationDiscovery,
  type GameInstallationDiscoveryResult,
  type GameInstallationMarker,
  type GameInstallationOrigin,
  type GameInstallationRequestFacet,
  type GameLaunchLogReport,
  type GameLaunchOfferFacet,
  type GameLaunchOptionSchema,
  type GameLaunchPlan,
  type GameLaunchPlanner,
  type GameLaunchResource,
} from '@modkit/sdk/games'
import {
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  type DefinitionInventoryResult,
  type InstallationProbes,
  type JsonValue,
  type PermissionGrant,
  type ResourceBudget,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type ServiceContractDefinitionSpecV1Wire,
  type ServiceFacetMatchContext,
  type ServiceFacetMatchResult,
  type ServiceFacetMatcherProfile,
  type ServiceProviderContributionSpecV1,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard installation-discovery definition is registered. */
export const STANDARD_GAMES_OWNER = 'modkit/games'

const OFFER_KEYS = new Set(['gameIds', 'markers', 'searchFolders', 'launchOptions'])
const OPTION_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u
const OPTION_KEYS = new Set([
  'type',
  'description',
  'default',
  'enum',
  'minimum',
  'maximum',
  'path',
])
/** A marker names files of one folder and a search folder one folder of a drive root: plain names. */
const FOLDER_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,255}$/u
const REQUEST_KEYS = new Set(['gameId'])
const ORIGINS = new Set<GameInstallationOrigin>([
  'configured-path',
  'default-directory',
  'registry',
  'steam',
  'epic',
  'search-folder',
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

function nameList(value: unknown): readonly string[] | undefined {
  const names = stringList(value)
  return names?.every(name => FOLDER_NAME.test(name) && name !== '.' && name !== '..')
    ? names
    : undefined
}

/** A launch-plan offer's `launchOptions`, or undefined when any option is not well formed. */
function launchOptionsOf(
  value: unknown,
): Readonly<Record<string, GameLaunchOptionSchema>> | undefined {
  const record = recordOf(value)
  const entries = record === undefined ? [] : Object.entries(record)
  if (entries.length === 0 || entries.length > 64) return undefined
  const options: Record<string, GameLaunchOptionSchema> = {}
  for (const [name, raw] of entries) {
    const option = recordOf(raw)
    if (
      !OPTION_NAME.test(name) ||
      option === undefined ||
      Object.keys(option).some(key => !OPTION_KEYS.has(key))
    )
      return undefined
    const type = option['type']
    if (type !== 'boolean' && type !== 'string' && type !== 'number' && type !== 'integer')
      return undefined
    const numeric = type === 'number' || type === 'integer'
    const fits = (item: unknown) =>
      numeric
        ? typeof item === 'number' &&
          Number.isFinite(item) &&
          (type === 'number' || Number.isInteger(item))
        : typeof item === type
    const { description, enum: choices, minimum, maximum, path } = option
    const fallback = option['default']
    const bound = (item: unknown) =>
      item === undefined || (numeric && typeof item === 'number' && Number.isFinite(item))
    if (
      (description !== undefined &&
        (typeof description !== 'string' || description.length > 512)) ||
      (choices !== undefined &&
        (type === 'boolean' ||
          !Array.isArray(choices) ||
          choices.length === 0 ||
          choices.length > 64 ||
          !choices.every(fits))) ||
      !bound(minimum) ||
      !bound(maximum) ||
      (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) ||
      (path !== undefined && (path !== true || type !== 'string')) ||
      (fallback !== undefined &&
        (!fits(fallback) ||
          (Array.isArray(choices) && !choices.includes(fallback)) ||
          (typeof minimum === 'number' && (fallback as number) < minimum) ||
          (typeof maximum === 'number' && (fallback as number) > maximum)))
    )
      return undefined
    options[name] = Object.freeze({
      type,
      ...(description === undefined ? {} : { description: description as string }),
      ...(fallback === undefined ? {} : { default: fallback as boolean | string | number }),
      ...(choices === undefined
        ? {}
        : { enum: Object.freeze([...(choices as (string | number)[])]) }),
      ...(minimum === undefined ? {} : { minimum: minimum as number }),
      ...(maximum === undefined ? {} : { maximum: maximum as number }),
      ...(path === undefined ? {} : { path: true }),
    })
  }
  return Object.freeze(options)
}

function parseOffer(value: unknown): GameLaunchOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const gameIds = stringList(record['gameIds'])
  if (gameIds === undefined) return undefined
  const markers: GameInstallationMarker[] = []
  if (record['markers'] !== undefined) {
    if (!Array.isArray(record['markers'])) return undefined
    for (const item of record['markers']) {
      const marker = recordOf(item)
      const files = nameList(marker?.['files'])
      if (
        marker === undefined ||
        Object.keys(marker).some(key => key !== 'gameId' && key !== 'files') ||
        typeof marker['gameId'] !== 'string' ||
        !gameIds.includes(marker['gameId']) ||
        files === undefined
      )
        return undefined
      markers.push({ gameId: marker['gameId'], files })
    }
  }
  const searchFolders =
    record['searchFolders'] === undefined ? undefined : nameList(record['searchFolders'])
  if (record['searchFolders'] !== undefined && searchFolders === undefined) return undefined
  const launchOptions =
    record['launchOptions'] === undefined ? undefined : launchOptionsOf(record['launchOptions'])
  if (record['launchOptions'] !== undefined && launchOptions === undefined) return undefined
  return {
    gameIds,
    ...(markers.length === 0 ? {} : { markers }),
    ...(searchFolders === undefined ? {} : { searchFolders }),
    ...(launchOptions === undefined ? {} : { launchOptions }),
  }
}

/** Every well-formed offer of `contract`@1 that an activation-eligible provider makes. */
function* gameOffersOf(inventory: Inventory, contract: string): Generator<GameLaunchOfferFacet> {
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (
        !contribution.activationEligible ||
        manifest?.contract.id !== SERVICE_PROVIDER_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1
      )
        continue
      const spec = manifest.spec as unknown as ServiceProviderContributionSpecV1
      for (const offer of spec.provides) {
        if (offer.contract !== contract || offer.major !== 1) continue
        const facet = parseOffer(offer.facet)
        if (facet !== undefined) yield facet
      }
    }
  }
}

/**
 * The launch options each game's launch-plan offer declares, by game id: manifest data, read
 * without activating a planner, for editors that offer and check a launch configuration's options.
 */
export function gameLaunchOptionsOf(
  inventory: Inventory,
): ReadonlyMap<string, Readonly<Record<string, GameLaunchOptionSchema>>> {
  const byGame = new Map<string, Readonly<Record<string, GameLaunchOptionSchema>>>()
  for (const facet of gameOffersOf(inventory, GAME_LAUNCH_PLAN_CONTRACT))
    for (const gameId of facet.gameIds)
      if (facet.launchOptions !== undefined && !byGame.has(gameId))
        byGame.set(gameId, facet.launchOptions)
  return byGame
}

/** What the host's folder search looks for, gathered from every installation-discovery offer. */
export interface GameInstallationSearch {
  readonly markers: readonly GameInstallationMarker[]
  /** Store and publisher folders the games name, searched at every local drive root. */
  readonly searchFolders: readonly string[]
}

/**
 * The markers and search folders every activation-eligible installation-discovery offer of the
 * inventory declares — manifest data, read without activating a provider — for
 * `searchInstallationFolders` of `@modkit/host/node`. An offer that is not well formed adds nothing.
 */
export function gameInstallationSearchOf(inventory: Inventory): GameInstallationSearch {
  const markers: GameInstallationMarker[] = []
  const searchFolders = new Map<string, string>()
  for (const facet of gameOffersOf(inventory, GAME_INSTALLATION_DISCOVERY_CONTRACT)) {
    markers.push(...(facet.markers ?? []))
    for (const folder of facet.searchFolders ?? [])
      if (!searchFolders.has(folder.toLowerCase())) searchFolders.set(folder.toLowerCase(), folder)
  }
  return Object.freeze({
    markers: Object.freeze(markers),
    searchFolders: Object.freeze([...searchFolders.values()]),
  })
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
  /** A desktop host's platform probes (`@modkit/host/node` `createNodeInstallationProbes`). */
  readonly installationProbes?: InstallationProbes
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
  /** This game's folders from `searchInstallationFolders`; the provider confirms them last. */
  readonly searchPaths?: readonly string[]
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
    ...(request.services.installationProbes === undefined
      ? {}
      : { installationProbes: request.services.installationProbes }),
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
      ...(request.searchPaths === undefined || request.searchPaths.length === 0
        ? {}
        : { searchPaths: request.searchPaths }),
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
  /** The user's launch options, passed to the game's planner as they are. */
  readonly options?: Readonly<Record<string, JsonValue>>
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

/** Exported for its test only. */
export function validGameLaunchPlan(
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
    argumentsValue.length <= 64 &&
    argumentsValue.every(
      argument =>
        typeof argument === 'string' && argument.length <= 32_767 && !argument.includes('\0'),
    ) &&
    // either the exact resource path at its index, or no resource on the command line at all
    (argumentIndex === null
      ? !argumentsValue.includes(resource['path'])
      : Number.isSafeInteger(argumentIndex) &&
        (argumentIndex as number) >= 0 &&
        (argumentIndex as number) < argumentsValue.length &&
        argumentsValue[argumentIndex as number] === resource['path']) &&
    record['mode'] === 'detached' &&
    record['stdio'] === 'ignore' &&
    validProcessNames(record['runningProcessNames']) &&
    validLogLocation(record['logs'])
  )
}

/** Bare executable image names (`Game_x64.exe`), never paths. */
function validProcessNames(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 8 &&
      value.every(name => nonEmptyString(name) && name.length <= 260 && !/[\\/:\0*?]/u.test(name)))
  )
}

/** A folder below a known per-user base and plain file-name patterns (`*` only). */
function validLogLocation(value: unknown): boolean {
  if (value === undefined) return true
  const record = recordOf(value)
  const patterns = record?.['patterns']
  return (
    record !== undefined &&
    (record['base'] === 'user-documents' || record['base'] === 'user-local-app-data') &&
    validRelativeProcessPath(record['relativePath'], false) &&
    Array.isArray(patterns) &&
    patterns.length > 0 &&
    patterns.length <= 8 &&
    patterns.every(
      pattern => nonEmptyString(pattern) && pattern.length <= 260 && !/[\\/:\0?]/u.test(pattern),
    )
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

export interface InterpretGameLaunchLogRequest extends ResolveGameLaunchPlannerRequest {
  readonly resource: GameLaunchResource
  readonly fileName: string
  readonly text: string
}

/**
 * Ask the game's planner what one log file of a launched run says. A planner without a log
 * reader, or one that fails, reports nothing rather than guessing.
 */
export async function interpretGameLaunchLog(
  request: InterpretGameLaunchLogRequest,
): Promise<GameLaunchLogReport & { readonly hostDiagnostics: readonly Diagnostic[] }> {
  const empty = (hostDiagnostics: readonly Diagnostic[]) =>
    Object.freeze({ diagnostics: Object.freeze([]), final: false, hostDiagnostics })
  const resolution = await resolveGameLaunchPlanner(request)
  if (resolution.state === 'unresolved') return empty(resolution.diagnostics)
  try {
    const interpret = resolution.planner.interpretLog?.bind(resolution.planner)
    if (interpret === undefined) return empty(resolution.diagnostics)
    const report = await interpret({
      resource: request.resource,
      fileName: request.fileName,
      text: request.text,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const diagnostics = Array.isArray(report?.diagnostics)
      ? report.diagnostics.filter(
          item =>
            (item?.severity === 'error' ||
              item?.severity === 'warning' ||
              item?.severity === 'information') &&
            nonEmptyString(item.code) &&
            nonEmptyString(item.message) &&
            (item.path === undefined || nonEmptyString(item.path)) &&
            (item.line === undefined || (Number.isSafeInteger(item.line) && item.line >= 0)),
        )
      : []
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics.slice(0, 1_000)),
      final: report?.final === true,
      hostDiagnostics: resolution.diagnostics,
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    return empty([
      ...resolution.diagnostics,
      diagnostic(
        'warning',
        'x3.host/game-launch-log-unreadable',
        `the game could not read ${request.fileName}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ])
  } finally {
    await resolution.release()
  }
}

/** Resolve, validate and release one pure game-owned launch plan. */
export async function planGameLaunch(request: PlanGameLaunchRequest): Promise<GameLaunchPlanning> {
  if (
    !validConfirmedInstallation(request.installation, request.gameId) ||
    (request.resource.kind !== 'map' && request.resource.kind !== 'mod') ||
    !nonEmptyString(request.resource.path) ||
    request.resource.path.includes('\0')
  ) {
    return Object.freeze({
      state: 'unresolved' as const,
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'x3.host/game-launch-request-invalid',
          'game launch requires one confirmed installation and one non-empty map or mod path',
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
      ...(request.options === undefined ? {} : { options: request.options }),
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
