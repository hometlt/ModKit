import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { packFirstParty } from '../../../scripts/pack-first-party.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('standalone pack stages the shared MIT license without dirtying the package', async () => {
  const output = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-pack-'))
  const metadataPath = join(packageRoot, 'package.json')
  const before = await readFile(metadataPath, 'utf8')
  try {
    const [result] = packFirstParty({ packageRoot, destination: output })
    assert.ok(result.files.some(file => file.path === 'licenses/MIT.txt'))
    assert.equal(await readFile(metadataPath, 'utf8'), before)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
