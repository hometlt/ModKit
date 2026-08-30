import { describe, expect, it } from 'vitest'

import {
  createBrowserExtensionStorage,
  createCacheStorageExtensionResponseCache,
  createIndexedDbManagedExtensionMetadataStore,
  createLocalStorageExtensionUiPreferenceStore,
  type BrowserCacheLike,
  type BrowserCacheStorageLike,
  type BrowserExtensionArtifactAdapter,
  type InstalledBrowserExtension,
  type ManagedExtensionIdbDatabaseLike,
  type ManagedExtensionIdbFactoryLike,
  type ManagedExtensionIdbObjectStoreLike,
  type ManagedExtensionIdbOpenRequestLike,
  type ManagedExtensionIdbRequestLike,
} from '../src/managed-extension-storage.js'

const ALPHA_DIGEST = '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8'
const BETA_DIGEST = 'f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753'

const fakeSha256 = async (bytes: ArrayBuffer): Promise<string> => {
  const text = new TextDecoder().decode(bytes)
  if (text === 'alpha') return ALPHA_DIGEST
  if (text === 'beta') return BETA_DIGEST
  return '0'.repeat(64)
}

class FakeRequest<T> implements ManagedExtensionIdbRequestLike<T> {
  error: unknown = undefined
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(readonly result: T) {
    queueMicrotask(() => this.onsuccess?.(new Event('success')))
  }
}

class FakeOpenRequest<T> implements ManagedExtensionIdbOpenRequestLike<T> {
  error: unknown = undefined
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onupgradeneeded: ((event: Event) => void) | null = null

  constructor(
    readonly result: T,
    upgraded: boolean,
  ) {
    queueMicrotask(() => {
      if (upgraded) this.onupgradeneeded?.(new Event('upgradeneeded'))
      queueMicrotask(() => this.onsuccess?.(new Event('success')))
    })
  }
}

class FallbackOpenRequest<T> implements ManagedExtensionIdbOpenRequestLike<T> {
  error: unknown = undefined
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onupgradeneeded: ((event: Event) => void) | null = null
  readonly transaction: { abort(): void }
  private aborted = false

  constructor(
    readonly result: T,
    upgrade: boolean,
    commit: () => void,
    rollback: () => void,
  ) {
    this.transaction = { abort: () => void (this.aborted = true) }
    queueMicrotask(() => {
      if (upgrade) this.onupgradeneeded?.(new Event('upgradeneeded'))
      queueMicrotask(() => {
        if (this.aborted) {
          rollback()
          this.error = new Error('AbortError')
          this.onerror?.(new Event('error', { cancelable: true }))
          return
        }
        commit()
        this.onsuccess?.(new Event('success'))
      })
    })
  }
}

class FakeIdbObjectStore implements ManagedExtensionIdbObjectStoreLike {
  constructor(private readonly rows: Map<string, unknown>) {}

  put(value: unknown): ManagedExtensionIdbRequestLike<unknown> {
    const id = (value as { readonly id?: unknown }).id
    if (typeof id !== 'string') throw new Error('fake IndexedDB requires a string id')
    this.rows.set(id, structuredClone(value))
    return new FakeRequest(undefined)
  }

  delete(key: string): ManagedExtensionIdbRequestLike<unknown> {
    this.rows.delete(key)
    return new FakeRequest(undefined)
  }

  getAll(): ManagedExtensionIdbRequestLike<readonly unknown[]> {
    return new FakeRequest([...this.rows.values()].map(value => structuredClone(value)))
  }
}

function fakeIndexedDb(): {
  readonly factory: ManagedExtensionIdbFactoryLike
  readonly raw: Map<string, unknown>
  readonly closes: () => number
} {
  const stores = new Map<string, Map<string, unknown>>()
  let closeCount = 0
  let opened = false
  const database: ManagedExtensionIdbDatabaseLike = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      const rows = new Map<string, unknown>()
      stores.set(name, rows)
      return new FakeIdbObjectStore(rows)
    },
    transaction(name) {
      const rows = stores.get(name)
      if (rows === undefined) throw new Error(`missing fake object store ${name}`)
      return { objectStore: () => new FakeIdbObjectStore(rows) }
    },
    close() {
      closeCount += 1
    },
  }
  return {
    factory: {
      databases: async () => (opened ? [{ name: 'org.modkitx.app.web/managed-extensions' }] : []),
      open: () => {
        const upgraded = !opened
        opened = true
        return new FakeOpenRequest(database, upgraded)
      },
    },
    get raw() {
      const rows = stores.get('installations')
      if (rows === undefined) throw new Error('fake store has not been created')
      return rows
    },
    closes: () => closeCount,
  }
}

function fallbackIndexedDb(): {
  readonly factory: ManagedExtensionIdbFactoryLike
  readonly exists: () => boolean
  readonly opens: () => number
} {
  const stores = new Map<string, Map<string, unknown>>()
  let databaseExists = false
  let openCount = 0
  const database: ManagedExtensionIdbDatabaseLike = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      const rows = new Map<string, unknown>()
      stores.set(name, rows)
      return new FakeIdbObjectStore(rows)
    },
    transaction(name) {
      const rows = stores.get(name)
      if (rows === undefined) throw new Error(`missing fallback object store ${name}`)
      return { objectStore: () => new FakeIdbObjectStore(rows) }
    },
    close: () => undefined,
  }
  return {
    factory: {
      open: () => {
        openCount += 1
        return new FallbackOpenRequest(
          database,
          !databaseExists,
          () => void (databaseExists = true),
          () => stores.clear(),
        )
      },
    },
    exists: () => databaseExists,
    opens: () => openCount,
  }
}

class FakeCacheStorage implements BrowserCacheStorageLike {
  readonly caches = new Map<string, Map<string, Response>>()

  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }

  async open(name: string): Promise<BrowserCacheLike> {
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

const installRequest = (body: 'alpha' | 'beta' = 'alpha') => ({
  id: 'org.example.codec',
  version: body === 'alpha' ? '1.0.0' : '2.0.0',
  digest: body === 'alpha' ? ALPHA_DIGEST : BETA_DIGEST,
  sourceUrl: `https://cdn.example.invalid/codec-${body}.mkx`,
  settings: { strict: true, theme: 'dark' } as const,
})

const installedRecord = (): InstalledBrowserExtension => ({
  id: 'org.example.codec',
  version: '1.0.0',
  digest: ALPHA_DIGEST,
  sourceUrl: 'https://cdn.example.invalid/codec-alpha.mkx',
  cacheKey: `https://extension-cache.modkit.invalid/org.example.codec/1.0.0/${ALPHA_DIGEST}`,
  installedAt: 12,
  enabled: true,
  settings: { strict: true },
})

describe('managed extension browser persistence', () => {
  it('uses an aborting fallback probe without creating IndexedDB or Cache Storage on reads', async () => {
    const backingDb = fallbackIndexedDb()
    const metadata = createIndexedDbManagedExtensionMetadataStore(backingDb.factory)
    expect(await metadata.list()).toEqual([])
    expect(backingDb.opens()).toBe(1)
    expect(backingDb.exists()).toBe(false)
    await metadata.put(installedRecord())
    expect(backingDb.opens()).toBe(2)
    expect(backingDb.exists()).toBe(true)
    expect(await metadata.list()).toEqual([installedRecord()])

    const afterReload = createIndexedDbManagedExtensionMetadataStore(backingDb.factory)
    expect(await afterReload.list()).toEqual([installedRecord()])
    expect(backingDb.exists()).toBe(true)

    const backingCache = new FakeCacheStorage()
    let cacheOpens = 0
    const responses = createCacheStorageExtensionResponseCache({
      async open(name) {
        cacheOpens += 1
        return backingCache.open(name)
      },
    })
    expect(await responses.match('https://cache.invalid/a')).toBeUndefined()
    expect(cacheOpens).toBe(0)
    await responses.put('https://cache.invalid/a', new Response('alpha'))
    expect(cacheOpens).toBe(1)
    expect(await (await responses.match('https://cache.invalid/a'))?.text()).toBe('alpha')
  })

  it('persists digest-pinned metadata and settings in IndexedDB across store instances', async () => {
    const indexedDb = fakeIndexedDb()
    const first = createIndexedDbManagedExtensionMetadataStore(indexedDb.factory)
    await first.put(installedRecord())

    const second = createIndexedDbManagedExtensionMetadataStore(indexedDb.factory)
    expect(await second.list()).toEqual([installedRecord()])
    expect(second.location).toContain('indexedDB')

    indexedDb.raw.set('invalid', { id: 'invalid', digest: 'not-a-digest' })
    expect(await second.list()).toEqual([installedRecord()])
    await second.remove('org.example.codec')
    expect(await second.list()).toEqual([])
    expect(indexedDb.closes()).toBeGreaterThan(0)
  })

  it('adapts Cache Storage without exposing mutable response instances', async () => {
    const caches = new FakeCacheStorage()
    const responses = createCacheStorageExtensionResponseCache(caches)
    await responses.put('https://cache.invalid/a', new Response('alpha'))

    const first = await responses.match('https://cache.invalid/a')
    expect(await first?.text()).toBe('alpha')
    const second = await responses.match('https://cache.invalid/a')
    expect(await second?.text()).toBe('alpha')
    expect(await responses.remove('https://cache.invalid/a')).toBe(true)
    expect(await responses.match('https://cache.invalid/a')).toBeUndefined()
  })

  it('installs, lists, disables, enables and removes an extension with no network access', async () => {
    const indexedDb = fakeIndexedDb()
    const caches = new FakeCacheStorage()
    let acquisitions = 0
    const artifacts: BrowserExtensionArtifactAdapter = {
      async acquire() {
        acquisitions += 1
        return new Response('alpha')
      },
    }
    const storage = createBrowserExtensionStorage({
      metadata: createIndexedDbManagedExtensionMetadataStore(indexedDb.factory),
      responses: createCacheStorageExtensionResponseCache(caches),
      artifacts,
      sha256: fakeSha256,
      now: () => 42,
    })

    const installed = await storage.install(installRequest())
    expect(installed).toMatchObject({
      digest: ALPHA_DIGEST,
      installedAt: 42,
      enabled: true,
      settings: { strict: true, theme: 'dark' },
    })
    expect(installed.cacheKey).not.toBe(installed.sourceUrl)
    expect(await (await storage.open(installed.id))?.text()).toBe('alpha')

    await storage.enable(installed.id, false)
    expect(await storage.open(installed.id)).toBeUndefined()
    expect(await (await storage.openInstalled(installed.id))?.text()).toBe('alpha')
    await storage.enable(installed.id, true)
    expect((await storage.list())[0]?.enabled).toBe(true)
    await storage.updateSettings(installed.id, { strict: false, retries: 2 })
    expect((await storage.list())[0]?.settings).toEqual({ strict: false, retries: 2 })

    await storage.remove(installed.id)
    expect(await storage.list()).toEqual([])
    expect(await storage.open(installed.id)).toBeUndefined()
    expect(acquisitions).toBe(1)
  })

  it('keeps a first verified install disabled and preserves enablement on replacement', async () => {
    const indexedDb = fakeIndexedDb()
    const storage = createBrowserExtensionStorage({
      metadata: createIndexedDbManagedExtensionMetadataStore(indexedDb.factory),
      responses: createCacheStorageExtensionResponseCache(new FakeCacheStorage()),
      artifacts: { acquire: async () => new Response('unused') },
      sha256: fakeSha256,
    })
    const first = await storage.installVerified({
      id: 'org.example.codec',
      version: '1.0.0',
      digest: ALPHA_DIGEST,
      sourceUrl: 'https://cdn.example.invalid/codec-alpha.mkx',
      bytes: new TextEncoder().encode('alpha'),
      roots: [{ expectedId: 'org.example/codec' }],
    })
    expect(first.enabled).toBe(false)
    await storage.enable(first.id, true)
    const replacement = await storage.installVerified({
      id: first.id,
      version: '2.0.0',
      digest: BETA_DIGEST,
      sourceUrl: 'https://cdn.example.invalid/codec-beta.mkx',
      bytes: new TextEncoder().encode('beta'),
      roots: [{ expectedId: 'org.example/codec' }],
    })
    expect(replacement.enabled).toBe(true)
  })

  it('replaces poisoned bytes already stored under a verified content-addressed key', async () => {
    const indexedDb = fakeIndexedDb()
    const caches = new FakeCacheStorage()
    const responses = createCacheStorageExtensionResponseCache(caches)
    await responses.put(installedRecord().cacheKey, new Response('beta'))
    const storage = createBrowserExtensionStorage({
      metadata: createIndexedDbManagedExtensionMetadataStore(indexedDb.factory),
      responses,
      artifacts: { acquire: async () => new Response('unused') },
      sha256: fakeSha256,
    })

    const installed = await storage.installVerified({
      id: 'org.example.codec',
      version: '1.0.0',
      digest: ALPHA_DIGEST,
      sourceUrl: 'https://cdn.example.invalid/codec-alpha.mkx',
      bytes: new TextEncoder().encode('alpha'),
      roots: [{ expectedId: 'org.example/codec' }],
    })
    await storage.enable(installed.id, true)

    expect(await (await storage.open(installed.id))?.text()).toBe('alpha')
    expect(await (await responses.match(installed.cacheKey))?.text()).toBe('alpha')
  })

  it('rejects untrusted bytes before writing either metadata or Cache Storage', async () => {
    const indexedDb = fakeIndexedDb()
    const caches = new FakeCacheStorage()
    const storage = createBrowserExtensionStorage({
      metadata: createIndexedDbManagedExtensionMetadataStore(indexedDb.factory),
      responses: createCacheStorageExtensionResponseCache(caches),
      artifacts: { acquire: async () => new Response('beta') },
      sha256: fakeSha256,
    })

    await expect(storage.install(installRequest('alpha'))).rejects.toThrow('digest does not match')
    expect(await storage.list()).toEqual([])
    expect([...caches.caches.values()].flatMap(cache => [...cache.keys()])).toEqual([])
  })

  it('reuses an immutable digest key and removes the old response after an upgrade', async () => {
    const indexedDb = fakeIndexedDb()
    const caches = new FakeCacheStorage()
    let body: 'alpha' | 'beta' = 'alpha'
    let acquisitions = 0
    const storage = createBrowserExtensionStorage({
      metadata: createIndexedDbManagedExtensionMetadataStore(indexedDb.factory),
      responses: createCacheStorageExtensionResponseCache(caches),
      artifacts: {
        async acquire() {
          acquisitions += 1
          return new Response(body)
        },
      },
      sha256: fakeSha256,
    })

    const first = await storage.install(installRequest('alpha'))
    await storage.install(installRequest('alpha'))
    expect(acquisitions).toBe(1)

    body = 'beta'
    const upgraded = await storage.install(installRequest('beta'))
    expect(upgraded.cacheKey).not.toBe(first.cacheKey)
    expect(acquisitions).toBe(2)
    const responseCache = createCacheStorageExtensionResponseCache(caches)
    expect(await responseCache.match(first.cacheKey)).toBeUndefined()
    expect(await (await storage.open(upgraded.id))?.text()).toBe('beta')
  })

  it('keeps only small presentation preferences in localStorage', () => {
    const rows = new Map<string, string>()
    const preferences = createLocalStorageExtensionUiPreferenceStore({
      getItem: key => rows.get(key) ?? null,
      setItem: (key, value) => {
        rows.set(key, value)
      },
    })

    expect(preferences.read()).toEqual({ showInstalledOnly: false })
    preferences.write({ selectedId: 'org.example.codec', showInstalledOnly: true })
    expect(preferences.read()).toEqual({
      selectedId: 'org.example.codec',
      showInstalledOnly: true,
    })
    expect([...rows.values()][0]?.length).toBeLessThan(4096)
  })
})
