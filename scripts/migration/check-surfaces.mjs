#!/usr/bin/env node
// M1 infrastructure proof plus the independent M7 generic-surface foundation. Codec-family
// receipts remain owner-specific and are not replaced by the fixture smoke.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { coreRoot } from './lib/port-context.mjs'
import { hash, stable } from './lib/port-state.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--scope')
  throw new Error('usage: check-surfaces.mjs --scope <m1-fixtures|m7-foundation>')
const scope = args[1]
const scopes = {
  'm1-fixtures': {
    milestone: 'M1',
    tests: [
      'packages/sdk/test/fields.test.ts',
      'packages/testkit/test/minimal-host.test.ts',
      'packages/testkit/test/reference-codecs.test.ts',
      'packages/host/test/subject-editing.test.ts',
    ],
    receipt: 'surfaces-receipt.json',
    coverage: [
      'typed metadata and schema refusal',
      'load/inventory/resolve/activate and permission refusal',
      'descriptor and lazy data sources',
      'operation/edit-plan/commit/reopen',
      'writer no-op/commit/reopen and incompatible facet refusal',
    ],
  },
  'm7-foundation': {
    milestone: 'M7',
    tests: ['apps/mcp/test/extension-surface-smoke.test.ts'],
    receipt: 'surfaces-m7-foundation-receipt.json',
    coverage: [
      'fixture codec, subject-kind and viewer-panel inventory discovery/removal',
      'inventory/runtime applicability agreement',
      'metadata, tree, hex, card, MCP inspect and script metadata projection',
      'no-op edit plan/prepare/commit/reopen byte identity',
      'fail-closed missing claim, zero execution and skipped execution',
    ],
  },
}
const selected = scopes[scope]
if (selected === undefined)
  throw new Error(`unsupported surface scope ${scope}; expected m1-fixtures or m7-foundation`)
const tests = selected.tests
const output = path.join(coreRoot, 'reports/port-infra')
await mkdir(output, { recursive: true })
const runnerReport = path.join(
  output,
  scope === 'm1-fixtures' ? 'surfaces-tests.json' : `surfaces-${scope}-tests.json`,
)
const runner = createRequire(import.meta.url).resolve('vitest/vitest.mjs')
const executed = spawnSync(
  process.execPath,
  [
    runner,
    'run',
    '--config',
    'vitest.config.ts',
    ...tests,
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--reporter=json',
    `--outputFile=${runnerReport}`,
  ],
  { cwd: coreRoot, stdio: 'inherit' },
)
if (executed.error) throw executed.error
const reportBytes = await readFile(runnerReport)
const report = JSON.parse(reportBytes)
const missing = tests.filter(
  test => !report.testResults?.some(result => result.name.replaceAll('\\', '/').endsWith(test)),
)
const passed =
  executed.status === 0 &&
  report.numPassedTests > 0 &&
  report.numFailedTests === 0 &&
  report.numPendingTests === 0 &&
  (report.numTodoTests ?? 0) === 0 &&
  missing.length === 0
const sources = []
for (const test of tests)
  sources.push({ path: test, sha256: hash(await readFile(path.join(coreRoot, test))) })
await writeFile(
  path.join(output, selected.receipt),
  stable({
    schemaVersion: 1,
    milestone: selected.milestone,
    scope,
    stage: 'infrastructure',
    verdict: passed ? 'pass' : 'fail',
    corpusKind: 'synthetic',
    tests: {
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests,
    },
    missing,
    sources,
    runnerReport: {
      path: `modkit-core/reports/port-infra/${path.basename(runnerReport)}`,
      sha256: hash(reportBytes),
    },
    coverage: selected.coverage,
    fullFamilyAcceptance: false,
  }),
)
console.log(
  `surfaces ${scope}: ${passed ? 'pass' : 'fail'}, ${report.numPassedTests} passed, ${report.numFailedTests} failed; full family acceptance pending`,
)
if (!passed) process.exitCode = 1
