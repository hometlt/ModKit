/** Bounded row-run encoder for neutral semantic lattice scalars. Contract validation and
 * canonical projection belong to SDK maps; native terrain analysis remains at each publisher. */
import type { LatticeRunRows } from '@modkit/sdk/maps'

/** Encode one scalar grid as ordered row runs; callers supply finite, bounded samples. */
export function encodeLatticeRunRows(
  columns: number,
  rows: number,
  sample: (x: number, y: number) => number,
): LatticeRunRows {
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    columns * rows > 4_194_304
  )
    throw new RangeError('Lattice overview sample budget exceeded')
  return Array.from({ length: rows }, (_, y) => {
    const runs: [number, number][] = []
    for (let x = 0; x < columns; x++) {
      const value = sample(x, y)
      if (!Number.isFinite(value)) throw new TypeError('Nonfinite lattice sample')
      const last = runs[runs.length - 1]
      if (last?.[1] === value) last[0]++
      else runs.push([1, value])
    }
    return runs
  })
}
