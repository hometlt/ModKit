import { describe, expect, it } from 'vitest'
import { decomposeMatrix4, invertAffine } from '../src/model-math/transform.js'

// column-major: rotate 90° about Z, scale (2, 3, 4), translate (5, 6, 7)
const matrix = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]

describe('model-math transform', () => {
  it('decomposes a column-major matrix into translation, rotation and scale', () => {
    const { translation, rotation, scaling } = decomposeMatrix4(Float32Array.from(matrix))
    expect(translation).toEqual([5, 6, 7])
    expect(scaling).toEqual([2, 3, 4])
    const half = Math.SQRT1_2
    rotation.forEach((value, index) => expect(value).toBeCloseTo([0, 0, half, half][index]!, 6))
  })

  it('reads a reflection as a negative x scale and a zero column as a zero scale', () => {
    const mirrored = decomposeMatrix4([0, -2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1])
    expect(mirrored.scaling).toEqual([-2, 3, 4])
    const half = Math.SQRT1_2
    mirrored.rotation.forEach((value, index) =>
      expect(value).toBeCloseTo([0, 0, half, half][index]!, 6),
    )
    const hidden = decomposeMatrix4([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1])
    expect(hidden.scaling).toEqual([2, 0, 4])
    expect(hidden.rotation.every(Number.isFinite)).toBe(true)
  })

  it('keeps the true turn of a node flattened to nothing along one or two axes', () => {
    // rotate 90° about Z, scale (0, 1, 1): x collapses (Emperor's lightning keys)
    const flattened = decomposeMatrix4([0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    expect(flattened.scaling).toEqual([0, 1, 1])
    const half = Math.SQRT1_2
    flattened.rotation.forEach((value, index) =>
      expect(value).toBeCloseTo([0, 0, half, half][index]!, 6),
    )
    // T·R·S rebuilds the matrix: compose and compare
    const compose = ({ rotation: [qx, qy, qz, qw], scaling: [sx, sy, sz] }: typeof flattened) => [
      (1 - 2 * (qy * qy + qz * qz)) * sx,
      2 * (qx * qy + qz * qw) * sx,
      2 * (qx * qz - qy * qw) * sx,
      2 * (qx * qy - qz * qw) * sy,
      (1 - 2 * (qx * qx + qz * qz)) * sy,
      2 * (qy * qz + qx * qw) * sy,
      2 * (qx * qz + qy * qw) * sz,
      2 * (qy * qz - qx * qw) * sz,
      (1 - 2 * (qx * qx + qy * qy)) * sz,
    ]
    compose(flattened).forEach((value, index) =>
      expect(value).toBeCloseTo([0, 0, 0, -1, 0, 0, 0, 0, 1][index]!, 6),
    )
    // only z survives: the rotation still carries it
    const line = decomposeMatrix4([0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 1])
    expect(line.scaling).toEqual([0, 0, 3])
    compose(line).forEach((value, index) =>
      expect(value).toBeCloseTo([0, 0, 0, 0, 0, 0, 0, 3, 0][index]!, 6),
    )
    const nothing = decomposeMatrix4([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(nothing.rotation).toEqual([0, 0, 0, 1])
  })

  it('inverts an affine matrix and refuses a singular basis', () => {
    const inverse = invertAffine(matrix)
    // inverse · (5, 6, 7) is the origin
    const x = inverse[0]! * 5 + inverse[4]! * 6 + inverse[8]! * 7 + inverse[12]!
    const y = inverse[1]! * 5 + inverse[5]! * 6 + inverse[9]! * 7 + inverse[13]!
    const z = inverse[2]! * 5 + inverse[6]! * 6 + inverse[10]! * 7 + inverse[14]!
    expect([x, y, z].map(value => Math.abs(value) < 1e-9)).toEqual([true, true, true])
    expect(() => invertAffine([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toThrow(RangeError)
  })
})
