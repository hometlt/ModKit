import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'
import { invertMaterialFrame } from '../materials/frame.js'

export type ProjectorVec3 = readonly [number, number, number]
/** Prepared source-space frame. Plane ordering, float32 scratch and UV equations correspond to
 * pinned rendering-3d/webgl-core appendLiveProjectedReceivers (see provenance.json). */
export interface ProjectorFrame {
  readonly projectionType: 'orthographic' | 'perspective'
  readonly origin: ProjectorVec3
  readonly rightAxis: ProjectorVec3
  readonly upAxis: ProjectorVec3
  readonly forwardAxis: ProjectorVec3
  readonly near: number
  readonly far: number
  readonly left: number
  readonly rightExtent: number
  readonly bottom: number
  readonly top: number
  readonly tangentX: number
  readonly tangentY: number
}
export interface ProjectorReceiver {
  readonly primitive: SceneRendererPrimitive
  /** Source positions -> effect source space, including primitive.transform when present. */
  readonly transform: readonly number[]
}
interface Options {
  readonly maxBytes: number
  readonly maxTriangles: number
  readonly signal?: AbortSignal
}
const dot = (x: number, y: number, z: number, v: ProjectorVec3) => x * v[0] + y * v[1] + z * v[2]
const clamp = (value: number) => Math.min(1, Math.max(0, value))
// Every projector of a frame validates the same receiver arrays, and the next frame receives the
// same retained geometry. These scans are O(geometry) and their inputs are immutable render buffers,
// so one scan per buffer replaces one scan per projector per frame. Budget and shape checks below
// stay per call: they depend on the caller's remaining budget, not on the buffer.
const finiteReceiverPositions = new WeakSet<Float32Array>()
const highestReceiverIndex = new WeakMap<Uint32Array, number>()

/**
 * Uniform grid over one receiver primitive, in receiver space, on its two widest axes. A map places
 * each decal over a few of its ~76 000 terrain triangles; scanning all of them twice per projector per
 * frame dominated animated world frames. Receivers are immutable render buffers, so the grid is built
 * once per buffer. A query returns the triangle offsets (into the index array, step 3) whose bounds
 * touch the box, in ascending order: the clip loop then visits exactly the triangles the full scan
 * would have kept, in the same order, and emits identical output.
 */
interface ReceiverGrid {
  query(minimum: readonly number[], maximum: readonly number[]): Uint32Array
}
const RECEIVER_GRID_MIN_TRIANGLES = 1_024
const receiverGrids = new WeakMap<
  Float32Array,
  { readonly indices: Uint32Array | undefined; readonly grid: ReceiverGrid | undefined }[]
>()

function receiverGrid(primitive: SceneRendererPrimitive): ReceiverGrid | undefined {
  const positions = primitive.positions
  const built = receiverGrids.get(positions)
  const cached = built?.find(entry => entry.indices === primitive.indices)
  if (cached !== undefined) return cached.grid
  const grid = createReceiverGrid(positions, primitive.indices)
  receiverGrids.set(positions, [...(built ?? []), { indices: primitive.indices, grid }])
  return grid
}

function createReceiverGrid(
  positions: Float32Array,
  indices: Uint32Array | undefined,
): ReceiverGrid | undefined {
  const count = indices?.length ?? positions.length / 3
  const triangles = Math.floor(count / 3)
  if (triangles < RECEIVER_GRID_MIN_TRIANGLES) return undefined
  const vertexOf = (offset: number) => (indices?.[offset] ?? offset) * 3
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < triangles * 3; offset++) {
    const vertex = vertexOf(offset)
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[vertex + axis]!
      if (value < low[axis]!) low[axis] = value
      if (value > high[axis]!) high[axis] = value
    }
  }
  const extents = [0, 1, 2].map(axis => high[axis]! - low[axis]!)
  const axes = [0, 1, 2].sort((a, b) => extents[b]! - extents[a]!).slice(0, 2) as [number, number]
  const [u, v] = axes
  const spanU = Math.max(extents[u]!, 1e-6),
    spanV = Math.max(extents[v]!, 1e-6)
  // About two triangles per cell, at most 512 cells a side.
  const targetCells = Math.max(1, triangles / 2)
  const columns = Math.max(1, Math.min(512, Math.round(Math.sqrt((targetCells * spanU) / spanV))))
  const rows = Math.max(1, Math.min(512, Math.round(targetCells / columns)))
  const cellU = spanU / columns,
    cellV = spanV / rows
  const cellColumn = (value: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor((value - low[u]!) / cellU)))
  const cellRow = (value: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor((value - low[v]!) / cellV)))
  const triangleCells = (offset: number) => {
    const a = vertexOf(offset),
      b = vertexOf(offset + 1),
      c = vertexOf(offset + 2)
    return [
      cellColumn(Math.min(positions[a + u]!, positions[b + u]!, positions[c + u]!)),
      cellColumn(Math.max(positions[a + u]!, positions[b + u]!, positions[c + u]!)),
      cellRow(Math.min(positions[a + v]!, positions[b + v]!, positions[c + v]!)),
      cellRow(Math.max(positions[a + v]!, positions[b + v]!, positions[c + v]!)),
    ] as const
  }
  const cellStart = new Uint32Array(columns * rows + 1)
  for (let offset = 0; offset < triangles * 3; offset += 3) {
    const [c0, c1, r0, r1] = triangleCells(offset)
    for (let row = r0; row <= r1; row++)
      for (let column = c0; column <= c1; column++) cellStart[row * columns + column + 1]! += 1
  }
  for (let cell = 0; cell < columns * rows; cell++) cellStart[cell + 1]! += cellStart[cell]!
  const cellTriangles = new Uint32Array(cellStart[columns * rows]!)
  const fill = cellStart.slice(0, columns * rows)
  for (let offset = 0; offset < triangles * 3; offset += 3) {
    const [c0, c1, r0, r1] = triangleCells(offset)
    for (let row = r0; row <= r1; row++)
      for (let column = c0; column <= c1; column++)
        cellTriangles[fill[row * columns + column]!++] = offset
  }
  const stamps = new Uint32Array(triangles)
  let generation = 0
  return Object.freeze({
    query(minimum: readonly number[], maximum: readonly number[]): Uint32Array {
      if (
        maximum[u]! < low[u]! ||
        minimum[u]! > high[u]! ||
        maximum[v]! < low[v]! ||
        minimum[v]! > high[v]!
      )
        return new Uint32Array(0)
      generation += 1
      if (generation === 0xffffffff) {
        stamps.fill(0)
        generation = 1
      }
      const found: number[] = []
      for (let row = cellRow(minimum[v]!); row <= cellRow(maximum[v]!); row++)
        for (let column = cellColumn(minimum[u]!); column <= cellColumn(maximum[u]!); column++) {
          const cell = row * columns + column
          for (let entry = cellStart[cell]!; entry < cellStart[cell + 1]!; entry++) {
            const offset = cellTriangles[entry]!
            if (stamps[offset / 3] === generation) continue
            stamps[offset / 3] = generation
            found.push(offset)
          }
        }
      return Uint32Array.from(found).sort()
    },
  })
}

/**
 * One pass keeps the clipped vertices and makes the output to its exact size. Unlike the old
 * live-buffer preview, exhaustion rejects the frame instead of publishing silently truncated
 * receiver geometry.
 */
export function clipProjectorReceivers(
  frame: ProjectorFrame,
  receivers: readonly ProjectorReceiver[],
  options: Options,
) {
  for (const value of [options.maxBytes, options.maxTriangles])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('invalid projector budget')
  if (options.maxBytes < 480) throw new RangeError('projector scratch exceeds budget')
  for (const vector of [frame.origin, frame.rightAxis, frame.upAxis, frame.forwardAxis])
    for (const value of vector)
      if (!Number.isFinite(value)) throw new TypeError('invalid projector frame')
  for (const value of [
    frame.near,
    frame.far,
    frame.left,
    frame.rightExtent,
    frame.bottom,
    frame.top,
    frame.tangentX,
    frame.tangentY,
  ])
    if (!Number.isFinite(value)) throw new TypeError('invalid projector frame')
  if (
    frame.near <= 0 ||
    frame.far < frame.near ||
    (frame.projectionType === 'perspective'
      ? frame.tangentX <= 0 || frame.tangentY <= 0
      : frame.rightExtent <= frame.left || frame.top <= frame.bottom)
  )
    throw new TypeError('invalid projector volume')
  let triangles = 0
  for (const { primitive, transform } of receivers) {
    options.signal?.throwIfAborted()
    if (
      primitive.topology !== 'triangles' ||
      primitive.positions.length % 3 !== 0 ||
      transform.length !== 16 ||
      transform[3] !== 0 ||
      transform[7] !== 0 ||
      transform[11] !== 0 ||
      transform[15] !== 1 ||
      !transform.every(Number.isFinite)
    )
      throw new TypeError('projector requires finite affine triangle receivers')
    const count = primitive.indices?.length ?? primitive.positions.length / 3
    if (count % 3 !== 0 || (triangles += count / 3) > options.maxTriangles)
      throw new RangeError('projector receiver work exceeds budget')
    if (primitive.indices !== undefined) {
      let highest = highestReceiverIndex.get(primitive.indices)
      if (highest === undefined) {
        highest = -1
        for (const index of primitive.indices) if (index > highest) highest = index
        highestReceiverIndex.set(primitive.indices, highest)
      }
      if (highest >= primitive.positions.length / 3)
        throw new RangeError('projector receiver index absent')
    }
    if (!finiteReceiverPositions.has(primitive.positions)) {
      for (const value of primitive.positions)
        if (!Number.isFinite(value)) throw new TypeError('nonfinite projector receiver')
      finiteReceiverPositions.add(primitive.positions)
    }
  }
  const first = new Float32Array(60),
    second = new Float32Array(60)
  // A terrain decal covers only a few cells. Reject distant triangles in receiver space before
  // transforming/clipping them; still validate the entire input and enforce its work budget above.
  const bounded = receivers.map(receiver => {
    const inverse = invertMaterialFrame(receiver.transform)
    const minimum = [Infinity, Infinity, Infinity],
      maximum = [-Infinity, -Infinity, -Infinity]
    for (const depth of [frame.near, frame.far]) {
      for (const x of frame.projectionType === 'perspective'
        ? [-depth * frame.tangentX, depth * frame.tangentX]
        : [frame.left, frame.rightExtent]) {
        for (const y of frame.projectionType === 'perspective'
          ? [-depth * frame.tangentY, depth * frame.tangentY]
          : [frame.bottom, frame.top]) {
          const point = frame.origin.map(
            (value, axis) =>
              value +
              frame.rightAxis[axis]! * x +
              frame.upAxis[axis]! * y +
              frame.forwardAxis[axis]! * depth,
          )
          for (let axis = 0; axis < 3; axis++) {
            const value =
              inverse[axis]! * point[0]! +
              inverse[4 + axis]! * point[1]! +
              inverse[8 + axis]! * point[2]! +
              inverse[12 + axis]!
            minimum[axis] = Math.min(minimum[axis]!, value - 1e-5)
            maximum[axis] = Math.max(maximum[axis]!, value + 1e-5)
          }
        }
      }
    }
    return {
      ...receiver,
      minimum,
      maximum,
      candidates: receiverGrid(receiver.primitive)?.query(minimum, maximum),
    }
  })
  // The scratch polygons hold finite values only: a vertex is checked once it is written (below),
  // and clipping writes convex combinations of two of them. The receivers' positions and
  // transforms were checked above, so the loops read them directly.
  const distance = (vertices: Float32Array, vertex: number, plane: number): number => {
    const x = vertices[vertex * 6 + 3]!,
      y = vertices[vertex * 6 + 4]!,
      z = vertices[vertex * 6 + 5]!
    if (plane === 0) return z - frame.near
    if (plane === 1) return frame.far - z
    if (frame.projectionType === 'perspective') {
      if (plane === 2) return x + z * frame.tangentX
      if (plane === 3) return z * frame.tangentX - x
      if (plane === 4) return y + z * frame.tangentY
      return z * frame.tangentY - y
    }
    if (plane === 2) return x - frame.left
    if (plane === 3) return frame.rightExtent - x
    if (plane === 4) return y - frame.bottom
    return frame.top - y
  }
  const clipped = (): number => {
    let input = first,
      output = second,
      count = 3
    for (let plane = 0; plane < 6; plane++) {
      let nextCount = 0,
        previous = count - 1,
        previousDistance = distance(input, previous, plane)
      for (let current = 0; current < count; current++) {
        const currentDistance = distance(input, current, plane)
        if (currentDistance >= 0 !== previousDistance >= 0) {
          if (nextCount >= 10) throw new RangeError('projector clipping capacity exceeded')
          const denominator = previousDistance - currentDistance
          const factor = Math.abs(denominator) > 1e-12 ? previousDistance / denominator : 0
          for (let axis = 0; axis < 6; axis++) {
            const start = input[previous * 6 + axis]!
            output[nextCount * 6 + axis] = start + (input[current * 6 + axis]! - start) * factor
          }
          nextCount++
        }
        if (currentDistance >= 0) {
          if (nextCount >= 10) throw new RangeError('projector clipping capacity exceeded')
          for (let axis = 0; axis < 6; axis++)
            output[nextCount * 6 + axis] = input[current * 6 + axis]!
          nextCount++
        }
        previous = current
        previousDistance = currentDistance
      }
      count = nextCount
      if (count === 0) return 0
      const swap = input
      input = output
      output = swap
    }
    return count // Six swaps put the final polygon back into first.
  }
  // One pass: the fans of the clipped polygons, their vertices (placed position and projector
  // space, as the scratch polygon holds them) kept in a scratch that grows; the output is then made
  // to its exact size. Two passes (count, then write) clipped every triangle twice.
  let kept = new Float32Array(6 * 96)
  const keep = (vertex: number, at: number) => {
    if (kept.length < at + 6) {
      const grown = new Float32Array(Math.max(kept.length * 2, at + 6))
      grown.set(kept)
      kept = grown
    }
    for (let axis = 0; axis < 6; axis++) kept[at + axis] = first[vertex * 6 + axis]!
  }
  const visit = (): number => {
    let vertices = 0
    for (const { primitive, transform: m, minimum, maximum, candidates } of bounded) {
      const count = primitive.indices?.length ?? primitive.positions.length / 3
      const [m0, m1, m2, , m4, m5, m6, , m8, m9, m10, , m12, m13, m14] = m as readonly number[]
      const visited = candidates === undefined ? count / 3 : candidates.length
      for (let candidate = 0; candidate < visited; candidate++) {
        const triangle = candidates === undefined ? candidate * 3 : candidates[candidate]!
        options.signal?.throwIfAborted()
        const a = (primitive.indices?.[triangle] ?? triangle) * 3
        const b = (primitive.indices?.[triangle + 1] ?? triangle + 1) * 3
        const c = (primitive.indices?.[triangle + 2] ?? triangle + 2) * 3
        const p = primitive.positions
        let outside = false
        for (let axis = 0; axis < 3; axis++) {
          if (
            Math.max(p[a + axis]!, p[b + axis]!, p[c + axis]!) < minimum[axis]! ||
            Math.min(p[a + axis]!, p[b + axis]!, p[c + axis]!) > maximum[axis]!
          ) {
            outside = true
            break
          }
        }
        if (outside) continue
        for (let vertex = 0; vertex < 3; vertex++) {
          const index = primitive.indices?.[triangle + vertex] ?? triangle + vertex
          const x = p[index * 3]!,
            y = p[index * 3 + 1]!,
            z = p[index * 3 + 2]!
          const px = m0! * x + m4! * y + m8! * z + m12!
          const py = m1! * x + m5! * y + m9! * z + m13!
          const pz = m2! * x + m6! * y + m10! * z + m14!
          const at = vertex * 6
          first[at] = px
          first[at + 1] = py
          first[at + 2] = pz
          first[at + 3] = dot(
            px - frame.origin[0],
            py - frame.origin[1],
            pz - frame.origin[2],
            frame.rightAxis,
          )
          first[at + 4] = dot(
            px - frame.origin[0],
            py - frame.origin[1],
            pz - frame.origin[2],
            frame.upAxis,
          )
          first[at + 5] = dot(
            px - frame.origin[0],
            py - frame.origin[1],
            pz - frame.origin[2],
            frame.forwardAxis,
          )
          // a placed coordinate beyond float32 overflows here, and is refused as before
          for (let axis = at; axis < at + 6; axis++)
            if (!Number.isFinite(first[axis]!)) throw new TypeError('invalid projector coordinate')
        }
        const count = clipped()
        for (let fan = 1; fan + 1 < count; fan++) {
          vertices += 3
          if (vertices * 24 + 480 > options.maxBytes)
            throw new RangeError('projector output exceeds budget')
          keep(0, (vertices - 3) * 6)
          keep(fan, (vertices - 2) * 6)
          keep(fan + 1, (vertices - 1) * 6)
        }
      }
    }
    return vertices
  }
  const vertices = visit(),
    positions = new Float32Array(vertices * 3),
    textureCoordinates = new Float32Array(vertices * 2),
    indices = new Uint32Array(vertices)
  for (let written = 0; written < vertices; written++) {
    const at = written * 6
    for (let axis = 0; axis < 3; axis++) positions[written * 3 + axis] = kept[at + axis]!
    const x = kept[at + 3]!,
      y = kept[at + 4]!,
      z = kept[at + 5]!
    textureCoordinates[written * 2] = clamp(
      frame.projectionType === 'perspective'
        ? 0.5 + x / Math.max(1e-6, 2 * z * frame.tangentX)
        : (x - frame.left) / Math.max(1e-6, frame.rightExtent - frame.left),
    )
    // Texture rows run top down, as model UVs do (D3D): the projector's top edge samples v = 0. Counting v
    // up from the bottom mirrored every asymmetric splat — a corner shadow (Shadow_Corner90) lay beside
    // its trim instead of under it.
    textureCoordinates[written * 2 + 1] = clamp(
      frame.projectionType === 'perspective'
        ? 0.5 - y / Math.max(1e-6, 2 * z * frame.tangentY)
        : (frame.top - y) / Math.max(1e-6, frame.top - frame.bottom),
    )
    indices[written] = written
  }
  return { positions, textureCoordinates, indices, triangles, byteLength: vertices * 24 }
}
