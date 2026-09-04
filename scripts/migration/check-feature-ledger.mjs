#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { coreRoot, workspaceRoot, stateRoot, portContext } from './lib/port-context.mjs'
import { checkLedger, discoverPublications, readJson } from './lib/port-state.mjs'
import { parseFlags } from './lib/port-cli.mjs'

const args = parseFlags(process.argv.slice(2), ['--ledger', '--operations', '--closure'])
const value = flag => args.get(flag)
const context = await portContext({ discoverRepositories: true })
const publications = await discoverPublications(context.repositories, workspaceRoot)
const ledger = await readJson(value('--ledger') ?? path.join(stateRoot, 'feature-ledger.json'))
const operationMap = await readJson(
  value('--operations') ?? path.join(stateRoot, 'operation-map.json'),
)
let previous
const tracked = execFileSync(
  'git',
  ['ls-tree', 'HEAD', '--', 'migration/codec-port/feature-ledger.json'],
  { cwd: coreRoot, encoding: 'utf8' },
).trim()
if (tracked)
  previous = JSON.parse(
    execFileSync('git', ['show', 'HEAD:migration/codec-port/feature-ledger.json'], {
      cwd: coreRoot,
      encoding: 'utf8',
    }),
  )
const closure = value('--closure')
const failures = await checkLedger({
  requirements: context.requirements,
  ledger,
  operationMap,
  root: workspaceRoot,
  previous,
  publications,
  ...(closure ? { closure } : {}),
})
for (const failure of failures.slice(0, 30)) console.error(failure)
console.log(
  `feature-ledger ${closure ? `closure=${closure}` : 'integrity'}: requirements ${context.requirements.length}, pending ${ledger.entries.filter(row => row.status === 'pending').length}, problems ${failures.length}`,
)
if (failures.length) process.exitCode = 1
