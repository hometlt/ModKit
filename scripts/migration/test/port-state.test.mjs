import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  checkLedger,
  discoverContributions,
  discoverPublications,
  hash,
  initialState,
  requirementsFor,
  stable,
} from '../lib/port-state.mjs'

const inventory = {
  units: [
    {
      kind: 'codec-manifest',
      sourceUnitId: 'legacy/codec/sample',
      extracted: { id: 'sample', operations: ['edit.content'] },
    },
  ],
}
const audits = {
  sample: { mk2Features: [{ feature: 'preserving edit', fileRefs: ['src/edit.ts'] }] },
}
const requirements = requirementsFor(inventory, audits, [])

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-port-ledger-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ledger = initialState(requirements)
  const operationMap = {
    schemaVersion: 1,
    entries: requirements
      .filter(row => row.kind === 'operation')
      .map(row => ({ id: row.id, status: 'pending' })),
  }
  return { root, requirements, ledger, operationMap }
}

async function acceptedFixture(t) {
  const state = await fixture(t)
  const receipt = {
    schemaVersion: 1,
    codec: 'sample',
    inputs: { operation: 'transform' },
    cases: [
      { id: 'positive', verdict: 'identical' },
      { id: 'zero', verdict: 'identical' },
    ],
    verdict: 'pass',
    corpusKind: 'synthetic',
    tests: { passed: 2, failed: 0 },
    proofs: requirements.map(row => ({
      requirement: row.id,
      kind: row.kind,
      adapterOperation: 'transform',
      caseIds: ['positive', 'zero'],
      ...(row.kind === 'operation'
        ? {
            legacyOperation: row.label,
            targetOperation: 'edit.field',
            handlerId: 'editField',
            executed: true,
          }
        : {}),
    })),
  }
  const bytes = stable(receipt)
  await writeFile(path.join(state.root, 'receipt.json'), bytes)
  const evidence = { path: 'receipt.json', sha256: hash(bytes) }
  for (const row of state.ledger.entries) {
    row.status = 'adapted'
    row.evidence = [evidence]
  }
  for (const row of state.operationMap.entries)
    Object.assign(row, {
      status: 'adapted',
      targetOperation: 'edit.field',
      handlerId: 'editField',
      contribution: 'codec.json',
    })
  await writeFile(
    path.join(state.root, 'codec.json'),
    stable({
      contract: { id: 'modkit/codec-contribution' },
      spec: { operations: [{ id: 'edit.field', handlerId: 'editField' }] },
    }),
  )
  await writeFile(
    path.join(state.root, 'package.json'),
    stable({
      modkit: { contributionManifests: ['codec.json'] },
    }),
  )
  state.publications = await discoverPublications(
    [{ id: 'fixture', directory: state.root }],
    state.root,
  )
  state.ledger.protectedEvidence = [evidence]
  return state
}

test('pending ledger passes integrity but fails requested family closure', async t => {
  const state = await fixture(t)
  assert.deepEqual(await checkLedger(state), [])
  assert.equal((await checkLedger({ ...state, closure: 'sc2' })).length, requirements.length)
  assert.match(
    (await checkLedger({ ...state, closure: 'typo' })).join('\n'),
    /unknown or empty closure/u,
  )
})

test('SC2 family closure includes its shared MPQ and CASC consumers', () => {
  const archiveInventory = {
    units: ['mpq', 'casc'].map(id => ({
      kind: 'codec-manifest',
      sourceUnitId: `legacy/codec/${id}`,
      extracted: { id, operations: ['archive.extract'] },
    })),
  }
  const rows = requirementsFor(archiveInventory, {}, [])
  assert.equal(rows.length, 4)
  assert.ok(rows.every(row => row.family === 'sc2'))
  assert.equal(rows.filter(row => row.kind === 'audit').length, 2)
})

test('nonempty executed mapped operation and feature proof close the exact fixture scope', async t => {
  const state = await acceptedFixture(t)
  assert.deepEqual(await checkLedger({ ...state, closure: 'sample' }), [])
})

test('missing feature, missing operation, empty ledger and duplicate rows fail', async t => {
  for (const mutate of [
    state => state.ledger.entries.pop(),
    state => {
      state.operationMap.entries = []
    },
    state => {
      state.ledger.entries = []
    },
    state => state.ledger.entries.push(structuredClone(state.ledger.entries[0])),
  ]) {
    const state = await fixture(t)
    mutate(state)
    assert.ok((await checkLedger(state)).length)
  }
})

test('missing, altered or empty receipts cannot carry accepted evidence', async t => {
  const state = await acceptedFixture(t)
  await writeFile(path.join(state.root, 'receipt.json'), '{}')
  assert.match((await checkLedger(state)).join('\n'), /digest changed/u)
  for (const entry of state.ledger.entries) entry.evidence[0].sha256 = hash('{}')
  assert.match((await checkLedger(state)).join('\n'), /non-passing\/empty/u)
  await rm(path.join(state.root, 'receipt.json'))
  assert.ok((await checkLedger(state)).length)
})

test('accepted claims and protected proof cannot disappear from a later ledger', async t => {
  const state = await acceptedFixture(t)
  const previous = structuredClone(state.ledger)
  state.ledger.protectedEvidence = []
  state.ledger.entries[0].status = 'pending'
  state.ledger.entries[0].evidence = []
  const problems = await checkLedger({ ...state, previous })
  assert.ok(problems.some(row => row.startsWith('accepted proof removed')))
  assert.ok(problems.some(row => row.startsWith('accepted requirement removed')))
})

test('operation alias requires the actual published handler and evidence execution', async t => {
  const state = await acceptedFixture(t)
  await writeFile(
    path.join(state.root, 'codec.json'),
    stable({ contract: { id: 'modkit/codec-contribution' }, spec: { operations: [] } }),
  )
  assert.match((await checkLedger(state)).join('\n'), /published operation absent/u)
  state.operationMap.entries[0].handlerId = 'fake'
  assert.match((await checkLedger(state)).join('\n'), /operation target mismatch/u)
})

test('a detached manifest and unrelated execution cannot close published operation claims', async t => {
  const state = await acceptedFixture(t)
  await writeFile(
    path.join(state.root, 'fake.json'),
    await readFile(path.join(state.root, 'codec.json')),
  )
  state.operationMap.entries[0].contribution = 'fake.json'
  assert.match((await checkLedger(state)).join('\n'), /not published/u)
  state.operationMap.entries[0].contribution = 'codec.json'
  const receipt = JSON.parse(await readFile(path.join(state.root, 'receipt.json')))
  for (const mutate of [
    value => {
      value.codec = 'unrelated'
    },
    value => {
      value.proofs[0].caseIds = ['unexecuted']
    },
    value => {
      value.proofs[0].adapterOperation = 'different-export'
    },
  ]) {
    const changed = structuredClone(receipt)
    mutate(changed)
    const bytes = stable(changed)
    await writeFile(path.join(state.root, 'receipt.json'), bytes)
    for (const entry of state.ledger.entries) entry.evidence[0].sha256 = hash(bytes)
    assert.match((await checkLedger(state)).join('\n'), /codec mismatch|successful executed cases/u)
  }
})

test('discovery reads authored manifest globs and excludes fixtures and build artifacts', async t => {
  const { root } = await fixture(t)
  await mkdir(path.join(root, 'extension', 'contributions'), { recursive: true })
  await writeFile(
    path.join(root, 'extension', 'package.json'),
    stable({ modkit: { contributionManifests: ['./contributions/*.json'] } }),
  )
  await writeFile(
    path.join(root, 'extension', 'contributions', 'codec.json'),
    stable({
      id: 'example/sample',
      contract: { id: 'modkit/codec-contribution' },
      spec: { formatRefs: [{ formatId: 'sample' }], operations: [] },
    }),
  )
  const found = await discoverContributions([{ id: 'fixture', directory: root }])
  assert.equal(found.length, 1)
  assert.deepEqual(found[0].formats, ['sample'])
  assert.throws(() => requirementsFor({ units: [] }, {}, []), /empty/u)
})
