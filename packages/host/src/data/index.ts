/** Host definition, exact game-id matcher and activation adapter for semantic catalogs. */

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  DATA_CATALOG_ANALYSIS_CONTRACT,
  DATA_CATALOG_MATCHER_PROFILE,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE,
  type DataCatalogAnalysis,
  type DataCatalogDocument,
  type DataCatalogOfferFacet,
  type DataCatalogRequestFacet,
  type DataEntityRef,
  type DataSubjectFactsOpenRequest,
  type DataSubjectCalculationsOpenRequest,
  type DataLocalizationDocument,
  type DataWorkspaceDocumentRequirement,
  type DataWorkspacePlan,
  type ResolvedDataWorkspace,
  type ResolvedDataWorkspaceSnapshot,
} from '@modkit/sdk/data'
import type {
  DefinitionInventoryResult,
  Lease,
  ModWorkspaceLock,
  Page,
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
  SubjectSelectorSource,
  TableDataSource,
  TreeDataSource,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard catalog-analysis definition is registered. */
export const STANDARD_DATA_OWNER = 'modkit/data'

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
    typeof record['openRelations'] === 'function'
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
  readonly signal?: AbortSignal
}

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
  const limits = Object.freeze({
    maxPageSize: positiveBound(inputLimits.maxPageSize, 'maxPageSize'),
    maxEntities: positiveBound(inputLimits.maxEntities, 'maxEntities'),
    maxRelations: positiveBound(inputLimits.maxRelations, 'maxRelations'),
    maxCalculations: positiveBound(inputLimits.maxCalculations, 'maxCalculations'),
  })
  const snapshot = analyzed.snapshot
  const localized = new Map(snapshot.localizedStrings.map(item => [item.key, item.value]))
  const subjects = Object.freeze(
    snapshot.definitions
      .map(entity => {
        const authoredName = entity.fields['Name']
        const label =
          typeof authoredName === 'string'
            ? (localized.get(authoredName) ?? entity.entityId)
            : entity.entityId
        return Object.freeze({
          subjectId: `${entity.namespace}/${entity.entityId}`,
          label,
          kind: entity.namespace,
          type: entity.typeId,
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
    const filtered = subjects.filter(
      subject =>
        (request.kind === undefined || subject.kind === request.kind) &&
        (request.type === undefined || subject.type === request.type) &&
        (text === undefined ||
          text.length === 0 ||
          subject.subjectId.toLocaleLowerCase('en-US').includes(text) ||
          subject.label.toLocaleLowerCase('en-US').includes(text)),
    )
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
    async openFacts(subjectId: string, signal?: AbortSignal) {
      const subject = selected(subjectId, signal)
      return openSubjectFacts({
        subject: {
          namespace: subject.kind,
          entityId: subject.subjectId.slice(subject.kind.length + 1),
        },
        ...limits,
        ...(signal === undefined ? {} : { signal }),
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
    if (requirementIds.has(requirement.requirementId)) {
      throw new TypeError(`workspace data requirement ${requirement.requirementId} is duplicated`)
    }
    requirementIds.add(requirement.requirementId)
    const root = roots.get(requirement.rootId)
    if (root === undefined) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} names unknown root`,
      )
    }
    const rootPath = confinedPath(root.root.sourcePath, `${requirement.requirementId}.root`)
    const path = confinedPath(requirement.path, `${requirement.requirementId}.path`)
    const foldedRoot = rootPath.toLocaleLowerCase()
    const foldedPath = path.toLocaleLowerCase()
    if (foldedPath !== foldedRoot && !foldedPath.startsWith(`${foldedRoot}/`)) {
      throw new TypeError(
        `workspace data requirement ${requirement.requirementId} escapes its root`,
      )
    }
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

async function readResourceText(
  resources: ResourceSessionPort,
  requirement: DataWorkspaceDocumentRequirement,
  maxDocumentBytes: number,
  signal?: AbortSignal,
): Promise<
  | { readonly state: 'resolved'; readonly text: string; readonly revision: RevisionId }
  | { readonly state: 'unresolved'; readonly diagnostic: Diagnostic }
> {
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
    const content = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      content.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {
      state: 'resolved',
      text: new TextDecoder('utf-8', { fatal: false }).decode(content),
      revision: resolved.revision,
    }
  } finally {
    await resolved.lease.release()
  }
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
    const plan = await resolution.workspace.plan({
      workspace: request.workspace,
      locales: request.locales,
      maxRequirements: limits.maxRequirements,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    validateWorkspacePlan(plan, request.workspace, request.locales, limits.maxRequirements)
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
      textBytes += new TextEncoder().encode(loaded.text).byteLength
      if (textBytes > limits.maxTextBytes) {
        throw new TypeError(`workspace data exceeds maxTextBytes ${limits.maxTextBytes}`)
      }
      revisions.push(`${requirement.requirementId}@${String(loaded.revision)}`)
      const document = {
        rootId: requirement.rootId,
        path: requirement.path,
        text: loaded.text,
        revision: loaded.revision,
      }
      if (requirement.kind === 'catalog') documents.push(document)
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
      locales: request.locales,
      localizationKeys: request.localizationKeys ?? [],
      queries: request.queries,
      plannedDocumentCount:
        documents.length + localizationDocuments.length + unresolvedRequirementIds.length,
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
