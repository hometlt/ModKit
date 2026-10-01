import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { packUvwExactPage, unpackUvwExactPage, assertUvwExactPageDescriptor, UVW_EXACT_PAGE_MAX_VALUES } from './uvw-exact-page.ts'
import { assertUvwProfile } from './uvw-profile.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

test('exact scalar encodings have independently specified little-endian bytes', () => {
  for (const [encoding, values, hex] of [
    ['f64-le', [1, 1 + 2 ** -32, -9999, Number.MIN_VALUE], '000000000000f03f000010000000f03f000000008087c3c00100000000000000'],
    ['u32-le', [0, 1, 0x80000000, 0xffffffff], '000000000100000000000080ffffffff'],
    ['u8', [0, 1, 15, 255], '00010fff'],
    ['bool-lsb0', [true, false, true, false, false, false, false, true, true], '8501'],
  ]) {
    const packed = packUvwExactPage(encoding, values)
    assert.equal(Buffer.from(packed.bytes).toString('hex'), hex)
    assert.deepEqual(unpackUvwExactPage(packed.descriptor, Uint8Array.from(Buffer.from(hex, 'hex'))), values)
    assert.deepEqual(unpackUvwExactPage(packed.descriptor, packed.bytes), values)
    assert.equal(assertUvwExactPageDescriptor(packed.descriptor), packed.descriptor)
  }
})

test('binary64 preserves the full existing JSON number domain without float32 or fixed64 quantization', () => {
  const values = [0, -0, 0.1, -0.1, 1 + 2 ** -32, 2 ** -32, Number.MIN_VALUE,
    -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]
  for (let exponent = -1022; exponent <= 1023; exponent += 17) values.push(2 ** exponent, -(2 ** exponent))
  const packed = packUvwExactPage('f64-le', values)
  const decoded = unpackUvwExactPage(packed.descriptor, packed.bytes)
  assert.deepEqual(decoded, values.map(value => value === 0 ? 0 : value))
  assert.equal(values[1], -0)
  assert.notEqual(decoded[4], Math.fround(decoded[4]))
})

test('untrusted descriptors, buffers, padding and scalars refuse without coercion or partial output', () => {
  const packed = packUvwExactPage('f64-le', [1])
  for (const change of [d => { d.schemaVersion = 2 }, d => { d.count = 0 },
    d => { d.count = UVW_EXACT_PAGE_MAX_VALUES + 1 }, d => { d.count = 0.5 },
    d => { d.count = Infinity }, d => { d.byteLength = 9 }, d => { d.encoding = 'f32-le' },
    d => { d.extra = 1 }, d => { delete d.encoding }]) {
    const descriptor = { ...packed.descriptor }; change(descriptor)
    assert.throws(() => unpackUvwExactPage(descriptor, packed.bytes), /uvw-exact-page/)
  }
  for (const invalid of [null, [], {}, Object.create(packed.descriptor)])
    assert.throws(() => assertUvwExactPageDescriptor(invalid), /uvw-exact-page/)
  for (const values of [[], [NaN], [Infinity], [undefined], ['1'], [null], [true], new Array(2)])
    assert.throws(() => packUvwExactPage('f64-le', values), /uvw-exact-page/)
  assert.throws(() => packUvwExactPage('f64-le', new Array(UVW_EXACT_PAGE_MAX_VALUES + 1)), /budget/)
  for (const encoding of ['u8', 'u32-le']) for (const value of [-1, 0.5, 2 ** 32, '1', true])
    assert.throws(() => packUvwExactPage(encoding, [value]), /unsigned/)
  assert.throws(() => packUvwExactPage('u8', [256]), /unsigned/)
  assert.throws(() => packUvwExactPage('bool-lsb0', [1]), /boolean/)
  for (const value of [-0, NaN, Infinity, -Infinity]) {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true)
    assert.throws(() => unpackUvwExactPage(packed.descriptor, bytes), /Noncanonical/)
  }
  for (const bytes of [new Uint8Array(7), new Uint8Array(9), new DataView(new ArrayBuffer(8)),
    new Uint8Array(new SharedArrayBuffer(8)), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))])
    assert.throws(() => unpackUvwExactPage(packed.descriptor, bytes), /fixed ArrayBuffer/)
  const bits = packUvwExactPage('bool-lsb0', [true]); bits.bytes[0] |= 128
  assert.throws(() => unpackUvwExactPage(bits.descriptor, bits.bytes), /tail bits/)
})

test('page decoding respects byteOffset and returns independent values; size boundary is executable', () => {
  const packed = packUvwExactPage('f64-le', [0.1, 2])
  const wrapper = new Uint8Array(packed.bytes.length + 7); wrapper.fill(0xff); wrapper.set(packed.bytes, 3)
  const decoded = unpackUvwExactPage(packed.descriptor, wrapper.subarray(3, -4))
  assert.deepEqual(decoded, [0.1, 2]); wrapper.fill(0)
  assert.deepEqual(decoded, [0.1, 2])
  const maximum = packUvwExactPage('bool-lsb0', new Array(UVW_EXACT_PAGE_MAX_VALUES).fill(true))
  assert.equal(maximum.bytes.length, UVW_EXACT_PAGE_MAX_VALUES / 8)
  assert.equal(unpackUvwExactPage(maximum.descriptor, maximum.bytes).every(value => value), true)
})

test('restoring exact pages preserves existing world identity, noData and directed traversal', async () => {
  const world = JSON.parse(await readFile(new URL('../world/fixtures/uvw-gltf-spatial.uvw.gltf', import.meta.url), 'utf8'))
  const before = structuredClone(world), digest = await uvpJsonArtifactDigest('uvw', world)
  for (const layer of world.extensions.UV_world_graph.spaces[0].layers) {
    for (const [field, encoding] of Object.entries(layer.kind === 'heightfield' ? { samples: 'f64-le' }
      : layer.kind === 'traversal' ? { walkable: 'bool-lsb0', exits: 'u8' } : { samples: 'u32-le' })) {
      const packed = packUvwExactPage(encoding, layer[field].flat())
      const flat = unpackUvwExactPage(packed.descriptor, packed.bytes)
      layer[field] = Array.from({ length: layer.rows }, (_, row) => flat.slice(row * layer.columns, (row + 1) * layer.columns))
    }
  }
  assertUvwProfile(world)
  assert.deepEqual(world, before)
  assert.equal(await uvpJsonArtifactDigest('uvw', world), digest)
  // This is an exact storage proof, not admission of a new document or reuse of identity after migration.
  world.buffers = [{ byteLength: 8, uri: 'heights.bin' }]
  assert.throws(() => assertUvwProfile(world), /uvw-gltf-envelope/)
})
