import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDefinitions } from './uv-composition.mjs'

const schema = { role: 'kind-schema', kinds: [
  { kind: 'vehicle', version: 1, fields: [{ name: 'assembly', type: 'record', recordFields: [
    { name: 'label', type: 'string' },
    { name: 'slots', type: 'list', itemType: 'record', recordFields: [
      { name: 'id', type: 'string', required: true },
      { name: 'allowed', type: 'list', itemType: 'ref', refKind: 'weapon' },
      { name: 'installed', type: 'ref', refKind: 'weapon' },
    ] },
  ] }] },
  { kind: 'weapon', version: 1, fields: [{ name: 'damage', type: 'fixed64', required: true }] },
] }

function resolve(installed, options, allowed = ['v/weapon/${self}-gun']) {
  return resolveDefinitions([{ id: 'base', documents: [schema, {
    role: 'definitions', namespace: 'v', definitions: [
      { kind: 'weapon', kindVersion: 1, name: 'rover-gun', fields: { damage: 1 } },
      { kind: 'vehicle', kindVersion: 1, name: 'rover', fields: { assembly: {
        label: '${self} loadout', slots: [{ id: 'left',
          allowed, installed }],
      } } },
    ],
  }] }], options)
}

test('nested UVD slot references and identity bind from the same kind-schema', () => {
  const outcome = resolve('v/weapon/${self}-gun')
  assert.equal(outcome.refusal, undefined)
  assert.deepEqual(outcome.definitions.get('v/vehicle/rover').fields.assembly.value, {
    label: 'rover loadout', slots: [{ id: 'left',
      allowed: ['v/weapon/rover-gun'], installed: 'v/weapon/rover-gun' }],
  })
})

test('a missing nested reference refuses or produces a named diagnostic by policy', () => {
  const strict = resolve('v/weapon/missing')
  assert.equal(strict.refusal?.rule, 'missing-reference')
  assert.match(strict.refusal.message, /assembly\.slots\[0\]\.installed/)
  const diagnostic = resolve('v/weapon/missing', { danglingReferences: 'diagnose' })
  assert.equal(diagnostic.refusal, undefined)
  assert.deepEqual(diagnostic.diagnostics.map(row => row.rule), ['dangling-reference'])
  assert.match(diagnostic.diagnostics[0].message, /assembly\.slots\[0\]\.installed/)
})

test('a nested reference to the wrong definition kind refuses', () => {
  const outcome = resolve('v/vehicle/rover')
  assert.equal(outcome.refusal?.rule, 'reference-kind-mismatch')
  assert.match(outcome.refusal.message, /assembly\.slots\[0\]\.installed/)
})

test('a reference in a nested list is checked independently of the installed part', () => {
  const outcome = resolve('v/weapon/rover-gun', undefined, ['v/weapon/missing'])
  assert.equal(outcome.refusal?.rule, 'missing-reference')
  assert.match(outcome.refusal.message, /assembly\.slots\[0\]\.allowed\[0\]/)
})
