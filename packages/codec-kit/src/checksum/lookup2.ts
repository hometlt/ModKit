/**
 * Bob Jenkins' lookup2 `hash()` (1996, public domain): the key hash of Relic's RGD attribute files
 * (Dawn of War, Company of Heroes) with an initial value of 0 — a table names its keys by this hash
 * of the key's text, and Corsix's Mod Studio dictionary of 6 518 names agrees with it entry for
 * entry. Words are read little-endian; a view over part of a buffer is read in place.
 */

const GOLDEN_RATIO = 0x9e3779b9

/** The reversible mix of three 32-bit registers, in the reference's order. */
function mix(state: [number, number, number]): void {
  let [a, b, c] = state
  a = (a - b - c) >>> 0
  a = (a ^ (c >>> 13)) >>> 0
  b = (b - c - a) >>> 0
  b = (b ^ (a << 8)) >>> 0
  c = (c - a - b) >>> 0
  c = (c ^ (b >>> 13)) >>> 0
  a = (a - b - c) >>> 0
  a = (a ^ (c >>> 12)) >>> 0
  b = (b - c - a) >>> 0
  b = (b ^ (a << 16)) >>> 0
  c = (c - a - b) >>> 0
  c = (c ^ (b >>> 5)) >>> 0
  a = (a - b - c) >>> 0
  a = (a ^ (c >>> 3)) >>> 0
  b = (b - c - a) >>> 0
  b = (b ^ (a << 10)) >>> 0
  c = (c - a - b) >>> 0
  c = (c ^ (b >>> 15)) >>> 0
  state[0] = a
  state[1] = b
  state[2] = c
}

/** lookup2 of `bytes` with an initial value of 0, as RGD key names are hashed. */
export function jenkinsLookup2(bytes: Uint8Array): number {
  const state: [number, number, number] = [GOLDEN_RATIO, GOLDEN_RATIO, 0]
  const length = bytes.byteLength
  const byte = (index: number): number => bytes[index] as number
  let offset = 0
  for (; length - offset >= 12; offset += 12) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 12)
    state[0] = (state[0] + view.getUint32(0, true)) >>> 0
    state[1] = (state[1] + view.getUint32(4, true)) >>> 0
    state[2] = (state[2] + view.getUint32(8, true)) >>> 0
    mix(state)
  }
  // The last 0–11 bytes: the low byte of c is taken by the length.
  state[2] = (state[2] + length) >>> 0
  const rest = length - offset
  for (let index = 0; index < rest; index += 1) {
    const register = index < 4 ? 0 : index < 8 ? 1 : 2
    const shift = index < 8 ? (index % 4) * 8 : ((index - 8) % 4) * 8 + 8
    state[register] = (state[register] + byte(offset + index) * 2 ** shift) >>> 0
  }
  mix(state)
  return state[2]
}
