import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('registry cross-checks the preserved common coverage ledger', () => {
  const result = spawnSync(process.execPath, ['scripts/migration/check-registry.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, output)
  assert.match(
    output,
    /known debt 38 .*new problems 0, stale baseline entries 0, unavailable checks 0/u,
  )
  assert.doesNotMatch(output, /common-coverage\.json not found/u)
})
