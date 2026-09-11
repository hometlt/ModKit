/**
 * Subject facts and relation graphs, built once for every codec.
 *
 * These two sources are what a card and a graph are made of, and the algorithm behind them is the
 * same everywhere: group the facts, page them, and say where each one came from. It was written
 * inside `sc2-bank/sources.js` and stayed there, so the four other SC2 codecs published no card at
 * all — not because they have nothing to say about a catalog, a localization file or a script, but
 * because saying it meant copying two hundred lines. Shared algorithms belong in the kit, so here
 * it is, unchanged in behaviour and typed.
 *
 * The paging rules are the contract's, and they refuse rather than guess: a limit that is not a
 * positive integer is a caller bug, and so is a cursor that points past the end. Returning an empty
 * page for either would turn a broken caller into an empty view, which reads as "there is nothing
 * here".
 */
import type {
  AssetSourceRef,
  FieldEditable,
  FieldType,
  JsonValue,
  Page,
  PageRequest,
  RelatedSubjectFact,
  RelationGraphEdge,
  RelationGraphNode,
  RelationGraphSource,
  RelationGraphSummary,
  SubjectFact,
  SubjectFactGroup,
  SubjectFactProvenance,
  SubjectFactsSource,
  SubjectFactsSummary,
} from '@modkit/sdk'

function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

/** One page of an in-memory list, with the contract's refusals. */
export function pageOf<T>(
  items: readonly T[],
  request: PageRequest,
  signal?: AbortSignal,
): Page<T> {
  abort(signal)
  if (
    request === null ||
    typeof request !== 'object' ||
    !Number.isSafeInteger(request.limit) ||
    request.limit <= 0
  ) {
    throw new TypeError('page limit must be a positive safe integer')
  }
  const start = request.cursor === undefined ? 0 : Number(request.cursor)
  if (!Number.isSafeInteger(start) || start < 0 || start > items.length) {
    throw new RangeError('page cursor is invalid')
  }
  const end = Math.min(items.length, start + request.limit)
  return Object.freeze({
    items: Object.freeze(items.slice(start, end)),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  })
}

/** Where a fact came from: the file, and the path within it a reader could be shown. */
export function provenanceOf(
  source: AssetSourceRef,
  semanticPath: readonly string[] = [],
): readonly SubjectFactProvenance[] {
  return Object.freeze([
    Object.freeze({
      label: source.uri,
      source,
      semanticPath: Object.freeze([...semanticPath]),
    }),
  ])
}

export function fact(
  source: AssetSourceRef,
  id: string,
  label: string,
  value: JsonValue,
  semanticPath: readonly string[] = [],
): SubjectFact {
  return Object.freeze({ id, label, value, provenance: provenanceOf(source, semanticPath) })
}

export interface SubjectFactGroupInput {
  readonly id: string
  readonly label: string
  readonly facts: readonly SubjectFact[]
}

export interface SubjectFactsSourceOptions {
  readonly snapshotId: string
  readonly subjectId: string
  readonly label: string
  readonly kind: string
  readonly type?: string
  readonly source: AssetSourceRef
  readonly groups: readonly SubjectFactGroupInput[]
  readonly relations?: readonly RelatedSubjectFact[]
}

export function createSubjectFactsSource(
  options: SubjectFactsSourceOptions,
): SubjectFactsSource {
  // An empty group is not a group: a card that shows a heading with nothing under it says the
  // codec failed rather than that the file has no such section.
  const groups: readonly SubjectFactGroup[] = Object.freeze(
    options.groups
      .filter(group => group.facts.length > 0)
      .map(group =>
        Object.freeze({ id: group.id, label: group.label, factCount: group.facts.length }),
      ),
  )
  const facts = new Map(options.groups.map(group => [group.id, Object.freeze([...group.facts])]))
  const relations = Object.freeze([...(options.relations ?? [])])
  const summary: SubjectFactsSummary = Object.freeze({
    snapshotId: options.snapshotId,
    identity: Object.freeze({
      subjectId: options.subjectId,
      label: options.label,
      kind: options.kind,
      ...(options.type === undefined ? {} : { type: options.type }),
      origins: provenanceOf(options.source),
    }),
    groupCount: groups.length,
    relationCount: relations.length,
  })
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      abort(signal)
      return summary
    },
    async groups(request: PageRequest, signal?: AbortSignal) {
      return pageOf(groups, request, signal)
    },
    async facts(groupId: string, request: PageRequest, signal?: AbortSignal) {
      const values = facts.get(groupId)
      if (values === undefined) throw new RangeError(`unknown fact group: ${groupId}`)
      return pageOf(values, request, signal)
    },
    async relations(request: PageRequest, signal?: AbortSignal) {
      return pageOf(relations, request, signal)
    },
  })
}

export interface RelationGraphSourceOptions {
  readonly snapshotId: string
  readonly nodes: readonly RelationGraphNode[]
  readonly edges: readonly RelationGraphEdge[]
  readonly completeness?: RelationGraphSummary['completeness']
  readonly reason?: string
}

export function createRelationGraphSource(
  options: RelationGraphSourceOptions,
): RelationGraphSource {
  const nodes = Object.freeze([...options.nodes])
  const edges = Object.freeze([...options.edges])
  const counts = new Map<string, number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  /*
   * `tone` is a colour slot, assigned by sorted position so a type keeps its colour between
   * sessions. Deriving it from the name would change whenever a type appears or disappears.
   */
  const types = Object.freeze(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, count], tone) => Object.freeze({ id, label: id, count, tone })),
  )
  const summary: RelationGraphSummary = Object.freeze({
    snapshotId: options.snapshotId,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    types,
    completeness: options.completeness ?? 'complete',
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  })
  return Object.freeze({
    async summary(signal?: AbortSignal) {
      abort(signal)
      return summary
    },
    async nodes(request: PageRequest, signal?: AbortSignal) {
      return pageOf(nodes, request, signal)
    },
    async edges(request: PageRequest, signal?: AbortSignal) {
      return pageOf(edges, request, signal)
    },
  })
}

/**
 * The address of a subject that lives *inside* a document.
 *
 * An entity in a GameData catalog, a style in a sheet, a trigger in a library: none of them is a
 * file, so none has a path, and yet each is something a reader opens, bookmarks and comes back to.
 * MK2 minted these ids inside the StarCraft II codec, which meant every other format that wanted
 * the same thing had to invent its own spelling — and two spellings of the same idea cannot be
 * resolved by one host.
 *
 * The shape is `modkit-subject://<scope>/<segment>/<segment>`, each segment percent-encoded so an
 * id survives a name containing a slash. It is stable and restorable: the scope names the codec
 * that can reopen it, and the path is whatever that codec needs to find the subject again.
 */
export function subjectIdFor(scope: string, path: readonly string[]): string {
  if (scope === '') throw new TypeError('a subject id needs a scope')
  if (path.length === 0) throw new TypeError('a subject id needs at least one path segment')
  return `modkit-subject://${encodeURIComponent(scope)}/${path.map(encodeURIComponent).join('/')}`
}

/** Read an id back, or `undefined` when it is not one of ours. */
export function parseSubjectId(
  id: string,
): { readonly scope: string; readonly path: readonly string[] } | undefined {
  const prefix = 'modkit-subject://'
  if (!id.startsWith(prefix)) return undefined
  const segments = id.slice(prefix.length).split('/').filter(part => part !== '')
  if (segments.length < 2) return undefined
  return {
    scope: decodeURIComponent(segments[0]!),
    path: segments.slice(1).map(decodeURIComponent),
  }
}

/**
 * One field of a subject, as a fact a card can show and — when the codec says so — write.
 *
 * The `editable` route is the codec's own operation, the same one a tree row invokes. That is the
 * whole point of putting it here: a subject edited from a card and the same subject edited from a
 * tree go through one writer, so they cannot disagree about what a valid value is.
 */
export interface SubjectFieldInput {
  readonly id: string
  readonly label: string
  readonly value: JsonValue
  readonly type?: FieldType
  readonly unit?: string
  readonly editable?: FieldEditable
  /** Path within the source document, for provenance. */
  readonly semanticPath?: readonly string[]
}

/** Build one group of subject facts from plain fields. */
export function subjectFieldGroup(
  source: AssetSourceRef,
  group: { readonly id: string; readonly label: string },
  fields: readonly SubjectFieldInput[],
): SubjectFactGroupInput {
  return {
    id: group.id,
    label: group.label,
    facts: fields.map(field =>
      Object.freeze({
        id: field.id,
        label: field.label,
        value: field.value,
        provenance: provenanceOf(source, field.semanticPath ?? []),
        ...(field.type === undefined ? {} : { type: field.type }),
        ...(field.unit === undefined ? {} : { unit: field.unit }),
        ...(field.editable === undefined ? {} : { editable: field.editable }),
      }),
    ),
  }
}
