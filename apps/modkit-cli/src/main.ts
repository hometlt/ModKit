#!/usr/bin/env node
/**
 * Thin `modkit` CLI — the application root of canon §11 (BRIEF-12 §3.1): argv, stdout
 * and exit codes. Loading is @modkitx-x3/host/node, inventory/validation is
 * @modkitx-x3/host + @modkitx-x3/sdk. No spec registry is built in: every contract is
 * reported as inspectable-unknown here (hosts/testkit supply registries).
 *
 * Exit codes: 0 = valid; 1 = validation errors; 2 = usage/IO failure.
 */

import { resolve } from 'node:path'
import process from 'node:process'
import { createContributionContractRegistry } from '@modkitx-x3/sdk'
import { buildInventory, inventoryHasErrors, type Inventory } from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

function render(inventory: Inventory, json: boolean): string {
  const extension = inventory.extensions[0]
  const contributions = extension?.contributions ?? []
  const ok = !inventoryHasErrors(inventory)
  if (json) {
    return `${JSON.stringify(
      {
        ok,
        ...(extension === undefined
          ? {}
          : {
              container: extension.container,
              extension: {
                publisher: extension.manifest.publisher,
                id: extension.manifest.id,
                version: extension.manifest.version,
              },
            }),
        contributions: contributions.map(c => ({
          path: c.path,
          specState: c.specState,
          ...(c.manifest === undefined ? {} : { id: c.manifest.id }),
        })),
        diagnostics: [
          ...inventory.diagnostics,
          ...contributions.flatMap(c =>
            c.diagnostics.map(d => ({ ...d, path: [c.path, ...(d.path ?? [])] })),
          ),
        ],
      },
      null,
      2,
    )}\n`
  }
  const lines: string[] = []
  const header = extension
    ? ` ${extension.manifest.publisher}/${extension.manifest.id}@${extension.manifest.version}`
    : ''
  lines.push(`${ok ? 'VALID' : 'INVALID'}${header} (${contributions.length} contribution(s))`)
  for (const c of contributions) {
    lines.push(`  ${c.path}: ${c.specState}${c.manifest ? ` [${c.manifest.id}]` : ''}`)
  }
  for (const d of [...inventory.diagnostics, ...contributions.flatMap(c => c.diagnostics)]) {
    lines.push(`  ${d.severity} ${d.code} ${d.message}${d.path ? ` @ ${d.path.join('/')}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, target, ...rest] = argv
  const json = rest.includes('--json') || target === '--json'
  if (command !== 'validate' || target === undefined || target.startsWith('--')) {
    process.stderr.write('usage: modkit validate <dir> [--json]\n')
    return 2
  }
  let inventory: Inventory
  try {
    const input = await loadExtensionDirectory(resolve(target))
    inventory = await buildInventory([input], createContributionContractRegistry([]))
  } catch (error) {
    process.stderr.write(`modkit validate: ${(error as Error).message}\n`)
    return 2
  }
  process.stdout.write(render(inventory, json))
  return inventoryHasErrors(inventory) ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
