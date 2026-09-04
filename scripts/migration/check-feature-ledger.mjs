#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { coreRoot, workspaceRoot, stateRoot, portContext } from './lib/port-context.mjs'
import { checkLedger, discoverPublications, readJson } from './lib/port-state.mjs'
import { parseFlags } from './lib/port-cli.mjs'

const args = parseFlags(process.argv.slice(2), [
  '--ledger',
  '--operations',
  '--closure',
  '--claims',
])
const value = flag => args.get(flag)
if (args.has('--claims') && args.has('--closure'))
  throw new Error('--claims and --closure are mutually exclusive')
const claims = args.has('--claims') ? await readJson(value('--claims')) : undefined
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
  ...(claims === undefined ? {} : { claims }),
})
for (const failure of failures.slice(0, 30)) console.error(failure)
const pending = ledger.entries.filter(row => row.status === 'pending')
if (claims !== undefined) {
  const selectedIds = new Set(Array.isArray(claims?.requirementIds) ? claims.requirementIds : [])
  const selected = context.requirements.filter(row => selectedIds.has(row.id))
  console.log(
    `feature-ledger claims codec=${claims?.codec ?? '(invalid)'}: selected requirements ${selected.length}, selected pending ${pending.filter(row => selectedIds.has(row.id)).length}, total requirements ${context.requirements.length}, total pending ${pending.length}, problems ${failures.length}`,
  )
} else
  console.log(
    `feature-ledger ${closure ? `closure=${closure}` : 'integrity'}: requirements ${context.requirements.length}, pending ${pending.length}, problems ${failures.length}`,
  )
if (failures.length) process.exitCode = 1
