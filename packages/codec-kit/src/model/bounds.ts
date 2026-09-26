/** Axis-aligned bounds of interleaved xyz positions (`stride` numbers per vertex, xyz first). */
export function boundsOf(
  positions: ArrayLike<number>,
  stride = 3,
): { min: [number, number, number]; max: [number, number, number] } {
  if (!Number.isSafeInteger(stride) || stride < 3)
    throw new RangeError('bounds stride must be at least 3')
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset + 2 < positions.length; offset += stride) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis] as number
      if (value < min[axis]!) min[axis] = value
      if (value > max[axis]!) max[axis] = value
    }
  }
  return { min, max }
}
