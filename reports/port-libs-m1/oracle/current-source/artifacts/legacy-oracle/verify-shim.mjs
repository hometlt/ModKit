import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, sha256 } from './load-mk2.mjs'
const core = path.join(codingRoot, 'modkit-core')
const output = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const authored = [
  'legacy/index.ts', 'legacy/adapter.ts', 'legacy/adapters.ts', 'legacy/diagnostics.ts', 'legacy/operations.ts', 'legacy/runtime-adapter.ts', 'legacy/language-adapter.ts', 'legacy/vfs/index.ts',
  'legacy/core/index.ts', 'legacy/assets/index.ts', 'legacy/assets/registry-compat.ts', 'legacy/semantic/index.ts', 'legacy/games/index.ts', 'legacy/world/index.ts', 'legacy/runtime/index.ts',
  'crypto/index.ts', 'texture/index.ts', 'compression/index.ts', 'compression/bzip2.ts', 'compression/seek-bzip.d.ts',
].map(file => `packages/codec-kit/src/${file}`)
const tests = ['packages/codec-kit/test/legacy-kit.test.mjs']
const receipt = { schemaVersion: 1, verdict: 'pending', gates: [], authored: [], limitations: ['Compile-compatible registry declarations do not establish feature/operation coverage.', 'Browser fixture exercises the explicit asset URL boundary under Node, not a browser host.', 'Bzip2 is new bounded functionality; ADPCM is explicitly unavailable.'] }
const commands = [
  ['format-write', ['node_modules/prettier/bin/prettier.cjs', '--write', ...authored, ...tests, 'packages/codec-kit/package.json', 'adr/ADR-CODEC-001-legacy-kit.md']],
  ['build', ['node_modules/typescript/bin/tsc', '-b', 'packages/codec-kit']],
  ['typecheck', ['node_modules/typescript/bin/tsc', '-p', 'packages/codec-kit/tsconfig.json', '--noEmit']],
  ['lint', ['node_modules/eslint/bin/eslint.js', ...authored, ...tests]],
  ['fixtures', ['--test', ...tests]],
]
for (const [name, args] of commands) {
  const result = spawnSync(process.execPath, args, { cwd: core, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const log = (result.stdout ?? '') + (result.stderr ?? '')
  await writeFile(path.join(output, `shim-${name}.log`), log)
  receipt.gates.push({ name, command: `node ${args.join(' ')}`, cwd: core, exitCode: result.status, logSha256: sha256(log) })
  console.log(`${name}: ${result.status}`)
  if (result.status !== 0) { console.log(log); receipt.verdict = 'fail'; break }
}
for (const file of [...authored, ...tests, 'packages/codec-kit/package.json', 'adr/ADR-CODEC-001-legacy-kit.md']) receipt.authored.push({ path: file, sha256: sha256(await readFile(path.join(core, file))) })
if (receipt.gates.length === commands.length && receipt.gates.every(gate => gate.exitCode === 0)) receipt.verdict = 'pass'
await writeFile(path.join(output, 'shim.receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
if (receipt.verdict !== 'pass') process.exitCode = 1
