import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { packUvwExactPage } from './uvw-exact-page.ts'
import { materializeUvwGltfPages } from './uvw-gltf-pages.mjs'

const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-navigation-independent.uvw.json', import.meta.url), 'utf8'))

test('independent flags grid and publisher vocabulary round-trip through the existing glTF profile', () => {
  assert.equal(assertUvwProfile(fixture), fixture)
  const result = restoreUvwProfileDocument(createUvwGltfDocument(fixture))
  assert.deepEqual(result, fixture)
})

test('vocabulary is not invented for old worlds and malformed identities refuse before interpretation', () => {
  const old = structuredClone(fixture)
  delete old.spaces[0].layers[1].flagEncoding
  assert.equal(assertUvwProfile(old), old)
  assert.equal(Object.hasOwn(restoreUvwProfileDocument(createUvwGltfDocument(old)).spaces[0].layers[1], 'flagEncoding'), false)
  for (const value of ['', 'unknown', 'example/pathing', 'example/pathing@0', 'example/pathing@1\n', true, null, 'a/' + 'b'.repeat(1024) + '@1']) {
    const source = structuredClone(fixture)
    source.spaces[0].layers[1].flagEncoding = value
    assert.throws(() => assertUvwProfile(source), error => error.rule === 'navigation-flag-encoding')
  }
})

test('paged navigation retains its vocabulary and independent grid while decoding the exact flags once', () => {
  const inline = createUvwGltfDocument(fixture)
  const paged = structuredClone(inline)
  paged.asset.extras.uv.profile = 'space-graph-paged'
  const navigation = paged.extensions.UV_world_graph.spaces[0].layers[1]
  const page = packUvwExactPage('u32-le', navigation.samples.flat())
  paged.buffers = [{ uri: 'navigation.bin', byteLength: page.bytes.length }]
  paged.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: page.bytes.length }]
  navigation.samples = { count: 16, pages: [{ start: 0, bufferView: 0, descriptor: page.descriptor }] }
  assert.deepEqual(materializeUvwGltfPages(paged, [page.bytes]), inline)
})
