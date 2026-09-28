import { describe, expect, it } from 'vitest'
import { crc32 } from '../src/checksum/index.js'
import { readContainerEntry } from '../src/container-entries.js'

const bytes = new TextEncoder().encode('stats/weapons.json of mp.wz')
const source = {
  size: async () => BigInt(bytes.byteLength),
  read: async (offset: bigint, length: number) =>
    bytes.slice(Number(offset), Number(offset) + length),
}
const entry = (value: string) => ({
  path: 'stats/weapons.json',
  size: BigInt(bytes.byteLength),
  storage: { kind: 'stored' as const, offset: 0n, length: BigInt(bytes.byteLength) },
  checksum: { algorithm: 'crc-32', value },
})

describe('a container entry with its CRC-32', () => {
  it('is read when the bytes match and refused when they do not', async () => {
    const right = (crc32(bytes) >>> 0).toString(16).padStart(8, '0')
    expect(await readContainerEntry(entry(right), source, { maxBytes: 1024 })).toEqual(bytes)
    await expect(readContainerEntry(entry('deadbeef'), source, { maxBytes: 1024 })).rejects.toThrow(
      /fails its CRC-32/u,
    )
  })
})
