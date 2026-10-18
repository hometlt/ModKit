import type { Vec3, Vec4 } from '@modkit/codec-kit/model-math/standard-material-glsl'

/** Signed area vector of one indexed triangle; shared by normal generation and static filtering. */
export function uvmTriangleAreaVector(
  positions: ArrayLike<number>, a: number, b: number, c: number,
): readonly [number, number, number] {
  const vertices = positions.length / 3
  if (!Number.isSafeInteger(vertices) || vertices === 0)
    throw new TypeError('triangle area requires complete positions')
  if (![a, b, c].every(value => Number.isSafeInteger(value) && value >= 0 && value < vertices))
    throw new RangeError('normal generation index is outside the primitive')
  const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
  const abx = positions[b * 3]! - ax, aby = positions[b * 3 + 1]! - ay, abz = positions[b * 3 + 2]! - az
  const acx = positions[c * 3]! - ax, acy = positions[c * 3 + 1]! - ay, acz = positions[c * 3 + 2]! - az
  const normal = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx] as const
  if (!normal.every(Number.isFinite)) throw new RangeError('normal generation exceeds the finite range')
  return normal
}

/** Build smooth unit vertex normals for an indexed triangle primitive. Face vectors are weighted by
 * area before normalization, so triangulation does not bias a shared vertex. Unreferenced vertices
 * receive an inert unit normal. A vertex whose faces cancel (double-sided geometry sharing vertices)
 * takes its largest adjacent face's normal; one lit side is kept instead of refusing the model.
 * A referenced vertex whose every face has zero area still refuses. */
export function generateUvmVertexNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  signal?: AbortSignal,
): Float32Array {
  signal?.throwIfAborted()
  if (positions.length === 0 || positions.length % 3 !== 0 || indices.length % 3 !== 0)
    throw new TypeError('normal generation requires indexed triangle positions')
  const vertices = positions.length / 3
  const result = new Float64Array(positions.length)
  const referenced = new Uint8Array(vertices)
  const largest = new Float64Array(positions.length), largestArea = new Float64Array(vertices)
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    if ((triangle & 0x3fff) === 0) signal?.throwIfAborted()
    const a = indices[triangle]!, b = indices[triangle + 1]!, c = indices[triangle + 2]!
    const [nx, ny, nz] = uvmTriangleAreaVector(positions, a, b, c)
    const area = Math.hypot(nx, ny, nz)
    for (const vertex of [a, b, c]) {
      referenced[vertex] = 1
      if (area > largestArea[vertex]!) {
        largestArea[vertex] = area
        largest[vertex * 3] = nx
        largest[vertex * 3 + 1] = ny
        largest[vertex * 3 + 2] = nz
      }
      result[vertex * 3] = result[vertex * 3]! + nx
      result[vertex * 3 + 1] = result[vertex * 3 + 1]! + ny
      result[vertex * 3 + 2] = result[vertex * 3 + 2]! + nz
    }
  }
  const normals = new Float32Array(result.length)
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    if (!referenced[vertex]) {
      if (![positions[vertex*3], positions[vertex*3+1], positions[vertex*3+2]].every(Number.isFinite))
        throw new TypeError('normal generation encountered nonfinite unused positions')
      normals[vertex*3+2] = 1
      continue
    }
    let x = result[vertex * 3]!, y = result[vertex * 3 + 1]!, z = result[vertex * 3 + 2]!
    let length = Math.hypot(x, y, z)
    if (length === 0 && largestArea[vertex]! > 0) {
      x = largest[vertex * 3]!; y = largest[vertex * 3 + 1]!; z = largest[vertex * 3 + 2]!
      length = largestArea[vertex]!
    }
    if (!Number.isFinite(length) || length === 0)
      throw new TypeError('normal generation encountered an isolated or degenerate vertex')
    normals[vertex * 3] = x / length
    normals[vertex * 3 + 1] = y / length
    normals[vertex * 3 + 2] = z / length
  }
  return normals
}


const component = (array: ArrayLike<number>, index: number) => {
  const result = array[index]
  if (result === undefined || !Number.isFinite(result))
    throw new TypeError('invalid material geometry component')
  return result
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 => {
  const length = Math.hypot(...a)
  return length > 1e-9 ? [a[0] / length, a[1] / length, a[2] / length] : fallback
}
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const read3 = (array: ArrayLike<number>, index: number): Vec3 => [
  component(array, index * 3),
  component(array, index * 3 + 1),
  component(array, index * 3 + 2),
]

/** A unit vector perpendicular to `normal`: the tangent of a face without usable UVs. */
export const tangentFallback = (normal: Vec3): Vec3 =>
  unit(cross(Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], normal), [1, 0, 0])

/**
 * A triangle's face normal, tangent and bitangent: from its edges and the UV deltas at its corners
 * (`a`, `b`, `c`: the corners' offsets in `uv`), or the face's fallback frame without UVs or with a
 * degenerate UV determinant (`degenerate`).
 */
export function triangleTangentFrame(
  p: Vec3,
  q: Vec3,
  r: Vec3,
  uv: ArrayLike<number> | undefined,
  a: number,
  b: number,
  c: number,
): Readonly<{ face: Vec3; tangent: Vec3; bitangent: Vec3; degenerate: boolean }> {
  const e1 = subtract(q, p),
    e2 = subtract(r, p),
    face = unit(cross(e1, e2))
  let tangent: Vec3 = tangentFallback(face),
    bitangent: Vec3 = cross(face, tangent)
  if (uv === undefined) return { face, tangent, bitangent, degenerate: false }
  const u1 = component(uv, b) - component(uv, a),
    v1 = component(uv, b + 1) - component(uv, a + 1),
    u2 = component(uv, c) - component(uv, a),
    v2 = component(uv, c + 1) - component(uv, a + 1),
    determinant = u1 * v2 - u2 * v1
  if (!(Math.abs(determinant) > 1e-9)) return { face, tangent, bitangent, degenerate: true }
  tangent = [
    (e1[0] * v2 - e2[0] * v1) / determinant,
    (e1[1] * v2 - e2[1] * v1) / determinant,
    (e1[2] * v2 - e2[2] * v1) / determinant,
  ]
  bitangent = [
    (e2[0] * u1 - e1[0] * u2) / determinant,
    (e2[1] * u1 - e1[1] * u2) / determinant,
    (e2[2] * u1 - e1[2] * u2) / determinant,
  ]
  return { face, tangent, bitangent, degenerate: false }
}

/** `tangent` made orthogonal to `normal`, with the handedness `bitangent` gives it (glTF TANGENT.w). */
export function orthogonalTangent(normal: Vec3, tangent: Vec3, bitangent: Vec3): Vec4 {
  const n = unit(normal),
    nt = dot(n, tangent),
    along = unit(
      [tangent[0] - n[0] * nt, tangent[1] - n[1] * nt, tangent[2] - n[2] * nt],
      tangentFallback(n),
    )
  return [...along, dot(cross(n, along), bitangent) < 0 ? -1 : 1]
}

/**
 * Tangents of an indexed triangle mesh, per vertex (glTF TANGENT: xyz and handedness w), from the
 * UV set `uv` (two numbers a vertex): each triangle's UV frame summed at its corners and made
 * orthogonal to the vertex's own normal there. The vertices stay as they are — a skin keeps its
 * joints and weights — which is what a material's `tangentGeneration` asks of a renderer, and what
 * a writer whose format stores tangents must do once. One owner: the scene's material path draws
 * with these, and model writers store them.
 */
export function generateUvmVertexTangents(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  uv: ArrayLike<number> | undefined,
  triangles: ArrayLike<number>,
  signal?: AbortSignal,
): Float32Array {
  signal?.throwIfAborted()
  const count = positions.length / 3
  if (!Number.isSafeInteger(count) || normals.length !== positions.length || triangles.length % 3 !== 0)
    throw new TypeError('tangent generation requires matching positions, normals and triangles')
  if (uv !== undefined && uv.length !== count * 2)
    throw new TypeError('tangent generation requires two UV components a vertex')
  const tangentSums = new Float64Array(count * 3),
    bitangentSums = new Float64Array(count * 3)
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    if ((i & 0x3fff) === 0) signal?.throwIfAborted()
    const a = component(triangles, i),
      b = component(triangles, i + 1),
      c = component(triangles, i + 2)
    if (![a, b, c].every(index => Number.isSafeInteger(index) && index >= 0 && index < count))
      throw new RangeError('tangent generation index is outside the primitive')
    const frame = triangleTangentFrame(
      read3(positions, a),
      read3(positions, b),
      read3(positions, c),
      uv,
      a * 2,
      b * 2,
      c * 2,
    )
    for (const corner of [a, b, c])
      for (let axis = 0; axis < 3; axis++) {
        const at = corner * 3 + axis
        tangentSums[at] = tangentSums[at]! + frame.tangent[axis]!
        bitangentSums[at] = bitangentSums[at]! + frame.bitangent[axis]!
      }
  }
  const tangents = new Float32Array(count * 4)
  for (let vertex = 0; vertex < count; vertex++) {
    const sum = (sums: Float64Array): Vec3 => [
      sums[vertex * 3]!,
      sums[vertex * 3 + 1]!,
      sums[vertex * 3 + 2]!,
    ]
    tangents.set(
      orthogonalTangent(read3(normals, vertex), sum(tangentSums), sum(bitangentSums)),
      vertex * 4,
    )
  }
  return tangents
}
