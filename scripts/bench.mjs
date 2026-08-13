#!/usr/bin/env node
// Benchmark harness — protocol in IMPLEMENTATION_NOTES C3, corrected twice after audits.
//
// Measurement rules, and why each exists:
//
//  * **Cold-import scenarios** (core, closure) spawn one process per sample but time the
//    import INSIDE that process, so Windows spawn/AV cost never enters the number.
//  * **Calibration probes** (probe1, probe9) are committed fixtures that mirror core/dist
//    in shape and size, and are measured by the *same* code path, same warm-up and N, as
//    the measurands. The previous floor probe imported a file it had just written itself —
//    hot page cache, AV already done — so it reported "machine unchanged" while the real
//    file-read path had become three times more expensive. A probe that runs differently
//    from the measurand proves nothing.
//  * **Process-level scenarios** (CLI) interleave bare-node and target runs and report the
//    distribution of *paired* differences. Measuring all bare runs first and all target
//    runs afterwards is biased by any load change between the two blocks.
//  * Every result carries the interquartile spread; a session that is noisy, or whose
//    calibration probes drifted from the recorded baseline, is INCONCLUSIVE — neither a
//    pass nor a failure. Silence about uncertainty is how a loud machine "closes" a budget
//    nobody measured.
//  * `normalizedP50` is reported for information: the raw value rescaled by how far probe9
//    has drifted from its baseline. It is NOT the gate — gating stays on raw p50 unless the
//    owner decides otherwise — but it separates "this machine is slower today" from "this
//    code got slower" at a glance.
//
// Modes: default measures and compares; `--update` rewrites baselines; `--gate` exits 1 on
// a stable breach and 2 when the session is not evidence; `--json` prints the raw report.

import { spawnSync } from 'node:child_process'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { pairedStats } from './bench/paired.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const baselinesPath = join(root, 'scripts', 'bench-baselines.json')
const update = process.argv.includes('--update')
const gate = process.argv.includes('--gate')
const asJson = process.argv.includes('--json')
/**
 * Test seam (never used by a real session): `--samples <json>` supplies pre-recorded
 * per-scenario stats and an alternate baselines file, so the verdict logic — exit codes,
 * probe blocking, normalisation scope — can be tested without waiting for real timings.
 * Measurement code is bypassed; every rule below it runs exactly as in production.
 */
const samplesArgIndex = process.argv.indexOf('--samples')
const injected =
  samplesArgIndex === -1
    ? undefined
    : JSON.parse(readFileSync(process.argv[samplesArgIndex + 1], 'utf8'))

/** A session whose own noise exceeds this is not evidence for anything. */
const NOISE_CEILING = 0.35 // (p75-p25)/p50
const REGRESSION_FACTOR = 1.2
/** A calibration probe this far from its baseline means a different machine state. */
const PROBE_DRIFT_CEILING = 1.5

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

const IMPORT_WARMUP = 3
const IMPORT_N = 15

/** Identical for measurands and probes — that identity is the whole point. */
function coldImportStats(target, n = IMPORT_N) {
  const script = join(root, 'scripts', 'bench', 'import-workload.mjs')
  const samples = []
  for (let i = 0; i < n + IMPORT_WARMUP; i += 1) {
    const r = spawnSync(process.execPath, [script, target], { encoding: 'utf8', cwd: root })
    if (r.status !== 0) throw new Error(`import workload «${target}» failed: ${r.stderr}`)
    if (i >= IMPORT_WARMUP) samples.push(Number(r.stdout.trim()))
  }
  return stats(samples)
}

/** Spawn-based timer for paired measurement; the pairing itself lives in ./bench/paired.mjs. */
function pairedNetStats(argv, n) {
  const timeOnce = kind => {
    const args = kind === 'bare' ? ['-e', ''] : argv
    const t0 = performance.now()
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root })
    const t1 = performance.now()
    if (r.status !== 0 && r.status !== 1) throw new Error(`bench target exited ${r.status}`)
    return t1 - t0
  }
  return pairedStats({ timeOnce, n, warmup: IMPORT_WARMUP })
}

const cliMain = join(root, 'apps', 'modkit-cli', 'dist', 'main.js')
const fixture = join(root, 'apps', 'modkit-cli', 'test', 'fixtures', 'valid-extension')
const hostBuilt = existsSync(join(root, 'packages', 'host', 'dist'))

// Calibration probes first: they define whether this session is comparable at all.
// Owner decision 2026-08-14: probe9 is the blocking calibrator because it mirrors the
// measurand's shape; probe1 measures ~1.5 ms, where relative noise is too large to gate on,
// so it is reported and never blocks. (Applies from this window on; earlier sessions are not
// reclassified retroactively.)
const probes = [
  { id: 'probe1-existing-module', blocking: false, run: () => coldImportStats('probe1') },
  { id: 'probe9-existing-graph', blocking: true, run: () => coldImportStats('probe9') },
]

// Gates are the owner's platform-specific p50 budgets (BRIEF-12 §6, G13 decision
// 2026-08-13). `aspirationMs` is the older, tighter number: reported, never gating.
const scenarios = [
  // `normalizable`: only cold-import scenarios share probe9's workload shape, so only they
  // may be rescaled by its drift. Normalising inventory/resolver/CLI through an ESM import
  // probe would be methodologically unfounded (owner decision 2026-08-14).
  {
    id: 'core-import',
    targetMs: 15,
    aspirationMs: 5,
    normalizable: true,
    run: () => coldImportStats('core'),
  },
  {
    id: 'closure-import',
    targetMs: 50,
    normalizable: true,
    run: () => coldImportStats('closure'),
  },
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
    run: () => pairedNetStats([cliMain, 'validate', fixture], 20),
  })
}

// Read from the machine, never hardcoded (R10).
const cpuList = cpus()
const environment = {
  cpu: `${cpuList[0]?.model?.trim() ?? 'unknown'} (${cpuList.length} logical)`,
  ramGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
  os: `${platform()} ${release()} (${arch()})`,
  node: process.version,
}

const baselines =
  injected?.baselines ??
  (existsSync(baselinesPath)
    ? JSON.parse(readFileSync(baselinesPath, 'utf8'))
    : { environment, probes: {}, scenarios: {} })

/** In injected mode a measurement is a table lookup; otherwise it is the real run. */
const measure = (id, run) => injected?.measurements?.[id] ?? run()

const probeReport = {}
const probeProblems = []
let normalizationFactor = 1
for (const probe of probes) {
  const r = measure(probe.id, probe.run)
  probeReport[probe.id] = r
  const recorded = baselines.probes?.[probe.id]
  const drift = recorded === undefined ? undefined : r.p50 / recorded.p50
  const noisy = r.spread > NOISE_CEILING
  const drifted =
    drift !== undefined && (drift > PROBE_DRIFT_CEILING || drift < 1 / PROBE_DRIFT_CEILING)
  if (probe.blocking) {
    if (noisy) probeProblems.push(`${probe.id} spread ${(r.spread * 100).toFixed(0)}%`)
    if (drifted) probeProblems.push(`${probe.id} ×${drift.toFixed(2)} vs baseline`)
  }
  if (probe.id === 'probe9-existing-graph' && drift !== undefined) normalizationFactor = 1 / drift
  if (!asJson) {
    console.log(
      `${probe.id.padEnd(30)} p50 ${r.p50.toFixed(2)} ms  spread ${(r.spread * 100).toFixed(0)}%` +
        `${recorded ? `  (baseline ${recorded.p50.toFixed(2)}, ×${drift.toFixed(2)})` : ''}` +
        `${probe.blocking ? '' : '  [informational, never gates]'}` +
        `${probe.blocking && (noisy || drifted) ? '  BLOCKING' : ''}`,
    )
  }
}

const report = {}
const breaches = []
const inconclusive = [...probeProblems]
for (const scenario of scenarios) {
  const r = measure(scenario.id, scenario.run)
  report[scenario.id] = { ...r, targetMs: scenario.targetMs }
  const recorded = baselines.scenarios?.[scenario.id]
  // Relative spread is meaningless once a scenario sits far under its budget: at 0.01 ms the
  // jitter is timer resolution. Only scenarios near their budget are judged on stability.
  const material = r.p50 > scenario.targetMs / 10
  const noisy = material && r.spread > NOISE_CEILING
  const overTarget = r.p50 > scenario.targetMs
  const regressed = material && recorded !== undefined && r.p50 > recorded.p50 * REGRESSION_FACTOR
  const missedAspiration =
    scenario.aspirationMs !== undefined && r.p50 > scenario.aspirationMs && !overTarget
  const normalized = scenario.normalizable === true ? r.p50 * normalizationFactor : undefined
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
        `${recorded ? `, baseline ${recorded.p50.toFixed(2)}` : ''}` +
        `${normalized === undefined || normalizationFactor === 1 ? '' : `; normalized ${normalized.toFixed(2)}`}) ${flags}`,
    )
  }
  if (gate && noisy) inconclusive.push(scenario.id)
  if (gate && !noisy && (overTarget || regressed)) {
    breaches.push(
      overTarget
        ? `${scenario.id}: p50 ${r.p50.toFixed(2)} ms over the ${scenario.targetMs} ms gate`
        : `${scenario.id}: p50 ${r.p50.toFixed(2)} ms regressed past the ${(recorded?.p50 ?? 0).toFixed(2)} ms baseline`,
    )
  }
}

if (asJson)
  console.log(JSON.stringify({ environment, probes: probeReport, scenarios: report }, null, 2))

if (update) {
  if (probeProblems.length > 0) {
    console.error(
      `refusing to record baselines — calibration probes say this machine is not in a recordable state: ${probeProblems.join('; ')}`,
    )
    process.exit(2)
  }
  const noisyIds = Object.entries(report)
    .filter(([id, r]) => r.spread > NOISE_CEILING && r.p50 > (report[id]?.targetMs ?? 0) / 10)
    .map(([id]) => id)
  if (noisyIds.length > 0) {
    console.error(
      `refusing to record baselines: ${noisyIds.join(', ')} exceeded the ${(NOISE_CEILING * 100).toFixed(0)}% spread ceiling.\n` +
        'Re-run on a quiet machine — a baseline is evidence, not a snapshot.',
    )
    process.exit(2)
  }
  writeFileSync(
    baselinesPath,
    `${JSON.stringify(
      {
        environment,
        recordedAt: new Date().toISOString().slice(0, 10),
        probes: probeReport,
        scenarios: report,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`baselines written to ${baselinesPath}`)
}

// Calibration failures outrank everything: without a comparable machine there is no verdict.
if (gate && probeProblems.length > 0) {
  console.error(
    `bench gate: INCONCLUSIVE — calibration probes are not comparable: ${probeProblems.join('; ')}.\n` +
      'This is neither a pass nor a failure. Re-run in a quiet window; only a comparable ' +
      'session counts towards the two consecutive runs BRIEF-12 §6 requires.',
  )
  process.exit(2)
}
if (breaches.length > 0) {
  console.error(`bench gate: FAILED\n  ${breaches.join('\n  ')}`)
  console.error('C3: confirm with a second full session before treating this as a verdict.')
  process.exit(1)
}
if (inconclusive.length > 0) {
  console.error(
    `bench gate: INCONCLUSIVE — not evidence: ${[...new Set(inconclusive)].join(', ')}.\n` +
      'This is NOT a pass.',
  )
  process.exit(2)
}
if (gate) console.log('bench gate: passed (probes comparable, all scenarios quiet and in budget)')
