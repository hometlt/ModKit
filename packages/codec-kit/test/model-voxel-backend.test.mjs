import assert from 'node:assert/strict'
import { test } from 'node:test'
const { snapshotVoxelBackendRequest: snapshot, voxelBackendLimits, DEFAULT_VOXEL_BACKEND_LIMITS } = await import(
  process.env.MODKIT_VOXEL_BACKEND_MODULE ?? '../dist/model/voxel-backend.js'
)
const triangle = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
const rgb = () => ({ geometry: { kind: 'triangle-rgb', positions: triangle(), triangleRgb: new Float32Array([1, 0, 0]) }, resolution: 16 })
const atlas = () => ({ geometry: { kind: 'baked-atlas', positions: triangle(), uvs: new Float32Array([.25, .25, .25, .75, .75, .25]), atlas: { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) }, sampler: 'repeat' }, resolution: 16 })

test('RGB snapshot owns buffers and metadata with exact live/copy allocation accounting', () => {
  const input = rgb(), result = snapshot(input)
  assert.equal(result.inputBytes, 48)
  assert.deepEqual(result.allocation, { accountedBytes: 96, allocatedBytes: 48, bufferAllocations: 2 })
  input.geometry.positions.fill(99); input.geometry.triangleRgb.fill(0); input.resolution = 2
  assert.equal(result.request.resolution, 16)
  assert.deepEqual([...result.request.geometry.positions], [...triangle()])
  assert.deepEqual([...result.request.geometry.triangleRgb], [1, 0, 0])
  assert(Object.isFrozen(result) && Object.isFrozen(result.request.geometry))
  assert(Object.isFrozen(result.allocation))
  assert.throws(() => { result.allocation.accountedBytes = 0 }, TypeError)
  assert.throws(() => snapshot(rgb(), { maxAccountedBytes: 95 }), /accounted buffer/)
  assert.equal(snapshot(rgb(), { maxAccountedBytes: 96 }).allocation.accountedBytes, 96)
})

test('atlas snapshot owns pixels/UV/dimensions and rejects default alpha without hiding losses', () => {
  const input = atlas(), result = snapshot(input)
  assert.equal(result.inputBytes, 68)
  assert.deepEqual(result.allocation, { accountedBytes: 136, allocatedBytes: 68, bufferAllocations: 3 })
  input.geometry.uvs.fill(99); input.geometry.atlas.rgba.fill(0); input.geometry.atlas.width = 1
  assert.equal(result.request.geometry.atlas.width, 2)
  assert.equal(result.request.geometry.atlas.rgba[3], 255)
  assert.equal(result.request.geometry.uvs[0], .25)
  for (const alpha of [0, 127, 128, 254]) {
    const value = atlas(); value.geometry.atlas.rgba[3] = alpha
    assert.throws(() => snapshot(value), /alpha refused/)
    value.geometry.alphaPolicy = 'discard-explicitly'
    assert.deepEqual(snapshot(value).losses, ['texture-alpha-discarded'])
  }
  assert.deepEqual(snapshot(atlas()).losses, [])
  const invalid = atlas(); invalid.geometry.alphaPolicy = null
  assert.throws(() => snapshot(invalid), /alpha policies/)
})

test('strict jobs reject getters at every object level without evaluating them', () => {
  let calls = 0
  for (const location of ['job', 'geometry', 'atlas']) {
    const value = atlas(), target = location === 'job' ? value : location === 'geometry' ? value.geometry : value.geometry.atlas
    const key = location === 'job' ? 'geometry' : location === 'geometry' ? 'positions' : 'rgba'
    Object.defineProperty(target, key, { get() { calls++; throw Error('getter executed') }, enumerable: true })
    assert.throws(() => snapshot(value), /accessor/)
  }
  const limits = {}; Object.defineProperty(limits, 'maxTriangles', { get() { calls++; return 1 } })
  assert.throws(() => snapshot(rgb(), limits), /accessor/)
  assert.equal(calls, 0)
})

test('typed-array metadata/species accessors, proxies and subclass methods never run', () => {
  let calls = 0
  for (const key of ['buffer', 'length', 'byteLength', 'byteOffset', 'constructor', 'slice', 'set', 'some', 'every', Symbol.iterator, Symbol.toStringTag]) {
    const value = rgb()
    Object.defineProperty(value.geometry.positions, key, { get() { calls++; throw Error('typed getter executed') } })
    assert.throws(() => snapshot(value), /shadowed/)
  }
  class Hostile extends Float32Array { slice() { calls++; throw Error('species') } }
  const value = rgb(); value.geometry.positions = new Hostile(triangle())
  assert.throws(() => snapshot(value), /plain typed array/)
  value.geometry.positions = new Proxy(triangle(), { get() { calls++; throw Error('proxy getter') } })
  assert.throws(() => snapshot(value), /plain typed array/)
  assert.equal(calls, 0)
})

test('prototype laundering cannot widen a byte view into float32 payload outside its span', () => {
  const backing = new ArrayBuffer(64), tiny = new Uint8Array(backing, 0, 9)
  Object.setPrototypeOf(tiny, Float32Array.prototype)
  const value = rgb(); value.geometry.positions = tiny
  assert.throws(() => snapshot(value), /plain typed array/)
  const pixels = new Float32Array(8); Object.setPrototypeOf(pixels, Uint8Array.prototype)
  const textured = atlas(); textured.geometry.atlas.rgba = pixels
  assert.throws(() => snapshot(textured), /plain typed array/)
})

test('SAB, resizable/detached buffers refuse; nonzero offsets copy only the admitted span', () => {
  const shared = rgb(); shared.geometry.positions = new Float32Array(new SharedArrayBuffer(36))
  assert.throws(() => snapshot(shared), /shared/)
  const resizable = rgb(); resizable.geometry.positions = new Float32Array(new ArrayBuffer(36, { maxByteLength: 72 }))
  assert.throws(() => snapshot(resizable), /resizable/)
  const detached = rgb(); structuredClone(detached.geometry.positions.buffer, { transfer: [detached.geometry.positions.buffer] })
  assert.throws(() => snapshot(detached), /detached/)
  const backing = new Float32Array(15).fill(NaN); backing.set(triangle(), 3)
  const offset = rgb(); offset.geometry.positions = backing.subarray(3, 12)
  assert.deepEqual([...snapshot(offset).request.geometry.positions], [...triangle()])
})

test('profiles reject arbitrary fields, resource selectors and wrong channel counts', () => {
  for (const extra of [{ url: 'https://invalid/' }, { path: 'x.obj' }, { instantiate() {} }, { maxRawCells: 1 }])
    assert.throws(() => snapshot({ ...rgb(), ...extra }), /unsupported/)
  for (const extra of [{ materials: [] }, { uvs: new Float32Array(6) }, { triangleRgb: new Float32Array(9) }, { kind: 'per-vertex' }]) {
    const value = rgb(); Object.assign(value.geometry, extra)
    assert.throws(() => snapshot(value), /profile|count|unsupported/)
  }
  for (const sampler of ['clamp', 'mirror', 'nearest', undefined]) {
    const value = atlas(); value.geometry.sampler = sampler
    assert.throws(() => snapshot(value), /REPEAT/)
  }
})

test('trusted count/byte ceilings refuse before oversized copies', () => {
  const value = rgb(); value.geometry.positions = new Float32Array(100001 * 9)
  assert.throws(() => snapshot(value), /triangle budget/)
  const tooManyPixels = atlas(); tooManyPixels.geometry.atlas = { width: 2048, height: 2048, rgba: new Uint8Array() }
  assert.throws(() => snapshot(tooManyPixels), /pixel budget/)
  assert.throws(() => snapshot(rgb(), { maxInputBytes: 47 }), /input byte budget/)
  for (const override of [{ maxRawCells: 128 ** 3 + 1 }, { maxAccountedBytes: 256 * 1024 ** 2 + 1 }, { maxTriangles: Infinity }, { maxPixels: -1 }, { maxSortComparisons: 100000001 }])
    assert.throws(() => voxelBackendLimits(override), /outside|invalid/)
  assert(Object.isFrozen(DEFAULT_VOXEL_BACKEND_LIMITS))
  assert.equal(voxelBackendLimits({ maxSortComparisons: 0 }).maxSortComparisons, 0)
})

test('float32 geometry limits reject nonfinite/collapsed/extreme inputs, not flat axes', () => {
  for (const positions of [new Float32Array(9), new Float32Array([0,0,0,1,0,0,2,0,0]), triangle().map(v => v * 1e-7), triangle().map(v => v * 2e6), new Float32Array([Infinity,...triangle().slice(1)]), new Float32Array([NaN,...triangle().slice(1)])]) {
    const value = rgb(); value.geometry.positions = positions
    assert.throws(() => snapshot(value), /coordinate|extent|collinear/)
  }
  const huge = rgb(); huge.geometry.positions = new Float32Array([-1e6,-1e6,0,1e6,-1e6,0,-1e6,1e6,0])
  assert(snapshot(huge).transform.gridToSource.every(Number.isFinite))
  const small = rgb(); small.geometry.positions = triangle().map(v => v * 2e-6)
  assert(snapshot(small).transform.cellSize > 0)
  const rounded = rgb(); rounded.geometry.positions = new Float32Array([1e6,1e6,0,1e6+.001,1e6,0,1e6,1e6+.001,0])
  assert.throws(() => snapshot(rounded), /extent/)
  assert.equal(snapshot(rgb()).transform.minimum[2], 0)
  assert.throws(() => snapshot(rgb(), {}, AbortSignal.abort()), { name: 'AbortError' })
})

test('boundary import contains no instantiation/loader behavior', async () => {
  const instantiate = WebAssembly.instantiate
  WebAssembly.instantiate = () => { throw Error('kernel must not load') }
  try {
    const fresh = new URL(process.env.MODKIT_VOXEL_BACKEND_MODULE ?? '../dist/model/voxel-backend.js', import.meta.url)
    fresh.searchParams.set('lazy-import-check', '1')
    const module = await import(fresh.href)
    assert.equal(module.snapshotVoxelBackendRequest(rgb()).triangles, 1)
  } finally { WebAssembly.instantiate = instantiate }
})
