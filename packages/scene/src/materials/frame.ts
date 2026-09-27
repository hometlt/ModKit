/** Inert column-major world-to-material projection frame. Local model coordinates are unchanged. */
export function materialFrame(value: unknown): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 16 ||
    value[3] !== 0 ||
    value[7] !== 0 ||
    value[11] !== 0 ||
    value[15] !== 1
  )
    throw new TypeError(MATERIAL_FRAME_CONTRACT)
  const result = new Array<number>(16)
  for (let index = 0; index < 16; index++) {
    const component: unknown = value[index]
    if (
      typeof component !== 'number' ||
      !Number.isFinite(component) ||
      !Number.isFinite(Math.fround(component))
    )
      throw new TypeError(MATERIAL_FRAME_CONTRACT)
    result[index] = component
  }
  invertMaterialFrame(result)
  return Object.freeze(result)
}

const MATERIAL_FRAME_CONTRACT = 'material worldToMaterial must be a finite affine float32 matrix'

/**
 * Rows of the augmented matrix `[frame | identity]`, eight doubles each. Particles and projectors
 * invert a frame per spawned particle and per receiver, so the elimination runs in place here
 * instead of allocating rows and closures on every call.
 */
const inverseRows = new Float64Array(32)

/** Pivoted affine inverse, computed in doubles; the result must fit the material float32 contract. */
export function invertMaterialFrame(matrix: readonly number[]): readonly number[] {
  const rows = inverseRows
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 8; column++)
      rows[row * 8 + column] =
        column < 4 ? (matrix[column * 4 + row] ?? 0) : Number(column - 4 === row)
  for (let column = 0; column < 4; column++) {
    let pivot = column
    for (let row = column + 1; row < 4; row++)
      if (Math.abs(rows[row * 8 + column]!) > Math.abs(rows[pivot * 8 + column]!)) pivot = row
    if (rows[pivot * 8 + column] === 0) throw new TypeError('material frame must be invertible')
    const selected = column * 8
    if (pivot !== column)
      for (let j = 0; j < 8; j++) {
        const value = rows[selected + j]!
        rows[selected + j] = rows[pivot * 8 + j]!
        rows[pivot * 8 + j] = value
      }
    const divisor = rows[selected + column]!
    for (let j = 0; j < 8; j++) rows[selected + j] = rows[selected + j]! / divisor
    for (let row = 0; row < 4; row++) {
      if (row === column) continue
      const target = row * 8,
        factor = rows[target + column]!
      for (let j = 0; j < 8; j++) rows[target + j] = rows[target + j]! - factor * rows[selected + j]!
    }
  }
  const result = new Array<number>(16)
  for (let index = 0; index < 16; index++) {
    const value = rows[(index % 4) * 8 + 4 + Math.floor(index / 4)]!
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
      throw new TypeError('material frame inverse exceeds float32')
    result[index] = value
  }
  return Object.freeze(result)
}

export function multiplyMaterialFrames(
  left: readonly number[],
  right: readonly number[],
): readonly number[] {
  const output = new Array<number>(16)
  for (let index = 0; index < 16; index++) {
    const row = index % 4,
      column = Math.floor(index / 4)
    let value = 0
    for (let j = 0; j < 4; j++) value += (left[j * 4 + row] ?? 0) * (right[column * 4 + j] ?? 0)
    output[index] = value
  }
  return materialFrame(output)
}

export const IDENTITY_MATERIAL_FRAME = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])
