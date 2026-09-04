import { test } from 'node:test'
import assert from 'node:assert/strict'
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
