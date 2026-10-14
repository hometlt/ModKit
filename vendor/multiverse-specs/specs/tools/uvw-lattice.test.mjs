/** Normative lattice artifact tests. Core codec/source and native/PNG acceptance remain separate. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile, createUvwGltfDocument, restoreUvwProfileDocument } from './uvw-profile.mjs'
import { assertUvwLattice } from './uvw-lattice.ts'
import { jcsBytes, uvpJsonArtifactDigest } from './uv-canonical-form.mjs'

const fixture = JSON.parse(await readFile(new URL('../world/fixtures/uvw-lattice.uvw.json', import.meta.url), 'utf8'))
const objects = world => world.spaces[0].layers.find(layer => layer.kind === 'objects').instances
const ground = world => world.spaces[0].layers.find(layer => layer.kind === 'heightfield')
const known = world => objects(world).find(instance => instance.id === 'known').latticeCoverage
const decode = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))

test('standalone normative bytes preserve roles, absolute footprints and unknown versus known-empty', async () => {
  assert.equal(assertUvwProfile(fixture), fixture)
  const bytes = jcsBytes(fixture), reopened = decode(bytes)
  assert.equal(bytes.length, 1408)
  assert.equal(await uvpJsonArtifactDigest('uvw', fixture), 'sha256:667268a8053c6df003a4475cace024241add17ae587c0939be7ac44a745ba18e')
  assertUvwProfile(reopened)
  assert.deepEqual(jcsBytes(reopened), bytes)
  assert.deepEqual(known(reopened), known(fixture))
  assert.deepEqual(known(reopened).noBuild, [])
  assert.equal(Object.hasOwn(known(reopened), 'vision'), false)
  assert.equal(known(reopened).blocked[0][0].x, -0.25) // No clipping against the map bounds.
  assert.equal(Object.hasOwn(objects(reopened).find(row => row.id === 'unknown'), 'latticeCoverage'), false)
  assert.deepEqual(objects(reopened).find(row => row.id === 'empty').latticeCoverage, { roles: [], blocked: [] })
  assert.equal(await uvpJsonArtifactDigest('uvw', reopened), await uvpJsonArtifactDigest('uvw', fixture))
})

test('spatial to glTF and back uses one annotation shape and exact cell/frame coordinates', async () => {
  const gltf = createUvwGltfDocument(fixture)
  assertUvwProfile(gltf)
  assert.equal(await uvpJsonArtifactDigest('uvw', gltf), 'sha256:f108d2a719e75e0d42065b142ecb813974d4803bf604f07ee3245e8b0afc76e7')
  const reopened = restoreUvwProfileDocument(decode(jcsBytes(gltf)))
  assert.deepEqual(reopened, fixture)
  assert.deepEqual(ground(reopened).cliffFaces, [{ x: 2, y: 0 }, { x: 0, y: 1 }])
  assert.equal(await uvpJsonArtifactDigest('uvw', reopened), await uvpJsonArtifactDigest('uvw', fixture))
})

test('artifact hashes depend on annotations, while JSON property spelling order does not', async () => {
  const moved = structuredClone(fixture)
  known(moved).blocked[0][0].x = -0.5
  assertUvwProfile(moved)
  assert.notEqual(await uvpJsonArtifactDigest('uvw', moved), await uvpJsonArtifactDigest('uvw', fixture))
  const changed = structuredClone(fixture)
  known(changed).roles = ['resource']
  assertUvwProfile(changed)
  assert.notEqual(await uvpJsonArtifactDigest('uvw', changed), await uvpJsonArtifactDigest('uvw', fixture))
  const reordered = structuredClone(fixture)
  const original = known(reordered)
  objects(reordered).find(instance => instance.id === 'known').latticeCoverage =
    Object.fromEntries(Object.entries(original).reverse())
  assert.equal(await uvpJsonArtifactDigest('uvw', reordered), await uvpJsonArtifactDigest('uvw', fixture))
})

test('complete empty cliff classification differs from unknown, without deriving from terrain height', () => {
  const empty = structuredClone(fixture); ground(empty).cliffFaces = []
  assertUvwProfile(empty)
  const reopened = decode(jcsBytes(empty)); assertUvwProfile(reopened)
  assert.deepEqual(ground(reopened).cliffFaces, [])
  const unknown = structuredClone(empty); delete ground(unknown).cliffFaces
  assertUvwProfile(unknown)
  assert.equal(Object.hasOwn(ground(decode(jcsBytes(unknown))), 'cliffFaces'), false)
  assert.deepEqual(ground(empty).samples, ground(unknown).samples)
})

test('resource labels retain explicit namespace, case and Unicode without game-specific interpretation', () => {
  const world = structuredClone(fixture)
  known(world).resourceKindScope = 'example/namespace'
  known(world).resourceKind = 'Fuel Ω 🌍'
  assertUvwProfile(world)
  assert.deepEqual(known(decode(jcsBytes(world))), known(world))
  for (const change of [
    value => { delete value.resourceKindScope },
    value => { delete value.resourceKind },
    value => { value.resourceKindScope = '' },
    value => { value.resourceKind = ' trailing ' },
    value => { value.resourceKindScope = 'bad\u0000scope' },
  ]) {
    const invalid = structuredClone(world); change(known(invalid))
    assert.throws(() => assertUvwProfile(invalid), error => error.rule === 'uvw-lattice-resource-scope')
  }
})

test('unknown fields, malformed polygons and invalid roles refuse rather than silently disappear', () => {
  for (const [rule, change] of [
    ['uvw-lattice-shape', value => { value.nativeType = 'unqualified' }],
    ['uvw-lattice-shape', value => { value.schemaVersion = 2 }],
    ['uvw-lattice-shape', value => { value.blocked[0][0].z = 3 }],
    ['uvw-lattice-polygons', value => { value.blocked = null }],
    ['uvw-lattice-polygons', value => { value.blocked = [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }],
    ['uvw-lattice-polygons', value => { value.blocked[0][0].x = Infinity }],
    ['uvw-lattice-roles', value => { value.roles = ['resource', 'resource'] }],
    ['uvw-lattice-roles', value => { value.roles = ['unknown'] }],
    ['uvw-lattice-roles', value => { value.roles = new Array(1) }],
  ]) {
    const invalid = structuredClone(fixture); change(known(invalid))
    assert.throws(() => assertUvwProfile(invalid), error => error.rule === rule, rule)
  }
})

test('cliff sets refuse duplicates, noncanonical order and sample-versus-cell boundary mistakes', () => {
  for (const [rule, cells] of [
    ['uvw-lattice-cliff-cells', [{ x: 3, y: 0 }]],
    ['uvw-lattice-cliff-cells', [{ x: 0, y: 2 }]],
    ['uvw-lattice-cliff-cells', [{ x: -1, y: 0 }]],
    ['uvw-lattice-cliff-cells', [{ x: 0.5, y: 0 }]],
    ['uvw-lattice-shape', [{ x: 0, y: 0, extra: true }]],
    ['uvw-lattice-cell-order', [{ x: 0, y: 0 }, { x: 0, y: 0 }]],
    ['uvw-lattice-cell-order', [{ x: 0, y: 1 }, { x: 2, y: 0 }]],
  ]) {
    const invalid = structuredClone(fixture); ground(invalid).cliffFaces = cells
    assert.throws(() => assertUvwProfile(invalid), error => error.rule === rule, rule)
  }
})

test('syntactically possible future envelope versions do not authorize current lattice admission', () => {
  const future = structuredClone(fixture); future.uv.version = '1.1'
  assert.throws(() => assertUvwProfile(future), error => error.rule === 'uvw-lattice-profile-version')
})

test('the annotation budget is shared across spaces and checked before iterating oversized vertex arrays', () => {
  const polygon = new Array(1_048_576).fill({ x: 0, y: 0 })
  assert.throws(() => assertUvwLattice([{ layers: [{ kind: 'objects',
    instances: [{ latticeCoverage: { blocked: [polygon] } }] }] }], '1.0'),
  error => error.rule === 'uvw-lattice-budget')
  const space = { layers: [{ kind: 'heightfield', columns: 1_048_577, rows: 2,
    cliffFaces: Array.from({ length: 524_288 }, (_, x) => ({ x, y: 0 })) }] }
  assert.throws(() => assertUvwLattice([space, space], '1.0'), error => error.rule === 'uvw-lattice-budget')
})

test('legacy fixtures without annotations retain their existing canonical bytes and digests', async () => {
  const legacy = JSON.parse(await readFile(new URL('../world/fixtures/uvw-profile-single-space.uvw.json', import.meta.url), 'utf8'))
  const bytes = jcsBytes(legacy), digest = await uvpJsonArtifactDigest('uvw', legacy)
  assertUvwProfile(legacy)
  assert.deepEqual(jcsBytes(restoreUvwProfileDocument(createUvwGltfDocument(legacy))), bytes)
  assert.equal(await uvpJsonArtifactDigest('uvw', decode(bytes)), digest)
})
