import { describe, expect, it } from 'vitest'
import { boundsOf } from '../src/model/bounds.js'

describe('model bounds', () => {
  it('reads xyz of interleaved vertices and refuses a stride below three', () => {
    expect(boundsOf(Float32Array.of(1, -2, 3, -4, 5, 0.5))).toEqual({
      min: [-4, -2, 0.5],
      max: [1, 5, 3],
    })
    expect(boundsOf([0, 0, 0, 9, 9, 1, 1, 1, 9], 4)).toEqual({ min: [0, 0, 0], max: [9, 1, 1] })
    expect(() => boundsOf([], 2)).toThrow(RangeError)
  })
})
