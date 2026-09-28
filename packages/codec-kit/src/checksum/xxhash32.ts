/**
 * XXH32, Yann Collet's 32-bit xxHash: the header and content checksums of LZ4 frames, and the block
 * checksums of lz4-java's block stream (Minecraft's LZ4 region chunks: seed 0x9747B28C, the low 28
 * bits kept). Lanes are read little-endian; a view over part of a buffer is read in place.
 */

const PRIME1 = 0x9e3779b1
const PRIME2 = 0x85ebca77
const PRIME3 = 0xc2b2ae3d
const PRIME4 = 0x27d4eb2f
const PRIME5 = 0x165667b1

const rotateLeft = (value: number, bits: number): number => ((value << bits) | (value >>> (32 - bits))) >>> 0
const round = (lane: number, input: number): number => Math.imul(rotateLeft((lane + Math.imul(input, PRIME2)) >>> 0, 13), PRIME1) >>> 0

/** XXH32 of `bytes` with `seed` (0 unless a format names one). */
export function xxHash32(bytes: Uint8Array, seed = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = bytes.byteLength
  let offset = 0
  let hash: number
  if (length >= 16) {
    let v1 = (seed + PRIME1 + PRIME2) >>> 0
    let v2 = (seed + PRIME2) >>> 0
    let v3 = seed >>> 0
    let v4 = (seed - PRIME1) >>> 0
    for (const last = length - 16; offset <= last; offset += 16) {
      v1 = round(v1, view.getUint32(offset, true))
      v2 = round(v2, view.getUint32(offset + 4, true))
      v3 = round(v3, view.getUint32(offset + 8, true))
      v4 = round(v4, view.getUint32(offset + 12, true))
    }
    hash = (rotateLeft(v1, 1) + rotateLeft(v2, 7) + rotateLeft(v3, 12) + rotateLeft(v4, 18)) >>> 0
  } else {
    hash = (seed + PRIME5) >>> 0
  }
  hash = (hash + length) >>> 0
  for (; offset + 4 <= length; offset += 4)
    hash = Math.imul(rotateLeft((hash + Math.imul(view.getUint32(offset, true), PRIME3)) >>> 0, 17), PRIME4) >>> 0
  for (; offset < length; offset += 1)
    hash = Math.imul(rotateLeft((hash + Math.imul(bytes[offset] as number, PRIME5)) >>> 0, 11), PRIME1) >>> 0
  hash = Math.imul(hash ^ (hash >>> 15), PRIME2)
  hash = Math.imul(hash ^ (hash >>> 13), PRIME3)
  return (hash ^ (hash >>> 16)) >>> 0
}
