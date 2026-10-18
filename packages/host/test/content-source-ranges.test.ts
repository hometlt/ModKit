/** Public companion origins must retain large ranged files and immutable native identity. */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { validateSubjectDescriptorV2 } from '@modkit/sdk/descriptor'
import { createLayeredArchiveContentSources, type LayerArchive } from '@modkit/vfs/content-sources'
import { createContentSourceCompanionOrigin } from '../src/content-source-companion.js'
import { createContentDependencyAssetOrigin } from '../src/content-dependencies.js'
import { openContentSourceRootSession } from '../src/content-source-root-session.js'

const root = { id: 'local:game', label: 'game', kind: 'local' as const, region: 'local' }

// Compile the descriptor schema outside the range/lifetime assertions' per-test deadline.
beforeAll(async () => {
  await validateSubjectDescriptorV2({})
})

/** A provider-pinned file larger than the whole-entry ceiling, allocating only requested ranges. */
function provider(context: unknown = { nativeKey: 'original' }) {
  const state = { closed: 0, released: 0, reads: [] as [number, number][] }
  const read = vi.fn(async () => {
    throw new Error('Whole-file read forbidden')
  })
  const archive: LayerArchive = {
    id: 'native-bundle',
    entries: [{ path: 'CAB-native', size: 2 ** 32, rangeAccess: true, context }],
    read,
    async openRange() {
      return {
        revision: 'native:index-1',
        source: {
          id: 'retained-native',
          async size() {
            return 2 ** 32
          },
          async readAt(offset: number, length: number) {
            state.reads.push([offset, length])
            return new Uint8Array(length).fill(42)
          },
          stream() {
            throw new Error('Whole stream forbidden')
          },
          async dispose() {
            state.released += 1
          },
        },
      }
    },
    async close() {
      state.closed += 1
    },
  }
  const sources = createLayeredArchiveContentSources('game', [
    { root, open: async () => [archive] },
  ])
  return { sources, state, read }
}

/** Exercise each existing public origin, including its native membership/winner selection. */
function originOf(kind: 'direct' | 'dependency', sources: ReturnType<typeof provider>['sources']) {
  return kind === 'direct'
    ? createContentSourceCompanionOrigin({
        contentSources: sources,
        target: { sourceId: root.id, path: 'selected.prefab' },
        maximumEntryBytes: 8,
      })
    : createContentDependencyAssetOrigin({
        contentSources: sources,
        maximumEntryBytes: 8,
        resolution: {
          schemaVersion: 1,
          gameId: 'game',
          complete: true,
          dependencies: [],
          diagnostics: [],
          mounts: [
            {
              dependencyId: 'native',
              order: 0,
              sourceId: root.id,
              sourcePath: '',
              displayName: 'native',
              kind: 'files',
              fingerprint: 'provider-token:root',
            },
          ],
        },
      })!
}

describe('ranged files through public content companion origins', () => {
  it('publishes ranges through root listing, children and lookup and retains the native lease', async () => {
    const { sources, state, read } = provider()
    const { session } = await openContentSourceRootSession({
      sources,
      root,
      grant: { id: 'ranges', classes: ['read-source'] },
      budget: {
        maxInputBytes: 8n,
        maxNodes: 100,
        maxDepth: 8,
        maxScalarBytes: 1024,
        maxDiagnostics: 10,
      },
    })
    const namespace = await session.dataSource('common.view/namespace-entry-source', 1)
    expect((await namespace.value.list('', { limit: 10 })).items[0]?.rangeAccess).toBe(true)
    expect((await namespace.value.children!('', { limit: 10 })).items[0]?.rangeAccess).toBe(true)
    expect((await namespace.value.lookup!('CAB-native'))?.rangeAccess).toBe(true)
    const artifact = await namespace.value.openEntryArtifactSource!('CAB-native')
    expect(artifact.value.containerContext).toEqual({ nativeKey: 'original' })
    expect(artifact.value.ref.uri).toBe('content-source://local%3Agame/CAB-native')
    const legacy = await namespace.value.openEntrySource!('CAB-native')
    await sources.dispose()
    await session.dispose()
    expect(state.closed).toBe(0)
    expect(await artifact.value.read(2n ** 32n - 2n, 2)).toEqual(new Uint8Array([42, 42]))
    expect(await legacy.value.read(0n, 2)).toEqual(new Uint8Array([42, 42]))
    await artifact.release()
    expect(state.closed).toBe(0)
    await legacy.release()
    await namespace.release()
    expect(state.closed).toBe(1)
    expect(state.released).toBe(2)
    expect(read).not.toHaveBeenCalled()
  })
  it.each(['direct', 'dependency'] as const)(
    'opens a 4GiB file by range through %s and pins its context',
    async kind => {
      const context = { nativeKey: 'original' }
      const { sources, state, read } = provider(context)
      const lease = await originOf(kind, sources).open('CAB-native')
      expect(lease.value.kind).toBe('bytes')
      if (lease.value.kind !== 'bytes') throw new Error('Expected byte source')
      expect(lease.value.size).toBe(2n ** 32n)
      expect(lease.value.revision).toContain('native')
      context.nativeKey = 'mutated after admission'
      expect(lease.value.containerContext).toEqual({ nativeKey: 'original' })
      await sources.dispose()
      expect(state.closed).toBe(0)
      expect(await lease.value.read(2n ** 32n - 2n, 2)).toEqual(new Uint8Array([42, 42]))
      expect(state.reads).toEqual([[2 ** 32 - 2, 2]])
      expect(read).not.toHaveBeenCalled()
      await lease.release()
      await lease.release()
      expect(state.closed).toBe(1)
      expect(state.released).toBe(1)
    },
  )
  it.each(['direct', 'dependency'] as const)(
    'releases a source with rejected native context through %s',
    async kind => {
      const { sources, state, read } = provider({ executable: () => 1 })
      await expect(originOf(kind, sources).open('CAB-native')).rejects.toThrow()
      expect(state.released).toBe(1)
      expect(read).not.toHaveBeenCalled()
      await sources.dispose()
      expect(state.closed).toBe(1)
    },
  )
  it('keeps bounded legacy reads and their atomic context when ranges are unsupported', async () => {
    const read = vi.fn(async () => new Uint8Array([99]))
    const readWithContext = vi.fn(async (_id: string, _path: string, max: number) => {
      expect(max).toBe(8)
      return { bytes: new Uint8Array([7]), context: { native: 'legacy' } }
    })
    const origin = createContentSourceCompanionOrigin({
      contentSources: {
        list: async () => [],
        read,
        readWithContext,
        openRangeWithContext: async () => undefined,
      },
      target: { sourceId: root.id, path: 'selected.prefab' },
      maximumEntryBytes: 8,
    })
    const lease = await origin.open('CAB-native')
    expect(lease.value.containerContext).toEqual({ native: 'legacy' })
    expect(readWithContext).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    await lease.release()
  })
})
