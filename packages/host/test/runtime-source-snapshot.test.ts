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
})
