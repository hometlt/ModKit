import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { packUvwExactPage } from './uvw-exact-page.ts'
import { materializeUvwGltfPages } from './uvw-gltf-pages.mjs'
const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-game-rasters.uvw.json', import.meta.url), 'utf8'))
test('independent game rasters preserve literal values, NoData, units and ordered legends through the existing glTF graph', () => {
  assert.equal(assertUvwProfile(fixture), fixture)
  const gltf = createUvwGltfDocument(fixture)
  assert.deepEqual(restoreUvwProfileDocument(gltf), fixture)
})
test('the existing exact f64 page codec preserves signed fields and category semantics', () => {
  const inline = createUvwGltfDocument(fixture), paged = structuredClone(inline)
  paged.asset.extras.uv.profile = 'space-graph-paged'
  const field = paged.extensions.UV_world_graph.spaces[0].layers.find(layer => layer.id === 'attributes')
  const page = packUvwExactPage('f64-le', field.samples.flat())
  paged.buffers = [{ uri: 'field.bin', byteLength: page.bytes.length }]
  paged.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: page.bytes.length }]
  field.samples = { count: 4, pages: [{ start: 0, bufferView: 0, descriptor: page.descriptor }] }
  assert.deepEqual(materializeUvwGltfPages(paged, [page.bytes]), inline)
})
test('all admitted numeric storage types remain exact without applying valueScale', () => {
  for (const [valueType, minimum, maximum, samples] of [
    ['u8',0,255,[[0,255],[1,128]]], ['u16',0,65535,[[65535,32768],[0,1]]],
    ['u32',0,4294967295,[[4294967295,2147483648],[0,1]]],
    ['i32',-2147483648,2147483647,[[-2147483648,2147483647],[-1,0]]],
    ['f64',-1,1,[[-0.125,0.25],[1,0]]],
  ]) {
    const world = structuredClone(fixture), layer = world.spaces[0].layers.find(layer => layer.id === 'metal')
    Object.assign(layer, { valueType, minimum, maximum, samples })
    assert.equal(assertUvwProfile(world), world)
    assert.deepEqual(restoreUvwProfileDocument(createUvwGltfDocument(world)).spaces[0].layers.find(layer => layer.id === 'metal').samples, samples)
  }
})
test('unknown meanings, storage casts, unsafe grids and category ambiguity refuse instead of becoming pathing', () => {
  for (const mutate of [
    layer => { layer.valueMeaning = 'metal' }, layer => { layer.valueType = 'u64' },
    layer => { layer.samples[0][0] = 256 }, layer => { layer.samples[0][0] = 0.5 },
    layer => { layer.samples[0][0] = -0 }, layer => { layer.samples[0][0] = Infinity },
    layer => { layer.samples[0].pop() }, layer => { delete layer.origin[1] }, layer => { layer.origin[0] = 1 },
    layer => { layer.categories = [{ value: 1, label: 'a' }, { value: 1, label: 'b' }] },
  ]) { const world = structuredClone(fixture); mutate(world.spaces[0].layers.find(layer => layer.id === 'metal')); assert.throws(() => assertUvwProfile(world)) }
})
