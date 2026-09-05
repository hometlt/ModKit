export interface Adler32Accumulator {
  update(bytes: Uint8Array): void
  digest(): number
}

/** Create an incremental Adler-32 checksum so callers can add their own cancellation checkpoints. */
export function createAdler32(): Adler32Accumulator {
  let a = 1
  let b = 0
  return Object.freeze({
    update(bytes: Uint8Array) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Adler-32 input must be bytes')
      for (const byte of bytes) {
        a = (a + byte) % 65_521
        b = (b + a) % 65_521
      }
    },
    digest() {
      return ((b << 16) | a) >>> 0
    },
  })
}

export function adler32(bytes: Uint8Array): number {
  const checksum = createAdler32()
  checksum.update(bytes)
  return checksum.digest()
}
