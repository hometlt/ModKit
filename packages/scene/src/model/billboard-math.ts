// Pinned raw-WebGL numerical kernels, copied without equation changes.
// Source commit 1a14ba4eddd0ae88de273348ebd44cfb98a0581d; webgl-core/index.ts.
// Indexed numeric reads use explicit zero fallback for strict TS; admitted matrices have 16 entries.
import {
  decomposeMatrix4,
  normalizeQuat,
  quaternionFromRotationMatrix,
} from '@modkit/codec-kit/model-math/transform'

// ponytail: the decomposition kernels live in codec-kit; this public `model/matrix` subpath still
// re-exports them for rig-model and blizzard's fresh-rigid until both import codec-kit directly.
export { decomposeMatrix4, normalizeQuat, quaternionFromRotationMatrix }

export function invertQuat(
  rotation: readonly [number, number, number, number],
): [number, number, number, number] {
  const lengthSq =
    rotation[0] * rotation[0] +
    rotation[1] * rotation[1] +
    rotation[2] * rotation[2] +
    rotation[3] * rotation[3]
  if (lengthSq === 0) return [0, 0, 0, 1]
  return [
    -rotation[0] / lengthSq,
    -rotation[1] / lengthSq,
    -rotation[2] / lengthSq,
    rotation[3] / lengthSq,
  ]
}

export function multiplyQuat(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = left
  const [bx, by, bz, bw] = right
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ])
}

export function invertMatrix4OrNull(matrix: Float32Array): Float32Array | null {
  const out = new Float32Array(16)
  const b00 = (matrix[0] ?? 0) * (matrix[5] ?? 0) - (matrix[1] ?? 0) * (matrix[4] ?? 0)
  const b01 = (matrix[0] ?? 0) * (matrix[6] ?? 0) - (matrix[2] ?? 0) * (matrix[4] ?? 0)
  const b02 = (matrix[0] ?? 0) * (matrix[7] ?? 0) - (matrix[3] ?? 0) * (matrix[4] ?? 0)
  const b03 = (matrix[1] ?? 0) * (matrix[6] ?? 0) - (matrix[2] ?? 0) * (matrix[5] ?? 0)
  const b04 = (matrix[1] ?? 0) * (matrix[7] ?? 0) - (matrix[3] ?? 0) * (matrix[5] ?? 0)
  const b05 = (matrix[2] ?? 0) * (matrix[7] ?? 0) - (matrix[3] ?? 0) * (matrix[6] ?? 0)
  const b06 = (matrix[8] ?? 0) * (matrix[13] ?? 0) - (matrix[9] ?? 0) * (matrix[12] ?? 0)
  const b07 = (matrix[8] ?? 0) * (matrix[14] ?? 0) - (matrix[10] ?? 0) * (matrix[12] ?? 0)
  const b08 = (matrix[8] ?? 0) * (matrix[15] ?? 0) - (matrix[11] ?? 0) * (matrix[12] ?? 0)
  const b09 = (matrix[9] ?? 0) * (matrix[14] ?? 0) - (matrix[10] ?? 0) * (matrix[13] ?? 0)
  const b10 = (matrix[9] ?? 0) * (matrix[15] ?? 0) - (matrix[11] ?? 0) * (matrix[13] ?? 0)
  const b11 = (matrix[10] ?? 0) * (matrix[15] ?? 0) - (matrix[11] ?? 0) * (matrix[14] ?? 0)
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(determinant) < 1e-12) return null
  determinant = 1 / determinant
  out[0] = ((matrix[5] ?? 0) * b11 - (matrix[6] ?? 0) * b10 + (matrix[7] ?? 0) * b09) * determinant
  out[1] = ((matrix[2] ?? 0) * b10 - (matrix[1] ?? 0) * b11 - (matrix[3] ?? 0) * b09) * determinant
  out[2] =
    ((matrix[13] ?? 0) * b05 - (matrix[14] ?? 0) * b04 + (matrix[15] ?? 0) * b03) * determinant
  out[3] =
    ((matrix[10] ?? 0) * b04 - (matrix[9] ?? 0) * b05 - (matrix[11] ?? 0) * b03) * determinant
  out[4] = ((matrix[6] ?? 0) * b08 - (matrix[4] ?? 0) * b11 - (matrix[7] ?? 0) * b07) * determinant
  out[5] = ((matrix[0] ?? 0) * b11 - (matrix[2] ?? 0) * b08 + (matrix[3] ?? 0) * b07) * determinant
  out[6] =
    ((matrix[14] ?? 0) * b02 - (matrix[12] ?? 0) * b05 - (matrix[15] ?? 0) * b01) * determinant
  out[7] =
    ((matrix[8] ?? 0) * b05 - (matrix[10] ?? 0) * b02 + (matrix[11] ?? 0) * b01) * determinant
  out[8] = ((matrix[4] ?? 0) * b10 - (matrix[5] ?? 0) * b08 + (matrix[7] ?? 0) * b06) * determinant
  out[9] = ((matrix[1] ?? 0) * b08 - (matrix[0] ?? 0) * b10 - (matrix[3] ?? 0) * b06) * determinant
  out[10] =
    ((matrix[12] ?? 0) * b04 - (matrix[13] ?? 0) * b02 + (matrix[15] ?? 0) * b00) * determinant
  out[11] =
    ((matrix[9] ?? 0) * b02 - (matrix[8] ?? 0) * b04 - (matrix[11] ?? 0) * b00) * determinant
  out[12] = ((matrix[5] ?? 0) * b07 - (matrix[4] ?? 0) * b09 - (matrix[6] ?? 0) * b06) * determinant
  out[13] = ((matrix[0] ?? 0) * b09 - (matrix[1] ?? 0) * b07 + (matrix[2] ?? 0) * b06) * determinant
  out[14] =
    ((matrix[13] ?? 0) * b01 - (matrix[12] ?? 0) * b03 - (matrix[14] ?? 0) * b00) * determinant
  out[15] =
    ((matrix[8] ?? 0) * b03 - (matrix[9] ?? 0) * b01 + (matrix[10] ?? 0) * b00) * determinant
  return out
}

export function rotationTranslationScaleOriginMatrix(
  rotation: readonly [number, number, number, number],
  translation: readonly [number, number, number],
  scaling: readonly [number, number, number],
  origin: readonly [number, number, number],
): Float32Array {
  const x = rotation[0]
  const y = rotation[1]
  const z = rotation[2]
  const w = rotation[3]
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const sx = scaling[0]
  const sy = scaling[1]
  const sz = scaling[2]
  const ox = origin[0]
  const oy = origin[1]
  const oz = origin[2]
  const out = new Float32Array(16)
  out[0] = (1 - yy - zz) * sx
  out[1] = (xy + wz) * sx
  out[2] = (xz - wy) * sx
  out[4] = (xy - wz) * sy
  out[5] = (1 - xx - zz) * sy
  out[6] = (yz + wx) * sy
  out[8] = (xz + wy) * sz
  out[9] = (yz - wx) * sz
  out[10] = (1 - xx - yy) * sz
  out[12] = translation[0] + ox - (out[0] * ox + out[4] * oy + out[8] * oz)
  out[13] = translation[1] + oy - (out[1] * ox + out[5] * oy + out[9] * oz)
  out[14] = translation[2] + oz - (out[2] * ox + out[6] * oy + out[10] * oz)
  out[15] = 1
  return out
}

export function multiplyMatrix4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        (a[0 * 4 + row] ?? 0) * (b[col * 4 + 0] ?? 0) +
        (a[1 * 4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) +
        (a[2 * 4 + row] ?? 0) * (b[col * 4 + 2] ?? 0) +
        (a[3 * 4 + row] ?? 0) * (b[col * 4 + 3] ?? 0)
    }
  }
  return out
}
