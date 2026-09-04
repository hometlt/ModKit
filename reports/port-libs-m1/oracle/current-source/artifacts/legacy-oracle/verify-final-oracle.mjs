import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, sha256 } from './load-mk2.mjs'
const core = path.join(codingRoot, 'modkit-core')
const output = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const files = ['scripts/migration/lib/legacy-oracle.mjs', 'scripts/migration/test/legacy-oracle.test.mjs']
const receipt = { schemaVersion: 1, verdict: 'pending', gates: [], implementation: [] }
for (const [name, cwd, args] of [
  ['oracle-lint', core, ['node_modules/eslint/bin/eslint.js', ...files]],
  ['oracle-format', core, ['node_modules/prettier/bin/prettier.cjs', '--check', ...files]],
  ['oracle-test', core, ['--test', 'scripts/migration/test/legacy-oracle.test.mjs']],
  ['p9-parity', codingRoot, ['artifacts/legacy-oracle/check-p9-parity.mjs']],
]) {
  const result = spawnSync(process.execPath, args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const log = (result.stdout ?? '') + (result.stderr ?? '')
  await writeFile(path.join(output, `${name}.log`), log)
  receipt.gates.push({ name, command: `node ${args.join(' ')}`, cwd, exitCode: result.status, logSha256: sha256(log) })
  console.log(`${name}: ${result.status}`)
  if (result.status !== 0) { console.log(log); receipt.verdict = 'fail'; break }
}
for (const file of files) receipt.implementation.push({ path: file, sha256: sha256(await readFile(path.join(core, file))) })
if (receipt.gates.length === 4 && receipt.gates.every(gate => gate.exitCode === 0)) receipt.verdict = 'pass'
await writeFile(path.join(output, 'oracle-verification.receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
if (receipt.verdict !== 'pass') process.exitCode = 1
