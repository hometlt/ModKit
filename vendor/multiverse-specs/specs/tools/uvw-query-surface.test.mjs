import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { packUvwExactPage } from './uvw-exact-page.ts'
import { materializeUvwGltfPages } from './uvw-gltf-pages.mjs'
const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-query-surface.uvw.json', import.meta.url), 'utf8'))
test('mesh query surface keeps the existing heights and directed class without scalar ground', () => {
  assert.equal(assertUvwProfile(fixture), fixture)
  assert.equal(fixture.spaces[0].layers.filter(layer => layer.kind === 'heightfield' && layer.role !== 'query').length, 0)
})
test('query singleton surface is not padded or extrapolated into rendered ground', () => {
  const value = structuredClone(fixture), space = value.spaces[0]
  space.bounds = { min: [0, 0, 0], max: [1, 7, 1] }
  Object.assign(space.layers.find(layer => layer.kind === 'heightfield'), { columns: 1, rows: 1, origin: [0.5, 0, 0.5], samples: [[7]] })
  Object.assign(space.layers.find(layer => layer.kind === 'traversal'), { columns: 1, rows: 1, origin: [0, 0, 0], walkable: [[true]], exits: [[0]] })
  assert.equal(assertUvwProfile(value), value)
})
test('query role does not authorize ground, cliff presentation, bad dimensions or unknown values', () => {
  for (const mutate of [
    world => { delete world.spaces[0].layers.find(layer => layer.kind === 'heightfield').role },
    world => { world.spaces[0].layers.find(layer => layer.kind === 'heightfield').role = 'preview' },
    world => { world.spaces[0].layers.find(layer => layer.kind === 'heightfield').cliffFaces = [] },
    world => { world.spaces[0].layers.find(layer => layer.kind === 'heightfield').columns = 0 },
    world => { world.spaces[0].layers.find(layer => layer.kind === 'heightfield').samples[0][0] = Infinity },
    world => { world.spaces[0].topology = 'heightfield' },
  ]) { const value = structuredClone(fixture); mutate(value); assert.throws(() => assertUvwProfile(value)) }
})

test('existing inline and paged heightfield storage preserves query role without another scalar codec', () => {
  const world = structuredClone(fixture), space = world.spaces[0]
  space.topology = 'heightfield'
  space.layers.unshift({ id: 'ground', kind: 'heightfield', columns: 2, rows: 2, cellSize: 3,
    origin: [0, 0, 0], samples: [[0, 0], [0, 0]] })
  const inline = createUvwGltfDocument(world)
  assert.deepEqual(restoreUvwProfileDocument(inline), world)
  const paged = structuredClone(inline)
  paged.asset.extras.uv.profile = 'space-graph-paged'
  const query = paged.extensions.UV_world_graph.spaces[0].layers.find(layer => layer.role === 'query')
  const page = packUvwExactPage('f64-le', query.samples.flat())
  paged.buffers = [{ uri: 'surface.bin', byteLength: page.bytes.length }]
  paged.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: page.bytes.length }]
  query.samples = { count: 16, pages: [{ start: 0, bufferView: 0, descriptor: page.descriptor }] }
  assert.deepEqual(materializeUvwGltfPages(paged, [page.bytes]), inline)
})
