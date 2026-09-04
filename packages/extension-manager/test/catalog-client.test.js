import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareCatalogVersions,
  createExtensionManagerClient,
  extensionCatalogSigningBytes,
  isRemoteCatalogUri,
  parseExtensionCatalog,
  validateExtensionCatalog,
} from '../dist/index.js'

const signature = Object.freeze({
  algorithm: 'Ed25519',
  keyId: 'modkit.test-key',
  value: 'AA==',
})

function version(value, source, channel = 'stable', extensions = ['example.publisher/codec']) {
  return {
    version: value,
    channel,
    source,
    extensions,
    hostApi: '>=0.1.0 <1',
  }
}

function localSource(uri = '../example-extension') {
  return { kind: 'repository', uri, trust: { mode: 'local-user' } }
}

function remoteSource(integrity = `sha256:${'a'.repeat(64)}`) {
  return {
    kind: 'bundle',
    uri: 'https://cdn.example.invalid/example-extension.tgz',
    integrity,
    trust: { mode: 'signed' },
  }
}

function catalog(versions, options = {}) {
  return {
    $schema: '../schemas/modkit.registry.schema.json',
    schemaVersion: 1,
    registryId: 'modkit/development',
    generatedAt: '2026-08-29T00:00:00.000Z',
    packages: [
      {
        id: 'example.publisher/toolkit',
        publisher: 'example.publisher',
        displayName: 'Example toolkit',
        summary: 'Fake-based extension manager fixture.',
        license: 'MIT',
        presentation: {
          displayName: 'Example toolkit presentation',
          description: 'Human-facing toolkit metadata.',
          vendor: { id: 'example.publisher', displayName: 'Example Publisher' },
          games: [{ id: 'example.publisher/example-game', displayName: 'Example Game' }],
          icon: { path: './assets/toolkit.png', mediaType: 'image/png' },
          source: { kind: 'url', url: 'https://example.invalid/toolkit' },
          licenseFiles: [{ path: 'LICENSE.txt', displayName: 'MIT License' }],
        },
        versions,
      },
    ],
    ...(options.signed === true ? { signature } : {}),
  }
}

function fakeClient(options = {}) {
  let cached = options.cached
  let refreshed = options.refreshed ?? cached
  let installed = [...(options.installed ?? [])]
  let enablement = [...(options.enablement ?? [])]
  const acquiredEntries = []
  const calls = {
    cached: 0,
    refresh: 0,
    acquire: 0,
    listArtifacts: 0,
    install: 0,
    remove: 0,
    listEnablement: 0,
    setEnabled: 0,
    removeEnablement: 0,
  }
  const catalogSource = {
    async cached() {
      calls.cached += 1
      return cached
    },
    async refresh() {
      calls.refresh += 1
      cached = refreshed
      return refreshed
    },
  }
  const artifactAcquirer = {
    async acquire(entry) {
      calls.acquire += 1
      acquiredEntries.push(entry)
      if (options.acquire !== undefined) return options.acquire(entry)
      return { artifact: { uri: entry.source.uri }, integrity: entry.source.integrity }
    },
  }
  const artifactStore = {
    async list() {
      calls.listArtifacts += 1
      return installed
    },
    async install(request) {
      calls.install += 1
      const result = {
        id: request.entry.id,
        version: request.entry.version,
        displayName: request.entry.displayName,
        publisher: request.entry.publisher,
        source: request.entry.source.uri,
        trusted: request.entry.trusted,
        ...(request.entry.presentation === undefined
          ? {}
          : { presentation: request.entry.presentation }),
        roots: request.entry.extensions.map(expectedId => ({
          root: `/extensions/${expectedId.replaceAll('/', '-')}`,
          expectedId,
        })),
      }
      installed = [...installed.filter(entry => entry.id !== result.id), result]
      return options.installResult === undefined ? result : options.installResult(request, result)
    },
    async remove(id) {
      calls.remove += 1
      installed = installed.filter(entry => entry.id !== id)
    },
  }
  const enablementStore = {
    async list() {
      calls.listEnablement += 1
      return enablement
    },
    async setEnabled(id, enabled) {
      calls.setEnabled += 1
      await options.onSetEnabled?.(id, enabled)
      enablement = [...enablement.filter(entry => entry.id !== id), { id, enabled }]
    },
    async remove(id) {
      calls.removeEnablement += 1
      enablement = enablement.filter(entry => entry.id !== id)
    },
  }
  const client = createExtensionManagerClient({
    catalogSource,
    artifactAcquirer,
    artifactStore,
    enablementStore,
  })
  return {
    client,
    calls,
    installed: () => installed,
    enablement: () => enablement,
    acquiredEntries,
    setRefreshed(value) {
      refreshed = value
    },
  }
}

test('parses the registry schema shape and compares semantic versions deterministically', () => {
  const input = catalog([
    version('0.1.0-development.1', localSource(), 'development'),
    version('0.1.0', localSource()),
  ])
  assert.deepEqual(validateExtensionCatalog(input), [])
  const parsed = parseExtensionCatalog(input)
  assert.equal(parsed.packages[0].versions[0].extensions[0], 'example.publisher/codec')
  assert.equal(parsed.packages[0].presentation.vendor.displayName, 'Example Publisher')
  assert.equal(Object.isFrozen(parsed.packages[0].versions), true)
  assert.equal(compareCatalogVersions('0.1.0-development.1', '0.1.0'), -1)
  assert.equal(compareCatalogVersions('2.0.0', '1.99.99'), 1)
})

test('validator rejects unknown fields, duplicate ids and remote code without signed sha256 metadata', () => {
  const input = catalog([version('1.0.0', localSource())])
  input.unexpected = true
  input.packages.push(structuredClone(input.packages[0]))
  input.packages[0].versions[0].source = {
    kind: 'bundle',
    uri: 'https://cdn.example.invalid/unsigned.tgz',
    trust: { mode: 'local-user' },
  }
  const issues = validateExtensionCatalog(input)
  assert(issues.some(item => item.path === 'unexpected'))
  assert(issues.some(item => item.path === 'packages[1].id' && item.message === 'is duplicated'))
  assert(issues.some(item => item.message === 'remote sources must use signed trust'))
  assert(issues.some(item => item.message === 'remote sources require sha256 integrity'))
  assert(issues.some(item => item.path === 'signature'))
  assert.throws(() => parseExtensionCatalog(input), {
    code: 'extension-manager/catalog-invalid',
  })
})

test('presentation validation confines asset/root paths and HTTP(S) source URLs', () => {
  const cases = [
    { icon: { path: '../icon.png' } },
    { icon: { path: 'C:/icon.png' } },
    { icon: { path: 'assets\\icon.png' } },
    { source: { kind: 'root', root: 'src/../../outside' } },
    { source: { kind: 'url', url: 'file:///source' } },
    { licenseFiles: [{ path: '/LICENSE' }] },
  ]
  for (const invalid of cases) {
    const input = catalog([version('1.0.0', localSource())])
    input.packages[0].presentation = invalid
    assert.notDeepEqual(validateExtensionCatalog(input), [], JSON.stringify(invalid))
  }
})

test('signing bytes admit only the missing root signature for an otherwise valid remote catalog', () => {
  const unsigned = catalog([version('1.0.0', remoteSource())])
  assert.throws(() => parseExtensionCatalog(unsigned), {
    code: 'extension-manager/catalog-invalid',
  })
  const signed = { ...unsigned, signature }
  assert.deepEqual(extensionCatalogSigningBytes(unsigned), extensionCatalogSigningBytes(signed))

  const malformed = structuredClone(unsigned)
  delete malformed.packages[0].versions[0].source.integrity
  assert.throws(() => extensionCatalogSigningBytes(malformed), {
    code: 'extension-manager/catalog-invalid',
  })
})

test('ipfs and unknown absolute schemes cannot bypass remote trust policy', () => {
  for (const uri of ['ipfs://bafy/example.tgz', 'modkit+cdn://catalog/example.tgz']) {
    const input = catalog([version('1.0.0', localSource(uri))])
    const issues = validateExtensionCatalog(input)
    assert(
      issues.some(item => item.message === 'remote sources must use signed trust'),
      uri,
    )
    assert(
      issues.some(item => item.message === 'remote sources require sha256 integrity'),
      uri,
    )
    assert(
      issues.some(item => item.path === 'signature'),
      uri,
    )
  }
})

test('UNC and hosted file URLs cannot inherit unsigned local-user trust', () => {
  for (const uri of [
    'file://server/share/extension.json',
    'file:////server/share/extension.json',
    'rapid+file://server/share/extension.sdp',
    'rapid+file:////server/share/extension.sdp',
    '\\\\server\\share\\extension.json',
  ]) {
    assert.equal(isRemoteCatalogUri(uri), true, uri)
    const issues = validateExtensionCatalog(catalog([version('1.0.0', localSource(uri))]))
    assert(
      issues.some(item => item.message === 'remote sources must use signed trust'),
      uri,
    )
    assert(
      issues.some(item => item.message === 'remote sources require sha256 integrity'),
      uri,
    )
    assert(
      issues.some(item => item.path === 'signature'),
      uri,
    )
  }
  assert.equal(isRemoteCatalogUri('file:///C:/Users/example/extension.json'), false)
  assert.equal(isRemoteCatalogUri('file:///var/lib/modkit/extension.json'), false)
  assert.equal(isRemoteCatalogUri('rapid+file:///C:/games/pool/package.sdp'), false)
  assert.equal(isRemoteCatalogUri('rapid+file:///var/lib/rapid/package.sdp'), false)
})

test('construction and an empty snapshot perform no network, acquisition or writes', async () => {
  const state = fakeClient({ cached: undefined })
  assert.deepEqual(state.calls, {
    cached: 0,
    refresh: 0,
    acquire: 0,
    listArtifacts: 0,
    install: 0,
    remove: 0,
    listEnablement: 0,
    setEnabled: 0,
    removeEnablement: 0,
  })
  assert.deepEqual(await state.client.snapshot(), { entries: [] })
  assert.equal(state.calls.cached, 1)
  assert.equal(state.calls.refresh, 0)
  assert.equal(state.calls.acquire, 0)
  assert.equal(state.calls.install, 0)
  assert.equal(state.calls.setEnabled, 0)
})

test('snapshot merges cached catalog, installed state and enablement without refreshing', async () => {
  const state = fakeClient({
    cached: catalog([version('2.0.0', localSource())]),
    installed: [
      {
        id: 'example.publisher/toolkit',
        version: '1.0.0',
        source: 'local-cache',
        trusted: true,
        roots: [
          { root: '/extensions/example-publisher-codec', expectedId: 'example.publisher/codec' },
        ],
      },
    ],
    enablement: [{ id: 'example.publisher/toolkit', enabled: false }],
  })
  const snapshot = await state.client.snapshot()
  assert.deepEqual(
    snapshot.entries.map(entry =>
      Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'presentation')),
    ),
    [
      {
        id: 'example.publisher/toolkit',
        displayName: 'Example toolkit',
        publisher: 'example.publisher',
        availableVersion: '2.0.0',
        installedVersion: '1.0.0',
        enabled: false,
        updateAvailable: true,
        source: '../example-extension',
        trusted: true,
      },
    ],
  )
  assert.equal(snapshot.entries[0].presentation.vendor.id, 'example.publisher')
  assert.equal(state.calls.refresh, 0)
  assert.equal(state.calls.acquire, 0)
  assert.equal(state.calls.install, 0)
  assert.equal(state.calls.setEnabled, 0)
})

test('missing enablement is fail-closed for installed packages', async () => {
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource())]),
    installed: [
      {
        id: 'example.publisher/toolkit',
        version: '1.0.0',
        roots: [
          { root: '/extensions/example-publisher-codec', expectedId: 'example.publisher/codec' },
        ],
      },
    ],
  })
  assert.equal((await state.client.snapshot()).entries[0].enabled, false)
})

test('an unsigned remote catalog cannot trust even a local file artifact', async () => {
  const document = catalog([version('1.0.0', localSource('file:///opt/modkit/extension'))])
  const state = fakeClient({
    cached: { catalog: document, source: 'https://registry.example/catalog.json' },
  })
  assert.equal((await state.client.snapshot()).entries[0].trusted, false)
  await assert.rejects(() => state.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-untrusted',
  })
  assert.equal(state.calls.acquire, 0)
})

test('a signed remote catalog cannot grant ambient local-user authority to a file artifact', async () => {
  const document = catalog(
    [version('1.0.0', localSource('file:///opt/modkit/mutable-extension'))],
    { signed: true },
  )
  const state = fakeClient({
    cached: {
      catalog: document,
      source: 'https://registry.example/catalog.json',
      signatureVerified: true,
    },
  })
  assert.equal((await state.client.snapshot()).entries[0].trusted, false)
  await assert.rejects(() => state.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-untrusted',
  })
  assert.equal(state.calls.acquire, 0)
})

test('a signed remote catalog can trust only sha256-pinned HTTP(S) artifact transport', async () => {
  const sha256 = `sha256:${'a'.repeat(64)}`
  const ambientSources = [
    { kind: 'bundle', uri: 'file:///opt/modkit/local.mkx', trust: { mode: 'signed' } },
    {
      kind: 'bundle',
      uri: 'rapid+file:///opt/modkit/local.sdp',
      trust: { mode: 'signed' },
    },
    { kind: 'bundle', uri: 'browser-file:selected', trust: { mode: 'signed' } },
    { kind: 'bundle', uri: 'memory://fixture/local.mkx', trust: { mode: 'signed' } },
    {
      kind: 'bundle',
      uri: 'file://server/share/remote.mkx',
      integrity: sha256,
      trust: { mode: 'signed' },
    },
    {
      kind: 'bundle',
      uri: 'rapid+file://server/share/remote.sdp',
      integrity: sha256,
      trust: { mode: 'signed' },
    },
  ]
  for (const source of ambientSources) {
    const document = catalog([version('1.0.0', source)], { signed: true })
    const state = fakeClient({
      cached: {
        catalog: document,
        source: 'https://registry.example/catalog.json',
        signatureVerified: true,
      },
    })
    assert.equal((await state.client.snapshot()).entries[0].trusted, false, source.uri)
    await assert.rejects(() => state.client.install('example.publisher/toolkit'), {
      code: 'extension-manager/artifact-untrusted',
    })
    assert.equal(state.calls.acquire, 0, source.uri)
  }
})

test('refresh is the only catalog network boundary', async () => {
  const state = fakeClient({
    cached: undefined,
    refreshed: catalog([version('1.0.0', localSource())]),
  })
  assert.deepEqual(await state.client.snapshot(), { entries: [] })
  await state.client.refresh()
  assert.equal(state.calls.refresh, 1)
  assert.equal((await state.client.snapshot()).entries[0].availableVersion, '1.0.0')
  assert.equal(state.calls.cached, 1)
  assert.equal(state.calls.acquire, 0)
})

test('explicit local install, update, enablement and removal flow only through their ports', async () => {
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource()), version('2.0.0', localSource())]),
  })
  await state.client.install('example.publisher/toolkit', '1.0.0')
  assert.equal(state.calls.acquire, 1)
  assert.equal(state.calls.install, 1)
  assert.deepEqual(state.enablement(), [{ id: 'example.publisher/toolkit', enabled: true }])
  assert.equal((await state.client.snapshot()).entries[0].updateAvailable, true)

  await state.client.update('example.publisher/toolkit')
  assert.equal(state.installed()[0].version, '2.0.0')
  assert.equal(state.calls.acquire, 2)
  await state.client.setEnabled('example.publisher/toolkit', false)
  assert.deepEqual(state.enablement(), [{ id: 'example.publisher/toolkit', enabled: false }])
  await state.client.remove('example.publisher/toolkit')
  assert.deepEqual(state.installed(), [])
  assert.deepEqual(state.enablement(), [])
})

test('fresh install refuses an already installed package before acquisition', async () => {
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource())]),
    installed: [
      {
        id: 'example.publisher/toolkit',
        version: '1.0.0',
        roots: [
          { root: '/extensions/example-publisher-codec', expectedId: 'example.publisher/codec' },
        ],
      },
    ],
  })
  await assert.rejects(() => state.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-already-installed',
  })
  assert.equal(state.calls.acquire, 0)
  assert.equal(state.calls.setEnabled, 0)
})

test('post-store validation failure compensates artifact and enablement state', async () => {
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource())]),
    installResult: (_request, installed) => ({ ...installed, version: '9.9.9' }),
  })
  await assert.rejects(() => state.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-store-invalid',
  })
  assert.deepEqual(state.installed(), [])
  assert.deepEqual(state.enablement(), [])
  assert.equal((await state.client.snapshot()).entries[0].enabled, false)
})

test('final enablement failure compensates a freshly installed artifact', async () => {
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource())]),
    onSetEnabled: (_id, enabled) => {
      if (enabled) throw new Error('simulated enablement failure')
    },
  })
  await assert.rejects(
    () => state.client.install('example.publisher/toolkit'),
    /simulated enablement failure/u,
  )
  assert.deepEqual(state.installed(), [])
  assert.deepEqual(state.enablement(), [])
})

test('concurrent mutations are serialized across artifact and enablement stores', async () => {
  const state = fakeClient({ cached: catalog([version('1.0.0', localSource())]) })
  await Promise.all([
    state.client.install('example.publisher/toolkit'),
    state.client.setEnabled('example.publisher/toolkit', false),
  ])
  assert.equal(state.installed().length, 1)
  assert.deepEqual(state.enablement(), [{ id: 'example.publisher/toolkit', enabled: false }])
})

test('remote install requires a verified catalog signature and the acquired sha256 digest', async () => {
  const document = catalog([version('1.0.0', remoteSource())], { signed: true })
  const unverified = fakeClient({
    cached: { catalog: document, source: 'https://registry.example/catalog.json' },
  })
  assert.equal((await unverified.client.snapshot()).entries[0].trusted, false)
  await assert.rejects(() => unverified.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-untrusted',
  })
  assert.equal(unverified.calls.acquire, 0)

  const mismatch = fakeClient({
    cached: {
      catalog: document,
      source: 'https://registry.example/catalog.json',
      signatureVerified: true,
    },
    acquire: async () => ({ artifact: new Uint8Array([1]), integrity: `sha256:${'b'.repeat(64)}` }),
  })
  await assert.rejects(() => mismatch.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/integrity-mismatch',
  })
  assert.equal(mismatch.calls.install, 0)

  const verified = fakeClient({
    cached: {
      catalog: document,
      source: 'https://registry.example/catalog.json',
      signatureVerified: true,
    },
  })
  await verified.client.install('example.publisher/toolkit')
  assert.equal(verified.calls.acquire, 1)
  assert.equal(verified.calls.install, 1)
  assert.equal(verified.installed()[0].trusted, true)
})

test('relative artifacts in an HTTPS catalog resolve remotely before trust checks and acquisition', async () => {
  const source = remoteSource()
  source.uri = './artifacts/example-extension.tgz'
  const document = catalog([version('1.0.0', source)], { signed: true })
  const state = fakeClient({
    cached: {
      catalog: document,
      source: 'https://registry.example/catalog/stable.json',
      signatureVerified: true,
    },
  })
  const snapshot = await state.client.snapshot()
  assert.equal(
    snapshot.entries[0].source,
    'https://registry.example/catalog/artifacts/example-extension.tgz',
  )
  assert.equal(snapshot.entries[0].trusted, true)
  await state.client.install('example.publisher/toolkit')
  assert.equal(
    state.acquiredEntries[0].source.uri,
    'https://registry.example/catalog/artifacts/example-extension.tgz',
  )

  const unsafeSource = localSource('./artifacts/unsafe.tgz')
  const unsafe = fakeClient({
    cached: {
      catalog: catalog([version('1.0.0', unsafeSource)]),
      source: 'https://registry.example/catalog/stable.json',
    },
  })
  await assert.rejects(() => unsafe.client.install('example.publisher/toolkit'), {
    code: 'extension-manager/artifact-untrusted',
  })
  assert.equal(unsafe.calls.acquire, 0)
})

test('one installed catalog package preserves every contained extension root', async () => {
  const extensions = [
    'example.publisher/archive-codec',
    'example.publisher/language-service',
    'example.publisher/game-workflows',
  ]
  const state = fakeClient({
    cached: catalog([version('1.0.0', localSource(), 'stable', extensions)]),
  })
  await state.client.install('example.publisher/toolkit')
  assert.deepEqual(
    state.installed()[0].roots.map(root => root.expectedId),
    extensions,
  )
  const snapshot = await state.client.snapshot()
  assert.equal(snapshot.entries.length, 1)
  assert.equal(snapshot.entries[0].id, 'example.publisher/toolkit')
  assert.equal(snapshot.entries[0].presentation.vendor.id, 'example.publisher')
})

function gamePackage(id, gameId, displayName = id) {
  return {
    id,
    publisher: id.split('/')[0],
    displayName,
    summary: `Support package for ${gameId}.`,
    presentation: {
      displayName,
      vendor: { id: id.split('/')[0], displayName: 'Example Publisher' },
      games: [{ id: gameId, displayName: 'Arbitrary Test Game' }],
    },
    versions: [version('2.0.0', localSource(), 'stable', [`${id}.extension`])],
  }
}

function installedPackage(id, versionValue = '1.0.0') {
  return {
    id,
    version: versionValue,
    roots: [{ root: `/extensions/${id.replaceAll('/', '-')}`, expectedId: `${id}.extension` }],
  }
}

test('game support planning is metadata-driven, deterministic and applies every package', async () => {
  const gameId = 'another.vendor/arbitrary-game'
  const document = catalog([version('2.0.0', localSource())])
  document.packages = [
    gamePackage('example.publisher/zeta-kit', gameId, 'Zeta Kit'),
    gamePackage('example.publisher/alpha-kit', gameId, 'Alpha Kit'),
  ]
  const state = fakeClient({ cached: document })

  const plan = await state.client.planGameSupport(gameId)
  assert.deepEqual(
    plan.targets.map(target => target.packageId),
    ['example.publisher/alpha-kit', 'example.publisher/zeta-kit'],
  )
  assert.deepEqual(
    plan.actions.map(action => `${action.kind}:${action.packageId}`),
    ['install:example.publisher/alpha-kit', 'install:example.publisher/zeta-kit'],
  )
  assert.equal(plan.ready, true)
  assert.equal(state.calls.install, 0)

  const result = await state.client.applyGameSupport(plan)
  assert.equal(result.status, 'applied')
  assert.deepEqual(
    state
      .installed()
      .map(entry => entry.id)
      .sort(),
    ['example.publisher/alpha-kit', 'example.publisher/zeta-kit'],
  )
  assert.deepEqual(
    state.enablement().sort((left, right) => left.id.localeCompare(right.id)),
    [
      { id: 'example.publisher/alpha-kit', enabled: true },
      { id: 'example.publisher/zeta-kit', enabled: true },
    ],
  )
})

test('game support apply rejects a stale preview before making another change', async () => {
  const gameId = 'another.vendor/arbitrary-game'
  const document = catalog([version('2.0.0', localSource())])
  document.packages = [gamePackage('example.publisher/toolkit', gameId)]
  const state = fakeClient({
    cached: document,
    installed: [installedPackage('example.publisher/toolkit', '2.0.0')],
    enablement: [{ id: 'example.publisher/toolkit', enabled: false }],
  })
  const plan = await state.client.planGameSupport(gameId)
  await state.client.setEnabled('example.publisher/toolkit', true)
  const writesBeforeApply = state.calls.setEnabled
  await assert.rejects(() => state.client.applyGameSupport(plan), {
    code: 'extension-manager/game-support-plan-stale',
  })
  assert.equal(state.calls.setEnabled, writesBeforeApply)
})

test('game support batch rolls back fresh installs when a later install fails', async () => {
  const gameId = 'another.vendor/arbitrary-game'
  const document = catalog([version('2.0.0', localSource())])
  document.packages = [
    gamePackage('example.publisher/alpha-kit', gameId),
    gamePackage('example.publisher/zeta-kit', gameId),
  ]
  const state = fakeClient({
    cached: document,
    acquire: async entry => {
      if (entry.id.endsWith('/zeta-kit')) throw new Error('simulated second acquire failure')
      return { artifact: { id: entry.id }, integrity: entry.source.integrity }
    },
  })
  const result = await state.client.applyGameSupport(await state.client.planGameSupport(gameId))
  assert.equal(result.status, 'rolled-back')
  assert.deepEqual(state.installed(), [])
  assert.deepEqual(state.enablement(), [])
  assert.deepEqual(result.rollback, [
    {
      packageId: 'example.publisher/alpha-kit',
      kind: 'install',
      status: 'rolled-back',
    },
  ])
})

test('game support batch reports partial state when an update cannot be reversed', async () => {
  const gameId = 'another.vendor/arbitrary-game'
  const document = catalog([version('2.0.0', localSource())])
  document.packages = [
    gamePackage('example.publisher/alpha-kit', gameId),
    gamePackage('example.publisher/zeta-kit', gameId),
  ]
  const state = fakeClient({
    cached: document,
    installed: [
      installedPackage('example.publisher/alpha-kit'),
      installedPackage('example.publisher/zeta-kit'),
    ],
    enablement: [
      { id: 'example.publisher/alpha-kit', enabled: true },
      { id: 'example.publisher/zeta-kit', enabled: true },
    ],
    acquire: async entry => {
      if (entry.id.endsWith('/zeta-kit')) throw new Error('simulated update failure')
      return { artifact: { id: entry.id }, integrity: entry.source.integrity }
    },
  })
  const result = await state.client.applyGameSupport(await state.client.planGameSupport(gameId))
  assert.equal(result.status, 'partial')
  assert.equal(result.failed.kind, 'update')
  assert.deepEqual(result.rollback, [
    {
      packageId: 'example.publisher/alpha-kit',
      kind: 'update',
      status: 'not-reversible',
    },
  ])
  assert.equal(state.installed().find(entry => entry.id.endsWith('/alpha-kit')).version, '2.0.0')
})
