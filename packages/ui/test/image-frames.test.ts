import { describe, expect, it } from 'vitest'
import { frameFileName, gridFrames, shownRegion } from '../src/image/frames.js'
import { enumerateSubresources, subresourceLabel } from '../src/image/index.js'

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

describe('the frames of an animated image', () => {
  const info = {
    width: 4,
    height: 4,
    depth: 1,
    layers: 1,
    faces: 1,
    mipLevels: 2,
    frames: 3,
    channels: 4,
    bitDepth: 8,
    colorSpace: 'srgb',
    alphaMode: 'straight',
    orientation: 'top-left',
    decodedAccess: true,
  } as const

  it('are an axis of their own, outermost, named in an exported file', () => {
    const all = enumerateSubresources(info)
    expect(all).toHaveLength(6)
    expect(all[2]).toEqual({ frame: 1, mipLevel: 0, layer: 0, face: 0, slice: 0 })
    expect(subresourceLabel(info, { frame: 2, mipLevel: 1, layer: 0, face: 0, slice: 0 })).toBe(
      'frame2-mip1',
    )
    // a still image says nothing of frames
    expect(
      subresourceLabel(
        { ...info, frames: 1 },
        { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 },
      ),
    ).toBe('mip0')
  })
})
