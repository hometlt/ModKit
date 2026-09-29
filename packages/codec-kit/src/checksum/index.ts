/**
 * The checksums formats carry, reached from one place.
 *
 * CRC-32 was written out fifteen times across MK3 — in PNG, ZIP, GZip, XZ, 7z, RAR, ODF and the
 * scene's PNG writer — each with its own table. The canonical CRC-32 is the MK2 library copy in
 * `crypto/mpq.ts` (hash-checked by `mk2-copy:check`); this module gives it a name codecs can find,
 * a range form, and the one variant that is genuinely different (BZip2's). Narrow on purpose:
 * importing it costs a codec no compression code. `algorithms:check` counts any new copy as debt.
 */
import { crc32 } from '../crypto/mpq.js'

export { crc32 }
export { adler32, createAdler32, type Adler32Accumulator } from '../compression/adler32.js'
export { xxHash32 } from './xxhash32.js'

/** CRC-32 over `bytes[start, end)` — a PNG chunk's type and data, say — without copying. */
export function crc32Range(bytes: Uint8Array, start: number, end: number): number {
  return crc32(bytes.subarray(start, end))
}

/** CRC-32C (Castagnoli, reflected 0x82F63B78): LevelDB blocks and log records, iSCSI, ext4. */
const CASTAGNOLI = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32C of `bytes[start, end)`; `crc32c('123456789')` is 0xE3069283. */
export function crc32c(bytes: Uint8Array, start = 0, end = bytes.byteLength): number {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1)
    crc = (crc >>> 8) ^ (CASTAGNOLI[(crc ^ (bytes[index] ?? 0)) & 0xff] as number)
  return (crc ^ 0xffffffff) >>> 0
}

/** CD-ROM EDC (ECMA-130 annex): polynomial 0x8001801B fed LSB first, register 0, no final XOR. */
const EDC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xd8018001 : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** The EDC of a CD-ROM sector's covered bytes (Mode 2 Form 1: subheader + 2048; Form 2: + 2324). */
export function cdRomEdc(bytes: Uint8Array): number {
  let edc = 0
  for (const byte of bytes) edc = ((edc >>> 8) ^ (EDC[(edc ^ byte) & 0xff] as number)) >>> 0
  return edc
}

/** The IEEE polynomial fed MSB first (0x04C11DB7): BZip2's block CRC and Ogg's page CRC. */
const FORWARD = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n << 24
    for (let k = 0; k < 8; k += 1) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
    table[n] = c >>> 0
  }
  return table
})()

export interface Crc32MsbAccumulator {
  /** Feed one byte `count` times: BZip2 checks run-length output as it is expanded. */
  update(byte: number, count?: number): void
  digest(): number
}

export interface Crc32MsbOptions {
  /** Register before the first byte; BZip2 0xFFFFFFFF, Ogg 0. */
  readonly init?: number
  /** XORed into the result; BZip2 0xFFFFFFFF, Ogg 0. */
  readonly xorOut?: number
}

/** The IEEE polynomial, not reflected: BZip2's CRC-32 by default, Ogg's with `init` and `xorOut` 0. */
export function createCrc32Msb({
  init = 0xffffffff,
  xorOut = 0xffffffff,
}: Crc32MsbOptions = {}): Crc32MsbAccumulator {
  let crc = init >>> 0
  return {
    update(byte, count = 1) {
      for (let index = 0; index < count; index += 1) {
        crc = ((crc << 8) ^ (FORWARD[((crc >>> 24) ^ byte) & 0xff] as number)) >>> 0
      }
    },
    digest: () => (crc ^ xorOut) >>> 0,
  }
}
