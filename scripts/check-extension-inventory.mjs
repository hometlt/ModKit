#!/usr/bin/env node
// Extension inventory gate (MK3/27 §0.2/§5.1/§12.2, 24 §8; gap G-APP-1 in IMPLEMENTATION_NOTES,
// 2026-08-17).
//
// Every directory anywhere under extensions/ and examples/ that carries an authored extension
// container (package.json#modkit or modkit.extension.json) must produce an inventory the
// data-only loader accepts — no error diagnostics, and for the bundled `common` family every
// contribution must be inventory-eligible (a bundled unit with an unknown/invalid contract is
// not "common", it is debt). Examples may carry demo contracts the production registry does
// not know (warning `unknown-contract`), so for them only errors fail.
//
// This runs the same code path a host runs at startup (loadExtensionDirectory → buildInventory
// with the production contribution-contract registry): nothing is executed, only read. It needs
// the built `packages/host/dist` (pnpm check runs after `pnpm build`).
//
// Known debt is a ratchet with stale detection, exactly like scripts/check-app-imports.mjs.
//
// Usage: node scripts/check-extension-inventory.mjs [--root <dir>] [--debt-file <json>] [--quiet]

import { readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import { discoverAuthoredExtensionRoots, toPosixPath } from './lib/authored-extension-roots.mjs'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = argValue('--root') === undefined ? defaultRoot : resolve(argValue('--root'))
const quiet = args.includes('--quiet')

/** Directories allowed to fail today; a stale entry (directory gone or clean) fails the gate. */
const KNOWN_DEBT = []

/** Scan groups: directory prefix and whether every contribution must be inventory-eligible. */
const SCAN_GROUPS = [
  { name: 'extensions', strict: true },
  { name: 'examples', strict: false }, // demo contracts are allowed
]

function loadDebt() {
  const override = argValue('--debt-file')
  if (override === undefined) return root === defaultRoot ? KNOWN_DEBT : []
  const parsed = JSON.parse(readFileSync(resolve(override), 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('--debt-file must contain a JSON array')
  return parsed
}

const hostDist = join(defaultRoot, 'packages', 'host', 'dist')
if (!statSync(join(hostDist, 'index.js'), { throwIfNoEntry: false })) {
  console.error('extension-inventory gate: packages/host/dist is missing — run `pnpm build` first')
  process.exit(2)
}
const { loadExtensionDirectory } = await import(
  pathToFileURL(join(hostDist, 'node', 'index.js')).href
)
const { buildInventory, createHostContributionContractRegistry } = await import(
  pathToFileURL(join(hostDist, 'index.js')).href
)

const debt = loadDebt()
const debtByDir = new Map(debt.map(entry => [entry.dir, entry]))
const debtHits = new Set()
const failures = [] // { dir, problems: string[] }
let checked = 0

for (const group of SCAN_GROUPS) {
  for (const dir of discoverAuthoredExtensionRoots(join(root, group.name))) {
    const rel = toPosixPath(relative(root, dir))
    checked += 1
    const problems = []
    try {
      const input = await loadExtensionDirectory(dir)
      const inventory = await buildInventory([input], createHostContributionContractRegistry())
      for (const d of inventory.diagnostics) {
        if (d.severity === 'error') problems.push(`inventory ${d.code}: ${d.message}`)
      }
      for (const extension of inventory.extensions) {
        for (const contribution of extension.contributions) {
          for (const d of contribution.diagnostics) {
            if (d.severity === 'error') {
              problems.push(`${contribution.path} ${d.code}: ${d.message}`)
            }
          }
          if (group.strict && !contribution.inventoryEligible) {
            problems.push(
              `${contribution.path} is not inventory-eligible (specState=${contribution.specState}) — bundled common units must be fully valid`,
            )
          }
        }
      }
    } catch (error) {
      problems.push(`loader threw: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (problems.length === 0) continue
    if (debtByDir.has(rel)) {
      debtHits.add(rel)
      continue
    }
    failures.push({ dir: rel, problems })
  }
}

const stale = debt.filter(entry => !debtHits.has(entry.dir))
if (failures.length > 0 || stale.length > 0) {
  if (failures.length > 0) {
    console.error(
      `extension-inventory gate: ${failures.length} invalid extension director(y/ies) of ${checked} checked:`,
    )
    for (const failure of failures) {
      console.error(`  ${failure.dir}`)
      for (const problem of failure.problems) console.error(`    - ${problem}`)
    }
  }
  if (stale.length > 0) {
    console.error(
      `extension-inventory gate: ${stale.length} stale known-debt entr(y/ies) — remove them:`,
    )
    for (const entry of stale) {
      console.error(`  ${entry.dir}  [stale-known-debt] now valid or gone: ${entry.reason}`)
    }
  }
  process.exit(1)
}

if (!quiet) {
  const debtNote =
    debtHits.size === 0
      ? ''
      : `; ${debtHits.size} known-debt director(y/ies) still invalid (tracked)`
  console.log(
    `extension-inventory gate: clean (${checked} extension director(y/ies) checked${debtNote})`,
  )
}
