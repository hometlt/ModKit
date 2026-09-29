/**
 * The neighbourhood of some nodes in a relation graph: what a graph view drawn from a root (a unit,
 * then what it uses and what uses it) and an assistant's traversal both need. One walk over any
 * `RelationGraphSource`, bounded on every side — pages read, nodes, edges — and honest about where
 * it stopped: a capped walk is never presented as the whole neighbourhood.
 */
import type {
  Page,
  PageRequest,
  RelationGraphCompleteness,
  RelationGraphEdge,
  RelationGraphNode,
  RelationGraphSource,
} from './asset-capabilities/data-sources.js'

export interface RelationGraphNeighbourhoodRequest {
  /** Node ids the walk starts from (1–64). */
  readonly roots: readonly string[]
  /** Edges followed away from a root, 1–8 (a graph view offers 1–4). */
  readonly depth: number
  readonly direction: 'outgoing' | 'incoming' | 'both'
  /** Enter only nodes of these `type` buckets; a root is always kept. Absent: every type. */
  readonly types?: readonly string[]
  readonly maxNodes: number
  readonly maxEdges: number
  /** Items read from each listing (nodes, edges) at most. */
  readonly scanLimit: number
}

export interface RelationGraphScan {
  readonly read: number
  /** The listing ended within the scan limit. */
  readonly exhausted: boolean
  /** The source repeated a cursor; the walk stopped reading it. */
  readonly invalidCursor: boolean
}

export interface RelationGraphNeighbourhood {
  readonly snapshotId: string
  readonly nodes: readonly RelationGraphNode[]
  readonly edges: readonly RelationGraphEdge[]
  /** Nodes the edges name that the node listing did not hold. */
  readonly missingNodeIds: readonly string[]
  /** `complete` only when the source is, both listings were read to the end and no limit hit. */
  readonly completeness: RelationGraphCompleteness
  /** The node or edge limit cut the walk short. */
  readonly capped: boolean
  readonly scanned: { readonly nodes: RelationGraphScan; readonly edges: RelationGraphScan }
  /** The source's own reason it is not complete, when it gave one. */
  readonly reason?: string
}

const PAGE_SIZE = 1024
const MAX_PAGES = 4096

function limit(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`relation graph ${name} must be an integer 1..${maximum}`)
}

async function scan<Value>(
  read: (page: PageRequest, signal?: AbortSignal) => Promise<Page<Value>>,
  scanLimit: number,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly Value[]; readonly scan: RelationGraphScan }> {
  const items: Value[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; items.length < scanLimit && pages < MAX_PAGES; pages += 1) {
    signal?.throwIfAborted()
    const page = await read(
      {
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(PAGE_SIZE, scanLimit - items.length),
      },
      signal,
    )
    items.push(...page.items.slice(0, scanLimit - items.length))
    if (page.nextCursor === undefined)
      return { items, scan: { read: items.length, exhausted: true, invalidCursor: false } }
    if (seen.has(page.nextCursor) || page.nextCursor === cursor)
      return { items, scan: { read: items.length, exhausted: false, invalidCursor: true } }
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return { items, scan: { read: items.length, exhausted: false, invalidCursor: false } }
}

/** Walk out from `roots` over `source`, breadth first, within the request's limits. */
export async function relationGraphNeighbourhood(
  source: RelationGraphSource,
  request: RelationGraphNeighbourhoodRequest,
  signal?: AbortSignal,
): Promise<RelationGraphNeighbourhood> {
  limit(request.roots.length, 'root count', 64)
  limit(request.depth, 'depth', 8)
  limit(request.maxNodes, 'maxNodes')
  limit(request.maxEdges, 'maxEdges')
  limit(request.scanLimit, 'scanLimit')
  if (!['outgoing', 'incoming', 'both'].includes(request.direction))
    throw new RangeError(`relation graph direction «${String(request.direction)}» is unknown`)
  const summary = await source.summary(signal)
  const nodeScan = await scan((page, s) => source.nodes(page, s), request.scanLimit, signal)
  const edgeScan = await scan((page, s) => source.edges(page, s), request.scanLimit, signal)
  const byId = new Map(nodeScan.items.map(node => [node.id, node]))
  const types = request.types === undefined ? undefined : new Set(request.types)
  // a node the listing does not hold has no known type; it is entered and reported as missing
  const enters = (id: string) => {
    const type = byId.get(id)?.type
    return types === undefined || type === undefined || types.has(type)
  }
  const kept = new Set(request.roots)
  const edges: RelationGraphEdge[] = []
  const edgeKeys = new Set<string>()
  let frontier = new Set(request.roots)
  let capped = false
  for (let level = 0; level < request.depth && frontier.size > 0; level += 1) {
    const next = new Set<string>()
    for (const edge of edgeScan.items) {
      const outgoing = request.direction !== 'incoming' && frontier.has(edge.from)
      const incoming = request.direction !== 'outgoing' && frontier.has(edge.to)
      if (!outgoing && !incoming) continue
      const other = outgoing ? edge.to : edge.from
      if (!kept.has(other)) {
        if (!enters(other)) continue
        if (kept.size >= request.maxNodes) {
          capped = true
          continue
        }
        kept.add(other)
        next.add(other)
      }
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.role ?? ''}\u0000${edge.dead === true}`
      if (edgeKeys.has(key)) continue
      if (edges.length >= request.maxEdges) {
        capped = true
        continue
      }
      edgeKeys.add(key)
      edges.push(edge)
    }
    frontier = next
  }
  const nodes = [...kept].flatMap(id => {
    const node = byId.get(id)
    return node === undefined ? [] : [node]
  })
  const partial =
    summary.completeness === 'partial' || nodeScan.scan.invalidCursor || edgeScan.scan.invalidCursor
  const complete =
    summary.completeness === 'complete' &&
    nodeScan.scan.exhausted &&
    edgeScan.scan.exhausted &&
    !capped
  return {
    snapshotId: summary.snapshotId,
    nodes,
    edges,
    missingNodeIds: [...kept].filter(id => !byId.has(id)),
    completeness: complete ? 'complete' : partial ? 'partial' : 'capped',
    capped,
    scanned: { nodes: nodeScan.scan, edges: edgeScan.scan },
    ...(summary.reason === undefined ? {} : { reason: summary.reason }),
  }
}
