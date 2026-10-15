import assert from 'node:assert/strict'
import { test } from 'node:test'
// Tests use the compiled publication by default; an isolated build can be supplied without shared dist writes.
const { decodeVl32, voxelSurface } = await import(
  process.env.MODKIT_VOXEL_MODULE ?? '../dist/model/geometry.js'
)
const { canonicalizeVoxelCells, voxelGridTransform } = await import(
  process.env.MODKIT_VOXEL_DIRECT_MODULE ?? '../dist/model/voxel.js'
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

/** Small native-format fixtures; decoding and canonicalization are exercised through compiled owners. */
function cellBytes(records) {
  const bytes = new Uint8Array(records.length * 16), view = new DataView(bytes.buffer)
  records.forEach(([x, y, z, r = 1, g = 2, b = 3, a = 255], i) => {
    for (const [k, value] of [x, y, z].entries()) view.setInt32(i * 16 + k * 4, value, false)
    bytes.set([a, r, g, b], i * 16 + 12)
  })
  return bytes
}

test('canonical numeric xyz order, identical coalesce, conflicts and exact allocation ledger', () => {
  const input = cellBytes([[10,0,0], [2,0,0], [2,0,0]])
  const result = canonicalizeVoxelCells(input, { resolution: 16, maxAccountedBytes: 188 })
  assert.deepEqual([...result.grid.positions], [2,0,0,10,0,0])
  assert.equal(result.rawCells, 3); assert.equal(result.uniqueCells, 2); assert.equal(result.identicalDuplicates, 1)
  assert.deepEqual(result.allocation, { accountedBytes: 188, allocatedBytes: 140, bufferAllocations: 6 })
  assert(Object.isFrozen(result) && Object.isFrozen(result.grid) && Object.isFrozen(result.allocation))
  assert.throws(() => { result.rawCells = 0 }, TypeError)
  assert.throws(() => { result.grid.positions = new Int32Array() }, TypeError)
  assert.throws(() => { result.allocation.accountedBytes = 0 }, TypeError)
  input.fill(0)
  assert.deepEqual([...result.grid.colors], [1,2,3,255,1,2,3,255])
  assert.throws(() => canonicalizeVoxelCells(cellBytes([[0,0,0], [0,0,0,4,5,6]]), { resolution: 16 }), /conflicting/)
  assert.throws(() => canonicalizeVoxelCells(cellBytes([[0,0,0,1,2,3,127]]), { resolution: 16 }), /nonopaque/)
  const others = canonicalizeVoxelCells(cellBytes([[0,2,0],[0,1,9],[0,1,2]]), { resolution: 16 })
  assert.deepEqual([...others.grid.positions], [0,1,2,0,1,9,0,2,0])
})

test('raw cell caps precede dedup/copies; every allocation and sort comparison is bounded', () => {
  const duplicates = cellBytes([[0,0,0],[0,0,0]])
  assert.throws(() => canonicalizeVoxelCells(duplicates, { resolution: 16, maxRawCells: 1 }), /raw cell/)
  const input = cellBytes([[10,0,0], [2,0,0], [2,0,0]])
  assert.throws(() => canonicalizeVoxelCells(input, { resolution: 16, maxAccountedBytes: 187 }), /accounted buffer/)
  assert.throws(() => canonicalizeVoxelCells(input, { resolution: 16, maxAccountedBytes: 188, retainedBytes: 1 }), /accounted buffer/)
  assert.throws(() => canonicalizeVoxelCells(input, { resolution: 16, maxSortComparisons: 0 }), /comparison budget/)
  assert.throws(() => canonicalizeVoxelCells(cellBytes([[16,0,0]]), { resolution: 16 }), /bounded grid/)
  assert.throws(() => canonicalizeVoxelCells(new Uint8Array(0), { resolution: 16 }), /raw cell/)
  assert.throws(() => canonicalizeVoxelCells(input, { resolution: 16, signal: AbortSignal.abort() }), { name: 'AbortError' })
  let polls = 0
  assert.throws(() => canonicalizeVoxelCells(cellBytes(Array.from({length:4096},(_,i)=>[i%16,Math.floor(i/16)%16,Math.floor(i/256)])), { resolution: 16, signal: { throwIfAborted() { if (++polls === 12) throw new DOMException('cancelled', 'AbortError') } } }), { name: 'AbortError' })
})

test('grid recipe has independent negative/nonuniform/padding/corner/centre landmarks', () => {
  const p = new Float32Array([-3,5,-7, 5,5,-7, -3,9,-5])
  const result = voxelGridTransform(p, 16), m = result.gridToSource
  const at = (x,y,z) => [m[0]*x+m[12],m[5]*y+m[13],m[10]*z+m[14]]
  const near = (actual,expected) => actual.forEach((v,i)=>assert(Math.abs(v-expected[i])<1e-10))
  assert.equal(result.cellSize, 16/31)
  near(at(0,0,0),[-97/31,151/31,-221/31]);near(at(.5,.5,.5),[-89/31,159/31,-213/31])
  near(at(.25,.25,.25),[-3,5,-7]);near(at(15.75,8,4.125),[5,9,-5])
  const moved = voxelGridTransform(p.map((v,i)=>v*2+[-10,12,-20][i%3]),16)
  near(moved.gridToSource.slice(12,15),[-504/31,674/31,-1062/31])
  assert(Object.isFrozen(m) && Object.isFrozen(result.minimum))
  assert.throws(()=>voxelGridTransform(new Float32Array([0,0,0]),16),/extent/)
  assert.throws(()=>voxelGridTransform(p,129),/resolution/)
  for (const scale of [2e-6, 1, 100000]) assert(voxelGridTransform(new Float32Array([0,0,0,scale,0,0]),128).gridToSource.every(Number.isFinite))
})
