import { describe, expect, it } from 'vitest'
import {
  createByteRangeSource,
  createLazyTableDataSource,
  createUtf8TextDataSource,
} from '@modkit/host'
import type { ByteRangeSource, Row } from '@modkit/sdk'

describe('A-6 lazy standard data sources', () => {
  it('pages and searches a large text source without requesting the full file', async () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `line-${index}\n`).join('')
    const bytes = new TextEncoder().encode(text)
    const backing = createByteRangeSource(bytes)
    let largestRead = 0
    const observed: ByteRangeSource = {
      size: () => backing.size(),
      async read(offset, length, signal) {
        largestRead = Math.max(largestRead, length)
        return backing.read(offset, length, signal)
      },
    }
    const source = createUtf8TextDataSource(observed, { chunkBytes: 1024 })
    const info = await source.info()
    expect(info).toMatchObject({ encoding: 'utf-8', lines: 20_001, longestLineBytes: 10 })
    expect(largestRead).toBeLessThanOrEqual(1024)

    let cursor: string | undefined
    let reconstructed = ''
    do {
      const page = await source.slice(
        cursor === undefined
          ? { kind: 'from-line', line: 0, lineCount: 100, maxBytes: 257 }
          : { kind: 'from-cursor', cursor, maxBytes: 257 },
      )
      reconstructed += page.text
      cursor = page.complete ? undefined : page.nextCursor
      if (page.complete) break
    } while (cursor !== undefined)
    expect(reconstructed).toBe(text)
    expect(largestRead).toBeLessThanOrEqual(1024)

    const matches = []
    for await (const match of source.search({ pattern: 'line-10', caseSensitive: true })) {
      matches.push(match)
      break
    }
    expect(matches).toHaveLength(1)

    const cancelled = new AbortController()
    cancelled.abort('test')
    await expect(
      source.slice({ kind: 'from-line', line: 0, lineCount: 1, maxBytes: 10 }, cancelled.signal),
    ).rejects.toMatchObject({ code: 'x3.core/operation-cancelled' })
  })

  it('enforces byte range bounds, returns owned bytes, and observes cancellation', async () => {
    const source = createByteRangeSource(new Uint8Array([0, 1, 2, 3, 4]))
    const result = await source.read(2n, 2)
    expect([...result]).toEqual([2, 3])
    result[0] = 99
    expect([...(await source.read(2n, 2))]).toEqual([2, 3])
    await expect(source.read(6n, 1)).rejects.toMatchObject({
      code: 'x3.host/byte-range-out-of-bounds',
    })
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(source.read(0n, 1, cancelled.signal)).rejects.toMatchObject({
      code: 'x3.core/operation-cancelled',
    })
  })

  it("preserves rows:'unknown' and traverses by cursor without eager row materialization", async () => {
    let yielded = 0
    const rows: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
      index,
      cells: [`row-${index}`, String(index)],
    }))
    const source = createLazyTableDataSource({
      columns: 2,
      header: ['label', 'value'],
      async *iterate(signal) {
        for (const row of rows) {
          if (signal?.aborted) return
          yielded += 1
          yield row
        }
      },
    })
    expect(await source.shape()).toEqual({
      rows: 'unknown',
      columns: 2,
      header: ['label', 'value'],
    })
    const first = await source.rows({ kind: 'range', from: 0, count: 2 })
    expect(first.items.map(row => row.index)).toEqual([0, 1])
    expect(first.nextCursor).toBe('v1:2')
    expect(yielded).toBe(3)
    if (first.nextCursor === undefined) throw new Error('fixture page must have a cursor')
    const second = await source.rows({ kind: 'cursor', cursor: first.nextCursor, count: 2 })
    expect(second.items.map(row => row.index)).toEqual([2, 3])
    expect(yielded).toBeLessThan(10)
    expect(await source.cell({ row: 5, column: 0 })).toEqual({ value: 'row-5' })

    const cancelled = new AbortController()
    cancelled.abort()
    await expect(
      source.rows({ kind: 'range', from: 0, count: 2 }, cancelled.signal),
    ).rejects.toMatchObject({ code: 'x3.core/operation-cancelled' })
    await expect(source.cell({ row: 0, column: 0 }, cancelled.signal)).rejects.toMatchObject({
      code: 'x3.core/operation-cancelled',
    })
  })
})
