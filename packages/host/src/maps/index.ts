/** Host definition, exact game-id matcher and activation adapter for semantic maps. */

import {
  CONTAINER_EXTRACT_OPERATION_ID,
  ModkitError,
  contractId,
  diagnostic,
  errorCode,
  type Diagnostic,
} from '@modkit/core'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  type CandidateWorldSceneSource,
  type MapPreviewPreparationDocumentReadRequest,
  type MapPreviewPreparationDocumentReadResult,
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
  type WorldSceneModelRequest,
  type WorldScenePageRequest,
  type WorldSceneSource,
  type WorldSceneTextureRequest,
} from '@modkit/sdk/maps'
import { resolveModWorkspaceGraph } from '@modkit/sdk'
import type {
  AnyDescriptor,
  AssetDiagnosticWire,
  AssetSession,
  ContributionSettings,
  DataCatalogSnapshot,
  DataEntityRef,
  DataResolvedEntity,
  DataSourceMajor,
  DataSourceOf,
  DefinitionInventoryResult,
  KnownDataSourceId,
  Lease,
  ModWorkspaceLock,
  NamespaceEntrySource,
  NamespaceEntrySearchQuery,
  PermissionGrant,
  RelationGraphSource,
  ResourceBudget,
  ResourceSessionPort,
  RevisionId,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
  SubjectSelectorSource,
} from '@modkit/sdk'
import { answerCatalogQueries, type CatalogEntities } from '../catalog-questions.js'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import {
  createCompanionInputResolver,
  createLayeredCompanionOrigin,
  type CompanionOrigin,
} from '../input-resolution.js'
import { resolveContentAssetOrigins } from '../content-dependency-operations.js'
import type { ContentSources } from '@modkit/vfs/content-sources'
import type { Inventory } from '../inventory.js'
import { createWorkspaceNamespaceCompanionOrigin } from '../namespace-origin.js'
import { createResourceSession } from '../resource-session.js'
import { createHostServiceResolver } from '../service-leases.js'
import { assembleSubjectDescriptor, createAssetSession } from '../session.js'
import { createSubjectModelResources, type ModelResourceProfile } from '../model-resources.js'
import { openSubject, type SubjectInputResolver } from '../subject-open.js'
import {
  createSubjectRasterResources,
  type SubjectRasterResourceState,
} from '../raster-resources.js'
import {
  analyzeResolvedDataWorkspace,
  createResolvedDataSubjectSelectorLease,
  type ResolvedDataWorkspaceLimits,
} from '../data/index.js'
import { singleFileAsContainer } from './single-file-namespace.js'
import { createCandidateWorldSceneLease } from './world-source.js'

export { createCandidateWorldSceneLease } from './world-source.js'

/** Owner id under which the standard semantic-map definition is registered. */
export const STANDARD_MAPS_OWNER = 'modkit/maps'

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
      $ref: 'https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json',
    }),
  }),
  requestFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json',
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
        $ref: 'https://schemas.modkit.org/x3/map-semantic-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/map-semantic-request.v1.schema.json',
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
        $ref: 'https://schemas.modkit.org/x3/map-preview-preparation-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/map-preview-preparation-request.v1.schema.json',
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
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
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

/** Rounds of catalog questions one map analysis may ask: objects, then actors, then models. */
const MAP_CATALOG_ROUNDS = 6

/**
 * Analyze a map with only the catalog entities it names. The map names what it places; each answer
 * can name more (an actor's model), so it is asked again until nothing new is named or the rounds
 * run out. Only the entities asked for ever reach the map provider.
 */
export async function analyzeWithCatalogEntities<
  Snapshot extends { readonly semantic: { readonly catalogQueries: readonly DataEntityRef[] } },
>(options: {
  readonly workspace: Pick<ModWorkspaceLock, 'workspaceId' | 'gameId'>
  readonly analyze: (catalog: DataCatalogSnapshot | undefined, round: number) => Promise<Snapshot>
  readonly catalogEntities: CatalogEntities
  readonly signal?: AbortSignal
}): Promise<Snapshot> {
  return answerCatalogQueries({
    run: (answered, round) =>
      options.analyze(
        answered === undefined
          ? undefined
          : Object.freeze({
              schemaVersion: 1,
              workspaceId: options.workspace.workspaceId,
              gameId: options.workspace.gameId,
              analyzerId: 'x3.host/map-catalog-slice',
              typeIds: Object.freeze([]),
              namespaces: Object.freeze([]),
              entityCount: answered.length,
              patchCount: 0,
              definitions: answered,
              entities: answered,
              diagnostics: Object.freeze([]),
              complete: false,
            }),
        round,
      ),
    queriesOf: snapshot => snapshot.semantic.catalogQueries,
    catalogEntities: options.catalogEntities,
    rounds: MAP_CATALOG_ROUNDS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

export interface AnalyzeResolvedMapWorkspaceRequest {
  readonly services: MapHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly workspace: ModWorkspaceLock
  readonly resources: ResourceSessionPort
  /** Resolves bundle companions (for example M3A) from the same dependency overlay. */
  readonly inputResolver?: SubjectInputResolver
  readonly catalog?: DataCatalogSnapshot
  /** Asked for what the map references when no `catalog` is given (see {@link CatalogEntities}). */
  readonly catalogEntities?: CatalogEntities
  /** Operation ids the opened map subject declares; the publisher names its edit route among them. */
  readonly subjectOperationIds?: readonly string[]
  readonly limits: ResolvedMapWorkspaceLimits
  /** Host-only acquisition measurements; never forwarded to a game provider or worker. */
  readonly onModelResourceProfile?: (profile: ModelResourceProfile) => void
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
    const segments = path.split('/')
    const mapRootScoped = requirement.scope === undefined || requirement.scope === 'map-root'
    if (
      !nonEmptyString(requirement.requirementId) ||
      !nonEmptyString(requirement.kind) ||
      typeof requirement.required !== 'boolean' ||
      (requirement.scope !== undefined &&
        requirement.scope !== 'map-root' &&
        requirement.scope !== 'workspace') ||
      path !== requirement.path ||
      path.startsWith('/') ||
      /^[A-Za-z]:/u.test(path) ||
      segments.some((segment: string) => segment === '' || segment === '.' || segment === '..') ||
      (mapRootScoped && (!path.startsWith(prefix) || path.slice(prefix.length).includes('/'))) ||
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
    try {
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
    } catch (error) {
      // opened but unreadable (its data in an absent companion): unresolved, like an absent document
      signal?.throwIfAborted()
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          'x3.host/resolved-map-document-read-failed',
          `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`,
        ),
        consumedBytes: byteLength,
      }
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
    const analyze = (catalog: DataCatalogSnapshot | undefined, round: number) =>
      resolution.workspace.analyze({
      workspaceId: request.workspace.workspaceId,
      gameId: request.workspace.gameId,
      mapId: plan.mapId,
      documents,
      ...(catalog === undefined ? {} : { catalog }),
      ...(request.subjectOperationIds === undefined
        ? {}
        : { subjectOperationIds: request.subjectOperationIds }),
      maxDocuments: limits.maxRequirements,
      maxDocumentBytes: limits.maxDocumentBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxObjects: limits.maxObjects,
      maxRegions: limits.maxRegions,
      maxTerrainCells: limits.maxTerrainCells,
      maxTerrainSamples: limits.maxTerrainSamples,
      maxDepth: limits.maxDepth,
      maxDiagnostics: limits.maxDiagnostics,
      snapshotId: round === 0 ? snapshotId : `${snapshotId}|catalog-round=${round}`,
      unresolvedRequirementIds,
      requiredRequirementIds: plan.requirements
        .filter(item => item.required)
        .map(item => item.requirementId),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const snapshot =
      request.catalog === undefined && request.catalogEntities !== undefined
        ? await analyzeWithCatalogEntities({
            workspace: request.workspace,
            analyze,
            catalogEntities: request.catalogEntities,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          })
        : await analyze(request.catalog, 0)
    if (request.resources.state() !== 'live') {
      throw new Error('resource session was disposed while workspace map was analyzed')
    }
    const modelState: SubjectRasterResourceState = {
      live: true,
      reservedBytes: 0,
      resources: request.resources,
    }
    const modelReleases: Array<() => Promise<void>> = []
    const modelResources = createSubjectModelResources({
      state: modelState,
      budget: request.budgets,
      isAuthorized: () => modelState.live && request.grant.classes.includes('read-source'),
      ancestors: [`map:${request.workspace.workspaceId}@${request.resources.revision}`],
      own: release => modelReleases.push(release),
      ...(request.onModelResourceProfile === undefined
        ? {}
        : { onProfile: request.onModelResourceProfile }),
      open: (source, path, signal) =>
        openSubject({
          inventory: request.services.inventory,
          source,
          path,
          target: request.services.target,
          intent: 'full',
          grant: { ...request.grant, classes: ['read-source'] },
          budget: request.budgets,
          executionBackends: request.services.executionBackends,
          ...(request.services.serviceDefinitions === undefined
            ? {}
            : { serviceDefinitions: request.services.serviceDefinitions }),
          ...(request.services.contributionSettings === undefined
            ? {}
            : { contributionSettings: request.services.contributionSettings }),
          resourceSession: request.resources,
          ...(request.inputResolver === undefined ? {} : { resolveInput: request.inputResolver }),
          ...(signal === undefined ? {} : { signal }),
        }),
    })
    const releaseModelResources = async () => {
      if (!modelState.live) return
      modelState.live = false
      const outcomes = await Promise.allSettled(modelReleases.map(release => release()))
      const failure = outcomes.find(outcome => outcome.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }
    const rasterResources = createSubjectRasterResources({
      state: modelState,
      budget: request.budgets,
      isAuthorized: () => modelState.live && request.grant.classes.includes('read-source'),
      open: (source, hint, signal) =>
        openSubject({
          inventory: request.services.inventory,
          source,
          path: hint.path ?? '',
          target: request.services.target,
          intent: 'full',
          grant: { ...request.grant, classes: ['read-source'] },
          budget: request.budgets,
          executionBackends: request.services.executionBackends,
          ...(request.services.serviceDefinitions === undefined
            ? {}
            : { serviceDefinitions: request.services.serviceDefinitions }),
          ...(request.services.contributionSettings === undefined
            ? {}
            : { contributionSettings: request.services.contributionSettings }),
          resourceSession: request.resources,
          ...(request.inputResolver === undefined ? {} : { resolveInput: request.inputResolver }),
          ...(signal === undefined ? {} : { signal }),
        }),
    })
    const world = createCandidateWorldSceneLease(
      snapshot,
      request.resources.provenance().slice(provenanceOffset),
      limits.maxPageSize,
      modelResources,
      releaseModelResources,
      rasterResources,
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
  /** Optional catalog sources resolved over the same workspace/resource revision. */
  readonly catalogSources?: MapPreviewCatalogSources
}

export interface MapPreviewCatalogSources {
  readonly selector?: SubjectSelectorSource
  readonly relations: RelationGraphSource
  release(): Promise<void>
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
    ...(candidate.model === undefined
      ? {}
      : {
          async model(resourceId: string, request: WorldSceneModelRequest, signal?: AbortSignal) {
            assertLive(signal)
            const result = await candidate.model!(resourceId, request, signal)
            assertLive(signal)
            return result
          },
        }),
    ...(candidate.texture === undefined
      ? {}
      : {
          async texture(
            resourceId: string,
            request: WorldSceneTextureRequest,
            signal?: AbortSignal,
          ) {
            assertLive(signal)
            const result = await candidate.texture!(resourceId, request, signal)
            assertLive(signal)
            return result
          },
        }),
  })
  return Object.freeze({
    value: source,
    release() {
      live = false
      return Promise.resolve()
    },
  })
}

/** A consumer-scoped view over an analysis-owned callable data source. */
function borrowDataSource<Value extends object>(source: Value): Lease<Value> {
  let live = true
  // The publisher may freeze its source. Proxying that frozen object directly and returning a
  // wrapped method violates the ECMAScript invariant for non-configurable data properties, so the
  // consumer view uses an empty capability target and delegates reads to the owner.
  const target = Object.create(null) as object
  const value = new Proxy(target, {
    get(_target, property) {
      const member = Reflect.get(source, property, source) as unknown
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        if (!live) throw new TypeError('map preview data-source lease has been released')
        return Reflect.apply(member, source, args)
      }
    },
  }) as Value
  return Object.freeze({
    value,
    release(): Promise<void> {
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
    await Promise.allSettled([request.resources.dispose(), request.catalogSources?.release()])
    throw error
  }
  if (analyzed.state === 'unresolved') {
    await Promise.allSettled([request.resources.dispose(), request.catalogSources?.release()])
    return analyzed
  }

  try {
    const catalogSources = request.catalogSources
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
      dataSources: [
        { contract: WORLD_SCENE_SOURCE_CONTRACT, major: 1 },
        ...(catalogSources === undefined
          ? []
          : [{ contract: contractId('common.view/relation-graph-source'), major: 1 as const }]),
        ...(catalogSources?.selector === undefined
          ? []
          : [{ contract: contractId('common.view/subject-selector-source'), major: 1 as const }]),
      ],
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
        if (major === 1) {
          if (contract === WORLD_SCENE_SOURCE_CONTRACT) {
            return borrowCommonWorldScene(analyzed.world.value) as Lease<
              DataSourceOf<Contract, Major>
            >
          }
          if (contract === 'common.view/relation-graph-source' && catalogSources !== undefined) {
            return borrowDataSource(catalogSources.relations) as Lease<
              DataSourceOf<Contract, Major>
            >
          }
          if (
            contract === 'common.view/subject-selector-source' &&
            catalogSources?.selector !== undefined
          ) {
            return borrowDataSource(catalogSources.selector) as Lease<DataSourceOf<Contract, Major>>
          }
        }
        throw new ModkitError({
          code: 'x3.host/map-preview-data-source-unavailable',
          message: `map preview does not publish ${contract}@${String(major)}`,
        })
      },
      // createAssetSession releases in reverse order: analysis first, then its ResourceSession.
      release: [
        () => request.resources.dispose(),
        ...(catalogSources === undefined ? [] : [() => catalogSources.release()]),
        () => analyzed.release(),
      ],
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
    await Promise.allSettled([
      analyzed.release(),
      request.catalogSources?.release(),
      request.resources.dispose(),
    ])
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
  /**
   * Optional additive catalog pass over the same resolved workspace and ResourceSession.
   * Explicit `catalog` input takes precedence, preserving the existing caller-owned path.
   */
  readonly catalogEnrichment?: Readonly<{
    readonly locales: readonly string[]
    readonly limits: ResolvedDataWorkspaceLimits
  }>
  readonly catalog?: DataCatalogSnapshot
  /** Optional host-local observer for the lazy model resources of the resulting world. */
  readonly onModelResourceProfile?: (profile: ModelResourceProfile) => void
  /**
   * The window's content sources. With them the world's models also reach the subject's mod
   * dependency layers (downloaded Roblox assets, a game's shipped textures) behind the map's own
   * resources, as an ordinary open of the same file does.
   */
  readonly contentSources?: ContentSources
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
      /** Where the resolver found the map's merged catalog: the map asks it for what it places. */
      catalogEntities?: CatalogEntities
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
      /**
       * The catalog the map was analysed with (the caller's, or the one enrichment resolved over
       * the map's workspace and dependencies), for consumers that render from catalog data too.
       */
      catalog?: DataCatalogSnapshot
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
const MAX_PREVIEW_DOCUMENT_READS = 8
const MAX_PREVIEW_DOCUMENT_READ_BYTES = 1_048_576
const MAX_PREVIEW_DOCUMENT_TOTAL_BYTES = 4_194_304
const MAX_PREVIEW_DOCUMENT_ROUNDS = 8

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

function validateDocumentReadRequests(
  value: unknown,
): readonly MapPreviewPreparationDocumentReadRequest[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PREVIEW_DOCUMENT_READS) {
    throw new TypeError('map preview preparation returned invalid document reads')
  }
  let totalBytes = 0
  const identities = new Set<string>()
  for (const [index, item] of value.entries()) {
    const document = recordOf(item)
    if (
      document === undefined ||
      !Object.keys(document).every(
        key => key === 'documentId' || key === 'path' || key === 'maxBytes',
      ) ||
      !nonEmptyString(document['documentId']) ||
      document['documentId'].length > 256 ||
      document['documentId'].includes('\0') ||
      !nonEmptyString(document['path']) ||
      document['path'].length > MAX_PREVIEW_NAMESPACE_PATH_CHARS ||
      document['path'].includes('\0') ||
      document['path'].startsWith('/') ||
      /^[a-z]:/iu.test(document['path']) ||
      document['path']
        .replace(/\\/gu, '/')
        .split('/')
        .some(part => part === '..') ||
      !Number.isSafeInteger(document['maxBytes']) ||
      Number(document['maxBytes']) <= 0 ||
      Number(document['maxBytes']) > MAX_PREVIEW_DOCUMENT_READ_BYTES
    ) {
      throw new TypeError(`map preview document read ${index} is malformed`)
    }
    if (identities.has(document['documentId'])) {
      throw new TypeError('map preview document reads contain duplicate document ids')
    }
    identities.add(document['documentId'])
    totalBytes += Number(document['maxBytes'])
  }
  if (totalBytes > MAX_PREVIEW_DOCUMENT_TOTAL_BYTES) {
    throw new TypeError('map preview document reads exceed the total byte budget')
  }
  return value as readonly MapPreviewPreparationDocumentReadRequest[]
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
  if (record['state'] === 'document-read-required') {
    if (
      !Object.keys(record).every(
        key => key === 'state' || key === 'documents' || key === 'diagnostics',
      )
    ) {
      throw new TypeError('map preview preparation document-read result contains unknown fields')
    }
    validateDocumentReadRequests(record['documents'])
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
  documentReads: readonly MapPreviewPreparationDocumentReadResult[] = Object.freeze([]),
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
    documentReads: Object.freeze(documentReads.map(item => Object.freeze(item))),
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

async function boundedPreparationDocumentReads(
  original: AssetSession,
  descriptor: AnyDescriptor,
  requests: readonly MapPreviewPreparationDocumentReadRequest[],
  signal?: AbortSignal,
): Promise<readonly MapPreviewPreparationDocumentReadResult[]> {
  const extraction = descriptor.operations.find(
    item => item.id === CONTAINER_EXTRACT_OPERATION_ID && item.state === 'available',
  )
  if (
    extraction === undefined ||
    !descriptor.dataSources.some(
      item => item.contract === 'common.view/namespace-entry-source' && item.major === 1,
    )
  ) {
    return Object.freeze(
      requests.map(request =>
        Object.freeze({
          documentId: request.documentId,
          path: request.path,
          state: 'unsupported' as const,
        }),
      ),
    )
  }

  const lease = await original.dataSource('common.view/namespace-entry-source', 1)
  const release = releaseOnce(() => lease.release())
  try {
    const source = lease.value as NamespaceEntrySource
    const decoder = new TextDecoder('utf-8', { fatal: false })
    const results: MapPreviewPreparationDocumentReadResult[] = []
    for (const request of requests) {
      signal?.throwIfAborted()
      let page
      try {
        page = await source.list(request.path, { limit: 16 }, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: 'unreadable' as const,
          }),
        )
        continue
      }
      const normalizedPath = request.path.replace(/\\/gu, '/')
      const entry = page.items.find(
        item => item.kind === 'file' && item.path.replace(/\\/gu, '/') === normalizedPath,
      )
      if (entry === undefined) {
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: 'missing' as const,
          }),
        )
        continue
      }
      if (entry.size !== undefined && entry.size > BigInt(request.maxBytes)) {
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: 'too-large' as const,
          }),
        )
        continue
      }
      try {
        const invoked = await original
          .operations()
          .invoke(
            extraction.handlerId,
            { entryId: entry.id },
            signal === undefined ? {} : { signal },
          )
        if (
          invoked.state !== 'ok' ||
          invoked.output.kind !== 'bytes' ||
          invoked.output.value.byteLength > request.maxBytes
        ) {
          results.push(
            Object.freeze({
              documentId: request.documentId,
              path: request.path,
              state:
                invoked.state === 'ok' &&
                invoked.output.kind === 'bytes' &&
                invoked.output.value.byteLength > request.maxBytes
                  ? ('too-large' as const)
                  : ('unreadable' as const),
            }),
          )
          continue
        }
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: 'read' as const,
            text: decoder.decode(invoked.output.value),
          }),
        )
      } catch (error) {
        if (signal?.aborted) throw error
        results.push(
          Object.freeze({
            documentId: request.documentId,
            path: request.path,
            state: 'unreadable' as const,
          }),
        )
      }
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

type MapPreviewCatalogEnrichment = Readonly<{
  catalog?: DataCatalogSnapshot
  sources?: MapPreviewCatalogSources
  diagnostics: readonly Diagnostic[]
}>

/**
 * Resolve a catalog snapshot through the same live workspace resource session used by the map.
 * Facet/provider leases end before map analysis; the immutable snapshot is the only value retained.
 */
async function enrichMapPreviewCatalog(
  request: CoordinateMapPreviewAssetSessionRequest,
  workspace: ModWorkspaceLock,
  resources: ResourceSessionPort,
): Promise<MapPreviewCatalogEnrichment> {
  if (request.catalog !== undefined || request.catalogEnrichment === undefined) {
    return Object.freeze({
      ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
      diagnostics: Object.freeze([]),
    })
  }

  let analyzed
  try {
    analyzed = await analyzeResolvedDataWorkspace({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      locales: request.catalogEnrichment.locales,
      queries: Object.freeze([]),
      limits: request.catalogEnrichment.limits,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    if (request.signal?.aborted) throw error
    return Object.freeze({
      diagnostics: boundedDiagnostics(
        [
          diagnostic(
            'warning',
            'x3.host/map-preview-catalog-enrichment-failed',
            `map preview catalog enrichment failed (${error instanceof Error ? error.message : String(error)})`,
          ),
        ],
        request.limits.maxDiagnostics,
      ),
    })
  }
  if (analyzed.state === 'unresolved') {
    return Object.freeze({
      diagnostics: boundedDiagnostics(analyzed.diagnostics, request.limits.maxDiagnostics),
    })
  }

  const selector = createResolvedDataSubjectSelectorLease(analyzed, {
    maxPageSize: request.catalogEnrichment.limits.maxPageSize,
    maxEntities: request.catalogEnrichment.limits.maxEntities,
    maxRelations: request.catalogEnrichment.limits.maxEntities,
    // The selector request crosses a game-provider boundary. Keep the shared Product-GA ceiling
    // within the strictest bundled semantic provider instead of making every opened card fail.
    maxCalculations: Math.min(request.catalogEnrichment.limits.maxEntities, 256),
  })
  let released = false
  return Object.freeze({
    catalog: analyzed.snapshot,
    sources: Object.freeze({
      ...(selector === undefined ? {} : { selector: selector.value }),
      relations: analyzed.facets.relations.value,
      async release(): Promise<void> {
        if (released) return
        released = true
        const results = await Promise.allSettled([
          ...(selector === undefined ? [] : [selector.release()]),
          analyzed.release(),
        ])
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      },
    }),
    diagnostics: boundedDiagnostics(analyzed.diagnostics, request.limits.maxDiagnostics),
  })
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
  // a map of one file answers as a container of that file, on this route only
  request = {
    ...request,
    original: await singleFileAsContainer(request.original, request.budgets.maxInputBytes),
  }

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
  const documentRoundDiagnostics: MapPreviewPreparationDiagnostic[] = []
  try {
    const namespace = await boundedPreparationNamespace(
      request.original,
      descriptor,
      maxSubjectEntries,
      maxSubjectPages,
      request.signal,
    )
    let namespaceSearches: readonly MapPreviewPreparationNamespaceSearchIndex[] = Object.freeze([])
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
      namespaceSearches = await boundedPreparationNamespaceSearches(
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
    const accumulatedDocumentReads = new Map<string, MapPreviewPreparationDocumentReadResult>()
    let documentRounds = 0
    while (prepared.state === 'document-read-required') {
      if (documentRounds >= MAX_PREVIEW_DOCUMENT_ROUNDS) {
        throw new TypeError(
          `map preview preparation exceeded ${MAX_PREVIEW_DOCUMENT_ROUNDS} document-read rounds`,
        )
      }
      documentRounds += 1
      documentRoundDiagnostics.push(...prepared.diagnostics)
      const documents = validateDocumentReadRequests(prepared.documents)
      const documentReads = await boundedPreparationDocumentReads(
        request.original,
        descriptor,
        documents,
        request.signal,
      )
      for (const document of documentReads) {
        accumulatedDocumentReads.set(document.documentId, document)
      }
      subject = mapPreviewPreparationSubject(
        descriptor,
        namespace,
        namespaceSearches,
        Object.freeze([...accumulatedDocumentReads.values()]),
      )
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
        throw new TypeError('map preview preparation requested a namespace search after documents')
      }
    }
  } catch (error) {
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...resolutionDiagnostics,
        ...preparationDiagnostics(searchRoundDiagnostics),
        ...preparationDiagnostics(documentRoundDiagnostics),
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
      ...documentRoundDiagnostics,
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
    // Name the roots on each side: a plan root the workspace graph does not reach is a broken
    // dependency edge in the preparation, a workspace root without a plan entry has no resources.
    const unreached = [...plannedRootIds].filter(rootId => !workspaceRootIds.has(rootId))
    const unplanned = [...workspaceRootIds].filter(rootId => !plannedRootIds.has(rootId))
    const named = (rootIds: readonly string[]) =>
      rootIds.map(rootId => {
        const root = prepared.plan.workspace.roots.find(item => item.rootId === rootId)
        return root === undefined ? rootId : `${rootId} (${root.sourcePath})`
      })
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        diagnostic(
          'error',
          'x3.host/map-preview-resource-root-mismatch',
          `the resource plan must map every resolved workspace root exactly once${unreached.length === 0 ? '' : `; not reached from the map: ${named(unreached).join(', ')}`}${unplanned.length === 0 ? '' : `; without resources: ${named(unplanned).join(', ')}`}`,
          undefined,
          { unreached, unplanned },
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
    // The subject's dependency layers answer `workspace-dependency-layer` behind the map's own
    // resources (one overlay per subject, strongest layer first), as an ordinary open does.
    const dependencies =
      request.contentSources === undefined
        ? undefined
        : await resolveContentAssetOrigins({
            contentSources: request.contentSources,
            subjects: [{ descriptor }],
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          })
    const origin =
      dependencies === undefined || dependencies.origins.length === 0
        ? resourceResolution.origin
        : createLayeredCompanionOrigin([resourceResolution.origin, ...dependencies.origins])
    resources = createResourceSession({
      origin,
      revision: resourceResolution.revision,
    })
    const inputResolver = createCompanionInputResolver(origin)
    // A resolver that holds the merged catalog answers what the map places; the whole-catalog
    // enrichment is only for a resolver that does not.
    const catalogEntities =
      request.catalog === undefined ? resourceResolution.catalogEntities : undefined
    const enrichment =
      catalogEntities === undefined
        ? await enrichMapPreviewCatalog(request, workspace, resources)
        : (Object.freeze({ diagnostics: Object.freeze([]) }) as MapPreviewCatalogEnrichment)
    const opened = await openMapPreviewAssetSession({
      services: request.services,
      grant: request.grant,
      budgets: request.budgets,
      workspace,
      resources,
      inputResolver,
      subjectUri: descriptor.subjectUri,
      subjectOperationIds: Object.freeze(descriptor.operations.map(operation => operation.id)),
      ...(request.onModelResourceProfile === undefined
        ? {}
        : { onModelResourceProfile: request.onModelResourceProfile }),
      ...(enrichment.catalog === undefined ? {} : { catalog: enrichment.catalog }),
      ...(catalogEntities === undefined ? {} : { catalogEntities }),
      ...(enrichment.sources === undefined ? {} : { catalogSources: enrichment.sources }),
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
          ...enrichment.diagnostics,
          ...opened.diagnostics,
        ]),
      }
    }
    return Object.freeze({
      ...opened,
      ...(enrichment.catalog === undefined ? {} : { catalog: enrichment.catalog }),
      session: sessionHoldingMapPreviewPrerequisites(
        opened.session,
        releasePreparedResources,
        request.original,
      ),
      diagnostics: Object.freeze([
        ...preparationFindings,
        ...workspaceDiagnostics(workspace),
        ...resourceResolution.diagnostics,
        ...enrichment.diagnostics,
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
