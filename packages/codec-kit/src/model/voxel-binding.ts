/**
 * Format-neutral, synchronous cell-to-rigid-part assignment for model voxelization.
 * Consumes cell centres and a posed surface in the same coordinate frame. Closest-point and
 * barycentric geometry are supplied by the existing geometry owner (Scene/Three), never copied.
 * Preserves triangle order, lower-slot weight ties and raw interpolated weights. The result
 * rejects degenerate/zero-weight assignments by default. An explicit lowest-slot policy retains
 * the former prototype's motion and reports counters/losses instead of hiding that fallback.
 * explicitly loses soft skinning; it is not mesh voxelization, an animation sampler or UV data.
 * Bounds input counts, output allocation and every triangle visit; cancellation is cooperative.
 * Inputs/query callbacks are borrowed for this synchronous call. Geometry-owner allocations
 * and callback runtime are outside the output-byte limit. No Node, Three, renderer or I/O imports.
 */

export type VoxelBindingPoint = readonly [number, number, number]

export interface VoxelBindingTriangle {
  readonly vertices: readonly [number, number, number]
  readonly joints: ArrayLike<number>
  readonly weights: ArrayLike<number>
  readonly influences?: 4 | 8
  /** Conservative Euclidean lower bound in the shared coordinate frame. */
  boundsDistance(point: VoxelBindingPoint): number
  /** Euclidean closest distance; writes barycentric weights (all zero for a degenerate triangle). */
  closestDistance(point: VoxelBindingPoint, barycentric: Float64Array): number
}

export interface VoxelBindingOptions {
  /** Caller policy over raw interpolated weights; no game-specific threshold is inferred. */
  readonly ambiguousWeightThreshold: number
  /** Default rejects unsupported zero weights; the accepted prototype explicitly chooses lowest-slot. */
  readonly unweightedPolicy?: 'reject' | 'lowest-slot'
  readonly maxCells?: number
  readonly maxTriangles?: number
  /** Counts all triangle visits, including bounding-volume skips. Default 100 million. */
  readonly maxTriangleVisits?: number
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
}

export interface VoxelPartBinding {
  /** One original joint slot for every input centre, in the original cell order. */
  readonly slots: Uint32Array
  /** Number below the caller's explicit raw-weight threshold. */
  readonly ambiguousCells: number
  readonly maxSurfaceDistance: number
  /** Maximum nonwinning fraction; 1 for zero total weight. Ownership is never renormalized. */
  readonly maxDroppedWeight: number
  readonly degenerateCells: number
  readonly zeroWeightCells: number
  readonly triangleVisits: number
  readonly losses: readonly (
    'rigid-skin-approximation' | 'degenerate-surface-assignment' | 'unweighted-surface-assignment'
  )[]
}

/** Validate finite allocation/work limits before inspecting large caller-owned data. */
function limit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`invalid ${label}`)
  return value
}

/** Assign each cell to one original joint using nearest-surface interpolated skin weights. */
export function bindVoxelCellsToParts(
  centres: Float32Array | Float64Array,
  triangles: readonly VoxelBindingTriangle[],
  partNodeIds: readonly (string | undefined)[],
  options: VoxelBindingOptions,
): VoxelPartBinding {
  const { signal } = options
  signal?.throwIfAborted()
  const threshold = options.ambiguousWeightThreshold,
    unweightedPolicy = options.unweightedPolicy ?? 'reject'
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new RangeError('invalid ambiguousWeightThreshold')
  if (unweightedPolicy !== 'reject' && unweightedPolicy !== 'lowest-slot')
    throw new TypeError('invalid unweightedPolicy')
  const maxCells = limit(options.maxCells ?? 128 ** 3, 'maxCells')
  const maxTriangles = limit(options.maxTriangles ?? 250_000, 'maxTriangles')
  const maxVisits = limit(options.maxTriangleVisits ?? 100_000_000, 'maxTriangleVisits')
  const maxBytes = limit(options.maxOutputBytes ?? 16 * 1024 ** 2, 'maxOutputBytes')
  if (
    !(centres instanceof Float32Array || centres instanceof Float64Array) ||
    centres.length % 3 !== 0
  )
    throw new TypeError('cell centres must contain xyz triples')
  const count = centres.length / 3
  if (count > maxCells) throw new RangeError('cell binding exceeds maxCells')
  if (triangles.length > maxTriangles) throw new RangeError('cell binding exceeds maxTriangles')
  if (count * 4 > maxBytes) throw new RangeError('cell binding exceeds maxOutputBytes')
  if (partNodeIds.length > 65_536) throw new RangeError('cell binding exceeds joint slot limit')
  if (count > 0 && triangles.length === 0) throw new TypeError('voxel has no source surface')
  // Since traversal is linear, its complete work can be refused before allocating the output.
  if (count > 0 && triangles.length > Math.floor(maxVisits / count))
    throw new RangeError('cell binding exceeds maxTriangleVisits')
  for (let i = 0; i < centres.length; i++) {
    if ((i & 1023) === 0) signal?.throwIfAborted()
    if (!Number.isFinite(centres[i])) throw new TypeError('nonfinite cell centre')
  }
  for (const triangle of triangles) {
    signal?.throwIfAborted()
    const width = triangle.influences ?? 4
    if (
      (width !== 4 && width !== 8) ||
      triangle.vertices.length !== 3 ||
      typeof triangle.boundsDistance !== 'function' ||
      typeof triangle.closestDistance !== 'function'
    )
      throw new TypeError('invalid skin surface triangle')
    for (const vertex of triangle.vertices) {
      if (
        !Number.isSafeInteger(vertex) ||
        vertex < 0 ||
        (vertex + 1) * width > triangle.joints.length ||
        (vertex + 1) * width > triangle.weights.length
      )
        throw new TypeError('skin surface vertex is out of range')
      for (let j = 0; j < width; j++) {
        const at = vertex * width + j,
          slot = triangle.joints[at],
          weight = triangle.weights[at]
        if (
          !Number.isSafeInteger(slot) ||
          slot! < 0 ||
          slot! > 65_535 ||
          !Number.isFinite(weight) ||
          weight! < 0 ||
          weight! > 1
        )
          throw new TypeError('invalid skin surface joint or weight')
      }
    }
  }
  const slots = new Uint32Array(count),
    point: [number, number, number] = [0, 0, 0]
  const bary = new Float64Array(3),
    chosenBary = new Float64Array(3)
  let ambiguousCells = 0,
    degenerateCells = 0,
    zeroWeightCells = 0,
    maxSurfaceDistance = 0,
    maxDroppedWeight = 0,
    triangleVisits = 0
  for (let cell = 0; cell < count; cell++) {
    signal?.throwIfAborted()
    point[0] = centres[cell * 3]!
    point[1] = centres[cell * 3 + 1]!
    point[2] = centres[cell * 3 + 2]!
    let best = Infinity,
      chosen: VoxelBindingTriangle | undefined
    for (const triangle of triangles) {
      if (triangleVisits >= maxVisits)
        throw new RangeError('cell binding exceeds maxTriangleVisits')
      if ((triangleVisits++ & 1023) === 0) signal?.throwIfAborted()
      const lower = triangle.boundsDistance(point)
      if (!Number.isFinite(lower) || lower < 0)
        throw new TypeError('invalid surface bound distance')
      if (lower > best) continue
      bary.fill(NaN)
      const distance = triangle.closestDistance(point, bary)
      if (!Number.isFinite(distance) || distance < 0)
        throw new TypeError('invalid closest surface distance')
      if (distance >= best) continue
      best = distance
      chosen = triangle
      chosenBary.set(bary)
    }
    if (chosen === undefined) throw new TypeError('voxel has no source surface')
    const degenerate = chosenBary.every(v => v === 0)
    if (
      !chosenBary.every(Number.isFinite) ||
      (!degenerate && Math.abs(chosenBary[0]! + chosenBary[1]! + chosenBary[2]! - 1) > 1e-6) ||
      chosenBary.some(v => v < -1e-6 || v > 1 + 1e-6)
    )
      throw new TypeError('invalid surface barycentric weights')
    if (degenerate) degenerateCells++
    if (degenerate && unweightedPolicy === 'reject')
      throw new TypeError('degenerate source surface')
    const votes = new Map<number, number>(),
      width = chosen.influences ?? 4
    for (let v = 0; v < 3; v++)
      for (let j = 0; j < width; j++) {
        const at = chosen.vertices[v]! * width + j,
          slot = chosen.joints[at]!
        const weight = chosen.weights[at]! * chosenBary[v]!
        votes.set(slot, (votes.get(slot) ?? 0) + weight)
      }
    const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    const winner = ranked[0]!,
      total = ranked.reduce((sum, entry) => sum + entry[1], 0)
    if (total < 0 || !Number.isFinite(total)) throw new TypeError('invalid total skin weight')
    if (total === 0) zeroWeightCells++
    if (total === 0 && unweightedPolicy === 'reject')
      throw new TypeError('unweighted source surface')
    if (!partNodeIds[winner[0]])
      throw new TypeError('unbound/identity skin slot cannot animate a cell')
    slots[cell] = winner[0]
    if (winner[1] < threshold) ambiguousCells++
    maxSurfaceDistance = Math.max(maxSurfaceDistance, best)
    maxDroppedWeight = Math.max(
      maxDroppedWeight,
      total === 0 ? 1 : Math.max(0, total - winner[1]) / total,
    )
  }
  signal?.throwIfAborted()
  return {
    slots,
    ambiguousCells,
    maxSurfaceDistance,
    maxDroppedWeight,
    degenerateCells,
    zeroWeightCells,
    triangleVisits,
    losses: [
      'rigid-skin-approximation',
      ...(degenerateCells > 0 ? ['degenerate-surface-assignment' as const] : []),
      ...(zeroWeightCells > 0 ? ['unweighted-surface-assignment' as const] : []),
    ],
  }
}
