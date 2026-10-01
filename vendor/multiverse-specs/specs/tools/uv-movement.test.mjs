import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDefinitions } from './uv-composition.mjs'

const base = () => [{ id: 'base', documents: [
  { role: 'kind-schema', kinds: [{ kind: 'unit', version: 1, fields: [
    { name: 'terrainMode', type: 'string', runtimeRole: 'movement.class@1' },
    { name: 'pace', type: 'fixed64', unit: 'space-unit-per-tick', runtimeRole: 'movement.speed@1' },
  ] }] },
  { role: 'definitions', namespace: 'demo', definitions: [
    { kind: 'unit', kindVersion: 1, name: 'rover', fields: {
      terrainMode: 'ground', pace: String(1n << 31n),
    } },
    { kind: 'unit', kindVersion: 1, name: 'building', fields: {} },
  ] },
] }]

test('one kind-schema resolves mobile and immobile definitions without native field names', () => {
  const result = resolveDefinitions(base())
  assert.equal(result.refusal, undefined)
  assert.deepEqual(result.movements.get('demo/unit/rover'),
    { classId: 'ground', speedField: 'pace' })
  assert.equal(result.movements.has('demo/unit/building'), false)
})

for (const [label, change, rule] of [
  ['missing role', layers => { layers[0].documents[0].kinds[0].fields.pop();
    delete layers[0].documents[1].definitions[0].fields.pace }, 'movement-schema'],
  ['wrong unit', layers => { layers[0].documents[0].kinds[0].fields[1].unit = 'meter-per-second' }, 'movement-schema'],
  ['missing speed', layers => { delete layers[0].documents[1].definitions[0].fields.pace }, 'movement-profile'],
  ['zero speed', layers => { layers[0].documents[1].definitions[0].fields.pace = '0' }, 'movement-profile'],
  ['invalid class', layers => { layers[0].documents[1].definitions[0].fields.terrainMode = 'bad\0class' }, 'movement-profile'],
]) test(`movement ${label} refuses before runtime binding`, () => {
  const layers = base()
  change(layers)
  assert.equal(resolveDefinitions(layers).refusal?.rule, rule)
})
