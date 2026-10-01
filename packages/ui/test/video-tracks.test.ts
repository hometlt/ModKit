import { describe, expect, it } from 'vitest'
import { videoTrackLine } from '../src/video/index.js'

describe('video track facts', () => {
  it('lists codec, picture size, frame rate and language, leaving out what a track lacks', () => {
    expect(
      videoTrackLine({
        id: 'v0',
        kind: 'video',
        codec: 'vp9',
        selected: true,
        width: 640,
        height: 360,
        frameRate: 29.97002997,
      }),
    ).toBe('vp9 · 640×360 · 29.97 fps')
    expect(
      videoTrackLine({ id: 'a0', kind: 'audio', codec: 'opus', selected: true, language: 'ru' }),
    ).toBe('opus · ru')
  })
})
