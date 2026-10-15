/** Normative object wire tests; native facing and Core draw/pick/cull are separate owners. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { uvwDocumentGraph } from './uvw-gltf.mjs'
import { jcsBytes, uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const read = name => readFile(new URL(`../world/fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse)
const spatial = await read('uvw-presentation-rotation.uvw.json')
const gltf = await read('uvw-presentation-rotation.uvw.gltf')
const instance = document => uvwDocumentGraph(document).spaces[0].layers[0].instances[0]
const reopen = document => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jcsBytes(document)))

test('authored 30 and absolute presentation 90 survive independent bytes in both envelopes', async () => {
  for (const [document, length, digest] of [
    [spatial, 697, '09aed73af647b699d621dd36d14bd97438a4f971aeeda8f85c85bd30bbeadfd2'],
    [gltf, 867, '32891e3ed8ce333735cdabadadb76301e77e5f137e46b2ec7385a2bb53126594'],
  ]) {
    const bytes = jcsBytes(document), decoded = reopen(document)
    assert.equal(assertUvwProfile(decoded), decoded)
    assert.equal(bytes.length, length)
    assert.equal(await uvpJsonArtifactDigest('uvw', decoded), `sha256:${digest}`)
    assert.deepEqual(instance(decoded), instance(spatial))
    assert.notDeepEqual(instance(decoded).rotation, instance(decoded).presentationRotation)
    assert.deepEqual(jcsBytes(decoded), bytes)
  }
})

test('migration preserves exact author/override values and does not modify the source', () => {
  const before = jcsBytes(spatial)
  assert.deepEqual(createUvwGltfDocument(spatial), gltf)
  assert.deepEqual(restoreUvwProfileDocument(reopen(gltf)), spatial)
  assert.deepEqual(jcsBytes(spatial), before)
})

test('omission, identity, equal, sign-equivalent and non-yaw overrides remain distinct authored data', () => {
  const authored = instance(spatial).rotation
  for (const value of [undefined, [0, 0, 0, 1], authored, authored.map(x => -x),
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2]]) {
    const document = structuredClone(spatial)
    if (value === undefined) delete instance(document).presentationRotation
    else instance(document).presentationRotation = [...value]
    const before = jcsBytes(document)
    assertUvwProfile(document)
    const restored = restoreUvwProfileDocument(reopen(createUvwGltfDocument(document)))
    assert.deepEqual(jcsBytes(restored), before)
    assert.equal(Object.hasOwn(instance(restored), 'presentationRotation'), value !== undefined)
    assert.deepEqual(instance(restored).rotation, authored)
    if (value !== undefined) assert.deepEqual(jcsBytes(instance(restored).presentationRotation), jcsBytes(value))
  }
})

test('both quaternions affect artifact identity without collapsing explicit equal overrides', async () => {
  const original = await uvpJsonArtifactDigest('uvw', spatial)
  for (const change of [
    value => { value.rotation = [0, 0, 0, 1] },
    value => { value.presentationRotation = [0, 0, 0, 1] },
    value => { delete value.presentationRotation },
    value => { value.presentationRotation = value.rotation.map(x => -x) },
  ]) {
    const document = structuredClone(spatial); change(instance(document))
    assertUvwProfile(document)
    assert.notEqual(await uvpJsonArtifactDigest('uvw', document), original)
  }
  const equal = structuredClone(spatial)
  instance(equal).presentationRotation = [...instance(equal).rotation]
  const absent = structuredClone(equal); delete instance(absent).presentationRotation
  assert.notEqual(await uvpJsonArtifactDigest('uvw', equal), await uvpJsonArtifactDigest('uvw', absent))
})

test('malformed override and authored quaternions refuse in both envelopes', () => {
  for (const seed of [spatial, gltf]) {
    for (const key of ['rotation', 'presentationRotation']) {
      for (const value of [null, {}, '0,0,0,1', [0, 0, 1], [0, 0, 0, 1, 0],
        [0, 0, 0, 0], [0, 0, 0, 2], [0, NaN, 0, 1], [0, 0, Infinity, 1]]) {
        const document = structuredClone(seed); instance(document)[key] = value
        assert.throws(() => assertUvwProfile(document), error => error.rule === 'objects-instance')
      }
    }
    const unknown = structuredClone(seed); instance(unknown).presentationQuaternion = [0, 0, 0, 1]
    assert.throws(() => assertUvwProfile(unknown), error => error.rule === 'objects-instance')
  }
})

test('the existing quaternion tolerance and JCS negative-zero rule are unchanged', () => {
  const document = structuredClone(spatial)
  instance(document).presentationRotation = [-0, 0, 0, Math.sqrt(1 + 5e-7)]
  assertUvwProfile(document)
  assert.equal(Object.is(instance(reopen(document)).presentationRotation[0], -0), false)
  assert.equal(instance(reopen(document)).presentationRotation[3], instance(document).presentationRotation[3])
  instance(document).presentationRotation[3] = Math.sqrt(1 + 2e-6)
  assert.throws(() => assertUvwProfile(document), error => error.rule === 'objects-instance')
})

test('legacy fixtures without the override retain bytes and omission through migration', async () => {
  for (const name of ['uvw-profile-single-space.uvw.json', 'uvw-lattice.uvw.json']) {
    const document = await read(name), before = jcsBytes(document)
    const restored = restoreUvwProfileDocument(createUvwGltfDocument(document))
    assert.deepEqual(jcsBytes(restored), before)
    for (const space of restored.spaces)
      for (const layer of space.layers.filter(row => row.kind === 'objects'))
        for (const value of layer.instances) assert.equal(Object.hasOwn(value, 'presentationRotation'), false)
  }
})
