import { describe, expect, it } from 'vitest'
import { salsa20Xor } from '../src/crypto/salsa20.js'

const hex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], byte => parseInt(byte, 16))
const toHex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

describe('Salsa20/20', () => {
  it('reproduces ECRYPT Set 1 vector 0 keystreams for 128- and 256-bit keys', () => {
    const key16 = new Uint8Array(16)
    key16[0] = 0x80
    expect(toHex(salsa20Xor(key16, new Uint8Array(8), new Uint8Array(64)))).toBe(
      '4dfa5e481da23ea09a31022050859936da52fcee218005164f267cb65f5cfd7f' +
        '2b4f97e0ff16924a52df269515110a07f9e460bc65ef95da58f740b7d1dbb0aa',
    )
    const key32 = new Uint8Array(32)
    key32[0] = 0x80
    expect(toHex(salsa20Xor(key32, new Uint8Array(8), new Uint8Array(64)))).toBe(
      'e3be8fdd8beca2e3ea8ef9475b29a6e7003951e1097a5c38d23b7a5fad9f6844' +
        'b22c97559e2723c7cbbd3fe4fc8d9a0744652a83e72a9c461876af4d7ef1a117',
    )
  })

  it('matches an independent implementation (pycryptodome) across blocks and round-trips', () => {
    const key = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
    const nonce = Uint8Array.from([3, 1, 4, 1, 5, 9, 2, 6])
    const plain = Uint8Array.from({ length: 200 }, (_, index) => (index * 7 + 3) & 0xff)
    const cipher = salsa20Xor(key, nonce, plain)
    expect(toHex(cipher)).toBe(
      '368ffa0bddb89ce6234f1c90e28ac9d4f5a7ec7f7d6e0e18f61c61da1c9a98ee01715a780c810a7c2602a80eaffb9c2a' +
        '4a6315e1c4864eaf91f3c634251ba1227f2b373ca7dd769443b3fba8267bb7fe0100983054f5ccd2f329260e8162c15e' +
        '65b0f74cf52b5d90431555b363e1eb7538450efa66ff1d77876665e86e659cd0739b309caf69638c2be5533ede9dec0d' +
        '5fc30c27eefb6fde1bf06bcaf4bbf9c56d62f49ca8a4e1a0b14051c89e66d6e8797b5460b8f2da8631bcfd5d93a3986c' +
        '301038eb216eafd3',
    )
    expect(toHex(salsa20Xor(key, nonce, cipher))).toBe(toHex(plain))
    expect(plain[0]).toBe(3)
  })

  it('refuses keys other than 16 or 32 bytes and nonces other than 8 bytes', () => {
    expect(() => salsa20Xor(new Uint8Array(24), new Uint8Array(8), new Uint8Array(1))).toThrow(RangeError)
    expect(() => salsa20Xor(new Uint8Array(16), new Uint8Array(12), new Uint8Array(1))).toThrow(RangeError)
    expect(salsa20Xor(new Uint8Array(16), new Uint8Array(8), new Uint8Array(0)).byteLength).toBe(0)
  })
})
