/** Portable cell decoding and exposed-face geometry shared by model voxelization adapters.
 * This is an in-memory grid, not a UVM/UVW serialization or a mesh-to-voxel backend.
 * VL32 uses big-endian signed xyz and ARGB8; output colours are RGBA8. Surface cells with alpha
 * below 128 are omitted; other alpha becomes opaque. Duplicate coordinates use the last colour.
 * Grid corners are integer positions, +Y up at the consuming adapter; no source-unit conversion.
 * Allocations and loops are bounded/cancellable. Parts must be meshed separately to retain joints.
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
    colors.set(
      [bytes[i * 16 + 13]!, bytes[i * 16 + 14]!, bytes[i * 16 + 15]!, bytes[i * 16 + 12]!],
      i * 4,
    )
  }
  return { positions, colors }
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
