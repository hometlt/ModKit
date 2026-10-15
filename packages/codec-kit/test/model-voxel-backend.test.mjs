import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { snapshotVoxelBackendRequest: snapshot, voxelBackendLimits, DEFAULT_VOXEL_BACKEND_LIMITS } = await import(
  process.env.MODKIT_VOXEL_BACKEND_MODULE ?? '../dist/model/voxel-backend.js'
)
const triangle = () => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
const rgb = () => ({ geometry: { kind: 'triangle-rgb', positions: triangle(), triangleRgb: new Float32Array([1, 0, 0]) }, resolution: 16 })
const atlas = () => ({ geometry: { kind: 'baked-atlas', positions: triangle(), uvs: new Float32Array([.25, .25, .25, .75, .75, .25]), atlas: { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) }, sampler: 'repeat' }, resolution: 16 })
const kernelUrl = new URL(process.env.MODKIT_VOXEL_KERNEL_MODULE ?? '../dist/model/voxel-kernel.js', import.meta.url)
const { createPinnedVoxelKernel } = await import(kernelUrl.href)

/** Copy only this compiled kernel's dependency closure, never a live dist tree or game fixture. */
function kernelFixture(change) {
  const temporary = process.env.MODKIT_TEST_TEMP ?? (process.platform === 'win32' ? 'C:/MKTEMP' : tmpdir())
  mkdirSync(temporary, { recursive: true })
  const root = mkdtempSync(join(temporary, 'modkit-voxel-kernel-'))
  const files = ['model/voxel-kernel.js', 'model/voxel-backend.js', 'model/voxel.js', 'binary.js',
    'crypto/digest.js', 'legacy/core/index.js', 'legacy/core/errors.js',
    'lib/obj2voxel/wasm.js', 'lib/obj2voxel/obj2voxel.mjs']
  for (const path of files) {
    let source = readFileSync(new URL('../' + path, kernelUrl), 'utf8')
    source = change(path, source)
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  return import(pathToFileURL(join(root, 'model/voxel-kernel.js')).href)
}

/** Private altered-glue fixture for native pointer/count validation, not a runtime injection API. */
function mockNative(change = '') {
  return `export default async function () {
    let next = 64;
    const module = { HEAPU8: new Uint8Array(32*1024**2),
      _malloc(bytes) { const p=next; next+=bytes+16;
        const fresh=new Uint8Array(module.HEAPU8.length+65536);fresh.set(module.HEAPU8);module.HEAPU8=fresh;return p; },
      _free() {},
      _proof_run(positions,colours) {
        if(new Float32Array(module.HEAPU8.buffer,positions,9)[3]!==1 || new Float32Array(module.HEAPU8.buffer,colours,3)[0]!==1)throw Error('stale input heap');
        const fresh=new Uint8Array(module.HEAPU8.length+65536);fresh.set(module.HEAPU8);module.HEAPU8=fresh;
        const output=new DataView(fresh.buffer,4096,16);output.setUint32(12,0xffff0000,true);return 0; },
      _proof_count() {return 1;}, _proof_output() {return 4096;}
    };${change};return module;
  }`
}

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

test('kernel import and construction never compile/instantiate and copy trusted limits immediately', async () => {
  const compile = WebAssembly.compile, Instance = WebAssembly.Instance
  WebAssembly.compile = () => { throw Error('eager compile') }
  WebAssembly.Instance = class { constructor() { throw Error('eager instance') } }
  let kernel
  try {
    const fresh = new URL(kernelUrl); fresh.searchParams.set('lazy-kernel', '1')
    const { createPinnedVoxelKernel: create } = await import(fresh.href)
    const limits = { maxRawCells: 1 }; kernel = create(limits); limits.maxRawCells = 1000
    assert(Object.isFrozen(kernel)); assert.deepEqual(Object.keys(kernel), ['run'])
  } finally { WebAssembly.compile = compile; WebAssembly.Instance = Instance }
  await assert.rejects(kernel.run(rgb()), /C ABI/)
})

test('real pinned C ABI never reads a hostile global proof notification', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'proofEntered')
  let reads = 0
  Object.defineProperty(globalThis, 'proofEntered', { configurable: true, get() { reads++; throw Error('ambient proof getter') } })
  try {
    const result = await createPinnedVoxelKernel().run(rgb())
    assert.equal(result.rawCells, 136); assert.equal(result.uniqueCells, 136)
    assert.equal(result.identicalDuplicates, 0); assert.equal(reads, 0)
    for (let i = 0; i < result.grid.colors.length; i += 4) assert.deepEqual([...result.grid.colors.subarray(i, i + 4)], [255, 0, 0, 255])
  } finally {
    if (original) Object.defineProperty(globalThis, 'proofEntered', original)
    else delete globalThis.proofEntered
  }
})

test('kernel snapshots before loading, owns output, and consumes concurrent/repeated attempts', async () => {
  const value = rgb(), kernel = createPinnedVoxelKernel(), pending = kernel.run(value)
  value.geometry.positions.fill(99); value.geometry.triangleRgb.fill(0); value.resolution = 2
  await assert.rejects(kernel.run(rgb()), /consumed/)
  const result = await pending
  assert.equal(result.uniqueCells, 136); assert.equal(result.transform.cellSize, 1 / 15.5)
  assert.equal(result.grid.colors[0], 255); assert.equal(result.grid.colors[1], 0)
  assert(Object.isFrozen(result) && Object.isFrozen(result.allocation))
  const next = await createPinnedVoxelKernel().run(rgb())
  result.grid.colors.fill(0); result.grid.positions.fill(999)
  assert.equal(next.grid.colors[0], 255); assert.notEqual(next.grid.positions[0], 999)
  const invalid = createPinnedVoxelKernel()
  await assert.rejects(invalid.run({}), /resolution/)
  await assert.rejects(invalid.run(rgb()), /consumed/)
  const aborted = createPinnedVoxelKernel()
  await assert.rejects(aborted.run(rgb(), AbortSignal.abort()), { name: 'AbortError' })
  await assert.rejects(aborted.run(rgb()), /consumed/)
})

test('actual atlas alpha remains default refusal or an explicit structured loss', async () => {
  const value = atlas(); value.geometry.atlas.rgba[3] = 0
  await assert.rejects(createPinnedVoxelKernel().run(value), /alpha refused/)
  value.geometry.alphaPolicy = 'discard-explicitly'
  const result = await createPinnedVoxelKernel().run(value)
  assert.deepEqual(result.losses, ['texture-alpha-discarded'])
  assert.equal(result.uniqueCells, 136)
  assert(result.allocation.accountedBytes > 984734)
})

test('digest mismatch refuses before any WebAssembly compilation', async () => {
  const { createPinnedVoxelKernel: create } = await kernelFixture((path, source) => path === 'lib/obj2voxel/wasm.js'
    ? source.replace('AGFzbQE', 'BGFzbQE') : source)
  let calls = 0; const original = WebAssembly.compile
  WebAssembly.compile = async (...args) => { calls++; return original(...args) }
  try { await assert.rejects(create().run(rgb()), /digest mismatch/); assert.equal(calls, 0) }
  finally { WebAssembly.compile = original }
})

test('unexpected WASM imports refuse before the trusted glue factory is instantiated', async () => {
  const original = WebAssembly.Module.imports
  WebAssembly.Module.imports = module => [...original(module), { module: 'env', name: 'ambient_authority', kind: 'function' }]
  try { await assert.rejects(createPinnedVoxelKernel().run(rgb()), /unexpected.*imports/) }
  finally { WebAssembly.Module.imports = original }
})

test('fresh heap views survive growth at every malloc and after the C ABI run', async () => {
  const { createPinnedVoxelKernel: create } = await kernelFixture((path, source) => path.endsWith('obj2voxel.mjs') ? mockNative() : source)
  const result = await create().run(rgb())
  assert.equal(result.uniqueCells, 1); assert.deepEqual([...result.grid.colors], [255, 0, 0, 255])
  // A1 input96 + pinned asset/digest984734 + owned raw16 + further canonical52 = 984898.
  assert.equal(result.allocation.accountedBytes, 984898)
  assert.equal(result.allocation.allocatedBytes, result.allocation.accountedBytes - 48)
  assert.equal((await create({ maxAccountedBytes: 984898 }).run(rgb())).allocation.accountedBytes, 984898)
  await assert.rejects(create({ maxAccountedBytes: 984897 }).run(rgb()), /accounted buffer/)
})

test('native OOM, zero/misaligned pointers, empty/overflow counts and bad ranges refuse atomically', async () => {
  for (const change of [
    'module._malloc=()=>0', 'module._malloc=()=>3', 'module._malloc=()=>{throw new WebAssembly.RuntimeError("OOM")}',
    'module._proof_count=()=>0', 'module._proof_count=()=>2097153', 'module._proof_output=()=>module.HEAPU8.byteLength-8',
    'module._proof_run=()=>102',
  ]) {
    const { createPinnedVoxelKernel: create } = await kernelFixture((path, source) => path.endsWith('obj2voxel.mjs') ? mockNative(change) : source)
    const kernel = create()
    await assert.rejects(kernel.run(rgb()), /pointer|OOM|count|C ABI/)
    await assert.rejects(kernel.run(rgb()), /consumed/)
  }
})
