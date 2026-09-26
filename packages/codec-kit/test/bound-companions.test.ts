import { describe, expect, it } from 'vitest'
import { readBoundCompanions, type InspectionContext } from '../src/index.js'

const bytesSource = (bytes: Uint8Array) => ({
  kind: 'bytes' as const,
  size: BigInt(bytes.byteLength),
  async read(offset: bigint, length: number) {
    return bytes.slice(Number(offset), Number(offset) + length)
  },
})

describe('bound companions', () => {
  it('reads each whole, reports an oversized one and releases every lease', async () => {
    const released: string[] = []
    const files: Record<string, Uint8Array> = { a: Uint8Array.of(1, 2, 3), b: new Uint8Array(9) }
    const context = {
      budget: { maxInputBytes: 4 },
      input: {
        originKind: 'bundle',
        bindingsFor: (requirement: string) =>
          requirement === 'skin'
            ? ['a', 'b'].map(id => ({ bindingId: id, source: { id, uri: `file:///m/${id}.skn` } }))
            : [],
        async openBinding(id: string) {
          return { value: bytesSource(files[id]!), release: async () => void released.push(id) }
        },
      },
    } as unknown as InspectionContext
    const companions = await readBoundCompanions(context, 'skin')
    expect(companions[0]).toEqual({
      bindingId: 'a',
      uri: 'file:///m/a.skn',
      bytes: Uint8Array.of(1, 2, 3),
    })
    expect(companions[1]).toMatchObject({
      bindingId: 'b',
      error: 'the companion exceeds the input budget',
    })
    expect(released).toEqual(['a', 'b'])
    expect(await readBoundCompanions(context, 'other')).toEqual([])
  })
})
