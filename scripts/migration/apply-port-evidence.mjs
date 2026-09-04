#!/usr/bin/env node
import { writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot, stateRoot, portContext } from './lib/port-context.mjs'
import { applyReceipt } from './lib/port-generators.mjs'
import { discoverPublications, readJson, stable } from './lib/port-state.mjs'
import { parseFlags, requiredFlag } from './lib/port-cli.mjs'

const flags = parseFlags(process.argv.slice(2), ['--receipt'], ['--check'])
const receiptPath = requiredFlag(flags, '--receipt')
const ledgerPath = path.join(stateRoot, 'feature-ledger.json')
const operationPath = path.join(stateRoot, 'operation-map.json')
const context = await portContext({ discoverRepositories: true })
const result = await applyReceipt({
  root: workspaceRoot,
  receiptPath,
  requirements: context.requirements,
  ledger: await readJson(ledgerPath),
  operationMap: await readJson(operationPath),
  publications: await discoverPublications(context.repositories, workspaceRoot),
})
if (!flags.has('--check')) {
  // Validate the whole proposed state before touching either authored file.
  const suffix = `.pending-${process.pid}`
  await writeFile(ledgerPath + suffix, stable(result.ledger), { flag: 'wx' })
  await writeFile(operationPath + suffix, stable(result.operationMap), { flag: 'wx' })
  await rename(operationPath + suffix, operationPath)
  await rename(ledgerPath + suffix, ledgerPath)
}
console.log(
  `evidence ${flags.has('--check') ? 'validated' : 'applied'}: ${result.applied} requirements; regenerate codec-map before migration:check`,
)
