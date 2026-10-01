import { describe, expect, it } from 'vitest'
import { linearToSrgb, srgbToLinear } from '../src/raster/index.js'

describe('sRGB transfer', () => {
  it('turns an sRGB channel into linear light and back', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1, 12)
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 5)
    for (const value of [0, 0.01, 0.2, 0.5, 0.73, 1])
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 10)
  })
})
