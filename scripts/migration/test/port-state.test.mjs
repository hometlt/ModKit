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
  readEvidence,
  requirementsFor,
  stable,
  validateLedgerClaims,
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

test('stable keeps existing default bytes and supports compact canonical JSON', () => {
  const value = { z: [{ y: 2, a: '\n' }], a: { z: false, a: null } }
  const pretty =
    '{\n  "a": {\n    "a": null,\n    "z": false\n  },\n  "z": [\n    {\n      "a": "\\n",\n      "y": 2\n    }\n  ]\n}\n'
  const compact = '{"a":{"a":null,"z":false},"z":[{"a":"\\n","y":2}]}\n'
  assert.equal(stable(value), pretty)
  assert.equal(stable(value, 2), pretty)
  assert.equal(stable(value, 0), compact)
  assert.deepEqual(JSON.parse(compact), JSON.parse(pretty))
})

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

test('archived evidence preserves original bytes and still verifies digests and paths', async t => {
  const { root } = await fixture(t)
  const before = 'accepted proof\n'
  await writeFile(path.join(root, 'proof.txt'), before)
  const reference = { path: 'proof.txt', sha256: hash(before) }
  await writeFile(path.join(root, 'proof.txt'), 'updated proof\n')
  await assert.rejects(readEvidence(root, reference), /evidence digest changed/u)
  await writeFile(path.join(root, 'before.txt'), before)
  const archived = { ...reference, snapshotPath: 'before.txt' }
  assert.equal((await readEvidence(root, archived)).toString(), before)
  await assert.rejects(
    readEvidence(root, { ...archived, snapshotPath: '../before.txt' }),
    /unsafe relative path/u,
  )
  await assert.rejects(
    readEvidence(root, { ...archived, path: '../proof.txt' }),
    /unsafe relative path/u,
  )
  await writeFile(path.join(root, 'before.txt'), 'tampered proof\n')
  await assert.rejects(readEvidence(root, archived), /evidence digest changed/u)
})

test('archiving accepted evidence requires a verified current proof and keeps the ratchet', async t => {
  const state = await acceptedFixture(t)
  const previous = structuredClone(state.ledger)
  const before = await readFile(path.join(state.root, 'receipt.json'))
  await writeFile(path.join(state.root, 'before.json'), before)
  const receipt = JSON.parse(before)
  receipt.inputs.revision = 'updated'
  const after = stable(receipt)
  await writeFile(path.join(state.root, 'receipt.json'), after)
  const archived = { ...previous.protectedEvidence[0], snapshotPath: 'before.json' }
  for (const entry of state.ledger.entries) entry.evidence = [archived]
  state.ledger.protectedEvidence = [archived]
  assert.match(
    (await checkLedger({ ...state, previous })).join('\n'),
    /archived proof needs current evidence/u,
  )
  const current = { path: 'receipt.json', sha256: hash(after) }
  for (const entry of state.ledger.entries) entry.evidence.push(current)
  state.ledger.protectedEvidence.push(current)
  assert.deepEqual(await checkLedger({ ...state, previous }), [])
  await writeFile(path.join(state.root, 'receipt.json'), '{}')
  assert.match((await checkLedger({ ...state, previous })).join('\n'), /evidence digest changed/u)
  await writeFile(path.join(state.root, 'receipt.json'), after)
  for (const entry of state.ledger.entries) entry.evidence = [current]
  state.ledger.protectedEvidence = [current]
  assert.match((await checkLedger({ ...state, previous })).join('\n'), /accepted proof removed/u)
  assert.match(
    (await checkLedger({ ...state, previous })).join('\n'),
    /accepted requirement proof removed/u,
  )
  state.ledger.entries[0].evidence = [{ snapshotPath: 'before.json', sha256: hash(before) }, null]
  assert.match((await checkLedger(state)).join('\n'), /evidence needs a path and sha256/u)
})

test('evidence that moved to another path unchanged is archived with movedTo and keeps the ratchet', async t => {
  const state = await acceptedFixture(t)
  const previous = structuredClone(state.ledger)
  const bytes = await readFile(path.join(state.root, 'receipt.json'))
  await writeFile(path.join(state.root, 'before.json'), bytes)
  await mkdir(path.join(state.root, 'moved'), { recursive: true })
  await writeFile(path.join(state.root, 'moved', 'receipt.json'), bytes)
  await rm(path.join(state.root, 'receipt.json'))
  const archived = { ...previous.protectedEvidence[0], snapshotPath: 'before.json' }
  const moved = { path: 'moved/receipt.json', sha256: hash(bytes) }
  const set = evidence => {
    for (const entry of state.ledger.entries) entry.evidence = structuredClone(evidence)
    state.ledger.protectedEvidence = structuredClone(evidence)
  }
  // Without movedTo the archive still asks for the old path.
  set([archived, moved])
  assert.match(
    (await checkLedger({ ...state, previous })).join('\n'),
    /archived proof needs current evidence/u,
  )
  set([{ ...archived, movedTo: 'moved/receipt.json' }, moved])
  assert.deepEqual(await checkLedger({ ...state, previous }), [])
  // A move keeps the bytes: different bytes at the new path are not the same proof.
  await writeFile(path.join(state.root, 'moved', 'receipt.json'), '{}')
  set([
    { ...archived, movedTo: 'moved/receipt.json' },
    { path: 'moved/receipt.json', sha256: hash('{}') },
  ])
  assert.match(
    (await checkLedger({ ...state, previous })).join('\n'),
    /archived proof needs current evidence/u,
  )
})

test('publication identity survives an isolated repository snapshot path', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'modkit-publication-workspace-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const snapshot = path.join(workspace, '.tmp', 'blizzard-snapshot')
  await mkdir(snapshot, { recursive: true })
  await writeFile(
    path.join(snapshot, 'package.json'),
    stable({ modkit: { contributionManifests: ['codec.json'] } }),
  )
  await writeFile(
    path.join(snapshot, 'codec.json'),
    stable({ contract: { id: 'modkit/codec-contribution' }, id: 'blizzard/sample' }),
  )

  const publications = await discoverPublications(
    [
      {
        id: 'blizzard',
        directory: snapshot,
        workspaceRelativeRoot: 'modkit-extensions-blizzard',
      },
    ],
    workspace,
  )
  assert.equal(publications[0].workspacePath, 'modkit-extensions-blizzard/codec.json')
})

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

test('explicit claims close only selected evidence-backed requirements and retain global pending', async t => {
  const state = await acceptedFixture(t)
  const operation = requirements.find(row => row.kind === 'operation')
  const feature = state.ledger.entries.find(row => row.id !== operation.id)
  feature.status = 'pending'
  feature.evidence = []
  const claims = { schemaVersion: 1, codec: 'sample', requirementIds: [operation.id] }
  const before = stable({ ledger: state.ledger, operationMap: state.operationMap, claims })
  assert.deepEqual(await checkLedger({ ...state, claims }), [])
  assert.deepEqual(await checkLedger({ ...state, closure: 'sample' }), [`pending: ${feature.id}`])
  assert.deepEqual(await checkLedger({ ...state, closure: 'sc2' }), [`pending: ${feature.id}`])
  assert.deepEqual(await checkLedger({ ...state, closure: 'all' }), [`pending: ${feature.id}`])
  assert.equal(stable({ ledger: state.ledger, operationMap: state.operationMap, claims }), before)
})

test('selected pending requirements fail even when all unselected requirements remain pending', async t => {
  const state = await fixture(t)
  const id = requirements[0].id
  assert.deepEqual(
    await checkLedger({
      ...state,
      claims: { schemaVersion: 1, codec: 'sample', requirementIds: [id] },
    }),
    [`pending: ${id}`],
  )
})

for (const [label, claims, pattern] of [
  ['null scope', null, /invalid claims schema/u],
  ['array scope', [], /invalid claims schema/u],
  [
    'wrong schema version',
    { schemaVersion: 2, codec: 'sample', requirementIds: [requirements[0].id] },
    /invalid claims schema/u,
  ],
  [
    'unknown schema property',
    { schemaVersion: 1, codec: 'sample', requirementIds: [requirements[0].id], requiremntIds: [] },
    /invalid claims schema/u,
  ],
  [
    'empty codec',
    { schemaVersion: 1, codec: ' ', requirementIds: [requirements[0].id] },
    /unknown or empty claims codec/u,
  ],
  [
    'unknown codec',
    { schemaVersion: 1, codec: 'typo', requirementIds: [requirements[0].id] },
    /unknown or empty claims codec/u,
  ],
  [
    'missing requirements',
    { schemaVersion: 1, codec: 'sample' },
    /empty or invalid claims requirementIds/u,
  ],
  [
    'empty requirements',
    { schemaVersion: 1, codec: 'sample', requirementIds: [] },
    /empty or invalid claims requirementIds/u,
  ],
  [
    'non-array requirements',
    { schemaVersion: 1, codec: 'sample', requirementIds: requirements[0].id },
    /empty or invalid claims requirementIds/u,
  ],
  [
    'empty requirement ID',
    { schemaVersion: 1, codec: 'sample', requirementIds: [' '] },
    /invalid claims requirement ID/u,
  ],
  [
    'non-string requirement ID',
    { schemaVersion: 1, codec: 'sample', requirementIds: [1] },
    /invalid claims requirement ID/u,
  ],
  [
    'unknown or stale requirement',
    { schemaVersion: 1, codec: 'sample', requirementIds: ['legacy/codec/sample/feature/stale'] },
    /unknown or stale claims requirement/u,
  ],
  [
    'duplicate requirement',
    { schemaVersion: 1, codec: 'sample', requirementIds: [requirements[0].id, requirements[0].id] },
    /duplicate claims requirement/u,
  ],
]) {
  test(`explicit claims reject ${label}`, async t => {
    const state = await fixture(t)
    assert.match((await checkLedger({ ...state, claims })).join('\n'), pattern)
  })
}

test('claims cannot select a real requirement owned by another codec', async t => {
  const state = await fixture(t)
  const foreign = {
    ...requirements[0],
    id: 'legacy/codec/other/feature/actual',
    codec: 'other',
    kind: 'feature',
  }
  state.requirements = [...requirements, foreign]
  state.ledger.entries.push({ id: foreign.id, status: 'pending', evidence: [] })
  assert.deepEqual(await checkLedger(state), [])
  assert.match(
    (
      await checkLedger({
        ...state,
        claims: { schemaVersion: 1, codec: 'sample', requirementIds: [foreign.id] },
      })
    ).join('\n'),
    /claims requirement belongs to another codec/u,
  )
})

test('claims and full closure cannot be combined through the library API', async t => {
  const state = await acceptedFixture(t)
  const claims = { schemaVersion: 1, codec: 'sample', requirementIds: [requirements[0].id] }
  assert.deepEqual(await checkLedger({ ...state, claims, closure: 'sample' }), [
    'claims and closure are mutually exclusive',
  ])
  assert.deepEqual([...validateLedgerClaims(claims, requirements)], [requirements[0].id])
})

test('a malformed proof outside the selected claims still fails global integrity', async t => {
  const state = await acceptedFixture(t)
  const operation = requirements.find(row => row.kind === 'operation')
  const feature = requirements.find(row => row.kind === 'feature')
  const claims = { schemaVersion: 1, codec: 'sample', requirementIds: [feature.id] }
  const receipt = JSON.parse(await readFile(path.join(state.root, 'receipt.json'), 'utf8'))
  receipt.proofs.find(proof => proof.requirement === operation.id).executed = false
  const bytes = stable(receipt)
  await writeFile(path.join(state.root, 'receipt.json'), bytes)
  for (const entry of state.ledger.entries) entry.evidence[0].sha256 = hash(bytes)
  assert.deepEqual(await checkLedger({ ...state, claims }), [
    `${operation.id}: operation execution proof missing: ${operation.id}`,
  ])
})

test('claims retain global mapping, entry and accepted-evidence protection', async t => {
  const state = await acceptedFixture(t)
  const previous = structuredClone(state.ledger)
  const feature = requirements.find(row => row.kind === 'feature')
  const operation = state.operationMap.entries[0]
  const claims = { schemaVersion: 1, codec: 'sample', requirementIds: [feature.id] }
  state.ledger.entries = state.ledger.entries.filter(row => row.id === feature.id)
  state.operationMap.entries = []
  state.ledger.protectedEvidence = []
  const problems = await checkLedger({ ...state, previous, claims })
  assert.ok(problems.includes(`missing ledger entry: ${operation.id}`))
  assert.ok(problems.includes(`accepted requirement removed: ${operation.id}`))
  assert.ok(problems.includes(`accepted requirement proof removed: ${operation.id}`))
  assert.ok(problems.includes('accepted proof removed: receipt.json'))
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
  // an acceptance run's copy of the whole root is output, not a second contribution
  const copy = path.join(root, 'artifacts', 'run-1', 'extension')
  await mkdir(path.join(copy, 'contributions'), { recursive: true })
  for (const file of ['package.json', 'contributions/codec.json'])
    await writeFile(
      path.join(copy, file),
      await readFile(path.join(root, 'extension', file), 'utf8'),
    )
  const found = await discoverContributions([{ id: 'fixture', directory: root }])
  assert.equal(found.length, 1)
  assert.deepEqual(found[0].formats, ['sample'])
  assert.throws(() => requirementsFor({ units: [] }, {}, []), /empty/u)
})

test('superseded rows need a hashed owner decision and hashed MK3 evidence', async t => {
  const state = await fixture(t)
  const bytes = stable({ decision: 'MK3 is the reference' })
  await writeFile(path.join(state.root, 'decision.json'), bytes)
  const reference = { path: 'decision.json', sha256: hash(bytes) }
  const feature = requirements.find(row => row.kind === 'feature')
  const entry = state.ledger.entries.find(row => row.id === feature.id)
  Object.assign(entry, { status: 'superseded', evidence: [] })
  entry.decision = { approvedBy: 'owner', date: '2026-09-17', reason: 'superseded', ...reference }
  assert.match((await checkLedger(state)).join('\n'), /superseded without MK3 evidence/u)
  entry.evidence = [reference]
  assert.deepEqual(await checkLedger(state), [])
  entry.evidence = [{ ...reference, sha256: hash('{}') }]
  assert.match((await checkLedger(state)).join('\n'), /digest changed/u)
})

test('a read replaced by a data source is proven against the published data source', async t => {
  const state = await acceptedFixture(t)
  const receipt = JSON.parse(await readFile(path.join(state.root, 'receipt.json')))
  const target = { contract: 'common.view/raster-image-source', major: 1 }
  for (const proof of receipt.proofs)
    if (proof.kind === 'operation') {
      delete proof.targetOperation
      delete proof.handlerId
      proof.targetDataSource = target
    }
  const bytes = stable(receipt)
  await writeFile(path.join(state.root, 'receipt.json'), bytes)
  for (const entry of state.ledger.entries) entry.evidence[0].sha256 = hash(bytes)
  state.ledger.protectedEvidence = [{ path: 'receipt.json', sha256: hash(bytes) }]
  for (const row of state.operationMap.entries)
    Object.assign(row, { targetOperation: null, handlerId: null, targetDataSource: target })
  const manifest = publishesDataSources =>
    writeFile(
      path.join(state.root, 'codec.json'),
      stable({
        contract: { id: 'modkit/codec-contribution' },
        spec: { operations: [], publishesDataSources },
      }),
    )
  await manifest([target])
  assert.deepEqual(await checkLedger(state), [])
  await manifest([{ contract: 'common.view/raster-image-source', major: 2 }])
  assert.match((await checkLedger(state)).join('\n'), /published data source absent/u)
  await manifest([target])
  state.operationMap.entries[0].targetDataSource = { ...target, major: 2 }
  assert.match((await checkLedger(state)).join('\n'), /operation target mismatch/u)
})

test('a write replaced by a writer offer is proven against the published provider', async t => {
  const state = await acceptedFixture(t)
  const receipt = JSON.parse(await readFile(path.join(state.root, 'receipt.json')))
  const target = { contract: 'common.edit/writer', major: 1, offerId: 'fixture-encoder' }
  for (const proof of receipt.proofs)
    if (proof.kind === 'operation') {
      delete proof.targetOperation
      delete proof.handlerId
      proof.targetWriter = target
    }
  const bytes = stable(receipt)
  await writeFile(path.join(state.root, 'receipt.json'), bytes)
  for (const entry of state.ledger.entries) entry.evidence[0].sha256 = hash(bytes)
  state.ledger.protectedEvidence = [{ path: 'receipt.json', sha256: hash(bytes) }]
  for (const row of state.operationMap.entries)
    Object.assign(row, { targetOperation: null, handlerId: null, targetWriter: target })
  const provider = offers =>
    writeFile(
      path.join(state.root, 'codec.json'),
      stable({
        contract: { id: 'modkit/service-provider-contribution' },
        spec: { provides: offers },
      }),
    )
  await provider([{ offerId: 'fixture-encoder', contract: 'common.edit/writer', major: 1 }])
  // a service provider manifest is a publication too, as discovery sees it on disk
  state.publications = await discoverPublications(
    [{ id: 'fixture', directory: state.root }],
    state.root,
  )
  assert.ok(state.publications.some(item => item.workspacePath === 'codec.json'))
  assert.deepEqual(await checkLedger(state), [])
  await provider([{ offerId: 'other-encoder', contract: 'common.edit/writer', major: 1 }])
  assert.match((await checkLedger(state)).join('\n'), /published writer offer absent/u)
  await provider([{ offerId: 'fixture-encoder', contract: 'common.edit/writer', major: 1 }])
  state.operationMap.entries[0].targetWriter = { ...target, offerId: 'other-encoder' }
  assert.match((await checkLedger(state)).join('\n'), /operation target mismatch/u)
})
