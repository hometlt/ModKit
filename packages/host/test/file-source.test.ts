import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isCancellation } from '@modkitx-x3/core'
import { collectStream } from '@modkitx-x3/vfs'
import { openFileSource } from '@modkitx-x3/host/node'

const dir = mkdtempSync(join(tmpdir(), 'x3-file-source-'))
const path = join(dir, 'sample.bin')
const bytes = new Uint8Array(300_000).map((_, i) => (i * 7) % 256)
writeFileSync(path, bytes)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('host/node file source (S2)', () => {
  it('random access, streams and disposal over a real file', async () => {
    const source = await openFileSource(path)
    expect(source.id.startsWith('file:///')).toBe(true)
    expect(await source.size()).toBe(bytes.length)
    expect([...(await source.readAt(65_000, 24))]).toEqual([...bytes.slice(65_000, 65_024)])
    const collected = await collectStream(source.stream(1000, 70_000))
    expect(collected).toEqual(bytes.slice(1000, 70_000))
    await source.dispose()
    await expect(source.readAt(0, 1)).rejects.toThrow()
  })

  it('honors cancellation', async () => {
    const source = await openFileSource(path)
    const controller = new AbortController()
    controller.abort()
    await expect(source.readAt(0, 8, controller.signal)).rejects.toSatisfy(isCancellation)
    await source.dispose()
  })
})
