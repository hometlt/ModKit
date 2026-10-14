import { describe, expect, it } from 'vitest'
import {
  decomposeMatrix4,
  invertAffine,
  linearStretch,
  nlerpQuaternion,
} from '../src/model-math/transform.js'

// column-major: rotate 90° about Z, scale (2, 3, 4), translate (5, 6, 7)
const matrix = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1]

describe('quaternion nlerp', () => {
  const identity = Object.freeze([0, 0, 0, 1])
  const turn120 = Object.freeze([0, 0, Math.sqrt(3) / 2, 0.5])

  it('uses normalized linear weights rather than constant angular speed', () => {
    const result = nlerpQuaternion(identity, turn120, 0.25)
    // Linear blend is [0, 0, sqrt(3)/8, 7/8]; its squared norm is 13/16.
    expect(result[2]).toBeCloseTo(Math.sqrt(3 / 13) / 2, 14)
    expect(result[3]).toBeCloseTo(7 / (2 * Math.sqrt(13)), 14)
    expect(Math.hypot(...result)).toBeCloseTo(1, 14)
    // SLERP would rotate 30 degrees at this time, yielding sin(15 degrees).
    expect(Math.abs(result[2] - Math.sin(Math.PI / 12))).toBeGreaterThan(0.01)
  })

  it('preserves endpoint rotations and takes the same short path for q and -q', () => {
    const negative = turn120.map(value => -value)
    expect(nlerpQuaternion(identity, turn120, 0)).toEqual(identity)
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const positiveResult = nlerpQuaternion(identity, turn120, t)
      nlerpQuaternion(identity, negative, t).forEach((value, i) =>
        expect(value).toBeCloseTo(positiveResult[i]!, 14),
      )
      nlerpQuaternion(turn120, negative, t).forEach((value, i) =>
        expect(value).toBeCloseTo(turn120[i]!, 14),
      )
    }
    nlerpQuaternion(identity, turn120, 1).forEach((value, i) =>
      expect(value).toBeCloseTo(turn120[i]!, 14),
    )
  })

  it('normalizes the result without discarding the supplied endpoint magnitudes', () => {
    const result = nlerpQuaternion([0, 0, 0, 2], [0, 0, 1, 0], 0.5)
    expect(result[2]).toBeCloseTo(1 / Math.sqrt(5), 14)
    expect(result[3]).toBeCloseTo(2 / Math.sqrt(5), 14)
  })

  it('determines the short path even when a raw dot product would overflow', () => {
    const a = [1e200, 1e200, 0, 0]
    const b = [1e200, -2e200, 0, 0]
    // Raw dot is Infinity - Infinity; the actual negative dot must flip b.
    expect(nlerpQuaternion(a, b, 0.5)).toEqual([0, 1, 0, 0])
  })

  it('rejects malformed, nonfinite and near-zero endpoints even at interval boundaries', () => {
    const invalid = [
      [],
      [0, 0, 1],
      [0, 0, 0, 1, 0],
      new Array<number>(4),
      [NaN, 0, 0, 1],
      [0, Infinity, 0, 1],
      [0, 0, -Infinity, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 1e-12],
      [0, 0, 0, Number.MIN_VALUE],
      [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0],
    ]
    for (const value of invalid) {
      expect(() => nlerpQuaternion(value, identity, 1)).toThrow(RangeError)
      expect(() => nlerpQuaternion(identity, value, 0)).toThrow(RangeError)
    }
    // Valid endpoints whose blended norm is below the explicit admission threshold.
    expect(() => nlerpQuaternion([1.1e-12, 0, 0, 0], [0, 1.1e-12, 0, 0], 0.5)).toThrow(RangeError)
  })

  it('rejects extrapolation and nonfinite fractions', () => {
    for (const t of [-0.01, 1.01, NaN, Infinity, -Infinity])
      expect(() => nlerpQuaternion(identity, turn120, t)).toThrow(RangeError)
  })
})

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

  it('bounds how much a linear part lengthens a vector, exactly after a rotation and a scale', () => {
    // T·R·S: the largest scale, whatever the turn and the translation
    expect(linearStretch(matrix)).toBeCloseTo(4, 10)
    const turned = [0, -0.5, 0, 0, 0.5, 0, 0, 0, 0, 0, -0.25, 0, 9, 9, 9, 1]
    expect(linearStretch(turned)).toBeCloseTo(0.5, 10)
    // a shear: never below its largest singular value, √((3 + √5) / 2), here √3
    const shear = [1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    expect(linearStretch(shear)).toBeGreaterThanOrEqual(Math.sqrt((3 + Math.sqrt(5)) / 2))
    expect(linearStretch(shear)).toBeCloseTo(Math.sqrt(3), 10)
  })
})
