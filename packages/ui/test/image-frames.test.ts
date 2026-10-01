import { describe, expect, it } from 'vitest'
import { frameFileName, gridFrames, shownRegion } from '../src/image/frames.js'

describe('sprite-sheet frames', () => {
  it('lays a grid row by row and leaves a remainder outside', () => {
    const frames = gridFrames(100, 50, 3, 2)
    expect(frames).toHaveLength(6)
    expect(frames[0]).toEqual({ x: 0, y: 0, width: 33, height: 25, name: '0' })
    expect(frames[4]).toEqual({ x: 33, y: 25, width: 33, height: 25, name: '4' })
    // cells smaller than a pixel, or more cells than a page should draw, are no grid at all
    expect(gridFrames(4, 4, 8, 1)).toEqual([])
    expect(gridFrames(10_000, 10_000, 100, 100)).toEqual([])
  })

  it('scales a mip-0 region to a smaller shown mip and keeps it inside the image', () => {
    const base = { width: 256, height: 128 }
    expect(shownRegion({ x: 64, y: 32, width: 64, height: 32 }, base, 128, 64)).toEqual({
      x: 32,
      y: 16,
      width: 32,
      height: 16,
    })
    expect(shownRegion({ x: 255, y: 0, width: 8, height: 1, name: 'a' }, base, 64, 32)).toEqual({
      x: 63,
      y: 0,
      width: 1,
      height: 1,
      name: 'a',
    })
  })

  it('names exported frames in order, with the format name when it has one', () => {
    expect(frameFileName('marine', 7, 21)).toBe('marine_frame_007.png')
    expect(frameFileName('marine', 7, 21, '7')).toBe('marine_frame_007.png')
    expect(frameFileName('ui', 12, 2_000, 'idle left')).toBe('ui_frame_0012_idle_left.png')
  })
})
