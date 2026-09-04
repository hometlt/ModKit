import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { normalizeExtensionLock, normalizeWorkspaceConfiguration } from '../dist/index.js'

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

test('legacy ModkitX workspace and lock identities normalize to their canonical aliases', () => {
  const workspace = normalizeWorkspaceConfiguration({
    schemaVersion: 1,
    sources: [{ id: 'org.modkitx.blizzard', uri: './blizzard' }],
    profiles: {
      legacy: {
        sources: ['org.modkitx.blizzard'],
        extensions: ['org.modkitx.blizzard/starcraft2'],
        locked: true,
      },
    },
    activeProfile: 'legacy',
    legacyPaths: [{ prefix: ['Mods'], source: 'org.modkitx.blizzard' }],
  })
  assert.equal(workspace.sources[0].id, 'blizzard')
  assert.deepEqual(workspace.profiles.legacy.sources, ['blizzard'])
  assert.deepEqual(workspace.profiles.legacy.extensions, ['blizzard/starcraft2'])
  assert.equal(workspace.legacyPaths[0].source, 'blizzard')

  const lock = normalizeExtensionLock({
    schemaVersion: 1,
    extensions: [
      {
        id: 'org.modkitx.blizzard/starcraft2',
        source: 'org.modkitx.blizzard',
        version: '1.0.0',
        digest: 'A'.repeat(64),
      },
    ],
  })
  assert.deepEqual(lock.extensions, [
    {
      id: 'blizzard/starcraft2',
      source: 'blizzard',
      version: '1.0.0',
      digest: 'a'.repeat(64),
    },
  ])
})
