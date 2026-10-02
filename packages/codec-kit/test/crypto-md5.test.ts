import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMd5, md5 } from '../src/crypto/index.js'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const text = (value: string) => new TextEncoder().encode(value)

describe('MD5', () => {
  it('gives the RFC 1321 test suite digests', () => {
    for (const [input, expected] of [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ],
      ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ] as const)
      expect(hex(md5(text(input)))).toBe(expected)
  })

  it('takes bytes in pieces of any size across block edges, as Node digests them whole', () => {
    // lengths around the 56-byte padding edge and the 64-byte block, and an MPQ v3 chunk
    for (const length of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 16_384 + 7]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 0xff)
      const expected = createHash('md5').update(bytes).digest('hex')
      expect(hex(md5(bytes))).toBe(expected)
      for (const piece of [1, 3, 63, 64, 65]) {
        const hash = createMd5()
        for (let offset = 0; offset < length; offset += piece)
          hash.update(bytes.subarray(offset, offset + piece))
        expect(hex(hash.digest())).toBe(expected)
      }
    }
    const done = createMd5()
    done.digest()
    expect(() => done.update(Uint8Array.of(1))).toThrow(TypeError)
  })
})
