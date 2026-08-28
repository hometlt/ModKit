import { describe, expect, it } from 'vitest'

import { createCascNamespaceSource, detectCascMarkers } from '../src/casc/codec.js'
import { CASC_LIMITS } from '../src/casc/limits.js'
import { cascSourceFromNamespace } from '../src/casc/source.js'

const revision = 'content-hash.sha256:casc-test'
const sourceRef = { id: 'casc-test', uri: 'memory://casc-test' }

function fakeReader(count = 300) {
  const entries = Object.freeze(
    Array.from({ length: count }, (_, index) => ({
      path: `files/entry-${String(index).padStart(4, '0')}.bin`,
      contentSize: index + 1,
    })),
  )
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  return {
    entries,
    resolveFile(path: string) {
      return byPath.get(path)
    },
  }
}

describe('CASC namespace adapter', () => {
  it('detects only the bounded StarCraft II marker set', async () => {
    await expect(
      detectCascMarkers([
        { path: '.build.info', kind: 'file' },
        { path: 'SC2Data/config', kind: 'directory' },
        { path: 'SC2Data/data', kind: 'directory' },
        { path: 'SC2Data/indices', kind: 'directory' },
      ]),
    ).resolves.toMatchObject({ confidence: 0.99, kind: 'structure' })
    await expect(
      detectCascMarkers([
        { path: '.build.info', kind: 'file' },
        { path: 'Data/data', kind: 'directory' },
      ]),
    ).resolves.toMatchObject({ confidence: 0 })
  })

  it('lists stable pages, enforces the page cap and honors cancellation', async () => {
    const namespace = createCascNamespaceSource(fakeReader(), sourceRef, revision)
    const first = await namespace.list('files/', { limit: 2 })
    expect(first.items.map(item => item.path)).toEqual([
      'files/entry-0000.bin',
      'files/entry-0001.bin',
    ])
    const second = await namespace.list('files/', { cursor: first.nextCursor, limit: 2 })
    expect(second.items.map(item => item.path)).toEqual([
      'files/entry-0002.bin',
      'files/entry-0003.bin',
    ])
    await expect(namespace.list('', { limit: CASC_LIMITS.maxPageItems + 1 })).rejects.toMatchObject(
      { code: 'x3.casc/page-limit-exceeded' },
    )

    const controller = new AbortController()
    controller.abort()
    await expect(namespace.list('', { limit: 1 }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('searches marker basenames in bounded source-index pages without retaining every match', async () => {
    const commonEntries = Object.freeze(
      Array.from({ length: 20_000 }, (_, index) => ({
        path: `maps/map-${String(index).padStart(5, '0')}.sc2map/index`,
        contentSize: index + 1,
      })),
    )
    const byPath = new Map(commonEntries.map(item => [item.path, item]))
    const namespace = createCascNamespaceSource(
      {
        entries: commonEntries,
        resolveFile(path: string) {
          return byPath.get(path)
        },
      },
      sourceRef,
      revision,
    )
    const first = await namespace.search(
      { kind: 'basename-any', basenames: ['INDEX'], caseSensitive: false },
      { limit: 2 },
    )
    expect(first.items.map(item => item.path)).toEqual([
      'maps/map-00000.sc2map/index',
      'maps/map-00001.sc2map/index',
    ])
    expect(first.nextCursor).toBe('2')
    const second = await namespace.search(
      { kind: 'basename-any', basenames: ['index'], caseSensitive: false },
      { cursor: first.nextCursor, limit: 2 },
    )
    expect(second.items.map(item => item.path)).toEqual([
      'maps/map-00002.sc2map/index',
      'maps/map-00003.sc2map/index',
    ])

    await expect(
      namespace.search(
        { kind: 'basename-any', basenames: ['index', 'INDEX'], caseSensitive: false },
        { limit: 1 },
      ),
    ).rejects.toMatchObject({ code: 'x3.casc/search-query-invalid' })
    await expect(
      namespace.search(
        {
          kind: 'basename-any',
          basenames: Array.from(
            { length: CASC_LIMITS.maxSearchBasenames + 1 },
            (_, index) => `marker-${String(index)}`,
          ),
          caseSensitive: true,
        },
        { limit: 1 },
      ),
    ).rejects.toMatchObject({ code: 'x3.casc/search-query-invalid' })
    await expect(
      namespace.search(
        { kind: 'basename-any', basenames: ['index'], caseSensitive: false },
        { cursor: '20001', limit: 1 },
      ),
    ).rejects.toMatchObject({ code: 'x3.casc/search-cursor-invalid' })
  })

  it('chunks Host reads and rejects oversized ranges before opening a file', async () => {
    const size = CASC_LIMITS.maxHostReadBytes + 1
    const reads: number[] = []
    let opens = 0
    const namespace = {
      async open() {
        opens += 1
        return {
          value: {
            kind: 'bytes' as const,
            size: BigInt(size),
            async read(_offset: bigint, length: number) {
              reads.push(length)
              return new Uint8Array(length)
            },
          },
          async release() {
            return undefined
          },
        }
      },
      async *list() {
        return undefined
      },
    }
    const source = cascSourceFromNamespace(namespace)
    await expect(source.get('metadata.bin')).resolves.toHaveLength(size)
    expect(reads).toEqual([CASC_LIMITS.maxHostReadBytes, 1])
    await expect(
      source.getRange('data.000', 0, CASC_LIMITS.maxContainerReadBytes + 1),
    ).rejects.toMatchObject({ code: 'x3.casc/container-read-budget-exceeded' })
    expect(opens).toBe(1)
  })

  it('bounds directory listings and cancellation at the namespace boundary', async () => {
    const namespace = {
      async open() {
        throw Object.assign(new Error('not found'), {
          code: 'x3.host/namespace-entry-not-found',
        })
      },
      async *list() {
        for (let index = 0; index <= CASC_LIMITS.maxListEntries; index += 1) {
          yield { path: `entry-${index}`, kind: 'bytes' as const }
        }
      },
    }
    await expect(cascSourceFromNamespace(namespace).list('SC2Data/data')).rejects.toMatchObject({
      code: 'x3.casc/list-entry-budget-exceeded',
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      cascSourceFromNamespace(namespace, controller.signal).exists('entry'),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
