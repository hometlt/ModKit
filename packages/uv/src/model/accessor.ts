import type { JsonObject } from '@modkit/sdk'

export interface UvmScalarBudget {
  readonly maxScalarBytes: number
}

export interface UvmAccessor<T extends Float32Array | Uint32Array = Float32Array | Uint32Array> {
  readonly values: T
  readonly count: number
  readonly width: number
  readonly componentType: number
  readonly normalized: boolean
}

const componentBytes: Readonly<Record<number, number>> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }
const componentCounts: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
}

/** Width of the accessor shapes currently supported by the embedded model reader. */
export function uvmAccessorWidth(type: unknown): number | undefined {
  return typeof type === 'string' && Object.hasOwn(componentCounts, type)
    ? componentCounts[type]
    : undefined
}

function record(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as JsonObject
}

function index(value: unknown, length: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`)
  return value
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readComponent(view: DataView, offset: number, type: number): number {
  if (type === 5121) return view.getUint8(offset)
  if (type === 5123) return view.getUint16(offset, true)
  if (type === 5125) return view.getUint32(offset, true)
  if (type === 5126) return view.getFloat32(offset, true)
  throw new TypeError(`unsupported UVM accessor component type ${String(type)}`)
}

/** Read owned scalar buffers from the embedded BIN chunk. Never resolves external storage.
 * Integer indices retain all 32 bits; vertex/animation values are float32, as in the model facets.
 * Normalization is reported to the semantic consumer rather than applied to indices or matrices.
 */
export function readUvmAccessor(
  document: JsonObject,
  binary: Uint8Array,
  accessorIndex: unknown,
  budget: UvmScalarBudget,
  purpose: 'indices',
  signal?: AbortSignal,
): UvmAccessor<Uint32Array>
export function readUvmAccessor(
  document: JsonObject,
  binary: Uint8Array,
  accessorIndex: unknown,
  budget: UvmScalarBudget,
  purpose: string,
  signal?: AbortSignal,
): UvmAccessor
export function readUvmAccessor(
  document: JsonObject,
  binary: Uint8Array,
  accessorIndex: unknown,
  budget: UvmScalarBudget,
  purpose: string,
  signal?: AbortSignal,
): UvmAccessor {
  signal?.throwIfAborted()
  if (!nonnegativeInteger(budget.maxScalarBytes)) throw new TypeError('invalid UVM scalar budget')
  const accessors = Array.isArray(document['accessors']) ? document['accessors'] : []
  const bufferViews = Array.isArray(document['bufferViews']) ? document['bufferViews'] : []
  const accessor = record(accessors[index(accessorIndex, accessors.length, purpose)], purpose)
  if (accessor['sparse'] !== undefined)
    throw new TypeError(`${purpose} sparse accessors are not supported`)
  const count = accessor['count']
  const type = accessor['type']
  const componentType = accessor['componentType']
  const width = uvmAccessorWidth(type)
  const bytesPerComponent =
    typeof componentType === 'number' ? componentBytes[componentType] : undefined
  if (
    !nonnegativeInteger(count) ||
    width === undefined ||
    bytesPerComponent === undefined ||
    typeof componentType !== 'number'
  )
    throw new TypeError(`${purpose} accessor shape is invalid`)
  const bufferView = record(
    bufferViews[index(accessor['bufferView'], bufferViews.length, `${purpose} bufferView`)],
    `${purpose} bufferView`,
  )
  if ((bufferView['buffer'] ?? 0) !== 0)
    throw new TypeError(`${purpose} references an external buffer`)
  const viewOffset = bufferView['byteOffset'] ?? 0
  const accessorOffset = accessor['byteOffset'] ?? 0
  const elementBytes = width * bytesPerComponent
  const stride = bufferView['byteStride'] ?? elementBytes
  const viewLength = bufferView['byteLength']
  if (
    !nonnegativeInteger(viewOffset) ||
    !nonnegativeInteger(accessorOffset) ||
    !nonnegativeInteger(viewLength) ||
    !nonnegativeInteger(stride) ||
    stride < elementBytes
  )
    throw new TypeError(`${purpose} buffer view range is invalid`)
  const scalarCount = count * width
  if (!Number.isSafeInteger(scalarCount * 4) || scalarCount * 4 > budget.maxScalarBytes)
    throw new RangeError(`${purpose} exceeds maxScalarBytes budget`)
  const start = viewOffset + accessorOffset
  const end = count === 0 ? start : start + (count - 1) * stride + elementBytes
  const viewEnd = viewOffset + viewLength
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(viewEnd) ||
    start < viewOffset ||
    end > viewEnd ||
    viewEnd > binary.byteLength
  )
    throw new RangeError(`${purpose} accessor exceeds the UVM BIN chunk`)
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const values =
    purpose === 'indices' ? new Uint32Array(scalarCount) : new Float32Array(scalarCount)
  for (let item = 0; item < count; item++) {
    if (item % 4096 === 0) signal?.throwIfAborted()
    const itemOffset = start + item * stride
    for (let component = 0; component < width; component++)
      values[item * width + component] = readComponent(
        view,
        itemOffset + component * bytesPerComponent,
        componentType,
      )
  }
  return Object.freeze({
    values,
    count,
    width,
    componentType,
    normalized: accessor['normalized'] === true,
  })
}
