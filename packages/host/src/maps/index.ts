/** Host definition, exact game-id matcher and activation adapter for semantic maps. */

import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  contractId,
  diagnostic,
  errorCode,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  type CandidateWorldSceneSource,
  type MapPreviewPreparationDiagnostic,
  type MapPreviewPreparationNamespaceIndex,
  type MapPreviewPreparationNamespaceSearchIndex,
  type MapPreviewPreparationNamespaceSearchRequest,
  type MapPreviewPreparationOfferFacet,
  type MapPreviewPreparationPort,
  type MapPreviewPreparationRequest,
  type MapPreviewPreparationRequestFacet,
  type MapPreviewPreparationResult,
  type MapPreviewHostResourceRoot,
  type MapPreviewResourcePlan,
  type MapPreviewSelectionCandidate,
  type MapPreviewSubjectNamespaceRoot,
  type MapSemanticDocument,
  type MapSemanticDocumentRequirement,
  type MapSemanticAnalysis,
  type MapSemanticOfferFacet,
  type MapSemanticRequestFacet,
  type ResolvedMapWorkspaceAnalysis,
  type ResolvedMapWorkspacePlan,
  type ResolvedMapWorkspaceSnapshot,
  type WorldScenePageRequest,
  type WorldSceneSource,
} from '@modkitx-x3/sdk/maps'
import { resolveModWorkspaceGraph } from '@modkitx-x3/sdk'
import type {
  AnyDescriptor,
  AssetDiagnosticWire,
  AssetSession,
  DataCatalogSnapshot,
  DataSourceMajor,
  DataSourceOf,
  DefinitionInventoryResult,
  KnownDataSourceId,
  Lease,
  ModWorkspaceLock,
  NamespaceEntrySource,
  NamespaceEntrySearchQuery,
  PermissionGrant,
  ResourceBudget,
  ResourceSessionPort,
  RevisionId,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkitx-x3/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { CompanionOrigin } from '../input-resolution.js'
import type { Inventory } from '../inventory.js'
import { createWorkspaceNamespaceCompanionOrigin } from '../namespace-origin.js'
import { createResourceSession } from '../resource-session.js'
import { createHostServiceResolver } from '../service-leases.js'
import { assembleSubjectDescriptor, createAssetSession } from '../session.js'
import { createCandidateWorldSceneLease } from './world-source.js'

/** Owner id under which the standard semantic-map definition is registered. */
export const STANDARD_MAPS_OWNER = 'org.modkitx/maps'

const OFFER_KEYS = new Set(['gameIds'])
const REQUEST_KEYS = new Set(['gameId'])
const PREVIEW_OFFER_KEYS = new Set(['subjectFormatIds'])
const PREVIEW_REQUEST_KEYS = new Set(['subjectFormatId'])

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

function parsePreviewOffer(value: unknown): MapPreviewPreparationOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !PREVIEW_OFFER_KEYS.has(key))) {
    return undefined
  }
  const subjectFormatIds = stringList(record['subjectFormatIds'])
  return subjectFormatIds === undefined ? undefined : { subjectFormatIds }
}

function parsePreviewRequest(value: unknown): MapPreviewPreparationRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !PREVIEW_REQUEST_KEYS.has(key))) {
    return undefined
  }
  return nonEmptyString(record['subjectFormatId'])
    ? { subjectFormatId: record['subjectFormatId'] }
    : undefined
}

function matchMapPreviewPreparationFacets(
  context: ServiceFacetMatchContext,
): ServiceFacetMatchResult {
  const offer = parsePreviewOffer(context.offerFacet)
  const request = parsePreviewRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/map-preview-preparation-facet-invalid',
          `${context.contract}@${context.major}: map preview preparation routes must be well formed`,
        ),
      ],
    }
  }
  return offer.subjectFormatIds.includes(request.subjectFormatId)
    ? { state: 'match', selectionKey: `subject-format=${request.subjectFormatId}` }
    : { state: 'no-match' }
}

/** Exact data-driven routing by the format id already selected by the ordinary codec open. */
export const MAP_PREVIEW_PREPARATION_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE),
  major: 1,
  match: matchMapPreviewPreparationFacets,
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

/** Additive workspace/VFS service; the frozen semantic-analysis@1 surface is unchanged. */
export const RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
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
    conformanceProfile: 'common.map/resolved-workspace-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'analyzerId', 'gameIds']),
      methods: Object.freeze({
        plan: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 1_048_576 }),
        }),
        analyze: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 33_554_432, maxStringLength: 4_194_304 }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** JSON-only preparation surface; host capabilities never cross this service boundary. */
export const MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: MAP_PREVIEW_PREPARATION_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/map-preview-preparation-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/map-preview-preparation-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({
      profile: MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
      major: 1,
    }),
    conformanceProfile: 'common.map/preview-preparation-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'preparationId', 'subjectFormatIds']),
      methods: Object.freeze({
        prepare: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 1_048_576 }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardMapDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const registered = [
    MAP_SEMANTIC_CONTRACT_DEFINITION,
    RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION,
    MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION,
  ]
  return definitions.replaceOwnerInventory(
    STANDARD_MAPS_OWNER,
    registered.map(definition => ({
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
    })),
  )
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

export type ResolvedMapWorkspaceResolution =
  | Readonly<{
      state: 'resolved'
      workspace: ResolvedMapWorkspaceAnalysis
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isResolvedMapWorkspace(value: unknown): value is ResolvedMapWorkspaceAnalysis {
  const record = recordOf(value)
  return (
    record?.['contract'] === RESOLVED_MAP_WORKSPACE_CONTRACT &&
    nonEmptyString(record['analyzerId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['plan'] === 'function' &&
    typeof record['analyze'] === 'function'
  )
}

/** Resolve the additive workspace service without changing semantic-analysis@1. */
export async function resolveResolvedMapWorkspace(
  request: ResolveMapSemanticRequest,
): Promise<ResolvedMapWorkspaceResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/resolved-map-workspace-unavailable',
          'this host registered no service-contract definitions for workspace maps',
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
      contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isResolvedMapWorkspace(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/resolved-map-workspace-invalid',
            `selected provider does not implement ${RESOLVED_MAP_WORKSPACE_CONTRACT}@1`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      workspace: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/resolved-map-workspace-selected',
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
          'x3.host/resolved-map-workspace-unresolved',
          `no workspace map provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

export interface ResolveMapPreviewPreparationRequest extends MapPreviewPreparationRequestFacet {
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type MapPreviewPreparationResolution =
  | Readonly<{
      state: 'resolved'
      preparation: MapPreviewPreparationPort
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{ state: 'unresolved'; diagnostics: readonly Diagnostic[] }>

function isMapPreviewPreparation(value: unknown): value is MapPreviewPreparationPort {
  const record = recordOf(value)
  return (
    record?.['contract'] === MAP_PREVIEW_PREPARATION_CONTRACT &&
    nonEmptyString(record['preparationId']) &&
    stringList(record['subjectFormatIds']) !== undefined &&
    typeof record['prepare'] === 'function'
  )
}

/** Resolve preparation by descriptor format data; common host code never names a game or format. */
export async function resolveMapPreviewPreparation(
  request: ResolveMapPreviewPreparationRequest,
): Promise<MapPreviewPreparationResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/map-preview-preparation-unavailable',
          'this host registered no service-contract definitions for map preview preparation',
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
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      major: 1,
      facet: { subjectFormatId: request.subjectFormatId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (
      !isMapPreviewPreparation(lease.value) ||
      !lease.value.subjectFormatIds.includes(request.subjectFormatId)
    ) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/map-preview-preparation-invalid',
            `selected provider does not implement ${MAP_PREVIEW_PREPARATION_CONTRACT}@1`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved' as const,
      preparation: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/map-preview-preparation-selected',
          `selected ${lease.value.preparationId} for the subject format`,
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
          'x3.host/map-preview-preparation-unresolved',
          `no map preview preparation provider resolved (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

export interface ResolvedMapWorkspaceLimits {
  readonly maxRequirements: number
  readonly maxDocumentBytes: number
  readonly maxTotalBytes: number
  readonly maxObjects: number
  readonly maxRegions: number
  readonly maxTerrainCells: number
  readonly maxTerrainSamples: number
  readonly maxDepth: number
  readonly maxPageSize: number
  readonly maxDiagnostics: number
}

export interface AnalyzeResolvedMapWorkspaceRequest {
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly workspace: ModWorkspaceLock
  readonly resources: ResourceSessionPort
  readonly catalog?: DataCatalogSnapshot
  readonly limits: ResolvedMapWorkspaceLimits
  readonly signal?: AbortSignal
}

export type AnalyzedResolvedMapWorkspace =
  | Readonly<{
      state: 'resolved'
      snapshot: ResolvedMapWorkspaceSnapshot
      plan: ResolvedMapWorkspacePlan
      world: Lease<CandidateWorldSceneSource>
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function withinOperationBudgets(limits: ResolvedMapWorkspaceLimits, budgets: ResourceBudget): void {
  if (BigInt(limits.maxTotalBytes) > budgets.maxInputBytes) {
    throw new TypeError('maxTotalBytes exceeds ResourceBudget.maxInputBytes')
  }
  if (
    limits.maxDocumentBytes > budgets.maxScalarBytes ||
    limits.maxDocumentBytes > limits.maxTotalBytes
  ) {
    throw new TypeError('maxDocumentBytes exceeds scalar or total byte budget')
  }
  for (const [label, value] of [
    ['maxRequirements', limits.maxRequirements],
    ['maxObjects', limits.maxObjects],
    ['maxRegions', limits.maxRegions],
    ['maxTerrainCells', limits.maxTerrainCells],
    ['maxTerrainSamples', limits.maxTerrainSamples],
    ['maxPageSize', limits.maxPageSize],
  ] as const) {
    if (value > budgets.maxNodes) throw new TypeError(`${label} exceeds ResourceBudget.maxNodes`)
  }
  if (limits.maxDepth > budgets.maxDepth) {
    throw new TypeError('maxDepth exceeds ResourceBudget.maxDepth')
  }
  if (limits.maxDiagnostics > budgets.maxDiagnostics) {
    throw new TypeError('maxDiagnostics exceeds ResourceBudget.maxDiagnostics')
  }
}

function boundedDiagnostics(items: readonly Diagnostic[], maximum: number): readonly Diagnostic[] {
  if (items.length <= maximum) return Object.freeze([...items])
  const marker = diagnostic(
    'warning',
    'x3.host/resolved-map-diagnostics-truncated',
    `workspace map diagnostics were truncated to maxDiagnostics ${maximum}`,
  )
  return Object.freeze(maximum === 1 ? [marker] : [...items.slice(0, maximum - 1), marker])
}

function validateWorkspacePlan(
  plan: ResolvedMapWorkspacePlan,
  workspace: ModWorkspaceLock,
  maxRequirements: number,
): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.workspaceId !== workspace.workspaceId ||
    plan.gameId !== workspace.gameId ||
    !nonEmptyString(plan.analyzerId) ||
    !Array.isArray(plan.requirements) ||
    plan.requirements.length > maxRequirements
  ) {
    throw new TypeError('workspace map provider returned an invalid or foreign plan')
  }
  const active = workspace.loadOrder.find(item => item.rootId === workspace.activeRootId)
  if (active === undefined || plan.mapId !== active.sourcePath) {
    throw new TypeError('workspace map plan does not name the active root exactly')
  }
  const root = active.sourcePath.replaceAll('\\', '/')
  const prefix = `${root}/`
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const requirement of plan.requirements) {
    const path = requirement.path.replaceAll('\\', '/')
    if (
      !nonEmptyString(requirement.requirementId) ||
      !nonEmptyString(requirement.kind) ||
      typeof requirement.required !== 'boolean' ||
      path !== requirement.path ||
      !path.startsWith(prefix) ||
      path.slice(prefix.length).includes('/') ||
      path.split('/').some((segment: string) => segment === '.' || segment === '..') ||
      ids.has(requirement.requirementId) ||
      paths.has(path.toLowerCase())
    ) {
      throw new TypeError('workspace map plan contains a duplicate, non-confined or invalid read')
    }
    ids.add(requirement.requirementId)
    paths.add(path.toLowerCase())
  }
}

async function readResourceBytes(
  resources: ResourceSessionPort,
  requirement: MapSemanticDocumentRequirement,
  maxDocumentBytes: number,
  remainingTotalBytes: number,
  signal?: AbortSignal,
): Promise<
  | {
      readonly state: 'resolved'
      readonly document: MapSemanticDocument
      readonly revision: RevisionId
      readonly contentFingerprint: string
      readonly consumedBytes: number
    }
  | {
      readonly state: 'unresolved'
      readonly diagnostic: Diagnostic
      readonly consumedBytes: number
    }
> {
  if (remainingTotalBytes <= 0) {
    return {
      state: 'unresolved',
      diagnostic: diagnostic(
        'warning',
        'x3.host/resolved-map-total-budget-exceeded',
        `${requirement.path} cannot be read because maxTotalBytes is exhausted`,
      ),
      consumedBytes: 0,
    }
  }
  const resolved = await resources.resolve(
    {
      id: requirement.requirementId,
      logicalId: requirement.path,
      role: 'buffer',
      scopes: ['current-mount', 'enclosing-container', 'workspace-dependency-layer'],
    },
    signal,
  )
  if (resolved.state === 'unresolved') {
    return { state: 'unresolved', diagnostic: resolved.diagnostic, consumedBytes: 0 }
  }
  try {
    const source = resolved.lease.value
    if (source.kind !== 'bytes') {
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          'x3.host/resolved-map-resource-not-bytes',
          `${requirement.path} resolved to a namespace instead of bytes`,
        ),
        consumedBytes: 0,
      }
    }
    if (
      source.size !== undefined &&
      (source.size > BigInt(maxDocumentBytes) || source.size > BigInt(remainingTotalBytes))
    ) {
      const totalExceeded = source.size > BigInt(remainingTotalBytes)
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          totalExceeded
            ? 'x3.host/resolved-map-total-budget-exceeded'
            : 'x3.host/resolved-map-document-budget-exceeded',
          totalExceeded
            ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}`
            : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`,
        ),
        consumedBytes: 0,
      }
    }
    const chunks: Uint8Array[] = []
    let byteLength = 0
    for await (const chunk of source.stream(undefined, signal)) {
      byteLength += chunk.byteLength
      if (byteLength > maxDocumentBytes || byteLength > remainingTotalBytes) {
        return {
          state: 'unresolved',
          diagnostic: diagnostic(
            'warning',
            byteLength > remainingTotalBytes
              ? 'x3.host/resolved-map-total-budget-exceeded'
              : 'x3.host/resolved-map-document-budget-exceeded',
            byteLength > remainingTotalBytes
              ? `${requirement.path} exceeds remaining maxTotalBytes ${remainingTotalBytes}`
              : `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`,
          ),
          consumedBytes: byteLength,
        }
      }
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      state: 'resolved',
      document: Object.freeze({ path: requirement.path, bytes }),
      revision: resolved.revision,
      contentFingerprint: await fingerprintBytes(bytes),
      consumedBytes: byteLength,
    }
  } finally {
    await resolved.lease.release()
  }
}

/** SHA-256 identity input; revisions remain authoritative and content prevents revision aliases. */
async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy.buffer))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Product path: service resolution -> provider plan -> ResourceSession/VFS reads -> semantic v1 ->
 * publisher-qualified world candidate. The generic host contains no game ids or document names.
 */
export async function analyzeResolvedMapWorkspace(
  request: AnalyzeResolvedMapWorkspaceRequest,
): Promise<AnalyzedResolvedMapWorkspace> {
  const limits: ResolvedMapWorkspaceLimits = {
    maxRequirements: positiveBound(request.limits.maxRequirements, 'maxRequirements'),
    maxDocumentBytes: positiveBound(request.limits.maxDocumentBytes, 'maxDocumentBytes'),
    maxTotalBytes: positiveBound(request.limits.maxTotalBytes, 'maxTotalBytes'),
    maxObjects: positiveBound(request.limits.maxObjects, 'maxObjects'),
    maxRegions: positiveBound(request.limits.maxRegions, 'maxRegions'),
    maxTerrainCells: positiveBound(request.limits.maxTerrainCells, 'maxTerrainCells'),
    maxTerrainSamples: positiveBound(request.limits.maxTerrainSamples, 'maxTerrainSamples'),
    maxDepth: positiveBound(request.limits.maxDepth, 'maxDepth'),
    maxPageSize: positiveBound(request.limits.maxPageSize, 'maxPageSize'),
    maxDiagnostics: positiveBound(request.limits.maxDiagnostics, 'maxDiagnostics'),
  }
  withinOperationBudgets(limits, request.budgets)
  if (request.resources.state() !== 'live') {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'warning',
          'x3.host/resolved-map-resource-session-disposed',
          'workspace map analysis requires a live revision-pinned ResourceSessionPort',
        ),
      ],
    }
  }
  const resolution = await resolveResolvedMapWorkspace({
    services: request.services,
    gameId: request.workspace.gameId,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (resolution.state === 'unresolved') return resolution
  const diagnostics: Diagnostic[] = [...resolution.diagnostics]
  try {
    const plan = await resolution.workspace.plan({
      workspace: request.workspace,
      maxRequirements: limits.maxRequirements,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    validateWorkspacePlan(plan, request.workspace, limits.maxRequirements)
    diagnostics.push(
      ...plan.diagnostics.map(item =>
        diagnostic(item.severity, item.code, item.message, undefined, {
          analyzerId: plan.analyzerId,
        }),
      ),
    )
    if (!plan.complete) {
      await resolution.release()
      return {
        state: 'unresolved',
        diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics),
      }
    }
    const provenanceOffset = request.resources.provenance().length
    const documents: MapSemanticDocument[] = []
    const revisions: string[] = []
    const unresolvedRequirementIds: string[] = []
    let totalBytes = 0
    for (const requirement of plan.requirements) {
      request.signal?.throwIfAborted()
      const loaded = await readResourceBytes(
        request.resources,
        requirement,
        limits.maxDocumentBytes,
        limits.maxTotalBytes - totalBytes,
        request.signal,
      )
      totalBytes += loaded.consumedBytes
      if (loaded.state === 'unresolved') {
        diagnostics.push(loaded.diagnostic)
        unresolvedRequirementIds.push(requirement.requirementId)
        continue
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw new TypeError(`workspace map documents exceed maxTotalBytes ${limits.maxTotalBytes}`)
      }
      documents.push(loaded.document)
      revisions.push(
        `${requirement.requirementId}:${requirement.path}@${String(loaded.revision)}#${loaded.contentFingerprint}`,
      )
    }
    if (request.resources.state() !== 'live') {
      throw new Error('resource session was disposed while workspace map documents were loading')
    }
    const snapshotId = [
      `session=${String(request.resources.revision)}`,
      `workspace=${encodeURIComponent(request.workspace.workspaceId)}`,
      `map=${encodeURIComponent(plan.mapId)}`,
      ...revisions,
    ].join('|')
    const snapshot = await resolution.workspace.analyze({
      workspaceId: request.workspace.workspaceId,
      gameId: request.workspace.gameId,
      mapId: plan.mapId,
      documents,
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      maxDocuments: limits.maxRequirements,
      maxDocumentBytes: limits.maxDocumentBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxObjects: limits.maxObjects,
      maxRegions: limits.maxRegions,
      maxTerrainCells: limits.maxTerrainCells,
      maxTerrainSamples: limits.maxTerrainSamples,
      maxDepth: limits.maxDepth,
      maxDiagnostics: limits.maxDiagnostics,
      snapshotId,
      unresolvedRequirementIds,
      requiredRequirementIds: plan.requirements
        .filter(item => item.required)
        .map(item => item.requirementId),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (request.resources.state() !== 'live') {
      throw new Error('resource session was disposed while workspace map was analyzed')
    }
    const world = createCandidateWorldSceneLease(
      snapshot,
      request.resources.provenance().slice(provenanceOffset),
      limits.maxPageSize,
    )
    let released = false
    return Object.freeze({
      state: 'resolved',
      snapshot,
      plan,
      world,
      diagnostics: boundedDiagnostics(diagnostics, limits.maxDiagnostics),
      async release() {
        if (released) return
        released = true
        const results = await Promise.allSettled([world.release(), resolution.release()])
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      },
    })
  } catch (error) {
    await resolution.release()
    if (request.signal?.aborted) throw error
    return {
      state: 'unresolved',
      diagnostics: boundedDiagnostics(
        [
          ...diagnostics,
          diagnostic(
            'warning',
            'x3.host/resolved-map-workspace-failed',
            error instanceof Error ? error.message : String(error),
          ),
        ],
        limits.maxDiagnostics,
      ),
    }
  }
}

export interface OpenMapPreviewAssetSessionRequest extends AnalyzeResolvedMapWorkspaceRequest {
  /** Stable URI of the map/container subject whose workspace the host is projecting. */
  readonly subjectUri: string
}

export type MapPreviewAssetSessionResult =
  | Readonly<{
      state: 'opened'
      session: AssetSession
      descriptor: AnyDescriptor
      snapshot: ResolvedMapWorkspaceSnapshot
      plan: ResolvedMapWorkspacePlan
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function previewDiagnostic(item: Diagnostic, index: number): AssetDiagnosticWire {
  return Object.freeze({
    id: `map-preview-${String(index)}`,
    category: 'unknown',
    code: item.code,
    severity: item.severity,
    message: item.message,
    ...(item.path === undefined ? {} : { path: item.path }),
    ...(item.range === undefined ? {} : { range: item.range }),
  })
}

/**
 * One consumer lease over the analysis-owned publisher candidate.
 *
 * The adapter changes only the callable coordinate. All partial/unavailable states, named unknown
 * facets, paging identities and provenance are delegated unchanged. Releasing a consumer lease
 * invalidates that consumer without releasing the analysis shared by other consumers.
 */
function borrowCommonWorldScene(candidate: CandidateWorldSceneSource): Lease<WorldSceneSource> {
  let live = true
  const assertLive = (signal?: AbortSignal): void => {
    signal?.throwIfAborted()
    if (!live) throw new TypeError('world scene data-source lease has been released')
  }
  const source: WorldSceneSource = Object.freeze({
    contract: WORLD_SCENE_SOURCE_CONTRACT,
    major: 1,
    snapshotId: candidate.snapshotId,
    async info(signal?: AbortSignal) {
      assertLive(signal)
      const info = await candidate.info(signal)
      assertLive(signal)
      return Object.freeze({ ...info, contract: WORLD_SCENE_SOURCE_CONTRACT })
    },
    async page(request: WorldScenePageRequest, signal?: AbortSignal) {
      assertLive(signal)
      const page = await candidate.page(request, signal)
      assertLive(signal)
      return page
    },
  })
  return Object.freeze({
    value: source,
    release() {
      live = false
      return Promise.resolve()
    },
  })
}

/**
 * Opens a host-owned, read-only AssetSession over the common world candidate.
 *
 * Ownership transfers with the call: unresolved opens dispose `resources` immediately; opened
 * sessions retain the provider/world analysis and ResourceSession until `session.dispose()`. The
 * common source remains publisher-candidate and makes no `world-interchange` GA claim.
 */
export async function openMapPreviewAssetSession(
  request: OpenMapPreviewAssetSessionRequest,
): Promise<MapPreviewAssetSessionResult> {
  let analyzed: AnalyzedResolvedMapWorkspace
  try {
    analyzed = await analyzeResolvedMapWorkspace(request)
  } catch (error) {
    await request.resources.dispose()
    throw error
  }
  if (analyzed.state === 'unresolved') {
    await request.resources.dispose()
    return analyzed
  }

  try {
    const descriptor = await assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: request.subjectUri,
      origin: {
        kind: 'namespace',
        root: { id: request.workspace.activeRootId, uri: request.subjectUri },
        revision: request.resources.revision,
      },
      interpretation: 'none',
      candidates: [],
      traits: [],
      operations: [],
      constraints: {
        readOnly: true,
        seekable: false,
        randomAccess: true,
        trusted: false,
      },
      dataSources: [{ contract: WORLD_SCENE_SOURCE_CONTRACT, major: 1 }],
      diagnostics: analyzed.diagnostics.map(previewDiagnostic),
      revision: request.resources.revision,
    })
    const managed = createAssetSession({
      revision: request.resources.revision,
      descriptor,
      operationDeclarations: [],
      permissionGrant: request.grant,
      handlers: new Map(),
      async openDataSource<
        Contract extends KnownDataSourceId,
        Major extends DataSourceMajor<Contract>,
      >(contract: Contract, major: Major): Promise<Lease<DataSourceOf<Contract, Major>>> {
        if (contract !== WORLD_SCENE_SOURCE_CONTRACT || major !== 1) {
          throw new ModkitError({
            code: 'x3.host/map-preview-data-source-unavailable',
            message: `map preview does not publish ${contract}@${String(major)}`,
          })
        }
        return borrowCommonWorldScene(analyzed.world.value) as Lease<DataSourceOf<Contract, Major>>
      },
      // createAssetSession releases in reverse order: analysis first, then its ResourceSession.
      release: [() => request.resources.dispose(), () => analyzed.release()],
    })
    return Object.freeze({
      state: 'opened' as const,
      session: managed.session,
      descriptor,
      snapshot: analyzed.snapshot,
      plan: analyzed.plan,
      diagnostics: analyzed.diagnostics,
    })
  } catch (error) {
    await Promise.allSettled([analyzed.release(), request.resources.dispose()])
    throw error
  }
}

export interface CoordinateMapPreviewAssetSessionRequest {
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  /** Ownership stays with the caller unless this function returns `opened`. */
  readonly original: AssetSession
  /** Optional already-selected port, primarily for host composition and conformance tests. */
  readonly preparation?: MapPreviewPreparationPort
  /** Required only when the prepared JSON plan names host-resolved resource roots. */
  readonly resourcePlanResolver?: MapPreviewResourcePlanResolver
  readonly selectionId?: string
  readonly maxCandidates: number
  /** Bounds the JSON-only subject namespace facts sent to preparation providers. */
  readonly maxSubjectEntries: number
  readonly maxSubjectPages: number
  readonly maxRoots: number
  readonly maxDepth: number
  readonly limits: ResolvedMapWorkspaceLimits
  readonly catalog?: DataCatalogSnapshot
  readonly signal?: AbortSignal
}

export interface ResolveMapPreviewResourcePlanRequest {
  readonly plan: Extract<MapPreviewResourcePlan, { readonly strategy: 'host-resolved' }>
  readonly subject: MapPreviewPreparationRequest['subject']
  readonly workspace: ModWorkspaceLock
  /** Host-local capability; this request never crosses the preparation service boundary. */
  readonly original: AssetSession
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type MapPreviewResourcePlanResolution =
  | Readonly<{
      state: 'resolved'
      origin: CompanionOrigin
      revision: RevisionId
      diagnostics: readonly Diagnostic[]
      /** Releases resolver-owned leases after the ResourceSession has been disposed. */
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

/** Trusted host seam that interprets only opaque root locators declared by a preparation provider. */
export interface MapPreviewResourcePlanResolver {
  resolve(request: ResolveMapPreviewResourcePlanRequest): Promise<MapPreviewResourcePlanResolution>
}

export type CoordinatedMapPreviewAssetSessionResult =
  | Readonly<{
      state: 'not-applicable'
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'selection-required'
      candidates: readonly MapPreviewSelectionCandidate[]
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'opened'
      session: AssetSession
      descriptor: AnyDescriptor
      snapshot: ResolvedMapWorkspaceSnapshot
      plan: ResolvedMapWorkspacePlan
      diagnostics: readonly Diagnostic[]
    }>

const PREVIEW_DIAGNOSTIC_SEVERITIES = new Set(['error', 'warning', 'information', 'hint'])
const MAX_PREVIEW_NAMESPACE_SEARCHES = 8
const MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES = 16
const MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS = 512
const MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS = 512
const MAX_PREVIEW_NAMESPACE_FACT_ENTRIES = 20_000
const MAX_PREVIEW_NAMESPACE_FACT_PAGES = 256
const MAX_PREVIEW_NAMESPACE_PATH_CHARS = 4_096
const MAX_PREVIEW_NAMESPACE_CURSOR_CHARS = 4_096

function positiveCoordinatorLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function boundedCoordinatorLimit(value: number, label: string, maximum: number): number {
  const admitted = positiveCoordinatorLimit(value, label)
  if (admitted > maximum) throw new TypeError(`${label} must be no greater than ${maximum}`)
  return admitted
}

function validPreparationDiagnostic(value: unknown): value is MapPreviewPreparationDiagnostic {
  const record = recordOf(value)
  return (
    record !== undefined &&
    Object.keys(record).every(key =>
      ['code', 'severity', 'message', 'path', 'data'].includes(key),
    ) &&
    nonEmptyString(record['code']) &&
    PREVIEW_DIAGNOSTIC_SEVERITIES.has(String(record['severity'])) &&
    nonEmptyString(record['message']) &&
    (!Object.hasOwn(record, 'path') ||
      (Array.isArray(record['path']) &&
        record['path'].every(item => typeof item === 'string' || Number.isSafeInteger(item)))) &&
    (!Object.hasOwn(record, 'data') || jsonSafeValue(record['data']))
  )
}

function validNamespaceSearchQuery(value: unknown): value is NamespaceEntrySearchQuery {
  const query = recordOf(value)
  if (
    query === undefined ||
    !Object.keys(query).every(
      key => key === 'kind' || key === 'basenames' || key === 'caseSensitive',
    ) ||
    query['kind'] !== 'basename-any' ||
    !Array.isArray(query['basenames']) ||
    query['basenames'].length === 0 ||
    query['basenames'].length > MAX_PREVIEW_NAMESPACE_SEARCH_BASENAMES ||
    typeof query['caseSensitive'] !== 'boolean'
  ) {
    return false
  }
  const basenames = query['basenames'] as unknown[]
  const validBasenames = basenames.every(
    item =>
      nonEmptyString(item) &&
      item.length <= MAX_PREVIEW_NAMESPACE_SEARCH_BASENAME_CHARS &&
      !item.includes('/') &&
      !item.includes('\\') &&
      !item.includes('\0') &&
      item !== '.' &&
      item !== '..',
  )
  if (!validBasenames) return false
  const identityBasenames = query['caseSensitive']
    ? (basenames as string[])
    : (basenames as string[]).map(item => item.toLowerCase())
  return new Set(identityBasenames).size === basenames.length
}

function validateNamespaceSearchRequests(
  value: unknown,
): readonly MapPreviewPreparationNamespaceSearchRequest[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PREVIEW_NAMESPACE_SEARCHES ||
    !value.every(item => {
      const search = recordOf(item)
      return (
        search !== undefined &&
        Object.keys(search).every(key => key === 'searchId' || key === 'query') &&
        nonEmptyString(search['searchId']) &&
        search['searchId'].length <= MAX_PREVIEW_NAMESPACE_SEARCH_ID_CHARS &&
        !search['searchId'].includes('\0') &&
        validNamespaceSearchQuery(search['query'])
      )
    }) ||
    new Set(value.map(item => String(recordOf(item)?.['searchId'] ?? ''))).size !== value.length
  ) {
    throw new TypeError('map preview preparation returned invalid namespace searches')
  }
  return value as readonly MapPreviewPreparationNamespaceSearchRequest[]
}

function jsonSafeValue(value: unknown, depth = 0): boolean {
  if (depth > 64) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => jsonSafeValue(item, depth + 1))
  const record = recordOf(value)
  return record !== undefined && Object.values(record).every(item => jsonSafeValue(item, depth + 1))
}

function validHostResourceRoot(value: unknown): value is MapPreviewHostResourceRoot {
  const record = recordOf(value)
  return (
    record !== undefined &&
    Object.keys(record).every(key => key === 'rootId' || key === 'locator') &&
    nonEmptyString(record['rootId']) &&
    Object.hasOwn(record, 'locator') &&
    jsonSafeValue(record['locator'])
  )
}

function validSubjectNamespaceRoot(value: unknown): value is MapPreviewSubjectNamespaceRoot {
  const record = recordOf(value)
  return (
    record !== undefined &&
    Object.keys(record).every(key => key === 'rootId' || key === 'namespacePrefix') &&
    nonEmptyString(record['rootId']) &&
    typeof record['namespacePrefix'] === 'string'
  )
}

function validateResourcePlan(value: unknown, maxRoots: number): MapPreviewResourcePlan {
  const plan = recordOf(value)
  if (plan?.['schemaVersion'] !== 1) {
    throw new TypeError('map preview preparation returned no versioned resource plan')
  }
  if (plan['strategy'] === 'subject-namespace') {
    const roots = plan['roots']
    if (
      !Object.keys(plan).every(
        key => key === 'schemaVersion' || key === 'strategy' || key === 'roots',
      ) ||
      !Array.isArray(roots) ||
      roots.length === 0 ||
      roots.length > maxRoots ||
      !roots.every(validSubjectNamespaceRoot) ||
      new Set(roots.map(item => String(recordOf(item)?.['rootId'] ?? ''))).size !== roots.length
    ) {
      throw new TypeError('map preview preparation returned invalid subject namespace roots')
    }
    return value as MapPreviewResourcePlan
  }
  if (plan['strategy'] === 'host-resolved') {
    const roots = plan['roots']
    const subjectRoots = plan['subjectNamespaceRoots']
    if (
      !Object.keys(plan).every(key =>
        ['schemaVersion', 'strategy', 'resolverId', 'subjectNamespaceRoots', 'roots'].includes(key),
      ) ||
      !nonEmptyString(plan['resolverId']) ||
      !Array.isArray(subjectRoots) ||
      !subjectRoots.every(validSubjectNamespaceRoot) ||
      !Array.isArray(roots) ||
      roots.length === 0 ||
      roots.length + subjectRoots.length > maxRoots ||
      !roots.every(validHostResourceRoot) ||
      new Set([...subjectRoots, ...roots].map(item => String(recordOf(item)?.['rootId'] ?? '')))
        .size !==
        roots.length + subjectRoots.length
    ) {
      throw new TypeError('map preview preparation returned invalid host resource roots')
    }
    return value as MapPreviewResourcePlan
  }
  throw new TypeError('map preview preparation returned an unknown resource strategy')
}

function validatePreparationResult(
  value: unknown,
  maxCandidates: number,
  maxRoots: number,
): MapPreviewPreparationResult {
  const record = recordOf(value)
  if (
    record === undefined ||
    !Array.isArray(record['diagnostics']) ||
    !record['diagnostics'].every(validPreparationDiagnostic)
  ) {
    throw new TypeError('map preview preparation returned malformed diagnostics')
  }
  if (record['state'] === 'not-applicable' || record['state'] === 'unresolved') {
    if (!Object.keys(record).every(key => key === 'state' || key === 'diagnostics')) {
      throw new TypeError('map preview preparation result contains unknown fields')
    }
    return value as MapPreviewPreparationResult
  }
  if (record['state'] === 'selection-required') {
    const candidates = record['candidates']
    if (
      !Object.keys(record).every(
        key => key === 'state' || key === 'candidates' || key === 'diagnostics',
      ) ||
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      candidates.length > maxCandidates ||
      !candidates.every(candidate => {
        const item = recordOf(candidate)
        return (
          item !== undefined &&
          Object.keys(item).every(
            key => key === 'candidateId' || key === 'displayName' || key === 'sourcePath',
          ) &&
          nonEmptyString(item['candidateId']) &&
          nonEmptyString(item['displayName']) &&
          (!Object.hasOwn(item, 'sourcePath') || nonEmptyString(item['sourcePath']))
        )
      }) ||
      new Set(candidates.map(candidate => String(recordOf(candidate)?.['candidateId'] ?? '')))
        .size !== candidates.length
    ) {
      throw new TypeError('map preview preparation returned invalid selection candidates')
    }
    return value as MapPreviewPreparationResult
  }
  if (record['state'] === 'namespace-search-required') {
    if (
      !Object.keys(record).every(
        key => key === 'state' || key === 'searches' || key === 'diagnostics',
      )
    ) {
      throw new TypeError('map preview preparation search result contains unknown fields')
    }
    validateNamespaceSearchRequests(record['searches'])
    return value as MapPreviewPreparationResult
  }
  if (record['state'] === 'prepared') {
    const plan = recordOf(record['plan'])
    if (
      !Object.keys(record).every(
        key => key === 'state' || key === 'plan' || key === 'diagnostics',
      ) ||
      plan?.['schemaVersion'] !== 1 ||
      recordOf(plan['workspace']) === undefined ||
      !jsonSafeValue(plan['workspace']) ||
      !Object.keys(plan).every(
        key => key === 'schemaVersion' || key === 'workspace' || key === 'resources',
      )
    ) {
      throw new TypeError('map preview preparation returned an invalid prepared plan')
    }
    validateResourcePlan(plan['resources'], maxRoots)
    return value as MapPreviewPreparationResult
  }
  throw new TypeError('map preview preparation returned an unknown state')
}

function preparationDiagnostics(items: readonly MapPreviewPreparationDiagnostic[]): Diagnostic[] {
  return items.map(item => ({
    code: errorCode(item.code),
    severity: item.severity,
    message: item.message,
    ...(item.path === undefined ? {} : { path: item.path }),
    ...(item.data === undefined ? {} : { data: item.data }),
  }))
}

function mapPreviewPreparationSubject(
  descriptor: AnyDescriptor,
  namespace: MapPreviewPreparationNamespaceIndex,
  namespaceSearches: readonly MapPreviewPreparationNamespaceSearchIndex[] = Object.freeze([]),
): MapPreviewPreparationRequest['subject'] {
  const formatId = 'identity' in descriptor ? descriptor.identity.formatId : undefined
  if (!nonEmptyString(formatId)) {
    throw new TypeError('the ordinary codec descriptor has no format id')
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    subjectUri: descriptor.subjectUri,
    revision: descriptor.revision,
    formatId,
    traits: Object.freeze(descriptor.traits.map(item => item.id)),
    dataSources: Object.freeze(
      descriptor.dataSources.map(item =>
        Object.freeze({ contract: item.contract, major: item.major }),
      ),
    ),
    operations: Object.freeze(
      descriptor.operations.map(item => Object.freeze({ id: item.id, state: item.state })),
    ),
    namespace,
    namespaceSearches: Object.freeze(namespaceSearches.map(item => Object.freeze(item))),
  })
}

async function boundedPreparationNamespace(
  original: AssetSession,
  descriptor: AnyDescriptor,
  maxEntries: number,
  maxPages: number,
  signal?: AbortSignal,
): Promise<MapPreviewPreparationNamespaceIndex> {
  if (
    !descriptor.dataSources.some(
      item => item.contract === 'common.view/namespace-entry-source' && item.major === 1,
    )
  ) {
    return Object.freeze({ state: 'unavailable', entries: Object.freeze([]) })
  }
  const lease = await original.dataSource('common.view/namespace-entry-source', 1)
  const release = releaseOnce(() => lease.release())
  try {
    const entries: { path: string; kind: 'file' | 'directory'; size?: string }[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    let truncated = false
    do {
      signal?.throwIfAborted()
      if (pages >= maxPages) {
        truncated = true
        break
      }
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new TypeError('subject namespace repeated a paging cursor')
        }
        seenCursors.add(cursor)
      }
      const remaining = maxEntries - entries.length
      if (remaining <= 0) {
        truncated = true
        break
      }
      const page = await (lease.value as NamespaceEntrySource).list(
        '',
        cursor === undefined
          ? { limit: Math.min(remaining, 256) }
          : { cursor, limit: Math.min(remaining, 256) },
        signal,
      )
      pages += 1
      for (const item of page.items.slice(0, remaining)) {
        entries.push({
          path: item.path,
          kind: item.kind,
          ...(item.size === undefined ? {} : { size: item.size.toString(10) }),
        })
      }
      if (page.items.length > remaining) {
        truncated = true
        break
      }
      cursor = page.nextCursor
    } while (cursor !== undefined)
    entries.sort((left, right) =>
      left.path === right.path
        ? left.kind.localeCompare(right.kind)
        : left.path.localeCompare(right.path),
    )
    return Object.freeze({
      state: truncated ? ('truncated' as const) : ('complete' as const),
      entries: Object.freeze(entries.map(item => Object.freeze(item))),
    })
  } finally {
    await release()
  }
}

async function boundedPreparationNamespaceSearches(
  original: AssetSession,
  descriptor: AnyDescriptor,
  searches: readonly MapPreviewPreparationNamespaceSearchRequest[],
  maxEntries: number,
  maxPages: number,
  signal?: AbortSignal,
): Promise<readonly MapPreviewPreparationNamespaceSearchIndex[]> {
  if (
    !descriptor.dataSources.some(
      item => item.contract === 'common.view/namespace-entry-source' && item.major === 1,
    )
  ) {
    return Object.freeze(
      searches.map(search =>
        Object.freeze({
          searchId: search.searchId,
          state: 'unsupported' as const,
          entries: Object.freeze([]),
        }),
      ),
    )
  }
  const lease = await original.dataSource('common.view/namespace-entry-source', 1)
  const release = releaseOnce(() => lease.release())
  try {
    const source = lease.value as NamespaceEntrySource
    const searchNamespace = source.search?.bind(source)
    if (searchNamespace === undefined) {
      return Object.freeze(
        searches.map(search =>
          Object.freeze({
            searchId: search.searchId,
            state: 'unsupported' as const,
            entries: Object.freeze([]),
          }),
        ),
      )
    }

    let remainingEntries = maxEntries
    let remainingPages = maxPages
    const results: MapPreviewPreparationNamespaceSearchIndex[] = []
    for (const search of searches) {
      signal?.throwIfAborted()
      const entries: { path: string; kind: 'file' | 'directory'; size?: string }[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      let truncated = remainingEntries === 0 || remainingPages === 0
      while (!truncated) {
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            throw new TypeError('subject namespace search repeated a paging cursor')
          }
          seenCursors.add(cursor)
        }
        const pageLimit = Math.min(remainingEntries, 256)
        const page = await searchNamespace(
          search.query,
          cursor === undefined ? { limit: pageLimit } : { cursor, limit: pageLimit },
          signal,
        )
        remainingPages -= 1
        if (
          !Array.isArray(page.items) ||
          page.items.length > pageLimit ||
          (page.nextCursor !== undefined &&
            (typeof page.nextCursor !== 'string' ||
              page.nextCursor.length === 0 ||
              page.nextCursor.length > MAX_PREVIEW_NAMESPACE_CURSOR_CHARS))
        ) {
          throw new TypeError('subject namespace search returned a malformed page')
        }
        const admitted = page.items
        for (const item of admitted) {
          if (
            typeof item.path !== 'string' ||
            item.path.length > MAX_PREVIEW_NAMESPACE_PATH_CHARS ||
            (item.kind !== 'file' && item.kind !== 'directory') ||
            (item.size !== undefined && typeof item.size !== 'bigint')
          ) {
            throw new TypeError('subject namespace search returned a malformed entry')
          }
          entries.push({
            path: item.path,
            kind: item.kind,
            ...(item.size === undefined ? {} : { size: item.size.toString(10) }),
          })
        }
        remainingEntries -= admitted.length
        cursor = page.nextCursor
        if (cursor === undefined) break
        if (remainingEntries === 0 || remainingPages === 0) truncated = true
      }
      entries.sort((left, right) =>
        left.path === right.path
          ? left.kind.localeCompare(right.kind)
          : left.path.localeCompare(right.path),
      )
      results.push(
        Object.freeze({
          searchId: search.searchId,
          state: truncated ? ('truncated' as const) : ('complete' as const),
          entries: Object.freeze(entries.map(item => Object.freeze(item))),
        }),
      )
    }
    return Object.freeze(results)
  } finally {
    await release()
  }
}

function workspaceDiagnostics(workspace: ModWorkspaceLock): Diagnostic[] {
  return workspace.diagnostics.map(item =>
    diagnostic(
      item.severity,
      'x3.host/map-preview-workspace-diagnostic',
      `${item.code}: ${item.message}`,
      undefined,
      {
        ...(item.rootId === undefined ? {} : { rootId: item.rootId }),
        ...(item.dependencyRef === undefined ? {} : { dependencyRef: item.dependencyRef }),
        ...(item.cycle === undefined ? {} : { cycle: item.cycle }),
      },
    ),
  )
}

function sessionHoldingMapPreviewPrerequisites(
  preview: AssetSession,
  releasePreparedResources: () => Promise<void>,
  original: AssetSession,
): AssetSession {
  let disposed = false
  return Object.freeze({
    revision: preview.revision,
    state: () => preview.state(),
    descriptor: () => preview.descriptor(),
    dataSource: preview.dataSource.bind(preview) as AssetSession['dataSource'],
    operations: () => preview.operations(),
    events: (signal?: AbortSignal) => preview.events(signal),
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      let firstError: unknown
      for (const release of [
        () => preview.dispose(),
        releasePreparedResources,
        () => original.dispose(),
      ]) {
        try {
          await release()
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstError !== undefined) throw firstError
    },
  })
}

function coordinatorFailure(
  code: string,
  message: string,
): CoordinatedMapPreviewAssetSessionResult {
  return {
    state: 'unresolved',
    diagnostics: [diagnostic('error', errorCode(code), message)],
  }
}

function releaseOnce(release: () => Promise<void>): () => Promise<void> {
  let released = false
  return async () => {
    if (released) return
    released = true
    await release()
  }
}

async function resolveSubjectNamespacePreviewResources(request: {
  readonly plan: Extract<MapPreviewResourcePlan, { readonly strategy: 'subject-namespace' }>
  readonly descriptor: AnyDescriptor
  readonly original: AssetSession
  readonly workspace: ModWorkspaceLock
  readonly activeSourcePath: string
}): Promise<MapPreviewResourcePlanResolution> {
  if (
    !request.descriptor.dataSources.some(
      item => item.contract === 'common.view/namespace-entry-source' && item.major === 1,
    )
  ) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/map-preview-namespace-unavailable',
          'the subject-namespace resource plan requires an ordinary namespace entry source',
        ),
      ],
    }
  }
  const extractOperation = request.descriptor.operations.find(
    item => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === 'available',
  )
  if (extractOperation === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/map-preview-extract-unavailable',
          `the subject-namespace resource plan requires ${CONTAINER_EXTRACT_OPERATION_ID}`,
        ),
      ],
    }
  }

  const namespaceLease = await request.original.dataSource('common.view/namespace-entry-source', 1)
  const release = releaseOnce(() => namespaceLease.release())
  try {
    const operations = request.original.operations()
    const extract = async (entryId: string, signal?: AbortSignal): Promise<Uint8Array> => {
      signal?.throwIfAborted()
      const result = await operations.invoke(
        extractOperation.handlerId,
        { entryId },
        signal === undefined ? {} : { signal },
      )
      if (result.state !== 'ok' || result.output.kind !== 'bytes') {
        throw new ModkitError({
          code: 'x3.host/map-preview-entry-unreadable',
          message: `the source container refused to extract entry ${entryId}`,
          context: {
            entryId,
            state: result.state,
            ...(result.state === 'rejected' ? { reason: result.reason } : {}),
            ...(result.state === 'ok' ? { outputKind: result.output.kind } : {}),
          },
        })
      }
      return result.output.value
    }
    const namespacePrefixes = new Map(
      request.plan.roots.map(root => [root.rootId, root.namespacePrefix] as const),
    )
    const logicalRoots = (
      request.workspace.logicalRoots ?? [...request.workspace.loadOrder].reverse()
    ).map(root =>
      Object.freeze({
        rootId: root.rootId,
        pathPrefix: namespacePrefixes.get(root.rootId) ?? '',
        logicalPrefix: root.sourcePath,
      }),
    )
    return Object.freeze({
      state: 'resolved' as const,
      origin: createWorkspaceNamespaceCompanionOrigin({
        namespace: namespaceLease.value as NamespaceEntrySource,
        primaryLogicalId: request.activeSourcePath,
        logicalRoots,
        containerRevision: request.descriptor.revision,
        extract,
      }),
      revision: request.descriptor.revision,
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'x3.host/map-preview-subject-resources-selected',
          'map preview resources are confined to the opened subject namespace',
        ),
      ]),
      release,
    })
  } catch (error) {
    await release()
    throw error
  }
}

/**
 * Convert an ordinary namespace codec session into a host-owned world preview session.
 *
 * Preparation is JSON-only. The host validates the returned graph, owns every namespace read and
 * ResourceSession, and retains the original session until the derived preview is disposed.
 */
export async function coordinateMapPreviewAssetSession(
  request: CoordinateMapPreviewAssetSessionRequest,
): Promise<CoordinatedMapPreviewAssetSessionResult> {
  const maxCandidates = positiveCoordinatorLimit(request.maxCandidates, 'maxCandidates')
  const maxSubjectEntries = boundedCoordinatorLimit(
    request.maxSubjectEntries,
    'maxSubjectEntries',
    MAX_PREVIEW_NAMESPACE_FACT_ENTRIES,
  )
  const maxSubjectPages = boundedCoordinatorLimit(
    request.maxSubjectPages,
    'maxSubjectPages',
    MAX_PREVIEW_NAMESPACE_FACT_PAGES,
  )
  const maxRoots = positiveCoordinatorLimit(request.maxRoots, 'maxRoots')
  const maxDepth = positiveCoordinatorLimit(request.maxDepth, 'maxDepth')
  request.signal?.throwIfAborted()

  const descriptor = await request.original.descriptor()
  let subject: MapPreviewPreparationRequest['subject']
  try {
    subject = mapPreviewPreparationSubject(
      descriptor,
      Object.freeze({ state: 'unavailable', entries: Object.freeze([]) }),
    )
  } catch (error) {
    return {
      state: 'not-applicable',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/map-preview-subject-not-applicable',
          error instanceof Error ? error.message : String(error),
        ),
      ],
    }
  }

  let preparation = request.preparation
  let preparationRelease: (() => Promise<void>) | undefined
  const resolutionDiagnostics: Diagnostic[] = []
  if (preparation === undefined) {
    const resolution = await resolveMapPreviewPreparation({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      subjectFormatId: subject.formatId,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    resolutionDiagnostics.push(...resolution.diagnostics)
    if (resolution.state === 'unresolved') {
      return { state: 'not-applicable', diagnostics: resolutionDiagnostics }
    }
    preparation = resolution.preparation
    preparationRelease = resolution.release
  } else if (
    preparation.contract !== MAP_PREVIEW_PREPARATION_CONTRACT ||
    !preparation.subjectFormatIds.includes(subject.formatId)
  ) {
    return coordinatorFailure(
      'x3.host/map-preview-preparation-invalid',
      'the supplied map preview preparation port does not accept the subject format',
    )
  }

  let prepared: MapPreviewPreparationResult
  let searchRoundDiagnostics: readonly MapPreviewPreparationDiagnostic[] = Object.freeze([])
  try {
    const namespace = await boundedPreparationNamespace(
      request.original,
      descriptor,
      maxSubjectEntries,
      maxSubjectPages,
      request.signal,
    )
    subject = mapPreviewPreparationSubject(descriptor, namespace)
    prepared = validatePreparationResult(
      await preparation.prepare({
        subject,
        maxCandidates,
        maxRoots,
        maxDepth,
        ...(request.selectionId === undefined ? {} : { selectionId: request.selectionId }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }),
      maxCandidates,
      maxRoots,
    )
    if (prepared.state === 'namespace-search-required') {
      searchRoundDiagnostics = prepared.diagnostics
      const namespaceSearches = await boundedPreparationNamespaceSearches(
        request.original,
        descriptor,
        prepared.searches,
        maxSubjectEntries,
        maxSubjectPages,
        request.signal,
      )
      subject = mapPreviewPreparationSubject(descriptor, namespace, namespaceSearches)
      prepared = validatePreparationResult(
        await preparation.prepare({
          subject,
          maxCandidates,
          maxRoots,
          maxDepth,
          ...(request.selectionId === undefined ? {} : { selectionId: request.selectionId }),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        }),
        maxCandidates,
        maxRoots,
      )
      if (prepared.state === 'namespace-search-required') {
        throw new TypeError(
          'map preview preparation requested more than one namespace search round',
        )
      }
    }
  } catch (error) {
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...resolutionDiagnostics,
        ...preparationDiagnostics(searchRoundDiagnostics),
        diagnostic(
          'error',
          'x3.host/map-preview-preparation-invalid',
          `map preview preparation failed (${error instanceof Error ? error.message : String(error)})`,
        ),
      ]),
    }
  } finally {
    try {
      await preparationRelease?.()
    } catch {
      // Provider teardown cannot change the named preparation outcome or leak caller ownership.
    }
  }

  let providerDiagnostics: Diagnostic[]
  try {
    providerDiagnostics = preparationDiagnostics([
      ...searchRoundDiagnostics,
      ...prepared.diagnostics,
    ])
  } catch (error) {
    return coordinatorFailure(
      'x3.host/map-preview-preparation-invalid',
      `map preview preparation returned an invalid diagnostic (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const preparationFindings = Object.freeze([...resolutionDiagnostics, ...providerDiagnostics])
  if (prepared.state === 'not-applicable') {
    return { state: 'not-applicable', diagnostics: preparationFindings }
  }
  if (prepared.state === 'selection-required') {
    return {
      state: 'selection-required',
      candidates: Object.freeze(prepared.candidates.map(item => Object.freeze({ ...item }))),
      diagnostics: preparationFindings,
    }
  }
  if (prepared.state === 'unresolved') {
    return { state: 'unresolved', diagnostics: preparationFindings }
  }

  const graph = prepared.plan.workspace
  if (graph.roots.length > maxRoots || graph.maxRoots > maxRoots || graph.maxDepth > maxDepth) {
    return coordinatorFailure(
      'x3.host/map-preview-preparation-budget-exceeded',
      'map preview preparation exceeded the host workspace limits',
    )
  }

  let workspace: ModWorkspaceLock
  try {
    workspace = resolveModWorkspaceGraph(graph)
  } catch (error) {
    return coordinatorFailure(
      'x3.host/map-preview-workspace-invalid',
      `map preview preparation returned an invalid workspace graph (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const active = workspace.loadOrder.find(item => item.rootId === workspace.activeRootId)
  if (active === undefined) {
    return coordinatorFailure(
      'x3.host/map-preview-workspace-invalid',
      'map preview workspace does not contain its active root',
    )
  }
  const plannedRootIds = new Set(
    prepared.plan.resources.strategy === 'subject-namespace'
      ? prepared.plan.resources.roots.map(root => root.rootId)
      : [
          ...prepared.plan.resources.subjectNamespaceRoots.map(root => root.rootId),
          ...prepared.plan.resources.roots.map(root => root.rootId),
        ],
  )
  const workspaceRootIds = new Set(workspace.loadOrder.map(root => root.rootId))
  if (
    plannedRootIds.size !== workspaceRootIds.size ||
    [...plannedRootIds].some(rootId => !workspaceRootIds.has(rootId))
  ) {
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          'error',
          'x3.host/map-preview-resource-root-mismatch',
          'the resource plan must map every resolved workspace root exactly once',
        ),
      ]),
    }
  }
  let resourceResolution: MapPreviewResourcePlanResolution
  try {
    if (prepared.plan.resources.strategy === 'subject-namespace') {
      resourceResolution = await resolveSubjectNamespacePreviewResources({
        plan: prepared.plan.resources,
        descriptor,
        original: request.original,
        workspace,
        activeSourcePath: active.sourcePath,
      })
    } else if (request.resourcePlanResolver === undefined) {
      resourceResolution = {
        state: 'unresolved',
        diagnostics: [
          diagnostic(
            'warning',
            'x3.host/map-preview-resource-resolver-required',
            `resource plan ${prepared.plan.resources.resolverId} names installation/dependency roots but this host wired no resolver`,
          ),
        ],
      }
    } else {
      resourceResolution = await request.resourcePlanResolver.resolve({
        plan: prepared.plan.resources,
        subject,
        workspace,
        original: request.original,
        services: request.services,
        grant: request.grant,
        budgets: request.budgets,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    }
  } catch (error) {
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          'error',
          'x3.host/map-preview-resource-resolution-failed',
          `map preview resources could not be resolved (${error instanceof Error ? error.message : String(error)})`,
        ),
      ]),
    }
  }
  if (resourceResolution.state === 'unresolved') {
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
      ]),
    }
  }

  const releasePreparedResources = releaseOnce(resourceResolution.release)
  let resources: ResourceSessionPort | undefined
  try {
    resources = createResourceSession({
      origin: resourceResolution.origin,
      revision: resourceResolution.revision,
    })
    const opened = await openMapPreviewAssetSession({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      subjectUri: descriptor.subjectUri,
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      limits: request.limits,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (opened.state === 'unresolved') {
      await releasePreparedResources()
      return {
        state: 'unresolved',
        diagnostics: Object.freeze([
          ...preparationFindings,
          ...workspaceDiagnostics(workspace),
          ...resourceResolution.diagnostics,
          ...opened.diagnostics,
        ]),
      }
    }
    return Object.freeze({
      ...opened,
      session: sessionHoldingMapPreviewPrerequisites(
        opened.session,
        releasePreparedResources,
        request.original,
      ),
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        ...opened.diagnostics,
      ]),
    })
  } catch (error) {
    if (resources !== undefined && resources.state() !== 'disposed') {
      await resources.dispose()
    }
    await releasePreparedResources()
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        diagnostic(
          'error',
          'x3.host/map-preview-open-failed',
          `map preview could not be opened (${error instanceof Error ? error.message : String(error)})`,
        ),
      ]),
    }
  }
}
