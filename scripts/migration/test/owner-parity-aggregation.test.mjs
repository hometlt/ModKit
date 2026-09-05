import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

import {
  currentContributionId,
  ownerOfLegacyExtension,
  resolveLegacyExtension,
} from '../../parity/repositories.mjs'
import { validateOwnerParityDocuments } from '../../parity/receipt.mjs'

const coreRoot = process.cwd()
const sameRootEnvironment = {
  ...process.env,
  MODKIT_BLIZZARD_ROOT: coreRoot,
  MODKIT_EA_ROOT: coreRoot,
  MODKIT_OTHER_EXTENSIONS_ROOT: coreRoot,
  MODKIT_SPRING_ROOT: coreRoot,
  MODKIT_WARZONE_ROOT: coreRoot,
}

test('legacy extension paths resolve to their current repository owner', () => {
  assert.equal(ownerOfLegacyExtension('extensions/ea/big'), 'ea')
  assert.equal(ownerOfLegacyExtension('extensions/blizzard/models'), 'blizzard')
  assert.equal(ownerOfLegacyExtension('extensions/opensource/spring'), 'spring')
  assert.equal(ownerOfLegacyExtension('extensions/opensource/warzone-2100'), 'warzone')
  assert.equal(ownerOfLegacyExtension('extensions/ps1'), 'other')
  assert.equal(ownerOfLegacyExtension('extensions/common/images'), 'core')
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/images', sameRootEnvironment),
    resolve(coreRoot, 'extensions/images'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/data/plain-text', sameRootEnvironment),
    resolve(coreRoot, 'packages/host/native-text'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/data/text-delimited', sameRootEnvironment),
    resolve(coreRoot, 'extensions/data'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/ea/big', sameRootEnvironment),
    resolve(coreRoot, 'big'),
  )
})

test('legacy publishers map to exact current contribution namespaces', () => {
  assert.equal(currentContributionId('org.modkitx/image-png'), 'modkit/image-png')
  assert.equal(currentContributionId('org.modkitx.ea/big'), 'ea/big')
  assert.equal(currentContributionId('org.modkitx.blizzard/m3'), 'blizzard/m3')
  assert.throws(() => currentContributionId('big'), /invalid legacy contribution id/u)
})

test('owner parity documents require explicit result-to-repository bindings', () => {
  const repositories = [{ id: 'core', repository: 'modkit-core', commit: 'a'.repeat(40) }]
  const counts = { total: 1, compared: 1, skipped: 0, failed: 0, real: 1 }
  const oracleExecution = {
    oracleCommit: 'b'.repeat(40),
    entry: 'entry.ts',
    cacheKey: '1'.repeat(64),
    sourceClosureDigest: '2'.repeat(64),
    loaderDigest: '3'.repeat(64),
    dependenciesDigest: '4'.repeat(64),
    corpusDigest: '5'.repeat(64),
    bundleSha256: '6'.repeat(64),
    observeWorkingTree: false,
    sourceFiles: 1,
  }
  const receipt = {
    schemaVersion: 'owner-parity-aggregation-2',
    verdict: 'pass',
    report: { schemaVersion: 4, counts },
    repositories,
    ownerResultCounts: { core: 1 },
    oracle: {
      repository: 'modkitmk2',
      commit: oracleExecution.oracleCommit,
      rows: 1,
      executions: 1,
    },
    blockingResultIds: [],
  }
  const report = {
    schemaVersion: 4,
    canonical: { repository: 'modkitmk2', commit: oracleExecution.oracleCommit },
    x3: { repositories },
    counts,
    results: [
      {
        id: 'fixture',
        state: 'compared',
        x3ContributionId: 'modkit/fixture',
        repositories: ['core'],
        oracleExecutions: [oracleExecution],
      },
    ],
  }
  assert.deepEqual(validateOwnerParityDocuments({ receipt, report }), {
    rows: 1,
    repositories: 1,
    oracleExecutions: 1,
  })
  assert.throws(
    () =>
      validateOwnerParityDocuments({
        receipt,
        report: {
          ...report,
          results: [{ ...report.results[0], repositories: [] }],
        },
      }),
    /no repository binding/u,
  )
})

test('owner parity probes the exact Git-ODB oracle without executing its checkout', async () => {
  const runner = await readFile(resolve(coreRoot, 'scripts/parity/check.mjs'), 'utf8')
  const adapter = await readFile(resolve(coreRoot, 'scripts/parity/modkitx-probe.mjs'), 'utf8')
  assert.match(runner, /loadMk2\(entry/u)
  assert.match(runner, /sample\.canonicalModule/u)
  assert.match(runner, /commit: MK2_PIN/u)
  assert.match(runner, /observeWorkingTree: false/u)
  assert.doesNotMatch(runner, /['"]--dir['"]/u)
  assert.doesNotMatch(runner, /cwd:\s*canonical/u)
  assert.doesNotMatch(adapter, /request\.canonicalRoot/u)
  assert.doesNotMatch(adapter, /pathToFileURL/u)
})

test('strict parity reruns isolate their scratch receipt and normalise owner commits', async () => {
  const strict = await readFile(
    resolve(coreRoot, 'scripts/migration/check-parity-legacy.mjs'),
    'utf8',
  )
  assert.match(strict, /MODKIT_PARITY_RECEIPT:\s*receiptPath/u)
  assert.match(strict, /commit:\s*'<provenance>'/u)
})
