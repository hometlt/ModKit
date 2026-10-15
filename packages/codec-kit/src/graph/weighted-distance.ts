/** Shared in-process weighted distance kernel, extracted from SC2 navigation/grid.ts.
 * Stable lazy-duplicate queue preserves source order, strict improvements and pop-only limits.
 * Optional fixed-capacity budgets qualify finite nonnegative graph inputs; no game policy or wire ABI.
 */
export interface DistanceBudgets {
  readonly queueEntries: number
  readonly pushes: number
  readonly pops: number
  readonly expansions: number
  readonly edges: number
  readonly comparisons: number
  readonly allocatedBytes: number
}
export interface DistanceCounters {
  pushes: number
  pops: number
  expansions: number
  edges: number
  comparisons: number
  peakQueue: number
  allocatedBytes: number
}
export interface WeightedDistanceOptions {
  readonly limit?: number
  readonly acceptSource?: (node: number, sourceIndex: number) => boolean
  readonly onSource?: (node: number, sourceIndex: number) => void
  readonly onImprove?: (from: number, to: number) => void
  readonly budgets?: DistanceBudgets
  readonly signal?: AbortSignal
}

/** A refusal never exposes a partially computed field as a successful result. */
export class DistanceBudgetError extends RangeError {
  constructor(readonly reason: string) {
    super(`Weighted distance: ${reason}`)
  }
}

/** Stable binary min-heap. Bounded mode uses exactly 20 bytes per queue entry without resize. */
class DistanceHeap {
  private readonly keys: number[] | Float64Array
  private readonly nodes: number[] | Uint32Array
  private readonly order: number[] | Float64Array
  private count = 0
  private sequence = 0
  constructor(
    private readonly stats: DistanceCounters,
    private readonly budgets?: DistanceBudgets,
  ) {
    const capacity = budgets?.queueEntries
    this.keys = capacity === undefined ? [] : new Float64Array(capacity)
    this.nodes = capacity === undefined ? [] : new Uint32Array(capacity)
    this.order = capacity === undefined ? [] : new Float64Array(capacity)
  }
  get size(): number {
    return this.count
  }
  /** Insert in FIFO order among equal keys; check before writing any queue slot. */
  push(node: number, key: number): void {
    if (
      this.budgets &&
      (this.count >= this.budgets.queueEntries || this.stats.pushes >= this.budgets.pushes)
    )
      throw new DistanceBudgetError('queue/push budget exceeded')
    const index = this.count++
    this.keys[index] = key
    this.nodes[index] = node
    this.order[index] = this.sequence++
    this.stats.pushes++
    this.stats.peakQueue = Math.max(this.stats.peakQueue, this.count)
    this.up(index)
  }
  /** Remove the smallest key, preserving the original SC2 heap ordering. */
  pop(): readonly [number, number] {
    if (this.budgets && this.stats.pops >= this.budgets.pops)
      throw new DistanceBudgetError('pop budget exceeded')
    const node = this.nodes[0]!,
      key = this.keys[0]!,
      last = --this.count
    if (last > 0) {
      this.nodes[0] = this.nodes[last]!
      this.keys[0] = this.keys[last]!
      this.order[0] = this.order[last]!
      this.down(0)
    }
    this.stats.pops++
    return [node, key]
  }
  /** Count comparator invocations, not individual arithmetic/comparison operators. */
  private less(a: number, b: number): boolean {
    if (this.budgets && this.stats.comparisons >= this.budgets.comparisons)
      throw new DistanceBudgetError('comparison budget exceeded')
    this.stats.comparisons++
    return (
      this.keys[a]! < this.keys[b]! ||
      (this.keys[a] === this.keys[b] && this.order[a]! < this.order[b]!)
    )
  }
  /** Exchange a complete queue record. */
  private swap(a: number, b: number): void {
    ;[this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
    ;[this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!]
    ;[this.order[a], this.order[b]] = [this.order[b]!, this.order[a]!]
  }
  /** Restore ordering after insertion. */
  private up(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!this.less(index, parent)) return
      this.swap(index, parent)
      index = parent
    }
  }
  /** Restore ordering after root removal. */
  private down(index: number): void {
    for (;;) {
      const left = index * 2 + 1,
        right = left + 1
      let best = index
      if (left < this.count && this.less(left, best)) best = left
      if (right < this.count && this.less(right, best)) best = right
      if (best === index) return
      this.swap(index, best)
      index = best
    }
  }
}

/** Run the single relaxation loop; callers retain neighbor enumeration and source/owner policy. */
export function weightedDistanceField(
  nodeCount: number,
  sources: readonly number[],
  visitEdges: (node: number, emit: (next: number, weight: number) => void) => void,
  options: WeightedDistanceOptions = {},
): { readonly distances: Float64Array; readonly counters: Readonly<DistanceCounters> } {
  const budgets = options.budgets
  if (options.signal?.aborted) throw new DistanceBudgetError('aborted')
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0 || nodeCount > 0xffffffff)
    throw new DistanceBudgetError('invalid node count')
  const bytes = 8 * nodeCount + (budgets === undefined ? 0 : 20 * budgets.queueEntries)
  if (budgets) {
    for (const value of Object.values(budgets))
      if (!Number.isSafeInteger(value) || value < 0) throw new DistanceBudgetError('invalid budget')
    if (!Number.isSafeInteger(bytes) || bytes > budgets.allocatedBytes)
      throw new DistanceBudgetError('allocation budget exceeded')
  }
  const counters: DistanceCounters = {
    pushes: 0,
    pops: 0,
    expansions: 0,
    edges: 0,
    comparisons: 0,
    peakQueue: 0,
    allocatedBytes: bytes,
  }
  const distances = new Float64Array(nodeCount).fill(Infinity)
  const heap = new DistanceHeap(counters, budgets)
  for (let index = 0; index < sources.length; index++) {
    const node = sources[index]!
    if (node < 0 || node >= nodeCount || options.acceptSource?.(node, index) === false) continue
    if (budgets && !Number.isInteger(node)) throw new DistanceBudgetError('invalid source')
    distances[node] = 0
    options.onSource?.(node, index)
    heap.push(node, 0)
  }
  while (heap.size > 0) {
    if (options.signal?.aborted) throw new DistanceBudgetError('aborted')
    const [node, key] = heap.pop()
    if (key > distances[node]! || key > (options.limit ?? Infinity)) continue
    if (budgets && counters.expansions >= budgets.expansions)
      throw new DistanceBudgetError('expansion budget exceeded')
    counters.expansions++
    visitEdges(node, (next, weight) => {
      if (options.signal?.aborted) throw new DistanceBudgetError('aborted')
      if (
        budgets &&
        (counters.edges >= budgets.edges ||
          !Number.isInteger(next) ||
          next < 0 ||
          next >= nodeCount ||
          !Number.isFinite(weight) ||
          weight < 0)
      )
        throw new DistanceBudgetError('edge budget/domain exceeded')
      counters.edges++
      const candidate = key + weight
      if (budgets && !Number.isFinite(candidate))
        throw new DistanceBudgetError('non-finite candidate')
      if (candidate < distances[next]!) {
        distances[next] = candidate
        options.onImprove?.(node, next)
        heap.push(next, candidate)
      }
    })
    if (options.signal?.aborted) throw new DistanceBudgetError('aborted')
  }
  return { distances, counters }
}
