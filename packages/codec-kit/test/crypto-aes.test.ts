import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AES_BLOCK_BYTES, createAes } from '../src/crypto/aes.js'

const hex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], byte => parseInt(byte, 16))
const toHex = (bytes: Uint8Array) =>
  [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
const counting = (length: number) => toHex(Uint8Array.from({ length }, (_, index) => index))

/** FIPS-197 appendix C: key 00 01 02 …, plaintext 00112233…ff, for each key size. */
const FIPS_197 = [
  [counting(16), '69c4e0d86a7b0430d8cdb78070b4c55a'],
  [counting(24), 'dda97ca4864cdfe06eaf70a0ec0d7191'],
  [counting(32), '8ea2b7ca516745bfeafc49904b496089'],
] as const

/** SP 800-38A appendix F: the same four plaintext blocks under AES-128 and AES-256. */
const PLAIN =
  '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
  '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710'
const KEY_128 = '2b7e151628aed2a6abf7158809cf4f3c'
const KEY_256 = '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4'
const IV = counting(16)

/** F.1.1 ECB-AES128, F.1.5 ECB-AES256. */
const ECB = [
  [
    KEY_128,
    '3ad77bb40d7a3660a89ecaf32466ef97f5d3d58503b9699de785895a96fdbaaf' +
      '43b1cd7f598ece23881b00e3ed0306887b0c785e27e8ad3f8223207104725dd4',
  ],
  [
    KEY_256,
    'f3eed1bdb5d2a03c064b5a7e3db181f8591ccb10d410ed26dc5ba74a31362870' +
      'b6ed21b99ca6f4f9f153e7b1beafed1d23304b7a39f9f3ff067d8d8f9e24ecc7',
  ],
] as const

/** F.2.1 CBC-AES128, F.2.5 CBC-AES256, both with IV 000102…0f. */
const CBC = [
  [
    KEY_128,
    '7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2' +
      '73bed6b8e3c1743b7116e69e222295163ff1caa1681fac09120eca307586e1a7',
  ],
  [
    KEY_256,
    'f58c4c04d6e5f1ba779eabfb5f7bfbd69cfc4e967edb808d679f777bc6702c7d' +
      '39f23369a9d9bacfa530e26304231461b2eb05e2c39be9fcda6c19078c6a9d1b',
  ],
] as const

function platform(mode: 'ecb' | 'cbc', key: Uint8Array, iv: Uint8Array | null) {
  const name = `aes-${key.byteLength * 8}-${mode}`
  const run = (cipher: ReturnType<typeof createCipheriv>, data: Uint8Array) =>
    new Uint8Array(Buffer.concat([cipher.setAutoPadding(false).update(data), cipher.final()]))
  return {
    encrypt: (data: Uint8Array) => run(createCipheriv(name, key, iv), data),
    decrypt: (data: Uint8Array) => run(createDecipheriv(name, key, iv), data),
  }
}

describe('AES', () => {
  it('reproduces the FIPS-197 appendix C vectors for 128-, 192- and 256-bit keys', () => {
    for (const [key, cipher] of FIPS_197) {
      const aes = createAes(hex(key))
      expect(toHex(aes.encryptEcb(hex('00112233445566778899aabbccddeeff')))).toBe(cipher)
      expect(toHex(aes.decryptEcb(hex(cipher)))).toBe('00112233445566778899aabbccddeeff')
    }
  })

  it('reproduces the SP 800-38A ECB and CBC vectors over several blocks', () => {
    for (const [key, cipher] of ECB) {
      const aes = createAes(hex(key))
      expect(toHex(aes.encryptEcb(hex(PLAIN)))).toBe(cipher)
      expect(toHex(aes.decryptEcb(hex(cipher)))).toBe(PLAIN)
    }
    for (const [key, cipher] of CBC) {
      const aes = createAes(hex(key))
      expect(toHex(aes.encryptCbc(hex(PLAIN), hex(IV)))).toBe(cipher)
      expect(toHex(aes.decryptCbc(hex(cipher), hex(IV)))).toBe(PLAIN)
    }
  })

  it('agrees with the platform on random keys, IVs and data, for every key size and both modes', () => {
    for (const keyBytes of [16, 24, 32]) {
      for (let round = 0; round < 4; round += 1) {
        const key = new Uint8Array(randomBytes(keyBytes))
        const iv = new Uint8Array(randomBytes(AES_BLOCK_BYTES))
        const data = new Uint8Array(randomBytes(AES_BLOCK_BYTES * (1 + round * 41)))
        const aes = createAes(key)
        const ecb = platform('ecb', key, null)
        expect(aes.encryptEcb(data)).toEqual(ecb.encrypt(data))
        expect(aes.decryptEcb(data)).toEqual(ecb.decrypt(data))
        const cbc = platform('cbc', key, iv)
        expect(aes.encryptCbc(data, iv)).toEqual(cbc.encrypt(data))
        expect(aes.decryptCbc(data, iv)).toEqual(cbc.decrypt(data))
      }
    }
  })

  it('reads views without touching them, and refuses partial blocks, bad IVs and key sizes', () => {
    const backing = new Uint8Array(48).map((_, index) => index)
    const view = backing.subarray(8, 40)
    const ivBacking = new Uint8Array(20).map((_, index) => 200 + index)
    const iv = ivBacking.subarray(2, 18)
    const before = [backing.slice(), ivBacking.slice()]
    const aes = createAes(hex(KEY_256))
    expect(aes.decryptEcb(aes.encryptEcb(view))).toEqual(view)
    expect(aes.decryptCbc(aes.encryptCbc(view, iv), iv)).toEqual(view)
    expect([backing, ivBacking]).toEqual(before)
    expect(() => aes.decryptEcb(new Uint8Array(15))).toThrow(/whole 16-byte blocks/u)
    expect(() => aes.encryptCbc(new Uint8Array(16), new Uint8Array(8))).toThrow(/16-byte/u)
    expect(aes.decryptEcb(new Uint8Array())).toEqual(new Uint8Array())
    expect(() => createAes(new Uint8Array(31))).toThrow(/16, 24 or 32 bytes, not 31/u)
  })
})
