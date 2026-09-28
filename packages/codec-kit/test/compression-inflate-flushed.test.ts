import { constants, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { loadInflateSync, loadPortableInflateSync } from '../src/compression/inflate.js'

// A zlib stream cut at a sync flush, as Warcraft III replay blocks are: no final block, no Adler-32.
const text = new TextEncoder().encode('replay block '.repeat(100))
const flushed = new Uint8Array(deflateSync(text, { finishFlush: constants.Z_SYNC_FLUSH }))

describe.each([
  ['native', loadInflateSync],
  ['portable', loadPortableInflateSync],
] as const)('zlib-flushed (%s)', (_, load) => {
  it('inflates what the stream holds, bounded by its size', async () => {
    const inflate = await load('zlib-flushed')
    expect([...inflate(flushed, text.byteLength)]).toEqual([...text])
    expect(() => inflate(flushed, text.byteLength - 1)).toThrow(RangeError)
  })
})
