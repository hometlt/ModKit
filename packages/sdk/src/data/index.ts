/** Protocol-neutral contracts and deterministic schema-driven catalog resolution. */

import type {
  Lease,
  RelationGraphSource,
  SubjectCalculationsSource,
  SubjectFactsSource,
  TableDataSource,
  TreeDataSource,
} from '../asset-capabilities/data-sources.js'
import type { JsonValue, RevisionId } from '../asset-capabilities/types.js'
import type { FieldType } from '../fields/index.js'
import type { ProjectionPlan, ProjectionReceipt } from '../asset-capabilities/uv-projection.js'
import type { ModWorkspaceLock } from '../mods/index.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for game-specific semantic catalog analysis. */
export const DATA_CATALOG_ANALYSIS_CONTRACT = 'common.data/catalog-analysis' as const

/** Host-owned matcher profile for exact game-id routing. */
export const DATA_CATALOG_MATCHER_PROFILE = 'modkit/data-catalog-matcher' as const

/** Additive workspace/VFS/live-facet contract. catalog-analysis@1 stays byte-compatible. */
export const RESOLVED_DATA_WORKSPACE_CONTRACT = 'common.data/resolved-workspace' as const
export const RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE =
  'modkit/resolved-data-workspace-matcher' as const

/** Bounded language-authoring projection produced by the selected resolved-data owner. */
export const RESOLVED_DATA_AUTHORING_INDEX_KIND = 'resolved-data-authoring-index' as const

export type DataFieldCardinality = 'scalar' | 'append' | 'indexed'

/** One schema field. Nested fields describe structured values without naming them in the core. */
export interface DataSchemaField {
  readonly fieldId: string
  readonly cardinality: DataFieldCardinality
  /** Portable semantic type used by generic editors, selectors and relation projection. */
  readonly type?: FieldType
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
  /** Missing optional catalog/localization files are normal and do not make the snapshot partial. */
  readonly required?: boolean
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
  /** Provider-owned class-default marker; it is metadata, not an inherited field. */
  readonly defaultTemplate?: boolean
  /** Entity token declarations. Later declarations win by id and children inherit them. */
  readonly tokens?: readonly DataEntityToken[]
  readonly fields: Readonly<Record<string, JsonValue>>
  readonly source: DataEntitySource
}

export interface DataEntityToken {
  readonly id: string
  readonly type?: string
  readonly value?: string
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
  readonly defaultTemplate?: boolean
  /** Parent declarations first, with later/current declarations winning by token id. */
  readonly tokens?: readonly DataEntityToken[]
  /** Root parent first and the queried entity last. */
  readonly inheritanceChain: readonly DataEntityRef[]
  readonly fields: Readonly<Record<string, JsonValue>>
  /** Winning source for each resolved top-level field, including inherited fields when requested. */
  readonly fieldSources?: Readonly<Record<string, DataEntitySource>>
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
  /** Optional bounded game-owner metadata; core never assigns game-specific meaning to its keys. */
  readonly ownerMetadata?: JsonValue
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
  readonly ownerMetadata?: JsonValue
  readonly snapshotId?: string
  readonly projectionPlan?: ProjectionPlan
  readonly projectionReceipt?: ProjectionReceipt
  /** Additive resolved-workspace result; false preserves catalog-analysis@1 result behavior. */
  readonly includeWorkspaceFacets?: boolean
  /** Additive provenance for consumers that resolve field-owned assets against workspace roots. */
  readonly includeFieldSources?: boolean
  readonly maxEntities: number
  readonly maxDepth: number
}

/** One top-level value changed by an entity relative to its parent chain. */
export interface DataAuthoringFieldDelta {
  readonly fieldId: string
  readonly value: JsonValue
  /** Index into {@link ResolvedDataAuthoringIndex.sourceTable}. */
  readonly source: number
  /** Entity whose declaration owns this value; defaults may materialize it on a child row. */
  readonly originEntityId: string
  /** Exact winning origin for each leaf path relative to this top-level field. */
  readonly origins?: readonly DataAuthoringValueOrigin[]
}

export interface DataAuthoringValueOrigin {
  /** Empty for a scalar leaf; indexed selectors and nested field ids form deeper paths. */
  readonly path: readonly string[]
  /** Index into {@link ResolvedDataAuthoringIndex.sourceTable}. */
  readonly source: number
  readonly originEntityId: string
}

/** An explicit indexed removal retained even after its effective value has been merged. */
export interface DataAuthoringUnsetTombstone {
  /** Schema path, with indexed selectors following their owning field. */
  readonly path: readonly string[]
  /** Index into {@link ResolvedDataAuthoringIndex.sourceTable}. */
  readonly source: number
}

/** Compact entity identity and its parent-relative authoring values. */
export interface DataAuthoringIndexEntity {
  readonly identity: string
  readonly namespace: string
  readonly typeId: string
  readonly entityId: string
  readonly parentEntityId?: string
  readonly defaultTemplate?: boolean
  /** Effective inherited token declarations, winner per id. */
  readonly tokens?: readonly DataEntityToken[]
  /** Winning declaration source, indexed into the shared source table. */
  readonly source: number
  readonly complete: boolean
  /** Omitted only when the output byte budget could not carry any values safely. */
  readonly fields?: readonly DataAuthoringFieldDelta[]
  /** Omitted with fields on byte-budget overflow. */
  readonly tombstones?: readonly DataAuthoringUnsetTombstone[]
}

export interface DataAuthoringDiagnosticSummaryItem {
  readonly severity: DataCatalogDiagnosticSeverity
  readonly code: string
  readonly message: string
}

export interface DataAuthoringDiagnosticSummary {
  readonly errorCount: number
  readonly warningCount: number
  readonly informationCount: number
  readonly items: readonly DataAuthoringDiagnosticSummaryItem[]
  readonly truncated: boolean
}

/**
 * Compact resolved-data projection for language features.
 *
 * Values are stored only on the entity that touched them. Each value is already merged against
 * the closest parent value with the canonical schema rules, so consumers only walk the parent
 * graph and never reimplement catalog merging.
 */
export interface ResolvedDataAuthoringIndex {
  readonly schemaVersion: 1
  readonly kind: typeof RESOLVED_DATA_AUTHORING_INDEX_KIND
  readonly workspaceId: string
  readonly gameId: string
  readonly analyzerId: string
  readonly snapshotId: string
  readonly sourceTable: readonly DataEntitySource[]
  readonly namespaces: readonly DataNamespaceSummary[]
  readonly entityCount: number
  readonly patchCount: number
  readonly entities: readonly DataAuthoringIndexEntity[]
  readonly diagnostics: DataAuthoringDiagnosticSummary
  /** Optional bounded game-owner metadata shared with the full resolved snapshot. */
  readonly ownerMetadata?: JsonValue
  readonly complete: boolean
  /** False means all identity/source rows are present but value/tombstone arrays were omitted. */
  readonly valuesComplete: boolean
}

export interface DataAuthoringIndexResolutionInput {
  readonly workspaceId: string
  readonly gameId: string
  readonly analyzerId: string
  readonly snapshotId: string
  readonly schemas: readonly DataTypeSchema[]
  readonly patches: readonly DataEntityPatch[]
  /** Provider-owned lowest-precedence fields, one optional synthetic patch per entity. */
  readonly basePatches?: readonly DataEntityPatch[]
  /** Provider-owned lowest-layer projection (for example SC2 structure defaults). */
  readonly applyDefaults?: (
    namespace: string,
    typeId: string,
    entityId: string,
    fields: Readonly<Record<string, JsonValue>>,
  ) => Readonly<Record<string, JsonValue>>
  readonly diagnostics?: readonly DataCatalogDiagnostic[]
  readonly ownerMetadata?: JsonValue
  readonly complete?: boolean
  readonly maxEntities: number
  readonly maxDepth: number
  readonly maxOutputBytes: number
}

interface WorkingEntity {
  readonly namespace: string
  readonly entityId: string
  typeId: string
  parentEntityId?: string
  defaultTemplate: boolean
  readonly tokens: Map<string, DataEntityToken>
  fields: Record<string, JsonValue>
  readonly fieldSources: Record<string, DataEntitySource>
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
      ...(field.type === undefined
        ? {}
        : { type: immutableJson(field.type as unknown as JsonValue) as FieldType }),
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

function indexedKey(value: JsonValue, indexKey: string): string | undefined {
  const record = recordOf(value)
  const index = record?.[indexKey]
  return typeof index === 'string' || typeof index === 'number' ? String(index) : undefined
}

function isRemoved(value: JsonValue): boolean {
  const removed = recordOf(value)?.['removed']
  return removed === true || removed === 1 || removed === '1'
}

interface AuthoringOriginTracker {
  readonly origins: Map<string, DataAuthoringValueOrigin>
  originForPath(
    path: readonly string[],
  ): Pick<DataAuthoringValueOrigin, 'source' | 'originEntityId'>
}

const authoringOriginKey = (path: readonly string[]): string => JSON.stringify(path)

const authoringPathStartsWith = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((part, index) => path[index] === part)

function clearAuthoringOrigins(tracker: AuthoringOriginTracker, path: readonly string[]): void {
  for (const [key, origin] of tracker.origins) {
    if (authoringPathStartsWith(origin.path, path)) tracker.origins.delete(key)
  }
}

function setAuthoringOrigin(tracker: AuthoringOriginTracker, path: readonly string[]): void {
  const origin = tracker.originForPath(path)
  const immutablePath = Object.freeze([...path])
  tracker.origins.set(
    authoringOriginKey(path),
    Object.freeze({
      path: immutablePath,
      source: origin.source,
      originEntityId: origin.originEntityId,
    }),
  )
}

function visitStructuredOriginPaths(
  value: JsonValue,
  nestedFields: readonly DataSchemaField[] | undefined,
  path: readonly string[],
  visit: (path: readonly string[]) => void,
  ignoredKeys: ReadonlySet<string> = new Set(),
): void {
  const record = recordOf(value)
  if (record !== undefined) {
    const nested = new Map((nestedFields ?? []).map(field => [field.fieldId, field]))
    let visited = false
    for (const [key, childValue] of Object.entries(record)) {
      if (ignoredKeys.has(key)) continue
      visited = true
      const child = nested.get(key)
      if (child === undefined) {
        visitStructuredOriginPaths(childValue, undefined, [...path, key], visit)
      } else {
        visitFieldOriginPaths(childValue, child, [...path, key], visit)
      }
    }
    if (!visited) visit(path)
    return
  }
  if (Array.isArray(value)) {
    if (value.length === 0) visit(path)
    else
      value.forEach((item, index) =>
        visitStructuredOriginPaths(item, nestedFields, [...path, String(index)], visit),
      )
    return
  }
  visit(path)
}

function visitFieldOriginPaths(
  value: JsonValue,
  field: DataSchemaField,
  path: readonly string[],
  visit: (path: readonly string[]) => void,
): void {
  if (field.cardinality === 'indexed') {
    const indexKey = field.indexKey ?? 'index'
    let visited = false
    for (const item of Array.isArray(value) ? value : [value]) {
      const selector = indexedKey(item, indexKey)
      if (selector === undefined || isRemoved(item)) continue
      visited = true
      const record = recordOf(item)
      const wrapped = record?.['value']
      visitStructuredOriginPaths(
        wrapped === undefined ? item : wrapped,
        field.fields,
        [...path, selector],
        visit,
        wrapped === undefined ? new Set([indexKey, 'removed']) : new Set(),
      )
    }
    if (!visited) visit(path)
    return
  }
  if (field.cardinality === 'append') {
    const values = Array.isArray(value) ? value : [value]
    if (values.length === 0) visit(path)
    else
      values.forEach((item, index) =>
        visitStructuredOriginPaths(item, field.fields, [...path, String(index)], visit),
      )
    return
  }
  visitStructuredOriginPaths(value, field.fields, path, visit)
}

function replaceStructuredAuthoringOrigins(
  tracker: AuthoringOriginTracker | undefined,
  value: JsonValue,
  nestedFields: readonly DataSchemaField[] | undefined,
  path: readonly string[],
  ignoredKeys: ReadonlySet<string> = new Set(),
): void {
  if (tracker === undefined) return
  clearAuthoringOrigins(tracker, path)
  visitStructuredOriginPaths(
    value,
    nestedFields,
    path,
    item => setAuthoringOrigin(tracker, item),
    ignoredKeys,
  )
}

function mergeAppend(
  previous: JsonValue | undefined,
  incoming: JsonValue,
  field: DataSchemaField,
  tracker?: AuthoringOriginTracker,
  path: readonly string[] = [],
): JsonValue {
  const left = Array.isArray(previous) ? previous : previous === undefined ? [] : [previous]
  const right = Array.isArray(incoming) ? incoming : [incoming]
  right.forEach((item, index) =>
    replaceStructuredAuthoringOrigins(tracker, item, field.fields, [
      ...path,
      String(left.length + index),
    ]),
  )
  return [...left.map(cloneJson), ...right.map(cloneJson)]
}

function mergeIndexed(
  previous: JsonValue | undefined,
  incoming: JsonValue,
  field: DataSchemaField,
  tracker?: AuthoringOriginTracker,
  path: readonly string[] = [],
): JsonValue {
  const indexKey = field.indexKey ?? 'index'
  const result = Array.isArray(previous) ? previous.map(cloneJson) : []
  const additions = Array.isArray(incoming) ? incoming : [incoming]
  for (const item of additions) {
    const key = indexedKey(item, indexKey)
    if (key === undefined) continue
    const found = result.findIndex(candidate => indexedKey(candidate, indexKey) === key)
    if (isRemoved(item)) {
      if (tracker !== undefined) clearAuthoringOrigins(tracker, [...path, key])
      if (found !== -1) result.splice(found, 1)
    } else if (found === -1) {
      result.push(cloneJson(item))
      const record = recordOf(item)
      const wrapped = record?.['value']
      replaceStructuredAuthoringOrigins(
        tracker,
        wrapped === undefined ? item : wrapped,
        field.fields,
        [...path, key],
        wrapped === undefined ? new Set([indexKey, 'removed']) : new Set(),
      )
    } else {
      // Overriding one slot keeps the subfields it does not mention, as the game does. The nested
      // schema describes the slot's `value`, not the `{index, value}` wrapper around it.
      const existing = recordOf(result[found]!)
      const replacement = recordOf(item)
      result[found] =
        existing !== undefined &&
        replacement !== undefined &&
        'value' in existing &&
        'value' in replacement
          ? {
              ...(mergeStructured(existing, item, undefined) as Record<string, JsonValue>),
              value: mergeStructured(
                existing['value'],
                replacement['value']!,
                field.fields,
                tracker,
                [...path, key],
              ),
            }
          : mergeStructured(
              result[found],
              item,
              field.fields,
              tracker,
              [...path, key],
              new Set([indexKey, 'removed']),
            )
    }
  }
  return result
}

/**
 * Child-wins merge of one structured value.
 *
 * Two records merge key by key, descending through the nested schema so a nested indexed or
 * append field keeps its own rule; any other pair is replaced by the incoming value. A struct
 * override that mentions one subfield therefore inherits the rest instead of erasing them.
 */
function mergeStructured(
  previous: JsonValue | undefined,
  incoming: JsonValue,
  nestedFields: readonly DataSchemaField[] | undefined,
  tracker?: AuthoringOriginTracker,
  path: readonly string[] = [],
  ignoredOriginKeys: ReadonlySet<string> = new Set(),
): JsonValue {
  const left = previous === undefined ? undefined : recordOf(previous)
  const right = recordOf(incoming)
  if (left === undefined || right === undefined) {
    replaceStructuredAuthoringOrigins(tracker, incoming, nestedFields, path, ignoredOriginKeys)
    return cloneJson(incoming)
  }
  const nested = new Map((nestedFields ?? []).map(child => [child.fieldId, child]))
  const merged: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(left).map(([key, value]) => [key, cloneJson(value)]),
  )
  for (const [key, value] of Object.entries(right)) {
    const child = nested.get(key)
    const childTracker = ignoredOriginKeys.has(key) ? undefined : tracker
    merged[key] =
      child === undefined
        ? mergeStructured(merged[key], value, undefined, childTracker, [...path, key])
        : mergeFieldValue(merged[key], value, child, childTracker, [...path, key])
  }
  return merged
}

function mergeFieldValue(
  previous: JsonValue | undefined,
  incoming: JsonValue,
  field: DataSchemaField,
  tracker?: AuthoringOriginTracker,
  path: readonly string[] = [],
): JsonValue {
  if (field.cardinality === 'append') return mergeAppend(previous, incoming, field, tracker, path)
  if (field.cardinality === 'indexed') return mergeIndexed(previous, incoming, field, tracker, path)
  return mergeStructured(previous, incoming, field.fields, tracker, path)
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
    merged[fieldId] = mergeFieldValue(merged[fieldId], incoming, field)
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
  if (Array.isArray(value) && (field.cardinality === 'indexed' || field.cardinality === 'append')) {
    value.forEach((item, ordinal) => {
      const record = recordOf(item)
      const indexKey = field.indexKey ?? 'index'
      const explicitIndex = field.cardinality === 'indexed' ? record?.[indexKey] : undefined
      const selector =
        typeof explicitIndex === 'string' || typeof explicitIndex === 'number'
          ? String(explicitIndex)
          : String(ordinal)
      visitRelationField(item, { ...field, cardinality: 'scalar' }, `${path}.${selector}`, visit)
    })
    return
  }
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

interface WorkingAuthoringEntity {
  readonly namespace: string
  readonly entityId: string
  readonly typeId: string
  parentEntityId?: string
  defaultTemplate: boolean
  readonly tokens: Map<string, DataEntityToken>
  readonly patches: DataEntityPatch[]
  source: DataEntitySource
}

interface ResolvedAuthoringField {
  readonly value: JsonValue
  readonly source: number
  readonly originEntityId: string
  readonly origins: ReadonlyMap<string, DataAuthoringValueOrigin>
}

interface ResolvedWorkingAuthoringEntity {
  readonly working: WorkingAuthoringEntity
  readonly parent?: ResolvedWorkingAuthoringEntity
  /** Values inherited by descendants; provider-owned per-entity defaults are deliberately absent. */
  readonly authoredFields: ReadonlyMap<string, ResolvedAuthoringField>
  readonly fields: ReadonlyMap<string, ResolvedAuthoringField>
  readonly tokens: ReadonlyMap<string, DataEntityToken>
  readonly tombstones: readonly DataAuthoringUnsetTombstone[]
  readonly complete: boolean
}

const authoringSourceKey = (source: DataEntitySource): string =>
  `${source.rootId}\u0000${source.path}\u0000${source.documentIndex}\u0000${String(source.revision ?? '')}`

const immutableToken = (token: DataEntityToken): DataEntityToken => Object.freeze({ ...token })

function mergeEntityTokens(
  inherited: ReadonlyMap<string, DataEntityToken> | undefined,
  declared: ReadonlyMap<string, DataEntityToken>,
): ReadonlyMap<string, DataEntityToken> {
  const tokens = new Map(inherited)
  for (const [id, token] of declared) tokens.set(id, token)
  return tokens
}

const fixedAuthoringOriginTracker = (
  origins: Map<string, DataAuthoringValueOrigin>,
  source: number,
  originEntityId: string,
): AuthoringOriginTracker => ({
  origins,
  originForPath: () => ({ source, originEntityId }),
})

const mappedAuthoringOriginTracker = (
  origins: Map<string, DataAuthoringValueOrigin>,
  incoming: ReadonlyMap<string, DataAuthoringValueOrigin>,
  fallback: Pick<DataAuthoringValueOrigin, 'source' | 'originEntityId'>,
): AuthoringOriginTracker => ({
  origins,
  originForPath: path => incoming.get(authoringOriginKey(path)) ?? fallback,
})

function normalizedAuthoringOrigins(
  value: JsonValue,
  field: DataSchemaField | undefined,
  origins: ReadonlyMap<string, DataAuthoringValueOrigin>,
  fallback: Pick<DataAuthoringValueOrigin, 'source' | 'originEntityId'>,
): ReadonlyMap<string, DataAuthoringValueOrigin> {
  const normalized = new Map<string, DataAuthoringValueOrigin>()
  const visit = (path: readonly string[]): void => {
    const origin = origins.get(authoringOriginKey(path)) ?? fallback
    const immutablePath = Object.freeze([...path])
    normalized.set(
      authoringOriginKey(path),
      Object.freeze({
        path: immutablePath,
        source: origin.source,
        originEntityId: origin.originEntityId,
      }),
    )
  }
  if (field === undefined) visitStructuredOriginPaths(value, undefined, [], visit)
  else visitFieldOriginPaths(value, field, [], visit)
  return normalized
}

function collectAuthoringTombstones(
  value: JsonValue,
  field: DataSchemaField,
  path: readonly string[],
  source: number,
  output: DataAuthoringUnsetTombstone[],
): void {
  const values = Array.isArray(value) ? value : [value]
  if (field.cardinality === 'indexed') {
    const indexKey = field.indexKey ?? 'index'
    for (const item of values) {
      const record = recordOf(item)
      const selector = record === undefined ? undefined : indexedKey(item, indexKey)
      if (selector === undefined) continue
      if (isRemoved(item)) {
        output.push(Object.freeze({ path: Object.freeze([...path, selector]), source }))
        continue
      }
      const wrapped = record?.['value']
      const nested = wrapped === undefined ? record : (recordOf(wrapped) ?? record)
      if (nested === undefined || field.fields === undefined) continue
      for (const child of field.fields) {
        const childValue = nested[child.fieldId]
        if (childValue !== undefined) {
          collectAuthoringTombstones(
            childValue,
            child,
            [...path, selector, child.fieldId],
            source,
            output,
          )
        }
      }
    }
    return
  }
  if (field.fields === undefined) return
  values.forEach((item, ordinal) => {
    const record = recordOf(item)
    if (record === undefined) return
    const wrapped = record['value']
    const nested = wrapped === undefined ? record : (recordOf(wrapped) ?? record)
    const parentPath = field.cardinality === 'append' ? [...path, String(ordinal)] : path
    for (const child of field.fields ?? []) {
      const childValue = nested[child.fieldId]
      if (childValue !== undefined) {
        collectAuthoringTombstones(
          childValue,
          child,
          [...parentPath, child.fieldId],
          source,
          output,
        )
      }
    }
  })
}

function authoringDiagnosticSummary(
  diagnostics: readonly DataCatalogDiagnostic[],
): DataAuthoringDiagnosticSummary {
  const maximumItems = 64
  const counts = { error: 0, warning: 0, information: 0 }
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1
  const items = diagnostics
    .slice(0, maximumItems)
    .map((diagnostic): DataAuthoringDiagnosticSummaryItem =>
      Object.freeze({
        severity: diagnostic.severity,
        code: diagnostic.code.slice(0, 256),
        message: diagnostic.message.replaceAll('\0', '').slice(0, 2_048),
      }),
    )
  return Object.freeze({
    errorCount: counts.error,
    warningCount: counts.warning,
    informationCount: counts.information,
    items: Object.freeze(items),
    truncated: diagnostics.length > items.length,
  })
}

/**
 * Build a compact authoring index directly from parsed patches.
 *
 * This intentionally stops before full definition and relation materialization. A row carries only
 * fields touched by the entity (plus provider-owned lowest defaults), already merged against the
 * nearest parent value with the same schema functions used by {@link resolveDataCatalog}.
 */
export function resolveDataAuthoringIndex(
  input: DataAuthoringIndexResolutionInput,
): ResolvedDataAuthoringIndex {
  const maxEntities = positiveLimit(input.maxEntities, 'maxEntities')
  const maxDepth = positiveLimit(input.maxDepth, 'maxDepth')
  const maxOutputBytes = positiveLimit(input.maxOutputBytes, 'maxOutputBytes')
  if (input.patches.length > maxEntities) {
    throw new TypeError(`patches exceeds maxEntities (${input.patches.length} > ${maxEntities})`)
  }

  const diagnostics: DataCatalogDiagnostic[] = [...(input.diagnostics ?? [])]
  const schemas = new Map<string, DataTypeSchema>()
  for (const schema of input.schemas) {
    if (schemas.has(schema.typeId)) {
      diagnostics.push({
        severity: 'error',
        code: 'common.data/schema-type-duplicate',
        message: `catalog schema type is duplicated: ${schema.typeId}`,
        typeId: schema.typeId,
      })
    } else schemas.set(schema.typeId, schema)
  }
  const fieldsByType = new Map<string, ReadonlyMap<string, DataSchemaField>>()
  for (const schema of schemas.values()) {
    fieldsByType.set(schema.typeId, schemaFields(schema, schemas, diagnostics))
  }

  const sources: DataEntitySource[] = []
  const sourceIndexes = new Map<string, number>()
  const sourceIndex = (source: DataEntitySource): number => {
    const key = authoringSourceKey(source)
    const existing = sourceIndexes.get(key)
    if (existing !== undefined) return existing
    const index = sources.length
    sources.push(immutableSource(source))
    sourceIndexes.set(key, index)
    return index
  }

  const entities = new Map<string, WorkingAuthoringEntity>()
  const unknownFields = new Set<string>()
  for (const patch of input.patches) {
    const key = entityKey(patch.namespace, patch.entityId)
    let current = entities.get(key)
    if (current === undefined) {
      current = {
        namespace: patch.namespace,
        entityId: patch.entityId,
        typeId: patch.typeId,
        ...(patch.parentEntityId === undefined ? {} : { parentEntityId: patch.parentEntityId }),
        defaultTemplate: false,
        tokens: new Map(),
        patches: [],
        source: patch.source,
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
    current.source = patch.source
    if (patch.parentEntityId !== undefined) current.parentEntityId = patch.parentEntityId
    if (patch.defaultTemplate !== undefined) current.defaultTemplate = patch.defaultTemplate
    for (const token of patch.tokens ?? []) current.tokens.set(token.id, immutableToken(token))
    current.patches.push(patch)
    sourceIndex(patch.source)
    const typeFields = fieldsByType.get(patch.typeId)
    if (typeFields === undefined) continue
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
  }
  if (entities.size > maxEntities) {
    throw new TypeError(`entities exceeds maxEntities (${entities.size} > ${maxEntities})`)
  }

  const basePatches = new Map<string, DataEntityPatch>()
  for (const patch of input.basePatches ?? []) {
    const key = entityKey(patch.namespace, patch.entityId)
    const entity = entities.get(key)
    if (entity === undefined || entity.typeId !== patch.typeId) continue
    basePatches.set(key, patch)
    sourceIndex(patch.source)
  }

  const resolved = new Map<string, ResolvedWorkingAuthoringEntity>()
  const resolving = new Set<string>()
  const resolveEntity = (
    current: WorkingAuthoringEntity,
    depth: number,
  ): ResolvedWorkingAuthoringEntity => {
    const key = entityKey(current.namespace, current.entityId)
    const cached = resolved.get(key)
    if (cached !== undefined) return cached
    let complete = true
    let parent: ResolvedWorkingAuthoringEntity | undefined
    if (depth > maxDepth || resolving.has(key)) {
      diagnostics.push({
        severity: 'error',
        code:
          depth > maxDepth
            ? 'common.data/entity-inheritance-depth-exceeded'
            : 'common.data/entity-inheritance-cycle',
        message:
          depth > maxDepth
            ? `${current.namespace}/${current.entityId} exceeds inheritance depth ${maxDepth}`
            : `entity inheritance cycle includes ${current.namespace}/${current.entityId}`,
        namespace: current.namespace,
        typeId: current.typeId,
        entityId: current.entityId,
      })
      return {
        working: current,
        authoredFields: new Map(),
        fields: new Map(),
        tokens: new Map(),
        tombstones: [],
        complete: false,
      }
    }
    resolving.add(key)
    if (current.parentEntityId !== undefined) {
      const parentWorking = entities.get(entityKey(current.namespace, current.parentEntityId))
      if (parentWorking === undefined) {
        complete = false
        diagnostics.push({
          severity: 'error',
          code: 'common.data/entity-parent-unavailable',
          message: `${current.namespace}/${current.entityId} names unavailable parent ${current.parentEntityId}`,
          namespace: current.namespace,
          typeId: current.typeId,
          entityId: current.entityId,
        })
      } else {
        parent = resolveEntity(parentWorking, depth + 1)
        complete = parent.complete
      }
    }

    const inheritedAuthoredField = (fieldId: string): ResolvedAuthoringField | undefined => {
      let ancestor = parent
      while (ancestor !== undefined) {
        const field = ancestor.authoredFields.get(fieldId)
        if (field !== undefined) return field
        ancestor = ancestor.parent
      }
      return undefined
    }
    const typeFields = fieldsByType.get(current.typeId) ?? new Map<string, DataSchemaField>()
    const tokens = mergeEntityTokens(parent?.tokens, current.tokens)
    const authoredFields = new Map<string, ResolvedAuthoringField>()
    for (const patch of current.patches) {
      const patchSource = sourceIndex(patch.source)
      for (const [fieldId, incoming] of Object.entries(patch.fields)) {
        const field = typeFields.get(fieldId)
        const previous = authoredFields.get(fieldId) ?? inheritedAuthoredField(fieldId)
        const origins = new Map(previous?.origins)
        const tracker = fixedAuthoringOriginTracker(origins, patchSource, current.entityId)
        const value =
          field === undefined
            ? mergeStructured(previous?.value, incoming, undefined, tracker)
            : mergeFieldValue(previous?.value, incoming, field, tracker)
        authoredFields.set(fieldId, {
          value,
          source: patchSource,
          originEntityId: current.entityId,
          origins: normalizedAuthoringOrigins(value, field, origins, {
            source: patchSource,
            originEntityId: current.entityId,
          }),
        })
      }
    }
    const fields = new Map<string, ResolvedAuthoringField>()
    const tombstones: DataAuthoringUnsetTombstone[] = []
    const basePatch = basePatches.get(key)
    if (basePatch !== undefined) {
      const baseSource = sourceIndex(basePatch.source)
      for (const [fieldId, baseValue] of Object.entries(basePatch.fields)) {
        const schemaField = typeFields.get(fieldId)
        const origins = new Map<string, DataAuthoringValueOrigin>()
        const tracker = fixedAuthoringOriginTracker(origins, baseSource, current.entityId)
        const value =
          schemaField === undefined
            ? mergeStructured(undefined, baseValue, undefined, tracker)
            : mergeFieldValue(undefined, baseValue, schemaField, tracker)
        fields.set(fieldId, {
          value,
          source: baseSource,
          originEntityId: current.entityId,
          origins: normalizedAuthoringOrigins(value, schemaField, origins, {
            source: baseSource,
            originEntityId: current.entityId,
          }),
        })
      }
    }
    const effectiveAuthoredFields = new Map<string, ResolvedAuthoringField>(authoredFields)
    let ancestor = parent
    while (ancestor !== undefined) {
      for (const [fieldId, field] of ancestor.authoredFields) {
        if (!effectiveAuthoredFields.has(fieldId)) effectiveAuthoredFields.set(fieldId, field)
      }
      ancestor = ancestor.parent
    }
    for (const [fieldId, authored] of effectiveAuthoredFields) {
      const schemaField = typeFields.get(fieldId)
      const base = fields.get(fieldId)
      const origins = new Map(base?.origins)
      const withoutDefaults = (() => {
        if (base === undefined) {
          for (const [path, origin] of authored.origins) origins.set(path, origin)
          return authored.value
        }
        const tracker = mappedAuthoringOriginTracker(origins, authored.origins, authored)
        return schemaField === undefined
          ? mergeStructured(base.value, authored.value, undefined, tracker)
          : mergeFieldValue(base.value, authored.value, schemaField, tracker)
      })()
      const holder = { [fieldId]: withoutDefaults }
      const defaulted =
        input.applyDefaults?.(current.namespace, current.typeId, current.entityId, holder) ?? holder
      const value = defaulted[fieldId] ?? withoutDefaults
      const changedByDefaults = value !== withoutDefaults
      if (base !== undefined || authoredFields.has(fieldId) || changedByDefaults) {
        fields.set(fieldId, {
          value,
          source: authored.source,
          originEntityId: authored.originEntityId,
          origins: normalizedAuthoringOrigins(value, schemaField, origins, authored),
        })
      }
    }
    for (const patch of current.patches) {
      const patchSource = sourceIndex(patch.source)
      for (const [fieldId, incoming] of Object.entries(patch.fields)) {
        const field = typeFields.get(fieldId)
        if (field !== undefined) {
          collectAuthoringTombstones(incoming, field, [fieldId], patchSource, tombstones)
        }
      }
    }
    resolving.delete(key)
    const result = Object.freeze({
      working: current,
      ...(parent === undefined ? {} : { parent }),
      authoredFields,
      fields,
      tokens,
      tombstones: Object.freeze(tombstones),
      complete,
    })
    resolved.set(key, result)
    return result
  }

  const rows = [...entities.values()]
    .sort(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.entityId.localeCompare(right.entityId),
    )
    .map(current => {
      const item = resolveEntity(current, 0)
      const fields = [...item.fields.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fieldId, field]): DataAuthoringFieldDelta =>
          Object.freeze({
            fieldId,
            value: immutableJson(field.value),
            source: field.source,
            originEntityId: field.originEntityId,
            origins: Object.freeze(
              [...field.origins.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([, origin]) => origin),
            ),
          }),
        )
      const tokens = Object.freeze(
        [...item.tokens.values()].sort((left, right) => left.id.localeCompare(right.id)),
      )
      return Object.freeze({
        identity: entityKey(current.namespace, current.entityId),
        namespace: current.namespace,
        typeId: current.typeId,
        entityId: current.entityId,
        ...(current.parentEntityId === undefined ? {} : { parentEntityId: current.parentEntityId }),
        ...(current.defaultTemplate ? { defaultTemplate: true } : {}),
        ...(tokens.length === 0 ? {} : { tokens }),
        source: sourceIndex(current.source),
        complete: item.complete,
        fields: Object.freeze(fields),
        tombstones: item.tombstones,
      })
    })

  const namespaces = [...entities.values()].reduce((counts, entity) => {
    counts.set(entity.namespace, (counts.get(entity.namespace) ?? 0) + 1)
    return counts
  }, new Map<string, number>())
  const namespaceRows = Object.freeze(
    [...namespaces.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([namespace, entityCount]) => Object.freeze({ namespace, entityCount })),
  )
  const sourceTable = Object.freeze(sources)
  const complete =
    input.complete !== false &&
    diagnostics.every(diagnostic => diagnostic.severity !== 'error') &&
    rows.every(row => row.complete)
  const createIndex = (
    valueRows: readonly DataAuthoringIndexEntity[],
    valueDiagnostics: readonly DataCatalogDiagnostic[],
    valuesComplete: boolean,
  ): ResolvedDataAuthoringIndex =>
    Object.freeze({
      schemaVersion: 1,
      kind: RESOLVED_DATA_AUTHORING_INDEX_KIND,
      workspaceId: input.workspaceId,
      gameId: input.gameId,
      analyzerId: input.analyzerId,
      snapshotId: input.snapshotId,
      sourceTable,
      namespaces: namespaceRows,
      entityCount: rows.length,
      patchCount: input.patches.length,
      entities: Object.freeze(valueRows),
      diagnostics: authoringDiagnosticSummary(valueDiagnostics),
      ...(input.ownerMetadata === undefined
        ? {}
        : { ownerMetadata: immutableJson(input.ownerMetadata) }),
      complete,
      valuesComplete,
    })
  const valued = createIndex(rows, diagnostics, true)
  const encodedBytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (encodedBytes(valued) <= maxOutputBytes) return valued

  const overflowDiagnostic: DataCatalogDiagnostic = {
    severity: 'warning',
    code: 'common.data/authoring-index-values-truncated',
    message: `authoring values exceed the ${maxOutputBytes} byte output budget; identity and source rows remain complete`,
  }
  const identityRows = rows.map(row =>
    Object.freeze({
      identity: row.identity,
      namespace: row.namespace,
      typeId: row.typeId,
      entityId: row.entityId,
      ...(row.parentEntityId === undefined ? {} : { parentEntityId: row.parentEntityId }),
      ...(row.defaultTemplate === undefined ? {} : { defaultTemplate: row.defaultTemplate }),
      ...(row.tokens === undefined ? {} : { tokens: row.tokens }),
      source: row.source,
      complete: row.complete,
    }),
  )
  const identityOnly = createIndex(identityRows, [...diagnostics, overflowDiagnostic], false)
  if (encodedBytes(identityOnly) > maxOutputBytes) {
    throw new TypeError(`authoring identity index exceeds maxOutputBytes ${maxOutputBytes}`)
  }
  return identityOnly
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
        defaultTemplate: false,
        tokens: new Map(),
        fields: {},
        fieldSources: {},
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
    if (patch.defaultTemplate !== undefined) current.defaultTemplate = patch.defaultTemplate
    for (const token of patch.tokens ?? []) current.tokens.set(token.id, immutableToken(token))
    current.sources.push(patch.source)
    for (const fieldId of Object.keys(patch.fields)) {
      if (typeFields.has(fieldId)) {
        current.fieldSources[fieldId] = patch.source
        continue
      }
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
    let fieldSources: Record<string, DataEntitySource> = {}
    let inheritanceChain: DataEntityRef[] = []
    let sources: DataEntitySource[] = []
    let tokens = new Map<string, DataEntityToken>()
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
        fieldSources = Object.fromEntries(
          Object.entries(parent.fieldSources ?? {}).map(([fieldId, source]) => [
            fieldId,
            immutableSource(source),
          ]),
        )
        inheritanceChain = [...parent.inheritanceChain]
        sources = [...parent.sources]
        for (const token of parent.tokens ?? []) tokens.set(token.id, token)
      }
    }
    for (const [id, token] of current.tokens) tokens.set(id, token)
    fields = mergeFields(fields, current.fields, fieldsByType.get(current.typeId) ?? new Map())
    for (const [fieldId, source] of Object.entries(current.fieldSources)) {
      fieldSources[fieldId] = source
    }
    inheritanceChain.push(ref)
    sources.push(...current.sources)
    const resolved: DataResolvedEntity = Object.freeze({
      namespace: current.namespace,
      typeId: current.typeId,
      entityId: current.entityId,
      ...(current.parentEntityId === undefined ? {} : { parentEntityId: current.parentEntityId }),
      ...(current.defaultTemplate ? { defaultTemplate: true } : {}),
      ...(tokens.size === 0
        ? {}
        : {
            tokens: Object.freeze(
              [...tokens.values()].sort((left, right) => left.id.localeCompare(right.id)),
            ),
          }),
      inheritanceChain: Object.freeze(inheritanceChain.map(immutableRef)),
      fields: Object.freeze(
        Object.fromEntries(
          Object.entries(fields).map(([fieldId, value]) => [fieldId, immutableJson(value)]),
        ),
      ),
      ...(input.includeFieldSources === true
        ? {
            fieldSources: Object.freeze(
              Object.fromEntries(
                Object.entries(fieldSources).map(([fieldId, source]) => [
                  fieldId,
                  immutableSource(source),
                ]),
              ),
            ),
          }
        : {}),
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
    ...(input.ownerMetadata === undefined
      ? {}
      : { ownerMetadata: immutableJson(input.ownerMetadata) }),
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

/** Bounded request for one semantic subject card over an existing immutable data snapshot. */
export interface DataSubjectFactsOpenRequest extends DataFacetOpenRequest {
  readonly subject: DataEntityRef
  readonly maxEntities: number
  readonly maxRelations: number
  readonly maxCalculations: number
}

/** Bounded request for auditable read-only calculations over one immutable subject snapshot. */
export interface DataSubjectCalculationsOpenRequest extends DataFacetOpenRequest {
  readonly subject: DataEntityRef
  readonly maxEntities: number
  readonly maxCalculations: number
}

export type DataEditTargetAction =
  'update-local-field' | 'create-local-field' | 'declare-local-entity'

export interface DataEditDocumentRef {
  readonly rootId: string
  readonly path: string
  readonly revision?: RevisionId
  readonly documentIndex?: number
}

/** Resolve an edit inside one explicitly selected writable mod context. */
export interface DataEditTargetRequest {
  readonly snapshotId: string
  readonly selectedRootId: string
  readonly writableRootIds: readonly string[]
  readonly subject: DataEntityRef
  readonly fieldPath: readonly string[]
  /** Required only when the provider reports more than one admissible local document. */
  readonly targetDocument?: Pick<DataEditDocumentRef, 'rootId' | 'path'>
  readonly signal?: AbortSignal
}

export interface DataEditTargetResolution {
  readonly state: 'resolved'
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly workspaceId: string
  readonly selectedRootId: string
  readonly writableRootIds: readonly string[]
  readonly subject: DataEntityRef
  readonly fieldPath: readonly string[]
  readonly action: DataEditTargetAction
  readonly target: DataEditDocumentRef & { readonly mode: 'replace' | 'create' }
  readonly candidates: readonly DataEditDocumentRef[]
  readonly lastDeclaration?: DataEntitySource
  readonly effectiveFieldSource?: DataEntitySource
  readonly selectionReason:
    'last-local-declaration' | 'explicit-local-document' | 'canonical-namespace-document'
  /** Every source revision that participated in the resolved context. */
  readonly guards: readonly DataEditDocumentRef[]
}

export interface DataEditTargetSelectionRequired {
  readonly state: 'selection-required'
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly workspaceId: string
  readonly selectedRootId: string
  readonly writableRootIds: readonly string[]
  readonly subject: DataEntityRef
  readonly fieldPath: readonly string[]
  readonly candidates: readonly DataEditDocumentRef[]
  readonly reason: string
}

export type DataEditTargetResult = DataEditTargetResolution | DataEditTargetSelectionRequired

export type DataEditIntent =
  | Readonly<{ readonly kind: 'set-field'; readonly value: JsonValue }>
  | Readonly<{ readonly kind: 'remove-local-override' }>
  | Readonly<{
      readonly kind: 'set-indexed-entry'
      readonly index: string | number
      readonly value: JsonValue
    }>
  | Readonly<{ readonly kind: 'remove-indexed-entry'; readonly index: string | number }>

export interface DataEditPlanRequest extends DataEditTargetRequest {
  /** Explicit source-level operation; removing an override is distinct from assigning a value. */
  readonly intent: DataEditIntent
}

/** Provider-owned semantic proposal. The host maps its logical target to an authorized edit plan. */
export interface DataEditPlanProposal {
  readonly schemaVersion: 1
  readonly target: DataEditTargetResolution
  readonly intent: DataEditIntent
  readonly replacementText: string
  readonly previewSnapshotId: string
  readonly expectedEffectiveValue?: JsonValue
  readonly diagnostics: readonly DataCatalogDiagnostic[]
}

export type DataEditPlanResult = DataEditPlanProposal | DataEditTargetSelectionRequired

export interface DataGraphIsolationRequest {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly owner: DataEntityRef
  readonly target: DataEntityRef
  /** Exact typed-link field selected by the caller; providers must not guess a branch. */
  readonly ownerFieldPath: readonly string[]
  readonly maxEdges: number
  readonly always?: boolean
  readonly signal?: AbortSignal
}

export interface DataGraphIsolationReferrer {
  readonly subject: DataEntityRef
  readonly fieldPaths: readonly (readonly string[])[]
}

export type DataGraphIsolationAnalysis =
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'unavailable'
      readonly owner: DataEntityRef
      readonly target: DataEntityRef
      readonly ownerFieldPath: readonly string[]
      readonly cloneRequired: false
      readonly reason: string
    }>
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'ready'
      readonly owner: DataEntityRef
      readonly target: DataEntityRef
      readonly ownerFieldPath: readonly string[]
      readonly shared: boolean
      readonly cloneRequired: boolean
      readonly referrers: readonly DataGraphIsolationReferrer[]
      readonly otherReferrers: readonly DataEntityRef[]
      readonly rewireFieldPaths: readonly (readonly string[])[]
    }>

export interface DataGraphIsolationPlanRequest extends DataGraphIsolationRequest {
  readonly selectedRootId: string
  readonly writableRootIds: readonly string[]
  readonly cloneEntityId: string
  readonly ownerTargetDocument?: Pick<DataEditDocumentRef, 'rootId' | 'path'>
  readonly cloneTargetDocument?: Pick<DataEditDocumentRef, 'rootId' | 'path'>
}

export interface DataGraphIsolationReplacement {
  readonly purpose: 'clone' | 'rewire' | 'clone-and-rewire'
  readonly target: DataEditDocumentRef & { readonly mode: 'replace' | 'create' }
  readonly replacementText: string
}

export interface DataGraphIsolationPlanSelectionRequired {
  readonly schemaVersion: 1
  readonly state: 'selection-required'
  readonly snapshotId: string
  readonly workspaceId: string
  readonly selectedRootId: string
  readonly purpose: 'clone' | 'rewire'
  readonly candidates: readonly DataEditDocumentRef[]
  readonly reason: string
}

export interface DataGraphIsolationPlanProposal {
  readonly schemaVersion: 1
  readonly state: 'planned'
  readonly analysis: Extract<DataGraphIsolationAnalysis, { readonly state: 'ready' }>
  readonly snapshotId: string
  readonly workspaceId: string
  readonly selectedRootId: string
  readonly writableRootIds: readonly string[]
  readonly clone: DataEntityRef
  readonly guards: readonly DataEditDocumentRef[]
  readonly replacements: readonly DataGraphIsolationReplacement[]
  readonly previewSnapshotId: string
  readonly diagnostics: readonly DataCatalogDiagnostic[]
}

export type DataGraphIsolationPlanResult =
  | DataGraphIsolationPlanProposal
  | DataGraphIsolationPlanSelectionRequired
  | Extract<DataGraphIsolationAnalysis, { readonly state: 'unavailable' }>

/** Resource-plan accounting required by the additive workspace contract. */
export interface ResolvedDataWorkspaceAnalysisRequest extends DataCatalogAnalysisRequest {
  readonly plannedDocumentCount: number
  readonly unresolvedRequirementIds: readonly string[]
}

export interface ResolvedDataAuthoringIndexRequest extends ResolvedDataWorkspaceAnalysisRequest {
  /** Hard JSON transfer bound. Providers preserve identity/source rows before optional values. */
  readonly maxOutputBytes: number
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
  /** Optional compact language projection over the same parsed patches and parent graph. */
  analyzeAuthoringIndex?(
    request: ResolvedDataAuthoringIndexRequest,
  ): Promise<ResolvedDataAuthoringIndex>
  openSchemaTree(request: DataFacetOpenRequest): Promise<Lease<TreeDataSource>>
  openDefinitionTable(request: DataFacetOpenRequest): Promise<Lease<TableDataSource>>
  openLocalizationTable(request: DataFacetOpenRequest): Promise<Lease<TableDataSource>>
  openRelations(request: DataFacetOpenRequest): Promise<Lease<RelationGraphSource>>
  /** Optional additive projection; providers without semantic cards remain valid at major 1. */
  openSubjectFacts?(request: DataSubjectFactsOpenRequest): Promise<Lease<SubjectFactsSource>>
  /** Optional additive projection; unsupported calculations stay explicit in the returned source. */
  openSubjectCalculations?(
    request: DataSubjectCalculationsOpenRequest,
  ): Promise<Lease<SubjectCalculationsSource>>
  /** Optional authoring extension over the same immutable snapshot and dependency context. */
  resolveEditTarget?(request: DataEditTargetRequest): Promise<DataEditTargetResult>
  /** Produces prospective text and a re-resolved effective value; it performs no I/O or commit. */
  planEdit?(request: DataEditPlanRequest): Promise<DataEditPlanResult>
  /** Read-only impact preview for cloning one shared object and rewiring an exact owner field. */
  analyzeIsolation?(request: DataGraphIsolationRequest): Promise<DataGraphIsolationAnalysis>
  /** Prospective multi-document clone/rewire plan. It performs no I/O or commit. */
  planIsolation?(request: DataGraphIsolationPlanRequest): Promise<DataGraphIsolationPlanResult>
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
