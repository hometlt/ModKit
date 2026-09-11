import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelMaterialSource, snapshotJson } from '../dist/index.js'
import { snapshotModelMaterials } from '../dist/model/materials.js'

const budget = { maxDepth: 64, maxNodes: 1000, maxBytes: 10_000 }

test('material parameters own immutable nested shader data', async () => {
  const shader = { id: 'example.shader.v1', parameters: { layers: [{ color: [1, 0, 0, 1] }] } }
  const source = createModelMaterialSource({ materials: [{ id: 'material-0', shader }] })
  shader.parameters.layers[0].color[0] = 0
  const value = (await source.materials({ limit: 1 })).items[0]
  assert.equal(value.shader.parameters.layers[0].color[0], 1)
  assert.throws(() => {
    value.shader.parameters.layers[0].color[0] = 0
  }, TypeError)
  assert.equal(
    (await source.materials({ limit: 1 })).items[0].shader.parameters.layers[0].color[0],
    1,
  )
})

test('JSON snapshot applies exact encoded byte, depth and node budgets', () => {
  const value = { text: 'Привет\n', optional: undefined, array: [1, null, true] }
  const maxBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  assert.equal(JSON.stringify(snapshotJson(value, { ...budget, maxBytes })), JSON.stringify(value))
  assert.throws(() => snapshotJson(value, { ...budget, maxBytes: maxBytes - 1 }), /maxBytes/)
  assert.throws(() => snapshotJson(value, { ...budget, maxDepth: 1 }), /maxDepth/)
  assert.throws(() => snapshotJson(value, { ...budget, maxNodes: 3 }), /maxNodes/)
  assert.throws(() => snapshotJson(value, budget, AbortSignal.abort()), { name: 'AbortError' })
})

test('JSON snapshot byte limits match UTF-8 for Unicode values, keys and JSON escapes', () => {
  const strings = [
    '',
    '\u007f\u0080\u07ff\u0800\uffff',
    'Привет',
    '汉字',
    '😀𝄞',
    '\ud800',
    '\udfff',
    '\ud800A\udfff',
    '\ud800\ud800\udc00\udfff',
    '\u0000\b\t\n\f\r"\\',
    '\u2028\u2029',
  ]
  const encoder = new TextEncoder()
  for (const text of strings) {
    const object = Object.fromEntries([
      ['z', [text, null, false]],
      [text, { a: text }],
    ])
    for (const value of [text, object]) {
      const maxBytes = encoder.encode(JSON.stringify(value)).byteLength
      for (const sortKeys of [false, true]) {
        const options = { ...budget, maxBytes, sortKeys }
        const snapshot = snapshotJson(value, options)
        assert.deepEqual(snapshot, value)
        assert.equal(encoder.encode(JSON.stringify(snapshot)).byteLength, maxBytes)
        assert.throws(() => snapshotJson(value, { ...options, maxBytes: maxBytes - 1 }), /maxBytes/)
      }
    }
  }
})

test('JSON snapshot scalar byte limits preserve JSON number and literal representations', () => {
  const scalars = [
    null,
    true,
    false,
    0,
    -0,
    1,
    -1,
    0.1,
    1e-7,
    1e21,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER,
  ]
  for (const value of [...scalars, scalars]) {
    const maxBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    const snapshot = snapshotJson(value, { ...budget, maxBytes })
    assert.deepEqual(snapshot, value)
    assert.throws(() => snapshotJson(value, { ...budget, maxBytes: maxBytes - 1 }), /maxBytes/)
  }
})

test('JSON snapshot rejects corrupt data without silent JSON coercion', () => {
  const cyclic = {}
  cyclic.self = cyclic
  for (const value of [
    NaN,
    Infinity,
    1n,
    new Date(),
    new Float32Array([1]),
    cyclic,
    [undefined],
    Array(1),
  ]) {
    assert.throws(() => snapshotJson(value, budget), TypeError)
  }
  const shared = { value: 1 }
  assert.deepEqual(snapshotJson([shared, shared], budget), [shared, shared])
  const unusual = JSON.parse('{"__proto__":{"safe":true}}')
  assert.equal(JSON.stringify(snapshotJson(unusual, budget)), JSON.stringify(unusual))
  assert.equal({}.safe, undefined)
  assert.throws(() => snapshotJson({}, { maxDepth: 64, maxNodes: 1 }), /budget/)
})

test('material parameter limits cover the aggregate across materials', () => {
  const shader = { id: 'example.v1', parameters: { alpha: 0.5 } }
  const maxBytes = new TextEncoder().encode(JSON.stringify([{ id: 'a', shader }])).byteLength
  createModelMaterialSource({ materials: [{ id: 'a', shader }], budget: { ...budget, maxBytes } })
  assert.throws(
    () =>
      createModelMaterialSource({
        materials: [
          { id: 'a', shader },
          { id: 'b', shader },
        ],
        budget: { ...budget, maxBytes },
      }),
    /maxBytes/,
  )
  for (const invalid of [
    { id: '', parameters: {} },
    { id: 'valid', parameters: [] },
    { id: 'valid', parameters: null },
  ]) {
    assert.throws(
      () => createModelMaterialSource({ materials: [{ id: 'a', shader: invalid }] }),
      TypeError,
    )
  }
})

test('full material snapshots validate metadata, preserve array order and canonicalize keys', () => {
  const material = {
    id: 'material-0',
    name: 'Unit',
    priority: 3,
    nativeFlags: 9,
    layers: [
      { slot: 'diffuse', resourceId: 'Assets/Unit.dds', uvSource: 1, flagNames: ['wrap-x'] },
    ],
    shader: { id: 'example.v1', parameters: { z: 3, a: [2, 1] } },
  }
  const reversed = Object.fromEntries(Object.entries(material).reverse())
  assert.equal(
    JSON.stringify(snapshotModelMaterials([material], budget)),
    JSON.stringify(snapshotModelMaterials([reversed], budget)),
  )
  const snapshot = snapshotModelMaterials([material], budget)
  assert.deepEqual(snapshot[0].shader.parameters.a, [2, 1])
  material.layers[0].uvSource = 7
  assert.equal(snapshot[0].layers[0].uvSource, 1)
  assert.throws(() => {
    snapshot[0].layers[0].uvSource = 4
  }, TypeError)
  for (const value of [
    [material, material],
    [{ id: '' }],
    [{ id: 'a', priority: 'high' }],
    [{ id: 'a', flagNames: [1] }],
    [{ id: 'a', layers: {} }],
    [{ id: 'a', layers: [{ slot: '' }] }],
    [{ id: 'a', shader: { id: 'x', parameters: [] } }],
  ]) {
    assert.throws(() => snapshotModelMaterials(value, budget), TypeError)
  }
  assert.throws(() => snapshotModelMaterials([material], { ...budget, maxBytes: 1 }), /maxBytes/)
  assert.throws(() => snapshotModelMaterials([material], budget, AbortSignal.abort()), {
    name: 'AbortError',
  })
})
