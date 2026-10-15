/** Portable cell decoding and exposed-face geometry shared by model voxelization adapters.
 * This is an in-memory grid, not a UVM/UVW serialization or a mesh-to-voxel backend.
 * VL32 uses big-endian signed xyz and ARGB8; output colours are RGBA8. Surface cells with alpha
 * below 128 are omitted; other alpha becomes opaque. Duplicate coordinates use the last opaque colour.
 * Grid corners are integer positions, +Y up at the consuming adapter; no source-unit conversion.
 * Counts and loops are bounded/cancellable; output-byte limits do not bound the full JS heap.
 * Parts must be meshed separately to retain joints. Explicit raw-backend canonicalization below
 * refuses conflicting duplicates; it does not change voxelSurface's last-opaque policy.
 * Its per-call ledger counts admitted/retained payloads and every explicit typed-buffer allocation
 * cumulatively, without GC refunds. Engine sort scratch/objects, WASM and total RSS are not bounded.
 */

export interface VoxelGrid {
  readonly positions: Int32Array
  readonly colors: Uint8Array
}

export interface VoxelGeometryOptions {
  readonly maxCells?: number
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
}

/** Validate an integer allocation budget before doing work. */
function budget(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`invalid ${label}`)
  return value
}

/** Decode obj2voxel's public VL32 stream without Node Buffer assumptions or implicit endian order. */
export function decodeVl32(
  bytes: Uint8Array,
  options: VoxelGeometryOptions & { readonly maxCoordinate?: number } = {},
): VoxelGrid {
  options.signal?.throwIfAborted()
  const maxCells = budget(options.maxCells ?? 128 ** 3, 'maxCells')
  const maxCoordinate = budget(options.maxCoordinate ?? 128, 'maxCoordinate')
  if (bytes.byteLength % 16 !== 0) throw new RangeError('invalid upstream VL32 size')
  const count = bytes.byteLength / 16
  if (count > maxCells) throw new RangeError('voxel output exceeds cell budget')
  if (count * 16 > budget(options.maxOutputBytes ?? 256 * 1024 ** 2, 'maxOutputBytes'))
    throw new RangeError('voxel output exceeds byte budget')
  const positions = new Int32Array(count * 3),
    colors = new Uint8Array(count * 4)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count; i++) {
    if (i % 1024 === 0) options.signal?.throwIfAborted()
    for (let k = 0; k < 3; k++) {
      const value = view.getInt32(i * 16 + k * 4, false)
      if (value < 0 || value > maxCoordinate) throw new RangeError('voxel outside bounded grid')
      positions[i * 3 + k] = value
    }
    // Scalar writes keep the shared decoder free of temporary per-cell colour arrays.
    colors[i * 4] = bytes[i * 16 + 13]!
    colors[i * 4 + 1] = bytes[i * 16 + 14]!
    colors[i * 4 + 2] = bytes[i * 16 + 15]!
    colors[i * 4 + 3] = bytes[i * 16 + 12]!
  }
  return { positions, colors }
}

export interface VoxelBufferAccounting {
  readonly accountedBytes: number
  readonly allocatedBytes: number
  readonly bufferAllocations: number
}

/** Per-call explicit buffer ledger. This is not a whole-heap or WASM memory allowance. */
export function voxelBufferAccount(maxBytes: number, retainedBytes = 0) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 ** 2)
    throw new RangeError('invalid accounted buffer budget')
  let accountedBytes = 0, allocatedBytes = 0, bufferAllocations = 0
  /** Charge each actual allocation/admitted payload before it exists; never assume GC freed it. */
  function reserve(bytes: number, owned = true): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes - accountedBytes)
      throw new RangeError('voxel accounted buffer budget exceeded')
    accountedBytes += bytes
    if (owned) { allocatedBytes += bytes; bufferAllocations++ }
  }
  reserve(retainedBytes, false)
  return {
    reserve,
    /** Return immutable scalar accounting, not mutable authority over the allowance. */
    snapshot(): VoxelBufferAccounting { return Object.freeze({ accountedBytes, allocatedBytes, bufferAllocations }) },
  }
}

const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'length')!.get!
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer')!.get!
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset')!.get!
const typedKind = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get!
const arrayBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!
const resizableBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get

/** Inspect real fixed, nonshared views using intrinsics; never evaluate caller metadata getters. */
export function voxelArrayView(value: unknown, kind: 'float32' | 'uint8') {
  const Type = kind === 'float32' ? Float32Array : Uint8Array
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Type.prototype ||
      typedKind.call(value) !== (kind === 'float32' ? 'Float32Array' : 'Uint8Array'))
    throw new TypeError('voxel requires a plain typed array')
  for (const key of ['length', 'buffer', 'byteLength', 'byteOffset', 'constructor', 'slice', 'set', 'some', 'every', Symbol.iterator, Symbol.toStringTag])
    if (Object.getOwnPropertyDescriptor(value, key) !== undefined)
      throw new TypeError('shadowed typed array metadata')
  const length = typedLength.call(value) as number
  const buffer = typedBuffer.call(value) as ArrayBuffer
  const byteOffset = typedOffset.call(value) as number
  try {
    arrayBytes.call(buffer) // Brand check rejects SharedArrayBuffer even when instanceof is spoofed.
    if (resizableBuffer?.call(buffer)) throw new TypeError('resizable buffer')
    new DataView(buffer, byteOffset, length * Type.BYTES_PER_ELEMENT) // Detached views also refuse.
  } catch { throw new TypeError('shared, resizable or detached voxel buffer') }
  return { buffer, byteOffset, length, byteLength: length * Type.BYTES_PER_ELEMENT }
}

export interface VoxelGridTransform {
  readonly minimum: readonly [number, number, number]
  readonly maximum: readonly [number, number, number]
  readonly cellSize: number
  readonly gridToSource: readonly number[]
  readonly cornerConvention: 'integer-cell-corner'
  readonly centreOffset: readonly [0.5, 0.5, 0.5]
}

/** Pinned obj2voxel anti-bleed recipe in caller float32 source units, not a native-unit promise. */
export function voxelGridTransform(positions: Float32Array, resolution: number, signal?: AbortSignal): VoxelGridTransform {
  signal?.throwIfAborted()
  const info = voxelArrayView(positions, 'float32')
  if (!info.length || info.length % 3 || info.length > 100_000 * 9 ||
      !Number.isSafeInteger(resolution) || resolution < 2 || resolution > 128)
    throw new RangeError('voxel grid shape/resolution budget')
  const values = new Float32Array(info.buffer, info.byteOffset, info.length)
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < values.length; i++) {
    if ((i & 1023) === 0) signal?.throwIfAborted()
    const v = values[i]!, axis = i % 3 as 0 | 1 | 2
    if (!Number.isFinite(v) || Math.abs(v) > 1e6) throw new RangeError('voxel source coordinate representation limit')
    minimum[axis] = Math.min(minimum[axis], v); maximum[axis] = Math.max(maximum[axis], v)
  }
  const extent = Math.max(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2])
  if (extent < 1e-6) throw new RangeError('degenerate voxel source extent')
  const cellSize = extent / (resolution - 0.5)
  const matrix = [cellSize, 0, 0, 0, 0, cellSize, 0, 0, 0, 0, cellSize, 0,
    minimum[0] - cellSize * 0.25, minimum[1] - cellSize * 0.25, minimum[2] - cellSize * 0.25, 1]
  if (!matrix.every(Number.isFinite) || !(cellSize > 0)) throw new RangeError('nonfinite voxel grid transform')
  return Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum), cellSize,
    gridToSource: Object.freeze(matrix), cornerConvention: 'integer-cell-corner', centreOffset: Object.freeze([0.5, 0.5, 0.5] as const) })
}

export interface VoxelCanonicalOptions {
  readonly resolution: number
  readonly maxRawCells?: number
  readonly maxAccountedBytes?: number
  /** Explicit already-retained payload charge; supplied only by the trusted caller. */
  readonly retainedBytes?: number
  readonly maxSortComparisons?: number
  readonly signal?: AbortSignal
}

/** Canonicalize owned opaque cells before hashing/binding, with raw caps BEFORE copying/dedup. */
export function canonicalizeVoxelCells(bytes: Uint8Array, options: VoxelCanonicalOptions) {
  const { signal, resolution, retainedBytes = 0 } = options
  signal?.throwIfAborted()
  const maxRawCells = options.maxRawCells ?? 262_144
  const maxComparisons = options.maxSortComparisons ?? 100_000_000
  if (!Number.isSafeInteger(maxRawCells) || maxRawCells < 1 || maxRawCells > 128 ** 3 ||
      !Number.isSafeInteger(maxComparisons) || maxComparisons < 0 || maxComparisons > 100_000_000 ||
      !Number.isSafeInteger(resolution) || resolution < 2 || resolution > 128)
    throw new RangeError('invalid voxel canonical limits')
  const info = voxelArrayView(bytes, 'uint8'), count = info.length / 16
  if (!info.length || info.length % 16 || count > maxRawCells) throw new RangeError('voxel raw cell budget/shape')
  const account = voxelBufferAccount(options.maxAccountedBytes ?? 64 * 1024 ** 2, retainedBytes)
  account.reserve(info.byteLength, false) // Serialized input remains borrowed/live during this call.
  account.reserve(info.byteLength)
  const owned = new Uint8Array(info.length)
  owned.set(new Uint8Array(info.buffer, info.byteOffset, info.length))
  account.reserve(count * 3 * Int32Array.BYTES_PER_ELEMENT)
  account.reserve(count * 4 * Uint8Array.BYTES_PER_ELEMENT)
  const decoded = decodeVl32(owned, { maxCells: maxRawCells, maxCoordinate: resolution - 1, maxOutputBytes: count * 16, ...(signal ? { signal } : {}) })
  account.reserve(count * Uint32Array.BYTES_PER_ELEMENT)
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    if ((i & 1023) === 0) signal?.throwIfAborted()
    if (decoded.colors[i * 4 + 3] !== 255) throw new TypeError('nonopaque voxel backend output')
    order[i] = i
  }
  let comparisons = 0
  /** Numeric xyz comparison; charge every engine comparison and poll cooperative cancellation. */
  const compare = (a: number, b: number): number => {
    if (++comparisons > maxComparisons) throw new RangeError('voxel sort comparison budget exceeded')
    if ((comparisons & 1023) === 0) signal?.throwIfAborted()
    return decoded.positions[a * 3]! - decoded.positions[b * 3]! ||
      decoded.positions[a * 3 + 1]! - decoded.positions[b * 3 + 1]! ||
      decoded.positions[a * 3 + 2]! - decoded.positions[b * 3 + 2]!
  }
  order.sort(compare)
  let unique = 0, previous = -1
  for (let n = 0; n < count; n++) {
    if ((n & 1023) === 0) signal?.throwIfAborted()
    const current = order[n]!
    if (previous >= 0 && decoded.positions[current * 3] === decoded.positions[previous * 3] &&
        decoded.positions[current * 3 + 1] === decoded.positions[previous * 3 + 1] &&
        decoded.positions[current * 3 + 2] === decoded.positions[previous * 3 + 2]) {
      for (let k = 0; k < 4; k++) if (decoded.colors[current * 4 + k] !== decoded.colors[previous * 4 + k])
        throw new TypeError('conflicting duplicate voxel cell')
    } else { order[unique++] = current; previous = current }
  }
  account.reserve(unique * 3 * Int32Array.BYTES_PER_ELEMENT)
  const positions = new Int32Array(unique * 3)
  account.reserve(unique * 4 * Uint8Array.BYTES_PER_ELEMENT)
  const colors = new Uint8Array(unique * 4)
  for (let i = 0; i < unique; i++) {
    if ((i & 1023) === 0) signal?.throwIfAborted()
    const source = order[i]!
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = decoded.positions[source * 3 + k]!
    for (let k = 0; k < 4; k++) colors[i * 4 + k] = decoded.colors[source * 4 + k]!
  }
  signal?.throwIfAborted()
  return Object.freeze({ grid: Object.freeze({ positions, colors }) as VoxelGrid, rawCells: count, uniqueCells: unique,
    identicalDuplicates: count - unique, canonicalOrder: 'numeric-x-y-z' as const,
    comparisons, allocation: account.snapshot() })
}

const FACES = [
  [
    [1, 0, 0],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ],
  [
    [0, 1, 0],
    [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  [
    [0, -1, 0],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, 1],
    [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, -1],
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
] as const

/** Mesh one rigid grid with exact RGBA vertex colours and outward winding, culling occupied neighbours. */
export function voxelSurface(grid: VoxelGrid, options: VoxelGeometryOptions = {}) {
  options.signal?.throwIfAborted()
  const maxCells = budget(options.maxCells ?? 128 ** 3, 'maxCells')
  const maxBytes = budget(options.maxOutputBytes ?? 256 * 1024 ** 2, 'maxOutputBytes')
  if (
    !(grid.positions instanceof Int32Array) ||
    !(grid.colors instanceof Uint8Array) ||
    grid.positions.length % 3 !== 0 ||
    (grid.positions.length / 3) * 4 !== grid.colors.length
  )
    throw new TypeError('voxel positions and RGBA colours have different cell counts')
  const count = grid.positions.length / 3
  if (count > maxCells) throw new RangeError('voxel output exceeds cell budget')
  const occupied = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    if (i % 1024 === 0) options.signal?.throwIfAborted()
    if (grid.colors[i * 4 + 3]! < 128) continue
    const xyz = grid.positions.subarray(i * 3, i * 3 + 3)
    if (xyz.some(v => Math.abs(v) > 65535))
      throw new RangeError('voxel grid exceeds exact geometry range')
    occupied.set(`${xyz[0]},${xyz[1]},${xyz[2]}`, i)
  }
  if (!occupied.size) throw new RangeError('empty voxel output')
  let faces = 0,
    visited = 0
  for (const i of occupied.values()) {
    if (visited++ % 1024 === 0) options.signal?.throwIfAborted()
    const x = grid.positions[i * 3]!,
      y = grid.positions[i * 3 + 1]!,
      z = grid.positions[i * 3 + 2]!
    for (const [n] of FACES) if (!occupied.has(`${x + n[0]},${y + n[1]},${z + n[2]}`)) faces++
    if (faces * 184 > maxBytes) throw new RangeError('voxel surface exceeds byte budget')
  }
  const positions = new Float32Array(faces * 12),
    normals = new Float32Array(faces * 12)
  const colors = new Float32Array(faces * 16),
    indices = new Uint32Array(faces * 6)
  let face = 0
  visited = 0
  for (const i of occupied.values()) {
    if (visited++ % 1024 === 0) options.signal?.throwIfAborted()
    const xyz = [
      grid.positions[i * 3]!,
      grid.positions[i * 3 + 1]!,
      grid.positions[i * 3 + 2]!,
    ] as const
    for (const [normal, corners] of FACES) {
      if (occupied.has(`${xyz[0] + normal[0]},${xyz[1] + normal[1]},${xyz[2] + normal[2]}`))
        continue
      for (let v = 0; v < 4; v++) {
        for (let k = 0; k < 3; k++) {
          positions[face * 12 + v * 3 + k] = xyz[k]! + corners[v]![k]!
          normals[face * 12 + v * 3 + k] = normal[k]!
          colors[face * 16 + v * 4 + k] = grid.colors[i * 4 + k]! / 255
        }
        colors[face * 16 + v * 4 + 3] = 1
      }
      const base = face * 4
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], face * 6)
      face++
    }
  }
  return {
    cells: occupied.size,
    faces,
    primitive: {
      id: 'voxels',
      topology: 'triangles' as const,
      positions,
      normals,
      colors,
      indices,
    },
  }
}
