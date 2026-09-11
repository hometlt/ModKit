import type { JsonObject } from '@modkit/sdk'
import { readUvmAccessor, type UvmScalarBudget } from '@modkit/uv/model/accessor'

/** Shared collision accessor semantics for inspection and rendering. The supplied budget is the
 * remaining aggregate allowance; callers charge scalarBytes for each subsequent shape.
 */
export function readCollisionMesh(
  document: JsonObject,
  binary: Uint8Array,
  shape: JsonObject,
  budget: UvmScalarBudget,
  signal?: AbortSignal,
) {
  const positions = readUvmAccessor(
    document,
    binary,
    shape['positions'],
    budget,
    'collision positions',
    signal,
  )
  if (
    positions.width !== 3 ||
    positions.componentType !== 5126 ||
    positions.normalized ||
    positions.count === 0 ||
    !positions.values.every(Number.isFinite)
  )
    throw new TypeError('UV_game_collision positions must be finite nonempty float VEC3')
  // The reader's purpose selects Float32Array for vertex values.
  if (!(positions.values instanceof Float32Array))
    throw new TypeError('collision positions are not float32')
  let scalarBytes = positions.values.byteLength
  if (shape['kind'] !== 'mesh') return { positions: positions.values, scalarBytes }
  const indices = readUvmAccessor(
    document,
    binary,
    shape['indices'],
    { maxScalarBytes: budget.maxScalarBytes - scalarBytes },
    'indices',
    signal,
  )
  if (
    indices.width !== 1 ||
    ![5121, 5123, 5125].includes(indices.componentType) ||
    indices.normalized ||
    indices.count === 0 ||
    indices.count % 3 !== 0
  )
    throw new TypeError('UV_game_collision mesh indices must form integer triangles')
  for (let i = 0; i < indices.values.length; i++) {
    if (i % 4096 === 0) signal?.throwIfAborted()
    const index = indices.values[i]
    if (index === undefined || index >= positions.count)
      throw new RangeError('UV_game_collision mesh index exceeds its positions')
  }
  scalarBytes += indices.values.byteLength
  return { positions: positions.values, indices: indices.values, scalarBytes }
}
