import { describe, expect, it } from 'vitest'
import { containerEntryAccess } from '../src/container-entries.js'

/** A literal-only RefPack stream: literal runs of 4..112 bytes, then the stop code with the rest. */
function refPack(data: Uint8Array): Uint8Array {
  const out = [
    0x10,
    0xfb,
    (data.length >> 16) & 0xff,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
  ]
  let at = 0
  while (data.length - at >= 4) {
    const run = Math.min(112, (data.length - at) & ~3)
    out.push(0xe0 | ((run >> 2) - 1), ...data.subarray(at, at + run))
    at += run
  }
  out.push(0xfc | (data.length - at), ...data.subarray(at))
  return Uint8Array.from(out)
}

describe('a RefPack container entry', () => {
  it('is read by range from checkpoints instead of being extracted whole', async () => {
    const plain = new TextEncoder().encode('static_common stream '.repeat(20))
    const packed = refPack(plain)
    const container = new Uint8Array([7, 7, 7, ...packed])
    const access = containerEntryAccess(
      {
        entries: [
          {
            path: 'static_common.bin',
            size: BigInt(plain.byteLength),
            storage: { kind: 'refpack', offset: 3n, compressedLength: BigInt(packed.byteLength) },
          },
        ],
        caseSensitivity: 'insensitive',
        complete: true,
      },
      {
        scheme: 'big',
        source: {
          ref: { id: 'stream', uri: 'file:///StaticStream.big' },
          revision: 'provider-token:stream',
        } as never,
        byteSource: {
          size: async () => BigInt(container.byteLength),
          read: async (offset: bigint, length: number) =>
            container.slice(Number(offset), Number(offset) + length),
        },
        budget: { maxInputBytes: 1n << 20n } as never,
      },
    )
    const [item] = (await access.namespace.list('', { limit: 10 })).items
    expect(item?.kind === 'file' ? item.rangeAccess : undefined).toBe(true)
    const lease = await access.namespace.openEntrySource!('static_common.bin')
    expect(await lease.value.size()).toBe(BigInt(plain.byteLength))
    const read = async (offset: number, length: number) =>
      new TextDecoder().decode(await lease.value.read(BigInt(offset), length))
    expect(await read(21 * 5, 13)).toBe('static_common')
    expect(await read(0, 21)).toBe('static_common stream ')
    await lease.release()
  })
})
