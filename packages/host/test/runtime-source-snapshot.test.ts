import { describe, expect, it } from 'vitest'
import { captureRuntimeSourceReads, RuntimeSourceChangedError } from '@modkit/host/runtime'
import type { ModContext } from '@modkit/vfs/content-sources'

const encoder = new TextEncoder()
const source = (files: Map<string, string>): ModContext =>
  Object.freeze({
    schemaVersion: 1,
    gameId: 'test/game',
    contextId: 'same-context',
    layers: [],
    unresolved: [],
    diagnostics: [],
    async files() {
      return { items: [] }
    },
    async read(layerId, path, maxBytes) {
      const text = files.get(`${layerId}/${path}`)
      if (text === undefined) throw new Error('missing source')
      const bytes = encoder.encode(text)
      if (bytes.byteLength > maxBytes) throw new Error('source too large')
      return bytes
    },
    async locate() {
      return undefined
    },
    async query() {
      return undefined
    },
    async dispose() {
      return undefined
    },
  })

describe('Runtime source read snapshot', () => {
  it('binds only consumed bytes and makes their order irrelevant', async () => {
    const files = new Map([
      ['base/b.xml', 'two'],
      ['base/a.xml', 'one'],
    ])
    const first = captureRuntimeSourceReads(source(files))
    await first.context.read('base', 'b.xml', 16)
    await first.context.read('base', 'a.xml', 16)
    const recorded = await first.verify()
    expect(recorded).toMatchObject({ fileCount: 2, totalBytes: 6 })
    const second = captureRuntimeSourceReads(source(files))
    await second.context.read('base', 'a.xml', 16)
    await second.context.read('base', 'b.xml', 16)
    expect((await second.verify()).digest).toBe(recorded.digest)
  })

  it('refuses a changed, missing, or inconsistent source with the same contextId', async () => {
    const files = new Map([['base/a.xml', 'one']])
    const first = captureRuntimeSourceReads(source(files))
    await first.context.read('base', 'a.xml', 16)
    files.set('base/a.xml', 'two')
    await expect(first.verify()).rejects.toBeInstanceOf(RuntimeSourceChangedError)
    const second = captureRuntimeSourceReads(source(files))
    await second.context.read('base', 'a.xml', 16)
    files.set('base/a.xml', 'three')
    await expect(second.context.read('base', 'a.xml', 16)).rejects.toBeInstanceOf(
      RuntimeSourceChangedError,
    )
    files.delete('base/a.xml')
    await expect(second.verify()).rejects.toMatchObject({ code: 'x3.host/runtime-source-changed' })
  })

  it('refuses opaque queries whose internal reads cannot enter the source digest', async () => {
    const snapshot = captureRuntimeSourceReads(source(new Map()))
    await expect(snapshot.context.query?.({ kind: 'entities' })).rejects.toMatchObject({
      code: 'x3.host/runtime-source-untracked-query',
    })
    expect((await snapshot.verify()).fileCount).toBe(0)
  })

  it('binds file discovery and refuses an added file before launch', async () => {
    const listed = ['Base.SC2Data/GameData/UnitData.xml']
    const context = { ...source(new Map()),
      async files(_layerId: string, page: { prefix?: string; limit: number }) {
        return { items: listed.filter(path => path.startsWith(page.prefix ?? ''))
          .slice(0, page.limit) }
      },
    } satisfies ModContext
    const snapshot = captureRuntimeSourceReads(context)
    await snapshot.context.files('base', { limit: 16, prefix: 'Base.SC2Data/GameData/' })
    const digest = (await snapshot.verify()).digest
    const identical = captureRuntimeSourceReads(context)
    await identical.context.files('base', { limit: 16, prefix: 'Base.SC2Data/GameData/' })
    expect((await identical.verify()).digest).toBe(digest)
    listed.push('Base.SC2Data/GameData/ActorData.xml')
    await expect(identical.verify()).rejects.toBeInstanceOf(RuntimeSourceChangedError)
  })

  it('binds path resolution, including a previously missing dependency', async () => {
    let selected: { layerId: string; path: string } | undefined
    const context = { ...source(new Map()),
      async locate() { return selected },
    } satisfies ModContext
    const snapshot = captureRuntimeSourceReads(context)
    expect(await snapshot.context.locate('Base.SC2Data/MapScript.galaxy')).toBeUndefined()
    selected = { layerId: 'patch', path: 'Base.SC2Data/MapScript.galaxy' }
    await expect(snapshot.verify()).rejects.toBeInstanceOf(RuntimeSourceChangedError)
  })

  it('replays opaque listing cursors in their original order', async () => {
    let next: string | undefined
    const context = { ...source(new Map()),
      async files(_layerId: string, page: { cursor?: string }) {
        if (page.cursor !== next) throw new Error('cursor used out of order')
        if (next === undefined) {
          next = 'cursor-one'
          return { items: ['a.xml'], nextCursor: next }
        }
        next = undefined
        return { items: ['b.xml'] }
      },
    } satisfies ModContext
    const snapshot = captureRuntimeSourceReads(context)
    await snapshot.context.files('base', { limit: 1 })
    await snapshot.context.files('base', { limit: 1, cursor: 'cursor-one' })
    expect((await snapshot.verify()).digest).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })
})
