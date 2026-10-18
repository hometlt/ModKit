/** Range acquisition must keep one winning copy and its archive generation alive without whole reads. */
import { describe, expect, it } from 'vitest'
import {
  composeContentSources,
  createLayeredArchiveContentSources,
  layeredModContext,
  type ContentSources,
  type LayerArchive,
} from '../src/content-sources.js'
import type { RandomAccessSource } from '../src/source.js'

const root = { id: 'local:game', label: 'game', region: 'local', kind: 'local' as const }

/** Controllable async acquisition without sleeps or scheduler assumptions. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => {
    resolve = accept
  })
  return { promise, resolve }
}

/** A 4GiB source allocates only requested bytes; closing its archive invalidates native access. */
function archive(id: string) {
  const state = {
    archiveCloses: 0,
    sourceCloses: 0,
    wholeReads: 0,
    reads: [] as [number, number][],
    disposeError: false,
  }
  const value: LayerArchive = {
    id,
    entries: [{ path: 'CAB-native', size: 2 ** 32, rangeAccess: true, context: { native: id } }],
    async read() {
      state.wholeReads += 1
      throw new Error('Whole entry read forbidden')
    },
    async openRange() {
      const source: RandomAccessSource = {
        id,
        async size() {
          return 2 ** 32
        },
        async readAt(offset, length) {
          if (state.archiveCloses !== 0) throw new Error('Archive already closed')
          state.reads.push([offset, length])
          return new Uint8Array(length).fill(id.charCodeAt(0))
        },
        stream() {
          throw new Error('Whole stream forbidden')
        },
        async dispose() {
          state.sourceCloses += 1
          if (state.disposeError) throw new Error('Source disposal failed')
        },
      }
      return { source, revision: `native-index:${id}` }
    },
    async close() {
      state.archiveCloses += 1
    },
  }
  return { value, state }
}

describe('content source ranged leases', () => {
  it('retains acquired facts from the winning old generation across a racing refresh', async () => {
    const old = archive('old')
    const next = archive('next')
    const started = deferred<void>()
    const finish = deferred<void>()
    const original = old.value.openRange!
    old.value.openRange = async (path, signal) => {
      started.resolve()
      await finish.promise
      const opened = await original(path, signal)
      return opened === undefined ? undefined : { ...opened, context: { nativeObject: 'old-77' } }
    }
    let opens = 0
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [++opens === 1 ? old.value : next.value] },
    ])
    const opening = sources.openRangeWithContext!(root.id, 'CAB-native')
    await started.promise
    await sources.refresh(root.id)
    finish.resolve()
    const range = await opening
    expect(range?.context).toEqual({ nativeObject: 'old-77' })
    expect(range?.revision).toBe('native-index:old')
    expect(await range!.source.readAt(0, 1)).toEqual(Uint8Array.of(111))
    await range!.source.dispose()
    expect(old.state.archiveCloses).toBe(1)
    await sources.dispose()
  })
  it('preserves explicit null acquisition facts in a direct ModContext archive', async () => {
    const item = archive('direct')
    const original = item.value.openRange!
    item.value.openRange = async (path, signal) => {
      const opened = await original(path, signal)
      return opened === undefined ? undefined : { ...opened, context: null }
    }
    const sources = createLayeredArchiveContentSources('game', [])
    const context = layeredModContext(sources, {
      gameId: 'game',
      contextId: 'native',
      layers: [
        {
          id: 'native',
          displayName: 'native',
          sourceId: 'host',
          sourcePath: '',
          role: 'primary',
          provenance: 'opened',
          kind: 'files',
          content: { archive: item.value },
        },
      ],
    })
    const range = await context.openRangeWithContext!('native', 'CAB-native')
    expect(range?.context).toBeNull()
    await context.dispose()
    expect(item.state.archiveCloses).toBe(0)
    await range!.source.dispose()
    expect(item.state.archiveCloses).toBe(1)
    await sources.dispose()
  })
  it('keeps the exact old generation live across refresh, with zero whole-entry reads', async () => {
    const old = archive('old')
    const next = archive('next')
    let opens = 0
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [++opens === 1 ? old.value : next.value] },
    ])
    const first = await sources.openRangeWithContext!(root.id, 'cab-native')
    expect((await sources.files(root.id, '', { limit: 10 })).items[0]?.rangeAccess).toBe(true)
    expect((await sources.list(root.id, ''))[0]?.rangeAccess).toBe(true)
    expect((await sources.lookup!(root.id, 'CAB-native'))?.rangeAccess).toBe(true)
    expect(first?.revision).toBe('native-index:old')
    expect(first?.context).toEqual({ native: 'old' })
    expect(await first!.source.size()).toBe(2 ** 32)
    await sources.refresh(root.id)
    expect(old.state.archiveCloses).toBe(0)
    const second = await sources.openRangeWithContext!(root.id, 'CAB-native')
    expect(second?.context).toEqual({ native: 'next' })
    await sources.dispose()
    await expect(sources.openRangeWithContext!(root.id, 'CAB-native')).rejects.toThrow(/disposed/u)
    expect(next.state.archiveCloses).toBe(0)
    expect(await first!.source.readAt(2 ** 32 - 2, 2)).toEqual(new Uint8Array([111, 111]))
    await first!.source.dispose()
    await first!.source.dispose()
    expect(old.state.archiveCloses).toBe(1)
    expect(old.state.sourceCloses).toBe(1)
    expect(next.state.archiveCloses).toBe(0)
    await expect(first!.source.readAt(0, 1)).rejects.toThrow(/disposed/u)
    await second!.source.dispose()
    expect(next.state.archiveCloses).toBe(1)
    expect(old.state.wholeReads + next.state.wholeReads).toBe(0)
  })
  it('pins before awaited provider acquisition, including a racing refresh', async () => {
    const item = archive('held')
    const started = deferred<void>()
    const finish = deferred<void>()
    const original = item.value.openRange!
    item.value.openRange = async (path, signal) => {
      started.resolve()
      await finish.promise
      return original(path, signal)
    }
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [item.value] },
    ])
    const opening = sources.openRangeWithContext!(root.id, 'CAB-native')
    await started.promise
    await sources.refresh(root.id)
    expect(item.state.archiveCloses).toBe(0)
    finish.resolve()
    const range = await opening
    expect(await range!.source.readAt(0, 1)).toEqual(new Uint8Array([104]))
    await range!.source.dispose()
    expect(item.state.archiveCloses).toBe(1)
  })
  it('pins before awaited lazy membership lookup', async () => {
    const item = archive('lookup')
    const started = deferred<void>()
    const finish = deferred<void>()
    const lazy: LayerArchive = {
      ...item.value,
      entries: [],
      async lookup(path) {
        started.resolve()
        await finish.promise
        return { path, context: { native: 'lazy' } }
      },
    }
    const sources = createLayeredArchiveContentSources('game', [{ root, open: async () => [lazy] }])
    const opening = sources.openRangeWithContext!(root.id, 'hidden-key')
    await started.promise
    await sources.refresh(root.id)
    expect(item.state.archiveCloses).toBe(0)
    finish.resolve()
    const range = await opening
    expect(range?.context).toEqual({ native: 'lazy' })
    await range!.source.dispose()
    expect(item.state.archiveCloses).toBe(1)
  })
  it('never reads or selects a lower copy when the winning archive cannot provide ranges', async () => {
    const patch = archive('patch')
    const base = archive('base')
    const { openRange: _, ...unsupported } = patch.value
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [unsupported, base.value] },
    ])
    expect(await sources.openRangeWithContext!(root.id, 'CAB-native')).toBeUndefined()
    expect(base.state.sourceCloses + base.state.wholeReads + patch.state.wholeReads).toBe(0)
    const lower = await (
      await sources.layers(root.id)
    ).openRangeWithContext!('CAB-native', undefined, 1)
    expect(lower?.context).toEqual({ native: 'base' })
    await lower!.source.dispose()
    await sources.dispose()
    expect(patch.state.archiveCloses).toBe(1)
    expect(base.state.archiveCloses).toBe(1)
  })
  it('releases acquisition on cancellation after the provider returns a source', async () => {
    const item = archive('abort')
    const controller = new AbortController()
    const original = item.value.openRange!
    item.value.openRange = async (path, signal) => {
      const result = await original(path, signal)
      controller.abort()
      return result
    }
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [item.value] },
    ])
    await expect(
      sources.openRangeWithContext!(root.id, 'CAB-native', controller.signal),
    ).rejects.toThrow()
    expect(item.state.sourceCloses).toBe(1)
    await sources.dispose()
    expect(item.state.archiveCloses).toBe(1)
  })
  it('retires even when the last source fails disposal, without closing an archive twice', async () => {
    const item = archive('failed')
    item.state.disposeError = true
    const sources = createLayeredArchiveContentSources('game', [
      { root, open: async () => [item.value] },
    ])
    const range = await sources.openRangeWithContext!(root.id, 'CAB-native')
    await sources.dispose()
    await expect(range!.source.dispose()).rejects.toThrow(/Source disposal/u)
    await expect(range!.source.dispose()).rejects.toThrow(/Source disposal/u)
    await sources.refresh(root.id)
    expect(item.state.archiveCloses).toBe(1)
    expect(item.state.sourceCloses).toBe(1)
  })
  it('retains context-owned archives but refuses new leases after context disposal', async () => {
    const item = archive('context')
    const sources = createLayeredArchiveContentSources('game', [])
    const context = layeredModContext(sources, {
      gameId: 'game',
      contextId: 'context',
      layers: [
        {
          id: 'layer',
          displayName: 'layer',
          sourceId: 'host',
          sourcePath: '',
          role: 'primary',
          provenance: 'opened',
          kind: 'files',
          content: { archive: item.value },
        },
      ],
    })
    const range = await context.openRangeWithContext!('layer', 'CAB-native')
    await context.dispose()
    expect(item.state.archiveCloses).toBe(0)
    expect(await range!.source.readAt(0, 1)).toEqual(new Uint8Array([99]))
    await expect(context.openRangeWithContext!('layer', 'CAB-native')).rejects.toThrow(/retired/u)
    await range!.source.dispose()
    await context.dispose()
    expect(item.state.archiveCloses).toBe(1)
  })
  it('forwards provider revision/context through composition and retains legacy providers', async () => {
    const item = archive('composed')
    const provider = createLayeredArchiveContentSources('game', [
      { root, open: async () => [item.value] },
    ])
    const legacy = {
      ...createLayeredArchiveContentSources('legacy', []),
      openRangeWithContext: undefined,
    } as unknown as ContentSources
    const composed = composeContentSources([provider, legacy])
    await composed.snapshot()
    const range = await composed.openRangeWithContext!(root.id, 'CAB-native')
    expect(range?.revision).toBe('native-index:composed')
    expect(range?.context).toEqual({ native: 'composed' })
    await composed.dispose()
    expect(item.state.archiveCloses).toBe(0)
    await range!.source.dispose()
    expect(item.state.archiveCloses).toBe(1)
  })
})
