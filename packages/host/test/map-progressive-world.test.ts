import { describe, expect, it, vi } from 'vitest'
import type { CandidateWorldSceneSource } from '@modkit/sdk/maps'
import { analyzeWithCatalogEntities, refinableWorldLease } from '../src/maps/index.js'

/** A world lease whose pages name its snapshot, recording its release. */
function world(snapshotId: string, released: string[]) {
  const value = {
    contract: 'common.view/world-scene-source',
    major: 1,
    snapshotId,
    info: async () => ({ snapshotId }),
    page: async () => ({ snapshotId, facet: 'layers', state: 'available', items: [] }),
  } as unknown as CandidateWorldSceneSource
  return { value, release: async () => void released.push(snapshotId) }
}

describe('a map world shown before its catalog answered', () => {
  it('swaps in the answered world when its reader asks, and releases each once', async () => {
    const released: string[] = []
    let answer!: (lease: ReturnType<typeof world> | undefined) => void
    const refinement = new Promise<ReturnType<typeof world> | undefined>(resolve => {
      answer = resolve
    })
    const abort = vi.fn()
    const shared = vi.fn(async () => void released.push('models'))
    const lease = refinableWorldLease(world('first', released), refinement, abort, shared)
    expect((await lease.value.info()).snapshotId).toBe('first')
    const asked = lease.value.refined!()
    answer(world('answered', released))
    expect(await asked).toBe(true)
    // the shown world is released at the swap; the answered one now answers
    expect(released).toEqual(['first'])
    expect(lease.value.snapshotId).toBe('answered')
    expect((await lease.value.page({ facet: 'layers', limit: 1 })).snapshotId).toBe('answered')
    await lease.release()
    await lease.release()
    expect(released).toEqual(['first', 'answered', 'models'])
    expect(abort).toHaveBeenCalledOnce()
  })

  it('keeps the first world when nothing new is answered, and ends a pending refinement', async () => {
    const released: string[] = []
    const kept = refinableWorldLease(
      world('first', released),
      Promise.resolve(undefined),
      () => undefined,
      async () => undefined,
    )
    expect(await kept.value.refined!()).toBe(false)
    expect(kept.value.snapshotId).toBe('first')

    const late: string[] = []
    let answer!: (lease: ReturnType<typeof world> | undefined) => void
    const pending = refinableWorldLease(
      world('first', late),
      new Promise(resolve => {
        answer = resolve
      }),
      () => answer(world('late', late)),
      async () => undefined,
    )
    await pending.release()
    // a refinement that arrives after the release is released too
    expect(late).toEqual(['first', 'late'])
  })

  it('answers the rounds from an analysis the caller already ran', async () => {
    const analyze = vi.fn(async () => ({ semantic: { catalogQueries: [] } }))
    const initial = { semantic: { catalogQueries: [{ namespace: 'Unit', entityId: 'Marine' }] } }
    await analyzeWithCatalogEntities({
      workspace: { workspaceId: 'w', gameId: 'g' },
      analyze,
      catalogEntities: async () => [],
      initial,
    })
    // round 0 was the caller's: the host analysed once more, with the answers
    expect(analyze.mock.calls.map(call => call[1])).toEqual([1])
  })
})
