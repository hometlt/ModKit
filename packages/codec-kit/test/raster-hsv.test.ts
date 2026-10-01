import { describe, expect, it } from 'vitest'
import { hsvToRgb, rgbToHsv } from '../src/raster/ops.js'

describe('HSV', () => {
  it('turns hue, saturation and value into RGB and back', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([1, 0, 0])
    const green = hsvToRgb(1 / 3, 1, 0.5)
    expect(green[0]).toBeCloseTo(0, 12)
    expect([green[1], green[2]]).toEqual([0.5, 0])
    expect(hsvToRgb(1.5, 0, 0.25)).toEqual([0.25, 0.25, 0.25])
    expect(rgbToHsv([0, 0, 1])).toEqual([2 / 3, 1, 1])
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual([0, 0, 0.5])
  })
})
