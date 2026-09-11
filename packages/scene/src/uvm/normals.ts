/** Build smooth unit vertex normals for an indexed triangle primitive. Face vectors are weighted by
 * area before normalization, so triangulation does not bias a shared vertex. */
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
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    if ((triangle & 0x3fff) === 0) signal?.throwIfAborted()
    const a = indices[triangle]!, b = indices[triangle + 1]!, c = indices[triangle + 2]!
    if (![a, b, c].every(value => Number.isSafeInteger(value) && value >= 0 && value < vertices))
      throw new RangeError('normal generation index is outside the primitive')
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!
    const abx = positions[b * 3]! - ax, aby = positions[b * 3 + 1]! - ay, abz = positions[b * 3 + 2]! - az
    const acx = positions[c * 3]! - ax, acy = positions[c * 3 + 1]! - ay, acz = positions[c * 3 + 2]! - az
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    if (![nx, ny, nz].every(Number.isFinite)) throw new RangeError('normal generation exceeds the finite range')
    for (const vertex of [a, b, c]) {
      result[vertex * 3] = result[vertex * 3]! + nx
      result[vertex * 3 + 1] = result[vertex * 3 + 1]! + ny
      result[vertex * 3 + 2] = result[vertex * 3 + 2]! + nz
    }
  }
  const normals = new Float32Array(result.length)
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const x = result[vertex * 3]!, y = result[vertex * 3 + 1]!, z = result[vertex * 3 + 2]!
    const length = Math.hypot(x, y, z)
    if (!Number.isFinite(length) || length === 0)
      throw new TypeError('normal generation encountered an isolated or degenerate vertex')
    normals[vertex * 3] = x / length
    normals[vertex * 3 + 1] = y / length
    normals[vertex * 3 + 2] = z / length
  }
  return normals
}
