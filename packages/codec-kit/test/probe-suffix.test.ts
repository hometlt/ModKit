import { describe, expect, it } from 'vitest'
import { createInspectionCodec } from '../src/index.js'

const footer = Uint8Array.of(0xe1, 0x12, 0x6f, 0x5a) // Unreal pak magic, little-endian
function source(size: number) {
  const bytes = new Uint8Array(size)
  bytes.set(footer, size - 4)
  return {
    kind: 'bytes' as const,
    ref: { id: 'pak', uri: 'memory:pak' },
    revision: 'provider-token:pak',
    size: BigInt(size),
    async read(offset: bigint, length: number) {
      if (offset < 0n || offset + BigInt(length) > BigInt(size))
        throw new RangeError('past the source')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
  }
}

describe('byte probe with a footer window', () => {
  it('hands detect the declared from-end window, and names it among the required ranges', async () => {
    let seen: Uint8Array | undefined
    const codec = createInspectionCodec({
      id: 'example/pak',
      access: 'ranges',
      format: { id: 'pak', label: 'Pak' },
      async detect(_prefix: Uint8Array, _uri: string, suffix?: Uint8Array) {
        seen = suffix
        const match =
          suffix !== undefined &&
          footer.every((value, at) => suffix[suffix.length - 4 + at] === value)
        return { confidence: match ? 0.95 : 0, kind: 'magic' as const }
      },
      async inspect() {
        return { summary: null, metadata: [], traits: [] }
      },
    } as never)
    const plan = {
      kind: 'bytes',
      ranges: [
        { from: 'start', length: 16 },
        { from: 'end', length: 8 },
      ],
      maxBytes: 64,
    }
    const result = await codec.probe({ source: source(10_000), plan } as never)
    expect(result.confidence).toBe(0.95)
    expect(seen?.byteLength).toBe(8)
    expect(result.requiredRanges).toEqual([
      { byteOffset: '0', byteLength: '16' },
      { byteOffset: '9992', byteLength: '8' },
    ])
    // the tail gets only what the prefix left of maxBytes (the host counts every probe byte)
    const tight = await codec.probe({ source: source(10_000), plan: { ...plan, maxBytes: 20 } } as never)
    expect(tight.requiredRanges).toEqual([
      { byteOffset: '0', byteLength: '16' },
      { byteOffset: '9996', byteLength: '4' },
    ])
    // a source shorter than the window is probed with what it has
    const small = await codec.probe({ source: source(6), plan } as never)
    expect([small.confidence, seen?.byteLength]).toEqual([0.95, 6])
  })
})
