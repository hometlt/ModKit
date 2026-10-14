import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedPackageOptions } from './installed-package-options.mjs'

test('external package catalog is opt-in, required and recorded byte-exactly', () => {
  assert.deepEqual(installedPackageOptions([]), { settings: {}, catalog: null })
  assert.throws(() => installedPackageOptions(['--extension-packages']), /requires a directory/)
  assert.throws(
    () => installedPackageOptions(['--extension-packages', '--receipt']),
    /requires a directory/,
  )
  const directory = mkdtempSync(join(tmpdir(), 'installed-package-options-'))
  try {
    const bytes = '{"packages":[]}\n'
    writeFileSync(join(directory, 'catalog.v1.json'), bytes)
    assert.deepEqual(installedPackageOptions(['--extension-packages', directory]), {
      settings: { 'modkit.extensionPackages': directory },
      catalog: {
        file: 'catalog.v1.json',
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
