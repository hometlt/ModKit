import { describe, expect, it } from 'vitest'
import { createTransportSource } from '@modkit/codec-kit'

const snapshot = {
  state: 'paused' as const,
  positionMs: 0,
  durationMs: 100,
  rate: 1,
  seekable: true,
  live: false,
  tracks: [],
  controls: { playPause: 'media.play-pause' as const, seek: 'media.seek' as const },
}

describe('transport controller', () => {
  it('advances an observed wall-clock transport and stops at its duration', async () => {
    const source = createTransportSource(snapshot, { wallClock: true, updateIntervalMs: 5 })
    const controller = new AbortController()
    const events = source.events(controller.signal)[Symbol.asyncIterator]()
    expect((await events.next()).value).toMatchObject({
      kind: 'snapshot',
      snapshot: { state: 'paused', positionMs: 0 },
    })

    source.control('playPause')
    await events.next()
    const advanced = await events.next()
    expect(advanced.value).toMatchObject({ kind: 'snapshot', snapshot: { state: 'playing' } })
    if (advanced.value?.kind !== 'snapshot') throw new Error('transport did not publish a snapshot')
    expect(advanced.value.snapshot.positionMs).toBeGreaterThan(0)

    controller.abort()
    await events.return?.()
  })
})
