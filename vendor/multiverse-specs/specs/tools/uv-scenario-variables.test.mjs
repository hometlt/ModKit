import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectScenarioVariables } from './uv-scenario-variables.mjs'
import { composeVerifiedReceipt } from './uv-composition.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const chart = (name, variables) => ({ name, initialState: 'idle',
  variables, states: [{ name: 'idle', on: [] }] })
const doc = (namespace, charts) => ({ uv: { format: 'UVS', version: '1.0' }, namespace, charts })
const entry = (packageId, document) => ({ packageId, path: 'scenario.uvs.json', document })

test('chart-local names become distinct, sorted composition-wide IDs with exact initial bytes', () => {
  const result = projectScenarioVariables([
    entry('map', doc('example', [chart('second', [{ name: 'ready', type: 'bool', initial: true }]),
      chart('first', [{ name: 'ready', type: 'i64', initial: '-2' }])])),
  ])
  assert.deepEqual(result.variables.map(row => [row.id, row.type, row.initialHex]), [
    ['example/first/ready', 'i64', '0103000000693634feffffffffffffff'],
    ['example/second/ready', 'bool', '0004000000626f6f6c01'],
  ])
})

test('duplicate charts across packages and duplicate local variables refuse', () => {
  const first = entry('base', doc('example', [chart('intro', [])]))
  const second = entry('map', doc('example', [chart('intro', [])]))
  assert.equal(projectScenarioVariables([first, second]).refusal.rule, 'scenario-chart-duplicate')
  const repeated = entry('map', doc('example', [chart('intro', [
    { name: 'ready', type: 'bool', initial: true }, { name: 'ready', type: 'bool', initial: false },
  ])]))
  assert.equal(projectScenarioVariables([repeated]).refusal.rule, 'scenario-variable-invalid')
})

test('verified composition refuses duplicate chart identity before it issues a receipt', async () => {
  const documents = new Map([
    ['first.uvs.json', doc('example', [chart('intro', [])])],
    ['second.uvs.json', doc('example', [chart('intro', [])])],
  ])
  const contents = await Promise.all([...documents].map(async ([path, document]) => ({
    family: 'uvs', path, hash: await uvpJsonArtifactDigest('uvs', document),
  })))
  const manifest = { uv: { format: 'UVP', version: '1.0' }, id: 'example/library',
    version: '1.0.0', kind: 'library', dependencies: [],
    requires: { intrinsics: [], capabilities: [] }, contents }
  const result = await composeVerifiedReceipt(manifest.id, [manifest], { intrinsics: [] }, [],
    async ({ content }) => ({ document: documents.get(content.path),
      digest: await uvpJsonArtifactDigest('uvs', documents.get(content.path)) }))
  assert.equal(result.refusal.rule, 'scenario-chart-duplicate')
})

test('unsupported or inexact initial values refuse before composition', () => {
  for (const variable of [
    { name: 'count', type: 'i64', initial: 2 },
    { name: 'count', type: 'i64', initial: '02' },
    { name: 'target', type: 'ref', refKind: 'entity', initial: '0' },
    { name: 'target', type: 'ref', initial: '1' },
    { name: 'items', type: 'list<bool>', initial: [] },
  ]) {
    const result = projectScenarioVariables([entry('map', doc('example', [chart('intro', [variable])]))])
    assert.ok(result.refusal, JSON.stringify(variable))
  }
  const longNamespace = `a${'.a'.repeat(507)}`
  assert.equal(projectScenarioVariables([entry('map', doc(longNamespace, [chart('intro', [
    { name: 'ready', type: 'bool', initial: true },
  ])]))]).refusal.rule, 'scenario-variable-id-budget')
})
