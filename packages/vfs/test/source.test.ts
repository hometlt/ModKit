import { describe, expect, it } from 'vitest'
import { isCancellation, isModkitError } from '@modkit/core'
import { collectStream, createMemorySource } from '@modkit/vfs'

const bytes = new Uint8Array(200_000).map((_, i) => i % 251)

describe('memory source (S2)', () => {
  it.each(['unpulled', 'prefetched', 'partial'] as const)('retires a %s stream at source disposal', async mode => {
    const source = createMemorySource('mem://terminal', bytes)
    const stream = source.stream()
    const reader = stream.getReader()
    if (mode === 'prefetched') await Promise.resolve()
    if (mode === 'partial') expect((await reader.read()).value).toEqual(bytes.slice(0, 65536))
    await source.dispose()
    await expect(reader.read()).rejects.toSatisfy(e => isModkitError(e) && e.code === 'x3.vfs/source-disposed')
    await expect(reader.closed).rejects.toSatisfy(isModkitError)
  })

  it('retires several streams once while keeping cancelled and completed streams terminal', async () => {
    const source = createMemorySource('mem://terminal', bytes)
    const first = source.stream().getReader(), second = source.stream().getReader()
    const cancelled = source.stream().getReader()
    await cancelled.cancel()
    expect(await cancelled.read()).toEqual({ value: undefined, done: true })
    const finished = source.stream(0, 1).getReader()
    expect((await finished.read()).value).toEqual(bytes.slice(0, 1))
    expect((await finished.read()).done).toBe(true)
    await source.dispose(); await source.dispose()
    await expect(first.read()).rejects.toSatisfy(isModkitError)
    await expect(second.read()).rejects.toSatisfy(isModkitError)
    expect((await cancelled.read()).done).toBe(true)
    expect((await finished.read()).done).toBe(true)
  })

  it('removes an errored stream and preserves the borrowed-buffer contract', async () => {
    const input = new Uint8Array([1, 2, 3])
    const source = createMemorySource('mem://borrowed', input)
    input[0] = 9
    expect(await source.readAt(0, 1)).toEqual(new Uint8Array([9]))
    const controller = new AbortController(); controller.abort()
    await expect(source.stream(0, 3, controller.signal).getReader().read()).rejects.toSatisfy(isCancellation)
    await source.dispose(); await source.dispose()
  })

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
