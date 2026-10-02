/**
 * MD5 (RFC 1321), for the integrity fields formats define with it: an MPQ v3 archive's table and
 * 16 KiB chunk digests, a rapid pool file's check. Not for security. Synchronous and portable (no
 * `node:crypto`), so a writer in a portable worker computes what Node computes.
 */

/** Per-step left rotations, four for each round. */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21] as const
/** RFC 1321 §3.4: the integer part of 2³² × |sin(i + 1)|, exact in binary64 for all 64. */
const CONSTANTS = Uint32Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0,
)

/** An MD5 being computed over bytes given in pieces. */
export interface Md5 {
  update(bytes: Uint8Array): Md5
  /** The 16-byte digest; the hash takes no more bytes after it. */
  digest(): Uint8Array
}

/** A new MD5 over bytes given piece by piece (`md5` for bytes at hand). */
export function createMd5(): Md5 {
  const state = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476)
  const block = new Uint8Array(64)
  const words = new Uint32Array(16)
  let filled = 0
  let length = 0
  let finished = false
  const compress = (source: Uint8Array, offset: number) => {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4
      words[index] =
        (source[at]! |
          (source[at + 1]! << 8) |
          (source[at + 2]! << 16) |
          (source[at + 3]! << 24)) >>>
        0
    }
    let a = state[0]!
    let b = state[1]!
    let c = state[2]!
    let d = state[3]!
    for (let step = 0; step < 64; step += 1) {
      let mixed: number
      let word: number
      if (step < 16) {
        mixed = (b & c) | (~b & d)
        word = step
      } else if (step < 32) {
        mixed = (d & b) | (~d & c)
        word = (5 * step + 1) % 16
      } else if (step < 48) {
        mixed = b ^ c ^ d
        word = (3 * step + 5) % 16
      } else {
        mixed = c ^ (b | ~d)
        word = (7 * step) % 16
      }
      const sum = (a + mixed + CONSTANTS[step]! + words[word]!) >>> 0
      const shift = SHIFTS[(step >> 4) * 4 + (step % 4)]!
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    state[0] = state[0]! + a
    state[1] = state[1]! + b
    state[2] = state[2]! + c
    state[3] = state[3]! + d
  }
  const hash: Md5 = {
    update(bytes) {
      if (finished) throw new TypeError('an MD5 takes no bytes after its digest')
      length += bytes.length
      let offset = 0
      if (filled > 0) {
        const taken = Math.min(64 - filled, bytes.length)
        block.set(bytes.subarray(0, taken), filled)
        filled += taken
        offset = taken
        if (filled < 64) return hash
        compress(block, 0)
        filled = 0
      }
      for (; offset + 64 <= bytes.length; offset += 64) compress(bytes, offset)
      block.set(bytes.subarray(offset), 0)
      filled = bytes.length - offset
      return hash
    },
    digest() {
      if (!finished) {
        finished = true
        const bits = length * 8
        block[filled] = 0x80
        block.fill(0, filled + 1)
        if (filled >= 56) {
          compress(block, 0)
          block.fill(0)
        }
        // the message length in bits, little endian, low word first
        const view = new DataView(block.buffer)
        view.setUint32(56, bits >>> 0, true)
        view.setUint32(60, Math.floor(bits / 2 ** 32), true)
        compress(block, 0)
      }
      const digest = new Uint8Array(16)
      const view = new DataView(digest.buffer)
      for (let index = 0; index < 4; index += 1) view.setUint32(index * 4, state[index]!, true)
      return digest
    },
  }
  return hash
}

/** The MD5 of `bytes`, 16 bytes. */
export function md5(bytes: Uint8Array): Uint8Array {
  return createMd5().update(bytes).digest()
}
