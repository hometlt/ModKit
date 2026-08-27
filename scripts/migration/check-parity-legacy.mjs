#!/usr/bin/env node
// Strict differential check against the pinned legacy oracle (PLAN_MODKIT_MK3_FINAL_RU.md §3.5).
//
// `pnpm parity` observes; `pnpm parity:legacy` is the same observation run as a ratchet. There is no
// second parity implementation — this wrapper runs scripts/parity/check.mjs against a throwaway
// report path and then proves three things the observing run does not:
//
//   1. every corpus variable the parity corpus actually references is set (procurement of corpora
//      for verticals that have no parity rows yet is corpora-readiness business, not this gate's),
//      so a real row cannot quietly become a synthetic-only run;
//   2. the run is clean: nothing skipped, nothing failed, and the row/verdict counts still match
//      the committed baseline in reports/parity/latest.json;
//   3. no row changed its classification against that baseline. The only differences a rerun may
//      show are the recorded X3 provenance commit and the random per-run grant identifiers, which
//      are normalised away before comparing — everything else moving is a regression or an
//      improvement that has to be accepted deliberately by committing a new snapshot.
//
// On a machine without the sealed oracle or without the corpora, the gate prints a visible
// `environment-required` naming exactly what is missing and exits 0 — the plan allows a visible
// environment state, never a hidden skip.
//
// Usage: node scripts/migration/check-parity-legacy.mjs [--quiet]

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const quiet = process.argv.includes('--quiet')
const baselinePath = path.join(repoRoot, 'reports/parity/latest.json')
const lockPath = path.join(repoRoot, 'migration/oracle/legacy-oracle.lock.json')
const localDescriptorPath = path.join(
  repoRoot,
  'migration/oracle/local/legacy-environment.local.json',
)

const environmentRequired = reason => {
  console.log(
    `parity:legacy: environment-required — ${reason}; the differential ratchet did not run here`,
  )
  process.exit(0)
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const descriptors = lock.corpusDescriptors?.variables ?? {}
if (Object.keys(descriptors).length === 0) {
  console.error('parity:legacy: the oracle lock declares no corpus descriptors')
  process.exit(1)
}

// Only the variables the parity corpus consumes gate this run. A descriptor for a vertical whose
// codecs are still staged (Warzone, BAR) or whose corpus is an owner-action (TW, RA3) must not
// hold the differential ratchet hostage — those states live in corpora-readiness.
const corpus = JSON.parse(readFileSync(path.join(repoRoot, 'scripts/parity/corpus.json'), 'utf8'))
const referenced = new Set()
for (const sample of corpus.samples ?? []) {
  if (typeof sample.environment === 'string') referenced.add(sample.environment)
}
const variables = Object.keys(descriptors)
  .filter(name => referenced.has(name))
  .sort()
if (variables.length === 0) {
  console.error(
    'parity:legacy: no lock corpus descriptor matches an environment variable referenced by scripts/parity/corpus.json',
  )
  process.exit(1)
}

let legacyRoot = path.join(repoRoot, '..', 'modkitx')
if (existsSync(localDescriptorPath)) {
  const descriptor = JSON.parse(readFileSync(localDescriptorPath, 'utf8'))
  if (typeof descriptor.legacyRoot === 'string') legacyRoot = descriptor.legacyRoot
}
if (!existsSync(path.join(legacyRoot, '.git'))) {
  environmentRequired('the pinned legacy oracle repository is unavailable')
}

const animationSemantics = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'scripts/parity/check-m3-animation-semantics.mjs'),
    ...(quiet ? ['--quiet'] : []),
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MODKIT_PARITY_CANON_ROOT: legacyRoot },
    maxBuffer: 1 << 28,
  },
)
const animationStdout = animationSemantics.stdout?.trim() ?? ''
const animationStderr = animationSemantics.stderr?.trim() ?? ''
if (animationSemantics.status !== 0) {
  console.error(
    `parity:legacy: the M3 animation semantics check exited ${String(animationSemantics.status)}`,
  )
  if (animationSemantics.error !== undefined) console.error(animationSemantics.error.message)
  if (animationStdout !== '') console.error(animationStdout)
  if (animationStderr !== '') console.error(animationStderr)
  process.exit(1)
}
if (!quiet && animationStdout !== '') {
  console.log(animationStdout)
}

const missing = variables.filter(name => {
  const alias = descriptors[name]?.deprecatedAlias
  const direct = process.env[name]?.trim()
  const value =
    direct !== undefined && direct !== ''
      ? direct
      : typeof alias === 'string'
        ? process.env[alias]?.trim()
        : undefined
  return value === undefined || value === '' || !existsSync(value)
})
if (missing.length > 0) {
  environmentRequired(
    `these corpus variables are unset or point at a missing path: ${missing.join(', ')}`,
  )
}

if (!existsSync(baselinePath)) {
  console.error(
    'parity:legacy: reports/parity/latest.json is missing; run pnpm parity and commit the snapshot',
  )
  process.exit(1)
}

const scratch = mkdtempSync(path.join(tmpdir(), 'x3-parity-legacy-'))
const reportPath = path.join(scratch, 'latest.json')
const run = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/parity/check.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, MODKIT_PARITY_REPORT: reportPath, MODKIT_PARITY_CANON_ROOT: legacyRoot },
  maxBuffer: 1 << 28,
})

const problems = []
if (run.status !== 0) {
  problems.push(`the parity run exited ${run.status}`)
  if (run.stderr) problems.push(run.stderr.trim().split('\n').slice(-5).join(' / '))
}

let observed
if (existsSync(reportPath)) observed = JSON.parse(readFileSync(reportPath, 'utf8'))
else problems.push('the parity run produced no report')

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

/** Normalise the two documented sources of run-to-run noise, and nothing else. */
const normalise = report => {
  const clone = structuredClone(report)
  if (clone.x3 !== undefined) clone.x3 = { ...clone.x3, sha: '<provenance>', root: '<root>' }
  if (clone.canonical !== undefined) clone.canonical = { ...clone.canonical, root: '<root>' }
  if (typeof clone.corpus === 'string') clone.corpus = '<corpus>'
  else if (clone.corpus !== undefined) clone.corpus = { ...clone.corpus, root: '<root>' }
  return JSON.parse(
    JSON.stringify(clone).replace(/modkit-library:[0-9a-f-]{36}\//g, 'modkit-library:<grant>/'),
  )
}

if (observed !== undefined) {
  if (observed.counts.skipped !== 0)
    problems.push(`${observed.counts.skipped} parity row(s) were skipped`)
  if (observed.counts.failed !== 0) problems.push(`${observed.counts.failed} parity row(s) failed`)
  if (observed.counts.real === 0)
    problems.push('no real corpus row ran; a strict run must observe real corpora')
  for (const key of [
    'total',
    'real',
    'synthetic',
    'compared',
    'richer',
    'equal',
    'poorer',
    'incomparable',
  ]) {
    if (observed.counts[key] !== baseline.counts[key]) {
      problems.push(
        `counts.${key} moved: baseline ${baseline.counts[key]}, observed ${observed.counts[key]}`,
      )
    }
  }
  const baselineRows = new Map(baseline.results.map(row => [row.id, row]))
  for (const row of observed.results) {
    const before = baselineRows.get(row.id)
    if (before === undefined) {
      problems.push(`parity row ${row.id} is not in the committed baseline`)
      continue
    }
    if (row.verdict !== before.verdict) {
      problems.push(`parity row ${row.id}: verdict moved ${before.verdict} → ${row.verdict}`)
    }
    if (row.classification !== before.classification) {
      problems.push(`parity row ${row.id}: classification moved`)
    }
  }
  for (const id of baselineRows.keys()) {
    if (!observed.results.some(row => row.id === id)) problems.push(`parity row ${id} disappeared`)
  }
  if (problems.length === 0) {
    const left = JSON.stringify(normalise(baseline))
    const right = JSON.stringify(normalise(observed))
    if (left !== right) {
      problems.push(
        'the observed report differs from the committed snapshot beyond provenance and grant identifiers; accept the change deliberately with pnpm parity and a new commit',
      )
    }
  }
}

rmSync(scratch, { recursive: true, force: true })

if (problems.length > 0) {
  console.error(`parity:legacy: ${problems.length} problem(s)`)
  for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`)
  process.exit(1)
}
if (!quiet) {
  console.log(
    `parity:legacy: ${observed.counts.total} rows against the pinned oracle (${observed.counts.real} real, ${observed.counts.synthetic} synthetic); ${observed.counts.richer} richer, ${observed.counts.equal} equal, ${observed.counts.poorer} poorer; 0 skipped, 0 failed; identical to the committed snapshot`,
  )
}
