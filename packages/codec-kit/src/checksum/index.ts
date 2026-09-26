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

/** CRC-32 over `bytes[start, end)` — a PNG chunk's type and data, say — without copying. */
export function crc32Range(bytes: Uint8Array, start: number, end: number): number {
  return crc32(bytes.subarray(start, end))
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
