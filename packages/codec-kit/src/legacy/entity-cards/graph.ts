/**
 * The relation graph, separated from where its edges come from.
 *
 * `relation-graph-data.ts` in the VS Code app imported `SC2Mod`, `CatalogEntity`, and
 * `buildRelations` — so the *model* was game-neutral in shape while being welded to one game by
 * its loading. An edge provider is that seam: the game answers "what does this subject touch",
 * and everything below — traversal depth, direction, type counts, caps — is arithmetic.
 *
 * The same model backs both the card's `relations` section and the standalone graph panel.
 * See `docs/tasks-active/entity-cards-strings/PLAN_wiki_subject_model.md` (W7).
 */

import type { CardLink, SubjectRef } from './model.js'

export type RelationDirection = 'out' | 'in' | 'both'

/** One edge, as the game reports it. */
export interface RelationEdge {
  readonly from: SubjectRef
  readonly to: SubjectRef
  /** What kind of reference this is — the game's own word for it. */
  readonly relation: string
  readonly label?: string
}

/** What a game implements so its data can be traversed as a graph. */
export interface RelationEdgeProvider {
  /** Edges where `subject` is the source. */
  outgoing(subject: SubjectRef): readonly RelationEdge[]
  /** Edges where `subject` is the target. */
  incoming(subject: SubjectRef): readonly RelationEdge[]
  /** Display label for a subject; falls back to its id when the game has none. */
  label?(subject: SubjectRef): string | undefined
}

export interface RelationGraphOptions {
  readonly depth?: number
  readonly direction?: RelationDirection
  /** Stop after this many nodes; the result reports whether it was reached. */
  readonly maxNodes?: number
  /** Keep only these subject kinds. Empty or absent means all. */
  readonly kinds?: readonly string[]
}

export interface RelationGraphNode extends SubjectRef {
  readonly label: string
  /** Hops from the root. The root itself is 0. */
  readonly depth: number
}

export interface RelationGraphView {
  readonly root: SubjectRef
  readonly nodes: readonly RelationGraphNode[]
  readonly edges: readonly RelationEdge[]
  /** How many nodes of each kind the view holds, descending by count then kind. */
  readonly kindCounts: readonly { readonly kind: string; readonly count: number }[]
  /** True when `maxNodes` cut the traversal short, so a host can say so. */
  readonly truncated: boolean
}

function keyOf(subject: SubjectRef): string {
  return `${subject.kind} ${subject.id}`
}

/**
 * Breadth-first traversal from `root`, so `depth` is the true shortest hop count and a `maxNodes`
 * cut keeps the nearest neighbourhood rather than an arbitrary branch.
 */
export function buildRelationGraphView(
  root: SubjectRef,
  provider: RelationEdgeProvider,
  options: RelationGraphOptions = {},
): RelationGraphView {
  const maxDepth = options.depth ?? 1
  const direction = options.direction ?? 'both'
  const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : undefined

  const labelOf = (subject: SubjectRef): string => provider.label?.(subject) ?? subject.id

  const nodes = new Map<string, RelationGraphNode>()
  const edges: RelationEdge[] = []
  const seenEdges = new Set<string>()
  let truncated = false

  nodes.set(keyOf(root), { ...root, label: labelOf(root), depth: 0 })

  let frontier: SubjectRef[] = [root]
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: SubjectRef[] = []
    for (const subject of frontier) {
      const outgoing = direction === 'in' ? [] : provider.outgoing(subject)
      const incoming = direction === 'out' ? [] : provider.incoming(subject)
      for (const edge of [...outgoing, ...incoming]) {
        const other = keyOf(edge.from) === keyOf(subject) ? edge.to : edge.from
        if (kinds && !kinds.has(other.kind)) continue

        const edgeKey = `${keyOf(edge.from)}|${edge.relation}|${keyOf(edge.to)}`
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey)
          edges.push(edge)
        }

        const otherKey = keyOf(other)
        if (nodes.has(otherKey)) continue
        if (nodes.size >= maxNodes) {
          truncated = true
          continue
        }
        nodes.set(otherKey, { ...other, label: labelOf(other), depth: depth + 1 })
        next.push(other)
      }
    }
    frontier = next
  }

  const counts = new Map<string, number>()
  for (const node of nodes.values()) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)

  return {
    root,
    nodes: [...nodes.values()],
    edges,
    kindCounts: [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    truncated,
  }
}

/** The graph as the card's `relations` section wants it: links grouped by kind, per direction. */
export function relationGroupsOf(
  subject: SubjectRef,
  provider: RelationEdgeProvider,
): { outgoing: RelationGraphGroups; incoming: RelationGraphGroups } {
  const group = (edges: readonly RelationEdge[], pick: (edge: RelationEdge) => SubjectRef) => {
    const byKind = new Map<string, CardLink[]>()
    for (const edge of edges) {
      const other = pick(edge)
      const links = byKind.get(other.kind) ?? []
      links.push({ ...other, label: edge.label ?? provider.label?.(other) ?? other.id })
      byKind.set(other.kind, links)
    }
    return [...byKind.entries()]
      .map(([kind, links]) => ({ kind, total: links.length, links }))
      .sort((a, b) => a.kind.localeCompare(b.kind))
  }

  return {
    outgoing: group(provider.outgoing(subject), edge => edge.to),
    incoming: group(provider.incoming(subject), edge => edge.from),
  }
}

export type RelationGraphGroups = readonly {
  readonly kind: string
  readonly total: number
  readonly links: readonly CardLink[]
}[]
