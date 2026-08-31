import { describe, expect, it } from 'vitest'
import { isCancellation, isModkitError } from '@modkit/core'
import { collectStream, createMemorySource } from '@modkit/vfs'

const bytes = new Uint8Array(200_000).map((_, i) => i % 251)

describe('memory source (S2)', () => {
  it('random access reads exact ranges', async () => {
    const source = createMemorySource('mem://a', bytes)
    expect(await source.size()).toBe(bytes.length)
    const slice = await source.readAt(1000, 16)
    expect([...slice]).toEqual([...bytes.slice(1000, 1016)])
  })

  it('out-of-range reads throw structured errors', async () => {
    const source = createMemorySource('mem://a', bytes)
    await expect(source.readAt(bytes.length - 1, 2)).rejects.toSatisfy(
      e => isModkitError(e) && e.code === 'x3.vfs/read-out-of-range',
    )
  })

  it('streams reassemble to the same bytes', async () => {
    const source = createMemorySource('mem://a', bytes)
    const collected = await collectStream(source.stream())
    expect(collected).toEqual(bytes)
    const window = await collectStream(source.stream(100, 300))
    expect(window).toEqual(bytes.slice(100, 300))
  })

  it('honors cancellation and disposal', async () => {
    const source = createMemorySource('mem://a', bytes)
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.readAt(0, 1, aborted.signal)).rejects.toSatisfy(isCancellation)
    await expect(collectStream(source.stream(0, undefined, aborted.signal))).rejects.toSatisfy(
      isCancellation,
    )
    await source.dispose()
    await expect(source.readAt(0, 1)).rejects.toSatisfy(
      e => isModkitError(e) && e.code === 'x3.vfs/source-disposed',
    )
  })
})
