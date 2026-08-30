#!/usr/bin/env node
// Performance measurement — deliberately small (owner policy, 2026-08-14).
//
// History worth keeping in one place: earlier versions grew calibration probes, drift
// detection and normalisation to tell "this machine is slow today" from "this code is
// slow". That machinery answered the question, but it became a second thing to maintain
// and to be wrong about. The owner's policy replaces it:
//
//   * `pnpm bench` is INFORMATIONAL. It prints numbers and always exits 0. It is not part
//     of `pnpm check`, which remains the mandatory functional/packaging gate.
//   * `pnpm bench:gate` is for a fixed CI runner or a dedicated machine — the only place a
//     performance budget can honestly block anything. Three scenarios, absolute budgets,
//     no probes, no normalisation, no re-baselining.
//   * Until such a runner exists, numbers go into REPORT-12 as observations and do not
//     block adoption.
//
// What survived, because it is cheap and it matters:
//   * cold imports are timed INSIDE a fresh child process, so process startup never enters
//     the number;
//   * the CLI scenario interleaves bare-node and CLI runs and reports paired differences,
//     so a load change during the session cancels instead of biasing the result;
//   * every result carries its interquartile spread, and under `--gate` a scenario too
//     noisy to be evidence exits 2 instead of being reported as a pass.

import { spawnSync } from 'node:child_process'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  checkBenchBundlePrecondition,
  formatBenchBundleIssues,
} from './bench/bundle-precondition.mjs'
import { pairedStats, percentileOf } from './bench/paired.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const gate = process.argv.includes('--gate')
const asJson = process.argv.includes('--json')

const bundlePrecondition = checkBenchBundlePrecondition({ root })
if (!bundlePrecondition.ok) {
  const summary =
    'INCONCLUSIVE — bundled dist precondition failed; no timings were collected.\n  ' +
    formatBenchBundleIssues(bundlePrecondition.issues) +
    '\nRun `pnpm build`, then review any scripts/bundle-hashes.json change before retrying.'
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          verdict: 'INCONCLUSIVE',
          reason: 'bundle-precondition',
          message: 'Bundled dist precondition failed; no timings were collected.',
          issues: bundlePrecondition.issues,
        },
        null,
        2,
      ),
    )
  } else if (gate) {
    console.error(`bench gate: ${summary}`)
  } else {
    console.log(`bench: ${summary}`)
  }
  process.exit(gate ? 2 : 0)
}

/** A scenario whose own noise exceeds this cannot decide anything. */
const NOISE_CEILING = 0.35
const WARMUP = 3
const IMPORT_N = 15
const CLI_N = 20

/** Test seam: `--samples <json>` injects recorded numbers to exercise the verdict logic. */
const samplesArgIndex = process.argv.indexOf('--samples')
const injected =
  samplesArgIndex === -1
    ? undefined
    : JSON.parse(readFileSync(process.argv[samplesArgIndex + 1], 'utf8'))

function stats(samples) {
  const p50 = percentileOf(samples, 50)
  return {
    p50,
    p95: percentileOf(samples, 95),
    spread: p50 === 0 ? 0 : (percentileOf(samples, 75) - percentileOf(samples, 25)) / p50,
    n: samples.length,
  }
}

/** One fresh process per sample; the timer lives inside it, so startup is excluded. */
function coldImportStats(target) {
  const script = join(root, 'scripts', 'bench', 'import-workload.mjs')
  const samples = []
  for (let i = 0; i < IMPORT_N + WARMUP; i += 1) {
    const r = spawnSync(process.execPath, [script, target], { encoding: 'utf8', cwd: root })
    if (r.status !== 0) throw new Error(`import workload «${target}» failed: ${r.stderr}`)
    if (i >= WARMUP) samples.push(Number(r.stdout.trim()))
  }
  return stats(samples)
}

function cliNetStats(argv) {
  const timeOnce = kind => {
    const args = kind === 'bare' ? ['-e', ''] : argv
    const t0 = performance.now()
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root })
    const t1 = performance.now()
    if (r.status !== 0 && r.status !== 1) throw new Error(`bench target exited ${r.status}`)
    return t1 - t0
  }
  return pairedStats({ timeOnce, n: CLI_N, warmup: WARMUP })
}

const cliMain = join(root, 'apps', 'cli', 'dist', 'main.js')
const fixture = join(root, 'apps', 'cli', 'test', 'fixtures', 'valid-extension')

/** The three scenarios the policy keeps, with their budgets (BRIEF-12 §6). */
const scenarios = [
  { id: 'core-import', budgetMs: 15, run: () => coldImportStats('core') },
  { id: 'closure-import', budgetMs: 50, run: () => coldImportStats('closure') },
]
if (existsSync(cliMain)) {
  scenarios.push({
    id: 'cli-validate-net',
    budgetMs: 250,
    run: () => cliNetStats([cliMain, 'validate', fixture]),
  })
}

const cpuList = cpus()
const environment = {
  cpu: `${cpuList[0]?.model?.trim() ?? 'unknown'} (${cpuList.length} logical)`,
  ramGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
  os: `${platform()} ${release()} (${arch()})`,
  node: process.version,
}

const report = {}
const breaches = []
const noisyScenarios = []
for (const scenario of scenarios) {
  const r = injected?.measurements?.[scenario.id] ?? scenario.run()
  report[scenario.id] = { ...r, budgetMs: scenario.budgetMs }
  const overBudget = r.p50 > scenario.budgetMs
  const tooNoisy = r.spread > NOISE_CEILING
  if (!asJson) {
    console.log(
      `${scenario.id.padEnd(20)} p50 ${r.p50.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  ` +
        `spread ${(r.spread * 100).toFixed(0)}%  (budget ${scenario.budgetMs} ms)` +
        `${overBudget ? '  OVER-BUDGET' : ''}${tooNoisy ? '  NOISY' : ''}`,
    )
  }
  if (gate && tooNoisy) noisyScenarios.push(scenario.id)
  if (gate && !tooNoisy && overBudget) {
    breaches.push(
      `${scenario.id}: p50 ${r.p50.toFixed(2)} ms over the ${scenario.budgetMs} ms budget`,
    )
  }
}

if (asJson) console.log(JSON.stringify({ environment, scenarios: report }, null, 2))

if (!gate) {
  // Informational by design: local numbers describe this machine at this moment and never
  // block work. Only a fixed runner may turn them into a verdict.
  if (!asJson) console.log('\ninformational run — not a gate (owner policy 2026-08-14)')
  process.exit(0)
}
if (breaches.length > 0) {
  console.error(`bench gate: FAILED\n  ${breaches.join('\n  ')}`)
  process.exit(1)
}
if (noisyScenarios.length > 0) {
  console.error(
    `bench gate: INCONCLUSIVE — too noisy to be evidence: ${noisyScenarios.join(', ')}. ` +
      'This is NOT a pass.',
  )
  process.exit(2)
}
console.log('bench gate: passed')
