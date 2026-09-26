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
