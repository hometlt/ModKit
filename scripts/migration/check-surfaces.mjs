#!/usr/bin/env node
// M1 infrastructure proof only. Full family surfaces are an explicit later acceptance scope.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { coreRoot } from './lib/port-context.mjs'
import { hash, stable } from './lib/port-state.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--scope' || args[1] !== 'm1-fixtures')
  throw new Error(
    'M1 implements only --scope m1-fixtures; family surfaces remain pending until P1-P8',
  )
const tests = [
  'packages/sdk/test/fields.test.ts',
  'packages/testkit/test/minimal-host.test.ts',
  'packages/testkit/test/reference-codecs.test.ts',
  'packages/host/test/subject-editing.test.ts',
]
const output = path.join(coreRoot, 'reports/port-infra')
await mkdir(output, { recursive: true })
const runnerReport = path.join(output, 'surfaces-tests.json')
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
  path.join(output, 'surfaces-receipt.json'),
  stable({
    schemaVersion: 1,
    milestone: 'M1',
    scope: 'm1-fixtures',
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
      path: 'modkit-core/reports/port-infra/surfaces-tests.json',
      sha256: hash(reportBytes),
    },
    coverage: [
      'typed metadata and schema refusal',
      'load/inventory/resolve/activate and permission refusal',
      'descriptor and lazy data sources',
      'operation/edit-plan/commit/reopen',
      'writer no-op/commit/reopen and incompatible facet refusal',
    ],
    fullFamilyAcceptance: false,
  }),
)
console.log(
  `surfaces M1 fixtures: ${passed ? 'pass' : 'fail'}, ${report.numPassedTests} passed, ${report.numFailedTests} failed; full family acceptance pending`,
)
if (!passed) process.exitCode = 1
