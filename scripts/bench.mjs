#!/usr/bin/env node
// Benchmark harness implementing the S0.0 protocol (IMPLEMENTATION_NOTES C3):
// warm-up >=3 discarded, N runs per scenario, p50 gates / p95 recorded, process
// startup excluded (in-process windows; CLI reports net = raw - bare-node baseline).
// Modes: default = measure + compare against scripts/bench-baselines.json (informative);
// --update = rewrite baselines; --gate = exit 1 on proven target excess or >20% p50
// regression vs recorded baseline (confirm with a second full session before trusting).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))
const baselinesPath = join(root, 'scripts', 'bench-baselines.json')
const update = process.argv.includes('--update')
const gate = process.argv.includes('--gate')

const WARMUP = 3

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), n: samples.length }
}

function freshImportMs(specifier) {
  const code = `const t0=performance.now();await import('${specifier}');console.log(performance.now()-t0)`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    cwd: root,
  })
  if (result.status !== 0) throw new Error(`import bench failed: ${result.stderr}`)
  return Number(result.stdout.trim())
}

function wallMs(argv, cwd) {
  const t0 = performance.now()
  const result = spawnSync(process.execPath, argv, { encoding: 'utf8', cwd })
  const t1 = performance.now()
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`bench target exited ${result.status}: ${result.stderr}`)
  }
  return t1 - t0
}

function runSamples(n, fn) {
  for (let i = 0; i < WARMUP; i += 1) fn()
  const samples = []
  for (let i = 0; i < n; i += 1) samples.push(fn())
  return stats(samples)
}

const scenarios = []

// §6: import @modkitx-x3/core < 5 ms (fresh process, dynamic-import window).
scenarios.push({
  id: 'core-import',
  targetMs: 5,
  run: () => runSamples(10, () => freshImportMs('@modkitx-x3/core')),
})

// §6: full bootstrap closure < 50 ms — grows as packages land (S0.5: core+sdk).
const closure = ['@modkitx-x3/core', '@modkitx-x3/sdk']
if (existsSync(join(root, 'packages', 'vfs'))) closure.push('@modkitx-x3/vfs')
if (existsSync(join(root, 'packages', 'host'))) closure.push('@modkitx-x3/host')
scenarios.push({
  id: `closure-import (${closure.length} pkg)`,
  key: 'closure-import',
  targetMs: 50,
  run: () =>
    runSamples(10, () =>
      freshImportMs(closure.length === 1 ? closure[0] : `${closure.join("');await import('")}`),
    ),
})

// §6: inventory of 100 synthetic manifests < 100 ms; resolve+explain < 1 ms/contract.
function inProcessStats(workload) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'bench', workload)], {
    encoding: 'utf8',
    cwd: root,
  })
  if (result.status !== 0) throw new Error(`workload ${workload} failed: ${result.stderr}`)
  return JSON.parse(result.stdout.trim())
}
if (existsSync(join(root, 'packages', 'host', 'dist'))) {
  scenarios.push({
    id: 'inventory-100-synthetic',
    targetMs: 100,
    run: () => inProcessStats('inventory-workload.mjs'),
  })
  scenarios.push({
    id: 'resolve-explain-per-contract',
    targetMs: 1,
    run: () => inProcessStats('resolve-workload.mjs'),
  })
}

// §6: modkit validate on the example extension < 150 ms (net of bare node startup).
const cliMain = join(root, 'apps', 'modkit-cli', 'dist', 'main.js')
const fixture = join(root, 'apps', 'modkit-cli', 'test', 'fixtures', 'valid-extension')
if (existsSync(cliMain)) {
  scenarios.push({
    id: 'cli-validate-net',
    targetMs: 150,
    run: () => {
      const baseline = runSamples(20, () => wallMs(['-e', ''], root))
      const raw = runSamples(20, () => wallMs([cliMain, 'validate', fixture], root))
      return { p50: raw.p50 - baseline.p50, p95: raw.p95 - baseline.p95, n: raw.n }
    },
  })
}

const baselines = existsSync(baselinesPath)
  ? JSON.parse(readFileSync(baselinesPath, 'utf8'))
  : { environment: undefined, scenarios: {} }

const environment = {
  cpu: 'Intel Core Ultra 7 155U (12C/14T)',
  ramGb: 31.5,
  os: 'Windows 11 Pro build 26200',
  node: process.version,
  disk: 'NVMe SSD (Phison 512GB)',
}

let failed = false
const report = {}
for (const scenario of scenarios) {
  const key = scenario.key ?? scenario.id
  const result = scenario.run()
  report[key] = { ...result, targetMs: scenario.targetMs }
  const recorded = baselines.scenarios?.[key]
  const overTarget = result.p50 > scenario.targetMs
  const regressed = recorded !== undefined && result.p50 > recorded.p50 * 1.2
  const flags = [overTarget ? 'OVER-TARGET' : '', regressed ? 'REGRESSED' : '']
    .filter(Boolean)
    .join(' ')
  console.log(
    `${scenario.id.padEnd(28)} p50 ${result.p50.toFixed(2)} ms  p95 ${result.p95.toFixed(2)} ms  (target ${scenario.targetMs} ms${recorded ? `, baseline p50 ${recorded.p50.toFixed(2)}` : ''}) ${flags}`,
  )
  if (gate && (overTarget || regressed)) failed = true
}

if (update) {
  writeFileSync(
    baselinesPath,
    `${JSON.stringify({ environment, recordedAt: new Date().toISOString().slice(0, 10), scenarios: report }, null, 2)}\n`,
    'utf8',
  )
  console.log(`baselines written to ${baselinesPath}`)
}
if (failed) {
  console.error('bench gate: FAILED (confirm with a second full session before trusting — C3)')
  process.exit(1)
}
