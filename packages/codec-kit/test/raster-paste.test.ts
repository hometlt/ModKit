import { describe, expect, it } from 'vitest'
import { pasteRgba } from '../src/raster/ops.js'

const image = (width: number, height: number, rgba: readonly number[]) => ({
  width,
  height,
  pixels: new Uint8Array(Array.from({ length: width * height }, () => rgba).flat()),
})

describe('pasteRgba', () => {
  it('blends source-over, keeps the larger alpha and clips to the canvas', () => {
    const canvas = image(2, 2, [0, 0, 0, 200])
    pasteRgba(canvas, image(2, 2, [255, 0, 0, 51]), 1, 1)
    expect([...canvas.pixels.subarray(0, 12)]).toEqual([0, 0, 0, 200, 0, 0, 0, 200, 0, 0, 0, 200])
    expect([...canvas.pixels.subarray(12)]).toEqual([51, 0, 0, 200])
  })

  it('copies an opaque base layer and skips transparent source pixels', () => {
    const canvas = image(1, 1, [9, 9, 9, 0])
    pasteRgba(canvas, image(1, 1, [1, 2, 3, 0]), 0, 0)
    expect([...canvas.pixels]).toEqual([9, 9, 9, 0])
    pasteRgba(canvas, image(1, 1, [1, 2, 3, 0]), 0, 0, 'opaque')
    expect([...canvas.pixels]).toEqual([1, 2, 3, 255])
  })
})
