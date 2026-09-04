import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseFlags, requiredFlag } from '../lib/port-cli.mjs'

test('acceptance flags reject typos, duplicates and missing scope values', () => {
  assert.throws(() => parseFlags(['--closur', 'sc2'], ['--closure']), /unknown/u)
  assert.throws(
    () => parseFlags(['--closure', 'sc2', '--closure', 'all'], ['--closure']),
    /duplicate/u,
  )
  assert.throws(() => parseFlags(['--closure'], ['--closure']), /missing/u)
  assert.throws(() => parseFlags(['--closure', '--check'], ['--closure'], ['--check']), /missing/u)
  assert.throws(() => requiredFlag(new Map(), '--closure'), /required/u)
  const flags = parseFlags(['--check', '--closure', 'sc2'], ['--closure'], ['--check'])
  assert.equal(requiredFlag(flags, '--closure'), 'sc2')
  assert.equal(flags.get('--check'), true)
})

test('ledger claims and closure are mutually exclusive before any repository or file reads', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../check-feature-ledger.mjs', import.meta.url)),
      '--claims',
      'missing.json',
      '--closure',
      'sc2',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--claims and --closure are mutually exclusive/u)
  assert.doesNotMatch(result.stderr, /ENOENT/u)
})

test('ledger CLI refuses a missing claims value instead of falling back to integrity', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../check-feature-ledger.mjs', import.meta.url)), '--claims'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing --claims value/u)
})
