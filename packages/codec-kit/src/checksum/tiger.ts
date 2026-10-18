/** Tiger/192 V1 (three passes, 0x01 padding), for legacy file integrity.
 * Adapted from RustCrypto/hashes tiger (MIT choice); exact sources/tables: provenance/tiger.json.
 * One byte-oriented kernel: game-specific truncation and integer/storage order stay with the game.
 * Incremental state retains only one block tail. digest() snapshots without finalizing the writer.
 */
import { TIGER_TABLES as table } from './tiger-tables.js'

const MASK = 0xffffffffffffffffn
const MAX_BYTES = 0x1fffffffffffffffn // A Tiger length field contains a 64-bit BIT count.
type Register = 0 | 1 | 2
type State = [bigint, bigint, bigint]
const wrap = (value: bigint): bigint => value & MASK

/** One original Tiger compression block; arithmetic is explicitly unsigned modulo 2^64. */
function compress(state: State, bytes: Uint8Array, offset: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 64)
  const x = Array.from({ length: 8 }, (_, index) => view.getBigUint64(index * 8, true))
  const registers: State = [...state]
  function round(a: Register, b: Register, c: Register, word: bigint, multiplier: bigint): void {
    const value = registers[c] ^ word
    registers[c] = value
    const byte = (shift: bigint): number => Number((value >> shift) & 255n)
    registers[a] = wrap(
      registers[a] -
        (table[byte(0n)]! ^
          table[256 + byte(16n)]! ^
          table[512 + byte(32n)]! ^
          table[768 + byte(48n)]!),
    )
    registers[b] = wrap(
      (registers[b] +
        (table[768 + byte(8n)]! ^
          table[512 + byte(24n)]! ^
          table[256 + byte(40n)]! ^
          table[byte(56n)]!)) *
        multiplier,
    )
  }
  function pass(a: Register, b: Register, c: Register, multiplier: bigint): void {
    const slots = [a, b, c] as const
    for (let index = 0; index < 8; index++)
      round(
        slots[index % 3]!,
        slots[(index + 1) % 3]!,
        slots[(index + 2) % 3]!,
        x[index]!,
        multiplier,
      )
  }
  function schedule(): void {
    x[0] = wrap(x[0]! - (x[7]! ^ 0xa5a5a5a5a5a5a5a5n))
    x[1] = x[1]! ^ x[0]!
    x[2] = wrap(x[2]! + x[1]!)
    x[3] = wrap(x[3]! - (x[2]! ^ (~x[1]! << 19n)))
    x[4] = x[4]! ^ x[3]!
    x[5] = wrap(x[5]! + x[4]!)
    x[6] = wrap(x[6]! - (x[5]! ^ ((~x[4]! & MASK) >> 23n)))
    x[7] = x[7]! ^ x[6]!
    x[0] = wrap(x[0]! + x[7]!)
    x[1] = wrap(x[1]! - (x[0]! ^ (~x[7]! << 19n)))
    x[2] = x[2]! ^ x[1]!
    x[3] = wrap(x[3]! + x[2]!)
    x[4] = wrap(x[4]! - (x[3]! ^ ((~x[2]! & MASK) >> 23n)))
    x[5] = x[5]! ^ x[4]!
    x[6] = wrap(x[6]! + x[5]!)
    x[7] = wrap(x[7]! - (x[6]! ^ 0x0123456789abcdefn))
  }
  pass(0, 1, 2, 5n)
  schedule()
  pass(2, 0, 1, 7n)
  schedule()
  pass(1, 2, 0, 9n)
  state[0] ^= registers[0]
  state[1] = wrap(registers[1] - state[1])
  state[2] = wrap(registers[2] + state[2])
}

export interface Tiger192Hasher {
  /** Consume synchronously. The retained tail is copied, so subsequent input mutation is safe. */
  update(bytes: Uint8Array): void
  /** Return fresh owned full digest bytes; repeatable, and later updates remain valid. */
  digest(): Uint8Array
}

/** Bounded-state incremental Tiger V1, suitable for hashing stored payloads by source ranges. */
export function createTiger192(): Tiger192Hasher {
  const state: State = [0x0123456789abcdefn, 0xfedcba9876543210n, 0xf096a5b4c3b2e187n]
  const tail = new Uint8Array(64)
  let retained = 0
  let byteLength = 0n
  return {
    update(bytes) {
      const nextLength = byteLength + BigInt(bytes.byteLength)
      if (nextLength > MAX_BYTES)
        throw new RangeError('Tiger/192 message exceeds its 64-bit bit-length field')
      byteLength = nextLength
      let offset = 0
      if (retained > 0) {
        const take = Math.min(64 - retained, bytes.byteLength)
        tail.set(bytes.subarray(0, take), retained)
        offset = take
        retained += take
        if (retained === 64) {
          compress(state, tail, 0)
          retained = 0
        }
      }
      while (offset + 64 <= bytes.byteLength) {
        compress(state, bytes, offset)
        offset += 64
      }
      if (offset < bytes.byteLength) {
        tail.set(bytes.subarray(offset), 0)
        retained = bytes.byteLength - offset
      }
    },
    digest() {
      const snapshot: State = [...state]
      const padding = new Uint8Array(retained < 56 ? 64 : 128)
      padding.set(tail.subarray(0, retained))
      padding[retained] = 1 // Tiger V1; Tiger2 uses 0x80 and is deliberately not this API.
      new DataView(padding.buffer).setBigUint64(padding.byteLength - 8, byteLength * 8n, true)
      for (let offset = 0; offset < padding.byteLength; offset += 64)
        compress(snapshot, padding, offset)
      const output = new Uint8Array(24)
      const view = new DataView(output.buffer)
      snapshot.forEach((value, index) => view.setBigUint64(index * 8, value, true))
      return output
    },
  }
}

/** Full canonical Tiger/192 V1 digest bytes, not a game-specific integer or hex spelling. */
export function tiger192(bytes: Uint8Array): Uint8Array {
  const hasher = createTiger192()
  hasher.update(bytes)
  return hasher.digest()
}
