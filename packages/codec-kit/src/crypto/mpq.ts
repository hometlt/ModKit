/**
 * MPQ cryptography utilities.
 *
 * - `mpqHash()` — MPQ hash function for filenames
 * - `mpqEncrypt()` / `mpqDecrypt()` — XOR stream cipher for tables
 * - `crc32()` — CRC-32 checksum
 */

// ─────────────────────────────────────────────────────────────────────────────
// MPQ Hash Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash types for MPQ hash function.
 */
export const HASH_TYPE = {
  TABLE_OFFSET: 0, // For hash table slot calculation
  HASH_A: 1, // First hash value (for hash table entry)
  HASH_B: 2, // Second hash value (for collision detection)
  TABLE: 3, // For encryption key derivation
} as const

export type HashType = (typeof HASH_TYPE)[keyof typeof HASH_TYPE]

// Encryption table initialization
const encryptionTable = (() => {
  let seed1: number = 0x00100001
  const table: number[] = []

  for (let i = 0; i < 0x100; i++) {
    let index = i
    for (let j = 0; j < 5; j++) {
      seed1 = ((seed1 * 125 + 3) % 0x2aaaab) >>> 0
      const temp1 = (seed1 & 0xffff) << 0x10

      seed1 = ((seed1 * 125 + 3) % 0x2aaaab) >>> 0
      const temp2 = seed1 & 0xffff

      table[index] = (temp1 | temp2) >>> 0
      index += 0x100
    }
  }

  return table
})()

/**
 * MPQ hash function.
 *
 * @param input String to hash (UTF-8 encoded)
 * @param type Hash type (TABLE_OFFSET, HASH_A, HASH_B, or TABLE)
 * @returns 32-bit hash value
 *
 * @example
 * ```ts
 * const hashA = mpqHash('readme.txt', HASH_TYPE.HASH_A);
 * const hashB = mpqHash('readme.txt', HASH_TYPE.HASH_B);
 * const key = mpqHash('(hash table)', HASH_TYPE.TABLE);
 * ```
 */
export function mpqHash(input: string, type: HashType): number {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee

  // Encode as UTF-8 and process bytes
  const encoder = new TextEncoder()
  const bytes = encoder.encode(input)

  for (let i = 0; i < bytes.length; i++) {
    let ch = bytes[i]!

    // MPQ hash uppercases ASCII a-z (0x61-0x7A -> 0x41-0x5A)
    // but leaves other bytes (including UTF-8 multi-byte sequences) unchanged
    if (ch >= 0x61 && ch <= 0x7a) {
      ch = ch - 0x20
    }

    const index = ((type << 8) + ch) & 0x3ff
    const value = encryptionTable[index]!

    seed1 = ((value ^ (seed1 + seed2)) >>> 0) & 0xffffffff
    seed2 = ((ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0) & 0xffffffff
  }

  return seed1 >>> 0
}

// ─────────────────────────────────────────────────────────────────────────────
// MPQ XOR Stream Cipher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt data using MPQ's XOR stream cipher.
 *
 * @param data Buffer to encrypt
 * @param key 32-bit encryption key (from mpqHash with TABLE type)
 * @returns Encrypted buffer
 *
 * @example
 * ```ts
 * const key = mpqHash('(block table)', HASH_TYPE.TABLE);
 * const encrypted = mpqEncrypt(blockTableBuffer, key);
 * ```
 */
export function mpqEncrypt(data: Uint8Array, key: number): Uint8Array {
  let seed1 = key
  let seed2 = 0xeeeeeeee

  const result = new Uint8Array(data.length)
  const dwords = Math.floor(data.length / 4)

  for (let i = 0; i < dwords; i++) {
    seed2 = ((seed2 + encryptionTable[0x400 + (seed1 & 0xff)]!) >>> 0) & 0xffffffff

    const plaintext =
      data[i * 4]! | (data[i * 4 + 1]! << 8) | (data[i * 4 + 2]! << 16) | (data[i * 4 + 3]! << 24)
    const ciphertext = (plaintext ^ (seed1 + seed2)) >>> 0

    seed1 = (((~seed1 << 0x15) + 0x11111111) | (seed1 >>> 0x0b)) >>> 0
    seed1 = seed1 & 0xffffffff
    seed2 = ((plaintext + seed2 + (seed2 << 5) + 3) >>> 0) & 0xffffffff

    result[i * 4] = ciphertext & 0xff
    result[i * 4 + 1] = (ciphertext >> 8) & 0xff
    result[i * 4 + 2] = (ciphertext >> 16) & 0xff
    result[i * 4 + 3] = (ciphertext >> 24) & 0xff
  }

  // Copy remaining bytes (< 4) unmodified
  for (let i = dwords * 4; i < data.length; i++) {
    result[i] = data[i]!
  }

  return result
}

/**
 * Decrypt data using MPQ's XOR stream cipher.
 *
 * @param data Encrypted buffer
 * @param key 32-bit decryption key
 * @returns Decrypted buffer
 */
export function mpqDecrypt(data: Uint8Array, key: number): Uint8Array {
  // XOR cipher is symmetric - decrypt is same as encrypt
  // But we need to restore seed progression exactly
  let seed1 = key
  let seed2 = 0xeeeeeeee

  const result = new Uint8Array(data.length)
  const dwords = Math.floor(data.length / 4)

  for (let i = 0; i < dwords; i++) {
    seed2 = ((seed2 + encryptionTable[0x400 + (seed1 & 0xff)]!) >>> 0) & 0xffffffff

    const ciphertext =
      data[i * 4]! | (data[i * 4 + 1]! << 8) | (data[i * 4 + 2]! << 16) | (data[i * 4 + 3]! << 24)
    const plaintext = (ciphertext ^ (seed1 + seed2)) >>> 0

    seed1 = (((~seed1 << 0x15) + 0x11111111) | (seed1 >>> 0x0b)) >>> 0
    seed1 = seed1 & 0xffffffff
    seed2 = ((plaintext + seed2 + (seed2 << 5) + 3) >>> 0) & 0xffffffff

    result[i * 4] = plaintext & 0xff
    result[i * 4 + 1] = (plaintext >> 8) & 0xff
    result[i * 4 + 2] = (plaintext >> 16) & 0xff
    result[i * 4 + 3] = (plaintext >> 24) & 0xff
  }

  // Copy remaining bytes (< 4) unmodified
  for (let i = dwords * 4; i < data.length; i++) {
    result[i] = data[i]!
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// CRC-32
// ─────────────────────────────────────────────────────────────────────────────

// CRC-32 lookup table
const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/**
 * Calculate CRC-32 checksum.
 *
 * @param data Data to checksum
 * @returns 32-bit CRC value
 *
 * @example
 * ```ts
 * const crc = crc32(Buffer.from('hello world'));
 * console.log(crc.toString(16));
 * ```
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (let i = 0; i < data.length; i++) {
    crc = (crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0
  }

  return (crc ^ 0xffffffff) >>> 0
}

// ─────────────────────────────────────────────────────────────────────────────
// MD5 (for header validation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate MD5 hash.
 *
 * Note: Uses Web Crypto API in browser, crypto module in Node.js.
 *
 * @param data Data to hash
 * @returns MD5 hash as hex string
 */
export async function md5(data: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Browser
    const hash = await crypto.subtle.digest('MD5', data.buffer as ArrayBuffer)
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  } else {
    // Node.js
    const { createHash } = await import('crypto')
    return createHash('md5').update(data).digest('hex')
  }
}

export default {
  mpqHash,
  mpqEncrypt,
  mpqDecrypt,
  crc32,
  md5,
  HASH_TYPE,
}
