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
