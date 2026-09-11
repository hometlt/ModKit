import type { UvmContainer } from '@modkit/uv/model/container'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import type { UvmBinaryEdit, UvmJsonEdit } from './document.js'
import { array, object, safeIndex } from './values.js'

/** Owned float POSITION values and validated addresses in an existing embedded BIN layout. */
export function readUvmPositionAccessor(
  container: UvmContainer,
  accessorIndex: number,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const result = readUvmAccessor(
    container.document,
    container.binary,
    accessorIndex,
    { maxScalarBytes: maxBytes },
    'position edit',
    signal,
  )
  if (
    result.width !== 3 ||
    result.componentType !== 5126 ||
    result.normalized ||
    result.count === 0 ||
    !(result.values instanceof Float32Array) ||
    !result.values.every(Number.isFinite)
  )
    throw new TypeError('position edit requires finite nonempty float32 VEC3')
  const accessors = array(container.document, 'accessors')
  const accessor = object(
    accessors[safeIndex(accessorIndex, accessors.length, 'position accessor')],
    'position accessor',
  )
  const views = array(container.document, 'bufferViews')
  const view = object(
    views[safeIndex(accessor['bufferView'], views.length, 'position bufferView')],
    'position bufferView',
  )
  const viewOffset = view['byteOffset'] ?? 0,
    accessorOffset = accessor['byteOffset'] ?? 0
  const stride = view['byteStride'] ?? 12
  if (
    typeof viewOffset !== 'number' ||
    typeof accessorOffset !== 'number' ||
    typeof stride !== 'number'
  )
    throw new TypeError('invalid position byte layout')
  return {
    ...result,
    values: result.values,
    accessor,
    byteOffset: viewOffset + accessorOffset,
    stride,
  }
}

export function positionBounds(
  values: Float32Array,
  signal?: AbortSignal,
): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < values.length; i++) {
    if (i % 4096 === 0) signal?.throwIfAborted()
    const value = values[i],
      axis = i % 3
    if (value === undefined || !Number.isFinite(value)) throw new TypeError('nonfinite position')
    min[axis] = Math.min(min[axis] ?? Infinity, value)
    max[axis] = Math.max(max[axis] ?? -Infinity, value)
  }
  return { min, max }
}

export interface PositionContainmentBounds {
  readonly min: readonly number[]
  readonly max: readonly number[]
  readonly radius: number
}
/** Geometry math shared by format-specific conservative bounds policies. */
export function assertPositionInsideBounds(
  position: readonly number[],
  bounds: PositionContainmentBounds,
): void {
  if (
    position.length !== 3 ||
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    ![...position, ...bounds.min, ...bounds.max, bounds.radius].every(Number.isFinite) ||
    bounds.radius < 0
  )
    throw new TypeError('position containment requires finite AABB and sphere bounds')
  const delta = []
  for (let axis = 0; axis < 3; axis++) {
    const value = position[axis],
      min = bounds.min[axis],
      max = bounds.max[axis]
    if (value === undefined || min === undefined || max === undefined || min > max)
      throw new TypeError('invalid position containment axis')
    if (value < min || value > max)
      throw new RangeError('edited position exceeds existing native AABB bounds')
    delta.push(value - (min + max) / 2)
  }
  if (Math.hypot(...delta) > bounds.radius)
    throw new RangeError('edited position exceeds existing native sphere bounds')
}

/** Only an actual position change admits derived bounds changes into the native restoration proof. */
export function restoreUvmPositionBounds(
  accessorIndex: number,
  accessor: JsonObject,
  baseline: JsonObject,
  values: Float32Array,
  signal?: AbortSignal,
): readonly UvmJsonEdit[] {
  const derived = positionBounds(values, signal),
    restore: UvmJsonEdit[] = []
  for (const key of ['min', 'max'] as const) {
    if (JSON.stringify(accessor[key]) !== JSON.stringify(derived[key]))
      throw new TypeError('changed POSITION accessor min/max must match edited positions')
    if (JSON.stringify(accessor[key]) === JSON.stringify(baseline[key])) continue
    const path = `/accessors/${accessorIndex}/${key}`,
      original = baseline[key]
    restore.push(
      original === undefined ? { op: 'remove', path } : { op: 'replace', path, value: original },
    )
  }
  return restore
}

/** Common fixed-layout edit plumbing. Formats decide which native aliases must be edited together. */
export function prepareUvmPositionEdit(
  container: UvmContainer,
  accessorIndex: number,
  values: Float32Array,
  maxBytes: number,
  signal?: AbortSignal,
): { readonly json: readonly UvmJsonEdit[]; readonly binary: readonly UvmBinaryEdit[] } {
  const source = readUvmPositionAccessor(container, accessorIndex, maxBytes, signal)
  if (
    !(values instanceof Float32Array) ||
    values.length !== source.values.length ||
    !values.every(Number.isFinite) ||
    values.byteLength * 2 + source.count * 128 > maxBytes
  )
    throw new TypeError('position edits must preserve finite float32 vertex count and byte budget')
  const binary: UvmBinaryEdit[] = []
  for (let vertex = 0; vertex < source.count; vertex++) {
    if (vertex % 4096 === 0) signal?.throwIfAborted()
    const bytes = new Uint8Array(12),
      view = new DataView(bytes.buffer)
    for (let axis = 0; axis < 3; axis++) {
      const scalar = values[vertex * 3 + axis]
      if (scalar === undefined) throw new TypeError('position scalar absent')
      view.setFloat32(axis * 4, scalar, true)
    }
    binary.push({ byteOffset: source.byteOffset + vertex * source.stride, bytes })
  }
  const bounds = positionBounds(values, signal)
  const json: UvmJsonEdit[] = []
  for (const field of ['min', 'max'] as const)
    json.push({
      op: source.accessor[field] === undefined ? 'add' : 'replace',
      path: `/accessors/${accessorIndex}/${field}`,
      value: bounds[field],
    })
  return { json, binary }
}
import type { JsonObject } from '@modkit/sdk'
