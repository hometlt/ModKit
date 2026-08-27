/** Host definition, exact game-id matcher and activation adapter for semantic maps. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  type CandidateWorldSceneSource,
  type MapSemanticDocument,
  type MapSemanticDocumentRequirement,
  type MapSemanticAnalysis,
  type MapSemanticOfferFacet,
  type MapSemanticRequestFacet,
  type ResolvedMapWorkspaceAnalysis,
  type ResolvedMapWorkspacePlan,
  type ResolvedMapWorkspaceSnapshot,
} from '@modkitx-x3/sdk/maps'
import type {
  DataCatalogSnapshot,
  DefinitionInventoryResult,
  Lease,
  ModWorkspaceLock,
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
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'
import { createCandidateWorldSceneLease } from './world-source.js'

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

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardMapDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const registered = [MAP_SEMANTIC_CONTRACT_DEFINITION, RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION]
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
