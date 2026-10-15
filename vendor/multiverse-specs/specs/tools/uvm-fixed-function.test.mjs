/** Normative wire/GLB tests; the Core materializer and real additive draw have their own owners. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { assertUvmMaterialState } from './uvm-fixed-function.ts'
import { assertUvmCore, readGltfFixture, packGlb, unpackGlb } from './uvm-core.mjs'
import { jcsBytes } from './uv-canonical-form.mjs'
import { probePresentation } from './uvm-presentation-browser.ts'
import { runBrowserWorker } from '../../runtime/test/browser-runner.ts'

const cases = JSON.parse(await readFile(new URL('../model/fixtures/uvm-fixed-function-cases.json', import.meta.url), 'utf8'))
const seed = readGltfFixture(fileURLToPath(new URL('../model/fixtures/uvm-fixed-function-state.uvm.gltf', import.meta.url)))
const state = document => document.materials[0].extensions.UV_game_material
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('each of the three state fields admits without shader, without injecting missing fields or defaults', () => {
  for (const name of ['state', 'blendOnly', 'depthOnly', 'priorityOnly']) {
    const packet = structuredClone(cases[name]), before = jcsBytes(packet)
    assertUvmMaterialState(packet)
    assert.deepEqual(jcsBytes(packet), before)
    const document = structuredClone(seed.document)
    document.materials[0].extensions.UV_game_material = packet
    assert.equal(assertUvmCore(document), document)
    assert.deepEqual(state(document), cases[name])
    assert.equal(Object.hasOwn(state(document), 'shader'), false)
    assert.equal(Object.hasOwn(state(document), 'params'), false)
    assert.equal(document.materials[0].alphaMode, 'BLEND')
  }
})

test('empty, shader-specific and outside-slice payloads cannot enter through the state-only branch', () => {
  for (const packet of [{}, { params: {} }, { blendMode: 'additive', params: {} },
    { sortPriority: 7, parameters: {} }, { sortPriority: 7, passes: [] },
    { blendMode: 'additive', layers: [] }, { cull: 'none' }, { priority: 7 }]) {
    assert.throws(() => assertUvmMaterialState(packet), error => error.rule === 'material-state-only-fields')
  }
  for (const [packet, rule] of [
    [null, 'material-state-shape'], [[], 'material-state-shape'],
    [{ shader: null, params: {} }, 'material-shader-identity'],
    [{ shader: '', blendMode: 'additive' }, 'material-shader-identity'],
    [{ shader: 0, depthWrite: false }, 'material-shader-identity'],
  ]) assert.throws(() => assertUvmMaterialState(packet), error => error.rule === rule)
})

test('state values use the existing vocabulary and distinguish false/zero from omission', () => {
  for (const [packet, rule] of [
    [{ blendMode: 'unknown' }, 'material-blend-state'],
    [{ depthWrite: 1 }, 'material-depth-state'],
    [{ sortPriority: 0.5 }, 'material-sort-state'],
    [{ sortPriority: Infinity }, 'material-sort-state'],
  ]) assert.throws(() => assertUvmMaterialState(packet), error => error.rule === rule)
  for (const packet of [{ depthWrite: false }, { sortPriority: 0 }, { sortPriority: -7 }])
    assert.doesNotThrow(() => assertUvmMaterialState(packet))
})

test('the actual source shader identity owns params and retains the prior branch and common refusals', () => {
  for (const name of ['shaderMinimal', 'shaderFull']) {
    const document = structuredClone(seed.document)
    document.materials[0].extensions.UV_game_material = structuredClone(cases[name])
    const before = jcsBytes(document)
    assertUvmCore(document)
    assert.deepEqual(jcsBytes(document), before)
  }
  const invalid = structuredClone(seed.document)
  invalid.materials[0].extensions.UV_game_material = { ...cases.shaderMinimal, castShadows: 0 }
  assert.throws(() => assertUvmCore(invalid), /material-shadow-flags/)
})

test('full GLB write/unpack preserves the state packet, binary geometry and deterministic bytes', () => {
  assertUvmCore(seed.document)
  const bytes = packGlb(seed.document, seed.binary)
  assert.equal(bytes.length, 1432)
  assert.equal(sha(bytes), '63475def2e92db9e6519e9f304557c97bfe4e3830b2a5c0581726ee29fba5f1a')
  const reopened = unpackGlb(bytes)
  assertUvmCore(reopened.document)
  assert.deepEqual(state(reopened.document), cases.state)
  assert.deepEqual(reopened.binary, seed.binary)
  assert.deepEqual(packGlb(reopened.document, reopened.binary), bytes)
  assert.equal(sha(packGlb(seed.document, seed.binary)), sha(bytes))
  const changed = structuredClone(seed.document)
  state(changed).sortPriority = 8
  assertUvmCore(changed)
  assert.notEqual(sha(packGlb(changed, seed.binary)), sha(bytes))
})

test('the existing core version, PBR fallback and UV extensionsRequired refusal are unchanged', () => {
  const document = structuredClone(seed.document)
  assertUvmCore(document)
  assert.equal(document.asset.extras.uv.version, '1.0')
  assert.ok(document.materials[0].pbrMetallicRoughness)
  const future = structuredClone(document); future.asset.extras.uv.version = '1.1'
  assert.throws(() => assertUvmCore(future), /UVM\/core 1.0/)
  const required = structuredClone(document); required.extensionsRequired = ['UV_game_material']
  assert.throws(() => assertUvmCore(required), /must not require a UV_/)
})

test('state-only and shader-bearing admission agrees in Node and a real Chrome worker',
  { skip: process.env.MULTIVERSE_TEST_REAL_BROWSER !== '1' }, async () => {
    const packets = [cases.state, cases.depthOnly, cases.priorityOnly, cases.shaderFull,
      {}, { blendMode: 'additive', params: {} }, { shader: '', params: {} }, { depthWrite: 0 }]
    const models = packets.map(packet => {
      const document = structuredClone(seed.document)
      document.materials[0].extensions.UV_game_material = packet
      return document
    })
    const payload = { models, worlds: [] }
    const expected = probePresentation(payload)
    const browser = await runBrowserWorker(new URL('./uvm-presentation-browser.ts', import.meta.url), payload)
    assert.deepEqual(browser.result, expected)
  })
