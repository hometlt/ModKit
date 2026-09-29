/**
 * A resolved-data provider over immutable snapshots: the game supplies `plan` and `analyze`, this
 * keeps the few recent snapshots and publishes the standard facets over them — the schema tree, one
 * definition row per entity with where each value came from, the localized strings, and the
 * relation graph with a node for each link to nothing. Warcraft III, Warzone and Westwood each wrote
 * these four the same way; a provider adds what only it has (cards, edit targets) through `extend`.
 */
import type { JsonValue, Lease, RelationGraphCompleteness } from '@modkit/sdk'
import {
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  type DataFacetOpenRequest,
  type ResolvedDataWorkspace,
  type ResolvedDataWorkspaceSnapshot,
} from '@modkit/sdk/data'
import { createTreeDataSource } from './index.js'
import { createRelationGraphSource } from './subject-facts.js'
import { createTableDataSource } from './table-source.js'

export interface SnapshotDataWorkspaceOptions {
  readonly providerId: string
  readonly gameIds: readonly string[]
  /** The schema tree's title (`Warcraft III data`). */
  readonly label: string
  readonly plan: ResolvedDataWorkspace['plan']
  readonly analyze: ResolvedDataWorkspace['analyze']
  /** How complete the relation graph is, and why when it is not (`partial` by default). */
  readonly relations?: {
    readonly completeness: RelationGraphCompleteness
    readonly reason?: string
  }
  /** Snapshots kept for later facet requests (4). */
  readonly maxSnapshots?: number
  /** What only this provider publishes, over the same snapshots. */
  readonly extend?: (
    snapshotOf: (request: DataFacetOpenRequest) => ResolvedDataWorkspaceSnapshot,
  ) => Partial<
    Omit<ResolvedDataWorkspace, 'contract' | 'providerId' | 'gameIds' | 'plan' | 'analyze'>
  >
}

const lease = <T>(value: T): Lease<T> => ({ value, release: async () => undefined })

const text = (value: JsonValue | undefined): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)

export function createSnapshotDataWorkspace(
  options: SnapshotDataWorkspaceOptions,
): ResolvedDataWorkspace {
  const maxSnapshots = options.maxSnapshots ?? 4
  const snapshots = new Map<string, ResolvedDataWorkspaceSnapshot>()
  const snapshotOf = (request: DataFacetOpenRequest): ResolvedDataWorkspaceSnapshot => {
    request.signal?.throwIfAborted()
    const snapshot = snapshots.get(request.snapshotId)
    if (snapshot === undefined)
      throw new RangeError(`snapshot ${request.snapshotId} is stale, unknown or evicted`)
    return snapshot
  }
  return {
    contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
    providerId: options.providerId,
    gameIds: options.gameIds,
    plan: options.plan,
    async analyze(request) {
      const snapshot = await options.analyze(request)
      snapshots.delete(snapshot.snapshotId)
      snapshots.set(snapshot.snapshotId, snapshot)
      while (snapshots.size > maxSnapshots) snapshots.delete(snapshots.keys().next().value!)
      return snapshot
    },
    async openSchemaTree(request) {
      const snapshot = snapshotOf(request)
      return lease(
        createTreeDataSource({
          kind: 'schema',
          label: options.label,
          children: (snapshot.schemas ?? []).map(schema => ({
            kind: 'type',
            label: schema.typeId,
            preview: `${String(schema.fields.length)} fields`,
            hasChildren: schema.fields.length > 0,
            children: () =>
              schema.fields.map(field => ({
                kind: 'field',
                label: field.fieldId,
                preview:
                  field.linkNamespace === undefined
                    ? field.cardinality
                    : `→ ${field.linkNamespace}`,
              })),
          })),
        }),
      )
    },
    async openDefinitionTable(request) {
      const snapshot = snapshotOf(request)
      // One row an entity and a column a field, each value's source as its cell fact.
      const fields = [
        ...new Set(snapshot.definitions.flatMap(entity => Object.keys(entity.fields))),
      ].sort()
      return lease(
        createTableDataSource({
          header: ['namespace', 'id', ...fields],
          rows: snapshot.definitions.map(entity => [
            entity.namespace,
            entity.entityId,
            ...fields.map(field => text(entity.fields[field])),
          ]),
          cellFacts: (coord, value) => {
            const entity = snapshot.definitions[coord.row]
            const field = fields[coord.column - 2]
            const source =
              entity === undefined || field === undefined ? undefined : entity.fieldSources?.[field]
            return source === undefined || value === ''
              ? undefined
              : { typedValue: `${source.rootId}:${source.path}` }
          },
        }),
      )
    },
    async openLocalizationTable(request) {
      const snapshot = snapshotOf(request)
      return lease(
        createTableDataSource({
          header: ['key', 'value', 'locale', 'root', 'path'],
          rows: snapshot.localizedStrings.map(item => [
            item.key,
            item.value,
            item.resolvedLocale,
            item.source.rootId,
            item.source.path,
          ]),
        }),
      )
    },
    async openRelations(request) {
      const snapshot = snapshotOf(request)
      const missing = new Map(
        snapshot.relations
          .filter(relation => relation.dead)
          .map(relation => [`${relation.to.namespace}/${relation.to.entityId}`, relation.to]),
      )
      return lease(
        createRelationGraphSource({
          snapshotId: snapshot.snapshotId,
          nodes: [
            ...snapshot.definitions.map(entity => ({
              id: `${entity.namespace}/${entity.entityId}`,
              label: entity.entityId,
              type: entity.namespace,
            })),
            // a link to something no definition declares, as a node of its own
            ...[...missing].map(([id, to]) => ({
              id,
              label: to.entityId,
              type: `missing-${to.namespace}`,
            })),
          ],
          edges: snapshot.relations.map(relation => ({
            from: `${relation.from.namespace}/${relation.from.entityId}`,
            to: `${relation.to.namespace}/${relation.to.entityId}`,
            role: relation.role,
            ...(relation.dead ? { dead: true } : {}),
          })),
          completeness: options.relations?.completeness ?? 'partial',
          ...(options.relations?.reason === undefined ? {} : { reason: options.relations.reason }),
        }),
      )
    },
    ...options.extend?.(snapshotOf),
  }
}
