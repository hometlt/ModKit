/** The existing container layer gains opt-in ranges without a second storage decoder. */
import { describe, expect, it } from 'vitest'
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'
import { containerEntryLayer, openContainerEntryLayer } from '../src/container-entries.js'
import type { ContainerEntryTable } from '../src/index.js'

const source: ArtifactByteSource = {
  kind: 'bytes',
  ref: { id: 'native-bundle', uri: 'native://bundle' },
  revision: revisionId('provider-token:pinned'),
  size: 0n,
  async read() {
    throw new Error('Parent bytes must not replace the entry source')
  },
  async *stream() {
    throw new Error('Whole stream forbidden')
  },
}
const byteSource = { size: async () => 0n, read: source.read }
const budget = {
  maxInputBytes: 8n,
  maxNodes: 100,
  maxDepth: 8,
  maxScalarBytes: 1024,
  maxDiagnostics: 10,
}

/** A virtual 4GiB stored companion, exercising the existing openEntrySource companion lease. */
function fixture() {
  const state = { released: 0, closed: 0, reads: [] as [bigint, number][] }
  const table: ContainerEntryTable = {
    complete: true,
    entries: [
      {
        path: 'CAB',
        size: 2n ** 32n,
        context: { native: 'selected' },
        storage: { kind: 'stored', offset: 0n, length: 2n ** 32n, source: 'resource' },
      },
    ],
  }
  const ranges = {
    source,
    budget,
    async companionSource() {
      return {
        source: {
          size: async () => 2n ** 32n,
          async read(offset: bigint, length: number) {
            state.reads.push([offset, length])
            return new Uint8Array(length).fill(9)
          },
        },
        release: async () => {
          state.released += 1
        },
      }
    },
  }
  return {
    state,
    table,
    ranges,
    close: async () => {
      state.closed += 1
    },
  }
}

describe('container layer ranged storage bridge', () => {
  it('uses the namespace admitted lazy entry once and rejects an answer for another path', async () => {
    let finds = 0
    const { table, ranges, close } = fixture()
    const lazy = containerEntryLayer(
      'lazy',
      {
        complete: false,
        entries: [],
        async find() {
          finds += 1
          if (finds > 1) throw new Error('The pinned entry must not be looked up again')
          return table.entries[0]
        },
      },
      byteSource,
      close,
      ranges,
    )
    expect((await lazy.lookup!('CAB'))?.context).toEqual({ native: 'selected' })
    const opened = await lazy.openRange!('CAB')
    expect(await opened!.source.readAt(0, 2)).toEqual(new Uint8Array([9, 9]))
    await opened!.source.dispose()
    expect(finds).toBe(1)
    const wrong = containerEntryLayer(
      'wrong',
      { complete: false, entries: [], find: async () => table.entries[0] },
      byteSource,
      close,
      ranges,
    )
    await expect(wrong.openRange!('another')).rejects.toThrow(/another or an invalid entry/)
  })
  it('keeps the four-argument path and its existing validation/close semantics', async () => {
    let closed = 0
    const layer = containerEntryLayer(
      'legacy',
      {
        complete: true,
        entries: [
          { path: '../legacy', size: 0n, storage: { kind: 'stored', offset: 0n, length: 0n } },
        ],
      },
      byteSource,
      () => {
        closed += 1
      },
    )
    expect(layer.entries[0]?.path).toBe('../legacy')
    expect(layer.entries[0]?.rangeAccess).toBeUndefined()
    expect(layer.openRange).toBeUndefined()
    await layer.close()
    expect(closed).toBe(1)
  })
  it('uses native companion ranges, exact coordinates and idempotent release without whole reads', async () => {
    const { state, table, ranges, close } = fixture()
    const layer = await openContainerEntryLayer(
      'bundle',
      byteSource,
      async () => table,
      close,
      ranges,
    )
    expect(layer.entries[0]).toMatchObject({ rangeAccess: true, context: { native: 'selected' } })
    await expect(layer.read('CAB', 8)).rejects.toThrow(/exceeds/)
    const opened = await layer.openRange!('CAB')
    expect(opened).toBeDefined()
    expect(await opened!.source.size()).toBe(2 ** 32)
    expect(opened!.revision).toContain('pinned')
    expect(await opened!.source.readAt(2 ** 32 - 2, 2)).toEqual(new Uint8Array([9, 9]))
    for (const offset of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER])
      await expect(opened!.source.readAt(offset, 1)).rejects.toThrow(/outside/)
    const stream = opened!.source.stream(2 ** 32 - 2, 2 ** 32).getReader()
    expect((await stream.read()).value).toEqual(new Uint8Array([9, 9]))
    expect((await stream.read()).done).toBe(true)
    stream.releaseLock()
    expect(state.reads).toEqual([
      [2n ** 32n - 2n, 2],
      [2n ** 32n - 2n, 2],
    ])
    await opened!.source.dispose()
    await opened!.source.dispose()
    await expect(opened!.source.readAt(0, 0)).rejects.toThrow(/disposed/)
    expect(state.released).toBe(1)
    expect(state.closed).toBe(0)
    await layer.close()
    expect(state.closed).toBe(1)
  })
  it('does not advertise an ordinary compressed entry as ranged', async () => {
    const { ranges, close } = fixture()
    const layer = containerEntryLayer(
      'compressed',
      {
        complete: true,
        entries: [
          { path: 'z', size: 100n, storage: { kind: 'zlib', offset: 0n, compressedLength: 8n } },
        ],
      },
      byteSource,
      close,
      ranges,
    )
    expect(layer.entries[0]?.rangeAccess).toBeUndefined()
    expect(await layer.openRange!('z')).toBeUndefined()
  })
  it('rejects cancellation and short reads, releasing the acquired source once', async () => {
    const { state, table, ranges, close } = fixture()
    const layer = containerEntryLayer('native', table, byteSource, close, ranges)
    const abort = new AbortController()
    abort.abort()
    await expect(layer.openRange!('CAB', abort.signal)).rejects.toThrow(/cancelled/)
    const opened = await layer.openRange!('CAB')
    await expect(opened!.source.readAt(0, 1, abort.signal)).rejects.toThrow(/cancelled/)
    await opened!.source.dispose()
    expect(state.released).toBe(1)
    const shortLayer = containerEntryLayer(
      'short',
      {
        complete: true,
        entries: [
          {
            path: 'x',
            size: 1n,
            storage: {
              kind: 'custom',
              rangeAccess: true,
              open: async () => ({ size: async () => 1n, read: async () => new Uint8Array() }),
            },
          },
        ],
      },
      byteSource,
      close,
      { source, budget },
    )
    const short = await shortLayer.openRange!('x')
    await expect(short!.source.readAt(0, 1)).rejects.toThrow(/truncated/)
    await short!.source.dispose()
  })
  it('refuses a decoded extent that disagrees with the published entry', async () => {
    const layer = containerEntryLayer(
      'mismatch',
      {
        complete: true,
        entries: [
          {
            path: 'x',
            size: 1n,
            storage: {
              kind: 'custom',
              rangeAccess: true,
              open: async () => ({ size: async () => 2n, read: async () => new Uint8Array() }),
            },
          },
        ],
      },
      byteSource,
      async () => {},
      { source, budget },
    )
    await expect(layer.openRange!('x')).rejects.toThrow(/differs from its entry/)
  })
})
