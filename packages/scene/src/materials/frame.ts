/** Inert column-major world-to-material projection frame. Local model coordinates are unchanged. */
export function materialFrame(value: unknown): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 16 ||
    value.some(
      component =>
        typeof component !== 'number' ||
        !Number.isFinite(component) ||
        !Number.isFinite(Math.fround(component)),
    ) ||
    value[3] !== 0 ||
    value[7] !== 0 ||
    value[11] !== 0 ||
    value[15] !== 1
  )
    throw new TypeError('material worldToMaterial must be a finite affine float32 matrix')
  const result: number[] = value.map(component => Number(component))
  invertMaterialFrame(result)
  return Object.freeze(result)
}

/** Pivoted affine inverse, computed in doubles; the result must fit the material float32 contract. */
export function invertMaterialFrame(matrix: readonly number[]): readonly number[] {
  const rows = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 8 }, (_, column) =>
      column < 4 ? (matrix[column * 4 + row] ?? 0) : Number(column - 4 === row),
    ),
  )
  const at = (row: number, column: number) => rows[row]?.[column] ?? 0
  for (let column = 0; column < 4; column++) {
    let pivot = column
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(at(row, column)) > Math.abs(at(pivot, column))) pivot = row
    const current = rows[column],
      selected = rows[pivot]
    if (current === undefined || selected === undefined || at(pivot, column) === 0)
      throw new TypeError('material frame must be invertible')
    rows[column] = selected
    rows[pivot] = current
    const divisor = at(column, column)
    for (let j = 0; j < 8; j++) selected[j] = (selected[j] ?? 0) / divisor
    for (let row = 0; row < 4; row++) {
      if (row === column) continue
      const target = rows[row],
        factor = at(row, column)
      if (target === undefined) throw new TypeError('invalid frame row')
      for (let j = 0; j < 8; j++) target[j] = (target[j] ?? 0) - factor * at(column, j)
    }
  }
  const result = Array.from({ length: 16 }, (_, i) => at(i % 4, 4 + Math.floor(i / 4)))
  if (result.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))))
    throw new TypeError('material frame inverse exceeds float32')
  return Object.freeze(result)
}

export function multiplyMaterialFrames(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  const output = Array.from({ length: 16 }, (_, i) => {
    const row = i % 4,
      column = Math.floor(i / 4)
    let value = 0
    for (let j = 0; j < 4; j++) value += (left[j * 4 + row] ?? 0) * (right[column * 4 + j] ?? 0)
    return value
  })
  return materialFrame(output)
}

export const IDENTITY_MATERIAL_FRAME = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])
