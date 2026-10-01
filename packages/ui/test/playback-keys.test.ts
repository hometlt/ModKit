import { describe, expect, it } from 'vitest'
import { PLAYBACK_SEEK_STEP_MS, playbackKeyAction } from '../src/transport/playback.js'

const key = (name: string, extra: Partial<{ ctrlKey: boolean; target: unknown }> = {}) => ({
  key: name,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  target: null,
  ...extra,
})

describe('the player keys', () => {
  const snapshot = { positionMs: 2_000, durationMs: 60_000 }

  it('toggles on Space and steps five seconds on the arrows, within the recording', () => {
    expect(playbackKeyAction(key(' '), snapshot)).toEqual({ kind: 'toggle' })
    expect(playbackKeyAction(key('ArrowRight'), snapshot)).toEqual({
      kind: 'seek',
      positionMs: 2_000 + PLAYBACK_SEEK_STEP_MS,
    })
    expect(playbackKeyAction(key('ArrowLeft'), snapshot)).toEqual({ kind: 'seek', positionMs: 0 })
    expect(
      playbackKeyAction(key('ArrowRight'), { positionMs: 58_000, durationMs: 60_000 }),
    ).toEqual({ kind: 'seek', positionMs: 60_000 })
    // a live or unmeasured recording has no end to clamp to
    expect(
      playbackKeyAction(key('ArrowRight'), { positionMs: 58_000, durationMs: 'unknown' }),
    ).toEqual({ kind: 'seek', positionMs: 63_000 })
  })

  it('leaves controls their own keys, and chords and other keys to the host', () => {
    const slider = { closest: (selector: string) => (selector.includes('input') ? {} : null) }
    expect(playbackKeyAction(key('ArrowLeft', { target: slider }), snapshot)).toBeUndefined()
    expect(playbackKeyAction(key(' ', { ctrlKey: true }), snapshot)).toBeUndefined()
    expect(playbackKeyAction(key('v'), snapshot)).toBeUndefined()
    const canvas = { closest: () => null }
    expect(playbackKeyAction(key(' ', { target: canvas }), snapshot)).toEqual({ kind: 'toggle' })
  })
})
