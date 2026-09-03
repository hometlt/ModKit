#!/usr/bin/env node
// Evidence merge (block 12 slice 12-5, exit-gate line 2a).
//
// Tests declare what they prove with `proves()` from @modkit/testkit, beside the assertion that
// proves it. Each worker appends its declarations to its own file under `reports/evidence/raw/` as
// they are made; this merges them into one sorted document that can be committed and diffed like
// every other generated artifact here.
//
// Determinism comes from sorting, not from luck: worker count, scheduling and pid all vary between
// runs, and none of them reach the output.
//
// Two things this refuses to do, both for the same reason — a generated evidence file that can be
// wrong is worse than none:
//
//   * it never merges into the previous document. A partial run produces a smaller file and
//     `--check` says so; folding new records into the old ones would let a deleted test keep its
//     evidence forever, which is exactly the rot the field exists to prevent.
//   * it refuses to emit at all when the raw directory is empty, rather than writing an empty
//     document over a good one.
//
// Usage:
//   node scripts/migration/emit-evidence.mjs           # merge raw -> migration/generated/evidence.json
//   node scripts/migration/emit-evidence.mjs --check   # merge in memory and compare

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCanonicalYaml } from './lib/canonical-yaml.mjs'
import { normalizeIdentifier } from './lib/identity-migration.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const check = process.argv.includes('--check')
const rawDir = path.join(repoRoot, 'reports', 'evidence', 'raw')
const outPath = path.join(repoRoot, 'migration', 'generated', 'evidence.json')

const canonicalTestPath = value => {
  const portable = value.replaceAll('\\', '/')
  // Sibling checkout directory names are `modkit-extensions-<family>` (verified against the actual
  // workspace layout: modkit-extensions-blizzard, -ea, -other, -spring, -warzone), not the shorter
  // `modkit-<family>` these markers used to say. The mismatch meant lastIndexOf() below never found
  // either marker, canonicalTestPath() fell through to `return portable`, and every warzone
  // declaration this produced kept its raw, machine-absolute path instead of becoming the same
  // portable extensions/opensource/warzone-2100/... form the registry itself uses — which is exactly
  // what registry-debt-baseline.json's 13 "declaration comes from" lines were: not a stale registry
  // path, but this generator failing to canonicalize a path that was never wrong to begin with.
  const mirrors = [
    ['/modkit-extensions-warzone/', 'extensions/opensource/warzone-2100/'],
    ['/modkit-extensions-blizzard/', 'extensions/blizzard/'],
  ]
  for (const [marker, canonicalRoot] of mirrors) {
    const markerIndex = portable.lastIndexOf(marker)
    if (markerIndex !== -1) return `${canonicalRoot}${portable.slice(markerIndex + marker.length)}`
  }
  return portable
}

if (!existsSync(rawDir)) {
  process.stderr.write(
    'evidence: no reports/evidence/raw — run `pnpm test` first; declarations are written by the suites themselves\n',
  )
  process.exit(1)
}

/*
 * Contribution -> capability rows.
 *
 * A test knows which contribution it opened; the registry knows which capability row owns that
 * contribution, and one contribution can belong to more than one row. Resolving here means the
 * mapping exists once and cannot drift into seventy-odd test files.
 */
const registry = parseCanonicalYaml(
  readFileSync(path.join(repoRoot, 'migration', 'capabilities.yaml'), 'utf8'),
)
const rowsByContribution = new Map()
for (const row of registry.capabilities ?? []) {
  for (const contribution of row.mk3Contributions ?? []) {
    rowsByContribution.set(contribution, [
      ...(rowsByContribution.get(contribution) ?? []),
      row.capabilityId,
    ])
  }
}

const records = new Map()
const unresolved = new Set()
for (const name of readdirSync(rawDir).sort()) {
  if (!name.endsWith('.jsonl')) continue
  for (const line of readFileSync(path.join(rawDir, name), 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const raw = JSON.parse(line)
    /*
     * The harness's own self-test is not evidence about the product.
     *
     * `packages/testkit/test/evidence.test.ts` exercises `proves()` with invented subjects — that is
     * its job, and those declarations reach this file like any other. Excluding it by name is the
     * honest reading: a fixture used to prove the mechanism works is not a claim about a codec.
     */
    if (raw.test === 'packages/testkit/test/evidence.test.ts') continue
    const contributionId =
      raw.contributionId === undefined
        ? undefined
        : normalizeIdentifier(raw.contributionId, { family: 'qualified' }).value
    const targets =
      raw.capabilityId !== undefined
        ? [raw.capabilityId]
        : (rowsByContribution.get(contributionId) ?? [])
    if (targets.length === 0) {
      unresolved.add(contributionId ?? raw.capabilityId)
      continue
    }
    for (const capabilityId of targets) {
      const record = {
        capabilityId,
        operation: raw.operation,
        // Standalone game repositories mirror their sources into this tree. Evidence belongs to
        // the canonical Product-GA row, so the same assertion must not become a second proof just
        // because it also ran from the sibling repository checkout.
        test: canonicalTestPath(raw.test),
        ...(contributionId === undefined ? {} : { contributionId }),
        ...(raw.note === undefined ? {} : { note: raw.note }),
      }
      records.set(`${capabilityId} ${record.operation} ${record.test}`, record)
    }
  }
}

if (unresolved.size > 0) {
  process.stderr.write(
    `evidence: ${unresolved.size} declaration subject(s) match no capability row — a test claims to prove something the registry does not know about\n`,
  )
  for (const name of [...unresolved].sort()) process.stderr.write(`  - ${name}\n`)
  process.exit(1)
}

if (records.size === 0) {
  process.stderr.write(
    'evidence: raw directory holds no declarations; refusing to write an empty document\n',
  )
  process.exit(1)
}

const sorted = [...records.values()].sort((left, right) =>
  left.capabilityId !== right.capabilityId
    ? left.capabilityId < right.capabilityId
      ? -1
      : 1
    : left.operation !== right.operation
      ? left.operation < right.operation
        ? -1
        : 1
      : left.test < right.test
        ? -1
        : 1,
)

const byCapability = new Map()
for (const record of sorted) {
  const existing = byCapability.get(record.capabilityId) ?? {}
  // first declaration wins for a given operation, and the sort makes "first" deterministic
  if (existing[record.operation] === undefined) existing[record.operation] = record.test
  byCapability.set(record.capabilityId, existing)
}

const document = {
  $comment:
    'Generated by scripts/migration/emit-evidence.mjs from `proves()` declarations made inside the test suites. Not hand-edited: a declaration lives beside the assertion that earns it, so this file changes when a proof does. `operations` is the projection of `declarations` used by check-registry.mjs.',
  schemaVersion: 'evidence-1',
  declarationCount: sorted.length,
  capabilityCount: byCapability.size,
  operations: Object.fromEntries(
    [...byCapability.entries()].sort(([left], [right]) => (left < right ? -1 : 1)),
  ),
  declarations: sorted,
}

const serialised = `${JSON.stringify(document, null, 2)}\n`.replace(/\r\n/gu, '\n')

if (check) {
  let committed
  try {
    committed = readFileSync(outPath, 'utf8')
  } catch {
    process.stderr.write(
      'evidence --check: migration/generated/evidence.json is missing; run pnpm evidence:emit\n',
    )
    process.exit(1)
  }
  if (committed !== serialised) {
    const before = JSON.parse(committed)
    const previous = new Set(
      before.declarations.map(item => `${item.capabilityId} ${item.operation} ${item.test}`),
    )
    const now = new Set(sorted.map(item => `${item.capabilityId} ${item.operation} ${item.test}`))
    const added = [...now].filter(key => !previous.has(key))
    const removed = [...previous].filter(key => !now.has(key))
    process.stderr.write(
      `evidence --check: stale (${added.length} added, ${removed.length} removed)\n`,
    )
    for (const key of added.slice(0, 20)) process.stderr.write(`  + ${key}\n`)
    for (const key of removed.slice(0, 20)) process.stderr.write(`  - ${key}\n`)
    process.stderr.write('  run pnpm evidence:emit after a FULL `pnpm test`, and review the diff\n')
    process.exit(1)
  }
  process.stdout.write(
    `evidence --check: ${document.declarationCount} declaration(s) over ${document.capabilityCount} capability row(s) unchanged\n`,
  )
} else {
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, serialised, 'utf8')
  // the raw directory is scratch; leaving it would make the next partial run look complete
  rmSync(rawDir, { recursive: true, force: true })
  process.stdout.write(
    `evidence: ${document.declarationCount} declaration(s) over ${document.capabilityCount} capability row(s)\n`,
  )
}
