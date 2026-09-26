import { describe, expect, it } from 'vitest'
import { revisionId, type ByteRangeSource } from '@modkit/sdk'
import { containerEntryRangeSource } from '../src/namespace-origin.js'

// A 6 GiB "container" computed from offsets: nothing is allocated, every read is recorded.
const size = 6n * 1024n ** 3n
const byteAt = (position: bigint) => Number((position * 2_654_435_761n) & 0xffn)
function parent() {
  const reads: { offset: bigint; length: number }[] = []
  const source: ByteRangeSource = {
    async size() {
      return size
    },
    async read(offset, length) {
      if (offset < 0n || offset + BigInt(length) > size) throw new RangeError('past the container')
      reads.push({ offset, length })
      return Uint8Array.from({ length }, (_, index) => byteAt(offset + BigInt(index)))
    },
  }
  return { source, reads }
}
const ref = { id: 'container!/movie.bik', uri: 'example:container!/movie.bik' }

describe('an uncompressed container entry read in place', () => {
  it('reads within the entry, shifted into the container, and never past its end', async () => {
    const { source, reads } = parent()
    const offset = 5n * 1024n ** 3n
    const length = 2n * 1024n * 1024n
    const entry = containerEntryRangeSource(ref, revisionId('provider-token:entry'), source, { offset, length })
    expect(entry.size).toBe(length)
    const head = await entry.read(0n, 4)
    expect([...head]).toEqual([0, 1, 2, 3].map(index => byteAt(offset + BigInt(index))))
    const tail = await entry.read(length - 2n, 100)
    expect(tail.byteLength).toBe(2)
    expect(reads.at(-1)).toEqual({ offset: offset + length - 2n, length: 2 })
    expect((await entry.read(length, 10)).byteLength).toBe(0)
    await expect(entry.read(length + 1n, 1)).rejects.toMatchObject({ code: 'x3.host/invalid-source-range' })
    await expect(entry.read(-1n, 1)).rejects.toMatchObject({ code: 'x3.host/invalid-source-range' })
  })

  it('streams a large entry in bounded chunks', async () => {
    const { source, reads } = parent()
    const length = 3n * 1024n * 1024n + 5n
    const entry = containerEntryRangeSource(ref, revisionId('provider-token:entry'), source, { offset: 100n, length })
    let total = 0n
    for await (const chunk of entry.stream!()) total += BigInt(chunk.byteLength)
    expect(total).toBe(length)
    expect(Math.max(...reads.map(read => read.length))).toBeLessThanOrEqual(1_048_576)
  })
})
