/**
 * Salsa20/20 (Bernstein, 2005) stream cipher: 16- or 32-byte key, 8-byte nonce, 64-bit block
 * counter from zero. Encryption and decryption are the same XOR with the keystream. Blizzard's
 * TACT/CASC storage encrypts BLTE chunks with it (16-byte keys); the CASC reader is the consumer.
 * Narrow on purpose: no XSalsa20, no reduced rounds, no seeking API. ECRYPT Set 1 vectors and an
 * independent implementation pin it (`test/crypto-salsa20.test.ts`).
 */

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574] // "expand 32-byte k"
const TAU = [0x61707865, 0x3120646e, 0x79622d36, 0x6b206574] // "expand 16-byte k"

const rotl = (value: number, shift: number): number => (value << shift) | (value >>> (32 - shift))

/** One 64-byte keystream block of the 16-word `state` into `out`. */
function block(state: Uint32Array, work: Uint32Array, out: Uint8Array): void {
  work.set(state)
  for (let round = 0; round < 20; round += 2) {
    // Column round, then row round; indices as the specification's quarter-rounds.
    work[4]! ^= rotl((work[0]! + work[12]!) | 0, 7)
    work[8]! ^= rotl((work[4]! + work[0]!) | 0, 9)
    work[12]! ^= rotl((work[8]! + work[4]!) | 0, 13)
    work[0]! ^= rotl((work[12]! + work[8]!) | 0, 18)
    work[9]! ^= rotl((work[5]! + work[1]!) | 0, 7)
    work[13]! ^= rotl((work[9]! + work[5]!) | 0, 9)
    work[1]! ^= rotl((work[13]! + work[9]!) | 0, 13)
    work[5]! ^= rotl((work[1]! + work[13]!) | 0, 18)
    work[14]! ^= rotl((work[10]! + work[6]!) | 0, 7)
    work[2]! ^= rotl((work[14]! + work[10]!) | 0, 9)
    work[6]! ^= rotl((work[2]! + work[14]!) | 0, 13)
    work[10]! ^= rotl((work[6]! + work[2]!) | 0, 18)
    work[3]! ^= rotl((work[15]! + work[11]!) | 0, 7)
    work[7]! ^= rotl((work[3]! + work[15]!) | 0, 9)
    work[11]! ^= rotl((work[7]! + work[3]!) | 0, 13)
    work[15]! ^= rotl((work[11]! + work[7]!) | 0, 18)
    work[1]! ^= rotl((work[0]! + work[3]!) | 0, 7)
    work[2]! ^= rotl((work[1]! + work[0]!) | 0, 9)
    work[3]! ^= rotl((work[2]! + work[1]!) | 0, 13)
    work[0]! ^= rotl((work[3]! + work[2]!) | 0, 18)
    work[6]! ^= rotl((work[5]! + work[4]!) | 0, 7)
    work[7]! ^= rotl((work[6]! + work[5]!) | 0, 9)
    work[4]! ^= rotl((work[7]! + work[6]!) | 0, 13)
    work[5]! ^= rotl((work[4]! + work[7]!) | 0, 18)
    work[11]! ^= rotl((work[10]! + work[9]!) | 0, 7)
    work[8]! ^= rotl((work[11]! + work[10]!) | 0, 9)
    work[9]! ^= rotl((work[8]! + work[11]!) | 0, 13)
    work[10]! ^= rotl((work[9]! + work[8]!) | 0, 18)
    work[12]! ^= rotl((work[15]! + work[14]!) | 0, 7)
    work[13]! ^= rotl((work[12]! + work[15]!) | 0, 9)
    work[14]! ^= rotl((work[13]! + work[12]!) | 0, 13)
    work[15]! ^= rotl((work[14]! + work[13]!) | 0, 18)
  }
  for (let index = 0; index < 16; index += 1) {
    const word = (work[index]! + state[index]!) >>> 0
    out[index * 4] = word & 0xff
    out[index * 4 + 1] = (word >>> 8) & 0xff
    out[index * 4 + 2] = (word >>> 16) & 0xff
    out[index * 4 + 3] = word >>> 24
  }
}

const word = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0

/**
 * `input` XOR the Salsa20/20 keystream of `key` and `nonce`, as a new array; `input` is not
 * touched. Refuses keys other than 16 or 32 bytes and nonces other than 8 bytes.
 */
export function salsa20Xor(key: Uint8Array, nonce: Uint8Array, input: Uint8Array): Uint8Array {
  if (key.byteLength !== 16 && key.byteLength !== 32)
    throw new RangeError(`Salsa20 key must be 16 or 32 bytes, got ${String(key.byteLength)}`)
  if (nonce.byteLength !== 8) throw new RangeError(`Salsa20 nonce must be 8 bytes, got ${String(nonce.byteLength)}`)
  const constants = key.byteLength === 32 ? SIGMA : TAU
  const second = key.byteLength === 32 ? 16 : 0
  const state = new Uint32Array(16)
  state[0] = constants[0]!
  for (let index = 0; index < 4; index += 1) state[1 + index] = word(key, index * 4)
  state[5] = constants[1]!
  state[6] = word(nonce, 0)
  state[7] = word(nonce, 4)
  state[10] = constants[2]!
  for (let index = 0; index < 4; index += 1) state[11 + index] = word(key, second + index * 4)
  state[15] = constants[3]!
  const work = new Uint32Array(16)
  const stream = new Uint8Array(64)
  const out = new Uint8Array(input.byteLength)
  for (let offset = 0; offset < input.byteLength; offset += 64) {
    block(state, work, stream)
    const end = Math.min(64, input.byteLength - offset)
    for (let index = 0; index < end; index += 1) out[offset + index] = input[offset + index]! ^ stream[index]!
    // 64-bit block counter in words 8 (low) and 9 (high).
    state[8] = (state[8]! + 1) >>> 0
    if (state[8] === 0) state[9] = (state[9]! + 1) >>> 0
  }
  return out
}
