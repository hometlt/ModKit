/**
 * Bounded, domain-neutral analysis for isolating one shared graph target.
 *
 * The helper deliberately does not decide what an edge means. A format provider classifies
 * references as rewritable, ownership, inheritance, or another domain-specific relation before
 * calling it. The result is only an impact/rewire recipe; native cloning and serialization remain
 * with the format provider and committing remains with the host.
 */

export interface GraphIsolationEdge {
  /** Stable inside the analyzed snapshot. */
  readonly id: string
  readonly from: string
  readonly to: string
  readonly relation: string
  /** Only explicitly rewritable edges may appear in the rewire plan. */
  readonly rewritable: boolean
}

export interface GraphIsolationRequest {
  readonly schemaVersion: 1
  readonly ownerId: string
  readonly targetId: string
  readonly edges: readonly GraphIsolationEdge[]
  /** False means missing edges could hide another owner, so isolation cannot be claimed safe. */
  readonly complete: boolean
  readonly maxEdges: number
  /** Restrict rewiring to the exact owner edges selected by the domain/user. */
  readonly selectedEdgeIds?: readonly string[]
}

export interface GraphIsolationReferrer {
  readonly nodeId: string
  readonly edgeIds: readonly string[]
}

export type GraphIsolationAnalysis =
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'unavailable'
      readonly ownerId: string
      readonly targetId: string
      readonly reason: string
    }>
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'ready'
      readonly ownerId: string
      readonly targetId: string
      readonly shared: boolean
      readonly referrers: readonly GraphIsolationReferrer[]
      readonly otherReferrerIds: readonly string[]
      readonly rewireEdgeIds: readonly string[]
    }>

function requiredId(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

/**
 * Reports every distinct direct referrer of `targetId` and selects only the requested rewritable
 * edges from `ownerId`. Input order cannot change the result, which keeps previews deterministic.
 */
export function analyzeGraphIsolation(request: GraphIsolationRequest): GraphIsolationAnalysis {
  if (request.schemaVersion !== 1) throw new TypeError('graph isolation requires schemaVersion 1')
  const ownerId = requiredId(request.ownerId, 'ownerId')
  const targetId = requiredId(request.targetId, 'targetId')
  if (!Number.isSafeInteger(request.maxEdges) || request.maxEdges <= 0) {
    throw new TypeError('maxEdges must be a positive safe integer')
  }
  if (request.edges.length > request.maxEdges) {
    throw new RangeError(`graph isolation edge limit exceeded (${request.maxEdges})`)
  }
  if (!request.complete) {
    return Object.freeze({
      schemaVersion: 1,
      state: 'unavailable',
      ownerId,
      targetId,
      reason: 'relation graph is incomplete; another referrer may be missing',
    })
  }

  const selected =
    request.selectedEdgeIds === undefined ? undefined : new Set(request.selectedEdgeIds)
  if (selected?.size !== request.selectedEdgeIds?.length) {
    throw new TypeError('selectedEdgeIds must not contain duplicates')
  }
  const ids = new Set<string>()
  const incoming = new Map<string, string[]>()
  const rewritableOwnerEdges: string[] = []
  for (const edge of request.edges) {
    requiredId(edge.id, 'edge.id')
    requiredId(edge.from, 'edge.from')
    requiredId(edge.to, 'edge.to')
    requiredId(edge.relation, 'edge.relation')
    if (ids.has(edge.id)) throw new TypeError(`duplicate graph edge id: ${edge.id}`)
    ids.add(edge.id)
    if (edge.to !== targetId) continue
    const edgeIds = incoming.get(edge.from) ?? []
    edgeIds.push(edge.id)
    incoming.set(edge.from, edgeIds)
    if (
      edge.from === ownerId &&
      edge.rewritable &&
      (selected === undefined || selected.has(edge.id))
    ) {
      rewritableOwnerEdges.push(edge.id)
    }
  }
  if (selected !== undefined) {
    for (const edgeId of selected) {
      if (!ids.has(edgeId)) throw new RangeError(`selected graph edge does not exist: ${edgeId}`)
    }
  }
  if (rewritableOwnerEdges.length === 0) {
    return Object.freeze({
      schemaVersion: 1,
      state: 'unavailable',
      ownerId,
      targetId,
      reason: `${ownerId} has no selected rewritable edge to ${targetId}`,
    })
  }

  const referrers = Object.freeze(
    [...incoming.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, edgeIds]) =>
        Object.freeze({ nodeId, edgeIds: Object.freeze([...edgeIds].sort()) }),
      ),
  )
  const otherReferrerIds = Object.freeze(
    referrers.map(referrer => referrer.nodeId).filter(nodeId => nodeId !== ownerId),
  )
  return Object.freeze({
    schemaVersion: 1,
    state: 'ready',
    ownerId,
    targetId,
    shared: otherReferrerIds.length > 0,
    referrers,
    otherReferrerIds,
    rewireEdgeIds: Object.freeze([...rewritableOwnerEdges].sort()),
  })
}
