import { brotliCompressSync, constants } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { COMPRESSION_OUTPUT_LIMIT } from '../src/compression/bounded.js'
import { decodeBrotli, loadBrotliSync, loadPortableBrotliSync } from '../src/compression/brotli.js'

// node:zlib only compresses the fixture inputs.
const compress = (input: Uint8Array, quality = 11) =>
  new Uint8Array(
    brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: quality } }),
  )
const refusal = (run: () => unknown): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('the decoder did not refuse')
}

describe('Brotli', () => {
  const text = new TextEncoder().encode('UE5 usmap '.repeat(4096))
  const packed = compress(text)

  it('decodes a stream within its bound', async () => {
    expect(await decodeBrotli(packed, text.length)).toEqual(text)
    expect((await loadBrotliSync())(packed, text.length)).toEqual(text)
  })

  it('refuses output past the bound with the shared code', async () => {
    await expect(decodeBrotli(packed, text.length - 1)).rejects.toMatchObject({
      code: COMPRESSION_OUTPUT_LIMIT,
    })
  })

  it('decodes without zlib (the web build) what zlib decodes', async () => {
    const portable = await loadPortableBrotliSync()
    // incompressible bytes over several of the decoder's 16 KiB chunks, and the empty stream
    let seed = 1
    const noise = Uint8Array.from({ length: 50_000 }, () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed >>> 24
    })
    for (const input of [text, noise, new Uint8Array(0)])
      expect(portable(compress(input), input.length)).toEqual(input)
  })

  it('stops the decoder without zlib near its bound, with the shared code', async () => {
    const portable = await loadPortableBrotliSync()
    // 64 MiB of zeros in a stream smaller than the bound: refused there, not decoded whole
    const bomb = compress(new Uint8Array(64 << 20), 1)
    expect(bomb.length).toBeLessThan(64 * 1024)
    expect(refusal(() => portable(bomb, 64 * 1024))).toMatchObject({
      code: COMPRESSION_OUTPUT_LIMIT,
    })
    expect(refusal(() => portable(packed, text.length - 1))).toMatchObject({
      code: COMPRESSION_OUTPUT_LIMIT,
    })
  })

  it('bounds both decoders alike: 0 allows only the empty stream; a cut stream is refused', async () => {
    const one = compress(Uint8Array.of(7))
    const empty = compress(new Uint8Array(0))
    for (const decode of [await loadBrotliSync(), await loadPortableBrotliSync()]) {
      expect(refusal(() => decode(one, 0))).toMatchObject({ code: COMPRESSION_OUTPUT_LIMIT })
      expect(decode(empty, 0)).toEqual(new Uint8Array(0))
      expect(
        refusal(() => decode(packed.subarray(0, packed.length >> 1), text.length)),
      ).toBeInstanceOf(Error)
    }
  })
})
