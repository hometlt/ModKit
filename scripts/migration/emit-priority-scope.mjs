#!/usr/bin/env node
// Named release closures and the phase-aware priority gate
// (PLAN_MODKIT_MK3_FINAL_RU.md §0.2, §3.5, блок 10 работы 6–7).
//
// Two closures are generated from migration/capabilities.yaml, never from a hand list of paths:
//
//   mk3-ga            = every mk3-priority capability + its transitive dependsOn closure
//   mk3-multiverse-ga = mk3-ga + every multiverse-priority capability + their transitive closure
//
// Each closure records exact capability IDs, why each one is in (seed or transitive dependency),
// who depends on it, and the planned block deadline it must be closed by. Deterministic: sorted by
// capability ID, no timestamps, no counters.
//
// `--check` regenerates in memory and compares bytes, so a registry edit that moves a closure
// without re-running `pnpm priority:emit` fails the gate.
//
// The same script answers the phase-aware question of §3.5:
//
//   --phase block-N     a priority unit whose planned block has already passed is an error when it
//                       is still unresolved, still parked in mk2, still at E0, or hidden behind an
//                       unavailable corpus. A unit whose planned block has not arrived is never an
//                       error, so the gate does not block work that is not due yet. The audit walks
//                       the union of every named closure — see `auditedUnits` for why.
//
//                       A vertical whose own block has arrived also needs a corpus published as
//                       `available` or `legal-alternative-ready`. This is a phase-start rule, not an
//                       overdue-unit rule: a missing proprietary corpus must stop the vertical
//                       before codec work starts, even when no capability deadline has passed yet.
//
//                       `pnpm check` runs `--phase block-12`, and that number moves when a block
//                       *closes*, not when one opens: the phase names the last block whose
//                       deadlines everyone has agreed are behind us. Raising it early would turn
//                       work in progress into a red gate for the person doing it. Blocks 11 and 12
//                       closed on 2026-08-26, so the gate moved 10 → 12 with them; block 13 is in
//                       progress and is deliberately not named here yet.
//   --release <name>    the block 20–21 / 29 form: zero closure units left in mk2 and zero
//                       unresolved migration states. It is expected to fail until that release is
//                       actually ready; it is not part of `pnpm check`.
//
// Usage:
//   node scripts/migration/emit-priority-scope.mjs [--check] [--phase block-N] [--release <name>]
//                                                  [--registry <path>] [--out-dir <path>]
//                                                  [--corpora <path>] [--quiet]

import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { parseCanonicalYaml } from './lib/canonical-yaml.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const check = args.includes('--check')
const quiet = args.includes('--quiet')
const phase = argValue('--phase')
const release = argValue('--release')
const registryPath = path.resolve(
  argValue('--registry') ?? path.join(repoRoot, 'migration/capabilities.yaml'),
)
const outDir = path.resolve(argValue('--out-dir') ?? path.join(repoRoot, 'migration'))
const corporaPath = path.resolve(
  argValue('--corpora') ?? path.join(repoRoot, 'migration/corpora-readiness.json'),
)

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const problems = []
const fail = message => problems.push(message)

const registry = parseCanonicalYaml(readFileSync(registryPath, 'utf8'))
const capabilities = registry.capabilities ?? []
const byId = new Map(capabilities.map(row => [row.capabilityId, row]))

/** Migration states that still leave a user workflow open. */
const UNRESOLVED = new Set(['missing', 'blocked', 'partial', 'unknown', 'deferred-post-ga'])
const CORPUS_STATUSES = new Set([
  'available',
  'owner-action-required',
  'legal-alternative-ready',
  'unavailable',
])
const PHASE_START_READY = new Set(['available', 'legal-alternative-ready'])
const RELEASES = {
  'mk3-ga': ['mk3-priority'],
  'mk3-multiverse-ga': ['mk3-priority', 'multiverse-priority'],
}

function buildClosure(tracks) {
  const seeds = capabilities
    .filter(row => tracks.includes(row.releaseTrack))
    .map(row => row.capabilityId)
    .sort(compareUtf8)
  const seedSet = new Set(seeds)
  const included = new Set(seeds)
  const requiredBy = new Map()
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.shift()
    for (const target of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(target)) {
        fail(`capability ${id} depends on ${target}, which the registry does not contain`)
        continue
      }
      if (!requiredBy.has(target)) requiredBy.set(target, new Set())
      requiredBy.get(target).add(id)
      if (included.has(target)) continue
      included.add(target)
      queue.push(target)
    }
  }
  return { seedSet, included, requiredBy }
}

function renderClosure(name, tracks) {
  const { seedSet, included, requiredBy } = buildClosure(tracks)
  const units = [...included].sort(compareUtf8).map(id => {
    const row = byId.get(id)
    return {
      capabilityId: id,
      inclusion: seedSet.has(id) ? 'seed' : 'transitive-dependency',
      releaseTrack: row.releaseTrack,
      origin: row.origin,
      obligation: row.obligation,
      owner: row.owner,
      plannedBlock: row.plannedBlock,
      migrationState: row.migrationState,
      supportState: row.supportState,
      evidenceLevel: row.evidenceLevel,
      allocationState: row.allocation.state,
      portFamily: row.allocation.portFamily,
      corpusDescriptors: row.corpusDescriptors,
      dependsOn: [...row.dependsOn].sort(compareUtf8),
      requiredBy: [...(requiredBy.get(id) ?? [])].sort(compareUtf8),
    }
  })

  const tally = pick => {
    const counts = {}
    for (const unit of units) counts[pick(unit)] = (counts[pick(unit)] ?? 0) + 1
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareUtf8(a, b)))
  }
  const deadlines = {}
  for (const unit of units) {
    const key = `block-${unit.plannedBlock}`
    ;(deadlines[key] ??= []).push(unit.capabilityId)
  }
  for (const key of Object.keys(deadlines)) deadlines[key].sort(compareUtf8)

  return {
    $comment: `Generated by scripts/migration/emit-priority-scope.mjs (pnpm priority:emit). Do not edit by hand. Named release closure "${name}" of PLAN_MODKIT_MK3_FINAL_RU.md §0.2: every seed capability of the tracks below plus the transitive dependsOn closure computed from migration/capabilities.yaml. Timestamp-free by design; freshness is proved by pnpm priority:check.`,
    schemaVersion: 'priority-scope-1',
    release: name,
    seedTracks: tracks,
    registry: 'migration/capabilities.yaml',
    generator: 'scripts/migration/emit-priority-scope.mjs',
    counts: {
      total: units.length,
      seed: units.filter(unit => unit.inclusion === 'seed').length,
      transitiveDependencies: units.filter(unit => unit.inclusion === 'transitive-dependency')
        .length,
      byPlannedBlock: Object.fromEntries(
        Object.entries(deadlines)
          .map(([key, ids]) => [key, ids.length])
          .sort(([a], [b]) => compareUtf8(a, b)),
      ),
      byMigrationState: tally(unit => unit.migrationState),
      byObligation: tally(unit => unit.obligation),
      byEvidenceLevel: tally(unit => unit.evidenceLevel),
    },
    deadlines: Object.fromEntries(Object.entries(deadlines).sort(([a], [b]) => compareUtf8(a, b))),
    units,
  }
}

const documents = Object.entries(RELEASES).map(([name, tracks]) => ({
  name,
  file: path.join(outDir, `priority-scope.${name}.json`),
  document: renderClosure(name, tracks),
}))

const prettierOptions = await resolveConfig(documents[0].file)
for (const entry of documents) {
  entry.rendered = await format(JSON.stringify(entry.document), {
    ...prettierOptions,
    parser: 'json',
  })
}

// --- write or compare ------------------------------------------------------------------------------

// `--check` always proves freshness, including when a phase or release audit is also requested;
// only a bare emit writes.
if (check) {
  for (const entry of documents) {
    let existing = ''
    try {
      existing = readFileSync(entry.file, 'utf8')
    } catch {
      fail(`${path.relative(repoRoot, entry.file)} is missing; run pnpm priority:emit`)
      continue
    }
    if (existing !== entry.rendered) {
      fail(`${path.relative(repoRoot, entry.file)} is stale; run pnpm priority:emit`)
    }
  }
} else if (phase === undefined && release === undefined) {
  await mkdir(outDir, { recursive: true })
  for (const entry of documents) writeFileSync(entry.file, entry.rendered, 'utf8')
}

// --- phase-aware gate --------------------------------------------------------------------------------

let corpora
let corporaReadError = false
try {
  corpora = JSON.parse(readFileSync(corporaPath, 'utf8'))
} catch {
  corpora = { corpora: [] }
  corporaReadError = true
}
const corpusEntries = Array.isArray(corpora?.corpora) ? corpora.corpora : []
const corpusStatus = new Map()
for (const entry of corpusEntries) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
  if (!Array.isArray(entry.environmentVariables)) continue
  for (const variable of entry.environmentVariables) {
    if (typeof variable === 'string') corpusStatus.set(variable, entry.status)
  }
}

/**
 * Every unit under audit, once, with the closures that contain it.
 *
 * The audit walked `mk3-ga` alone until block 12 slice 12-2, and that was a blind spot with a
 * name: `uv/uvt/texture-profile` was planned for block 11, sat `partial` through block 12, and no
 * phase run ever said so — because every UV row is `multiverse-priority` and therefore lives only
 * in the second closure. A deadline that only some release tracks can miss is not a deadline.
 *
 * The union rather than a `--closure` flag, deliberately: a flag can be left off, and the whole
 * failure being fixed here is a check that quietly audited less than it appeared to.
 */
function auditedUnits() {
  const merged = new Map()
  for (const entry of documents) {
    for (const unit of entry.document.units) {
      const existing = merged.get(unit.capabilityId)
      if (existing === undefined) merged.set(unit.capabilityId, { unit, closures: [entry.name] })
      else existing.closures.push(entry.name)
    }
  }
  return [...merged.values()].sort((left, right) =>
    compareUtf8(left.unit.capabilityId, right.unit.capabilityId),
  )
}

function phaseAudit(phaseBlock) {
  const overdue = []
  for (const { unit, closures } of auditedUnits()) {
    if (unit.plannedBlock >= phaseBlock) continue
    // a row outside mk3-ga is still overdue; saying which closure it came from is what makes the
    // finding actionable rather than surprising
    const where = closures.includes('mk3-ga') ? '' : ` [${closures.join(', ')}]`
    if (UNRESOLVED.has(unit.migrationState)) {
      overdue.push(
        `${unit.capabilityId}${where}: planned block ${unit.plannedBlock} has passed, migrationState ${unit.migrationState}`,
      )
      continue
    }
    if (unit.portFamily !== null && unit.portFamily.startsWith('mk2/')) {
      overdue.push(
        `${unit.capabilityId}${where}: planned block ${unit.plannedBlock} has passed, still parked in ${unit.portFamily}`,
      )
      continue
    }
    if (unit.evidenceLevel === 'E0') {
      overdue.push(
        `${unit.capabilityId}${where}: planned block ${unit.plannedBlock} has passed with no evidence above E0`,
      )
      continue
    }
    for (const variable of unit.corpusDescriptors) {
      const status = corpusStatus.get(variable)
      if (status === 'unavailable') {
        overdue.push(
          `${unit.capabilityId}${where}: depends on corpus ${variable}, published as unavailable — that is a hidden skip, not a pass`,
        )
      }
    }
  }
  return overdue
}

/**
 * Refuse to enter a corpus-backed vertical before its evidence path is ready.
 *
 * This deliberately audits the readiness matrix itself rather than only capability rows. The
 * matrix is the authority for the plan's pre-start rule, and a named game can require owner action
 * before any of its capability deadlines are overdue. `legal-alternative-ready` is explicit owner
 * acceptance of a non-retail evidence path; a merely described or reachable alternative is not.
 */
function phaseStartAudit(phaseBlock) {
  if (corporaReadError) {
    return [
      `corpus readiness file ${path.relative(repoRoot, corporaPath)} is unreadable; phase start fails closed`,
    ]
  }
  const blocked = []
  if (corpora?.schemaVersion !== 'corpora-readiness-1') {
    blocked.push(
      `corpus readiness schemaVersion must be corpora-readiness-1, found ${JSON.stringify(corpora?.schemaVersion)}; phase start fails closed`,
    )
  }
  if (!Array.isArray(corpora?.corpora)) {
    blocked.push('corpus readiness corpora must be an array; phase start fails closed')
    return blocked
  }
  const entries = []
  for (const [index, entry] of corpora.corpora.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      blocked.push(
        `corpus readiness entry ${index + 1} must be an object; phase start fails closed`,
      )
      continue
    }
    const label =
      typeof entry.id === 'string' && entry.id.length > 0
        ? `corpus ${entry.id}`
        : `corpus readiness entry ${index + 1}`
    let malformed = false
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      blocked.push(`${label}: id is required; phase start fails closed`)
      malformed = true
    }
    if (!Number.isInteger(entry.verticalBlock)) {
      blocked.push(`${label}: verticalBlock must be an integer; phase start fails closed`)
      malformed = true
    }
    if (!CORPUS_STATUSES.has(entry.status)) {
      blocked.push(
        `${label}: unsupported status ${JSON.stringify(entry.status)}; phase start fails closed`,
      )
      malformed = true
    }
    if (!malformed) entries.push(entry)
  }
  entries.sort((left, right) =>
    left.verticalBlock !== right.verticalBlock
      ? left.verticalBlock - right.verticalBlock
      : compareUtf8(left.id, right.id),
  )
  for (const entry of entries) {
    if (entry.verticalBlock > phaseBlock) continue
    if (PHASE_START_READY.has(entry.status)) continue
    const variables =
      Array.isArray(entry.environmentVariables) && entry.environmentVariables.length > 0
        ? entry.environmentVariables.join(', ')
        : 'no environment variable'
    blocked.push(
      `block ${entry.verticalBlock} requires corpus ${entry.id} (${variables}), status ${String(entry.status)}; expected available or legal-alternative-ready before the vertical starts`,
    )
  }
  return blocked
}

if (phase !== undefined) {
  const match = /^block-(\d+)$/.exec(phase)
  if (match === null) fail(`--phase expects block-N, received ${phase}`)
  else {
    const phaseBlock = Number(match[1])
    const overdue = phaseAudit(phaseBlock)
    for (const line of overdue) fail(`overdue priority unit — ${line}`)
    const blockedCorpora = phaseStartAudit(phaseBlock)
    for (const line of blockedCorpora) fail(`phase-start corpus — ${line}`)
  }
}

if (release !== undefined) {
  const entry = documents.find(item => item.name === release)
  if (entry === undefined) fail(`--release expects one of ${Object.keys(RELEASES).join(' | ')}`)
  else {
    for (const unit of entry.document.units) {
      if (UNRESOLVED.has(unit.migrationState)) {
        fail(`${release}: ${unit.capabilityId} still has migrationState ${unit.migrationState}`)
      }
      if (unit.portFamily !== null && unit.portFamily.startsWith('mk2/')) {
        fail(`${release}: ${unit.capabilityId} is still parked in ${unit.portFamily}`)
      }
    }
  }
}

// --- verdict -------------------------------------------------------------------------------------------

if (problems.length > 0) {
  const label =
    phase !== undefined || release !== undefined
      ? 'priority:check'
      : check
        ? 'priority:check'
        : 'priority:emit'
  console.error(`${label}: ${problems.length} problem(s)`)
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`)
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
  process.exit(1)
}
if (!quiet) {
  const summary = documents
    .map(
      entry =>
        `${entry.name} ${entry.document.counts.total} (${entry.document.counts.seed} seed + ${entry.document.counts.transitiveDependencies} transitive)`,
    )
    .join('; ')
  if (phase !== undefined)
    console.log(`priority:check: phase ${phase} clean — no overdue priority unit; ${summary}`)
  else if (release !== undefined)
    console.log(`priority:check: release ${release} clean; ${summary}`)
  else if (check) console.log(`priority:check: closures up to date — ${summary}`)
  else console.log(`priority:emit: wrote ${summary}`)
}
