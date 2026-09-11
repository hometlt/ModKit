import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import {
  scaffoldBrief,
  scaffoldHarness,
  runDifferential,
  applyReceipt,
  validateOracleEvidence,
} from '../lib/port-generators.mjs'
import { discoverPublications, initialState, hash, stable, readEvidence } from '../lib/port-state.mjs'
import { MK2_PIN, digestManifest } from '../lib/legacy-oracle.mjs'

const requirements = [
  {
    id: 'legacy/sample/feature/a',
    codec: 'sample',
    family: 'sc2',
    kind: 'feature',
    label: 'typed value edit',
  },
  {
    id: 'legacy/sample/operation/edit',
    codec: 'sample',
    family: 'sc2',
    kind: 'operation',
    label: 'edit.content',
  },
]
const cases = [
  { id: 'positive', input: 2 },
  { id: 'zero', input: 0 },
]

test('real oracle evidence binds source, loader, dependencies and the executed corpus', () => {
  const corpus = { kind: 'real', cases }
  assert.throws(() => validateOracleEvidence({}, corpus), /incomplete/u)
  const source = [{ path: 'source.ts', sha256: 'source' }]
  const loader = [{ path: 'loader.mjs', sha256: 'loader' }]
  const dependencies = []
  const evidence = {
    oracleCommit: MK2_PIN,
    source,
    loader,
    dependencies,
    sourceClosureDigest: digestManifest(source),
    loaderDigest: digestManifest(loader),
    dependenciesDigest: digestManifest(dependencies),
    corpusDigest: digestManifest(corpus),
  }
  assert.doesNotThrow(() => validateOracleEvidence(evidence, corpus))
  assert.throws(
    () => validateOracleEvidence(evidence, { ...corpus, cases: cases.slice(1) }),
    /corpus differs/u,
  )
  assert.throws(
    () => validateOracleEvidence({ ...evidence, source: [{ path: 'changed.ts' }] }, corpus),
    /digest mismatch/u,
  )
})

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-port-generator-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('briefs retain every obligation and refuse empty or unknown scopes', () => {
  const text = scaffoldBrief({
    codec: 'sample',
    requirements,
    audit: { mk2Path: 'pinned/src' },
    sourceCommit: 'pinned',
  })
  for (const row of requirements) assert.ok(text.includes(row.id))
  assert.throws(() => scaffoldBrief({ codec: 'missing', requirements }), /unknown or empty/u)
  assert.throws(
    () =>
      scaffoldHarness({
        codec: 'campaign',
        requirements: [{ codec: 'campaign', id: 'authored/campaign/create' }],
        libraryUrl: './runtime.mjs',
      }),
    /no MK2/u,
  )
})

test('generated harness actually executes two adapters and rejects missing adapters/cases', async t => {
  const root = await temporary(t)
  const harness = path.join(root, 'parity.mjs')
  await writeFile(
    harness,
    scaffoldHarness({
      codec: 'sample',
      requirements,
      libraryUrl: new URL('../lib/port-generators.mjs', import.meta.url).href,
    }),
  )
  await writeFile(
    path.join(root, 'old.mjs'),
    'export const transform = value => ({ doubled: value * 2 })\n',
  )
  await writeFile(
    path.join(root, 'new.mjs'),
    'export const transform = value => ({ doubled: value * 2 })\n',
  )
  await writeFile(path.join(root, 'corpus.json'), stable({ kind: 'synthetic', cases }))
  const receipt = path.join(root, 'receipt.json')
  const args = [
    harness,
    '--legacy',
    path.join(root, 'old.mjs'),
    '--migrated',
    path.join(root, 'new.mjs'),
    '--corpus',
    path.join(root, 'corpus.json'),
    '--receipt',
    receipt,
    '--operation',
    'transform',
  ]
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0)
  assert.equal(JSON.parse(await readFile(receipt)).counts.identical, 2)
  await writeFile(
    path.join(root, 'new.mjs'),
    'export const transform = value => ({ doubled: value * 3 })\n',
  )
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 1)
  assert.equal(JSON.parse(await readFile(receipt)).counts.differing, 1)
  assert.notEqual(spawnSync(process.execPath, [harness], { encoding: 'utf8' }).status, 0)
  await assert.rejects(
    runDifferential({
      legacy: value => value,
      migrated: value => value,
      cases: [],
      corpusKind: 'synthetic',
    }),
    /empty corpus/u,
  )
})

test('both-refused does not prove an implementation and special values cannot collapse', async () => {
  const refuse = () => {
    throw new Error('unsupported')
  }
  const failed = await runDifferential({
    legacy: refuse,
    migrated: refuse,
    cases,
    corpusKind: 'synthetic',
  })
  assert.equal(failed.verdict, 'fail')
  assert.equal(failed.counts.bothRefused, 2)
  const different = await runDifferential({
    legacy: () => Number.NaN,
    migrated: () => null,
    cases,
    corpusKind: 'synthetic',
  })
  assert.equal(different.counts.differing, 2)
  const taggedObject = await runDifferential({
    legacy: () => undefined,
    migrated: () => ({ $type: 'undefined' }),
    cases,
    corpusKind: 'synthetic',
  })
  assert.equal(taggedObject.counts.differing, 2)
  await assert.rejects(
    runDifferential({
      legacy: () => new Date(0),
      migrated: () => new Date(0),
      cases,
      corpusKind: 'synthetic',
    }),
    /normalize class instances/u,
  )
})

test('evidence application preserves input and accepts only executed, published operation proofs', async t => {
  const root = await temporary(t)
  const ledger = initialState(requirements)
  const operationMap = {
    schemaVersion: 1,
    entries: [{ id: requirements[1].id, status: 'pending' }],
  }
  const proofs = [
    {
      requirement: requirements[0].id,
      kind: 'feature',
      adapterOperation: 'transform',
      caseIds: ['positive', 'zero'],
    },
    {
      requirement: requirements[1].id,
      kind: 'operation',
      legacyOperation: 'edit.content',
      targetOperation: 'edit.field',
      handlerId: 'editField',
      contribution: 'codec.json',
      executed: true,
      adapterOperation: 'transform',
      caseIds: ['positive', 'zero'],
    },
  ]
  const receipt = await runDifferential({
    codec: 'sample',
    operation: 'transform',
    legacy: value => value * 2,
    migrated: value => value * 2,
    cases,
    corpusKind: 'synthetic',
    proofs,
  })
  await writeFile(path.join(root, 'receipt.json'), stable(receipt))
  await writeFile(
    path.join(root, 'codec.json'),
    stable({
      contract: { id: 'modkit/codec-contribution' },
      spec: { operations: [{ id: 'edit.field', handlerId: 'editField' }] },
    }),
  )
  await writeFile(
    path.join(root, 'package.json'),
    stable({ modkit: { contributionManifests: ['codec.json'] } }),
  )
  const publications = await discoverPublications([{ id: 'fixture', directory: root }], root)
  const result = await applyReceipt({
    root,
    receiptPath: 'receipt.json',
    requirements,
    ledger,
    operationMap,
    publications,
  })
  assert.equal(result.applied, 2)
  assert.equal(result.ledger.entries[0].status, 'adapted')
  assert.equal(
    result.ledger.entries[0].evidence[0].sha256,
    hash(await readFile(path.join(root, 'receipt.json'))),
  )
  assert.equal(ledger.entries[0].status, 'pending')
  receipt.proofs[1].executed = false
  await writeFile(path.join(root, 'receipt.json'), stable(receipt))
  await assert.rejects(
    applyReceipt({
      root,
      receiptPath: 'receipt.json',
      requirements,
      ledger,
      operationMap,
      publications,
    }),
    /execution proof missing/u,
  )
  receipt.proofs = []
  await writeFile(path.join(root, 'receipt.json'), stable(receipt))
  await assert.rejects(
    applyReceipt({
      root,
      receiptPath: 'receipt.json',
      requirements,
      ledger,
      operationMap,
      publications,
    }),
    /no requirement proofs/u,
  )
})

test('configured harness preserves results, verifies migrated state and refuses overwriting inputs', async t => {
  const root = await temporary(t)
  const harness = path.join(root, 'parity.mjs')
  await writeFile(harness, scaffoldHarness({ codec:'sample', requirements, libraryUrl:new URL('../lib/port-generators.mjs', import.meta.url).href }))
  await writeFile(path.join(root, 'old.mjs'), 'export const transform = value => ({ bytes: Uint8Array.of(value), points: Array.from({length:32}, (_,index) => ({position:[value,index,0]})) })\n')
  await writeFile(path.join(root, 'new.mjs'), `import {writeFile} from 'node:fs/promises'
export async function prepareMigrated() { return {
  module: { transform: value => ({ bytes: Uint8Array.of(value), points: Array.from({length:32}, (_,index) => ({position:[value,index,0]})) }) }, evidence: { route:'fixture host' },
  verify: () => writeFile(new URL('verified.txt',import.meta.url),'verified'),
  release: () => writeFile(new URL('released.txt',import.meta.url),'released')
} }`)
  await writeFile(path.join(root, 'corpus.json'), stable({kind:'synthetic',cases}))
  const config = {schemaVersion:1,legacy:'old.mjs',migrated:'new.mjs',corpus:'corpus.json',operation:'transform',receipt:'receipt.json',outputs:'case outputs.json'}
  const configPath = path.join(root,'case config.json')
  await writeFile(configPath,stable(config))
  const run = (...extra) => spawnSync(process.execPath,[harness,'--config',configPath,...extra],{encoding:'utf8'})
  const result = run()
  assert.equal(result.status,0,result.stderr)
  const receipt = JSON.parse(await readFile(path.join(root,'receipt.json')))
  const outputBytes = await readFile(path.join(root,'case outputs.json'))
  assert.equal(hash(outputBytes),receipt.outputs.sha256)
  const parsedOutputs = JSON.parse(outputBytes)
  assert.equal(outputBytes.toString('utf8'), JSON.stringify(parsedOutputs) + '\n')
  assert.ok(outputBytes.length < Buffer.byteLength(stable(parsedOutputs)) / 2,
    'canonical case output should avoid indentation amplification')
  assert.deepEqual(JSON.parse(await readEvidence(root, receipt.outputs)), parsedOutputs)
  await writeFile(path.join(root, 'case outputs.json'), Buffer.concat([outputBytes, Buffer.from(' ')]))
  await assert.rejects(readEvidence(root, receipt.outputs), /evidence digest changed/u)
  await writeFile(path.join(root, 'case outputs.json'), outputBytes)
  assert.equal(receipt.outputs.path,'case outputs.json')
  assert.equal(receipt.migrated.route,'fixture host')
  assert.equal(JSON.parse(outputBytes).cases[0].legacy.value.value.bytes.$type,'Uint8Array')
  assert.equal(await readFile(path.join(root,'verified.txt'),'utf8'),'verified')
  assert.equal(await readFile(path.join(root,'released.txt'),'utf8'),'released')
  assert.notEqual(run('--operation','transform').status,0)
  const inputBefore = await readFile(path.join(root,'old.mjs'),'utf8')
  await writeFile(configPath,stable({...config,outputs:'old.mjs'}))
  assert.notEqual(run().status,0)
  assert.equal(await readFile(path.join(root,'old.mjs'),'utf8'),inputBefore)
  await writeFile(configPath,stable({...config,extraIgnoredFlag:true}))
  assert.notEqual(run().status,0)
})

test('configured parity refuses a corpus mutation during adapter execution', async t => {
  const root = await temporary(t)
  const harness = path.join(root,'parity.mjs')
  await writeFile(harness,scaffoldHarness({codec:'sample',requirements,libraryUrl:new URL('../lib/port-generators.mjs',import.meta.url).href}))
  await writeFile(path.join(root,'old.mjs'),'export const transform = value => value\n')
  await writeFile(path.join(root,'new.mjs'),`import {writeFile} from 'node:fs/promises'
export const transform = async value => { await writeFile(new URL('corpus.json',import.meta.url),'{}'); return value }`)
  await writeFile(path.join(root,'corpus.json'),stable({kind:'synthetic',cases}))
  const configPath = path.join(root,'config.json')
  await writeFile(configPath,stable({schemaVersion:1,legacy:'old.mjs',migrated:'new.mjs',corpus:'corpus.json',operation:'transform',receipt:'receipt.json'}))
  const result = spawnSync(process.execPath,[harness,'--config',configPath],{encoding:'utf8'})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/input changed during execution/u)
  await assert.rejects(readFile(path.join(root,'receipt.json')), {code:'ENOENT'})
})
