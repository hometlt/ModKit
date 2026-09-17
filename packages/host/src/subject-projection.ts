/** Generic subject relation and fallback-card projections owned by the host. */
import { compareUtf8 } from '@modkit/core'
import {
  type AnyDescriptor,
  type AssetSourceRef,
  type FieldType,
  type JsonValue,
  type MetadataGroup,
  type Page,
  type PageRequest,
  type RelatedSubjectFact,
  type RelationGraphCompleteness,
  type RelationGraphEdge,
  type RelationGraphNode,
  type RelationGraphSource,
  type RelationGraphSummary,
  type SubjectFact,
  type SubjectFactGroup,
  type SubjectFactsIdentity,
  type SubjectFactsSource,
  type SubjectFactsSummary,
  type SubjectKindDefinitionSpecV1,
  type SubjectPreviewResource,
} from '@modkit/sdk'
import {
  parseSubjectRef,
  rootSubject,
  serializeSubjectRef,
  type SubjectRef,
} from '@modkit/sdk/subjects'

export interface SubjectRelationProjectionBudget {
  readonly maxDepth: number
  readonly maxValues: number
  readonly maxEdges: number
  readonly maxScalarBytes: number
  readonly pageSize: number
}

export const DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET: SubjectRelationProjectionBudget =
  Object.freeze({
    maxDepth: 32,
    maxValues: 16_384,
    maxEdges: 4_096,
    maxScalarBytes: 1_048_576,
    pageSize: 256,
  })

export interface SubjectFieldProjection {
  readonly path: string
  readonly type: FieldType
  readonly value: JsonValue
}

export interface SubjectFieldReferenceRequest {
  readonly owner: SubjectRef
  readonly role: string
  readonly type: Extract<FieldType, { readonly kind: 'subject-ref' | 'asset-ref' | 'text-key' }>
  readonly value: string
}

export interface SubjectRelationTarget {
  readonly subject: SubjectRef
  readonly label: string
  readonly kind: string
}

/**
 * The host owns resolution and placeholder identity. Projection never infers a codec, format,
 * namespace or file path from the scalar spelling.
 */
export interface SubjectFieldReferenceResolver {
  resolve(
    request: SubjectFieldReferenceRequest,
    signal?: AbortSignal,
  ): Promise<SubjectRelationTarget | undefined>
  createUnresolved(request: SubjectFieldReferenceRequest): SubjectRelationTarget
}

export interface FieldRelationGraphProjectionOptions {
  readonly owner: SubjectRef
  readonly ownerLabel: string
  readonly ownerKind: string
  readonly fields: readonly SubjectFieldProjection[]
  readonly resolver: SubjectFieldReferenceResolver
  readonly budget?: SubjectRelationProjectionBudget
  readonly signal?: AbortSignal
}

export interface RelationGraphMergeOptions {
  readonly maxNodes: number
  readonly maxEdges: number
  readonly pageSize: number
  readonly signal?: AbortSignal
}

export interface SubjectFactsMergeOptions {
  readonly maxGroups: number
  readonly maxFactsPerGroup: number
  readonly maxRelations: number
  readonly pageSize: number
  readonly signal?: AbortSignal
}

const DEFAULT_GRAPH_MERGE: RelationGraphMergeOptions = Object.freeze({
  maxNodes: 16_384,
  maxEdges: 65_536,
  pageSize: 256,
})

const DEFAULT_FACTS_MERGE: SubjectFactsMergeOptions = Object.freeze({
  maxGroups: 256,
  maxFactsPerGroup: 4_096,
  maxRelations: 16_384,
  pageSize: 256,
})

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be positive`)
  return value
}

function pageOf<T>(items: readonly T[], request: PageRequest): Page<T> {
  const limit = positive(request.limit, 'page limit')
  const offset = request.cursor === undefined ? 0 : Number(request.cursor)
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (request.cursor !== undefined && String(offset) !== request.cursor)
  ) {
    throw new RangeError(`invalid projection page cursor: ${String(request.cursor)}`)
  }
  const next = Math.min(offset + limit, items.length)
  return Object.freeze({
    items: Object.freeze(items.slice(offset, next)),
    ...(next < items.length ? { nextCursor: String(next) } : {}),
  })
}

function referencePath(path: string, segment: string): string {
  return path === '' ? segment : `${path}.${segment}`
}

function recordOf(value: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined
}

function relationKey(edge: RelationGraphEdge): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.role ?? ''}`
}

function relationFactKey(relation: RelatedSubjectFact): string {
  return `${relation.subjectId}\u0000${relation.role}\u0000${relation.kind}`
}

function scalarBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

interface ProjectionState {
  readonly options: FieldRelationGraphProjectionOptions
  readonly budget: SubjectRelationProjectionBudget
  readonly nodes: Map<string, RelationGraphNode>
  readonly edges: Map<string, RelationGraphEdge>
  readonly typeStack: WeakSet<object>
  readonly valueStack: WeakSet<object>
  values: number
  bytes: number
  capped: boolean
  reason: string | undefined
}

function cap(state: ProjectionState, reason: string): void {
  state.capped = true
  state.reason ??= reason
}

function enterValue(state: ProjectionState, value: JsonValue, depth: number): boolean {
  state.options.signal?.throwIfAborted()
  if (depth > state.budget.maxDepth) {
    cap(state, `field traversal exceeded maxDepth ${state.budget.maxDepth}`)
    return false
  }
  state.values += 1
  if (state.values > state.budget.maxValues) {
    cap(state, `field traversal exceeded maxValues ${state.budget.maxValues}`)
    return false
  }
  if (typeof value === 'object' && value !== null) {
    if (state.valueStack.has(value)) {
      cap(state, 'field traversal stopped at a cyclic value')
      return false
    }
    state.valueStack.add(value)
  }
  return true
}

function leaveValue(state: ProjectionState, value: JsonValue): void {
  if (typeof value === 'object' && value !== null) state.valueStack.delete(value)
}

async function addReference(
  state: ProjectionState,
  type: SubjectFieldReferenceRequest['type'],
  value: string,
  role: string,
): Promise<void> {
  if (state.edges.size >= state.budget.maxEdges) {
    cap(state, `relation projection exceeded maxEdges ${state.budget.maxEdges}`)
    return
  }
  state.bytes += scalarBytes(value)
  if (state.bytes > state.budget.maxScalarBytes) {
    cap(state, `relation projection exceeded maxScalarBytes ${state.budget.maxScalarBytes}`)
    return
  }
  const request = Object.freeze({ owner: state.options.owner, role, type, value })
  const resolved = await state.options.resolver.resolve(request, state.options.signal)
  const target = resolved ?? state.options.resolver.createUnresolved(request)
  const subject =
    type.kind === 'asset-ref'
      ? rootSubject(target.subject.source, target.subject.workspace)
      : target.subject
  const id = serializeSubjectRef(subject)
  state.nodes.set(id, {
    id,
    label: target.label,
    type: target.kind,
    subject: id,
    kind: target.kind,
  })
  const edge: RelationGraphEdge = {
    from: serializeSubjectRef(state.options.owner),
    to: id,
    role,
    ...(resolved === undefined ? { dead: true } : {}),
  }
  const key = relationKey(edge)
  const previous = state.edges.get(key)
  if (previous === undefined || (previous.dead === true && edge.dead !== true))
    state.edges.set(key, edge)
}

async function visitLeaf(
  state: ProjectionState,
  type: SubjectFieldReferenceRequest['type'],
  value: JsonValue,
  path: string,
  depth: number,
): Promise<void> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (state.capped) return
      await visitField(state, type, item, `${path}[${index}]`, depth + 1)
    }
    return
  }
  if (typeof value === 'string' && value.length > 0) await addReference(state, type, value, path)
}

async function visitInstructions(
  state: ProjectionState,
  type: Extract<FieldType, { readonly kind: 'instructions' }>,
  value: JsonValue,
  path: string,
  depth: number,
): Promise<void> {
  if (typeof value !== 'string') return
  const instructions = type.listDelimiter === undefined ? [value] : value.split(type.listDelimiter)
  for (const [instructionIndex, instruction] of instructions.entries()) {
    if (state.capped) return
    const parts = instruction.split(type.delimiter)
    const keyword = parts.shift()?.trim()
    if (keyword === undefined || keyword === '') continue
    const parameters = type.keywords[keyword]
    if (parameters === undefined) continue
    for (const [parameterIndex, parameter] of parameters.entries()) {
      const scalar = parts[parameterIndex]
      if (scalar === undefined) break
      await visitField(
        state,
        parameter,
        scalar.trim(),
        `${path}[${instructionIndex}].${keyword}[${parameterIndex}]`,
        depth + 1,
      )
    }
  }
}

async function visitField(
  state: ProjectionState,
  type: FieldType,
  value: JsonValue,
  path: string,
  depth: number,
): Promise<void> {
  if (!enterValue(state, value, depth)) return
  const typeObject = type as object
  if (state.typeStack.has(typeObject)) {
    cap(state, 'field traversal stopped at a cyclic field type')
    leaveValue(state, value)
    return
  }
  state.typeStack.add(typeObject)
  try {
    switch (type.kind) {
      case 'subject-ref':
      case 'asset-ref':
      case 'text-key':
        await visitLeaf(state, type, value, path, depth)
        return
      case 'array':
        if (!Array.isArray(value)) return
        for (const [index, item] of value.entries()) {
          if (state.capped) return
          await visitField(state, type.item, item, `${path}[${index}]`, depth + 1)
        }
        return
      case 'struct': {
        const record = recordOf(value)
        if (record === undefined) return
        for (const field of type.fields) {
          if (state.capped) return
          const child = record[field.key]
          if (child !== undefined)
            await visitField(state, field.type, child, referencePath(path, field.key), depth + 1)
        }
        return
      }
      case 'record': {
        const record = recordOf(value)
        if (record === undefined) return
        for (const key of Object.keys(record).sort(compareUtf8)) {
          if (state.capped) return
          const itemPath = `${path}[${JSON.stringify(key)}]`
          await visitField(state, type.key, key, `${itemPath}.$key`, depth + 1)
          await visitField(state, type.value, record[key] as JsonValue, itemPath, depth + 1)
        }
        return
      }
      case 'instructions':
        await visitInstructions(state, type, value, path, depth)
        return
      default:
        return
    }
  } finally {
    state.typeStack.delete(typeObject)
    leaveValue(state, value)
  }
}

function graphTypeBuckets(nodes: readonly RelationGraphNode[]): RelationGraphSummary['types'] {
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  return Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([id, count], index) => Object.freeze({ id, label: id, count, tone: index })),
  )
}

function materializedGraphSource(
  summary: RelationGraphSummary,
  nodes: readonly RelationGraphNode[],
  edges: readonly RelationGraphEdge[],
): RelationGraphSource {
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      signal?.throwIfAborted()
      return summary
    },
    async nodes(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf(nodes, page)
    },
    async edges(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf(edges, page)
    },
  })
}

/** Project every typed reference field without interpreting field names or scalar spellings. */
export async function createFieldRelationGraphSource(
  options: FieldRelationGraphProjectionOptions,
): Promise<RelationGraphSource> {
  const budget = options.budget ?? DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET
  positive(budget.maxDepth, 'maxDepth')
  positive(budget.maxValues, 'maxValues')
  positive(budget.maxEdges, 'maxEdges')
  positive(budget.maxScalarBytes, 'maxScalarBytes')
  positive(budget.pageSize, 'pageSize')
  const ownerId = serializeSubjectRef(options.owner)
  const state: ProjectionState = {
    options,
    budget,
    nodes: new Map([
      [
        ownerId,
        {
          id: ownerId,
          label: options.ownerLabel,
          type: options.ownerKind,
          subject: ownerId,
          kind: options.ownerKind,
        },
      ],
    ]),
    edges: new Map(),
    typeStack: new WeakSet(),
    valueStack: new WeakSet(),
    values: 0,
    bytes: 0,
    capped: false,
    reason: undefined,
  }
  for (const field of options.fields) {
    if (state.capped) break
    await visitField(state, field.type, field.value, field.path, 0)
  }
  const nodes = Object.freeze([...state.nodes.values()].sort((a, b) => compareUtf8(a.id, b.id)))
  const edges = Object.freeze(
    [...state.edges.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b))),
  )
  const completeness: RelationGraphCompleteness = state.capped ? 'capped' : 'complete'
  const summary: RelationGraphSummary = Object.freeze({
    snapshotId: `field-projection:${ownerId}`,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    types: graphTypeBuckets(nodes),
    completeness,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  })
  return materializedGraphSource(summary, nodes, edges)
}

async function readAll<T>(
  read: (page: PageRequest, signal?: AbortSignal) => Promise<Page<T>>,
  maximum: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly T[]; readonly capped: boolean }> {
  const items: T[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  while (items.length < maximum) {
    signal?.throwIfAborted()
    const page = await read(
      {
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(pageSize, maximum - items.length),
      },
      signal,
    )
    items.push(...page.items.slice(0, maximum - items.length))
    if (page.nextCursor === undefined) return { items: Object.freeze(items), capped: false }
    if (page.items.length === 0 || seen.has(page.nextCursor)) {
      throw new Error('data source returned an invalid continuation cursor')
    }
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return { items: Object.freeze(items), capped: cursor !== undefined }
}

interface MaterializedGraph {
  readonly summary: RelationGraphSummary
  readonly nodes: readonly RelationGraphNode[]
  readonly edges: readonly RelationGraphEdge[]
  readonly capped: boolean
}

async function materializeGraph(
  source: RelationGraphSource,
  options: RelationGraphMergeOptions,
): Promise<MaterializedGraph> {
  const summary = await source.summary(options.signal)
  const [nodes, edges] = await Promise.all([
    readAll(source.nodes.bind(source), options.maxNodes, options.pageSize, options.signal),
    readAll(source.edges.bind(source), options.maxEdges, options.pageSize, options.signal),
  ])
  return Object.freeze({
    summary,
    nodes: nodes.items,
    edges: edges.items,
    capped:
      nodes.capped ||
      edges.capped ||
      nodes.items.length < summary.totalNodes ||
      edges.items.length < summary.totalEdges,
  })
}

/** Authoritative sources come first; later generic projections only fill or improve missing data. */
export function createCompositeRelationGraphSource(
  sources: readonly RelationGraphSource[],
  input: Partial<RelationGraphMergeOptions> = {},
): RelationGraphSource {
  if (sources.length === 0) throw new TypeError('relation graph composition requires a source')
  const options: RelationGraphMergeOptions = {
    maxNodes: positive(input.maxNodes ?? DEFAULT_GRAPH_MERGE.maxNodes, 'maxNodes'),
    maxEdges: positive(input.maxEdges ?? DEFAULT_GRAPH_MERGE.maxEdges, 'maxEdges'),
    pageSize: positive(input.pageSize ?? DEFAULT_GRAPH_MERGE.pageSize, 'pageSize'),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
  const snapshot = (async () => {
    const loaded: MaterializedGraph[] = []
    for (const source of sources) loaded.push(await materializeGraph(source, options))
    const nodeMap = new Map<string, RelationGraphNode>()
    const edgeMap = new Map<string, RelationGraphEdge>()
    const typeInfo = new Map<string, { readonly label: string; readonly tone: number }>()
    for (const graph of loaded) {
      for (const type of graph.summary.types) {
        if (!typeInfo.has(type.id)) typeInfo.set(type.id, { label: type.label, tone: type.tone })
      }
      for (const node of graph.nodes) {
        const previous = nodeMap.get(node.id)
        nodeMap.set(
          node.id,
          previous === undefined
            ? node
            : Object.freeze({
                ...node,
                ...previous,
                ...(previous.subject === undefined && node.subject !== undefined
                  ? { subject: node.subject }
                  : {}),
                ...(previous.kind === undefined && node.kind !== undefined
                  ? { kind: node.kind }
                  : {}),
              }),
        )
      }
      for (const edge of graph.edges) {
        const key = relationKey(edge)
        const previous = edgeMap.get(key)
        if (previous === undefined || (previous.dead === true && edge.dead !== true))
          edgeMap.set(key, edge)
      }
    }
    const nodes = Object.freeze([...nodeMap.values()].sort((a, b) => compareUtf8(a.id, b.id)))
    const edges = Object.freeze(
      [...edgeMap.values()].sort((a, b) => compareUtf8(relationKey(a), relationKey(b))),
    )
    const counts = new Map<string, number>()
    for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
    const types = Object.freeze(
      [...counts.entries()]
        .sort(([a], [b]) => compareUtf8(a, b))
        .map(([id, count], index) => {
          const known = typeInfo.get(id)
          return Object.freeze({
            id,
            label: known?.label ?? id,
            count,
            tone: known?.tone ?? index,
          })
        }),
    )
    const capped = loaded.some(item => item.capped)
    const partial = loaded.some(item => item.summary.completeness !== 'complete')
    const completeness: RelationGraphCompleteness = capped
      ? 'capped'
      : partial
        ? 'partial'
        : 'complete'
    const reasons = loaded
      .map(item => item.summary.reason)
      .filter((item): item is string => item !== undefined)
    const summary: RelationGraphSummary = Object.freeze({
      snapshotId: `composite:${loaded.map(item => item.summary.snapshotId).join('|')}`,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      types,
      completeness,
      ...(reasons.length === 0 ? {} : { reason: reasons.join(' · ') }),
    })
    return { summary, nodes, edges }
  })()
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      signal?.throwIfAborted()
      return (await snapshot).summary
    },
    async nodes(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf((await snapshot).nodes, page)
    },
    async edges(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf((await snapshot).edges, page)
    },
  })
}

export function metadataFieldProjections(
  groups: readonly MetadataGroup[],
): readonly SubjectFieldProjection[] {
  return Object.freeze(
    groups.flatMap(group =>
      group.entries.flatMap(entry =>
        entry.type === undefined
          ? []
          : [{ path: referencePath(group.id, entry.key), type: entry.type, value: entry.value }],
      ),
    ),
  )
}

function descriptorSources(descriptor: AnyDescriptor): readonly AssetSourceRef[] {
  switch (descriptor.origin.kind) {
    case 'single':
      return [descriptor.origin.binding.source]
    case 'bundle':
      return descriptor.origin.bindings.map(item => item.source)
    case 'namespace':
      return [descriptor.origin.root]
    case 'derived':
      return descriptor.origin.materialization === undefined
        ? []
        : [descriptor.origin.materialization.source]
  }
}

function descriptorPreview(
  descriptor: AnyDescriptor,
  definition?: SubjectKindDefinitionSpecV1,
): SubjectPreviewResource | undefined {
  if (definition?.card?.preview === 'none') return undefined
  const contracts = new Set(descriptor.dataSources.map(item => item.contract))
  const wanted = definition?.card?.preview
  const hasRaster = contracts.has('common.view/raster-image-source')
  const hasModel = contracts.has('common.view/model-scene-source')
  const hasMedia =
    contracts.has('common.view/video-media-source') ||
    contracts.has('common.view/audio-media-source')
  if ((wanted === 'raster' && !hasRaster) || (wanted === 'model' && !hasModel)) return undefined
  if (wanted === undefined && !hasRaster && !hasModel && !hasMedia) return undefined
  const source = descriptorSources(descriptor)[0]
  if (source === undefined) return undefined
  return Object.freeze({
    source,
    ...(descriptor.interpretation === 'codec' && descriptor.identity.mediaType !== undefined
      ? { mediaType: descriptor.identity.mediaType }
      : {}),
    label:
      wanted === 'model' || (!hasRaster && hasModel)
        ? 'model preview'
        : hasRaster || wanted === 'raster'
          ? 'raster preview'
          : 'media preview',
  })
}

function descriptorIdentity(descriptor: AnyDescriptor): SubjectFactsIdentity {
  const resolved = descriptor.interpretation === 'codec'
  const label = resolved ? descriptor.identity.formatLabel : descriptor.subjectUri
  const kind = resolved ? `format:${descriptor.identity.formatId}` : 'format:unknown'
  return Object.freeze({
    subjectId: serializeSubjectRef(descriptorSubjectRef(descriptor)),
    label,
    kind,
    ...(resolved && descriptor.identity.mediaType !== undefined
      ? { type: descriptor.identity.mediaType }
      : {}),
    origins: Object.freeze(
      descriptorSources(descriptor).map(source => Object.freeze({ label: source.id, source })),
    ),
  })
}

function descriptorFactGroups(
  descriptor: AnyDescriptor,
): readonly { readonly group: SubjectFactGroup; readonly facts: readonly SubjectFact[] }[] {
  const identityFacts: SubjectFact[] =
    descriptor.interpretation === 'codec'
      ? [
          { id: 'format', label: 'Format', value: descriptor.identity.formatId, provenance: [] },
          { id: 'codec', label: 'Codec', value: descriptor.identity.codecId, provenance: [] },
          {
            id: 'version',
            label: 'Codec version',
            value: descriptor.identity.codecVersion,
            provenance: [],
          },
          {
            id: 'confidence',
            label: 'Confidence',
            value: descriptor.identity.confidence,
            provenance: [],
          },
        ]
      : [{ id: 'interpretation', label: 'Interpretation', value: 'none', provenance: [] }]
  const groups: { group: SubjectFactGroup; facts: readonly SubjectFact[] }[] = [
    {
      group: { id: 'identity', label: 'Identity', factCount: identityFacts.length },
      facts: Object.freeze(identityFacts.map(item => Object.freeze(item))),
    },
  ]
  if (descriptor.traits.length > 0) {
    const facts = Object.freeze(
      descriptor.traits.map(trait =>
        Object.freeze({
          id: trait.id,
          label: trait.id,
          value: trait.state,
          provenance: Object.freeze([]),
        }),
      ),
    )
    groups.push({ group: { id: 'traits', label: 'Traits', factCount: facts.length }, facts })
  }
  if (descriptor.interpretation === 'codec') {
    for (const group of [...descriptor.metadata].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0) || compareUtf8(left.id, right.id),
    )) {
      const facts = Object.freeze(
        group.entries.map(entry =>
          Object.freeze({
            id: entry.key,
            label: entry.key,
            value: entry.value,
            provenance: Object.freeze([...(entry.provenance ?? [])]),
            ...(entry.note === undefined ? {} : { note: entry.note }),
            ...(entry.knowledgeTarget === undefined
              ? {}
              : { knowledgeTarget: entry.knowledgeTarget }),
          }),
        ),
      )
      groups.push({
        group: { id: group.id, label: group.label, factCount: facts.length },
        facts,
      })
    }
  }
  return Object.freeze(
    groups.map(item => Object.freeze({ group: Object.freeze(item.group), facts: item.facts })),
  )
}

async function graphRelations(
  descriptor: AnyDescriptor,
  source: RelationGraphSource | undefined,
): Promise<readonly RelatedSubjectFact[]> {
  if (source === undefined) return Object.freeze([])
  const graph = await materializeGraph(source, DEFAULT_GRAPH_MERGE)
  const descriptorSubject = serializeSubjectRef(descriptorSubjectRef(descriptor))
  const ownerIds = new Set(
    graph.nodes
      .filter(
        node =>
          node.id === descriptorSubject ||
          node.subject === descriptorSubject ||
          node.id === descriptor.subjectUri ||
          node.subject === descriptor.subjectUri,
      )
      .map(node => node.id),
  )
  ownerIds.add(descriptorSubject)
  ownerIds.add(descriptor.subjectUri)
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const relations = new Map<string, RelatedSubjectFact>()
  for (const edge of graph.edges) {
    const outbound = ownerIds.has(edge.from)
    const inbound = ownerIds.has(edge.to)
    if (!outbound && !inbound) continue
    const target = nodes.get(outbound ? edge.to : edge.from)
    if (target?.subject === undefined) continue
    const relation: RelatedSubjectFact = Object.freeze({
      role: edge.role ?? (outbound ? 'outbound' : 'inbound'),
      subjectId: target.subject,
      label: target.label,
      kind: target.kind ?? target.type,
      ...(edge.dead === true ? { dead: true } : {}),
    })
    const key = relationFactKey(relation)
    const previous = relations.get(key)
    if (previous === undefined || (previous.dead === true && relation.dead !== true)) {
      relations.set(key, relation)
    }
  }
  return Object.freeze(
    [...relations.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b))),
  )
}

/** A format-neutral card facts source for root assets, including DDS-like image subjects. */
export function createDescriptorFallbackSubjectFactsSource(options: {
  readonly descriptor: AnyDescriptor
  readonly relations?: RelationGraphSource
  readonly kindDefinition?: SubjectKindDefinitionSpecV1
}): SubjectFactsSource {
  const groups = descriptorFactGroups(options.descriptor)
  const factsByGroup = new Map(groups.map(item => [item.group.id, item.facts]))
  const relations = graphRelations(options.descriptor, options.relations)
  const summary = async (): Promise<SubjectFactsSummary> => {
    const related = await relations
    const preview = descriptorPreview(options.descriptor, options.kindDefinition)
    return Object.freeze({
      snapshotId: `fallback-card:${options.descriptor.subjectUri}@${options.descriptor.revision}`,
      identity: descriptorIdentity(options.descriptor),
      groupCount: groups.length,
      relationCount: related.length,
      ...(preview === undefined ? {} : { preview }),
      ...(options.kindDefinition?.card === undefined
        ? {}
        : { card: Object.freeze({ ...options.kindDefinition.card }) }),
    })
  }
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      signal?.throwIfAborted()
      return summary()
    },
    async groups(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf(
        groups.map(item => item.group),
        page,
      )
    },
    async facts(groupId: string, page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf(factsByGroup.get(groupId) ?? [], page)
    },
    async relations(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf(await relations, page)
    },
  })
}

interface MaterializedFacts {
  readonly summary: SubjectFactsSummary
  readonly groups: readonly SubjectFactGroup[]
  readonly facts: ReadonlyMap<string, readonly SubjectFact[]>
  readonly relations: readonly RelatedSubjectFact[]
}

async function materializeFacts(
  source: SubjectFactsSource,
  options: SubjectFactsMergeOptions,
): Promise<MaterializedFacts> {
  const summary = await source.summary(options.signal)
  const groups = await readAll(
    source.groups.bind(source),
    options.maxGroups,
    options.pageSize,
    options.signal,
  )
  const facts = new Map<string, readonly SubjectFact[]>()
  for (const group of groups.items) {
    const page = await readAll(
      (request, signal) => source.facts(group.id, request, signal),
      options.maxFactsPerGroup,
      options.pageSize,
      options.signal,
    )
    facts.set(group.id, page.items)
  }
  const relations = await readAll(
    source.relations.bind(source),
    options.maxRelations,
    options.pageSize,
    options.signal,
  )
  return Object.freeze({ summary, groups: groups.items, facts, relations: relations.items })
}

/** Deterministically merge authoritative facts first and host fallback facts second. */
export function createCompositeSubjectFactsSource(
  sources: readonly SubjectFactsSource[],
  input: Partial<SubjectFactsMergeOptions> = {},
): SubjectFactsSource {
  if (sources.length === 0) throw new TypeError('subject facts composition requires a source')
  const options: SubjectFactsMergeOptions = {
    maxGroups: positive(input.maxGroups ?? DEFAULT_FACTS_MERGE.maxGroups, 'maxGroups'),
    maxFactsPerGroup: positive(
      input.maxFactsPerGroup ?? DEFAULT_FACTS_MERGE.maxFactsPerGroup,
      'maxFactsPerGroup',
    ),
    maxRelations: positive(input.maxRelations ?? DEFAULT_FACTS_MERGE.maxRelations, 'maxRelations'),
    pageSize: positive(input.pageSize ?? DEFAULT_FACTS_MERGE.pageSize, 'pageSize'),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
  const snapshot = (async () => {
    const loaded: MaterializedFacts[] = []
    for (const source of sources) loaded.push(await materializeFacts(source, options))
    const groupMap = new Map<string, SubjectFactGroup>()
    const factMaps = new Map<string, Map<string, SubjectFact>>()
    const relationMap = new Map<string, RelatedSubjectFact>()
    for (const item of loaded) {
      for (const group of item.groups) {
        if (!groupMap.has(group.id)) groupMap.set(group.id, group)
        const facts = factMaps.get(group.id) ?? new Map<string, SubjectFact>()
        for (const fact of item.facts.get(group.id) ?? []) {
          // The same fact in another locale is another value, not a duplicate.
          const key = `${fact.id}\u0000${fact.locale ?? ''}`
          if (!facts.has(key)) facts.set(key, fact)
        }
        factMaps.set(group.id, facts)
      }
      for (const relation of item.relations) {
        const key = relationFactKey(relation)
        const previous = relationMap.get(key)
        if (previous === undefined || (previous.dead === true && relation.dead !== true)) {
          relationMap.set(key, relation)
        }
      }
    }
    const groups = Object.freeze(
      [...groupMap.values()].map(group =>
        Object.freeze({ ...group, factCount: factMaps.get(group.id)?.size ?? 0 }),
      ),
    )
    const facts = new Map(
      [...factMaps.entries()].map(([groupId, values]) => [
        groupId,
        Object.freeze([...values.values()]),
      ]),
    )
    const relations = Object.freeze(
      [...relationMap.values()].sort((a, b) => compareUtf8(relationFactKey(a), relationFactKey(b))),
    )
    const primary = loaded[0] as MaterializedFacts
    const preview = loaded.find(item => item.summary.preview !== undefined)?.summary.preview
    const card = loaded.find(item => item.summary.card !== undefined)?.summary.card
    const summary: SubjectFactsSummary = Object.freeze({
      snapshotId: `composite:${loaded.map(item => item.summary.snapshotId).join('|')}`,
      identity: primary.summary.identity,
      groupCount: groups.length,
      relationCount: relations.length,
      ...(preview === undefined ? {} : { preview }),
      ...(card === undefined ? {} : { card }),
    })
    return { summary, groups, facts, relations }
  })()
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      signal?.throwIfAborted()
      return (await snapshot).summary
    },
    async groups(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf((await snapshot).groups, page)
    },
    async facts(groupId: string, page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf((await snapshot).facts.get(groupId) ?? [], page)
    },
    async relations(page: PageRequest, signal?: AbortSignal) {
      signal?.throwIfAborted()
      return pageOf((await snapshot).relations, page)
    },
  })
}

export function descriptorSubjectRef(descriptor: AnyDescriptor): SubjectRef {
  return parseSubjectRef(descriptor.subjectUri)
}
