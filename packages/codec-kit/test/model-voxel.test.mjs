import assert from 'node:assert/strict'
import { test } from 'node:test'
// Tests use the compiled publication by default; an isolated build can be supplied without shared dist writes.
const { decodeVl32, voxelSurface } = await import(
  process.env.MODKIT_VOXEL_MODULE ?? '../dist/model/geometry.js'
)

test('VL32 offset/endian/ARGB and two-cell surface winding', () => {
  const buffer = new Uint8Array(36),
    bytes = buffer.subarray(4),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setInt32(16, 1, false)
  bytes.set([255, 200, 100, 50], 12)
  bytes.set([255, 10, 20, 30], 28)
  const grid = decodeVl32(bytes),
    result = voxelSurface(grid)
  assert.deepEqual([...grid.positions], [0, 0, 0, 1, 0, 0])
  assert.deepEqual([...grid.colors], [200, 100, 50, 255, 10, 20, 30, 255])
  assert.equal(result.cells, 2)
  assert.equal(result.faces, 10)
  const { positions: p, indices: ids, normals: n } = result.primitive
  for (let i = 0; i < ids.length; i += 3) {
    const a = ids[i] * 3,
      b = ids[i + 1] * 3,
      c = ids[i + 2] * 3
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]],
      v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    assert(cross.reduce((s, x, k) => s + x * n[a + k], 0) > 0)
  }
})

test('surface preserves last opaque duplicate colour and leaves part interfaces closed', () => {
  const grid = {
    positions: new Int32Array([0, 0, 0, 0, 0, 0]),
    colors: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
  }
  const result = voxelSurface(grid)
  assert.equal(result.cells, 1)
  assert.equal(result.faces, 6)
  assert.equal(result.primitive.colors[0], Math.fround(4 / 255))
  assert.equal(voxelSurface(grid).faces + voxelSurface(grid).faces, 12)
})

test('malformed, empty, bounds, budgets and cancellation fail explicitly', () => {
  assert.throws(() => decodeVl32(new Uint8Array(1)), /VL32/)
  const bytes = new Uint8Array(16)
  bytes[12] = 255
  new DataView(bytes.buffer).setInt32(0, -1, false)
  assert.throws(() => decodeVl32(bytes), /bounded/)
  assert.throws(() => decodeVl32(new Uint8Array(32), { maxCells: 1 }), /cell budget/)
  assert.throws(
    () => voxelSurface({ positions: new Int32Array(), colors: new Uint8Array() }),
    /empty/,
  )
  assert.throws(
    () => voxelSurface({ positions: new Int32Array(3), colors: new Uint8Array() }),
    /counts/,
  )
  const grid = { positions: new Int32Array(3), colors: new Uint8Array([1, 2, 3, 255]) }
  assert.throws(() => voxelSurface(grid, { maxOutputBytes: 183 }), /byte budget/)
  const signal = AbortSignal.abort()
  assert.throws(() => decodeVl32(new Uint8Array(16), { signal }), { name: 'AbortError' })
  assert.throws(() => voxelSurface(grid, { signal }), { name: 'AbortError' })
})

test('alpha threshold, transparent duplicate, boundary and owned output preserve prototype semantics', () => {
  const bytes = new Uint8Array(48),
    view = new DataView(bytes.buffer)
  view.setInt32(0, 128, false)
  bytes.set([128, 11, 22, 33], 12)
  view.setInt32(16, 128, false)
  bytes.set([127, 99, 99, 99], 28)
  view.setInt32(32, 0, false)
  bytes.set([255, 44, 55, 66], 44)
  const grid = decodeVl32(bytes),
    result = voxelSurface(grid)
  assert.equal(result.cells, 2)
  assert.equal(result.faces, 12)
  assert.equal(result.primitive.positions[0], 129)
  assert.equal(result.primitive.colors[0], Math.fround(11 / 255))
  grid.positions.fill(0)
  grid.colors.fill(0)
  assert.equal(result.primitive.positions[0], 129)
  assert.equal(result.primitive.colors[0], Math.fround(11 / 255))
  view.setInt32(16, 129, false)
  assert.throws(() => decodeVl32(bytes), /bounded/)
})
