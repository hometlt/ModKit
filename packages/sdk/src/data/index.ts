/** Protocol-neutral contracts and deterministic schema-driven catalog resolution. */

import type {
  Lease,
  RelationGraphSource,
  TableDataSource,
  TreeDataSource,
} from '../asset-capabilities/data-sources.js'
import type { JsonValue, RevisionId } from '../asset-capabilities/types.js'
import type { ProjectionPlan, ProjectionReceipt } from '../asset-capabilities/uv-projection.js'
import type { ModWorkspaceLock } from '../mods/index.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for game-specific semantic catalog analysis. */
export const DATA_CATALOG_ANALYSIS_CONTRACT = 'common.data/catalog-analysis' as const

/** Host-owned matcher profile for exact game-id routing. */
export const DATA_CATALOG_MATCHER_PROFILE = 'org.modkitx/data-catalog-matcher' as const

/** Additive workspace/VFS/live-facet contract. catalog-analysis@1 stays byte-compatible. */
export const RESOLVED_DATA_WORKSPACE_CONTRACT = 'common.data/resolved-workspace' as const
export const RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE =
  'org.modkitx/resolved-data-workspace-matcher' as const

export type DataFieldCardinality = 'scalar' | 'append' | 'indexed'

/** One schema field. Nested fields describe structured values without naming them in the core. */
export interface DataSchemaField {
  readonly fieldId: string
  readonly cardinality: DataFieldCardinality
  readonly indexKey?: string
  readonly linkNamespace?: string
  readonly fields?: readonly DataSchemaField[]
}

/** One catalog type and its schema-type inheritance edge. */
export interface DataTypeSchema {
  readonly typeId: string
  readonly parentTypeId?: string
  readonly fields: readonly DataSchemaField[]
}

/** Raw document passed to a selected game provider. Order is base to workspace. */
export interface DataCatalogDocument {
  readonly rootId: string
  readonly path: string
  readonly text: string
  readonly revision?: RevisionId
}

export interface DataLocalizationDocument extends DataCatalogDocument {
  readonly locale: string
}

export type DataWorkspaceDocumentKind = 'catalog' | 'localization'

/** A game provider's confined logical read request. The host resolves it; the provider never does I/O. */
export interface DataWorkspaceDocumentRequirement {
  readonly requirementId: string
  readonly rootId: string
  readonly path: string
  readonly kind: DataWorkspaceDocumentKind
  readonly locale?: string
}

export interface DataWorkspacePlanRequest {
  readonly workspace: ModWorkspaceLock
  /** Preferred locale first, followed by explicit fallbacks. */
  readonly locales: readonly string[]
  readonly maxRequirements: number
  readonly signal?: AbortSignal
}

export interface DataWorkspacePlan {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly analyzerId: string
  readonly requirements: readonly DataWorkspaceDocumentRequirement[]
  readonly diagnostics: readonly DataCatalogDiagnostic[]
  readonly complete: boolean
}

export interface DataEntityRef {
  readonly namespace: string
  readonly entityId: string
}

export interface DataCatalogAnalysisRequest {
  readonly workspaceId: string
  readonly gameId: string
  readonly documents: readonly DataCatalogDocument[]
  readonly localizationDocuments?: readonly DataLocalizationDocument[]
  readonly locales?: readonly string[]
  readonly localizationKeys?: readonly string[]
  readonly snapshotId?: string
  readonly queries: readonly DataEntityRef[]
  readonly maxDocuments: number
  readonly maxTextBytes: number
  readonly maxEntities: number
  readonly maxDepth: number
  readonly signal?: AbortSignal
}

export interface DataEntitySource {
  readonly rootId: string
  readonly path: string
  readonly documentIndex: number
  readonly revision?: RevisionId
}

/** A provider-parsed entity patch. Patches are applied in array order. */
export interface DataEntityPatch {
  readonly namespace: string
  readonly typeId: string
  readonly entityId: string
  readonly parentEntityId?: string
  readonly fields: Readonly<Record<string, JsonValue>>
  readonly source: DataEntitySource
}

export type DataCatalogDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface DataCatalogDiagnostic {
  readonly severity: DataCatalogDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly namespace?: string
  readonly typeId?: string
  readonly entityId?: string
  readonly fieldId?: string
  readonly source?: DataEntitySource
  readonly chain?: readonly DataEntityRef[]
}

export interface DataResolvedEntity {
  readonly namespace: string
  readonly typeId: string
  readonly entityId: string
  readonly parentEntityId?: string
  /** Root parent first and the queried entity last. */
  readonly inheritanceChain: readonly DataEntityRef[]
  readonly fields: Readonly<Record<string, JsonValue>>
  readonly sources: readonly DataEntitySource[]
  readonly complete: boolean
}

export interface DataLocalizationPatch {
  readonly locale: string
  readonly key: string
  readonly value: string
  readonly source: DataEntitySource
}

export interface DataLocalizedString {
  readonly key: string
  readonly requestedLocale: string
  readonly resolvedLocale: string
  readonly value: string
  readonly source: DataEntitySource
  readonly fallback: boolean
}

export interface DataEntityRelation {
  readonly from: DataEntityRef
  readonly to: DataEntityRef
  /** Schema field path that declared the typed link. */
  readonly role: string
  readonly dead: boolean
  readonly source?: DataEntitySource
}

export interface DataNamespaceSummary {
  readonly namespace: string
  readonly entityCount: number
}

export interface DataCatalogSnapshot {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly analyzerId: string
  readonly typeIds: readonly string[]
  readonly schemas?: readonly DataTypeSchema[]
  readonly namespaces: readonly DataNamespaceSummary[]
  readonly entityCount: number
  readonly patchCount: number
  /** Every definition that resolved inside the bounded workspace snapshot. */
  readonly definitions?: readonly DataResolvedEntity[]
  readonly entities: readonly DataResolvedEntity[]
  readonly relations?: readonly DataEntityRelation[]
  readonly localizedStrings?: readonly DataLocalizedString[]
  readonly diagnostics: readonly DataCatalogDiagnostic[]
  /** Stable identity supplied by the provider from workspace/resource revisions. */
  readonly snapshotId?: string
  /** Live definition facets only. This is not a portable UVD artifact claim. */
  readonly projectionPlan?: ProjectionPlan
  readonly projectionReceipt?: ProjectionReceipt
  readonly complete: boolean
}

export interface DataCatalogResolutionInput {
  readonly workspaceId: string
  readonly gameId: string
  readonly analyzerId: string
  readonly schemas: readonly DataTypeSchema[]
  readonly patches: readonly DataEntityPatch[]
  readonly queries: readonly DataEntityRef[]
  readonly localizationPatches?: readonly DataLocalizationPatch[]
  readonly localePreferences?: readonly string[]
  readonly localizationKeys?: readonly string[]
  readonly diagnostics?: readonly DataCatalogDiagnostic[]
  readonly snapshotId?: string
  readonly projectionPlan?: ProjectionPlan
  readonly projectionReceipt?: ProjectionReceipt
  /** Additive resolved-workspace result; false preserves catalog-analysis@1 result behavior. */
  readonly includeWorkspaceFacets?: boolean
  readonly maxEntities: number
  readonly maxDepth: number
}

interface WorkingEntity {
  readonly namespace: string
  readonly entityId: string
  typeId: string
  parentEntityId?: string
  fields: Record<string, JsonValue>
  readonly sources: DataEntitySource[]
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return value
}

function entityKey(namespace: string, entityId: string): string {
  return `${namespace}\u0000${entityId}`
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]))
  }
  return value
}

function immutableJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableJson))
  if (typeof value === 'object' && value !== null) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableJson(item)])),
    )
  }
  return value
}

function immutableSource(value: DataEntitySource): DataEntitySource {
  return Object.freeze({ ...value })
}

function immutableRef(value: DataEntityRef): DataEntityRef {
  return Object.freeze({ ...value })
}

function immutableDiagnostic(value: DataCatalogDiagnostic): DataCatalogDiagnostic {
  return Object.freeze({
    ...value,
    ...(value.source === undefined ? {} : { source: immutableSource(value.source) }),
    ...(value.chain === undefined ? {} : { chain: Object.freeze(value.chain.map(immutableRef)) }),
  })
}

function immutableSchema(value: DataTypeSchema): DataTypeSchema {
  const immutableField = (field: DataSchemaField): DataSchemaField =>
    Object.freeze({
      ...field,
      ...(field.fields === undefined
        ? {}
        : { fields: Object.freeze(field.fields.map(immutableField)) }),
    })
  return Object.freeze({ ...value, fields: Object.freeze(value.fields.map(immutableField)) })
}

function recordOf(value: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined
}

function mergeAppend(previous: JsonValue | undefined, incoming: JsonValue): JsonValue {
  const left = Array.isArray(previous) ? previous : previous === undefined ? [] : [previous]
  const right = Array.isArray(incoming) ? incoming : [incoming]
  return [...left.map(cloneJson), ...right.map(cloneJson)]
}

function indexedKey(value: JsonValue, indexKey: string): string | undefined {
  const record = recordOf(value)
  const index = record?.[indexKey]
  return typeof index === 'string' || typeof index === 'number' ? String(index) : undefined
}

function isRemoved(value: JsonValue): boolean {
  const removed = recordOf(value)?.['removed']
  return removed === true || removed === 1 || removed === '1'
}

function mergeIndexed(
  previous: JsonValue | undefined,
  incoming: JsonValue,
  indexKey: string,
): JsonValue {
  const result = Array.isArray(previous) ? previous.map(cloneJson) : []
  const additions = Array.isArray(incoming) ? incoming : [incoming]
  for (const item of additions) {
    const key = indexedKey(item, indexKey)
    if (key === undefined) continue
    const found = result.findIndex(candidate => indexedKey(candidate, indexKey) === key)
    if (isRemoved(item)) {
      if (found !== -1) result.splice(found, 1)
    } else if (found === -1) {
      result.push(cloneJson(item))
    } else {
      result[found] = cloneJson(item)
    }
  }
  return result
}

function schemaFields(
  schema: DataTypeSchema,
  schemas: ReadonlyMap<string, DataTypeSchema>,
  diagnostics: DataCatalogDiagnostic[],
  visiting: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, DataSchemaField> {
  if (visiting.has(schema.typeId)) {
    diagnostics.push({
      severity: 'error',
      code: 'common.data/schema-inheritance-cycle',
      message: `schema inheritance cycle includes ${schema.typeId}`,
      typeId: schema.typeId,
    })
    return new Map()
  }
  const fields = new Map<string, DataSchemaField>()
  if (schema.parentTypeId !== undefined) {
    const parent = schemas.get(schema.parentTypeId)
    if (parent === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/schema-parent-unavailable',
        message: `${schema.typeId} names unavailable schema parent ${schema.parentTypeId}`,
        typeId: schema.typeId,
      })
    } else {
      const next = new Set(visiting)
      next.add(schema.typeId)
      for (const [fieldId, field] of schemaFields(parent, schemas, diagnostics, next)) {
        fields.set(fieldId, field)
      }
    }
  }
  for (const field of schema.fields) fields.set(field.fieldId, field)
  return fields
}

function mergeFields(
  base: Readonly<Record<string, JsonValue>>,
  patch: Readonly<Record<string, JsonValue>>,
  fields: ReadonlyMap<string, DataSchemaField>,
): Record<string, JsonValue> {
  const merged = Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, cloneJson(value)]),
  )
  for (const [fieldId, incoming] of Object.entries(patch)) {
    const field = fields.get(fieldId)
    if (field === undefined) continue
    if (field.cardinality === 'append') {
      merged[fieldId] = mergeAppend(merged[fieldId], incoming)
    } else if (field.cardinality === 'indexed') {
      merged[fieldId] = mergeIndexed(merged[fieldId], incoming, field.indexKey ?? 'index')
    } else {
      merged[fieldId] = cloneJson(incoming)
    }
  }
  return merged
}

function relationScalarValues(value: JsonValue): readonly string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(relationScalarValues)
  const record = recordOf(value)
  if (record === undefined) return []
  return record['value'] === undefined ? [] : relationScalarValues(record['value'])
}

function visitRelationField(
  value: JsonValue,
  field: DataSchemaField,
  path: string,
  visit: (namespace: string, entityId: string, role: string) => void,
): void {
  if (field.linkNamespace !== undefined && field.linkNamespace !== '') {
    for (const entityId of relationScalarValues(value)) {
      if (entityId.length > 0) visit(field.linkNamespace, entityId, path)
    }
  }
  if (field.fields === undefined) return
  const values = Array.isArray(value) ? value : [value]
  for (const item of values) {
    const record = recordOf(item)
    if (record === undefined) continue
    const wrapped = record['value']
    const nested = wrapped === undefined ? record : (recordOf(wrapped) ?? record)
    for (const child of field.fields) {
      const childValue = nested[child.fieldId]
      if (childValue === undefined) continue
      visitRelationField(childValue, child, `${path}.${child.fieldId}`, visit)
    }
  }
}

/**
 * Resolve already-parsed catalog patches without knowing any game's types or field names.
 * Providers own parsing and schemas; this algorithm owns bounded deterministic merge/inheritance.
 */
export function resolveDataCatalog(input: DataCatalogResolutionInput): DataCatalogSnapshot {
  const maxEntities = positiveLimit(input.maxEntities, 'maxEntities')
  const maxDepth = positiveLimit(input.maxDepth, 'maxDepth')
  if (input.patches.length > maxEntities) {
    throw new TypeError(`patches exceeds maxEntities (${input.patches.length} > ${maxEntities})`)
  }

  const extended = input.includeWorkspaceFacets === true
  const diagnostics: DataCatalogDiagnostic[] = [...(extended ? (input.diagnostics ?? []) : [])]
  const schemas = new Map<string, DataTypeSchema>()
  for (const schema of input.schemas) {
    if (schemas.has(schema.typeId)) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/schema-type-duplicate',
        message: `catalog schema type is duplicated: ${schema.typeId}`,
        typeId: schema.typeId,
      })
    } else {
      schemas.set(schema.typeId, schema)
    }
  }
  const fieldsByType = new Map<string, ReadonlyMap<string, DataSchemaField>>()
  for (const schema of schemas.values()) {
    fieldsByType.set(schema.typeId, schemaFields(schema, schemas, diagnostics))
  }

  const entities = new Map<string, WorkingEntity>()
  const unknownFields = new Set<string>()
  for (const patch of input.patches) {
    const typeFields = fieldsByType.get(patch.typeId)
    if (typeFields === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'common.data/schema-type-unsupported',
        message: `no catalog schema is available for ${patch.typeId}`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        source: patch.source,
      })
      continue
    }
    const key = entityKey(patch.namespace, patch.entityId)
    let current = entities.get(key)
    if (current === undefined) {
      current = {
        namespace: patch.namespace,
        entityId: patch.entityId,
        typeId: patch.typeId,
        ...(patch.parentEntityId === undefined ? {} : { parentEntityId: patch.parentEntityId }),
        fields: {},
        sources: [],
      }
      entities.set(key, current)
    } else if (current.typeId !== patch.typeId) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/entity-type-conflict',
        message: `${patch.namespace}/${patch.entityId} changes type from ${current.typeId} to ${patch.typeId}`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        source: patch.source,
      })
      continue
    }
    if (patch.parentEntityId !== undefined) current.parentEntityId = patch.parentEntityId
    current.sources.push(patch.source)
    for (const fieldId of Object.keys(patch.fields)) {
      if (typeFields.has(fieldId)) continue
      const diagnosticKey = `${patch.typeId}\u0000${fieldId}`
      if (unknownFields.has(diagnosticKey)) continue
      unknownFields.add(diagnosticKey)
      diagnostics.push({
        severity: 'information',
        code: 'common.data/schema-field-unsupported',
        message: `${patch.typeId}.${fieldId} is outside the active schema slice`,
        namespace: patch.namespace,
        typeId: patch.typeId,
        entityId: patch.entityId,
        fieldId,
        source: patch.source,
      })
    }
    current.fields = mergeFields(current.fields, patch.fields, typeFields)
  }

  const resolvedCache = new Map<string, DataResolvedEntity>()
  const resolveEntity = (
    ref: DataEntityRef,
    depth: number,
    path: readonly DataEntityRef[],
  ): DataResolvedEntity | undefined => {
    const key = entityKey(ref.namespace, ref.entityId)
    const cached = resolvedCache.get(key)
    if (cached !== undefined) return cached
    const current = entities.get(key)
    if (current === undefined) return undefined
    if (depth > maxDepth) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/entity-inheritance-depth-exceeded',
        message: `${ref.namespace}/${ref.entityId} exceeds inheritance depth ${maxDepth}`,
        namespace: ref.namespace,
        typeId: current.typeId,
        entityId: ref.entityId,
        chain: [...path, ref],
      })
      return undefined
    }
    const cycleAt = path.findIndex(item => entityKey(item.namespace, item.entityId) === key)
    if (cycleAt !== -1) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/entity-inheritance-cycle',
        message: `entity inheritance cycle includes ${ref.namespace}/${ref.entityId}`,
        namespace: ref.namespace,
        typeId: current.typeId,
        entityId: ref.entityId,
        chain: [...path.slice(cycleAt), ref],
      })
      return undefined
    }

    let complete = true
    let fields: Record<string, JsonValue> = {}
    let inheritanceChain: DataEntityRef[] = []
    let sources: DataEntitySource[] = []
    if (current.parentEntityId !== undefined) {
      const parentRef = { namespace: current.namespace, entityId: current.parentEntityId }
      const parent = resolveEntity(parentRef, depth + 1, [...path, ref])
      if (parent === undefined) {
        complete = false
        diagnostics.push({
          severity: 'error',
          code: 'common.data/entity-parent-unavailable',
          message: `${current.namespace}/${current.entityId} names unavailable parent ${current.parentEntityId}`,
          namespace: current.namespace,
          typeId: current.typeId,
          entityId: current.entityId,
          chain: [...path, ref, parentRef],
        })
      } else {
        complete = parent.complete
        fields = Object.fromEntries(
          Object.entries(parent.fields).map(([fieldId, value]) => [fieldId, cloneJson(value)]),
        )
        inheritanceChain = [...parent.inheritanceChain]
        sources = [...parent.sources]
      }
    }
    fields = mergeFields(fields, current.fields, fieldsByType.get(current.typeId) ?? new Map())
    inheritanceChain.push(ref)
    sources.push(...current.sources)
    const resolved: DataResolvedEntity = Object.freeze({
      namespace: current.namespace,
      typeId: current.typeId,
      entityId: current.entityId,
      ...(current.parentEntityId === undefined ? {} : { parentEntityId: current.parentEntityId }),
      inheritanceChain: Object.freeze(inheritanceChain.map(immutableRef)),
      fields: Object.freeze(
        Object.fromEntries(
          Object.entries(fields).map(([fieldId, value]) => [fieldId, immutableJson(value)]),
        ),
      ),
      sources: Object.freeze(sources.map(immutableSource)),
      complete,
    })
    resolvedCache.set(key, resolved)
    return resolved
  }

  const definitions: DataResolvedEntity[] = []
  if (extended) {
    for (const current of entities.values()) {
      const entity = resolveEntity(
        { namespace: current.namespace, entityId: current.entityId },
        0,
        [],
      )
      if (entity !== undefined) definitions.push(entity)
    }
    definitions.sort(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.entityId.localeCompare(right.entityId),
    )
  }

  const results: DataResolvedEntity[] = []
  for (const query of input.queries) {
    const entity = resolveEntity(query, 0, [])
    if (entity === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/entity-query-unresolved',
        message: `catalog query did not resolve ${query.namespace}/${query.entityId}`,
        namespace: query.namespace,
        entityId: query.entityId,
      })
    } else {
      results.push(entity)
    }
  }

  const resolvedKeys = new Set(definitions.map(item => entityKey(item.namespace, item.entityId)))
  const relationKeys = new Set<string>()
  const relations: DataEntityRelation[] = []
  for (const entity of extended ? definitions : []) {
    const fields = fieldsByType.get(entity.typeId) ?? new Map()
    for (const [fieldId, value] of Object.entries(entity.fields)) {
      const field = fields.get(fieldId)
      if (field === undefined) continue
      visitRelationField(value, field, fieldId, (namespace, entityId, role) => {
        const key = `${entity.namespace}\u0000${entity.entityId}\u0000${namespace}\u0000${entityId}\u0000${role}`
        if (relationKeys.has(key)) return
        relationKeys.add(key)
        const dead = !resolvedKeys.has(entityKey(namespace, entityId))
        const relation = Object.freeze({
          from: immutableRef({ namespace: entity.namespace, entityId: entity.entityId }),
          to: immutableRef({ namespace, entityId }),
          role,
          dead,
          ...(entity.sources.at(-1) === undefined
            ? {}
            : { source: immutableSource(entity.sources.at(-1) as DataEntitySource) }),
        })
        relations.push(relation)
        if (dead) {
          diagnostics.push({
            severity: 'warning',
            code: 'common.data/relation-target-unavailable',
            message: `${entity.namespace}/${entity.entityId} ${role} names unavailable ${namespace}/${entityId}`,
            namespace: entity.namespace,
            typeId: entity.typeId,
            entityId: entity.entityId,
            fieldId: role,
            ...(relation.source === undefined ? {} : { source: relation.source }),
          })
        }
      })
    }
  }
  relations.sort(
    (left, right) =>
      left.from.namespace.localeCompare(right.from.namespace) ||
      left.from.entityId.localeCompare(right.from.entityId) ||
      left.role.localeCompare(right.role) ||
      left.to.namespace.localeCompare(right.to.namespace) ||
      left.to.entityId.localeCompare(right.to.entityId),
  )

  const localizationPatches = extended ? (input.localizationPatches ?? []) : []
  const localePreferences = input.localePreferences ?? []
  const localizedByLocale = new Map<string, Map<string, DataLocalizationPatch>>()
  for (const patch of localizationPatches) {
    let entries = localizedByLocale.get(patch.locale)
    if (entries === undefined) {
      entries = new Map()
      localizedByLocale.set(patch.locale, entries)
    }
    // Providers submit winner-first patches; the first exact locale/key owns the value.
    if (!entries.has(patch.key)) entries.set(patch.key, patch)
  }
  const requestedLocales =
    localePreferences.length > 0 ? localePreferences : [...localizedByLocale.keys()]
  const localizedStrings: DataLocalizedString[] = []
  for (const key of [...new Set(extended ? (input.localizationKeys ?? []) : [])].sort()) {
    let found: DataLocalizationPatch | undefined
    let resolvedLocale: string | undefined
    for (const locale of requestedLocales) {
      const candidate = localizedByLocale.get(locale)?.get(key)
      if (candidate === undefined) continue
      found = candidate
      resolvedLocale = locale
      break
    }
    if (found === undefined || resolvedLocale === undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'common.data/localization-key-unavailable',
        message: `no requested locale resolves localization key ${key}`,
        fieldId: key,
      })
      continue
    }
    const requestedLocale = requestedLocales[0] ?? resolvedLocale
    localizedStrings.push(
      Object.freeze({
        key,
        requestedLocale,
        resolvedLocale,
        value: found.value,
        source: immutableSource(found.source),
        fallback: resolvedLocale !== requestedLocale,
      }),
    )
    if (resolvedLocale !== requestedLocale) {
      diagnostics.push({
        severity: 'information',
        code: 'common.data/localization-fallback',
        message: `${key} fell back from ${requestedLocale} to ${resolvedLocale}`,
        fieldId: key,
        source: found.source,
      })
    }
  }

  const namespaceCounts = new Map<string, number>()
  for (const entity of entities.values()) {
    namespaceCounts.set(entity.namespace, (namespaceCounts.get(entity.namespace) ?? 0) + 1)
  }
  const immutableDiagnostics = Object.freeze(diagnostics.map(immutableDiagnostic))
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    gameId: input.gameId,
    analyzerId: input.analyzerId,
    typeIds: Object.freeze([...schemas.keys()].sort()),
    namespaces: Object.freeze(
      [...namespaceCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([namespace, entityCount]) => Object.freeze({ namespace, entityCount })),
    ),
    entityCount: entities.size,
    patchCount: input.patches.length,
    entities: Object.freeze(results),
    diagnostics: immutableDiagnostics,
    ...(extended
      ? {
          schemas: Object.freeze(input.schemas.map(immutableSchema)),
          definitions: Object.freeze(definitions),
          relations: Object.freeze(relations),
          localizedStrings: Object.freeze(localizedStrings),
          snapshotId:
            input.snapshotId ??
            `${input.gameId}:${input.workspaceId}:${input.patches.length}:${localizationPatches.length}`,
          ...(input.projectionPlan === undefined ? {} : { projectionPlan: input.projectionPlan }),
          ...(input.projectionReceipt === undefined
            ? {}
            : { projectionReceipt: input.projectionReceipt }),
        }
      : {}),
    complete:
      immutableDiagnostics.every(item => item.severity !== 'error') &&
      results.every(item => item.complete),
  })
}

/** Activated game-specific catalog analyzer. */
export interface DataCatalogAnalysis {
  readonly contract: typeof DATA_CATALOG_ANALYSIS_CONTRACT
  readonly analyzerId: string
  readonly gameIds: readonly string[]
  analyze(request: DataCatalogAnalysisRequest): Promise<DataCatalogSnapshot>
}

export interface DataFacetOpenRequest {
  readonly snapshotId: string
  readonly maxPageSize: number
  readonly signal?: AbortSignal
}

/** Resource-plan accounting required by the additive workspace contract. */
export interface ResolvedDataWorkspaceAnalysisRequest extends DataCatalogAnalysisRequest {
  readonly plannedDocumentCount: number
  readonly unresolvedRequirementIds: readonly string[]
}

export interface ResolvedDataWorkspaceSnapshot extends DataCatalogSnapshot {
  readonly definitions: readonly DataResolvedEntity[]
  readonly relations: readonly DataEntityRelation[]
  readonly localizedStrings: readonly DataLocalizedString[]
  readonly snapshotId: string
  readonly projectionPlan: ProjectionPlan
  readonly projectionReceipt: ProjectionReceipt
}

/** Workspace-aware live native definitions. It is deliberately separate from legacy v1 analysis. */
export interface ResolvedDataWorkspace {
  readonly contract: typeof RESOLVED_DATA_WORKSPACE_CONTRACT
  readonly providerId: string
  readonly gameIds: readonly string[]
  plan(request: DataWorkspacePlanRequest): Promise<DataWorkspacePlan>
  analyze(request: ResolvedDataWorkspaceAnalysisRequest): Promise<ResolvedDataWorkspaceSnapshot>
  openSchemaTree(request: DataFacetOpenRequest): Promise<Lease<TreeDataSource>>
  openDefinitionTable(request: DataFacetOpenRequest): Promise<Lease<TableDataSource>>
  openLocalizationTable(request: DataFacetOpenRequest): Promise<Lease<TableDataSource>>
  openRelations(request: DataFacetOpenRequest): Promise<Lease<RelationGraphSource>>
}

/** JSON-safe route advertised by a data contribution. */
export interface DataCatalogOfferFacet {
  readonly gameIds: readonly string[]
}

/** JSON-safe route supplied by a consumer selecting one named game. */
export interface DataCatalogRequestFacet {
  readonly gameId: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.data/catalog-analysis': { 1: DataCatalogAnalysis }
    'common.data/resolved-workspace': { 1: ResolvedDataWorkspace }
  }

  interface ContractRequestMap {
    'common.data/catalog-analysis': {
      1: { presence: 'required'; facet: DataCatalogRequestFacet }
    }
    'common.data/resolved-workspace': {
      1: { presence: 'required'; facet: DataCatalogRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.data/catalog-analysis': {
      1: { presence: 'required'; facet: DataCatalogOfferFacet }
    }
    'common.data/resolved-workspace': {
      1: { presence: 'required'; facet: DataCatalogOfferFacet }
    }
  }
}

export type DataCatalogProviderModule = ServiceProviderModule<
  typeof DATA_CATALOG_ANALYSIS_CONTRACT,
  1
>

export type ResolvedDataWorkspaceProviderModule = ServiceProviderModule<
  typeof RESOLVED_DATA_WORKSPACE_CONTRACT,
  1
>
