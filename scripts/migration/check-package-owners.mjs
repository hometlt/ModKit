#!/usr/bin/env node
// Package owner-matrix gate (plan block 12, items 12-16; exit gate line 1).
//
// The exit gate asks that «каждая строка owner matrix имеет один конечный owner». That is a claim
// about data, so it is checked as data rather than read off a table by eye:
//
//   1. every legacy publication unit in the source inventory appears exactly once in the matrix;
//   2. every matrix row names exactly one owner, drawn from a closed vocabulary;
//   3. the canonical catalogue is exactly the eight units of §2.3 rule 1;
//   4. the bootstrap runtime closure is exactly four of them;
//   5. every directory under packages/ is a declared unit, and every unit declared as a directory
//      exists — so a package cannot be added or removed without this file noticing.
//
// Rule 5 is the one that earns its keep. A new `packages/<thing>` would otherwise be a quiet
// addition to a catalogue the canon calls fixed.
//
// Usage: node scripts/migration/check-package-owners.mjs [--matrix <path>] [--inventory <path>]

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const argValue = flag => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const matrixPath = path.resolve(
  argValue('--matrix') ?? path.join(repoRoot, 'migration/package-owners.json'),
)
const inventoryPath = path.resolve(
  argValue('--inventory') ?? path.join(repoRoot, 'migration/generated/source-inventory.json'),
)

const problems = []
const fail = message => problems.push(message)

/** The eight units of §2.3 rule 1, in canonical order. */
const CANONICAL_UNITS = ['core', 'sdk', 'vfs', 'host', 'ui', 'runtime', 'testkit', 'lsp']
/** Optional application control planes may be packages without joining the platform-unit closure. */
const OPTIONAL_PACKAGE_UNITS = ['extension-manager', 'codec-kit', 'ui-graph-3d']
/** The bootstrap runtime closure of §2.3 rule 1. */
const BOOTSTRAP = ['core', 'sdk', 'vfs', 'host']

/**
 * Where a legacy unit may end up.
 *
 * Three destinations are not packages and all three are legitimate: an extension family (a game or
 * format implementation), Multiverse (a planned sibling repository), and dropped (no runtime
 * surface to own). Naming them explicitly is what keeps «one owner» from being satisfied by
 * writing «various».
 */
const isOwner = owner =>
  CANONICAL_UNITS.includes(owner) ||
  owner === 'multiverse' ||
  owner === 'tooling' ||
  owner === 'extensions' ||
  owner.startsWith('extensions/')

const STATES = ['ported', 'planned', 'demoted', 'dropped']

const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'))
if (matrix.schemaVersion !== 'package-owner-matrix-1') {
  fail(
    `matrix schemaVersion must be "package-owner-matrix-1", found ${JSON.stringify(matrix.schemaVersion)}`,
  )
}

// --- 3 and 4: the catalogue itself -------------------------------------------------------------
const units = matrix.canonicalUnits?.units ?? []
const declared = units.map(item => item.unit)
if (declared.join(',') !== CANONICAL_UNITS.join(',')) {
  fail(
    `canonical catalogue must be exactly the eight units of §2.3 rule 1 in order\n    expected ${CANONICAL_UNITS.join(', ')}\n    found    ${declared.join(', ')}`,
  )
}
const bootstrap = units.filter(item => item.bootstrap === true).map(item => item.unit)
if (bootstrap.join(',') !== BOOTSTRAP.join(',')) {
  fail(
    `bootstrap runtime closure must stay four packages\n    expected ${BOOTSTRAP.join(', ')}\n    found    ${bootstrap.join(', ')}`,
  )
}
for (const unit of units) {
  if (unit.realisedAs === 'package') {
    if (typeof unit.directory !== 'string' || !existsSync(path.join(repoRoot, unit.directory))) {
      fail(
        `unit ${unit.unit} is declared as a package but ${String(unit.directory)} does not exist`,
      )
    }
  } else if (unit.realisedAs === 'subpaths') {
    // a subpath unit must name both halves, or «realised as subpaths» is just an absence
    if (typeof unit.contracts !== 'string' || typeof unit.hostSide !== 'string') {
      fail(
        `unit ${unit.unit} is realised as subpaths and must name its contracts and host-side subpath`,
      )
    }
  } else {
    fail(`unit ${unit.unit}: realisedAs must be "package" or "subpaths"`)
  }
}

// --- 5: the directory listing agrees with the declaration ---------------------------------------
const onDisk = readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => `packages/${entry.name}`)
  .sort()
const declaredDirectories = (matrix.currentPackages ?? []).map(item => item.directory).sort()
if (onDisk.join(',') !== declaredDirectories.join(',')) {
  fail(
    `packages/ contents and currentPackages disagree\n    on disk   ${onDisk.join(', ')}\n    declared  ${declaredDirectories.join(', ')}`,
  )
}
for (const entry of matrix.currentPackages ?? []) {
  if (![...CANONICAL_UNITS, ...OPTIONAL_PACKAGE_UNITS].includes(entry.unit)) {
    fail(
      `${entry.directory}: unit ${entry.unit} is neither canonical nor an optional control plane`,
    )
  }
}

// --- 1 and 2: every legacy unit, exactly one owner ----------------------------------------------
const rows = matrix.legacyPackages ?? []
const seen = new Map()
for (const row of rows) {
  if (typeof row.package !== 'string' || row.package === '')
    fail('a matrix row has no package name')
  if (seen.has(row.package)) fail(`${row.package}: appears twice in the matrix`)
  seen.set(row.package, row)
  if (typeof row.owner !== 'string' || !isOwner(row.owner)) {
    fail(`${row.package}: owner ${JSON.stringify(row.owner)} is not a single legal destination`)
  }
  if (!STATES.includes(row.state)) {
    fail(`${row.package}: state ${JSON.stringify(row.state)} is not one of ${STATES.join(' | ')}`)
  }
  if (row.state === 'demoted' && !String(row.owner).startsWith('extensions')) {
    fail(`${row.package}: a demoted unit must land in an extension family, found ${row.owner}`)
  }
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const legacyNames = new Set(
  (inventory.units ?? [])
    .filter(unit => unit.kind === 'package-export')
    .map(unit => unit.extracted?.packageName)
    .filter(name => typeof name === 'string'),
)
for (const name of [...legacyNames].sort()) {
  if (!seen.has(name)) fail(`${name}: exists in the source inventory and has no owner row`)
}
for (const name of seen.keys()) {
  if (!legacyNames.has(name))
    fail(`${name}: has an owner row but no package-export unit in the inventory`)
}

if (problems.length > 0) {
  process.stderr.write(`package-owners: ${problems.length} problem(s)\n`)
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}

const byState = {}
for (const row of rows) byState[row.state] = (byState[row.state] ?? 0) + 1
const directories = units.filter(item => item.realisedAs === 'package').length
process.stdout.write(
  `package-owners: ${rows.length} legacy unit(s), one owner each (${Object.entries(byState)
    .sort()
    .map(([state, count]) => `${state} ${count}`)
    .join(
      ', ',
    )}); catalogue ${CANONICAL_UNITS.length} units in ${directories} directories; bootstrap ${BOOTSTRAP.length}\n`,
)
