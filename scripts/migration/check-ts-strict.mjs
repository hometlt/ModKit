#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { coreRoot } from './lib/port-context.mjs'
import { readJson, confined } from './lib/port-state.mjs'
import { auditStrictPackage } from './lib/ts-strict.mjs'

const baseline = await readJson(path.join(coreRoot, 'migration/ts-strict-baseline.json'))
if (baseline.schemaVersion !== 1 || !baseline.packages.length)
  throw new Error('empty strict baseline')
const mandatory = ['codec-kit', 'scene', 'uv', 'extension-manager', 'code', 'host', 'ui', 'testkit']
const declared = new Set(baseline.packages.map(row => row.path))
if (
  declared.size !== baseline.packages.length ||
  mandatory.some(name => !declared.has(`packages/${name}`))
)
  throw new Error('T1/T2 strict coverage cannot be removed or duplicated')
const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc')
let problems = 0
for (const target of baseline.packages) {
  if (target.errors !== 0 || target.javascriptSources !== 0)
    throw new Error(`M1 strict admission must have zero debt: ${target.path}`)
  const directory = confined(coreRoot, target.path)
  const audit = await auditStrictPackage(directory)
  for (const problem of audit.failures) console.error(problem)
  problems += audit.failures.length
  const checked = spawnSync(
    process.execPath,
    [compiler, '-p', path.join(directory, 'tsconfig.json'), '--noEmit', '--pretty', 'false'],
    { encoding: 'utf8' },
  )
  if (checked.status !== 0) {
    problems++
    console.error(checked.error?.message ?? checked.stdout ?? checked.stderr)
  }
  console.log(
    `ts-strict ${target.path}: ${audit.typedFiles} TypeScript files, structural problems ${audit.failures.length}, compiler exit ${checked.status}`,
  )
}
console.log(`ts-strict: ${baseline.packages.length} packages, problems ${problems}`)
if (problems) process.exitCode = 1
