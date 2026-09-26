import { describe, expect, it } from 'vitest'
import { createBlowfishEcb } from '../src/crypto/blowfish.js'

const hex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], byte => parseInt(byte, 16))
const toHex = (bytes: Uint8Array) =>
  [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Eric Young's published Blowfish ECB vectors (key, plaintext, ciphertext); the last is a 24-byte key. */
const VECTORS = [
  ['0000000000000000', '0000000000000000', '4ef997456198dd78'],
  ['ffffffffffffffff', 'ffffffffffffffff', '51866fd5b85ecb8a'],
  ['3000000000000000', '1000000000000001', '7d856f9a613063f2'],
  ['1111111111111111', '1111111111111111', '2466dd878b963c9d'],
  ['0123456789abcdef', '1111111111111111', '61f9c3802281b096'],
  ['fedcba9876543210', '0123456789abcdef', '0aceab0fc6a0a28d'],
  ['f0e1d2c3b4a5968778695a4b3c2d1e0f0011223344556677', 'fedcba9876543210', '05044b62fa52d080'],
] as const

describe('Blowfish ECB', () => {
  it('reproduces the published vectors in both directions', () => {
    for (const [key, plain, cipher] of VECTORS) {
      const blowfish = createBlowfishEcb(hex(key))
      expect(toHex(blowfish.encrypt(hex(plain)))).toBe(cipher)
      expect(toHex(blowfish.decrypt(hex(cipher)))).toBe(plain)
    }
  })

  it('round-trips several blocks under the longest key without touching the input', () => {
    const key = Uint8Array.from({ length: 56 }, (_, index) => (index * 37 + 11) & 0xff)
    const plain = Uint8Array.from({ length: 64 }, (_, index) => index)
    const blowfish = createBlowfishEcb(key)
    const cipher = blowfish.encrypt(plain.subarray(8, 40))
    expect(toHex(blowfish.decrypt(cipher))).toBe(toHex(plain.subarray(8, 40)))
    expect(plain[8]).toBe(8)
  })

  it('refuses keys outside 1..56 bytes and partial blocks', () => {
    expect(() => createBlowfishEcb(new Uint8Array())).toThrow(RangeError)
    expect(() => createBlowfishEcb(new Uint8Array(57))).toThrow(RangeError)
    expect(() => createBlowfishEcb(new Uint8Array(8)).decrypt(new Uint8Array(12))).toThrow(
      /multiple of 8/u,
    )
  })
})
