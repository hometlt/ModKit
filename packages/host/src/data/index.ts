/**
 * Format-neutral semantic Data owner: exact game-id service activation, bounded workspace plans,
 * revision-pinned ResourceSession inputs, live Data facets, typed prepare/validation and edit guards.
 * SDK catalogs and resolved-workspace providers supply game schemas/values; Host confines ordered
 * reads and separate active-root creation destinations using declared source case policies.
 * Writers/history and resource leases retain their existing owners, budgets and cancellation.
 * Prospective destinations grant no permission and consume no read slots; provider fallback remains
 * available without ModContext. Host contains no publisher-specific catalog names or resolver.
 */

import {
  canonicalJsonStringify,
  contractId,
  diagnostic,
  ModkitError,
  type Diagnostic,
} from '@modkit/core'
import {
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  type DataCatalogAnalysis,
  type DataCatalogDocument,
  type DataCatalogOfferFacet,
  type DataCatalogRequestFacet,
  type DataEditPlanRequest,
  type DataEditPlanProposal,
  type DataEditPlanResult,
  type DataEditDocumentRef,
  type DataGraphIsolationAnalysis,
  type DataGraphIsolationPlanProposal,
  type DataGraphIsolationReplacement,
  type DataGraphIsolationPlanRequest,
  type DataGraphIsolationPlanResult,
  type DataGraphIsolationRequest,
  type DataEditTargetRequest,
  type DataEditTargetResult,
  type DataEntityRef,
  type DataResolvedEntity,
  type DataSubjectFactsOpenRequest,
  type DataSubjectCalculationsOpenRequest,
  type DataLocalizationDocument,
  type DataWorkspaceDocumentRequirement,
  type DataWorkspaceListing,
  type DataWorkspacePlan,
  type DataWorkspacePlanRequest,
  type ResolvedDataWorkspace,
  type ResolvedDataWorkspaceSnapshot,
} from '@modkit/sdk/data'
import type {
  DefinitionInventoryResult,
  AssetRevision,
  AssetSourceRef,
  ChangeSet,
  Lease,
  JsonValue,
  ModWorkspaceLock,
  Page,
  PageRequest,
  PermissionGrant,
  RelationGraphSource,
  SelectableSubject,
  SubjectSelectorQuery,
  SubjectCalculationsSource,
  ResourceBudget,
  ResourceSessionPort,
  RevisionId,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
  SubjectFactsSource,
  SubjectEditTarget,
  SubjectEditTargetRequest,
  SubjectEditTargetResult,
  SubjectIsolationRequest,
  SubjectIsolationResult,
  SubjectIsolationPlanRequest,
  SubjectIsolationPlanResult,
  SubjectSelectorSource,
  TableDataSource,
  TreeDataSource,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { normalizeCompanionLogicalId } from '../input-resolution.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard catalog-analysis definition is registered. */
// Kept distinct from the bundled `modkit/data` extension coordinate. Definition inventory is
// owner-replaced atomically, so sharing that owner would let the extension's CSV/XML definitions
// erase the platform Data contracts registered immediately before them.
export const STANDARD_DATA_OWNER = 'modkit/platform-data'

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

/** Same exact game-id semantics under an additive workspace-aware coordinate. */
export const RESOLVED_DATA_WORKSPACE_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE),
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
      $ref: 'https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json',
    }),
  }),
  requestFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json',
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

/** Additive workspace/VFS/live-facet service; legacy catalog-analysis@1 is unchanged. */
export const RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/data-catalog-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/data-catalog-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.data/resolved-workspace-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'providerId', 'gameIds']),
      methods: Object.freeze({
        plan: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 1_048_576 }),
        }),
        analyze: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 16_777_216, maxStringLength: 4_194_304 }),
        }),
        openSchemaTree: Object.freeze({
          kind: 'lease',
          wrapper: 'lease',
          result: Object.freeze({ contract: 'common.view/tree-data-source', major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        openDefinitionTable: Object.freeze({
          kind: 'lease',
          wrapper: 'lease',
          result: Object.freeze({ contract: 'common.view/table-data-source', major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        openLocalizationTable: Object.freeze({
          kind: 'lease',
          wrapper: 'lease',
          result: Object.freeze({ contract: 'common.view/table-data-source', major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        openRelations: Object.freeze({
          kind: 'lease',
          wrapper: 'lease',
          result: Object.freeze({ contract: 'common.view/relation-graph-source', major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        openSubjectFacts: Object.freeze({
          kind: 'lease',
          optional: true,
          wrapper: 'lease',
          result: Object.freeze({ contract: 'common.view/subject-facts-source', major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        openSubjectCalculations: Object.freeze({
          kind: 'lease',
          optional: true,
          wrapper: 'lease',
          result: Object.freeze({
            contract: 'common.view/subject-calculations-source',
            major: 1,
          }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        // Editing preview is optional and value-shaped: bytes are planned, never written here.
        resolveEditTarget: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 4_194_304 }),
        }),
        // Editing preview is optional and value-shaped: bytes are planned, never written here.
        planEdit: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 16_777_216, maxStringLength: 16_777_216 }),
        }),
        // Editing preview is optional and value-shaped: bytes are planned, never written here.
        analyzeIsolation: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 4_194_304, maxStringLength: 4_194_304 }),
        }),
        // Editing preview is optional and value-shaped: bytes are planned, never written here.
        planIsolation: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
          limits: Object.freeze({ maxBytes: 16_777_216, maxStringLength: 16_777_216 }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardDataDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const registered = [DATA_CATALOG_CONTRACT_DEFINITION, RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION]
  return definitions.replaceOwnerInventory(
    STANDARD_DATA_OWNER,
    registered.map(definition => ({
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
    })),
  )
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

export type ResolvedDataWorkspaceResolution =
  | Readonly<{
      state: 'resolved'
      workspace: ResolvedDataWorkspace
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isResolvedDataWorkspace(value: unknown): value is ResolvedDataWorkspace {
  const record = recordOf(value)
  return (
    record?.['contract'] === RESOLVED_DATA_WORKSPACE_CONTRACT &&
    nonEmptyString(record['providerId']) &&
    stringList(record['gameIds']) !== undefined &&
    typeof record['plan'] === 'function' &&
    typeof record['analyze'] === 'function' &&
    typeof record['openSchemaTree'] === 'function' &&
    typeof record['openDefinitionTable'] === 'function' &&
    typeof record['openLocalizationTable'] === 'function' &&
    typeof record['openRelations'] === 'function' &&
    (record['resolveEditTarget'] === undefined ||
      typeof record['resolveEditTarget'] === 'function') &&
    (record['planEdit'] === undefined || typeof record['planEdit'] === 'function') &&
    (record['analyzeIsolation'] === undefined || typeof record['analyzeIsolation'] === 'function') &&
    (record['planIsolation'] === undefined || typeof record['planIsolation'] === 'function')
  )
}

/** Resolve the additive workspace/VFS/live-definition provider for one named game. */
export async function resolveResolvedDataWorkspace(
  request: ResolveDataCatalogRequest,
): Promise<ResolvedDataWorkspaceResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/resolved-data-workspace-unavailable',
          'this host registered no service-contract definitions, so workspace data cannot resolve',
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
      contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
      major: 1,
      facet: { gameId: request.gameId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isResolvedDataWorkspace(lease.value) || !lease.value.gameIds.includes(request.gameId)) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/resolved-data-workspace-invalid',
            `the selected provider does not implement ${RESOLVED_DATA_WORKSPACE_CONTRACT}@1 for ${request.gameId}`,
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
          'x3.host/resolved-data-workspace-selected',
          `selected ${lease.value.providerId} for ${request.gameId}`,
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
          'x3.host/resolved-data-workspace-unresolved',
          `no resolved data workspace provider resolved for ${request.gameId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

export interface ResolvedDataWorkspaceLimits {
  readonly maxRequirements: number
  readonly maxDocumentBytes: number
  readonly maxTextBytes: number
  readonly maxEntities: number
  readonly maxDepth: number
  readonly maxPageSize: number
}

export interface AnalyzeResolvedDataWorkspaceRequest {
  readonly services: DataHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly workspace: ModWorkspaceLock
  readonly resources: ResourceSessionPort
  readonly locales: readonly string[]
  readonly queries: readonly DataEntityRef[]
  readonly localizationKeys?: readonly string[]
  readonly limits: ResolvedDataWorkspaceLimits
  /** Host-opened writable namespaces. Providers receive only their root ids, never these bindings. */
  readonly writableRoots?: readonly ResolvedDataWritableRoot[]
  /** Lists a root's files, so the provider plans what the root holds rather than a fixed list. */
  readonly listFiles?: DataWorkspaceFileLister
  readonly signal?: AbortSignal
}

/**
 * Root-relative paths of the files under `prefix` of one workspace root, recursively, at most
 * `maximum` (then `complete: false`). The input that built the workspace lock provides it.
 */
export type DataWorkspaceFileLister = (
  rootId: string,
  prefix: string,
  maximum: number,
  signal?: AbortSignal,
) => Promise<{ readonly paths: readonly string[]; readonly complete: boolean }>

/** Bounds of the listing round: queries per plan, paths per listing. */
export const DATA_WORKSPACE_LISTING_LIMITS = Object.freeze({ maxQueries: 64, maxPaths: 16_384 })

/**
 * Plan, and when the provider asks for directory listings and the caller can list, plan once more
 * with them. The first plan stays the answer when there is nothing to list or no lister.
 */
export async function planDataWorkspace(
  planner: { plan(request: DataWorkspacePlanRequest): Promise<DataWorkspacePlan> },
  request: Omit<DataWorkspacePlanRequest, 'listings'>,
  listFiles?: DataWorkspaceFileLister,
): Promise<DataWorkspacePlan> {
  const first = await planner.plan(request)
  const queries = first.listingQueries
  if (listFiles === undefined || !Array.isArray(queries) || queries.length === 0) return first
  if (queries.length > DATA_WORKSPACE_LISTING_LIMITS.maxQueries) {
    throw new TypeError('resolved data provider asked for too many directory listings')
  }
  const roots = new Set(request.workspace.loadOrder.map(root => root.rootId))
  const listings: DataWorkspaceListing[] = []
  for (const query of queries) {
    if (!roots.has(query.rootId)) {
      throw new TypeError(`resolved data provider asked to list unknown root ${query.rootId}`)
    }
    const prefix = query.prefix === '' ? '' : normalizeCompanionLogicalId(query.prefix)
    const listed = await listFiles(
      query.rootId,
      prefix,
      DATA_WORKSPACE_LISTING_LIMITS.maxPaths,
      request.signal,
    )
    listings.push(
      Object.freeze({
        rootId: query.rootId,
        prefix,
        paths: Object.freeze(listed.paths.slice(0, DATA_WORKSPACE_LISTING_LIMITS.maxPaths)),
        complete: listed.complete && listed.paths.length <= DATA_WORKSPACE_LISTING_LIMITS.maxPaths,
      }),
    )
  }
  return planner.plan({ ...request, listings: Object.freeze(listings) })
}

export interface ResolvedDataWritableRoot {
  readonly rootId: string
  /** Source-owned logical path policy; omission retains legacy aliases. */
  readonly caseSensitive?: boolean
  /** Logical workspace prefix represented by target.ownerSource. */
  readonly sourcePath: string
  readonly target: SubjectEditTarget
}

export interface ResolvedDataDocumentTarget {
  readonly rootId: string
  /** Source-owned logical path policy, captured with the exact document binding. */
  readonly caseSensitive?: boolean
  readonly path: string
  readonly target: SubjectEditTarget
}

export interface ResolvedDataEditDestination {
  readonly rootId: string
  readonly path: string
  readonly mode: 'replace' | 'create'
  readonly label: string
  /** Exact host binding used by the writer after preview. */
  readonly targetId: string
  readonly subjectUri: string
}

export type ResolvedDataEditTargetResult =
  | Exclude<DataEditTargetResult, { readonly state: 'resolved' }>
  | (Extract<DataEditTargetResult, { readonly state: 'resolved' }> &
      Readonly<{ readonly writeTarget: ResolvedDataEditDestination }>)

export interface ResolvedDataWorkspaceFacets {
  readonly schemaTree: Lease<TreeDataSource>
  readonly definitions: Lease<TableDataSource>
  readonly localization: Lease<TableDataSource>
  readonly relations: Lease<RelationGraphSource>
}

export type ResolvedDataSubjectFactsOpenRequest = Omit<DataSubjectFactsOpenRequest, 'snapshotId'>
export type ResolvedDataSubjectCalculationsOpenRequest = Omit<
  DataSubjectCalculationsOpenRequest,
  'snapshotId'
>
export type ResolvedDataEditTargetRequest = Omit<
  DataEditTargetRequest,
  'snapshotId' | 'selectedRootId' | 'writableRootIds'
>
export type ResolvedDataEditPlanRequest = Omit<
  DataEditPlanRequest,
  'snapshotId' | 'selectedRootId' | 'writableRootIds'
>
export type ResolvedDataGraphIsolationRequest = Omit<DataGraphIsolationRequest, 'snapshotId'>
export type ResolvedDataGraphIsolationPlanRequest = Omit<
  DataGraphIsolationPlanRequest,
  'snapshotId' | 'selectedRootId' | 'writableRootIds'
>
export type ResolvedDataGraphIsolationReplacement = DataGraphIsolationReplacement &
  Readonly<{ readonly writeTarget: ResolvedDataEditDestination }>
export type ResolvedDataGraphIsolationPlanProposal = Omit<
  DataGraphIsolationPlanProposal,
  'replacements'
> &
  Readonly<{ readonly replacements: readonly ResolvedDataGraphIsolationReplacement[] }>
export type ResolvedDataGraphIsolationPlanResult =
  | Exclude<DataGraphIsolationPlanResult, { readonly state: 'planned' }>
  | ResolvedDataGraphIsolationPlanProposal

export type AnalyzedResolvedDataWorkspace =
  | Readonly<{
      state: 'resolved'
      snapshot: ResolvedDataWorkspaceSnapshot
      plan: DataWorkspacePlan
      facets: ResolvedDataWorkspaceFacets
      /** Present only when the selected game provider implements semantic subject cards. */
      openSubjectFacts?: (
        request: ResolvedDataSubjectFactsOpenRequest,
      ) => Promise<Lease<SubjectFactsSource>>
      /** Present only when the selected game provider implements auditable calculations. */
      openSubjectCalculations?: (
        request: ResolvedDataSubjectCalculationsOpenRequest,
      ) => Promise<Lease<SubjectCalculationsSource>>
      /** Present only when the selected provider resolves explicit writable edit targets. */
      resolveEditTarget?: (
        request: ResolvedDataEditTargetRequest,
      ) => Promise<ResolvedDataEditTargetResult>
      /** Present only when the provider can preview a source edit and re-resolve its value. */
      planEdit?: (request: ResolvedDataEditPlanRequest) => Promise<DataEditPlanResult>
      /** Host-bound writer input over exact file/namespace targets and all analyzed guards. */
      buildEditChange?: (request: ResolvedDataEditPlanRequest) => Promise<ChangeSet>
      /** Read-only impact preview over this workspace's pinned snapshot. */
      analyzeIsolation?: (
        request: ResolvedDataGraphIsolationRequest,
      ) => Promise<DataGraphIsolationAnalysis>
      /** Provider preview for one atomic clone/rewire operation. */
      planIsolation?: (
        request: ResolvedDataGraphIsolationPlanRequest,
      ) => Promise<ResolvedDataGraphIsolationPlanResult>
      /** Host-bound multi-document clone/rewire ChangeSet. */
      buildIsolationChange?: (
        request: ResolvedDataGraphIsolationPlanRequest,
      ) => Promise<ChangeSet>
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

export interface ResolvedDataSubjectSelectorLimits {
  readonly maxPageSize: number
  readonly maxEntities: number
  readonly maxRelations: number
  readonly maxCalculations: number
  /** Optional provider-owned candidate metadata; the host never derives tags from field names. */
  readonly candidateMetadata?: (entity: DataResolvedEntity) =>
    | Readonly<{
        tags?: readonly string[]
        asset?: Readonly<{ formatId: string; traits: readonly string[] }>
      }>
    | undefined
  /** Named predicates declared by the subject-kind contribution and implemented by its provider. */
  readonly predicates?: Readonly<
    Record<
      string,
      (
        context: Readonly<{
          subject: SelectableSubject
          entity: DataResolvedEntity
          sameTypeAs?: SelectableSubject
          params?: JsonValue
        }>,
      ) => boolean
    >
  >
}

/**
 * Lend entity cards and calculations from one already-resolved workspace without exposing its
 * parser or files to consumers. The analysis remains caller-owned and must outlive this lease.
 */
export function createResolvedDataSubjectSelectorLease(
  analyzed: Extract<AnalyzedResolvedDataWorkspace, { readonly state: 'resolved' }>,
  inputLimits: ResolvedDataSubjectSelectorLimits,
): Lease<SubjectSelectorSource> | undefined {
  if (analyzed.openSubjectFacts === undefined || analyzed.openSubjectCalculations === undefined) {
    return undefined
  }
  const openSubjectFacts = analyzed.openSubjectFacts
  const openSubjectCalculations = analyzed.openSubjectCalculations
  const resolveSubjectEditTarget = analyzed.resolveEditTarget
  const analyzeSubjectIsolation = analyzed.analyzeIsolation
  const planSubjectIsolation = analyzed.planIsolation
  const limits = Object.freeze({
    maxPageSize: positiveBound(inputLimits.maxPageSize, 'maxPageSize'),
    maxEntities: positiveBound(inputLimits.maxEntities, 'maxEntities'),
    maxRelations: positiveBound(inputLimits.maxRelations, 'maxRelations'),
    maxCalculations: positiveBound(inputLimits.maxCalculations, 'maxCalculations'),
  })
  const snapshot = analyzed.snapshot
  const localized = new Map(snapshot.localizedStrings.map(item => [item.key, item.value]))
  const entitiesById = new Map(
    snapshot.definitions.map(entity => [`${entity.namespace}/${entity.entityId}`, entity]),
  )
  const subjects = Object.freeze(
    snapshot.definitions
      .map(entity => {
        const authoredName = entity.fields['Name']
        const label =
          typeof authoredName === 'string'
            ? (localized.get(authoredName) ?? entity.entityId)
            : entity.entityId
        const metadata = inputLimits.candidateMetadata?.(entity)
        if (
          metadata?.tags !== undefined &&
          (!Array.isArray(metadata.tags) ||
            metadata.tags.some(tag => typeof tag !== 'string' || tag.length === 0) ||
            new Set(metadata.tags).size !== metadata.tags.length)
        ) {
          throw new TypeError('subject selector metadata contains invalid tags')
        }
        if (
          metadata?.asset !== undefined &&
          (typeof metadata.asset !== 'object' ||
            metadata.asset === null ||
            typeof metadata.asset.formatId !== 'string' ||
            metadata.asset.formatId.length === 0 ||
            !Array.isArray(metadata.asset.traits) ||
            metadata.asset.traits.some(trait => typeof trait !== 'string' || trait.length === 0) ||
            new Set(metadata.asset.traits).size !== metadata.asset.traits.length)
        ) {
          throw new TypeError('subject selector metadata contains an invalid asset description')
        }
        return Object.freeze({
          subjectId: `${entity.namespace}/${entity.entityId}`,
          label,
          kind: entity.namespace,
          type: entity.typeId,
          ...(metadata?.tags === undefined ? {} : { tags: Object.freeze([...metadata.tags]) }),
          ...(metadata?.asset === undefined
            ? {}
            : {
                asset: Object.freeze({
                  formatId: metadata.asset.formatId,
                  traits: Object.freeze([...metadata.asset.traits]),
                }),
              }),
        }) satisfies SelectableSubject
      })
      .sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
  )
  const byId = new Map<string, SelectableSubject>(subjects.map(item => [item.subjectId, item]))
  let live = true
  const assertLive = (signal?: AbortSignal): void => {
    signal?.throwIfAborted()
    if (!live) throw new Error('resolved data subject selector lease has been released')
  }
  const page = (request: SubjectSelectorQuery, signal?: AbortSignal): Page<SelectableSubject> => {
    assertLive(signal)
    if (
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > limits.maxPageSize
    ) {
      throw new RangeError(`subject selector limit must be between 1 and ${limits.maxPageSize}`)
    }
    const text = request.text?.trim().toLocaleLowerCase('en-US')
    const filterText = request.filter?.text?.trim().toLocaleLowerCase('en-US')
    const sameTypeAs =
      request.filter?.sameTypeAs === undefined ? undefined : byId.get(request.filter.sameTypeAs)
    if (request.filter?.sameTypeAs !== undefined && sameTypeAs === undefined) {
      throw new RangeError(
        `subject selector sameTypeAs anchor not found: ${request.filter.sameTypeAs}`,
      )
    }
    const predicateId = request.filter?.predicate?.id
    const predicate = predicateId === undefined ? undefined : inputLimits.predicates?.[predicateId]
    if (predicateId !== undefined && predicate === undefined) {
      throw new RangeError(`subject selector predicate is unavailable: ${predicateId}`)
    }
    const matchesText = (subject: SelectableSubject, needle: string | undefined): boolean =>
      needle === undefined ||
      needle.length === 0 ||
      subject.subjectId.toLocaleLowerCase('en-US').includes(needle) ||
      subject.label.toLocaleLowerCase('en-US').includes(needle)
    const acceptsAsset = (subject: SelectableSubject): boolean => {
      if (request.asset === undefined) return subject.asset === undefined
      const asset = subject.asset
      if (asset === undefined) return false
      return (
        (request.asset.formatIds === undefined ||
          request.asset.formatIds.includes(asset.formatId)) &&
        (request.asset.traits === undefined ||
          request.asset.traits.every(trait => asset.traits.includes(trait)))
      )
    }
    const filtered = subjects.filter(subject => {
      const tags = subject.tags ?? []
      const entity = entitiesById.get(subject.subjectId)
      return (
        acceptsAsset(subject) &&
        (request.kind === undefined || subject.kind === request.kind) &&
        (request.type === undefined || subject.type === request.type) &&
        (request.filter?.type === undefined || subject.type === request.filter.type) &&
        (sameTypeAs === undefined || subject.type === sameTypeAs.type) &&
        matchesText(subject, text) &&
        matchesText(subject, filterText) &&
        (request.filter?.requireTags === undefined ||
          request.filter.requireTags.every(tag => tags.includes(tag))) &&
        (request.filter?.excludeTags === undefined ||
          request.filter.excludeTags.every(tag => !tags.includes(tag))) &&
        (predicate === undefined ||
          (entity !== undefined &&
            predicate({
              subject,
              entity,
              ...(sameTypeAs === undefined ? {} : { sameTypeAs }),
              ...(request.filter?.predicate?.params === undefined
                ? {}
                : { params: request.filter.predicate.params }),
            }) === true))
      )
    })
    const offset =
      request.cursor === undefined ? 0 : Number(request.cursor.replace(/^subject:/u, ''))
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > filtered.length ||
      (request.cursor !== undefined && request.cursor !== `subject:${offset}`)
    ) {
      throw new RangeError('subject selector cursor is invalid or stale')
    }
    const end = Math.min(filtered.length, offset + request.limit)
    return Object.freeze({
      items: Object.freeze(filtered.slice(offset, end)),
      ...(end < filtered.length ? { nextCursor: `subject:${end}` } : {}),
    })
  }
  const selected = (subjectId: string, signal?: AbortSignal): SelectableSubject => {
    assertLive(signal)
    const subject = byId.get(subjectId)
    if (subject === undefined) throw new RangeError(`resolved data subject not found: ${subjectId}`)
    return subject
  }
  const documentRef = (value: {
    readonly rootId: string
    readonly path: string
    readonly revision?: RevisionId
  }) =>
    Object.freeze({
      rootId: value.rootId,
      path: value.path,
      ...(value.revision === undefined ? {} : { revision: value.revision }),
    })
  const resolveTarget =
    resolveSubjectEditTarget === undefined
      ? undefined
      : async (
          request: SubjectEditTargetRequest,
          signal?: AbortSignal,
        ): Promise<SubjectEditTargetResult> => {
          const subject = selected(request.subjectId, signal)
          try {
            const result = await resolveSubjectEditTarget({
              subject: {
                namespace: subject.kind,
                entityId: subject.subjectId.slice(subject.kind.length + 1),
              },
              fieldPath: request.fieldPath,
              ...(request.targetDocument === undefined
                ? {}
                : { targetDocument: request.targetDocument }),
              ...(signal === undefined ? {} : { signal }),
            })
            if (result.state === 'selection-required') {
              return Object.freeze({
                state: 'selection-required' as const,
                snapshotId: result.snapshotId,
                workspaceId: result.workspaceId,
                selectedRootId: result.selectedRootId,
                subjectId: request.subjectId,
                fieldPath: Object.freeze([...result.fieldPath]),
                candidates: Object.freeze(result.candidates.map(documentRef)),
                reason: result.reason,
              })
            }
            return Object.freeze({
              state: 'resolved' as const,
              snapshotId: result.snapshotId,
              workspaceId: result.workspaceId,
              selectedRootId: result.selectedRootId,
              subjectId: request.subjectId,
              fieldPath: Object.freeze([...result.fieldPath]),
              action: result.action,
              destination: Object.freeze({
                ...documentRef(result.target),
                ...result.writeTarget,
              }),
              candidates: Object.freeze(result.candidates.map(documentRef)),
              ...(result.lastDeclaration === undefined
                ? {}
                : { lastDeclaration: documentRef(result.lastDeclaration) }),
              ...(result.effectiveFieldSource === undefined
                ? {}
                : { effectiveFieldSource: documentRef(result.effectiveFieldSource) }),
              selectionReason: result.selectionReason,
              guards: Object.freeze(result.guards.map(documentRef)),
            })
          } catch (error) {
            if (signal?.aborted) throw error
            return Object.freeze({
              state: 'unavailable' as const,
              snapshotId: snapshot.snapshotId,
              subjectId: request.subjectId,
              fieldPath: Object.freeze([...request.fieldPath]),
              reason: error instanceof Error ? error.message : String(error),
            })
          }
        }
  const resolveIsolation =
    analyzeSubjectIsolation === undefined
      ? undefined
      : async (
          request: SubjectIsolationRequest,
          signal?: AbortSignal,
        ): Promise<SubjectIsolationResult> => {
          const owner = selected(request.ownerSubjectId, signal)
          const target = selected(request.targetSubjectId, signal)
          const subjectId = (subject: SelectableSubject): DataEntityRef => ({
            namespace: subject.kind,
            entityId: subject.subjectId.slice(subject.kind.length + 1),
          })
          const result = await analyzeSubjectIsolation({
            schemaVersion: 1,
            owner: subjectId(owner),
            target: subjectId(target),
            ownerFieldPath: request.ownerFieldPath,
            maxEdges: request.maxEdges,
            ...(request.always === undefined ? {} : { always: request.always }),
            ...(signal === undefined ? {} : { signal }),
          })
          const toSubjectId = (value: DataEntityRef): string =>
            `${value.namespace}/${value.entityId}`
          if (result.state === 'unavailable') {
            return Object.freeze({
              schemaVersion: 1 as const,
              state: 'unavailable' as const,
              snapshotId: snapshot.snapshotId,
              ownerSubjectId: request.ownerSubjectId,
              targetSubjectId: request.targetSubjectId,
              ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
              cloneRequired: false as const,
              reason: result.reason,
            })
          }
          return Object.freeze({
            schemaVersion: 1 as const,
            state: 'ready' as const,
            snapshotId: snapshot.snapshotId,
            ownerSubjectId: request.ownerSubjectId,
            targetSubjectId: request.targetSubjectId,
            ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
            shared: result.shared,
            cloneRequired: result.cloneRequired,
            referrers: Object.freeze(
              result.referrers.map(referrer =>
                Object.freeze({
                  subjectId: toSubjectId(referrer.subject),
                  fieldPaths: Object.freeze(
                    referrer.fieldPaths.map(path => Object.freeze([...path])),
                  ),
                }),
              ),
            ),
            otherReferrerIds: Object.freeze(result.otherReferrers.map(toSubjectId)),
            rewireFieldPaths: Object.freeze(
              result.rewireFieldPaths.map(path => Object.freeze([...path])),
            ),
          })
        }
  const resolveIsolationPlan =
    planSubjectIsolation === undefined
      ? undefined
      : async (
          request: SubjectIsolationPlanRequest,
          signal?: AbortSignal,
        ): Promise<SubjectIsolationPlanResult> => {
          const owner = selected(request.ownerSubjectId, signal)
          const target = selected(request.targetSubjectId, signal)
          const clonePrefix = `${target.kind}/`
          if (
            !request.cloneSubjectId.startsWith(clonePrefix) ||
            request.cloneSubjectId.length === clonePrefix.length
          ) {
            throw new TypeError(`cloneSubjectId must use namespace ${target.kind}`)
          }
          const entityRef = (subject: SelectableSubject): DataEntityRef => ({
            namespace: subject.kind,
            entityId: subject.subjectId.slice(subject.kind.length + 1),
          })
          const result = await planSubjectIsolation({
            schemaVersion: 1,
            owner: entityRef(owner),
            target: entityRef(target),
            ownerFieldPath: request.ownerFieldPath,
            maxEdges: request.maxEdges,
            ...(request.always === undefined ? {} : { always: request.always }),
            cloneEntityId: request.cloneSubjectId.slice(clonePrefix.length),
            ...(request.ownerTargetDocument === undefined
              ? {}
              : { ownerTargetDocument: request.ownerTargetDocument }),
            ...(request.cloneTargetDocument === undefined
              ? {}
              : { cloneTargetDocument: request.cloneTargetDocument }),
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'unavailable') {
            return Object.freeze({
              schemaVersion: 1 as const,
              state: 'unavailable' as const,
              snapshotId: snapshot.snapshotId,
              ownerSubjectId: request.ownerSubjectId,
              targetSubjectId: request.targetSubjectId,
              ownerFieldPath: Object.freeze([...result.ownerFieldPath]),
              cloneRequired: false as const,
              reason: result.reason,
            })
          }
          if (result.state === 'selection-required') {
            return Object.freeze({
              schemaVersion: 1 as const,
              state: 'selection-required' as const,
              snapshotId: result.snapshotId,
              ownerSubjectId: request.ownerSubjectId,
              targetSubjectId: request.targetSubjectId,
              cloneSubjectId: request.cloneSubjectId,
              purpose: result.purpose,
              candidates: Object.freeze(result.candidates.map(documentRef)),
              reason: result.reason,
            })
          }
          const toSubjectId = (value: DataEntityRef): string =>
            `${value.namespace}/${value.entityId}`
          const analysis: Extract<SubjectIsolationResult, { readonly state: 'ready' }> =
            Object.freeze({
              schemaVersion: 1,
              state: 'ready',
              snapshotId: result.snapshotId,
              ownerSubjectId: request.ownerSubjectId,
              targetSubjectId: request.targetSubjectId,
              ownerFieldPath: Object.freeze([...result.analysis.ownerFieldPath]),
              shared: result.analysis.shared,
              cloneRequired: result.analysis.cloneRequired,
              referrers: Object.freeze(
                result.analysis.referrers.map(referrer =>
                  Object.freeze({
                    subjectId: toSubjectId(referrer.subject),
                    fieldPaths: Object.freeze(
                      referrer.fieldPaths.map(path => Object.freeze([...path])),
                    ),
                  }),
                ),
              ),
              otherReferrerIds: Object.freeze(result.analysis.otherReferrers.map(toSubjectId)),
              rewireFieldPaths: Object.freeze(
                result.analysis.rewireFieldPaths.map(path => Object.freeze([...path])),
              ),
            })
          return Object.freeze({
            schemaVersion: 1 as const,
            state: 'planned' as const,
            snapshotId: result.snapshotId,
            previewSnapshotId: result.previewSnapshotId,
            ownerSubjectId: request.ownerSubjectId,
            targetSubjectId: request.targetSubjectId,
            cloneSubjectId: request.cloneSubjectId,
            analysis,
            replacements: Object.freeze(
              result.replacements.map(replacement =>
                Object.freeze({
                  purpose: replacement.purpose,
                  destination: Object.freeze({
                    ...documentRef(replacement.target),
                    ...replacement.writeTarget,
                  }),
                  replacementBytes: new TextEncoder().encode(replacement.replacementText).byteLength,
                }),
              ),
            ),
            diagnostics: Object.freeze(
              result.diagnostics.map(item =>
                Object.freeze({
                  severity: item.severity,
                  code: item.code,
                  message: item.message,
                }),
              ),
            ),
          })
        }
  const source: SubjectSelectorSource = Object.freeze({
    async summary(signal?: AbortSignal) {
      assertLive(signal)
      return Object.freeze({
        snapshotId: snapshot.snapshotId,
        totalSubjects: subjects.length,
        completeness: snapshot.complete ? ('complete' as const) : ('partial' as const),
        ...(snapshot.complete ? {} : { reason: 'the resolved data workspace is incomplete' }),
      })
    },
    subjects: async (request: SubjectSelectorQuery, signal?: AbortSignal) => page(request, signal),
    ...(resolveIsolation === undefined ? {} : { isolation: resolveIsolation }),
    ...(resolveIsolationPlan === undefined ? {} : { isolationPlan: resolveIsolationPlan }),
    async openFacts(subjectId: string, signal?: AbortSignal) {
      const subject = selected(subjectId, signal)
      const lease = await openSubjectFacts({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1),
        },
        ...limits,
        ...(signal === undefined ? {} : { signal }),
      })
      if (resolveTarget === undefined) return lease
      const facts = lease.value
      const entityId = subject.subjectId.slice(subject.kind.length + 1)
      const fieldPathOf = (fact: Awaited<ReturnType<SubjectFactsSource['facts']>>['items'][number]) =>
        fact.provenance
          .map(item => item.semanticPath)
          .find(
            path =>
              path !== undefined &&
              path.length > 2 &&
              path[0] === subject.kind &&
              path[1] === entityId,
          )
          ?.slice(2)
      const projected: SubjectFactsSource = Object.freeze({
          summary: (nestedSignal?: AbortSignal) => facts.summary(nestedSignal),
          groups: (pageRequest: PageRequest, nestedSignal?: AbortSignal) =>
            facts.groups(pageRequest, nestedSignal),
          async facts(
            groupId: string,
            pageRequest: PageRequest,
            nestedSignal?: AbortSignal,
          ) {
            const result = await facts.facts(groupId, pageRequest, nestedSignal)
            const items = await Promise.all(
              result.items.map(async fact => {
                const fieldPath = fieldPathOf(fact)
                if (fieldPath === undefined || fieldPath.length === 0) return fact
                const editTarget = await resolveTarget(
                  { subjectId: subject.subjectId, fieldPath },
                  nestedSignal,
                )
                return Object.freeze({ ...fact, editTarget })
              }),
            )
            return Object.freeze({
              ...result,
              items: Object.freeze(items),
            })
          },
          relations: (pageRequest: PageRequest, nestedSignal?: AbortSignal) =>
            facts.relations(pageRequest, nestedSignal),
        })
      return Object.freeze({
        value: projected,
        release: () => lease.release(),
      })
    },
    async openCalculations(subjectId: string, signal?: AbortSignal) {
      const subject = selected(subjectId, signal)
      return openSubjectCalculations({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1),
        },
        maxPageSize: limits.maxPageSize,
        maxEntities: limits.maxEntities,
        maxCalculations: limits.maxCalculations,
        ...(signal === undefined ? {} : { signal }),
      })
    },
    ...(resolveTarget === undefined
      ? {}
      : {
          editTarget: resolveTarget,
        }),
  })
  return Object.freeze({
    value: source,
    release(): Promise<void> {
      live = false
      return Promise.resolve()
    },
  })
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function confinedPath(value: string, label: string): string {
  if (
    value.includes('\0') ||
    /^[a-z]:[\\/]/iu.test(value) ||
    /^[\\/]/u.test(value) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(value)
  ) {
    throw new TypeError(`${label} must be a confined logical path`)
  }
  const parts: string[] = []
  for (const part of value.replace(/\\/gu, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new TypeError(`${label} must not escape its workspace root`)
    parts.push(part)
  }
  if (parts.length === 0) throw new TypeError(`${label} must name a logical path`)
  return parts.join('/')
}

function comparableLocale(value: string): string {
  return value.replace(/[-_]/gu, '').toLocaleLowerCase()
}

/** Validate bounded provider reads/destinations before I/O; destinations never expand write grants. */
function validateWorkspacePlan(
  plan: DataWorkspacePlan,
  workspace: ModWorkspaceLock,
  locales: readonly string[],
  maximum: number,
): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.workspaceId !== workspace.workspaceId ||
    plan.gameId !== workspace.gameId ||
    !Array.isArray(plan.requirements) ||
    plan.requirements.length > maximum
  ) {
    throw new TypeError('resolved data provider returned an invalid or mismatched workspace plan')
  }
  const roots = new Map(workspace.loadOrder.map((root, index) => [root.rootId, { root, index }]))
  /** Confine both reads and prospective destinations using the source's declared case policy. */
  const validateDocumentPath = (rootId: string, value: string, label: string) => {
    const root = roots.get(rootId)
    if (root === undefined) throw new TypeError(`${label} names unknown root`)
    // An empty root denotes its whole source, including game installation layers.
    const rootPath = root.root.sourcePath === '' ? '' : confinedPath(root.root.sourcePath, `${label}.root`)
    const path = confinedPath(value, `${label}.path`)
    const foldedRoot = root.root.caseSensitive === true ? rootPath : rootPath.toLocaleLowerCase()
    const foldedPath = root.root.caseSensitive === true ? path : path.toLocaleLowerCase()
    if (rootPath !== '' && foldedPath !== foldedRoot && !foldedPath.startsWith(`${foldedRoot}/`)) {
      throw new TypeError(`${label} escapes its root`)
    }
    return { ...root, path: foldedPath }
  }
  if (plan.creationCandidates !== undefined) {
    if (!Array.isArray(plan.creationCandidates) || plan.creationCandidates.length > maximum) {
      throw new TypeError('workspace data creation candidates exceed the plan budget or are invalid')
    }
    const seen = new Set<string>()
    for (const candidate of plan.creationCandidates) {
      if (candidate?.rootId !== workspace.activeRootId) {
        throw new TypeError('workspace data creation candidate must name the active root')
      }
      const { path } = validateDocumentPath(candidate.rootId, candidate.path, 'workspace data creation candidate')
      const key = `${candidate.rootId}\0${path}`
      if (seen.has(key)) throw new TypeError('workspace data creation candidate is duplicated')
      seen.add(key)
    }
  }
  const logical = new Map(
    (workspace.logicalRoots ?? [...workspace.loadOrder].reverse()).map((root, index) => [
      root.rootId,
      index,
    ]),
  )
  const localeRanks = new Map(
    locales.map((locale, index) => [comparableLocale(locale), index] as const),
  )
  const requirementIds = new Set<string>()
  let catalogRank = -1
  let localizationRank = -1
  let localizationStarted = false
  for (const requirement of plan.requirements) {
    if (requirement.required !== undefined && typeof requirement.required !== 'boolean') {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid required flag`,
      )
    }
    if (
      requirement.encoding !== undefined &&
      requirement.encoding !== 'text' &&
      requirement.encoding !== 'binary'
    ) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid encoding`,
      )
    }
    if (requirementIds.has(requirement.requirementId)) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} is duplicated`)
    }
    requirementIds.add(requirement.requirementId)
    const root = validateDocumentPath(
      requirement.rootId,
      requirement.path,
      `workspace data requirement ${requirement.requirementId}`,
    )
    // A usage document only names entities: it takes no part in catalog or locale precedence.
    if (requirement.kind === 'usage') continue
    if (requirement.kind === 'catalog') {
      if (localizationStarted) {
        throw new TypeError('catalog requirements must precede localization requirements')
      }
      if (root.index < catalogRank) {
        throw new TypeError('catalog requirements are not in dependency-first loadOrder')
      }
      catalogRank = root.index
      continue
    }
    if (requirement.kind !== 'localization' || requirement.locale === undefined) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} has invalid kind`,
      )
    }
    localizationStarted = true
    const localeRank = localeRanks.get(comparableLocale(requirement.locale))
    const rootRank = logical.get(requirement.rootId)
    if (localeRank === undefined || rootRank === undefined) {
      throw new TypeError(
        `workspace localization requirement ${requirement.requirementId} is invalid`,
      )
    }
    const rank = localeRank * workspace.loadOrder.length + rootRank
    if (rank < localizationRank) {
      throw new TypeError('localization requirements are not locale-first and winner-first')
    }
    localizationRank = rank
  }
}

/** Exported for its test only. */
export async function readResourceText(
  resources: ResourceSessionPort,
  requirement: DataWorkspaceDocumentRequirement,
  maxDocumentBytes: number,
  signal?: AbortSignal,
): Promise<
  | {
      readonly state: 'resolved'
      readonly text: string
      /** Present for a requirement read as `encoding: 'binary'`; `text` is then empty. */
      readonly bytes?: Uint8Array
      readonly revision: RevisionId
      readonly source: AssetSourceRef
    }
  | { readonly state: 'unresolved'; readonly diagnostic: Diagnostic }
> {
  let resolved: Awaited<ReturnType<ResourceSessionPort['resolve']>>
  try {
    resolved = await resources.resolve(
      {
        id: requirement.requirementId,
        logicalId: requirement.path,
        role: 'buffer',
        scopes: ['current-mount', 'enclosing-container', 'workspace-dependency-layer'],
      },
      signal,
    )
  } catch (error) {
    signal?.throwIfAborted()
    return {
      state: 'unresolved',
      diagnostic: diagnostic(
        'warning',
        'x3.host/resolved-data-resource-open-failed',
        `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    }
  }
  if (resolved.state === 'unresolved') {
    return { state: 'unresolved', diagnostic: resolved.diagnostic }
  }
  try {
    const source = resolved.lease.value
    if (source.kind !== 'bytes') {
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          'x3.host/resolved-data-resource-not-bytes',
          `${requirement.path} resolved to a namespace instead of bytes`,
        ),
      }
    }
    if (source.size !== undefined && source.size > BigInt(maxDocumentBytes)) {
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          'x3.host/resolved-data-document-budget-exceeded',
          `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`,
        ),
      }
    }
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for await (const chunk of source.stream(undefined, signal)) {
        bytes += chunk.byteLength
        if (bytes > maxDocumentBytes) {
          return {
            state: 'unresolved',
            diagnostic: diagnostic(
              'warning',
              'x3.host/resolved-data-document-budget-exceeded',
              `${requirement.path} exceeds maxDocumentBytes ${maxDocumentBytes}`,
            ),
          }
        }
        chunks.push(chunk)
      }
    } catch (error) {
      // a document that opens but cannot be read (its data in an absent companion) is unresolved,
      // as one that does not open is: an optional one then drops out, a required one is named
      signal?.throwIfAborted()
      return {
        state: 'unresolved',
        diagnostic: diagnostic(
          'warning',
          'x3.host/resolved-data-resource-read-failed',
          `${requirement.path}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      }
    }
    const content = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      content.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      state: 'resolved',
      ...(requirement.encoding === 'binary'
        ? { text: '', bytes: content }
        : { text: new TextDecoder('utf-8', { fatal: false }).decode(content) }),
      revision: resolved.revision,
      source: Object.freeze({ ...source.ref }),
    }
  } finally {
    await resolved.lease.release()
  }
}

function directDataDocumentTarget(
  rootId: string,
  path: string,
  source: AssetSourceRef,
  revision: RevisionId,
  caseSensitive?: boolean,
): ResolvedDataDocumentTarget {
  const expectedRevision: AssetRevision = Object.freeze({
    bindings: Object.freeze({ [source.id]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: source.id,
      source: { id: source.id, uri: source.uri },
      revision,
    }),
  })
  return Object.freeze({
    rootId,
    path,
    ...(caseSensitive === undefined ? {} : { caseSensitive }),
    target: Object.freeze({
      targetId: source.id,
      subjectUri: source.uri,
      ownerSource: source,
      semanticPath: Object.freeze([]),
      expectedRevision,
    }),
  })
}

/** A Data logical path's identity under its source owner, shared by binding and duplicate checks. */
function logicalDataPathKey(path: string, caseSensitive: boolean): string {
  const normalized = path.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
  return caseSensitive ? normalized : normalized.toLowerCase()
}

function sameLogicalDocument(
  left: Readonly<{ rootId: string; path: string; caseSensitive?: boolean }>,
  right: Readonly<{ rootId: string; path: string; caseSensitive?: boolean }>,
): boolean {
  const strict = left.caseSensitive === true || right.caseSensitive === true
  return (
    left.rootId === right.rootId &&
    logicalDataPathKey(left.path, strict) === logicalDataPathKey(right.path, strict)
  )
}

function pathInsideWritableRoot(path: string, root: ResolvedDataWritableRoot): string {
  const normalize = (value: string) =>
    value
      .replace(/\\/gu, '/')
      .replace(/^\/+|\/+$/gu, '')
      .split('/')
  const pathParts = normalize(path)
  const rootParts = normalize(root.sourcePath)
  if (
    rootParts.length === 0 ||
    pathParts.length <= rootParts.length ||
    rootParts.some((part, index) =>
      root.caseSensitive === true
        ? part !== pathParts[index]
        : part.toLowerCase() !== pathParts[index]?.toLowerCase(),
    )
  ) {
    throw new TypeError(`edit path ${path} is outside writable root ${root.sourcePath}`)
  }
  const relative = pathParts.slice(rootParts.length)
  if (relative.some(part => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`edit path ${path} is not confined inside ${root.sourcePath}`)
  }
  return relative.join('/')
}

/**
 * Legacy data ids may fold case; a person reads the file as the store spells it. Strict bindings
 * accept only the same segments. This changes the displayed destination, never the bound source.
 */
function storedSpelling(path: string, subjectUri: string, caseSensitive = false): string {
  const parts = path
    .replace(/\\/gu, '/')
    .split('/')
    .filter(part => part !== '')
  let stored: string[]
  try {
    stored = decodeURIComponent(new URL(subjectUri).pathname)
      .split('/')
      .filter(part => part !== '')
  } catch {
    return path
  }
  const tail = stored.slice(-parts.length)
  return tail.length === parts.length &&
    tail.every((part, index) =>
      caseSensitive ? part === parts[index] : part.toLowerCase() === parts[index]?.toLowerCase(),
    )
    ? tail.join('/')
    : path
}

function bindResolvedDataEditDestination(
  resolved: Extract<DataEditTargetResult, { readonly state: 'resolved' }>,
  documents: readonly ResolvedDataDocumentTarget[],
  writableRoots: readonly ResolvedDataWritableRoot[],
): ResolvedDataEditDestination {
  const documentBinding =
    resolved.target.mode === 'replace'
      ? documents.find(document => sameLogicalDocument(document, resolved.target))
      : undefined
  const binding =
    resolved.target.mode === 'replace'
      ? documentBinding?.target
      : writableRoots.find(root => root.rootId === resolved.selectedRootId)?.target
  if (binding === undefined) {
    throw new TypeError(
      resolved.target.mode === 'replace'
        ? 'resolved edit target has no host document binding'
        : `active mod ${resolved.selectedRootId} has no writable namespace binding`,
    )
  }
  const path =
    resolved.target.mode === 'replace'
      ? storedSpelling(resolved.target.path, binding.subjectUri, documentBinding?.caseSensitive)
      : resolved.target.path
  return Object.freeze({
    rootId: resolved.target.rootId,
    path,
    mode: resolved.target.mode,
    label: `Write: ${resolved.target.rootId} → ${path}`,
    targetId: binding.targetId,
    subjectUri: binding.subjectUri,
  })
}

function bindDataDocumentDestination(
  target: DataEditDocumentRef & { readonly mode: 'replace' | 'create' },
  selectedRootId: string,
  documents: readonly ResolvedDataDocumentTarget[],
  writableRoots: readonly ResolvedDataWritableRoot[],
): ResolvedDataEditDestination {
  const documentBinding =
    target.mode === 'replace'
      ? documents.find(document => sameLogicalDocument(document, target))
      : undefined
  const binding =
    target.mode === 'replace'
      ? documentBinding?.target
      : writableRoots.find(root => root.rootId === selectedRootId)?.target
  if (binding === undefined) {
    throw new TypeError(
      target.mode === 'replace'
        ? 'resolved isolation target has no host document binding'
        : `active mod ${selectedRootId} has no writable namespace binding`,
    )
  }
  const path =
    target.mode === 'replace'
      ? storedSpelling(target.path, binding.subjectUri, documentBinding?.caseSensitive)
      : target.path
  return Object.freeze({
    rootId: target.rootId,
    path,
    mode: target.mode,
    label: `Write: ${target.rootId} → ${path}`,
    targetId: binding.targetId,
    subjectUri: binding.subjectUri,
  })
}

export const DATA_EDIT_SELECTION_REQUIRED = 'x3.host/resolved-data-edit-selection-required'

/**
 * A provider that cannot choose the destination document answers with candidates; the caller must
 * name one. That is a structured refusal carrying the candidates, not a generic failure.
 */
function dataEditSelectionRequired(
  result: Readonly<{
    reason: string
    candidates: readonly Readonly<{ rootId: string; path: string }>[]
  }>,
): ModkitError {
  return new ModkitError({
    code: DATA_EDIT_SELECTION_REQUIRED,
    message: `choose a destination document: ${result.reason}`,
    context: {
      reason: result.reason,
      candidates: result.candidates.map(item => ({ rootId: item.rootId, path: item.path })),
    },
  })
}

/** Bind a provider-owned semantic preview to host-owned physical targets without trusting paths. */
export function editChangeFromDataEditProposal(
  proposal: DataEditPlanProposal,
  documentTargets: readonly ResolvedDataDocumentTarget[],
  writableRoots: readonly ResolvedDataWritableRoot[],
): ChangeSet {
  const resolved = proposal.target
  const guarded: SubjectEditTarget[] = []
  const targetIds = new Set<string>()
  for (const guard of resolved.guards) {
    const binding = documentTargets.find(candidate => sameLogicalDocument(candidate, guard))
    if (binding === undefined || guard.revision === undefined) {
      throw new TypeError(`no host document binding exists for guarded ${guard.rootId}/${guard.path}`)
    }
    const revisions = Object.values(binding.target.expectedRevision.bindings)
    if (revisions.length !== 1 || revisions[0] !== guard.revision) {
      throw new TypeError(`host document binding revision changed for ${guard.rootId}/${guard.path}`)
    }
    if (!targetIds.has(binding.target.targetId)) {
      targetIds.add(binding.target.targetId)
      guarded.push(binding.target)
    }
  }

  let editTarget: SubjectEditTarget
  let edit: ChangeSet['edits'][number]
  if (resolved.target.mode === 'replace') {
    const binding = documentTargets.find(candidate =>
      sameLogicalDocument(candidate, resolved.target),
    )
    if (binding === undefined || !targetIds.has(binding.target.targetId)) {
      throw new TypeError('resolved replacement target is not one of the guarded host documents')
    }
    editTarget = binding.target
    edit = Object.freeze({
      operation: 'replace',
      targetId: editTarget.targetId,
      source: editTarget.ownerSource,
      payload: Object.freeze({ kind: 'text', text: proposal.replacementText }),
      label: `edit SC2 data ${resolved.subject.namespace}/${resolved.subject.entityId}`,
    })
  } else {
    const root = writableRoots.find(candidate => candidate.rootId === resolved.selectedRootId)
    if (root === undefined || root.target.expectedRevision.namespaceRevision === undefined) {
      throw new TypeError(`active mod ${resolved.selectedRootId} has no writable namespace binding`)
    }
    editTarget = root.target
    if (!targetIds.has(editTarget.targetId)) {
      targetIds.add(editTarget.targetId)
      guarded.push(editTarget)
    }
    edit = Object.freeze({
      operation: 'create',
      targetId: editTarget.targetId,
      source: editTarget.ownerSource,
      newPath: pathInsideWritableRoot(resolved.target.path, root),
      payload: Object.freeze({ kind: 'text', text: proposal.replacementText }),
      label: `declare SC2 data ${resolved.subject.namespace}/${resolved.subject.entityId}`,
    })
  }
  return Object.freeze({
    targets: Object.freeze(guarded),
    edits: Object.freeze([edit]),
    semanticIntent: Object.freeze({
      kind: 'sc2-authored-text-save-v1',
      formatId: 'sc2-data',
      sourceComplete: true,
      unknownDataPolicy: 'preserve-from-complete-snapshot',
      workspaceId: resolved.workspaceId,
      snapshotId: resolved.snapshotId,
      selectedRootId: resolved.selectedRootId,
      targetPath: resolved.target.path,
      editIntent: proposal.intent,
      previewSnapshotId: proposal.previewSnapshotId,
    }),
    provenance: Object.freeze({ actor: 'user', note: 'resolved SC2 data field edit' }),
  })
}

/** Bind a provider-owned clone/rewire preview to one guarded multi-document ChangeSet. */
export function isolationChangeFromDataGraphProposal(
  proposal: DataGraphIsolationPlanProposal,
  documentTargets: readonly ResolvedDataDocumentTarget[],
  writableRoots: readonly ResolvedDataWritableRoot[],
): ChangeSet {
  const guarded: SubjectEditTarget[] = []
  const guardedIds = new Set<string>()
  for (const guard of proposal.guards) {
    const binding = documentTargets.find(candidate => sameLogicalDocument(candidate, guard))
    if (binding === undefined || guard.revision === undefined) {
      throw new TypeError(
        `no host document binding exists for guarded ${guard.rootId}/${guard.path}`,
      )
    }
    const revisions = Object.values(binding.target.expectedRevision.bindings)
    if (revisions.length !== 1 || revisions[0] !== guard.revision) {
      throw new TypeError(
        `host document binding revision changed for ${guard.rootId}/${guard.path}`,
      )
    }
    if (!guardedIds.has(binding.target.targetId)) {
      guardedIds.add(binding.target.targetId)
      guarded.push(binding.target)
    }
  }
  const paths = new Set<string>()
  const edits: ChangeSet['edits'][number][] = []
  for (const replacement of proposal.replacements) {
    if (replacement.target.rootId !== proposal.selectedRootId) {
      throw new TypeError('isolation replacement escaped the selected writable mod')
    }
    const policy =
      writableRoots.find(root => root.rootId === replacement.target.rootId)?.caseSensitive ??
      documentTargets.find(document => document.rootId === replacement.target.rootId)?.caseSensitive
    const pathIdentity = `${replacement.target.rootId}\0${logicalDataPathKey(replacement.target.path, policy === true)}`
    if (paths.has(pathIdentity)) throw new TypeError('isolation proposal contains duplicate targets')
    paths.add(pathIdentity)
    if (replacement.target.mode === 'replace') {
      const binding = documentTargets.find(candidate =>
        sameLogicalDocument(candidate, replacement.target),
      )
      if (binding === undefined || !guardedIds.has(binding.target.targetId)) {
        throw new TypeError('isolation replacement target is not a guarded host document')
      }
      edits.push(
        Object.freeze({
          operation: 'replace' as const,
          targetId: binding.target.targetId,
          source: binding.target.ownerSource,
          payload: Object.freeze({ kind: 'text' as const, text: replacement.replacementText }),
          label: `${replacement.purpose} SC2 data object`,
        }),
      )
      continue
    }
    const root = writableRoots.find(candidate => candidate.rootId === proposal.selectedRootId)
    if (root === undefined || root.target.expectedRevision.namespaceRevision === undefined) {
      throw new TypeError(`active mod ${proposal.selectedRootId} has no writable namespace binding`)
    }
    if (!guardedIds.has(root.target.targetId)) {
      guardedIds.add(root.target.targetId)
      guarded.push(root.target)
    }
    edits.push(
      Object.freeze({
        operation: 'create' as const,
        targetId: root.target.targetId,
        source: root.target.ownerSource,
        newPath: pathInsideWritableRoot(replacement.target.path, root),
        payload: Object.freeze({ kind: 'text' as const, text: replacement.replacementText }),
        label: `${replacement.purpose} SC2 data object`,
      }),
    )
  }
  if (edits.length === 0) throw new TypeError('isolation proposal contains no replacements')
  return Object.freeze({
    targets: Object.freeze(guarded),
    edits: Object.freeze(edits),
    semanticIntent: Object.freeze({
      // The authored-text writer accepts exactly one save contract; the isolation rides in editIntent.
      kind: 'sc2-authored-text-save-v1',
      formatId: 'sc2-data',
      sourceComplete: true,
      unknownDataPolicy: 'preserve-from-complete-snapshot',
      workspaceId: proposal.workspaceId,
      snapshotId: proposal.snapshotId,
      selectedRootId: proposal.selectedRootId,
      editIntent: Object.freeze({
        kind: 'isolate-shared-object',
        clone: Object.freeze({ ...proposal.clone }),
        owner: Object.freeze({ ...proposal.analysis.owner }),
        target: Object.freeze({ ...proposal.analysis.target }),
        ownerFieldPath: Object.freeze([...proposal.analysis.ownerFieldPath]),
      }),
      previewSnapshotId: proposal.previewSnapshotId,
    }),
    provenance: Object.freeze({ actor: 'user', note: 'resolved SC2 data clone and rewire' }),
  })
}

/**
 * Product path: service resolution -> provider plan -> ResourceSession/VFS reads -> live facets.
 * The generic host validates order and confinement but contains no publisher ids or paths.
 */
export async function analyzeResolvedDataWorkspace(
  request: AnalyzeResolvedDataWorkspaceRequest,
): Promise<AnalyzedResolvedDataWorkspace> {
  const limits = {
    maxRequirements: positiveBound(request.limits.maxRequirements, 'maxRequirements'),
    maxDocumentBytes: positiveBound(request.limits.maxDocumentBytes, 'maxDocumentBytes'),
    maxTextBytes: positiveBound(request.limits.maxTextBytes, 'maxTextBytes'),
    maxEntities: positiveBound(request.limits.maxEntities, 'maxEntities'),
    maxDepth: positiveBound(request.limits.maxDepth, 'maxDepth'),
    maxPageSize: positiveBound(request.limits.maxPageSize, 'maxPageSize'),
  }
  if (request.resources.state() !== 'live') {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'warning',
          'x3.host/resolved-data-resource-session-disposed',
          'workspace data requires a live revision-pinned ResourceSessionPort',
        ),
      ],
    }
  }
  const resolution = await resolveResolvedDataWorkspace({
    services: request.services,
    gameId: request.workspace.gameId,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (resolution.state === 'unresolved') return resolution
  const diagnostics: Diagnostic[] = [...resolution.diagnostics]
  const opened: Lease<unknown>[] = []
  try {
    const plan = await planDataWorkspace(
      resolution.workspace,
      {
        workspace: request.workspace,
        locales: request.locales,
        maxRequirements: limits.maxRequirements,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
      request.listFiles,
    )
    validateWorkspacePlan(plan, request.workspace, request.locales, limits.maxRequirements)
    const workspaceRoots = new Map(request.workspace.loadOrder.map(root => [root.rootId, root]))
    const writableRoots = Object.freeze(
      (request.writableRoots ?? []).map(root => {
        const caseSensitive = workspaceRoots.get(root.rootId)?.caseSensitive
        return Object.freeze({ ...root, ...(caseSensitive === undefined ? {} : { caseSensitive }) })
      }),
    )
    const writableRootIds = new Set<string>()
    for (const writable of writableRoots) {
      const workspaceRoot = workspaceRoots.get(writable.rootId)
      if (
        workspaceRoot === undefined ||
        writableRootIds.has(writable.rootId) ||
        !sameLogicalDocument(
          { rootId: writable.rootId, path: writable.sourcePath },
          { rootId: workspaceRoot.rootId, path: workspaceRoot.sourcePath },
        ) ||
        writable.target.expectedRevision.namespaceRevision === undefined
      ) {
        throw new TypeError(`writable root ${writable.rootId} is not this workspace namespace`)
      }
      writableRootIds.add(writable.rootId)
    }
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
        diagnostics: Object.freeze(diagnostics),
      }
    }
    let textBytes = 0
    const documents: DataCatalogDocument[] = []
    const localizationDocuments: DataLocalizationDocument[] = []
    const usageDocuments: DataCatalogDocument[] = []
    const documentTargets: ResolvedDataDocumentTarget[] = []
    const unresolvedRequirementIds: string[] = []
    const revisions: string[] = []
    for (const requirement of plan.requirements) {
      request.signal?.throwIfAborted()
      const loaded = await readResourceText(
        request.resources,
        requirement,
        limits.maxDocumentBytes,
        request.signal,
      )
      if (loaded.state === 'unresolved') {
        if (requirement.required !== false) {
          diagnostics.push(loaded.diagnostic)
          unresolvedRequirementIds.push(requirement.requirementId)
        }
        continue
      }
      // a binary document counts its bytes against the same workspace budget
      textBytes += loaded.bytes?.byteLength ?? new TextEncoder().encode(loaded.text).byteLength
      if (textBytes > limits.maxTextBytes) {
        throw new TypeError(`workspace data exceeds maxTextBytes ${limits.maxTextBytes}`)
      }
      revisions.push(`${requirement.requirementId}@${String(loaded.revision)}`)
      const document = {
        rootId: requirement.rootId,
        path: requirement.path,
        text: loaded.text,
        ...(loaded.bytes === undefined ? {} : { bytes: loaded.bytes }),
        revision: loaded.revision,
      }
      if (requirement.kind === 'catalog') {
        documents.push(document)
        documentTargets.push(
          directDataDocumentTarget(
            requirement.rootId,
            requirement.path,
            loaded.source,
            loaded.revision,
            workspaceRoots.get(requirement.rootId)?.caseSensitive,
          ),
        )
      } else if (requirement.kind === 'usage') usageDocuments.push(document)
      else localizationDocuments.push({ ...document, locale: requirement.locale as string })
    }
    if (documents.length === 0) {
      await resolution.release()
      return {
        state: 'unresolved',
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic(
            'warning',
            'x3.host/resolved-data-catalog-unavailable',
            'no planned catalog document resolved through the resource session',
          ),
        ]),
      }
    }
    if (request.resources.state() !== 'live') {
      throw new Error('resource session was disposed while workspace data was loading')
    }
    const snapshot = await resolution.workspace.analyze({
      workspaceId: request.workspace.workspaceId,
      gameId: request.workspace.gameId,
      documents,
      localizationDocuments,
      ...(usageDocuments.length === 0 ? {} : { usageDocuments }),
      locales: request.locales,
      localizationKeys: request.localizationKeys ?? [],
      queries: request.queries,
      plannedDocumentCount:
        documents.length +
        localizationDocuments.length +
        usageDocuments.length +
        unresolvedRequirementIds.length,
      unresolvedRequirementIds,
      snapshotId: `${String(request.resources.revision)}:${revisions.join('|')}`,
      maxDocuments: limits.maxRequirements,
      maxTextBytes: limits.maxTextBytes,
      maxEntities: limits.maxEntities,
      maxDepth: limits.maxDepth,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (request.resources.state() !== 'live') {
      throw new Error('resource session was disposed while workspace data was analyzed')
    }
    const facetRequest = {
      snapshotId: snapshot.snapshotId,
      maxPageSize: limits.maxPageSize,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }
    const schemaTree = await resolution.workspace.openSchemaTree(facetRequest)
    opened.push(schemaTree)
    const definitions = await resolution.workspace.openDefinitionTable(facetRequest)
    opened.push(definitions)
    const localization = await resolution.workspace.openLocalizationTable(facetRequest)
    opened.push(localization)
    const relations = await resolution.workspace.openRelations(facetRequest)
    opened.push(relations)
    let released = false
    const openSubjectFacts = resolution.workspace.openSubjectFacts
    const openSubjectCalculations = resolution.workspace.openSubjectCalculations
    const resolveEditTarget = resolution.workspace.resolveEditTarget
    const planEdit = resolution.workspace.planEdit
    const analyzeIsolation = resolution.workspace.analyzeIsolation
    const planIsolation = resolution.workspace.planIsolation
    const activeRootId = request.workspace.activeRootId
    const writableRootIdList = Object.freeze([...writableRootIds])
    return Object.freeze({
      state: 'resolved',
      snapshot,
      plan,
      facets: Object.freeze({ schemaTree, definitions, localization, relations }),
      ...(openSubjectFacts === undefined
        ? {}
        : {
            async openSubjectFacts(
              request: ResolvedDataSubjectFactsOpenRequest,
            ): Promise<Lease<SubjectFactsSource>> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const lease = await openSubjectFacts.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
              })
              if (released) {
                await lease.release()
                throw new Error('resolved data workspace analysis was released while opening facts')
              }
              opened.push(lease)
              return lease
            },
          }),
      ...(openSubjectCalculations === undefined
        ? {}
        : {
            async openSubjectCalculations(
              request: ResolvedDataSubjectCalculationsOpenRequest,
            ): Promise<Lease<SubjectCalculationsSource>> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const lease = await openSubjectCalculations.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
              })
              if (released) {
                await lease.release()
                throw new Error(
                  'resolved data workspace analysis was released while opening calculations',
                )
              }
              opened.push(lease)
              return lease
            },
          }),
      ...(resolveEditTarget === undefined
        ? {}
        : {
            async resolveEditTarget(
              request: ResolvedDataEditTargetRequest,
            ): Promise<ResolvedDataEditTargetResult> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await resolveEditTarget.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
                selectedRootId: activeRootId,
                writableRootIds: writableRootIdList,
              })
              if (released) {
                throw new Error(
                  'resolved data workspace analysis was released while resolving an edit target',
                )
              }
              return result.state === 'resolved'
                ? Object.freeze({
                    ...result,
                    writeTarget: bindResolvedDataEditDestination(
                      result,
                      documentTargets,
                      writableRoots,
                    ),
                  })
                : result
            },
          }),
      ...(planEdit === undefined
        ? {}
        : {
            async planEdit(request: ResolvedDataEditPlanRequest): Promise<DataEditPlanResult> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await planEdit.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
                selectedRootId: activeRootId,
                writableRootIds: writableRootIdList,
              })
              if (released) {
                throw new Error(
                  'resolved data workspace analysis was released while planning an edit',
                )
              }
              return result
            },
          }),
      ...(planEdit === undefined
        ? {}
        : {
            async buildEditChange(request: ResolvedDataEditPlanRequest): Promise<ChangeSet> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await planEdit.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
                selectedRootId: activeRootId,
                writableRootIds: writableRootIdList,
              })
              if (released) {
                throw new Error(
                  'resolved data workspace analysis was released while planning an asset edit',
                )
              }
              if ('state' in result) throw dataEditSelectionRequired(result)
              return editChangeFromDataEditProposal(result, documentTargets, writableRoots)
            },
          }),
      ...(analyzeIsolation === undefined
        ? {}
        : {
            async analyzeIsolation(
              request: ResolvedDataGraphIsolationRequest,
            ): Promise<DataGraphIsolationAnalysis> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await analyzeIsolation.call(resolution.workspace, {
                ...request,
                snapshotId: snapshot.snapshotId,
              })
              if (released) {
                throw new Error(
                  'resolved data workspace analysis was released while analyzing isolation',
                )
              }
              return result
            },
          }),
      ...(planIsolation === undefined
        ? {}
        : {
            async planIsolation(
              request: ResolvedDataGraphIsolationPlanRequest,
            ): Promise<ResolvedDataGraphIsolationPlanResult> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await planIsolation.call(resolution.workspace, {
                ...request,
                schemaVersion: 1,
                snapshotId: snapshot.snapshotId,
                selectedRootId: activeRootId,
                writableRootIds: writableRootIdList,
              })
              if (released) throw new Error('resolved data workspace analysis was released while planning isolation')
              return result.state === 'planned'
                ? Object.freeze({
                    ...result,
                    replacements: Object.freeze(
                      result.replacements.map(replacement =>
                        Object.freeze({
                          ...replacement,
                          writeTarget: bindDataDocumentDestination(
                            replacement.target,
                            result.selectedRootId,
                            documentTargets,
                            writableRoots,
                          ),
                        }),
                      ),
                    ),
                  })
                : result
            },
            async buildIsolationChange(
              request: ResolvedDataGraphIsolationPlanRequest,
            ): Promise<ChangeSet> {
              if (released) throw new Error('resolved data workspace analysis is released')
              const result = await planIsolation.call(resolution.workspace, {
                ...request,
                schemaVersion: 1,
                snapshotId: snapshot.snapshotId,
                selectedRootId: activeRootId,
                writableRootIds: writableRootIdList,
              })
              if (released) throw new Error('resolved data workspace analysis was released while planning isolation')
              if (result.state === 'selection-required') throw dataEditSelectionRequired(result)
              if (result.state !== 'planned') throw new TypeError(result.reason)
              return isolationChangeFromDataGraphProposal(result, documentTargets, writableRoots)
            },
          }),
      diagnostics: Object.freeze(diagnostics),
      async release() {
        if (released) return
        released = true
        const results = await Promise.allSettled([
          ...[...opened].reverse().map(lease => lease.release()),
          resolution.release(),
        ])
        const failure = results.find(result => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      },
    })
  } catch (error) {
    await Promise.allSettled([...opened].reverse().map(lease => lease.release()))
    await resolution.release()
    if (request.signal?.aborted) throw error
    return {
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...diagnostics,
        diagnostic(
          'warning',
          'x3.host/resolved-data-workspace-failed',
          error instanceof Error ? error.message : String(error),
        ),
      ]),
    }
  }
}
