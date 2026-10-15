/** Carrier/GLB preservation only. Shape checks use the conformance Ajv runner; Core owns sampling. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { assertUvmCore, readGltfFixture, packGlb, unpackGlb } from './uvm-core.mjs'

const cases = JSON.parse(await readFile(new URL('../model/fixtures/uvm-emis-mult-cases.json', import.meta.url), 'utf8'))
const seed = readGltfFixture(fileURLToPath(new URL('../model/fixtures/uvm-emis-mult-targets.uvm.gltf', import.meta.url)))
const catalog = document => document.extensions.UV_game_animation_clips
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('inactive standard/composite gain targets survive actual GLB bytes without inventing active materials', () => {
  assertUvmCore(seed.document)
  const bytes = packGlb(seed.document, seed.binary)
  assert.equal(bytes.length, 1688)
  assert.equal(sha(bytes), 'cea91e15b366d9369f7dd9344c862c3d10fe5900b87b4cd3cb95132a286fbe38')
  const reopened = unpackGlb(bytes)
  assertUvmCore(reopened.document)
  assert.deepEqual(reopened.document, seed.document)
  assert.deepEqual(reopened.binary, seed.binary)
  assert.deepEqual(packGlb(reopened.document, reopened.binary), bytes)
  assert.deepEqual(catalog(reopened.document).materialTargets, [cases.standard, cases.composite])
  assert.equal(reopened.document.materials, undefined)
  assert.equal(reopened.document.textures, undefined)
  assert.equal(reopened.document.meshes, undefined)
})

test('signed, zero, HDR and finite-roundable source gains remain unquantized numeric defaults with array keys', () => {
  for (const target of [cases.standard, cases.composite]) {
    for (const value of [-2, 0, 1, 2, cases.finiteRoundable]) {
      const document = structuredClone(seed.document)
      const changed = structuredClone(target)
      changed.properties[0].value = value
      changed.properties[0].sequenceTracks[0].track.keys[0].vector = [value]
      catalog(document).materialTargets = [changed]
      const reopened = unpackGlb(packGlb(document, seed.binary)).document
      assert.deepEqual(catalog(reopened).materialTargets, [changed])
      assert.equal(typeof catalog(reopened).materialTargets[0].properties[0].value, 'number')
    }
  }
  // The finite-binary32 domain is not an instruction to round authored JSON numbers.
  assert.ok(cases.finiteRoundable > Math.fround(cases.finiteRoundable))
})

test('ordinary and concurrent clock metadata, negative keys and explicit defaults survive without sampling', () => {
  const document = structuredClone(seed.document)
  catalog(document).clips.reverse()
  const reopened = unpackGlb(packGlb(document, seed.binary)).document
  assert.deepEqual(catalog(reopened), catalog(document))
  assert.deepEqual(catalog(reopened).materialTargets[0].properties[0].sequenceTracks[0],
    cases.standard.properties[0].sequenceTracks[0])
  assert.equal(catalog(reopened).materialTargets[0].properties[0].sequenceTracks[1].concurrent, true)
  assert.equal(catalog(reopened).materialTargets[0].properties[0].sequenceTracks[1].wrapSeconds, 1)
})

test('default, key and clock changes alter bytes; packing never edits captured source', () => {
  const original = packGlb(seed.document, seed.binary)
  for (const change of [
    value => { value.value = 1 },
    value => { value.sequenceTracks[0].track.keys[0].vector = [1] },
    value => { value.sequenceTracks[1].wrapSeconds = 2 },
  ]) {
    const document = structuredClone(seed.document)
    change(catalog(document).materialTargets[0].properties[0])
    assert.notEqual(sha(packGlb(document, seed.binary)), sha(original))
  }
  assert.deepEqual(packGlb(seed.document, seed.binary), original)
})

test('unrelated legacy scalar-vector defaults and existing model goldens retain their representation', async () => {
  const document = structuredClone(seed.document)
  catalog(document).materialTargets = [cases.legacyVectorDefault]
  const reopened = unpackGlb(packGlb(document, seed.binary)).document
  assert.deepEqual(catalog(reopened).materialTargets, [cases.legacyVectorDefault])
  const legacy = readGltfFixture(fileURLToPath(new URL('../model/fixtures/uvm-fixed-function-state.uvm.gltf', import.meta.url)))
  const bytes = packGlb(legacy.document, legacy.binary)
  assert.equal(bytes.length, 1432)
  assert.equal(sha(bytes), '63475def2e92db9e6519e9f304557c97bfe4e3830b2a5c0581726ee29fba5f1a')
})
