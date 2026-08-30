import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { discoverLocalExtensionCandidates } from '../src/node.js'

async function writeExtension(root, publisher, id, overrides = {}) {
  await mkdir(root, { recursive: true })
  await mkdir(join(root, 'contributions'), { recursive: true })
  await writeFile(
    join(root, 'contributions', 'codec.json'),
    JSON.stringify({
      schemaVersion: 1,
      contract: { id: 'org.modkitx/codec-contribution', major: 1 },
      id: `${publisher}/${id}-codec`,
      displayName: `${id} codec`,
      spec: { operations: [] },
    }),
  )
  await mkdir(join(root, 'contributions', 'nested'), { recursive: true })
  await writeFile(
    join(root, 'contributions', 'nested', 'ignored.json'),
    JSON.stringify({
      schemaVersion: 1,
      contract: { id: 'org.modkitx/codec-contribution', major: 1 },
      id: `${publisher}/${id}-nested`,
      displayName: 'Must not be discovered recursively',
    }),
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: `extension-${id}`,
      displayName: `${id} tools`,
      version: '1.2.3',
      license: 'MIT',
      description: `${id} extension`,
      modkit: {
        schemaVersion: 1,
        publisher,
        id,
        contributionManifests: ['./contributions/*.json'],
      },
      ...overrides,
    }),
  )
}

async function writeRepository(root, sourceName, extensionId) {
  const extensionRoot = join(root, 'extensions', extensionId)
  await writeExtension(extensionRoot, 'example.local', extensionId)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: `@example/${sourceName}`,
      version: '4.5.6',
      description: `${sourceName} repository`,
      license: 'MIT',
    }),
  )
  await writeFile(
    join(root, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: `example.local/${extensionId}`, path: `extensions/${extensionId}` }],
    }),
  )
}

test('discovers bounded local candidates from the nearest parent workspace and env overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-local-candidates-'))
  const defaultRepository = join(root, 'default-repository')
  const overrideRepository = join(root, 'override-repository')
  const nestedCore = join(root, 'modkit-core', 'packages', 'consumer')
  await mkdir(defaultRepository, { recursive: true })
  await mkdir(overrideRepository, { recursive: true })
  await mkdir(nestedCore, { recursive: true })
  await writeRepository(defaultRepository, 'default-source', 'alpha')
  await writeRepository(overrideRepository, 'override-source', 'beta')
  await writeFile(
    join(root, 'modkit.workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      activeProfile: 'focused',
      sources: [
        { id: 'alpha-source', uri: './default-repository' },
        {
          id: 'beta-source',
          uri: './missing-default',
          environment: 'MODKIT_TEST_BETA_ROOT',
        },
        { id: 'remote-source', uri: 'https://example.invalid/extensions.json' },
      ],
      profiles: { focused: { sources: ['alpha-source'], extensions: ['*'] } },
    }),
  )

  const result = await discoverLocalExtensionCandidates({
    workspaceRoot: nestedCore,
    environment: { MODKIT_TEST_BETA_ROOT: overrideRepository },
  })

  assert.equal(result.configurationPath, join(root, 'modkit.workspace.json'))
  assert.equal(result.repositories.length, 2)
  assert.deepEqual(
    result.repositories.map(repository => [repository.sourceId, repository.selected]),
    [
      ['alpha-source', true],
      ['beta-source', false],
    ],
  )
  assert.equal(result.repositories[0].displayName, '@example/default-source')
  assert.equal(result.extensions.length, 2)
  assert.deepEqual(
    result.extensions.map(extension => [extension.id, extension.selected]),
    [
      ['example.local/alpha', true],
      ['example.local/beta', false],
    ],
  )
  assert.equal(result.extensions[0].summary, 'alpha extension')
  assert.deepEqual(result.extensions[0].contributionManifests, ['contributions/*.json'])
  assert.deepEqual(
    result.extensions[0].contributions.map(contribution => [
      contribution.id,
      contribution.contract.id,
    ]),
    [['example.local/alpha-codec', 'org.modkitx/codec-contribution']],
  )
  assert.equal(result.extensions[0].diagnostics.length, 0)
  assert.deepEqual(
    result.diagnostics.map(item => [item.code, item.sourceId]),
    [['extension-manager/non-local-source-skipped', 'remote-source']],
  )
})

test('bounds contribution inspection and keeps the extension candidate available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-local-contribution-bounds-'))
  const repository = join(root, 'repository')
  await mkdir(repository, { recursive: true })
  await writeExtension(join(repository, 'demo'), 'example.bound', 'demo')
  await writeFile(
    join(repository, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'example.bound/demo', path: 'demo' }],
    }),
  )
  const configurationPath = join(root, 'modkit.workspace.json')
  await writeFile(
    configurationPath,
    JSON.stringify({
      schemaVersion: 1,
      sources: [{ id: 'bound', uri: './repository' }],
    }),
  )

  const result = await discoverLocalExtensionCandidates({
    configurationPath,
    maxContributionFileBytes: 1,
  })

  assert.equal(result.extensions.length, 1)
  assert.equal(result.extensions[0].contributions.length, 0)
  assert.equal(
    result.extensions[0].diagnostics[0].code,
    'extension-manager/contribution-byte-limit',
  )
  assert.equal(result.diagnostics[0].code, 'extension-manager/contribution-byte-limit')
})

test('reports confined-path failures without walking or aborting other repositories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-local-candidates-confined-'))
  const goodRepository = join(root, 'good')
  const badRepository = join(root, 'bad')
  const outside = join(root, 'outside')
  await mkdir(goodRepository, { recursive: true })
  await mkdir(badRepository, { recursive: true })
  await writeExtension(join(goodRepository, 'demo'), 'example.good', 'demo')
  await writeExtension(outside, 'example.bad', 'escape')
  await writeFile(
    join(goodRepository, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'example.good/demo', path: 'demo' }],
    }),
  )
  await writeFile(
    join(badRepository, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'example.bad/escape', path: '../outside' }],
    }),
  )
  const configurationPath = join(root, 'modkit.workspace.json')
  await writeFile(
    configurationPath,
    JSON.stringify({
      schemaVersion: 1,
      sources: [
        { id: 'bad', uri: './bad' },
        { id: 'good', uri: './good' },
      ],
    }),
  )

  const result = await discoverLocalExtensionCandidates({ configurationPath })

  assert.deepEqual(
    result.extensions.map(extension => extension.id),
    ['example.good/demo'],
  )
  assert.equal(result.repositories.length, 2)
  assert.equal(
    result.repositories.find(repository => repository.sourceId === 'bad').extensions.length,
    0,
  )
  assert.ok(
    result.diagnostics.some(
      item => item.sourceId === 'bad' && item.code === 'extension-manager/path-escape',
    ),
  )
})

test('enforces explicit discovery bounds before inspecting repository trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'modkit-local-candidates-bounds-'))
  const configurationPath = join(root, 'modkit.workspace.json')
  await writeFile(
    configurationPath,
    JSON.stringify({
      schemaVersion: 1,
      sources: [
        { id: 'one', uri: './one' },
        { id: 'two', uri: './two' },
      ],
    }),
  )

  await assert.rejects(
    discoverLocalExtensionCandidates({ configurationPath, maxSources: 1 }),
    error => error.code === 'extension-manager/source-limit',
  )
})
