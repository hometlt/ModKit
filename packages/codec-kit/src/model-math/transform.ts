/**
 * Column-major 4x4 transform kernels shared by model codecs and the scene: an affine inverse and
 * the matrix → translation/rotation/scale decomposition. The quaternion equations are the pinned
 * raw-WebGL kernels of MK2 commit 1a14ba4eddd0ae88de273348ebd44cfb98a0581d (webgl-core/index.ts),
 * unchanged; indexed reads fall back to the identity for strict TS.
 */

export function normalizeQuat(
  value: readonly [number, number, number, number] | readonly number[],
): [number, number, number, number] {
  const x = value[0] ?? 0
  const y = value[1] ?? 0
  const z = value[2] ?? 0
  const w = value[3] ?? 1
  const length = Math.hypot(x, y, z, w) || 1
  return [x / length, y / length, z / length, w / length]
}

/**
 * Shortest-path normalized linear interpolation of `[x, y, z, w]` components.
 * Blends the supplied components before normalization; unequal endpoint magnitudes affect
 * the weights. The result follows a's hemisphere (including at t = 1), not constant angular speed.
 * Requires four finite components, finite norms > 1e-12 and finite t in [0, 1].
 * Invalid or degenerate input/result throws RangeError instead of substituting an identity.
 */
export function nlerpQuaternion(
  a: readonly number[],
  b: readonly number[],
  t: number,
): [number, number, number, number] {
  if (!Number.isFinite(t) || t < 0 || t > 1)
    throw new RangeError('Quaternion interpolation fraction must be finite and in [0, 1]')
  const lengths: number[] = []
  for (const value of [a, b]) {
    if (value.length !== 4)
      throw new RangeError('Quaternion interpolation requires four finite components')
    for (let i = 0; i < 4; i += 1)
      if (!Number.isFinite(value[i]))
        throw new RangeError('Quaternion interpolation requires four finite components')
    const length = Math.hypot(value[0]!, value[1]!, value[2]!, value[3]!)
    if (!Number.isFinite(length) || length <= 1e-12)
      throw new RangeError('Quaternion interpolation requires finite norms greater than 1e-12')
    lengths.push(length)
  }
  // Normalize only the dot operands, preventing overflow without changing the blend weights.
  let dot = 0
  for (let i = 0; i < 4; i += 1) dot += (a[i]! / lengths[0]!) * (b[i]! / lengths[1]!)
  const weightB = dot < 0 ? -t : t
  const result: [number, number, number, number] = [
    (1 - t) * a[0]! + weightB * b[0]!,
    (1 - t) * a[1]! + weightB * b[1]!,
    (1 - t) * a[2]! + weightB * b[2]!,
    (1 - t) * a[3]! + weightB * b[3]!,
  ]
  const length = Math.hypot(...result)
  if (!Number.isFinite(length) || length <= 1e-12)
    throw new RangeError('Quaternion interpolation produced a degenerate result')
  return normalizeQuat(result)
}

/**
 * Translation, unit rotation quaternion `[x, y, z, w]` and per-axis scale of a column-major matrix,
 * so that T·R·S reproduces it: a reflection (negative determinant) reads as a negative x scale, and
 * a zero column as a zero scale on that axis, its rotation axis completed from the other two (a
 * key that flattens a node to nothing along one axis keeps its true turn).
 */
export function decomposeMatrix4(matrix: ArrayLike<number>): {
  translation: [number, number, number]
  rotation: [number, number, number, number]
  scaling: [number, number, number]
} {
  const m = (at: number) => matrix[at] ?? (at % 5 === 0 ? 1 : 0)
  const determinant =
    m(0) * (m(5) * m(10) - m(9) * m(6)) -
    m(4) * (m(1) * m(10) - m(9) * m(2)) +
    m(8) * (m(1) * m(6) - m(5) * m(2))
  const sx = (determinant < 0 ? -1 : 1) * Math.hypot(m(0), m(1), m(2))
  const sy = Math.hypot(m(4), m(5), m(6))
  const sz = Math.hypot(m(8), m(9), m(10))
  const tiny = 1e-12 * Math.max(1, Math.abs(sx), sy, sz)
  const unit = (scale: number, at: number): Vector3 | undefined =>
    Math.abs(scale) <= tiny ? undefined : [m(at) / scale, m(at + 1) / scale, m(at + 2) / scale]
  // Rebuild degenerate axes as a right-handed basis: x × y = z, y × z = x, z × x = y.
  let x = unit(sx, 0)
  let y = unit(sy, 4)
  let z = unit(sz, 8)
  if (x === undefined && y === undefined && z === undefined)
    [x, y, z] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  if (x !== undefined && y === undefined && z === undefined) y = perpendicular(x)
  else if (y !== undefined && z === undefined && x === undefined) z = perpendicular(y)
  else if (z !== undefined && x === undefined && y === undefined) x = perpendicular(z)
  if (z === undefined) z = cross(x!, y!)
  if (x === undefined) x = cross(y!, z)
  if (y === undefined) y = cross(z, x)
  return {
    translation: [m(12), m(13), m(14)],
    scaling: [sx, sy, sz],
    rotation: quaternionFromRotationMatrix([...x, ...y, ...z]),
  }
}

type Vector3 = [number, number, number]

function cross(a: Vector3, b: Vector3): Vector3 {
  const c: Vector3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const length = Math.hypot(c[0], c[1], c[2]) || 1
  return [c[0] / length, c[1] / length, c[2] / length]
}

/** A unit vector perpendicular to the unit vector `v`. */
function perpendicular(v: Vector3): Vector3 {
  return cross(v, Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])
}

/** Unit quaternion `[x, y, z, w]` of a column-major 3x3 rotation matrix. */
export function quaternionFromRotationMatrix(
  matrix: readonly number[],
): [number, number, number, number] {
  const m00 = matrix[0] ?? 1
  const m01 = matrix[3] ?? 0
  const m02 = matrix[6] ?? 0
  const m10 = matrix[1] ?? 0
  const m11 = matrix[4] ?? 1
  const m12 = matrix[7] ?? 0
  const m20 = matrix[2] ?? 0
  const m21 = matrix[5] ?? 0
  const m22 = matrix[8] ?? 1
  const trace = m00 + m11 + m22

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return normalizeQuat([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s])
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    return normalizeQuat([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s])
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    return normalizeQuat([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s])
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2
  return normalizeQuat([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s])
}

/**
 * Column-major 4x4 inverse for an affine matrix: invert the basis, then move the origin back.
 * Non-finite entries read as 0; a singular basis throws.
 */
export function invertAffine(matrix: readonly number[]): number[] {
  const value = (index: number): number => {
    const one = matrix[index]
    return typeof one === 'number' && Number.isFinite(one) ? one : 0
  }
  const basis = [
    value(0),
    value(1),
    value(2),
    value(4),
    value(5),
    value(6),
    value(8),
    value(9),
    value(10),
  ]
  const determinant =
    basis[0]! * (basis[4]! * basis[8]! - basis[5]! * basis[7]!) -
    basis[3]! * (basis[1]! * basis[8]! - basis[2]! * basis[7]!) +
    basis[6]! * (basis[1]! * basis[5]! - basis[2]! * basis[4]!)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new RangeError('a bind matrix with no inverse cannot place a baked part')
  const inverse = [
    (basis[4]! * basis[8]! - basis[5]! * basis[7]!) / determinant,
    (basis[2]! * basis[7]! - basis[1]! * basis[8]!) / determinant,
    (basis[1]! * basis[5]! - basis[2]! * basis[4]!) / determinant,
    (basis[5]! * basis[6]! - basis[3]! * basis[8]!) / determinant,
    (basis[0]! * basis[8]! - basis[2]! * basis[6]!) / determinant,
    (basis[2]! * basis[3]! - basis[0]! * basis[5]!) / determinant,
    (basis[3]! * basis[7]! - basis[4]! * basis[6]!) / determinant,
    (basis[1]! * basis[6]! - basis[0]! * basis[7]!) / determinant,
    (basis[0]! * basis[4]! - basis[1]! * basis[3]!) / determinant,
  ]
  const translation = [value(12), value(13), value(14)]
  const moved = [0, 1, 2].map(
    row =>
      -(
        inverse[row]! * translation[0]! +
        inverse[row + 3]! * translation[1]! +
        inverse[row + 6]! * translation[2]!
      ),
  )
  // prettier-ignore
  return [
    inverse[0]!, inverse[1]!, inverse[2]!, 0,
    inverse[3]!, inverse[4]!, inverse[5]!, 0,
    inverse[6]!, inverse[7]!, inverse[8]!, 0,
    moved[0]!, moved[1]!, moved[2]!, 1,
  ]
}

/**
 * A bound of how much the linear part A of a column-major 4x4 matrix lengthens a vector: the square
 * root of the largest Gershgorin row sum of AᵀA (its entries are the products of A's columns), never
 * below A's spectral norm and equal to it when AᵀA is diagonal, as for a rotation after an axis
 * scale (T·R·S); a relative 1e-12 covers the rounding of the sums.
 */
export function linearStretch(matrix: ArrayLike<number>): number {
  const at = (index: number) => matrix[index] ?? 0
  let largest = 0
  for (let i = 0; i < 3; i++) {
    let row = 0
    for (let j = 0; j < 3; j++)
      row += Math.abs(
        at(i * 4) * at(j * 4) + at(i * 4 + 1) * at(j * 4 + 1) + at(i * 4 + 2) * at(j * 4 + 2),
      )
    largest = Math.max(largest, row)
  }
  return Math.sqrt(largest) * (1 + 1e-12)
}

/** Column-major 4x4 product `left × right` in doubles: `right` applies first. */
export function multiplyAffine(left: readonly number[], right: readonly number[]): number[] {
  const product = new Array<number>(16)
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0)
      product[column * 4 + row] = sum
    }
  return product
}
