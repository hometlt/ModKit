#!/usr/bin/env node
// Benchmark harness (protocol: IMPLEMENTATION_NOTES C3, repaired in R7 after the audit
// showed the first version swinging ~60% between sessions on identical code).
//
// What changed and why:
//  * in-process workloads (inventory, resolve) run warm-up + N iterations inside ONE child
//    process, so a scenario costs one spawn instead of dozens; cold-import scenarios keep
//    one process per sample because a cold module graph is exactly what they must measure,
//    but the timer lives INSIDE that process, so spawn cost never enters the number;
//  * process-level scenarios subtract a bare-node baseline measured in the same session;
//  * every result reports p50/p95 AND the interquartile spread, so a noisy session is
//    visible instead of being silently recorded as a baseline;
//  * `--gate` fails only on a *stable* signal: p50 over target with IQR/p50 below the
//    noise ceiling, or a >20% p50 regression that is larger than the measured spread.
//
// Modes: default measures and compares; `--update` rewrites baselines; `--gate` exits 1 on
// a stable breach; `--json` prints machine-readable results.

import { spawnSync } from 'node:child_process'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))
const baselinesPath = join(root, 'scripts', 'bench-baselines.json')
const update = process.argv.includes('--update')
const gate = process.argv.includes('--gate')
const asJson = process.argv.includes('--json')

/** A session whose own noise exceeds this is not evidence for anything. */
const NOISE_CEILING = 0.35 // (p75-p25)/p50
const REGRESSION_FACTOR = 1.2

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = p =>
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))]
  const p50 = at(50)
  const spread = p50 === 0 ? 0 : (at(75) - at(25)) / p50
  return { p50, p95: at(95), spread, n: sorted.length }
}

function runWorkload(file, args = []) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'bench', file), ...args], {
    encoding: 'utf8',
    cwd: root,
  })
  if (result.status !== 0) throw new Error(`workload ${file} failed: ${result.stderr}`)
  return JSON.parse(result.stdout.trim())
}

/**
 * Cold-import scenarios: one fresh process per sample, but the sample itself is measured
 * inside that process (startup excluded). Spawn cost therefore affects how long the bench
 * takes, never the recorded number.
 */
function coldImportStats(which, n) {
  const script = join(root, 'scripts', 'bench', 'import-workload.mjs')
  const samples = []
  for (let i = 0; i < n + 3; i += 1) {
    const r = spawnSync(process.execPath, [script, which], { encoding: 'utf8', cwd: root })
    if (r.status !== 0) throw new Error(`import workload failed: ${r.stderr}`)
    if (i >= 3) samples.push(Number(r.stdout.trim())) // discard warm-up
  }
  return stats(samples)
}

/** Wall-clock of N spawns of `argv`, minus a bare-node baseline from the same session. */
function netProcessStats(argv, n) {
  const measure = args => {
    const samples = []
    for (let i = 0; i < n + 3; i += 1) {
      const t0 = performance.now()
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root })
      const t1 = performance.now()
      if (r.status !== 0 && r.status !== 1) throw new Error(`bench target exited ${r.status}`)
      if (i >= 3) samples.push(t1 - t0) // discard warm-up
    }
    return stats(samples)
  }
  const baseline = measure(['-e', ''])
  const raw = measure(argv)
  return {
    p50: raw.p50 - baseline.p50,
    p95: raw.p95 - baseline.p95,
    spread: raw.spread,
    n: raw.n,
    rawP50: raw.p50,
    baselineP50: baseline.p50,
  }
}

const cliMain = join(root, 'apps', 'modkit-cli', 'dist', 'main.js')
const fixture = join(root, 'apps', 'modkit-cli', 'test', 'fixtures', 'valid-extension')
const hostBuilt = existsSync(join(root, 'packages', 'host', 'dist'))

// Gates are the owner's platform-specific p50 budgets (BRIEF-12 §6, G13 decision
// 2026-08-13, reference machine: Intel Core Ultra 7 155U / Windows x64 / Node 24.16).
// `aspirationMs` is the older, tighter number: reported for context, never gating.
const scenarios = [
  { id: 'core-import', targetMs: 15, aspirationMs: 5, run: () => coldImportStats('core', 15) },
  { id: 'closure-import', targetMs: 50, run: () => coldImportStats('closure', 15) },
]
if (hostBuilt) {
  scenarios.push(
    {
      id: 'inventory-100-synthetic',
      targetMs: 100,
      run: () => runWorkload('inventory-workload.mjs'),
    },
    {
      id: 'resolve-explain-per-contract',
      targetMs: 1,
      run: () => runWorkload('resolve-workload.mjs'),
    },
  )
}
if (existsSync(cliMain)) {
  scenarios.push({
    id: 'cli-validate-net',
    targetMs: 250,
    aspirationMs: 150,
    run: () => netProcessStats([cliMain, 'validate', fixture], 20),
  })
}

// Read from the machine, never hardcoded: a baseline that claims the wrong environment is
// worse than no baseline (R10).
const cpuList = cpus()
const environment = {
  cpu: `${cpuList[0]?.model?.trim() ?? 'unknown'} (${cpuList.length} logical)`,
  ramGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
  os: `${platform()} ${release()} (${arch()})`,
  node: process.version,
}

const baselines = existsSync(baselinesPath)
  ? JSON.parse(readFileSync(baselinesPath, 'utf8'))
  : { environment, scenarios: {} }

// Calibration first: how expensive is one trivial ESM import right now? This is the
// machine's floor. If it has drifted far from the floor recorded with the baseline, the
// whole session measures a different machine-state and cannot close or fail a budget.
const floor = runWorkload('floor-workload.mjs')
const recordedFloor = baselines.floorMs
const floorDrift = recordedFloor === undefined ? undefined : floor.p50 / recordedFloor
if (!asJson) {
  console.log(
    `machine floor (1 trivial ESM import)   p50 ${floor.p50.toFixed(2)} ms` +
      `${recordedFloor === undefined ? '' : ` (baseline ${recordedFloor.toFixed(2)} ms, ×${floorDrift.toFixed(2)})`}`,
  )
}

const report = {}
const breaches = []
const inconclusive = []
const FLOOR_DRIFT_CEILING = 1.5
const machineNotComparable = floorDrift !== undefined && floorDrift > FLOOR_DRIFT_CEILING
for (const scenario of scenarios) {
  const r = scenario.run()
  report[scenario.id] = { ...r, targetMs: scenario.targetMs }
  const recorded = baselines.scenarios?.[scenario.id]
  // Relative spread is meaningless once a scenario sits far under its budget: at 0.01 ms
  // the jitter is timer resolution, not machine noise. Only scenarios within an order of
  // magnitude of their target are judged on stability.
  const material = r.p50 > scenario.targetMs / 10
  const noisy = material && r.spread > NOISE_CEILING
  const overTarget = r.p50 > scenario.targetMs
  // A regression is only meaningful on a scenario that is anywhere near its budget:
  // 0.72 -> 2.02 ms against a 100 ms target is jitter, not a regression worth a red gate.
  const regressed = material && recorded !== undefined && r.p50 > recorded.p50 * REGRESSION_FACTOR
  const missedAspiration =
    scenario.aspirationMs !== undefined && r.p50 > scenario.aspirationMs && !overTarget
  const flags = [
    overTarget ? 'OVER-GATE' : '',
    missedAspiration ? `over aspiration ${scenario.aspirationMs} ms (not a gate)` : '',
    regressed ? 'REGRESSED' : '',
    noisy ? 'NOISY(not evidence)' : '',
  ]
    .filter(Boolean)
    .join(' ')
  if (!asJson) {
    console.log(
      `${scenario.id.padEnd(30)} p50 ${r.p50.toFixed(2)} ms  p95 ${r.p95.toFixed(2)} ms  ` +
        `spread ${(r.spread * 100).toFixed(0)}%  (gate ${scenario.targetMs} ms` +
        `${recorded ? `, baseline ${recorded.p50.toFixed(2)}` : ''}) ${flags}`,
    )
  }
  // A noisy session is not evidence in either direction (C3) — and that cuts both ways:
  // it must not be reported as a pass either, or a loud machine would silently "close" a
  // budget it never measured.
  if (gate && (noisy || (material && machineNotComparable))) inconclusive.push(scenario.id)
  if (gate && !noisy && !(material && machineNotComparable) && (overTarget || regressed)) {
    breaches.push(
      overTarget
        ? `${scenario.id}: p50 ${r.p50.toFixed(2)} ms over the ${scenario.targetMs} ms gate`
        : `${scenario.id}: p50 ${r.p50.toFixed(2)} ms regressed past the ${(recorded?.p50 ?? 0).toFixed(2)} ms baseline`,
    )
  }
}

if (asJson) console.log(JSON.stringify({ environment, scenarios: report }, null, 2))

if (update) {
  // A noisy session must never become a baseline — that is exactly how the first harness
  // recorded numbers that later "regressed" against their own noise (audit finding D7).
  const noisyIds = Object.entries(report)
    .filter(([id, r]) => r.spread > NOISE_CEILING && r.p50 > (report[id]?.targetMs ?? 0) / 10)
    .map(([id]) => id)
  if (noisyIds.length > 0) {
    console.error(
      `refusing to record baselines: ${noisyIds.join(', ')} exceeded the ${(NOISE_CEILING * 100).toFixed(0)}% spread ceiling.\n` +
        'Re-run on a quiet machine (close other work, let the box settle) — a baseline is evidence, not a snapshot.',
    )
    process.exit(2)
  }
  writeFileSync(
    baselinesPath,
    `${JSON.stringify(
      {
        environment,
        recordedAt: new Date().toISOString().slice(0, 10),
        floorMs: floor.p50,
        scenarios: report,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`baselines written to ${baselinesPath}`)
}
if (breaches.length > 0) {
  console.error(`bench gate: FAILED\n  ${breaches.join('\n  ')}`)
  console.error('C3: confirm with a second full session before treating this as a verdict.')
  process.exit(1)
}
if (inconclusive.length > 0) {
  console.error(
    (machineNotComparable
      ? `bench gate: INCONCLUSIVE — the machine floor is ×${(floorDrift ?? 0).toFixed(2)} the recorded one, so this box is not in the state the baseline describes.
`
      : '') +
      `bench gate: INCONCLUSIVE — not evidence: ${[...new Set(inconclusive)].join(', ')}.
` +
      'This is NOT a pass. Let the machine settle and re-run; only a quiet, comparable ' +
      'session counts towards the two consecutive runs BRIEF-12 §6 requires.',
  )
  process.exit(2)
}
if (gate) console.log('bench gate: passed (all material scenarios quiet and within budget)')
