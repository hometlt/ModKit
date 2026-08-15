/**
 * Deterministic ordering (MK3/23 §9.9): protocol IDs and canonical artifacts sort by
 * UTF-8 byte comparison, never locale-aware and never UTF-16 code-unit order.
 */

const encoder = new TextEncoder()

export function compareUtf8(a: string, b: string): number {
  // Fast path: ASCII-only strings order identically under code-unit comparison.
  let ascii = true
  const shorter = Math.min(a.length, b.length)
  for (let i = 0; i < shorter; i += 1) {
    if (a.charCodeAt(i) > 0x7f || b.charCodeAt(i) > 0x7f) {
      ascii = false
      break
    }
  }
  if (ascii && /^[\x00-\x7F]*$/.test(a) && /^[\x00-\x7F]*$/.test(b)) {
    return a < b ? -1 : a > b ? 1 : 0
  }
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  const length = Math.min(ab.length, bb.length)
  for (let i = 0; i < length; i += 1) {
    const x = ab[i] as number
    const y = bb[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  if (ab.length !== bb.length) return ab.length < bb.length ? -1 : 1
  if (a === b) return 0
  // TextEncoder replaces lone surrogates with U+FFFD. Preserve total ordering even for such
  // hostile/non-scalar JS strings so canonical output never depends on insertion order.
  return a < b ? -1 : 1
}

export function sortedUtf8<Value extends string>(values: readonly Value[]): Value[] {
  return [...values].sort(compareUtf8)
}

/** Unique + UTF-8-byte-sorted, the canonical form for ID lists in locks (MK3/23 §11). */
export function uniqueSortedUtf8<Value extends string>(values: readonly Value[]): Value[] {
  return sortedUtf8([...new Set(values)])
}
