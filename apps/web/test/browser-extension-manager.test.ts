import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extensionCatalogSigningBytes,
  type ExtensionRegistryCatalog,
} from '@modkit/extension-manager/browser'

import {
  BROWSER_EXTENSION_LOCK_UNAVAILABLE,
  BROWSER_EXTENSION_MUTATION_LOCK,
  BROWSER_SC2_FACILITY,
  BROWSER_HOST_FACILITY_UNAVAILABLE,
  assertBrowserArtifactBound,
  browserRuntimeAvailability,
  createBrowserExtensionManager,
  type BrowserExtensionLockManager,
} from '../src/browser-extension-manager.js'
import { loadManagedExtensionRoots } from '../src/managed-extension-roots.js'
import type {
  BrowserCacheLike,
  BrowserCacheStorageLike,
  ManagedExtensionIdbDatabaseLike,
  ManagedExtensionIdbFactoryLike,
  ManagedExtensionIdbObjectStoreLike,
  ManagedExtensionIdbOpenRequestLike,
  ManagedExtensionIdbRequestLike,
} from '../src/managed-extension-storage.js'

const CATALOG_URL = 'https://cdn.example.invalid/extensions/catalog.json'
const PACKAGE_URL = 'https://cdn.example.invalid/extensions/toolkit.mkx'
const subtle = webcrypto.subtle as unknown as SubtleCrypto
const immediateLocks: BrowserExtensionLockManager = {
  request: async (_name, _options, callback) => callback(),
}

describe('Wave 1B browser production boundary', () => {
  it('accepts the signed Blizzard byte size but refuses an over-bound source before read', () => {
    expect(() => assertBrowserArtifactBound(152_838_525, 256 * 1024 * 1024)).not.toThrow()
    expect(() => assertBrowserArtifactBound(256 * 1024 * 1024, 256 * 1024 * 1024)).not.toThrow()
    expect(() => assertBrowserArtifactBound(256 * 1024 * 1024 + 1, 256 * 1024 * 1024)).toThrow(
      /browser limit/u,
    )
    expect(() => assertBrowserArtifactBound(1, Number.NaN)).toThrow(/browser limit/u)
  })

  it('turns the generated A8 host-only route into a typed PWA refusal', () => {
    const a8 = JSON.parse(
      readFileSync(
        join(
          resolve(import.meta.dirname, '..', '..'),
          'vscode',
          'generated',
          'format-smoke.v1.json',
        ),
        'utf8',
      ),
    )
    const cascDds = a8.cases.find((entry: { id: string }) => entry.id === 'casc-dds')
    expect(browserRuntimeAvailability(cascDds.runtime.pwa)).toEqual({
      available: false,
      code: 'x3.host/facility-unavailable',
      facility: 'filesystem.read-random',
    })
  })
})

class SerialBrowserLocks implements BrowserExtensionLockManager {
  private tail: Promise<void> = Promise.resolve()
  readonly acquisitions: { readonly name: string; readonly mode: string }[] = []

  request<T>(
    name: string,
    options: { readonly mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T> {
    this.acquisitions.push({ name, mode: options.mode })
    const result = this.tail.then(callback, callback)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
const REGISTRY_SIGNING_VECTOR = {
  schemaVersion: 1,
  registryId: 'org.example/fixed-registry',
  generatedAt: '2026-08-30T00:00:00.000Z',
  packages: [],
  signature: {
    algorithm: 'Ed25519',
    keyId: 'org.example/fixed-release',
    value:
      'vov13jrmpzSrGvUe5U0XkHxU6nOsBGqbfpUO9bsXR1EYM+9lFunalJoypLy8zrY+eo8FVMLGTUhh1vslptD8Bw==',
  },
} satisfies ExtensionRegistryCatalog
const REGISTRY_SIGNING_VECTOR_PUBLIC_KEY = {
  crv: 'Ed25519',
  kty: 'OKP',
  x: 'f5zxfsQS_QYgL1PWeKKgXWeyxKFvVGbyAVBh7FRBbVc',
} satisfies JsonWebKey
const REGISTRY_SIGNING_VECTOR_CANONICAL =
  '{"generatedAt":"2026-08-30T00:00:00.000Z","packages":[],"registryId":"org.example/fixed-registry","schemaVersion":1}\n'

const base64 = (value: Uint8Array | string): string =>
  Buffer.from(typeof value === 'string' ? value : value).toString('base64')

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

function sortedRegistryJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedRegistryJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortedRegistryJson((value as Readonly<Record<string, unknown>>)[key])]),
  )
}

/** Independent mirror of scripts/registry/lib.mjs, deliberately not the production helper. */
function registrySigningBytes(catalog: ExtensionRegistryCatalog): Uint8Array {
  const unsigned = Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key !== 'signature'),
  )
  return new TextEncoder().encode(`${JSON.stringify(sortedRegistryJson(unsigned))}\n`)
}

function rootPackage(id: string): string {
  return JSON.stringify({
    name: `modkit-extension-${id}`,
    version: '1.0.0',
    type: 'module',
    modkit: {
      schemaVersion: 1,
      publisher: 'org.example',
      id,
      contributionManifests: [],
    },
  })
}

function portableBundle(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      extensions: ['codec-a', 'codec-b'].map(id => ({
        id: `org.example/${id}`,
        files: { 'package.json': base64(rootPackage(id)) },
      })),
    }),
  )
}

async function keyPair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
}

async function signedCatalog(
  bundle: Uint8Array,
  pair: CryptoKeyPair,
  integrity = digest(bundle),
  extensions: readonly string[] = ['org.example/codec-a', 'org.example/codec-b'],
): Promise<ExtensionRegistryCatalog> {
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'org.example/registry',
    generatedAt: '2026-08-30T00:00:00.000Z',
    packages: [
      {
        id: 'org.example/toolkit',
        publisher: 'org.example',
        displayName: 'Example toolkit',
        summary: 'Signed fake CDN fixture.',
        versions: [
          {
            version: '1.0.0',
            channel: 'stable' as const,
            source: {
              kind: 'bundle' as const,
              uri: PACKAGE_URL,
              integrity,
              bytes: bundle.byteLength,
              trust: { mode: 'signed' as const },
            },
            extensions,
          },
        ],
      },
    ],
  }
  const signingBytes = registrySigningBytes(unsigned as ExtensionRegistryCatalog)
  const signature = new Uint8Array(
    await subtle.sign('Ed25519', pair.privateKey, signingBytes as Uint8Array<ArrayBuffer>),
  )
  return {
    ...unsigned,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'org.example/release',
      value: base64(signature),
    },
  }
}

class FakeRequest<T> implements ManagedExtensionIdbRequestLike<T> {
  error: unknown = undefined
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(readonly result: T) {
    queueMicrotask(() => this.onsuccess?.(new Event('success')))
  }
}

class FakeRejectedRequest<T> implements ManagedExtensionIdbRequestLike<T> {
  readonly result = undefined as T
  readonly error = new Error('injected enabled metadata write failure')
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor() {
    queueMicrotask(() => this.onerror?.(new Event('error')))
  }
}

class FakeOpenRequest<T> implements ManagedExtensionIdbOpenRequestLike<T> {
  error: unknown = undefined
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onupgradeneeded: ((event: Event) => void) | null = null
  constructor(
    readonly result: T,
    upgrade: boolean,
  ) {
    queueMicrotask(() => {
      if (upgrade) this.onupgradeneeded?.(new Event('upgrade'))
      queueMicrotask(() => this.onsuccess?.(new Event('success')))
    })
  }
}

class FakeObjectStore implements ManagedExtensionIdbObjectStoreLike {
  constructor(
    private readonly rows: Map<string, unknown>,
    private readonly failEnabledPut = false,
  ) {}
  put(value: unknown): ManagedExtensionIdbRequestLike<unknown> {
    if (this.failEnabledPut && (value as { readonly enabled?: unknown }).enabled === true) {
      return new FakeRejectedRequest()
    }
    const id = (value as { id?: unknown }).id
    if (typeof id !== 'string') throw new Error('fake IndexedDB row has no id')
    this.rows.set(id, structuredClone(value))
    return new FakeRequest(undefined)
  }
  delete(id: string): ManagedExtensionIdbRequestLike<unknown> {
    this.rows.delete(id)
    return new FakeRequest(undefined)
  }
  getAll(): ManagedExtensionIdbRequestLike<readonly unknown[]> {
    return new FakeRequest([...this.rows.values()].map(value => structuredClone(value)))
  }
}

function fakeIndexedDb(failEnabledPut = false): ManagedExtensionIdbFactoryLike {
  const stores = new Map<string, Map<string, unknown>>()
  let opened = false
  const database: ManagedExtensionIdbDatabaseLike = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      const rows = new Map<string, unknown>()
      stores.set(name, rows)
      return new FakeObjectStore(rows, failEnabledPut)
    },
    transaction(name) {
      const rows = stores.get(name)
      if (rows === undefined) throw new Error(`missing fake store ${name}`)
      return { objectStore: () => new FakeObjectStore(rows, failEnabledPut) }
    },
    close: () => undefined,
  }
  return {
    databases: async () => (opened ? [{ name: 'modkit.app.web/managed-extensions' }] : []),
    open: () => {
      const upgrade = !opened
      opened = true
      return new FakeOpenRequest(database, upgrade)
    },
  }
}

class FakeCacheStorage implements BrowserCacheStorageLike {
  readonly caches = new Map<string, Map<string, Response>>()
  openCalls = 0
  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }
  async open(name: string): Promise<BrowserCacheLike> {
    this.openCalls += 1
    let rows = this.caches.get(name)
    if (rows === undefined) {
      rows = new Map()
      this.caches.set(name, rows)
    }
    return {
      match: async request => rows?.get(request)?.clone(),
      put: async (request, response) => {
        rows?.set(request, response.clone())
      },
      delete: async request => rows?.delete(request) ?? false,
    }
  }
}

function fakeCdn(entries: ReadonlyMap<string, Uint8Array>): {
  readonly fetch: (
    input: string,
    init?: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> },
  ) => Promise<{
    readonly ok: boolean
    readonly status: number
    readonly headers: { get(name: string): string | null }
    arrayBuffer(): Promise<ArrayBuffer>
  }>
  readonly calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    async fetch(input, init) {
      const bytes = entries.get(input)
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      const headers = {
        get(name: string): string | null {
          if (name.toLowerCase() === 'content-length') return String(bytes?.byteLength ?? 0)
          if (name.toLowerCase() === 'accept-ranges') return 'bytes'
          return null
        },
      }
      if (bytes === undefined) {
        return { ok: false, status: 404, headers, arrayBuffer: async () => new ArrayBuffer(0) }
      }
      if (init?.method === 'HEAD') {
        return { ok: true, status: 200, headers, arrayBuffer: async () => new ArrayBuffer(0) }
      }
      const range = init?.headers?.['Range']
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range ?? '')
      if (match === null) {
        return { ok: false, status: 400, headers, arrayBuffer: async () => new ArrayBuffer(0) }
      }
      const start = Number(match[1])
      const end = Number(match[2]) + 1
      const part = bytes.slice(start, end)
      const buffer = new ArrayBuffer(part.byteLength)
      new Uint8Array(buffer).set(part)
      return { ok: true, status: 206, headers, arrayBuffer: async () => buffer }
    },
  }
}

describe('common extension manager browser adapter', () => {
  it('uses the compact registry signing format and ignores the root signature field', async () => {
    const signingBytes = extensionCatalogSigningBytes(REGISTRY_SIGNING_VECTOR)
    expect(new TextDecoder().decode(signingBytes)).toBe(REGISTRY_SIGNING_VECTOR_CANONICAL)

    const publicKey = await subtle.importKey(
      'jwk',
      REGISTRY_SIGNING_VECTOR_PUBLIC_KEY,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const signature = new Uint8Array(Buffer.from(REGISTRY_SIGNING_VECTOR.signature.value, 'base64'))
    expect(
      await subtle.verify(
        'Ed25519',
        publicKey,
        signature as Uint8Array<ArrayBuffer>,
        signingBytes as Uint8Array<ArrayBuffer>,
      ),
    ).toBe(true)
  })

  it('does no registry or artifact I/O during construction and cached snapshot', async () => {
    const cdn = fakeCdn(new Map())
    const pair = await keyPair()
    const baseIndexedDb = fakeIndexedDb()
    const databases = baseIndexedDb.databases
    let indexedDbOpens = 0
    const indexedDB: ManagedExtensionIdbFactoryLike = {
      ...(databases === undefined ? {} : { databases: () => databases.call(baseIndexedDb) }),
      open(name, version) {
        indexedDbOpens += 1
        return baseIndexedDb.open(name, version)
      },
    }
    const cacheStorage = new FakeCacheStorage()
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB,
      cacheStorage,
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
    })
    expect((await runtime.client.snapshot()).entries).toEqual([])
    expect(cdn.calls).toEqual([])
    expect(indexedDbOpens).toBe(0)
    expect(cacheStorage.openCalls).toBe(0)
    expect(cacheStorage.caches.size).toBe(0)
    await runtime.dispose()
  })

  it('serializes mutations from separate browser clients under one exclusive Web Locks name', async () => {
    const locks = new SerialBrowserLocks()
    let activeRefreshes = 0
    let maximumRefreshes = 0
    const catalogSource = {
      cached: async () => undefined,
      async refresh() {
        activeRefreshes += 1
        maximumRefreshes = Math.max(maximumRefreshes, activeRefreshes)
        await Promise.resolve()
        await Promise.resolve()
        activeRefreshes -= 1
        return {
          catalog: REGISTRY_SIGNING_VECTOR,
          source: 'memory:/test-catalog.json',
          signatureVerified: true,
        }
      },
    }
    const first = createBrowserExtensionManager({
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      catalogSource,
      crypto: subtle,
      locks,
    })
    const second = createBrowserExtensionManager({
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      catalogSource,
      crypto: subtle,
      locks,
    })

    await Promise.all([first.client.refresh(), second.client.refresh()])

    expect(maximumRefreshes).toBe(1)
    expect(locks.acquisitions).toEqual([
      { name: BROWSER_EXTENSION_MUTATION_LOCK, mode: 'exclusive' },
      { name: BROWSER_EXTENSION_MUTATION_LOCK, mode: 'exclusive' },
    ])
    await Promise.all([first.dispose(), second.dispose()])
  })

  it('fails every mutation before network or persistence when Web Locks are unavailable', async () => {
    const pair = await keyPair()
    const baseIndexedDb = fakeIndexedDb()
    let indexedDbOpens = 0
    const indexedDB: ManagedExtensionIdbFactoryLike = {
      ...(baseIndexedDb.databases === undefined
        ? {}
        : { databases: () => baseIndexedDb.databases?.() ?? Promise.resolve([]) }),
      open(name, version) {
        indexedDbOpens += 1
        return baseIndexedDb.open(name, version)
      },
    }
    const cacheStorage = new FakeCacheStorage()
    const cdn = fakeCdn(new Map())
    const runtime = createBrowserExtensionManager({
      indexedDB,
      cacheStorage,
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
      locks: null,
    })

    const mutations = [
      () => runtime.client.refresh(),
      () => runtime.client.install('org.example/toolkit'),
      () => runtime.client.update('org.example/toolkit'),
      () => runtime.client.remove('org.example/toolkit'),
      () => runtime.client.setEnabled('org.example/toolkit', true),
    ]
    for (const mutate of mutations) {
      await expect(mutate()).rejects.toMatchObject({
        name: 'BrowserExtensionMutationLockUnavailableError',
        code: BROWSER_EXTENSION_LOCK_UNAVAILABLE,
      })
    }
    expect((await runtime.client.snapshot()).entries).toEqual([])
    expect(cdn.calls).toEqual([])
    expect(indexedDbOpens).toBe(0)
    expect(cacheStorage.openCalls).toBe(0)
    expect(cacheStorage.caches.size).toBe(0)
    await runtime.dispose()
  })

  it('applies the VFS origin policy before following a registry redirect', async () => {
    const pair = await keyPair()
    const calls: string[] = []
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      allowedOrigins: ['https://cdn.example.invalid'],
      fetch: async (
        input: string,
        init?: { readonly method?: string; readonly redirect?: 'manual' },
      ) => {
        calls.push(input)
        expect(init?.redirect).toBe('manual')
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'location'
                ? 'https://untrusted.example.invalid/catalog.json'
                : null,
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
      crypto: subtle,
    })

    await expect(runtime.client.refresh()).rejects.toMatchObject({
      code: 'x3.vfs/http-origin-refused',
    })
    expect(calls).toEqual([CATALOG_URL])
    expect(calls.some(url => url.includes('untrusted.example.invalid'))).toBe(false)
    await runtime.dispose()
  })

  it('denies browser HTTP registry access before fetch when no origin is allow-listed', async () => {
    const pair = await keyPair()
    const calls: string[] = []
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: async (input: string) => {
        calls.push(input)
        throw new Error('HTTP fetch must not run without an explicit allow-list')
      },
      crypto: subtle,
    })

    await expect(runtime.client.refresh()).rejects.toMatchObject({
      code: 'x3.vfs/http-origin-refused',
    })
    expect(calls).toEqual([])
    await runtime.dispose()
  })

  it('installs a signed fake-CDN catalog package and loads all portable roots', async () => {
    const bundle = portableBundle()
    const pair = await keyPair()
    const catalog = await signedCatalog(bundle, pair)
    const cdn = fakeCdn(
      new Map([
        [CATALOG_URL, new TextEncoder().encode(JSON.stringify(catalog))],
        [PACKAGE_URL, bundle],
      ]),
    )
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
    })

    await runtime.client.refresh()
    const available = (await runtime.client.snapshot()).entries[0]
    expect(available).toMatchObject({
      id: 'org.example/toolkit',
      trusted: true,
    })
    expect(available).not.toHaveProperty('installedVersion')
    await runtime.client.install('org.example/toolkit')
    expect((await runtime.client.snapshot()).entries[0]).toMatchObject({
      installedVersion: '1.0.0',
      enabled: true,
    })

    const packageReadsAfterInstall = cdn.calls.filter(call => call.includes(PACKAGE_URL)).length
    const loaded = await loadManagedExtensionRoots(runtime.storage, {
      subtle: webcrypto.subtle as never,
    })
    expect(loaded.failures).toEqual([])
    expect(loaded.coordinates).toEqual(['org.example/codec-a', 'org.example/codec-b'])
    expect(
      loaded.inputs.every(
        input =>
          input.execution !== undefined &&
          input.execution.origin === 'installed' &&
          input.execution.allowTrustedInProcess === false,
      ),
    ).toBe(true)
    expect(packageReadsAfterInstall).toBeGreaterThan(0)
    expect(cdn.calls.filter(call => call.includes(PACKAGE_URL))).toHaveLength(
      packageReadsAfterInstall,
    )
    await runtime.dispose()
  })

  it('refuses catalog/package root mismatch before persistence', async () => {
    const bundle = portableBundle()
    const pair = await keyPair()
    const catalog = await signedCatalog(bundle, pair, digest(bundle), ['org.example/codec-a'])
    const cdn = fakeCdn(
      new Map([
        [CATALOG_URL, new TextEncoder().encode(JSON.stringify(catalog))],
        [PACKAGE_URL, bundle],
      ]),
    )
    const cacheStorage = new FakeCacheStorage()
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(),
      cacheStorage,
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
    })

    await runtime.client.refresh()
    await expect(runtime.client.install('org.example/toolkit')).rejects.toThrow(
      'portable package roots do not match catalog entry',
    )
    expect(await runtime.storage.list()).toEqual([])
    expect(
      [...cacheStorage.caches.entries()]
        .filter(([name]) => name !== 'modkit.app.web/extension-catalog-v1')
        .flatMap(([, rows]) => [...rows.keys()]),
    ).toEqual([])
    await runtime.dispose()
  })

  it('treats catalog roots as a set while still requiring exact membership', async () => {
    const bundle = portableBundle()
    const pair = await keyPair()
    const catalog = await signedCatalog(bundle, pair, digest(bundle), [
      'org.example/codec-b',
      'org.example/codec-a',
    ])
    const cdn = fakeCdn(
      new Map([
        [CATALOG_URL, new TextEncoder().encode(JSON.stringify(catalog))],
        [PACKAGE_URL, bundle],
      ]),
    )
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(),
      cacheStorage: new FakeCacheStorage(),
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
    })

    await runtime.client.refresh()
    await expect(runtime.client.install('org.example/toolkit')).resolves.toBeUndefined()
    expect((await runtime.client.snapshot()).entries[0]?.enabled).toBe(true)
    await runtime.dispose()
  })

  it('rolls a fresh package back if the final enablement commit fails', async () => {
    const bundle = portableBundle()
    const pair = await keyPair()
    const catalog = await signedCatalog(bundle, pair)
    const cdn = fakeCdn(
      new Map([
        [CATALOG_URL, new TextEncoder().encode(JSON.stringify(catalog))],
        [PACKAGE_URL, bundle],
      ]),
    )
    const runtime = createBrowserExtensionManager({
      locks: immediateLocks,
      indexedDB: fakeIndexedDb(true),
      cacheStorage: new FakeCacheStorage(),
      registry: {
        catalogUri: CATALOG_URL,
        trustedPublicKeys: { 'org.example/release': pair.publicKey },
      },
      fetch: cdn.fetch,
      allowedOrigins: ['https://cdn.example.invalid'],
      crypto: subtle,
    })

    await runtime.client.refresh()
    await expect(runtime.client.install('org.example/toolkit')).rejects.toThrow(
      'injected enabled metadata write failure',
    )
    expect(await runtime.storage.list()).toEqual([])
    const reopened = await loadManagedExtensionRoots(runtime.storage, {
      subtle: webcrypto.subtle as never,
    })
    expect(reopened.inputs).toEqual([])
    expect(reopened.coordinates).toEqual([])
    await runtime.dispose()
  })

  it('blocks invalid signatures and digest mismatches before IndexedDB installation', async () => {
    const bundle = portableBundle()
    const signer = await keyPair()
    const untrusted = await keyPair()
    const signed = await signedCatalog(bundle, signer)
    const wrongDigest = await signedCatalog(bundle, signer, `sha256:${'0'.repeat(64)}`)

    const exercise = async (catalog: ExtensionRegistryCatalog, trustedKey: CryptoKey) => {
      const cdn = fakeCdn(
        new Map([
          [CATALOG_URL, new TextEncoder().encode(JSON.stringify(catalog))],
          [PACKAGE_URL, bundle],
        ]),
      )
      const runtime = createBrowserExtensionManager({
        locks: immediateLocks,
        indexedDB: fakeIndexedDb(),
        cacheStorage: new FakeCacheStorage(),
        registry: {
          catalogUri: CATALOG_URL,
          trustedPublicKeys: { 'org.example/release': trustedKey },
        },
        fetch: cdn.fetch,
        allowedOrigins: ['https://cdn.example.invalid'],
        crypto: subtle,
      })
      await runtime.client.refresh()
      return { runtime, cdn }
    }

    const badSignature = await exercise(signed, untrusted.publicKey)
    await expect(badSignature.runtime.client.install('org.example/toolkit')).rejects.toMatchObject({
      code: 'extension-manager/artifact-untrusted',
    })
    expect(await badSignature.runtime.storage.list()).toEqual([])
    expect(badSignature.cdn.calls.filter(call => call.includes(PACKAGE_URL))).toEqual([])
    await badSignature.runtime.dispose()

    const badDigest = await exercise(wrongDigest, signer.publicKey)
    await expect(badDigest.runtime.client.install('org.example/toolkit')).rejects.toMatchObject({
      code: 'extension-manager/integrity-mismatch',
    })
    expect(await badDigest.runtime.storage.list()).toEqual([])
    await badDigest.runtime.dispose()
  })
})
