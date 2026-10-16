/** Expand one unsigned 5-bit colour channel to a byte by repeating its high bits.
 * This is the packed-channel policy of BC RGB565 and bit-replicated RGB555; it is not rational rounding.
 * Callers extract the channel first. No clamping or wraparound is admitted.
 */
export function expand5To8(value: number): number {
  if ((value & 31) !== value) throw new RangeError('colour channel must be an unsigned 5-bit integer')
  return (value << 3) | (value >>> 2)
}

/** Packed RGB555 -> 0xRRGGBB by bit replication. Bit 15 carries no colour; transparency/alpha
 * belongs to the format reading the word. Rational UNORM rounding is a different policy.
 */
export function rgb555ToRgb888(word: number): number {
  if ((word & 0xffff) !== word) throw new RangeError('RGB555 word must be an unsigned 16-bit integer')
  return (expand5To8((word >>> 10) & 31) << 16) |
    (expand5To8((word >>> 5) & 31) << 8) | expand5To8(word & 31)
}
