import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(evidenceRoot, '..', '..')
const workspaceRoot = path.dirname(coreRoot)
const blizzardRoot = path.join(workspaceRoot, 'modkit-extensions-blizzard')
const mk2Root = path.join(workspaceRoot, 'references', 'modkitmk2')
const reportPath = path.resolve(evidenceRoot, '..', 'PORT_SC2_COMPOSITION_M4_2026-09-05.md')
const reportRepositoryPath = 'reports/PORT_SC2_COMPOSITION_M4_2026-09-05.md'
const evidenceRepositoryPrefix = 'reports/port-sc2-composition-m4/'
const oracleCommit = '1a14ba4eddd0ae88de273348ebd44cfb98a0581d'
const coreImplementationCommit = 'f00179fe93e1d699450f59e6f1bf294c3c0ab75b'
const blizzardImplementationCommit = '31ced1205ad8eabe6ce08defe1a3218ede6de1c3'
const registryLine =
  'migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = bytes => JSON.parse(bytes.toString('utf8'))
const readEvidence = relative => readFile(path.join(evidenceRoot, ...relative.split('/')))
const walk = async (directory, prefix = '') => {
  const rows = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) rows.push(...(await walk(path.join(directory, entry.name), relative)))
    else if (entry.isFile()) rows.push(relative)
    else throw new Error(`unexpected evidence entry type: ${relative}`)
  }
  return rows.sort()
}

const receipt = json(await readEvidence('receipt.json'))
assert.equal(receipt.schemaVersion, 1)
assert.equal(receipt.milestone, 'M4')
assert.equal(receipt.stage, 'composition-ready')
assert.equal(receipt.verdict, 'pass')
assert.equal(receipt.ownerAcceptance, 'pending')
assert.equal(receipt.nextMilestone, 'M5 requires separate owner acceptance of M4')
assert.equal(receipt.oracle.commit, oracleCommit)
assert.equal(receipt.oracle.sourceMode, 'git-object-database')
assert.equal(receipt.oracle.workingTreeObserved, false)

const manifestBytes = await readEvidence('manifest.json')
assert.equal(sha256(manifestBytes), receipt.evidenceManifest.sha256)
const manifest = json(manifestBytes)
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.algorithm, 'sha256')
assert.equal(manifest.files.length, receipt.evidenceManifest.fileCount)
assert.equal(
  manifest.files.reduce((sum, file) => sum + file.bytes, 0),
  receipt.evidenceManifest.totalBytes,
)
const safePath = relative =>
  typeof relative === 'string' &&
  !relative.includes('\\') &&
  !relative.includes(':') &&
  relative.split('/').every(part => part && part !== '.' && part !== '..')
const manifestPaths = new Set()
for (const file of manifest.files) {
  assert.ok(safePath(file.path), `unsafe evidence path: ${file.path}`)
  assert.ok(!manifestPaths.has(file.path), `duplicate evidence path: ${file.path}`)
  assert.notEqual(file.path, 'receipt.json')
  assert.notEqual(file.path, 'manifest.json')
  manifestPaths.add(file.path)
  const bytes = await readEvidence(file.path)
  assert.equal(bytes.length, file.bytes, `evidence byte count: ${file.path}`)
  assert.equal(sha256(bytes), file.sha256, `evidence digest: ${file.path}`)
}
const actualPaths = (await walk(evidenceRoot)).filter(
  relative => relative !== 'receipt.json' && relative !== 'manifest.json',
)
assert.deepEqual([...manifestPaths].sort(), actualPaths, 'evidence manifest completeness')
assert.equal(sha256(await readFile(reportPath)), receipt.report.sha256)

const git = (cwd, args, encoding = 'utf8') =>
  execFileSync('git', args, {
    cwd,
    encoding,
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
  })
const gitShow = (cwd, commit, relative) => git(cwd, ['show', `${commit}:${relative}`], null)
const changedPaths = (cwd, commit) =>
  git(cwd, ['diff', '--name-only', '--no-renames', commit, 'HEAD', '--'])
    .split(/\r?\n/u)
    .filter(Boolean)
const statusRows = cwd =>
  git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).split(/\r?\n/u).filter(Boolean)
const statusPath = row => {
  assert.ok(!/[RC]/u.test(row.slice(0, 2)), `rename/copy status is inadmissible: ${row}`)
  return row.slice(3).replaceAll('\\', '/')
}
const isEvidencePath = relative =>
  relative === reportRepositoryPath || relative.startsWith(evidenceRepositoryPrefix)

assert.equal(receipt.repositories.core.implementationCommit, coreImplementationCommit)
assert.equal(receipt.repositories.blizzard.implementationCommit, blizzardImplementationCommit)
for (const [cwd, commit] of [
  [coreRoot, coreImplementationCommit],
  [blizzardRoot, blizzardImplementationCommit],
  [mk2Root, oracleCommit],
])
  git(cwd, ['cat-file', '-e', `${commit}^{commit}`])
assert.equal(git(coreRoot, ['branch', '--show-current']).trim(), 'sol/port-libs')
assert.equal(git(blizzardRoot, ['branch', '--show-current']).trim(), 'sol/port-sc2')
git(coreRoot, ['merge-base', '--is-ancestor', coreImplementationCommit, 'HEAD'])
assert.ok(changedPaths(coreRoot, coreImplementationCommit).every(isEvidencePath))
for (const row of statusRows(coreRoot))
  assert.ok(isEvidencePath(statusPath(row)), `core execution tree is dirty: ${row}`)
git(blizzardRoot, ['merge-base', '--is-ancestor', blizzardImplementationCommit, 'HEAD'])
assert.deepEqual(changedPaths(blizzardRoot, blizzardImplementationCommit), [])
assert.deepEqual(statusRows(blizzardRoot), [])

const implementation = json(await readEvidence('repositories/implementation.json'))
assert.equal(implementation.repositories.core.implementationCommit, coreImplementationCommit)
assert.equal(implementation.repositories.blizzard.implementationCommit, blizzardImplementationCommit)
assert.deepEqual(
  {
    coreCommits: implementation.repositories.core.commitCount,
    corePaths: implementation.repositories.core.pathCount,
    coreDiff: implementation.repositories.core.diffCheckExitCode,
    blizzardCommits: implementation.repositories.blizzard.commitCount,
    blizzardPaths: implementation.repositories.blizzard.pathCount,
    blizzardDiff: implementation.repositories.blizzard.diffCheckExitCode,
  },
  { coreCommits: 13, corePaths: 56, coreDiff: 0, blizzardCommits: 21, blizzardPaths: 336, blizzardDiff: 0 },
)

for (const [evidencePath, cwd, commit, repositoryPath] of [
  ['inputs/algorithm-owners.json', coreRoot, coreImplementationCommit, 'migration/algorithm-owners.json'],
  ['inputs/algorithms-baseline.json', coreRoot, coreImplementationCommit, 'migration/algorithms-baseline.json'],
  ['inputs/feature-ledger.json', coreRoot, coreImplementationCommit, 'migration/codec-port/feature-ledger.json'],
  ['inputs/operation-map.json', coreRoot, coreImplementationCommit, 'migration/codec-port/operation-map.json'],
  [
    'inputs/archive-m4-provenance.json',
    blizzardRoot,
    blizzardImplementationCommit,
    'starcraft2/src/lib/mk2/compat/archive-m4-provenance.json',
  ],
  [
    'inputs/m4-packed-baseline-oracle.json',
    blizzardRoot,
    blizzardImplementationCommit,
    'starcraft2/test/fixtures/m4-packed-baseline-oracle.json',
  ],
  [
    'inputs/m4-casc-installation-oracle.json',
    blizzardRoot,
    blizzardImplementationCommit,
    'starcraft2/test/fixtures/m4-casc-installation-oracle.json',
  ],
])
  assert.ok((await readEvidence(evidencePath)).equals(gitShow(cwd, commit, repositoryPath)))

for (const suffix of ['map', 'mod', 'campaign', 'replay']) {
  const manifestJson = json(
    gitShow(
      blizzardRoot,
      blizzardImplementationCommit,
      `starcraft2/contributions/codec-sc2-${suffix}.json`,
    ),
  )
  assert.equal(manifestJson.spec.sourceTopology, 'namespace')
  assert.deepEqual(manifestJson.spec.container, { formatId: 'mpq' })
}
const deletedMpqHelper = spawnSync(
  'git',
  ['cat-file', '-e', `${blizzardImplementationCommit}:starcraft2/src/sc2-map/mpq.js`],
  { cwd: blizzardRoot, windowsHide: true },
)
assert.notEqual(deletedMpqHelper.status, 0, 'duplicate SC2 map MPQ helper still exists')

const packedFixture = json(await readEvidence('inputs/m4-packed-baseline-oracle.json'))
assert.equal(packedFixture.oracle.mk2.revision, oracleCommit)
assert.equal(
  packedFixture.expected.cacheKey,
  '857b7347583ead9459975eabdb5e949d24ea0c55c65c7a85219a9204c29f6823',
)
assert.equal(
  packedFixture.expected.resultDigest,
  '161a55eeceaf7009334737ff00ba6af5b8504c447d0599cbf0a59a4893b0f597',
)

const packed = json(await readEvidence('oracles/packed-raw.json'))
assert.equal(packed.schemaVersion, 3)
assert.equal(packed.evidenceKind, 'm4-packed-differential')
assert.equal(packed.verdict, 'pass')
assert.equal(packed.cache.descriptor.pin.mk2Revision, oracleCommit)
assert.equal(packed.cache.key, packedFixture.expected.cacheKey)
assert.equal(packed.resultDigest, packedFixture.expected.resultDigest)
assert.deepEqual(packed.counts, {
  total: 8,
  identical: 8,
  differing: 0,
  mk2Only: 0,
  mk3Only: 0,
  bothRefused: 0,
})
assert.deepEqual(packed.differing, [])
assert.deepEqual(packed.bothRefused, [])
assert.equal(packed.cache.descriptor.pin.sourceAdapters.length, 6)
for (const adapter of packed.cache.descriptor.pin.sourceAdapters) {
  const sourceBytes = gitShow(mk2Root, oracleCommit, adapter.sourcePath)
  assert.equal(sha256(sourceBytes), adapter.sourceSha256)
  assert.equal(
    git(mk2Root, ['rev-parse', `${oracleCommit}:${adapter.sourcePath}`]).trim(),
    adapter.sourceGitBlob,
  )
  const destinationBytes = gitShow(blizzardRoot, blizzardImplementationCommit, adapter.destinationPath)
  assert.equal(sha256(destinationBytes), adapter.destinationSha256)
  assert.equal(
    git(blizzardRoot, ['rev-parse', `${blizzardImplementationCommit}:${adapter.destinationPath}`]).trim(),
    adapter.destinationGitBlob,
  )
}
const vectorDigests = Object.fromEntries(packed.vectors.map(vector => [vector.id, vector.resultDigest]))
assert.deepEqual(vectorDigests, {
  'mpq-writer-cross-direction': '7350cf9dfdbc6bb01eb2b01a144a43126f22117fc441b0de59d89c6761a61f27',
  'mpq-obfuscation-bidirectional': '2fbe78300d431c2735187954875037575642166a344c416fe8fe41e201ac73df',
})
assert.ok(packed.vectors.every(vector => vector.verdict === 'pass'))
const corpus = Object.fromEntries(packed.corpus.map(entry => [entry.logicalId, entry]))
assert.equal(
  corpus['WTE70_Madlibrarian.SC2Map'].resultDigest,
  'ce1a961de77a1a21e22504fd297ddbd23a7396b18f4c97659c250d70e62ad4d7',
)
assert.equal(
  corpus['Persephone.SC2Replay'].resultDigest,
  '40d9d983c9d33e07b09aa999400cdae76f23e36e677fa72573f5d2e506513680',
)
for (const entry of packed.corpus)
  for (const operation of Object.values(entry.operations)) assert.equal(operation.verdict, 'identical')

const casc = json(await readEvidence('oracles/casc-installed-raw.json'))
assert.equal(casc.verdict, 'pass')
assert.deepEqual(casc.counts, {
  total: 1,
  identical: 1,
  differing: 0,
  mk2Only: 0,
  mk3Only: 0,
  bothRefused: 0,
})
assert.equal(
  casc.input.rootDescriptor.entry.path,
  'campaigns/liberty.sc2campaign/base.sc2data/gamedata/unitdata.xml',
)
assert.equal(casc.input.rootDescriptor.entry.bytes, 787142)
assert.equal(
  casc.input.rootDescriptor.entry.sha256,
  '52026354da439891b67b4767f3caa7adb21088382aa61f167ac30f692574b963',
)
assert.equal(casc.resultDigest, '3df77b3d313eef94c88b26d9022eafa797eb403a19a471cf20a2c883a0f5b4b5')
assert.equal(casc.lifecycle.mk2.readerClosed, true)
assert.equal(casc.lifecycle.mk2.physicalSourceCloseCalls, 1)
assert.equal(casc.lifecycle.mk3.namespaceReleased, true)
assert.equal(casc.lifecycle.mk3.sessionDisposed, true)
assert.equal(casc.lifecycle.mk3.vfsDisposed, true)

const publicPackBytes = await readEvidence('oracles/mpq-public-pack-raw.json')
const publicPack = json(publicPackBytes)
assert.equal(publicPack.verdict, 'pass')
assert.equal(publicPack.oracleComparison, 'matched')
assert.equal(publicPack.publicOperation.id, 'container.pack')
assert.equal(publicPack.publicOperation.handlerId, 'pack-container')
assert.equal(publicPack.caseIds.length, 2)
assert.equal(publicPack.resultDigest, 'afd94445e1f7bb16fe85edcabe77e46e1202439370c5301d704a2f43054f7ce8')

const saveAs = json(await readEvidence('oracles/wte70-save-as-raw.json'))
assert.equal(saveAs.verdict, 'pass')
assert.equal(saveAs.phases.length, 25)
assert.ok(saveAs.phases.every(phase => phase.verdict === 'pass'))
assert.equal(saveAs.nativeExport.unchanged.entries, 31)
assert.equal(saveAs.nativeExport.unchanged.guarantee, 'raw-payload-flags-and-method-byte-identical')
assert.equal(saveAs.reopened.semantic.contributionId, 'blizzard/sc2-map')
assert.equal(saveAs.reopened.semantic.summaryMatchesSource, true)
assert.equal(saveAs.reopened.codec.contributionId, 'blizzard/mpq')
assert.equal(saveAs.sourceUnchanged.matchesOriginal, true)
assert.equal(saveAs.undo.removedDestination, true)

const receiptExpectations = [
  ['casc-archive.extract.json', 'legacy/codec-manifest/modkit/casc/operation/archive.extract', 'container.extract', 'extract-entry'],
  ['mpq-archive.extract.json', 'legacy/codec-manifest/modkit/mpq/operation/archive.extract', 'container.extract', 'extract-entry'],
  ['mpq-archive.inspect.json', 'legacy/codec-manifest/modkit/mpq/operation/archive.inspect', 'view.inspect', 'inspect'],
  ['mpq-archive.write.json', 'legacy/codec-manifest/modkit/mpq/operation/archive.write', 'container.pack', 'pack-container'],
]
const featureLedger = json(await readEvidence('inputs/feature-ledger.json'))
const operationMap = json(await readEvidence('inputs/operation-map.json'))
for (const [filename, requirement, targetOperation, handlerId] of receiptExpectations) {
  const relative = `receipts/${filename}`
  const bytes = await readEvidence(relative)
  const operationReceipt = json(bytes)
  assert.equal(operationReceipt.verdict, 'pass')
  assert.equal(operationReceipt.tests.failed, 0)
  assert.equal(operationReceipt.tests.skipped, 0)
  assert.equal(operationReceipt.proofs.length, 1)
  assert.equal(operationReceipt.proofs[0].requirement, requirement)
  assert.equal(operationReceipt.proofs[0].targetOperation, targetOperation)
  assert.equal(operationReceipt.proofs[0].handlerId, handlerId)
  assert.equal(operationReceipt.proofs[0].executed, true)
  const ledgerRow = featureLedger.entries.find(entry => entry.id === requirement)
  assert.equal(ledgerRow.status, 'adapted')
  assert.deepEqual(ledgerRow.evidence, [
    {
      path: `modkit-core/reports/port-sc2-composition-m4/${relative}`,
      sha256: sha256(bytes),
    },
  ])
  const operationRow = operationMap.entries.find(entry => entry.id === requirement)
  assert.equal(operationRow.status, 'adapted')
  assert.equal(operationRow.targetOperation, targetOperation)
  assert.equal(operationRow.handlerId, handlerId)
}
assert.equal(featureLedger.entries.filter(entry => entry.status === 'pending').length, 881)
assert.equal(
  featureLedger.entries.find(entry => entry.id === 'legacy/codec-manifest/modkit/mpq/audit').status,
  'pending',
)
assert.equal(
  featureLedger.entries.find(entry => entry.id === 'legacy/codec-manifest/modkit/casc/audit').status,
  'pending',
)
const writeReceipt = json(await readEvidence('receipts/mpq-archive.write.json'))
assert.equal(writeReceipt.rawEvidence.publicRoute.fileSha256, sha256(publicPackBytes))
assert.equal(writeReceipt.rawEvidence.publicRoute.resultDigest, publicPack.resultDigest)

const archiveProvenance = json(await readEvidence('inputs/archive-m4-provenance.json'))
assert.equal(archiveProvenance.milestone, 'M4/P11')
assert.equal(archiveProvenance.disposition, 'copied-unwired-test-compatibility')
assert.equal(archiveProvenance.oracle.commit, oracleCommit)
assert.equal(archiveProvenance.oracle.sourceMode, 'git-object-database')
assert.equal(archiveProvenance.copiedRoots.length, 51)
assert.equal(archiveProvenance.deferredM3Tests.unchanged, true)
assert.deepEqual(
  archiveProvenance.deferredM3Tests.actualSha256AtM4,
  archiveProvenance.deferredM3Tests.expectedSha256,
)
assert.equal(archiveProvenance.algorithmAllowances.length, 7)
const archiveTestNames = [
  'cache.spec.ts',
  'index.spec.ts',
  'optional-extension-loaders.spec.ts',
  'source.spec.ts',
  'vfs-browser-boundary.spec.ts',
  'vfs-mount.spec.ts',
]
let declarationCount = 0
for (const filename of archiveTestNames) {
  const source = gitShow(
    blizzardRoot,
    blizzardImplementationCommit,
    `starcraft2/test/mk2/packages/archives-processing/test/${filename}`,
  ).toString('utf8')
  declarationCount += (source.match(/\bit(?:\.each)?\s*\(/gu) ?? []).length
}
assert.equal(declarationCount, 49)

const algorithmSummary = JSON.parse((await readEvidence('migration/algorithms.log')).toString('utf8').trim())
assert.deepEqual(algorithmSummary, {
  repositories: 6,
  mpqHash: { definitions: 1, blizzardDefinitions: 0, bindings: 8, vectors: 5 },
  failures: [],
  debt: 43,
  canonical: 9,
  canonicalCopy: 5,
  canonicalOwned: 4,
  copiedUnwired: 9,
  new: 0,
  retired: [],
})
assert.equal(json(await readEvidence('inputs/algorithm-owners.json')).owners.length, 4)

const commands = json(await readEvidence('commands.json'))
assert.equal(commands.normative.length, 20)
assert.ok(commands.normative.every(command => command.exitCode === 0))
for (const command of commands.normative) {
  if (command.log) assert.ok(manifestPaths.has(command.log), `missing command log: ${command.id}`)
}
const logText = async relative => (await readEvidence(relative)).toString('utf8')
assert.match(await logText('tests/core-container-composition.log'), /Test Files\s+4 passed \(4\)/u)
assert.match(await logText('tests/core-container-composition.log'), /Tests\s+28 passed \(28\)/u)
assert.match(await logText('tests/archive-carryover.log'), /Test Files\s+6 passed \(6\)/u)
assert.match(await logText('tests/archive-carryover.log'), /Tests\s+51 passed \(51\)/u)
assert.match(await logText('tests/real-oracles.log'), /Tests\s+2 passed \(2\)/u)
assert.match(await logText('tests/mpq-public-workflow.log'), /Tests\s+4 passed \(4\)/u)
assert.match(await logText('tests/algorithms.log'), /ℹ pass 23/u)
assert.match(await logText('tests/compression-bounded.log'), /ℹ pass 3/u)
assert.match(await logText('tests/migration-infrastructure.log'), /ℹ pass 128/u)
assert.match(await logText('tests/core-quick.log'), /ℹ pass 62/u)
assert.match(await logText('tests/core-quick.log'), /Tests\s+388 passed \(388\)/u)
assert.match(await logText('tests/blizzard-quick.log'), /Tests\s+187 passed \| 3 skipped \(190\)/u)
assert.match(await logText('tests/blizzard-pack.log'), /Blizzard distribution pack verified: 2061 files/u)
assert.match(await logText('typecheck/core-strict.log'), /ts-strict: 8 packages, problems 0/u)
assert.match(await logText('migration/migration-check.log'), new RegExp(registryLine.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
assert.equal((await logText('migration/receipt-validation.log')).match(/evidence validated: 1 requirements/gu)?.length, 4)
const cascInstalledAcceptance = json(await readEvidence('tests/casc-installed-acceptance.log'))
assert.equal(cascInstalledAcceptance.host.contributionId, 'blizzard/casc')
assert.equal(cascInstalledAcceptance.host.extract.bytes, 787142)
assert.equal(
  cascInstalledAcceptance.host.extract.digest,
  'sha256:52026354da439891b67b4767f3caa7adb21088382aa61f167ac30f692574b963',
)
assert.equal(cascInstalledAcceptance.host.lifecycle.namespaceLeaseReleased, true)
assert.equal(cascInstalledAcceptance.host.lifecycle.sessionDisposed, true)

const run = (command, args, cwd, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: '1', ...options.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, `${options.name ?? command} failed:\n${output.slice(-6000)}`)
  return output
}
const pnpm = (cwd, args, options = {}) => {
  if (process.platform !== 'win32') return run('pnpm', args, cwd, options)
  const cli = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  return run(process.execPath, [cli, ...args], cwd, options)
}
const verifyJsonLine = (output, expected, label) => {
  const line = output
    .split(/\r?\n/u)
    .map(value => value.trim())
    .find(value => value.startsWith('{') && value.endsWith('}'))
  assert.ok(line, `${label}: JSON result missing`)
  assert.deepEqual(JSON.parse(line), expected)
}

pnpm(coreRoot, ['typecheck'], { name: 'Core typecheck' })
pnpm(blizzardRoot, ['typecheck'], { name: 'Blizzard typecheck' })
pnpm(blizzardRoot, ['--dir', 'starcraft2', 'typecheck:mk2-libraries'], {
  name: 'isolated M3/M4 libraries typecheck',
})
const focusedOutput = pnpm(
  coreRoot,
  [
    'exec',
    'vitest',
    'run',
    'packages/host/test/subject-open-container-composition.test.ts',
    'packages/host/test/nested-subject-containers.test.ts',
    'packages/host/test/namespace-write-seam.test.ts',
    'packages/host/test/namespace-candidate-discovery.test.ts',
  ],
  { name: 'Core P11 focused tests' },
)
assert.match(focusedOutput, /Tests\s+28 passed \(28\)/u)
const archiveOutput = pnpm(
  blizzardRoot,
  [
    'exec',
    'vitest',
    'run',
    '--workspace',
    'starcraft2/test/vitest.m3-family-libraries.workspace.mjs',
    '--project',
    'archives-processing',
  ],
  { name: 'archive carryover' },
)
assert.match(archiveOutput, /Tests\s+51 passed \(51\)/u)

verifyJsonLine(
  run(process.execPath, ['scripts/migration/check-algorithms.mjs'], coreRoot, {
    name: 'algorithm gate',
  }),
  algorithmSummary,
  'algorithm gate',
)
for (const [scope, files, imports] of [
  ['family', 1460, 4840],
  ['m1-libs', 50, 97],
  ['sc2-bank', 87, 217],
])
  verifyJsonLine(
    run(
      process.execPath,
      ['scripts/migration/check-mk2-copy.mjs', '--family', 'sc2', '--scope', scope],
      coreRoot,
      { name: `${scope} copy gate` },
    ),
    { scope, files, imports },
    `${scope} copy gate`,
  )
for (const [filename] of receiptExpectations) {
  const output = run(
    process.execPath,
    [
      'scripts/migration/apply-port-evidence.mjs',
      '--receipt',
      `modkit-core/reports/port-sc2-composition-m4/receipts/${filename}`,
      '--check',
    ],
    coreRoot,
    { name: `${filename} receipt validation` },
  )
  assert.match(output, /evidence validated: 1 requirements/u)
}
const migrationOutput = pnpm(coreRoot, ['migration:check'], { name: 'migration check' })
assert.match(migrationOutput, new RegExp(registryLine.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))

const tempRoot = await mkdtemp(path.join(tmpdir(), 'modkit-m4-verify-'))
const resolvedTempRoot = path.resolve(tempRoot)
const resolvedSystemTemp = `${path.resolve(tmpdir())}${path.sep}`
assert.ok(resolvedTempRoot.startsWith(resolvedSystemTemp), 'temporary verification root escaped system temp')
try {
  const realOutput = pnpm(
    blizzardRoot,
    [
      'exec',
      'vitest',
      'run',
      'starcraft2/test/sc2-packed-corpus.test.ts',
      'starcraft2/test/casc-installation-corpus.test.ts',
    ],
    {
      name: 'packed and CASC real oracles',
      env: {
        MODKIT_M4_ORACLE_RECEIPT: path.join(tempRoot, 'packed.json'),
        MODKIT_M4_CASC_ORACLE_RECEIPT: path.join(tempRoot, 'casc.json'),
      },
    },
  )
  assert.match(realOutput, /Tests\s+2 passed \(2\)/u)
  const rerunPacked = json(await readFile(path.join(tempRoot, 'packed.json')))
  const rerunCasc = json(await readFile(path.join(tempRoot, 'casc.json')))
  assert.equal(rerunPacked.resultDigest, packed.resultDigest)
  assert.deepEqual(rerunPacked.counts, packed.counts)
  assert.equal(rerunCasc.resultDigest, casc.resultDigest)
  assert.deepEqual(rerunCasc.counts, casc.counts)

  const publicOutput = pnpm(
    blizzardRoot,
    ['exec', 'vitest', 'run', 'mpq/test/native-preserving-workflow.test.ts'],
    {
      name: 'public MPQ workflow',
      env: {
        MODKIT_M4_MPQ_PUBLIC_PACK_RECEIPT: path.join(tempRoot, 'public-pack.json'),
        MODKITX_WTE70_SAVE_AS_RECEIPT: path.join(tempRoot, 'save-as.json'),
      },
    },
  )
  assert.match(publicOutput, /Tests\s+4 passed \(4\)/u)
  const rerunPublic = json(await readFile(path.join(tempRoot, 'public-pack.json')))
  const rerunSaveAs = json(await readFile(path.join(tempRoot, 'save-as.json')))
  assert.equal(rerunPublic.resultDigest, publicPack.resultDigest)
  assert.equal(rerunPublic.verdict, 'pass')
  assert.equal(rerunSaveAs.verdict, 'pass')
  assert.equal(rerunSaveAs.sourceUnchanged.matchesOriginal, true)
  assert.equal(rerunSaveAs.undo.removedDestination, true)
} finally {
  await rm(resolvedTempRoot, { recursive: true, force: true })
}

for (const row of statusRows(coreRoot))
  assert.ok(isEvidencePath(statusPath(row)), `core tree changed during verification: ${row}`)
assert.deepEqual(statusRows(blizzardRoot), [])

console.log(
  JSON.stringify({
    milestone: 'M4',
    verdict: 'pass',
    manifestFiles: manifest.files.length,
    packed: packed.counts,
    casc: casc.counts,
    archiveTests: 51,
    registry: registryLine,
    ownerAcceptance: 'pending',
  }),
)
