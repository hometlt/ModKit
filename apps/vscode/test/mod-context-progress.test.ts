import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentSources, ModContext } from '@modkit/vfs/content-sources'
import { announceModContexts } from '../src/mod-context-progress.js'

afterEach(() => {
  vi.useRealTimers()
})

const sourcesTaking = (milliseconds: number): ContentSources =>
  ({
    label: 'fixture',
    // a member that reads `this`, as a source's own methods do
    describe() {
      return (this as { label: string }).label
    },
    async openModContext() {
      await new Promise(resolve => setTimeout(resolve, milliseconds))
      return { layers: [{}, {}, {}] } as unknown as ModContext
    },
  }) as unknown as ContentSources

describe('mod context progress (0.8)', () => {
  it('says a slow context is being built and how many layers it has, and nothing for a fast one', async () => {
    vi.useFakeTimers()
    const building = vi.fn()
    const ready = vi.fn()
    const slow = announceModContexts(sourcesTaking(1_000), { delayMs: 400, building, ready })
    const opened = slow.openModContext?.({ target: 'x' } as never)
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await opened)?.layers).toHaveLength(3)
    expect(building).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledWith(3)

    building.mockClear()
    ready.mockClear()
    const fast = announceModContexts(sourcesTaking(50), { delayMs: 400, building, ready })
    const quick = fast.openModContext?.({ target: 'x' } as never)
    await vi.advanceTimersByTimeAsync(500)
    await quick
    expect(building).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    // the rest of the sources is the original's, `this` included
    expect((fast as unknown as { describe(): string }).describe()).toBe('fixture')
  })
})
