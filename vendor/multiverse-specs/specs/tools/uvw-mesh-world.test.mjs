import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, prepareUvwGltfMigration } from './uvw-profile.mjs'

const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-mesh-world.uvw.json', import.meta.url), 'utf8'))

test('model-based mesh profile keeps its frame, instance and resources without a scalar ground', () => {
  assert.equal(assertUvwProfile(fixture), fixture)
  assert.equal(fixture.spaces[0].layers.some(layer => layer.kind === 'heightfield'), false)
  for (const convert of [createUvwGltfDocument, prepareUvwGltfMigration]) {
    const source = structuredClone(fixture)
    assert.throws(() => convert(source), error => error.rule === 'uvw-gltf-topology')
    assert.deepEqual(source, fixture)
  }
})

test('a mesh declaration cannot hide a heightfield or omit the geometry layer', () => {
  const source = structuredClone(fixture)
  source.spaces[0].layers = source.spaces[0].layers.filter(layer => layer.kind !== 'objects')
  assert.throws(() => assertUvwProfile(source), error => error.rule === 'mesh-layer-set')
  const ground = { id: 'ground', kind: 'heightfield', columns: 2, rows: 2,
    cellSize: 1, origin: [0, 0, 0], samples: [[0, 0], [0, 0]] }
  source.spaces[0].layers = [ground, ...fixture.spaces[0].layers]
  assert.throws(() => assertUvwProfile(source), error => error.rule === 'mesh-layer-set')
})
