import { describe, expect, it } from 'vitest'
import type { ByteRangeSource } from '@modkit/sdk'
import { decodeRefPack, refPackRangeSource } from '../src/compression/refpack.js'

/**
 * A RefPack stream of `data`, written greedily: long-form matches of 5–1028 bytes up to 128 KiB
 * back, literal runs of 4–112 bytes, and the stop code with the last literals.
 */
function encode(data: Uint8Array): Uint8Array {
  const out: number[] = [0x10, 0xfb, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff]
  out.push(data.length & 0xff)
  const byte = (at: number) => data[at] ?? 0
  const last = new Map<number, number>()
  let pending = 0
  const flush = (end: number) => {
    while (end - pending >= 4) {
      const run = Math.min(112, (end - pending) & ~3)
      out.push(0xe0 | ((run >> 2) - 1), ...data.subarray(pending, pending + run))
      pending += run
    }
  }
  for (let at = 0; at + 5 <= data.length;) {
    const key = byte(at) | (byte(at + 1) << 8) | (byte(at + 2) << 16) | (byte(at + 3) << 24)
    const candidate = last.get(key)
    last.set(key, at)
    let length = 0
    if (candidate !== undefined && at - candidate <= 131_072) {
      while (
        length < 1028 &&
        at + length < data.length &&
        byte(candidate + length) === byte(at + length)
      )
        length += 1
    }
    if (length < 5 || candidate === undefined) {
      at += 1
      continue
    }
    flush(at)
    const literals = at - pending
    const distance = at - candidate - 1
    const extra = length - 5
    out.push(
      0xc0 | ((distance >> 16) << 4) | ((extra >> 8) << 2) | literals,
      (distance >> 8) & 0xff,
      distance & 0xff,
      extra & 0xff,
      ...data.subarray(pending, at),
    )
    at += length
    pending = at
  }
  flush(data.length)
  out.push(0xfc | (data.length - pending), ...data.subarray(pending))
  return Uint8Array.from(out)
}

/** 1.5 MB of noise that repeats itself at distances up to 120 KiB, so matches cross checkpoints. */
function sample(): Uint8Array {
  const data = new Uint8Array(1_500_000)
  let seed = 7
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) >>> 0)
  for (let at = 0; at < data.length;) {
    const back = 1 + (next() % 120_000)
    const length = 16 + (next() % 900)
    if (at >= back && next() % 3 !== 0) {
      for (let index = 0; index < length && at < data.length; index += 1, at += 1)
        data[at] = data[at - back] ?? 0
    } else {
      for (let index = 0; index < 64 && at < data.length; index += 1, at += 1)
        data[at] = next() >>> 24
    }
  }
  return data
}

/** Byte equality without the per-element diff `toEqual` builds for a megabyte array. */
const same = (actual: Uint8Array, expected: Uint8Array) =>
  expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)

/** The compressed bytes as a source that counts what is read from it. */
function counted(bytes: Uint8Array) {
  const reads: number[] = []
  const source: ByteRangeSource = {
    size: async () => BigInt(bytes.byteLength),
    async read(offset, length) {
      reads.push(length)
      return bytes.slice(Number(offset), Number(offset) + length)
    },
  }
  return { source, reads }
}

describe('RefPack by range', () => {
  const data = sample()
  const compressed = encode(data)

  it('reads any range as decoding the whole stream does', async () => {
    same(decodeRefPack(compressed, data.length), data)
    const { source, reads } = counted(compressed)
    const ranges = await refPackRangeSource(source, {
      checkpointBytes: 64 << 10,
      inputChunkBytes: 4096,
    })
    expect(await ranges.size()).toBe(BigInt(data.length))
    for (const [offset, length] of [
      [1_400_000, 70_000],
      [0, 5],
      [65_530, 20],
      [700_000, 131_072],
      [data.length - 3, 3],
      [123_456, 0],
      [0, data.length],
    ] as const) {
      same(await ranges.read(BigInt(offset), length), data.subarray(offset, offset + length))
    }
    // The source is read by chunks, never whole.
    expect(Math.max(...reads)).toBeLessThanOrEqual(4096)
  })

  it('decodes forward once, then at most a checkpoint before each range', async () => {
    const { source, reads } = counted(compressed)
    const interval = 64 << 10
    const ranges = await refPackRangeSource(source, {
      checkpointBytes: interval,
      inputChunkBytes: 4096,
    })
    await ranges.read(BigInt(data.length - 100), 100)
    const firstPass = reads.reduce((sum, length) => sum + length, 0)
    expect(firstPass).toBeGreaterThan(compressed.length - 8192)
    for (const offset of [900_000, 10, 450_000, 1_200_000]) {
      reads.length = 0
      same(await ranges.read(BigInt(offset), 1000), data.subarray(offset, offset + 1000))
      // Compressed input costs at most 5/4 of its output, plus one chunk either side.
      const input = reads.reduce((sum, length) => sum + length, 0)
      expect(input).toBeLessThanOrEqual(((interval + 4096) * 5) / 4 + 2 * 4096)
    }
  })

  it('serves reads made at once one after another', async () => {
    const ranges = await refPackRangeSource(counted(compressed).source, {
      checkpointBytes: 100_000,
    })
    const offsets = [1_300_000, 5, 600_000, 1_499_000, 250_000]
    const results = await Promise.all(offsets.map(offset => ranges.read(BigInt(offset), 500)))
    results.forEach((bytes, index) => {
      const offset = offsets[index] ?? 0
      same(bytes, data.subarray(offset, offset + 500))
    })
  })

  it('refuses a range past the end, a cut stream and a short source', async () => {
    const ranges = await refPackRangeSource(counted(compressed).source)
    await expect(ranges.read(BigInt(data.length - 1), 2)).rejects.toThrow(/outside the decoded/u)
    const cut = await refPackRangeSource(counted(compressed.subarray(0, 50_000)).source, {
      inputChunkBytes: 4096,
    })
    await expect(cut.read(BigInt(data.length - 10), 10)).rejects.toThrow(/RefPack stream/u)
    const short = await refPackRangeSource(counted(compressed.subarray(0, 50_000)).source, {
      compressedLength: BigInt(compressed.length),
    })
    await expect(short.read(BigInt(data.length - 10), 10)).rejects.toThrow(/shorter than/u)
    await expect(refPackRangeSource(counted(new Uint8Array([1, 2, 3])).source)).rejects.toThrow(
      /no RefPack header/u,
    )
  })
})
