import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeVerifiedReceipt, verifiedCompositionRuntimeRules } from './uv-composition.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const document = { uv: { format: 'UVD', version: '1.0' }, namespace: 'sample',
  role: 'kind-schema', kinds: [{ kind: 'unit', version: 1, fields: [] }] }
const hash = await uvpJsonArtifactDigest('uvd', document)
const fixed = { schemaVersion: 1, worldMutation: 'none' }
const mutable = { schemaVersion: 1, worldMutation: 'cell-blockers' }
const manifest = (id = 'sample/root', rules) => ({ uv: { format: 'UVP', version: '1.0' },
  id, version: '1.0.0', kind: 'mod', dependencies: [],
  contents: [{ family: 'uvd', path: 'schema.uvd.json', hash }],
  requires: { intrinsics: [], capabilities: [] },
  ...(rules === undefined ? {} : { runtimeRules: rules }) })
const compose = (manifests, read = async () => ({ digest: hash, document })) =>
  composeVerifiedReceipt('sample/root', manifests, { intrinsics: [] }, [], read)
const receipt = result => { assert.equal(result.refusal, undefined); return result.receipt }

test('rules are verified immutable match inputs and change semantic composition identity', async () => {
  const original = manifest('sample/root', { ...fixed })
  const a = receipt(await compose([original]))
  const b = receipt(await compose([manifest('sample/root', mutable)]))
  const legacy = receipt(await compose([manifest()]))
  assert.equal(new Set([a, b, legacy].map(row => row.compositionHash)).size, 3)
  const policy = await verifiedCompositionRuntimeRules(a)
  assert.deepEqual(policy, { rules: fixed })
  assert.ok(Object.isFrozen(policy.rules))
  assert.throws(() => { policy.rules.worldMutation = 'cell-blockers' }, TypeError)
  original.runtimeRules.worldMutation = 'cell-blockers'
  assert.deepEqual(await verifiedCompositionRuntimeRules(a), { rules: fixed })
  assert.deepEqual(await verifiedCompositionRuntimeRules(legacy), { rules: undefined })
  assert.equal((await verifiedCompositionRuntimeRules(structuredClone(a))).refusal.rule,
    'unverified-composition-receipt')
  const reordered = manifest('sample/root', { worldMutation: 'none', schemaVersion: 1 })
  assert.equal(receipt(await compose([reordered])).compositionHash, a.compositionHash)
})

test('unsupported and partial rule sets refuse before artifact reads', async () => {
  for (const rules of [null, {}, [], { schemaVersion: 1 }, { ...fixed, schemaVersion: 2 },
    { ...fixed, worldMutation: 'voxel-edit' }, { ...fixed, portals: true }]) {
    let reads = 0
    const result = await compose([manifest('sample/root', rules)], async () => {
      reads++; return { digest: hash, document }
    })
    assert.equal(result.refusal?.rule, 'runtime-rules-invalid')
    assert.equal(reads, 0)
  }
})

test('dependency presets require explicit root selection and remain part of identity', async () => {
  const base = { ...manifest('sample/base', mutable), kind: 'game-base' }
  const root = manifest()
  root.dependencies.push({ id: base.id, range: '1.0.0', rank: 'base' })
  let reads = 0
  assert.equal((await compose([base, root], async () => {
    reads++; return { digest: hash, document }
  })).refusal?.rule, 'runtime-rules-root-required')
  assert.equal(reads, 0)
  root.runtimeRules = fixed
  const selected = receipt(await compose([base, root]))
  assert.deepEqual(await verifiedCompositionRuntimeRules(selected), { rules: fixed })
  base.runtimeRules = fixed
  const changedDependency = receipt(await compose([root, base]))
  assert.notEqual(changedDependency.compositionHash, selected.compositionHash)
  assert.deepEqual(await verifiedCompositionRuntimeRules(changedDependency), { rules: fixed })
  // An unrelated package outside the dependency closure is not a match participant.
  assert.equal(receipt(await compose([root, base, manifest('unused/rules', { bad: true })]))
    .compositionHash, changedDependency.compositionHash)
})
