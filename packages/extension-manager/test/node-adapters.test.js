import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createNodeArtifactAcquirer,
  createNodeArtifactStore,
  createNodeEnablementStore,
  createNodeExtensionManager,
  extensionCatalogSigningBytes,
  verifyExtensionCatalogSignature,
} from '../src/node.js'

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sorted(value[key])]),
  )
}

function signingBytes(catalog) {
  const unsigned = Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key !== 'signature'),
  )
  return Buffer.from(`${JSON.stringify(sorted(unsigned))}\n`, 'utf8')
}

function signedCatalog(catalog, privateKey, keyId) {
  const signature = sign(null, signingBytes(catalog), privateKey).toString('base64')
  return {
    ...catalog,
    signature: { algorithm: 'Ed25519', keyId, value: signature },
  }
}

function portableRepository(expectedIds) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      extensions: expectedIds.map(id => ({
        id,
        files: {
          'package.json': Buffer.from(packageJson(id)).toString('base64'),
          'src/index.js': Buffer.from('export const ready = true\n').toString('base64'),
        },
      })),
    }),
  )
}

function catalogPackage(source, extensions, options = {}) {
  const { presentation, ...catalogOptions } = options
  return {
    schemaVersion: 1,
    registryId: 'modkit/test-registry',
    generatedAt: '2026-08-30T00:00:00.000Z',
    packages: [
      {
        id: 'example.publisher/toolkit',
        publisher: 'example.publisher',
        displayName: 'Example toolkit',
        summary: 'Node adapter test package.',
        ...(presentation === undefined ? {} : { presentation }),
        versions: [
          {
            version: '1.0.0',
            channel: 'stable',
            source,
            extensions,
          },
        ],
      },
    ],
    ...catalogOptions,
  }
}

function packageJson(expectedId) {
  const slash = expectedId.indexOf('/')
  return JSON.stringify({
    name: `@${expectedId}`,
    version: '1.0.0',
    type: 'module',
    modkit: { publisher: expectedId.slice(0, slash), id: expectedId.slice(slash + 1) },
  })
}

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'modkit-extension-manager-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function startFixtureServer(t, routes) {
  const calls = []
  const server = createServer((request, response) => {
    calls.push(request.url)
    const value = routes.get(request.url)
    if (value === undefined) {
      response.writeHead(404).end()
      return
    }
    if (typeof value === 'function') {
      value(request, response)
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(value.byteLength),
    })
    response.end(value)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  return {
    base: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('catalog signing bytes match the registry compact canonical fixed vector', () => {
  const value = catalogPackage(
    {
      kind: 'bundle',
      uri: './bundle.json',
      integrity: `sha256:${'a'.repeat(64)}`,
      bytes: 123,
      trust: { mode: 'signed' },
    },
    ['example.publisher/codec', 'example.publisher/language'],
  )
  assert.equal(
    createHash('sha256').update(extensionCatalogSigningBytes(value)).digest('hex'),
    'ffcaa963feeeb145ddbb1c05b30955acba7bb1d818dc14f8fa2ef3ea3aa84d09',
  )
})

test('local file catalog installs a package with multiple linked development roots', async t => {
  const fixture = await temporaryDirectory(t)
  const catalogRoot = join(fixture, 'catalog')
  const repositoryRoot = join(fixture, 'repository')
  const privateState = join(fixture, 'private')
  const expectedIds = ['example.publisher/codec', 'example.publisher/language']
  await mkdir(catalogRoot, { recursive: true })
  for (const [index, expectedId] of expectedIds.entries()) {
    const root = join(repositoryRoot, `extension-${index}`)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), packageJson(expectedId))
  }
  await writeFile(
    join(repositoryRoot, 'modkit.repository.json'),
    JSON.stringify({
      schemaVersion: 1,
      extensions: expectedIds.map((id, index) => ({ id, path: `extension-${index}` })),
    }),
  )
  const catalogPath = join(catalogRoot, 'development.json')
  await writeFile(
    catalogPath,
    JSON.stringify(
      catalogPackage(
        { kind: 'repository', uri: '../repository', trust: { mode: 'local-user' } },
        expectedIds,
        {
          presentation: {
            vendor: { id: 'example.publisher', displayName: 'Example Publisher' },
            icon: { path: 'assets/toolkit.png', mediaType: 'image/png' },
            licenseFiles: [{ path: './LICENSE.txt' }],
          },
        },
      ),
    ),
  )

  const manager = createNodeExtensionManager({ root: privateState, catalog: catalogPath })
  assert.equal(existsSync(privateState), false, 'construction must not create private state')
  assert.deepEqual(await manager.snapshot(), { entries: [] })
  assert.equal(existsSync(privateState), false, 'cached snapshot must remain read-only')

  await manager.refresh()
  assert.equal((await manager.snapshot()).entries[0].trusted, true)
  await manager.install('example.publisher/toolkit')
  assert.equal(
    (await manager.snapshot()).entries[0].presentation.vendor.displayName,
    'Example Publisher',
  )
  assert.equal((await manager.artifactStore.list())[0].presentation.icon.path, 'assets/toolkit.png')
  assert.deepEqual(
    (await manager.installedRoots()).map(entry => entry.expectedId),
    expectedIds,
  )
  assert.equal((await manager.snapshot()).entries[0].enabled, true)

  await manager.setEnabled('example.publisher/toolkit', false)
  assert.deepEqual(await manager.installedRoots(), [])
  await manager.setEnabled('example.publisher/toolkit', true)
  assert.equal((await manager.installedRoots()).length, 2)

  await manager.remove('example.publisher/toolkit')
  assert.deepEqual(await manager.installedRoots(), [])
  assert.equal(
    existsSync(repositoryRoot),
    true,
    'removing a link must not delete the user repository',
  )
  await manager.dispose()
})

test('UNC rapid sources are rejected before Node artifact acquisition gets filesystem authority', async t => {
  const fixture = await temporaryDirectory(t)
  const catalogPath = join(fixture, 'catalog.json')
  let opens = 0
  const vfs = {
    async openMount() {
      opens += 1
      throw new Error('UNC rapid source must not reach VFS')
    },
  }
  for (const [index, uri] of [
    'rapid+file://server/share/extension.sdp',
    'rapid+file:////server/share/extension.sdp',
  ].entries()) {
    await writeFile(
      catalogPath,
      JSON.stringify(
        catalogPackage({ kind: 'bundle', uri, trust: { mode: 'local-user' } }, [
          'example.publisher/codec',
        ]),
      ),
    )
    const manager = createNodeExtensionManager({
      root: join(fixture, `private-${index}`),
      catalog: catalogPath,
      vfs,
    })
    await assert.rejects(manager.refresh(), { code: 'extension-manager/catalog-invalid' })
    assert.deepEqual(await manager.snapshot(), { entries: [] })
    await manager.dispose()
  }
  assert.equal(opens, 0)
})

test('signed remote catalogs cannot reach ambient local or UNC VFS transports', async t => {
  const fixture = await temporaryDirectory(t)
  const sha256 = `sha256:${'a'.repeat(64)}`
  let opens = 0
  const vfs = {
    async openMount() {
      opens += 1
      throw new Error('remote catalog ambient transport must not reach VFS')
    },
  }
  const sources = [
    { kind: 'bundle', uri: 'file:///opt/modkit/local.mkx', trust: { mode: 'signed' } },
    {
      kind: 'bundle',
      uri: 'rapid+file:///opt/modkit/local.sdp',
      trust: { mode: 'signed' },
    },
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
  for (const [index, source] of sources.entries()) {
    const catalog = catalogPackage(source, ['example.publisher/codec'], {
      signature: {
        algorithm: 'Ed25519',
        keyId: 'modkit.test-key',
        value: 'AA==',
      },
    })
    const catalogSource = {
      cached: async () => ({
        catalog,
        source: 'https://registry.example/catalog.json',
        signatureVerified: true,
      }),
      refresh: async () => undefined,
    }
    const manager = createNodeExtensionManager({
      root: join(fixture, `signed-remote-${index}`),
      catalogSource,
      vfs,
    })
    assert.equal((await manager.snapshot()).entries[0].trusted, false, source.uri)
    await assert.rejects(manager.install('example.publisher/toolkit'), {
      code: 'extension-manager/artifact-untrusted',
    })
    await manager.dispose()
  }
  assert.equal(opens, 0)
})

test('cached catalog is ignored after the configured registry source changes', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const firstPath = join(fixture, 'first.json')
  const secondPath = join(fixture, 'second.json')
  const document = catalogPackage(
    { kind: 'repository', uri: './repository', trust: { mode: 'local-user' } },
    ['example.publisher/codec'],
  )
  await writeFile(firstPath, JSON.stringify(document))
  await writeFile(secondPath, JSON.stringify(document))

  const first = createNodeExtensionManager({ root: privateState, catalog: firstPath })
  await first.refresh()
  assert.equal((await first.snapshot()).entries.length, 1)
  await first.dispose()

  const second = createNodeExtensionManager({ root: privateState, catalog: secondPath })
  assert.deepEqual(await second.snapshot(), { entries: [] })
  await second.dispose()
})

test('strict signed local catalog persists lifecycle state across manager recreation', async t => {
  const fixture = await temporaryDirectory(t)
  const catalogRoot = join(fixture, 'catalog')
  const privateState = join(fixture, 'private')
  const catalogPath = join(catalogRoot, 'offline-catalog.json')
  const bundlePath = join(catalogRoot, 'toolkit.bundle.json')
  const expectedIds = ['example.publisher/codec']
  const bundle = portableRepository(expectedIds)
  const integrity = `sha256:${createHash('sha256').update(bundle).digest('hex')}`
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = 'modkit.offline-test'
  const catalog = signedCatalog(
    catalogPackage(
      {
        kind: 'bundle',
        uri: './toolkit.bundle.json',
        integrity,
        bytes: bundle.byteLength,
        trust: { mode: 'signed' },
      },
      expectedIds,
    ),
    privateKey,
    keyId,
  )
  const options = {
    root: privateState,
    catalog: catalogPath,
    trustedPublicKeys: { [keyId]: publicKey.export({ format: 'pem', type: 'spki' }) },
    requireSignature: true,
  }
  await mkdir(catalogRoot, { recursive: true })
  await writeFile(bundlePath, bundle)
  await writeFile(catalogPath, JSON.stringify(catalog))

  const first = createNodeExtensionManager(options)
  await first.refresh()
  assert.equal((await first.snapshot()).entries[0].trusted, true)
  await first.install('example.publisher/toolkit')
  await first.setEnabled('example.publisher/toolkit', false)
  await first.dispose()

  const reopened = createNodeExtensionManager(options)
  const disabled = (await reopened.snapshot()).entries[0]
  assert.equal(disabled.installedVersion, '1.0.0')
  assert.equal(disabled.enabled, false)
  assert.deepEqual(await reopened.installedRoots(), [])
  await reopened.setEnabled('example.publisher/toolkit', true)
  assert.equal((await reopened.installedRoots()).length, 1)
  await reopened.remove('example.publisher/toolkit')
  await reopened.dispose()

  const reinstalled = createNodeExtensionManager(options)
  assert.equal((await reinstalled.snapshot()).entries[0].installedVersion, undefined)
  await reinstalled.install('example.publisher/toolkit')
  assert.equal((await reinstalled.installedRoots()).length, 1)
  await reinstalled.dispose()
})

test('strict signature policy never caches rejected refreshes or disturbs an active package', async t => {
  const fixture = await temporaryDirectory(t)
  const catalogRoot = join(fixture, 'catalog')
  const privateState = join(fixture, 'private')
  const catalogPath = join(catalogRoot, 'offline-catalog.json')
  const bundlePath = join(catalogRoot, 'toolkit.bundle.json')
  const expectedIds = ['example.publisher/codec']
  const bundle = portableRepository(expectedIds)
  const integrity = `sha256:${createHash('sha256').update(bundle).digest('hex')}`
  const unsigned = catalogPackage(
    {
      kind: 'bundle',
      uri: './toolkit.bundle.json',
      integrity,
      bytes: bundle.byteLength,
      trust: { mode: 'signed' },
    },
    expectedIds,
  )
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = 'modkit.offline-test'
  const signed = signedCatalog(unsigned, privateKey, keyId)
  const options = {
    root: privateState,
    catalog: catalogPath,
    trustedPublicKeys: { [keyId]: publicKey.export({ format: 'pem', type: 'spki' }) },
    requireSignature: true,
  }
  await mkdir(catalogRoot, { recursive: true })
  await writeFile(bundlePath, bundle)
  await writeFile(catalogPath, JSON.stringify(unsigned))

  const manager = createNodeExtensionManager(options)
  await assert.rejects(manager.refresh(), { code: 'extension-manager/catalog-signature-required' })
  const cachePath = join(privateState, 'catalog.v1.json')
  assert.equal(existsSync(cachePath), false)

  await writeFile(catalogPath, JSON.stringify(signed))
  await manager.refresh()
  await manager.install('example.publisher/toolkit')
  const cachedBefore = await readFile(cachePath, 'utf8')
  assert.equal((await manager.installedRoots()).length, 1)

  const invalid = structuredClone(signed)
  invalid.signature.value = 'AA=='
  await writeFile(catalogPath, JSON.stringify(invalid))
  await assert.rejects(manager.refresh(), { code: 'extension-manager/catalog-signature-required' })
  assert.equal(await readFile(cachePath, 'utf8'), cachedBefore)
  assert.equal((await manager.snapshot()).entries[0].installedVersion, '1.0.0')
  assert.equal((await manager.installedRoots()).length, 1)
  await manager.dispose()

  // A previously written or manually damaged cache is also fail-closed on a fresh process. The
  // package bytes remain intact; only the untrusted catalog view is refused.
  const invalidState = JSON.parse(cachedBefore)
  invalidState.catalog = invalid
  await writeFile(cachePath, JSON.stringify(invalidState))
  const reopened = createNodeExtensionManager(options)
  await assert.rejects(reopened.snapshot(), {
    code: 'extension-manager/catalog-signature-required',
  })
  assert.equal((await reopened.artifactStore.list()).length, 1)
  await reopened.dispose()
})

test('signed HTTP catalog and portable repository materialize without network on cached reopen', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const expectedIds = ['example.publisher/codec', 'example.publisher/language']
  const portable = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      extensions: expectedIds.map(id => ({
        id,
        files: {
          'package.json': Buffer.from(packageJson(id)).toString('base64'),
          'src/index.js': Buffer.from('export const ready = true\n').toString('base64'),
        },
      })),
    }),
  )
  const integrity = `sha256:${createHash('sha256').update(portable).digest('hex')}`
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = 'modkit.test-key'
  const routes = new Map([['/bundle.json', portable]])
  const server = await startFixtureServer(t, routes)
  const unsigned = catalogPackage(
    {
      kind: 'bundle',
      uri: './bundle.json',
      integrity,
      bytes: portable.byteLength,
      trust: { mode: 'signed' },
    },
    expectedIds,
  )
  const catalog = signedCatalog(unsigned, privateKey, keyId)
  assert.deepEqual(Buffer.from(extensionCatalogSigningBytes(unsigned)), signingBytes(unsigned))
  routes.set('/catalog.json', Buffer.from(JSON.stringify(catalog)))
  const trustedPublicKeys = {
    [keyId]: publicKey.export({ format: 'pem', type: 'spki' }),
  }

  assert.equal(verifyExtensionCatalogSignature(catalog, trustedPublicKeys), true)
  const mutated = structuredClone(catalog)
  mutated.packages[0].displayName = 'Mutated'
  assert.equal(verifyExtensionCatalogSignature(mutated, trustedPublicKeys), false)

  const deniedState = join(fixture, 'denied-state')
  const denied = createNodeExtensionManager({
    root: deniedState,
    catalog: `${server.base}/catalog.json`,
    trustedPublicKeys,
  })
  await assert.rejects(denied.refresh(), {
    code: 'extension-manager/artifact-origin-refused',
  })
  assert.deepEqual(server.calls, [])
  await denied.dispose()
  server.calls.length = 0

  const manager = createNodeExtensionManager({
    root: privateState,
    catalog: `${server.base}/catalog.json`,
    trustedPublicKeys,
    vfsOptions: { allowedOrigins: [new URL(server.base).origin] },
  })
  assert.deepEqual(await manager.snapshot(), { entries: [] })
  assert.deepEqual(server.calls, [])
  await manager.refresh()
  assert.deepEqual(server.calls, ['/catalog.json'])
  assert.equal((await manager.snapshot()).entries[0].trusted, true)
  assert.deepEqual(server.calls, ['/catalog.json'])
  await manager.install('example.publisher/toolkit')
  assert.deepEqual(server.calls, ['/catalog.json', '/bundle.json'])
  const roots = await manager.installedRoots()
  assert.deepEqual(
    roots.map(entry => entry.expectedId),
    expectedIds,
  )
  for (const root of roots) {
    assert.equal(
      JSON.parse(await readFile(join(root.root, 'package.json'), 'utf8')).version,
      '1.0.0',
    )
  }
  await manager.dispose()

  await server.close()
  const cached = createNodeExtensionManager({
    root: privateState,
    catalog: `${server.base}/catalog.json`,
    trustedPublicKeys,
    fetch: async () => {
      throw new Error('cached manager must not use network')
    },
  })
  assert.equal((await cached.snapshot()).entries[0].installedVersion, '1.0.0')
  assert.equal((await cached.installedRoots()).length, 2)
  await cached.dispose()
})

test('artifact redirects enforce the origin allowlist before every request and bound loops', async t => {
  const bytes = Buffer.from('portable artifact bytes')
  const integrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const disallowed = await startFixtureServer(t, new Map([['/bundle.json', bytes]]))
  const routes = new Map()
  const allowed = await startFixtureServer(t, routes)
  routes.set('/bundle.json', bytes)
  routes.set('/allowed-redirect.json', (_request, response) => {
    response.writeHead(302, { location: '/bundle.json' }).end()
  })
  routes.set('/disallowed-redirect.json', (_request, response) => {
    response.writeHead(302, { location: `${disallowed.base}/bundle.json` }).end()
  })
  routes.set('/loop.json', (_request, response) => {
    response.writeHead(307, { location: '/loop.json' }).end()
  })
  const acquirer = createNodeArtifactAcquirer({
    vfsOptions: { allowedOrigins: [new URL(allowed.base).origin] },
  })
  const candidate = uri => ({
    id: 'example.publisher/toolkit',
    remote: true,
    trusted: true,
    source: {
      kind: 'bundle',
      uri,
      bytes: bytes.byteLength,
      integrity,
      trust: { mode: 'signed' },
    },
  })

  assert.equal(
    (await acquirer.acquire(candidate(`${allowed.base}/allowed-redirect.json`))).integrity,
    integrity,
  )
  await assert.rejects(
    () => acquirer.acquire(candidate(`${allowed.base}/disallowed-redirect.json`)),
    { code: 'extension-manager/artifact-origin-refused' },
  )
  assert.deepEqual(disallowed.calls, [], 'disallowed redirect target must never receive a request')
  const beforeLoop = allowed.calls.filter(url => url === '/loop.json').length
  await assert.rejects(() => acquirer.acquire(candidate(`${allowed.base}/loop.json`)), {
    code: 'extension-manager/artifact-redirect-refused',
  })
  assert.equal(allowed.calls.filter(url => url === '/loop.json').length - beforeLoop, 6)
  await acquirer.dispose()
})

test('catalog redirects enforce the origin allowlist before every request and bound loops', async t => {
  const fixture = await temporaryDirectory(t)
  const disallowed = await startFixtureServer(t, new Map([['/catalog.json', Buffer.from('{}')]]))
  const routes = new Map()
  const allowed = await startFixtureServer(t, routes)
  routes.set('/disallowed-redirect.json', (_request, response) => {
    response.writeHead(302, { location: `${disallowed.base}/catalog.json` }).end()
  })
  routes.set('/loop.json', (_request, response) => {
    response.writeHead(307, { location: '/loop.json' }).end()
  })
  const options = {
    root: join(fixture, 'private'),
    vfsOptions: { allowedOrigins: [new URL(allowed.base).origin] },
  }

  const redirected = createNodeExtensionManager({
    ...options,
    catalog: `${allowed.base}/disallowed-redirect.json`,
  })
  await assert.rejects(redirected.refresh(), {
    code: 'extension-manager/artifact-origin-refused',
  })
  assert.deepEqual(disallowed.calls, [], 'disallowed catalog target must receive zero requests')
  await redirected.dispose()

  const beforeLoop = allowed.calls.filter(url => url === '/loop.json').length
  const loop = createNodeExtensionManager({
    ...options,
    root: join(fixture, 'loop-private'),
    catalog: `${allowed.base}/loop.json`,
  })
  await assert.rejects(loop.refresh(), {
    code: 'extension-manager/artifact-redirect-refused',
  })
  assert.equal(allowed.calls.filter(url => url === '/loop.json').length - beforeLoop, 6)
  await loop.dispose()
})

test('portable store refuses remote path-only roots and path traversal before state write', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const store = createNodeArtifactStore({ root: privateState })
  const expectedId = 'example.publisher/codec'
  const entry = {
    id: 'example.publisher/toolkit',
    displayName: 'Example toolkit',
    publisher: 'example.publisher',
    version: '1.0.0',
    extensions: [expectedId],
    source: {
      kind: 'repository',
      uri: 'https://cdn.example.invalid/repository.json',
      trust: { mode: 'signed' },
    },
    remote: true,
    trusted: true,
  }
  const pathOnly = Buffer.from(
    JSON.stringify({ schemaVersion: 1, extensions: [{ id: expectedId, path: 'codec' }] }),
  )
  await assert.rejects(
    () =>
      store.install({
        entry,
        artifact: { kind: 'portable-repository', bytes: pathOnly },
        integrity: `sha256:${createHash('sha256').update(pathOnly).digest('hex')}`,
      }),
    { code: 'extension-manager/remote-path-only-refused' },
  )
  assert.equal(existsSync(join(privateState, 'packages.v1.json')), false)

  const escaping = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      extensions: [
        {
          id: expectedId,
          files: {
            '../escape.js': Buffer.from('escape').toString('base64'),
            'package.json': Buffer.from(packageJson(expectedId)).toString('base64'),
          },
        },
      ],
    }),
  )
  await assert.rejects(
    () =>
      store.install({
        entry,
        artifact: { kind: 'portable-repository', bytes: escaping },
        integrity: `sha256:${createHash('sha256').update(escaping).digest('hex')}`,
      }),
    { code: 'extension-manager/path-invalid' },
  )
  assert.equal(existsSync(join(fixture, 'escape.js')), false)
  assert.equal(existsSync(join(privateState, 'packages.v1.json')), false)
})

test('precreated content-addressed cache must equal the verified staged tree byte-for-byte', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const expectedId = 'example.publisher/codec'
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      extensions: [
        {
          id: expectedId,
          files: {
            'package.json': Buffer.from(packageJson(expectedId)).toString('base64'),
            'version.txt': Buffer.from('verified').toString('base64'),
          },
        },
      ],
    }),
  )
  const integrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const entry = {
    id: 'example.publisher/toolkit',
    displayName: 'Example toolkit',
    publisher: 'example.publisher',
    version: '1.0.0',
    extensions: [expectedId],
    source: { kind: 'bundle', uri: 'memory://registry/toolkit.json', trust: { mode: 'signed' } },
    remote: false,
    trusted: true,
  }
  const artifactKey = createHash('sha256')
    .update(`${entry.id}\0${entry.version}\0${integrity}`)
    .digest('hex')
  const poisonedRoot = join(privateState, 'artifacts', artifactKey, 'roots', '0')
  await mkdir(poisonedRoot, { recursive: true })
  await writeFile(join(poisonedRoot, 'package.json'), packageJson(expectedId))
  await writeFile(join(poisonedRoot, 'version.txt'), 'poisoned')

  const store = createNodeArtifactStore({ root: privateState })
  await assert.rejects(
    () =>
      store.install({
        entry,
        artifact: { kind: 'portable-repository', bytes },
        integrity,
      }),
    { code: 'extension-manager/artifact-destination-conflict' },
  )
  assert.equal(await readFile(join(poisonedRoot, 'version.txt'), 'utf8'), 'poisoned')
  assert.equal(existsSync(join(privateState, 'packages.v1.json')), false)
})

test('linked store confines every public root to its declared repository', async t => {
  const fixture = await temporaryDirectory(t)
  const repositoryRoot = join(fixture, 'repository')
  const outsideRoot = join(fixture, 'outside')
  const privateState = join(fixture, 'private')
  const expectedId = 'example.publisher/codec'
  await mkdir(repositoryRoot, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })
  await writeFile(join(outsideRoot, 'package.json'), packageJson(expectedId))
  const store = createNodeArtifactStore({ root: privateState })
  await assert.rejects(
    () =>
      store.install({
        entry: {
          id: 'example.publisher/toolkit',
          displayName: 'Example toolkit',
          publisher: 'example.publisher',
          version: '1.0.0',
          extensions: [expectedId],
          source: {
            kind: 'repository',
            uri: repositoryRoot,
            trust: { mode: 'local-user' },
          },
          remote: false,
          trusted: true,
        },
        artifact: {
          kind: 'linked-repository',
          repositoryRoot,
          roots: [{ root: outsideRoot, expectedId }],
        },
      }),
    { code: 'extension-manager/path-escape' },
  )
  assert.equal(existsSync(join(privateState, 'packages.v1.json')), false)
})

test('managed update retains the previous immutable roots for crash recovery and later GC', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const expectedId = 'example.publisher/codec'
  const store = createNodeArtifactStore({ root: privateState })
  const install = async version => {
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        extensions: [
          {
            id: expectedId,
            files: {
              'package.json': Buffer.from(packageJson(expectedId)).toString('base64'),
              'version.txt': Buffer.from(version).toString('base64'),
            },
          },
        ],
      }),
    )
    return store.install({
      entry: {
        id: 'example.publisher/toolkit',
        displayName: 'Example toolkit',
        publisher: 'example.publisher',
        version,
        extensions: [expectedId],
        source: {
          kind: 'bundle',
          uri: `memory://registry/toolkit-${version}.json`,
          trust: { mode: 'signed' },
        },
        remote: false,
        trusted: true,
      },
      artifact: { kind: 'portable-repository', bytes },
      integrity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    })
  }

  const first = await install('1.0.0')
  const previousRoot = first.roots[0].root
  const second = await install('2.0.0')
  assert.notEqual(second.roots[0].root, previousRoot)
  assert.equal(existsSync(previousRoot), true)
  assert.equal((await store.list())[0].version, '2.0.0')

  const manager = createNodeExtensionManager({
    root: privateState,
    catalogSource: { cached: async () => undefined, refresh: async () => undefined },
    artifactStore: store,
    artifactAcquirer: {
      async acquire() {
        throw new Error('acquisition is not used by this test')
      },
    },
  })
  assert.deepEqual(await manager.installedRoots(), [])
  await manager.setEnabled('example.publisher/toolkit', true)
  assert.equal((await manager.installedRoots()).length, 1)
  await manager.dispose()

  await store.remove('example.publisher/toolkit')
  assert.equal(existsSync(second.roots[0].root), false)
  assert.equal(existsSync(previousRoot), true)
})

test('enablement store enforces its exact state schema', async t => {
  const fixture = await temporaryDirectory(t)
  const privateState = join(fixture, 'private')
  const store = createNodeEnablementStore({ root: privateState })
  assert.deepEqual(await store.list(), [])
  assert.equal(existsSync(privateState), false)
  await store.setEnabled('example.publisher/toolkit', true)
  assert.deepEqual(await store.list(), [{ id: 'example.publisher/toolkit', enabled: true }])
  const path = join(privateState, 'enablement.v1.json')
  const state = JSON.parse(await readFile(path, 'utf8'))
  state.unexpected = true
  await writeFile(path, JSON.stringify(state))
  await assert.rejects(() => store.list(), { code: 'extension-manager/state-invalid' })
})
