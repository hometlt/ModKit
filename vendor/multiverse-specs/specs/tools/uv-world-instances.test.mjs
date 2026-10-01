import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeVerifiedReceipt, verifiedCompositionWorldSpaces, verifiedCompositionDocuments } from './uv-composition.mjs'
import { uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const world = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-traversal-surface.uvw.json', import.meta.url), 'utf8'))
const hash = await uvpJsonArtifactDigest('uvw', world)
const selection = (packageId = 'sample/world') => ({ schemaVersion: 1, instances:
  ['alpha', 'beta'].map(id => ({ id, packageId, path: 'world.uvw.json' })) })
const manifest = (id = 'sample/world', worldInstances) => ({ uv: { format: 'UVP', version: '1.0' },
  id, version: '1.0.0', kind: 'mod', dependencies: [],
  contents: [{ family: 'uvw', path: 'world.uvw.json', hash }],
  requires: { intrinsics: [], capabilities: [] },
  ...(worldInstances === undefined ? {} : { worldInstances }) })
const compose = (manifests, read = async () => ({ digest: hash, document: world })) =>
  composeVerifiedReceipt('sample/world', manifests, { intrinsics: [] }, [], read)
const receipt = result => { assert.equal(result.refusal, undefined, JSON.stringify(result)); return result.receipt }

test('world instance addresses are immutable, qualified and share one captured geometry owner', async () => {
  const root = manifest('sample/world', selection())
  const a = receipt(await compose([root]))
  const linked = await verifiedCompositionWorldSpaces(a)
  assert.deepEqual(linked.spaces.map(({ address, instanceId, spaceId, packageId, path }) =>
    ({ address, instanceId, spaceId, packageId, path })), ['alpha', 'beta'].map(instanceId =>
    ({ address: `${instanceId}/main`, instanceId, spaceId: 'main', packageId: root.id, path: 'world.uvw.json' })))
  const captured = await verifiedCompositionDocuments(a)
  assert.equal(linked.spaces[0].space, captured.documents[0].document.spaces[0])
  assert.equal(linked.spaces[0].space, linked.spaces[1].space)
  assert.throws(() => { linked.spaces[0].space.id = 'other' }, TypeError)
  assert.throws(() => { linked.spaces.pop() }, TypeError)
  assert.throws(() => { linked.spaces[0].address = 'main' }, TypeError)
  root.worldInstances.instances[0].id = 'another'
  assert.equal((await verifiedCompositionWorldSpaces(a)).spaces[0].address, 'alpha/main')
  assert.equal((await verifiedCompositionWorldSpaces(structuredClone(a))).refusal.rule, 'unverified-composition-receipt')
  const changed = selection(); changed.instances[1].id = 'gamma'
  assert.notEqual(receipt(await compose([manifest('sample/world', changed)])).compositionHash, a.compositionHash)
  const legacy = receipt(await compose([manifest()]))
  assert.deepEqual((await verifiedCompositionWorldSpaces(legacy)).spaces.map(s => s.address), ['main'])
  assert.notEqual(a.compositionHash, legacy.compositionHash)
  const fixed = manifest('sample/world', selection()); fixed.runtimeRules = { schemaVersion: 1, worldMutation: 'none' }
  assert.notEqual(receipt(await compose([fixed])).compositionHash, a.compositionHash)
  const targets = manifest('sample/world', selection())
  targets.contents.push({ ...targets.contents[0], path: 'other.uvw.json' })
  const first = receipt(await compose([targets]))
  targets.worldInstances.instances[0].path = 'other.uvw.json'
  assert.notEqual(receipt(await compose([targets])).compositionHash, first.compositionHash,
    'changing an instance target changes identity even when both artifacts have identical bytes')
})

test('world instance shape, ordering and targets refuse before artifact I/O', async () => {
  const malformed = [null, {}, [], { ...selection(), schemaVersion: 2 },
    { ...selection(), frames: [] }, { schemaVersion: 1, instances: [] },
    { schemaVersion: 1, instances: Array(65).fill(selection().instances[0]) }]
  for (const path of ['', '../world.uvw.json', './world.uvw.json', '/world.uvw.json', 'C:/world.uvw.json',
    'foo//world.uvw.json', 'foo/', 'world\0.uvw.json', 'foo\\world.uvw.json']) {
    const value = selection(); value.instances[0].path = path; malformed.push(value)
  }
  for (const id of ['', 'a/b', '@main', 'Main', 'a'.repeat(49)]) {
    const value = selection(); value.instances[0].id = id; malformed.push(value)
  }
  for (const value of malformed) {
    let reads = 0
    assert.equal((await compose([manifest('sample/world', value)], async () => { reads++ }))
      .refusal?.rule, 'world-instances-invalid')
    assert.equal(reads, 0)
  }
  for (const ids of [['beta', 'alpha'], ['alpha', 'alpha']]) {
    const value = selection(); value.instances.forEach((row, i) => { row.id = ids[i] })
    assert.equal((await compose([manifest('sample/world', value)])).refusal?.rule, 'world-instances-order')
  }
  for (const key of ['packageId', 'path']) {
    const value = selection(); value.instances[0][key] = key === 'packageId' ? 'missing/world' : 'missing.uvw.json'
    let reads = 0
    assert.equal((await compose([manifest('sample/world', value)], async () => { reads++ }))
      .refusal?.rule, 'world-instance-target')
    assert.equal(reads, 0)
  }
  const ambiguous = manifest('sample/world', selection()); ambiguous.contents.push({ ...ambiguous.contents[0] })
  assert.equal((await compose([ambiguous])).refusal?.rule, 'world-instance-target')
})

test('root selection links different packages with the same local IDs; presets never merge implicitly', async () => {
  const base = manifest('sample/base', selection('sample/base'))
  const root = manifest()
  root.dependencies = [{ id: base.id, range: '1.0.0', rank: 'base' }]
  let reads = 0
  assert.equal((await compose([base, root], async () => { reads++ })).refusal?.rule, 'world-instances-root-required')
  assert.equal(reads, 0)
  root.worldInstances = selection(); root.worldInstances.instances[0].packageId = base.id
  const a = receipt(await compose([base, root]))
  assert.deepEqual((await verifiedCompositionWorldSpaces(a)).spaces.map(s => [s.address, s.packageId]),
    [['alpha/main', 'sample/base'], ['beta/main', 'sample/world']])
  assert.equal(receipt(await compose([root, base])).compositionHash, a.compositionHash)
  base.worldInstances.instances[1].id = 'gamma'
  assert.notEqual(receipt(await compose([root, base])).compositionHash, a.compositionHash)
  delete base.worldInstances; delete root.worldInstances
  const legacy = receipt(await compose([root, base]))
  assert.equal((await verifiedCompositionWorldSpaces(legacy)).refusal?.rule, 'world-instances-required')
  const unused = manifest('unused/world', { broken: true })
  assert.equal(receipt(await compose([manifest(), unused])).compositionHash, receipt(await compose([manifest()])).compositionHash)
})

test('selected worlds require actual verified profile documents and preserve hash integrity', async () => {
  const invalid = structuredClone(world); invalid.connections.push({ type: 'portal' })
  const root = manifest('sample/world', selection())
  root.contents[0].hash = await uvpJsonArtifactDigest('uvw', invalid)
  assert.equal((await compose([root], async () => ({ digest: root.contents[0].hash, document: invalid })))
    .refusal?.rule, 'world-instance-profile')
  assert.equal((await compose([manifest('sample/world', selection())], async () => ({ digest: hash, document: invalid })))
    .refusal?.rule, 'artifact-digest-mismatch')
})

test('instance multiplication refuses beyond the qualified-space budget', async () => {
  const many = { ...world, spaces: Array.from({ length: 1025 }, (_, i) =>
    ({ ...world.spaces[0], id: `space-${String(i).padStart(4, '0')}` })) }
  const root = manifest('sample/world', { schemaVersion: 1, instances: Array.from({ length: 64 }, (_, i) =>
    ({ id: `world-${String(i).padStart(2, '0')}`, packageId: 'sample/world', path: 'world.uvw.json' })) })
  root.contents[0].hash = await uvpJsonArtifactDigest('uvw', many)
  const result = await compose([root], async () => ({ digest: root.contents[0].hash, document: many }))
  assert.equal(result.refusal?.rule, 'world-instance-budget')
})
