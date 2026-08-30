import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { normalizeExtensionLock, normalizeWorkspaceConfiguration } from '../src/index.js'

const exampleRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../examples/extension-workspace',
)

test('generic workspace example covers local env override, CDN and VFS sources with a lock', async () => {
  const workspace = normalizeWorkspaceConfiguration(
    JSON.parse(await readFile(resolve(exampleRoot, 'modkit.workspace.json'), 'utf8')),
  )
  assert.deepEqual(
    workspace.sources.map(source => [source.id, source.uri, source.environment]),
    [
      ['local-tools', './extensions-local', 'MODKIT_LOCAL_EXTENSION_ROOT'],
      ['cdn-tools', 'https://cdn.example.invalid/extensions/repository.json', undefined],
      ['memory-tools', 'memory://workspace/repository.json', undefined],
    ],
  )
  const lock = normalizeExtensionLock(
    JSON.parse(await readFile(resolve(exampleRoot, 'modkit.extensions.lock.json'), 'utf8')),
  )
  assert.equal(lock.extensions.length, 1)
})
