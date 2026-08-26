// The nearest block of a release closure: the earliest planned block that still owes something.
//
// This used to be `Object.keys(deadlines).sort(compareUtf8)[0]`, and it was wrong twice over.
//
//  1. **It ignored whether the block still owed anything.** The generated status page announced
//     «block-11» as the nearest block of `mk3-ga` while block 11 had zero unresolved rows — its
//     deadlines were all met and closed. A reader looking for "what is due next" was pointed at
//     finished work, and the first block that actually held a gap (block 12) was two tables away.
//  2. **It sorted block names as text.** `block-11` sorts before `block-9`, and `block-22` before
//     both, so even the "first key" it picked was not the earliest block. The deadline table right
//     below it already sorted numerically, which is how the two disagreed in plain sight.
//
// Kept as its own module so the rule can be exercised directly. The interesting cases are the ones
// a generated page cannot show you: a closure whose earliest blocks are all satisfied, a closure
// with nothing left at all, and the two-digit ordering that text sort gets backwards.

/** Migration states that mean a row still owes work. Mirrors `UNRESOLVED` in emit-status.mjs. */
export const UNRESOLVED_STATES = Object.freeze([
  'missing',
  'blocked',
  'partial',
  'unknown',
  'deferred-post-ga',
])

/** `block-13` → 13; anything not of that shape sorts last rather than becoming `NaN` in a compare. */
export function blockNumber(name) {
  const match = /^block-(\d+)$/u.exec(String(name))
  return match === null ? Number.POSITIVE_INFINITY : Number(match[1])
}

/**
 * The earliest block that still has at least one unresolved unit, or `undefined` when none does.
 *
 * @param {Record<string, readonly string[]>} deadlines planned block → capability ids due in it
 * @param {(capabilityId: string) => boolean} isUnresolved whether that row still owes work
 */
export function nearestOwedBlock(deadlines, isUnresolved) {
  let nearest
  for (const [block, ids] of Object.entries(deadlines ?? {})) {
    if (!ids.some(id => isUnresolved(id))) continue
    if (nearest === undefined || blockNumber(block) < blockNumber(nearest)) nearest = block
  }
  return nearest
}
