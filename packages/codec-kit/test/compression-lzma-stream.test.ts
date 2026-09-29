/**
 * The stream decoders against the whole-buffer ones. The fixtures were written by 7-Zip 26.01 with
 * plain headers, one 3 MB file each, so the pack stream is bytes [32, 32 + next header offset):
 *   lzma-64k.7z   -mmt=1 -mhc=off -m0=LZMA:d=64k    lzma2-64k.7z  -mmt=1 -mhc=off -m0=LZMA2:d=64k
 * The file is `data()`: a 16 KiB random block repeated, a byte changed every 997, so matches run
 * long over a dictionary far smaller than the output and the window slides many times.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bcjX86Decode,
  bcjX86DecodeStream,
  lzma2DecodeStream,
  lzma2Decode,
  lzma2DictionarySize,
  lzmaDecode,
  lzmaDecodeStream,
  parseLzmaProperties,
} from '../src/compression/lzma.js'

function data(): Uint8Array {
  const block = new Uint8Array(16384)
  let seed = 11
  for (let index = 0; index < block.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    block[index] = (seed >> 16) & 0xff
  }
  const bytes = new Uint8Array(3_000_000)
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = (block[index % block.length] ?? 0) ^ (index % 997 === 1 ? 0x5a : 0)
  return bytes
}

function packOf(name: string): { packed: Uint8Array; header: Buffer } {
  const bytes = readFileSync(join(import.meta.dirname, 'fixtures', 'lzma', name))
  const size = Number(bytes.readBigUInt64LE(12))
  return {
    packed: new Uint8Array(bytes.subarray(32, 32 + size)),
    header: bytes.subarray(32 + size),
  }
}

async function* chunks(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.byteLength; at += size) yield bytes.slice(at, at + size)
}

async function collect(
  stream: AsyncIterable<Uint8Array>,
): Promise<{ bytes: Buffer; largest: number }> {
  const parts: Uint8Array[] = []
  for await (const part of stream) parts.push(part)
  return {
    bytes: Buffer.concat(parts),
    largest: parts.reduce((most, part) => Math.max(most, part.byteLength), 0),
  }
}

const expected = Buffer.from(data())

describe('LZMA stream decoding', () => {
  it('decodes LZMA fed in any chunking to the whole-buffer result, in the memory of its dictionary', async () => {
    const { packed, header } = packOf('lzma-64k.7z')
    const at = header.indexOf(Buffer.from([0x23, 0x03, 0x01, 0x01, 0x05]))
    const properties = parseLzmaProperties(header.subarray(at + 5, at + 10))
    expect(properties.dictionarySize).toBe(65536)
    expect(
      Buffer.from(lzmaDecode(packed, properties, { outputSize: expected.length })).equals(expected),
    ).toBe(true)
    for (const size of [1, 7777, 1 << 20]) {
      const { bytes, largest } = await collect(
        lzmaDecodeStream(chunks(packed, size), properties, {
          outputSize: expected.length,
          maxDictionaryBytes: 65536,
        }),
      )
      expect(bytes.equals(expected)).toBe(true)
      expect(largest).toBeLessThanOrEqual(1 << 20)
    }
  })

  it('decodes LZMA2 fed in any chunking to the whole-buffer result', async () => {
    const { packed, header } = packOf('lzma2-64k.7z')
    const at = header.indexOf(Buffer.from([0x21, 0x21, 0x01]))
    const dictionary = lzma2DictionarySize(header[at + 3] ?? 0xff)
    expect(dictionary).toBe(65536)
    expect(
      Buffer.from(lzma2Decode(packed, dictionary, { outputSize: expected.length })).equals(
        expected,
      ),
    ).toBe(true)
    for (const size of [1, 7777, 1 << 20]) {
      const { bytes } = await collect(
        lzma2DecodeStream(chunks(packed, size), dictionary, {
          outputSize: expected.length,
          maxDictionaryBytes: 65536,
        }),
      )
      expect(bytes.equals(expected)).toBe(true)
    }
  })

  it('refuses a dictionary over the budget, truncated input and a wrong declared size', async () => {
    const { packed, header } = packOf('lzma2-64k.7z')
    const dictionary = lzma2DictionarySize(
      header[header.indexOf(Buffer.from([0x21, 0x21, 0x01])) + 3] ?? 0,
    )
    const run = (input: Uint8Array, outputSize: number, maxDictionaryBytes = 65536) =>
      collect(
        lzma2DecodeStream(chunks(input, 4096), dictionary, { outputSize, maxDictionaryBytes }),
      )
    await expect(run(packed, expected.length, 65535)).rejects.toThrow(RangeError)
    await expect(run(packed.subarray(0, packed.byteLength - 100), expected.length)).rejects.toThrow(
      /truncated|missing/u,
    )
    await expect(run(packed, expected.length - 1)).rejects.toThrow(/exceeds its size/u)
    await expect(run(packed, expected.length + 1)).rejects.toThrow(/decoded size/u)
    const lzma = packOf('lzma-64k.7z')
    const at = lzma.header.indexOf(Buffer.from([0x23, 0x03, 0x01, 0x01, 0x05]))
    const properties = parseLzmaProperties(lzma.header.subarray(at + 5, at + 10))
    await expect(
      collect(
        lzmaDecodeStream(chunks(lzma.packed.subarray(0, 5000), 4096), properties, {
          outputSize: expected.length,
          maxDictionaryBytes: 65536,
        }),
      ),
    ).rejects.toThrow(/truncated/u)
  })

  it('filters x86 BCJ over a stream exactly as over the whole buffer', async () => {
    const code = new Uint8Array(200_003)
    let seed = 5
    for (let index = 0; index < code.length; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      // calls and jumps, some with 00/FF high bytes, in random bytes
      code[index] =
        seed % 11 === 0
          ? 0xe8
          : seed % 13 === 0
            ? 0xe9
            : seed % 3 === 0
              ? 0xff
              : (seed >> 16) & 0xff
    }
    const whole = Buffer.from(bcjX86Decode(code.slice()))
    for (const size of [1, 3, 5, 4096, 65537]) {
      const { bytes } = await collect(bcjX86DecodeStream(chunks(code, size)))
      expect(bytes.equals(whole)).toBe(true)
    }
  })
})
