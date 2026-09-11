import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'

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
const component = (values: ArrayLike<number>, index: number): number => {
  const value = values[index]
  if (value === undefined || !Number.isFinite(value))
    throw new TypeError('invalid projector coordinate')
  return value
}
const dot = (x: number, y: number, z: number, v: ProjectorVec3) => x * v[0] + y * v[1] + z * v[2]
const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Two passes reserve exact output before allocation. Unlike the old live-buffer preview,
 * exhaustion rejects the frame instead of publishing silently truncated receiver geometry. */
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
    for (const index of primitive.indices ?? [])
      if (index >= primitive.positions.length / 3)
        throw new RangeError('projector receiver index absent')
    for (const value of primitive.positions)
      if (!Number.isFinite(value)) throw new TypeError('nonfinite projector receiver')
  }
  const first = new Float32Array(60),
    second = new Float32Array(60)
  const distance = (vertices: Float32Array, vertex: number, plane: number): number => {
    const x = component(vertices, vertex * 6 + 3),
      y = component(vertices, vertex * 6 + 4),
      z = component(vertices, vertex * 6 + 5)
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
            const start = component(input, previous * 6 + axis)
            output[nextCount * 6 + axis] =
              start + (component(input, current * 6 + axis) - start) * factor
          }
          nextCount++
        }
        if (currentDistance >= 0) {
          if (nextCount >= 10) throw new RangeError('projector clipping capacity exceeded')
          for (let axis = 0; axis < 6; axis++)
            output[nextCount * 6 + axis] = component(input, current * 6 + axis)
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
  const visit = (write?: (vertex: number) => void): number => {
    let vertices = 0
    for (const { primitive, transform: m } of receivers) {
      const count = primitive.indices?.length ?? primitive.positions.length / 3
      for (let triangle = 0; triangle < count; triangle += 3) {
        options.signal?.throwIfAborted()
        for (let vertex = 0; vertex < 3; vertex++) {
          const index = primitive.indices?.[triangle + vertex] ?? triangle + vertex
          const x = component(primitive.positions, index * 3),
            y = component(primitive.positions, index * 3 + 1),
            z = component(primitive.positions, index * 3 + 2)
          const px =
            component(m, 0) * x + component(m, 4) * y + component(m, 8) * z + component(m, 12)
          const py =
            component(m, 1) * x + component(m, 5) * y + component(m, 9) * z + component(m, 13)
          const pz =
            component(m, 2) * x + component(m, 6) * y + component(m, 10) * z + component(m, 14)
          first.set(
            [
              px,
              py,
              pz,
              dot(
                px - frame.origin[0],
                py - frame.origin[1],
                pz - frame.origin[2],
                frame.rightAxis,
              ),
              dot(px - frame.origin[0], py - frame.origin[1], pz - frame.origin[2], frame.upAxis),
              dot(
                px - frame.origin[0],
                py - frame.origin[1],
                pz - frame.origin[2],
                frame.forwardAxis,
              ),
            ],
            vertex * 6,
          )
        }
        const count = clipped()
        for (let fan = 1; fan + 1 < count; fan++) {
          vertices += 3
          if (vertices * 24 + 480 > options.maxBytes)
            throw new RangeError('projector output exceeds budget')
          write?.(0)
          write?.(fan)
          write?.(fan + 1)
        }
      }
    }
    return vertices
  }
  const vertices = visit(),
    positions = new Float32Array(vertices * 3),
    textureCoordinates = new Float32Array(vertices * 2),
    indices = new Uint32Array(vertices)
  let written = 0
  const finalCount = visit(vertex => {
    for (let axis = 0; axis < 3; axis++)
      positions[written * 3 + axis] = component(first, vertex * 6 + axis)
    const x = component(first, vertex * 6 + 3),
      y = component(first, vertex * 6 + 4),
      z = component(first, vertex * 6 + 5)
    textureCoordinates[written * 2] = clamp(
      frame.projectionType === 'perspective'
        ? 0.5 + x / Math.max(1e-6, 2 * z * frame.tangentX)
        : (x - frame.left) / Math.max(1e-6, frame.rightExtent - frame.left),
    )
    textureCoordinates[written * 2 + 1] = clamp(
      frame.projectionType === 'perspective'
        ? 0.5 + y / Math.max(1e-6, 2 * z * frame.tangentY)
        : (y - frame.bottom) / Math.max(1e-6, frame.top - frame.bottom),
    )
    indices[written] = written++
  })
  if (finalCount !== vertices || written !== vertices)
    throw new TypeError('projector receivers changed during preparation')
  return { positions, textureCoordinates, indices, triangles, byteLength: vertices * 24 }
}
