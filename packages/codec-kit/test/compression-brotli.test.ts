import { brotliCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import { decodeBrotli, loadBrotliSync } from '../src/compression/brotli.js'

describe('Brotli', () => {
  const text = new TextEncoder().encode('UE5 usmap '.repeat(4096))
  // node:zlib only compresses the fixture input.
  const packed = new Uint8Array(brotliCompressSync(text))

  it('decodes a stream within its bound', async () => {
    expect(await decodeBrotli(packed, text.length)).toEqual(text)
    expect((await loadBrotliSync())(packed, text.length)).toEqual(text)
  })

  it('refuses output past the bound with the shared code', async () => {
    await expect(decodeBrotli(packed, text.length - 1)).rejects.toMatchObject({
      code: COMPRESSION_OUTPUT_LIMIT,
    })
  })
})
