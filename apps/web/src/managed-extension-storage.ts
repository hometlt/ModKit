/**
 * Browser persistence for extensions installed from a catalog or CDN.
 *
 * This module deliberately does not know how an extension is discovered, downloaded, mounted or
 * imported. The future `@modkit/extension-manager/browser` adapter supplies an immutable package
 * response through `BrowserExtensionArtifactAdapter`; this layer verifies it, stores the response
 * in Cache Storage and keeps only its digest-pinned metadata in IndexedDB.
 *
 * User-granted folders use `./extension-store.ts` instead. Those handles have a different trust
 * and permission lifecycle and must not be confused with downloaded packages.
 */

export type BrowserExtensionSettingsValue =
  | boolean
  | number
  | string
  | null
  | readonly BrowserExtensionSettingsValue[]
  | { readonly [key: string]: BrowserExtensionSettingsValue }

export type BrowserExtensionSettings = Readonly<Record<string, BrowserExtensionSettingsValue>>

export interface InstalledBrowserExtension {
  /** Stable extension coordinate, for example `org.example.codec`. */
  readonly id: string
  readonly version: string
  /** Lower-case SHA-256 of the exact package response bytes. */
  readonly digest: string
  /** Catalog/CDN source retained for update checks and provenance display. */
  readonly sourceUrl: string
  /** Content-addressed Cache Storage request key; never a mutable CDN URL. */
  readonly cacheKey: string
  readonly installedAt: number
  readonly enabled: boolean
  readonly displayName?: string
  readonly publisher?: string
  readonly trusted?: boolean
  /** Expected extension coordinates contained in this package. */
  readonly roots?: readonly { readonly expectedId: string }[]
  /** Extension-owned preferences belong in IndexedDB, not localStorage. */
  readonly settings: BrowserExtensionSettings
}

export interface BrowserExtensionInstallRequest {
  readonly id: string
  readonly version: string
  readonly digest: string
  readonly sourceUrl: string
  readonly enabled?: boolean
  readonly settings?: BrowserExtensionSettings
}

export interface BrowserVerifiedExtensionInstallRequest {
  readonly id: string
  readonly version: string
  /** Already verified lower-case SHA-256 hex, without the `sha256:` prefix. */
  readonly digest: string
  readonly sourceUrl: string
  readonly bytes: Uint8Array
  readonly roots: readonly { readonly expectedId: string }[]
  readonly displayName?: string
  readonly publisher?: string
  readonly trusted?: boolean
}

/**
 * Acquisition seam for `@modkit/extension-manager/browser`.
 *
 * A web-only app can supply a `fetch` adapter, a test can return an in-memory `Response`, and an
 * offline build can read a statically bundled package. Storage never performs network I/O itself.
 */
export interface BrowserExtensionArtifactAdapter {
  acquire(request: BrowserExtensionInstallRequest): Promise<Response>
}

export interface BrowserExtensionMetadataStore {
  readonly location: string
  list(): Promise<readonly InstalledBrowserExtension[]>
  put(record: InstalledBrowserExtension): Promise<void>
  remove(id: string): Promise<void>
}

export interface BrowserExtensionResponseCache {
  readonly location: string
  match(cacheKey: string): Promise<Response | undefined>
  put(cacheKey: string, response: Response): Promise<void>
  remove(cacheKey: string): Promise<boolean>
}

export type BrowserSha256 = (bytes: ArrayBuffer) => Promise<string>

export interface BrowserExtensionStorageOptions {
  readonly metadata: BrowserExtensionMetadataStore
  readonly responses: BrowserExtensionResponseCache
  readonly artifacts: BrowserExtensionArtifactAdapter
  readonly sha256?: BrowserSha256
  readonly now?: () => number
}

export interface BrowserExtensionStorage {
  readonly metadataLocation: string
  readonly responseLocation: string
  list(): Promise<readonly InstalledBrowserExtension[]>
  install(request: BrowserExtensionInstallRequest): Promise<InstalledBrowserExtension>
  /** Stores bytes already verified by the common manager without acquiring or hashing again. */
  installVerified(
    request: BrowserVerifiedExtensionInstallRequest,
  ): Promise<InstalledBrowserExtension>
  remove(id: string): Promise<void>
  enable(id: string, enabled: boolean): Promise<InstalledBrowserExtension>
  updateSettings(id: string, settings: BrowserExtensionSettings): Promise<InstalledBrowserExtension>
  /** Returns a verified package response without executing or dynamically importing it. */
  open(id: string): Promise<Response | undefined>
  /** Opens verified installed bytes even when disabled, for inert inventory/card projection only. */
  openInstalled(id: string): Promise<Response | undefined>
}

// ---------------------------------------------------------------------------------------------
// IndexedDB structural types and metadata store

export interface ManagedExtensionIdbRequestLike<T> {
  readonly result: T
  readonly error: unknown
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

export interface ManagedExtensionIdbOpenRequestLike<T> extends ManagedExtensionIdbRequestLike<T> {
  onupgradeneeded: ((event: Event) => void) | null
  /** Present on a real IDBOpenDBRequest while an initial create/upgrade is running. */
  readonly transaction?: { abort(): void } | null
}

export interface ManagedExtensionIdbObjectStoreLike {
  put(value: unknown): ManagedExtensionIdbRequestLike<unknown>
  delete(key: string): ManagedExtensionIdbRequestLike<unknown>
  getAll(): ManagedExtensionIdbRequestLike<readonly unknown[]>
}

export interface ManagedExtensionIdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean }
  createObjectStore(
    name: string,
    options: { readonly keyPath: string },
  ): ManagedExtensionIdbObjectStoreLike
  transaction(name: string, mode: 'readonly' | 'readwrite'): ManagedExtensionIdbTransactionLike
  close(): void
}

export interface ManagedExtensionIdbTransactionLike {
  objectStore(name: string): ManagedExtensionIdbObjectStoreLike
  /** Present on the real IDBTransaction; optional only for deliberately small test doubles. */
  readonly error?: unknown
  oncomplete?: (() => void) | null
  onabort?: (() => void) | null
  onerror?: (() => void) | null
}

export interface ManagedExtensionIdbFactoryLike {
  open(
    name: string,
    version?: number,
  ): ManagedExtensionIdbOpenRequestLike<ManagedExtensionIdbDatabaseLike>
  /** Optional non-creating existence probe available on current browsers. */
  databases?(): Promise<readonly { readonly name?: string }[]>
}

export interface IndexedDbManagedExtensionMetadataStoreOptions {
  /** Injected non-creating probe for browsers/tests without `indexedDB.databases()`. */
  readonly databaseExists?: (name: string) => Promise<boolean>
}

export const MANAGED_EXTENSION_DATABASE = 'modkit.app.web/managed-extensions'
export const MANAGED_EXTENSION_METADATA_STORE = 'installations'
export const MANAGED_EXTENSION_CACHE = 'modkit.app.web/extension-packages-v1'

function settle<T>(request: ManagedExtensionIdbRequestLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(
        request.error instanceof Error
          ? request.error
          : new Error(`IndexedDB request failed: ${String(request.error)}`),
      )
  })
}

function transactionCompletion(
  transaction: ManagedExtensionIdbTransactionLike,
): Promise<void> | undefined {
  if (!('oncomplete' in transaction)) return undefined
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    const failed = () =>
      reject(
        transaction.error instanceof Error
          ? transaction.error
          : new Error(`IndexedDB transaction failed: ${String(transaction.error)}`),
      )
    transaction.onabort = failed
    transaction.onerror = failed
  })
}

/** See `extension-store.ts`: aborting the initial upgrade is a non-creating existence probe. */
async function probeExistingDatabase(
  factory: ManagedExtensionIdbFactoryLike,
  databaseName: string,
): Promise<boolean> {
  const request = factory.open(databaseName)
  let abortedInitialCreation = false
  return new Promise<boolean>((resolve, reject) => {
    request.onupgradeneeded = () => {
      abortedInitialCreation = true
      try {
        request.transaction?.abort()
      } catch (error) {
        reject(error)
      }
    }
    request.onsuccess = () => {
      request.result.close()
      resolve(!abortedInitialCreation)
    }
    request.onerror = event => {
      if (abortedInitialCreation) {
        event.preventDefault()
        resolve(false)
        return
      }
      reject(
        request.error instanceof Error
          ? request.error
          : new Error(`IndexedDB existence probe failed: ${String(request.error)}`),
      )
    }
  })
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isSettingsValue(
  value: unknown,
  seen: Set<object>,
): value is BrowserExtensionSettingsValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.every(entry => isSettingsValue(entry, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.values(value).every(entry => isSettingsValue(entry, seen))
  } finally {
    seen.delete(value)
  }
}

function normalizeSettings(value: unknown): BrowserExtensionSettings | undefined {
  if (!isSettingsValue(value, new Set()) || Array.isArray(value) || value === null) return undefined
  return Object.freeze(structuredClone(value) as Record<string, BrowserExtensionSettingsValue>)
}

function toInstalledRecord(value: unknown): InstalledBrowserExtension | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<Record<keyof InstalledBrowserExtension, unknown>>
  if (!nonEmpty(candidate.id) || !nonEmpty(candidate.version)) return undefined
  if (typeof candidate.digest !== 'string' || !DIGEST_PATTERN.test(candidate.digest)) {
    return undefined
  }
  if (!nonEmpty(candidate.sourceUrl) || !nonEmpty(candidate.cacheKey)) return undefined
  if (typeof candidate.installedAt !== 'number' || !Number.isFinite(candidate.installedAt)) {
    return undefined
  }
  if (typeof candidate.enabled !== 'boolean') return undefined
  const settings = normalizeSettings(candidate.settings)
  if (settings === undefined) return undefined
  let roots: readonly { readonly expectedId: string }[] | undefined
  if (candidate.roots !== undefined) {
    if (!Array.isArray(candidate.roots)) return undefined
    const normalized = candidate.roots
      .map(root =>
        typeof root === 'object' &&
        root !== null &&
        nonEmpty((root as { expectedId?: unknown }).expectedId)
          ? { expectedId: (root as { expectedId: string }).expectedId }
          : undefined,
      )
      .filter((root): root is { readonly expectedId: string } => root !== undefined)
    if (normalized.length !== candidate.roots.length || normalized.length === 0) return undefined
    roots = Object.freeze(normalized)
  }
  return Object.freeze({
    id: candidate.id,
    version: candidate.version,
    digest: candidate.digest,
    sourceUrl: candidate.sourceUrl,
    cacheKey: candidate.cacheKey,
    installedAt: candidate.installedAt,
    enabled: candidate.enabled,
    ...(typeof candidate.displayName === 'string' ? { displayName: candidate.displayName } : {}),
    ...(typeof candidate.publisher === 'string' ? { publisher: candidate.publisher } : {}),
    ...(typeof candidate.trusted === 'boolean' ? { trusted: candidate.trusted } : {}),
    ...(roots === undefined ? {} : { roots }),
    settings,
  })
}

const byIdentity = (left: InstalledBrowserExtension, right: InstalledBrowserExtension): number =>
  left.id.localeCompare(right.id, 'en')

/** Metadata and per-extension settings persisted in a dedicated IndexedDB database. */
export function createIndexedDbManagedExtensionMetadataStore(
  factory: ManagedExtensionIdbFactoryLike,
  databaseName: string = MANAGED_EXTENSION_DATABASE,
  storeName: string = MANAGED_EXTENSION_METADATA_STORE,
  options: IndexedDbManagedExtensionMetadataStoreOptions = {},
): BrowserExtensionMetadataStore {
  let knownToExist = false
  const exists = async (): Promise<boolean> => {
    if (knownToExist) return true
    const found =
      options.databaseExists !== undefined
        ? await options.databaseExists(databaseName)
        : factory.databases !== undefined
          ? (await factory.databases()).some(database => database.name === databaseName)
          : await probeExistingDatabase(factory, databaseName)
    if (found) knownToExist = true
    return found
  }
  const open = async (): Promise<ManagedExtensionIdbDatabaseLike> => {
    const request = factory.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    const database = await settle(request)
    knownToExist = true
    return database
  }

  const withStore = async <T>(
    mode: 'readonly' | 'readwrite',
    body: (store: ManagedExtensionIdbObjectStoreLike) => Promise<T>,
  ): Promise<T> => {
    const database = await open()
    const transaction = database.transaction(storeName, mode)
    const completed = transactionCompletion(transaction)
    try {
      const result = await body(transaction.objectStore(storeName))
      await completed
      return result
    } catch (error) {
      await completed?.catch(() => undefined)
      throw error
    } finally {
      database.close()
    }
  }

  return {
    location: `indexedDB[${databaseName}/${storeName}]`,
    async list() {
      if (!(await exists())) return Object.freeze([])
      const rows = await withStore('readonly', store => settle(store.getAll()))
      const records = rows
        .map(toInstalledRecord)
        .filter((record): record is InstalledBrowserExtension => record !== undefined)
        .sort(byIdentity)
      return Object.freeze(records)
    },
    async put(record) {
      await withStore('readwrite', store => settle(store.put(record)))
    },
    async remove(id) {
      await withStore('readwrite', store => settle(store.delete(id)))
    },
  }
}

export function createMemoryManagedExtensionMetadataStore(
  seed: readonly InstalledBrowserExtension[] = [],
): BrowserExtensionMetadataStore {
  const records = new Map(seed.map(record => [record.id, record]))
  return {
    location: 'memory metadata (this session only)',
    async list() {
      return Object.freeze([...records.values()].sort(byIdentity))
    },
    async put(record) {
      records.set(record.id, record)
    },
    async remove(id) {
      records.delete(id)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Cache Storage adapter

export interface BrowserCacheLike {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
  delete(request: string): Promise<boolean>
}

export interface BrowserCacheStorageLike {
  open(name: string): Promise<BrowserCacheLike>
  /** `CacheStorage.has()` does not create a missing cache. */
  has?(name: string): Promise<boolean>
}

export function createCacheStorageExtensionResponseCache(
  storage: BrowserCacheStorageLike,
  cacheName: string = MANAGED_EXTENSION_CACHE,
): BrowserExtensionResponseCache {
  let createdThisRuntime = false
  const exists = async (): Promise<boolean> =>
    createdThisRuntime || (storage.has !== undefined && (await storage.has(cacheName)))
  return {
    location: `cacheStorage[${cacheName}]`,
    async match(cacheKey) {
      if (!(await exists())) return undefined
      return (await storage.open(cacheName)).match(cacheKey)
    },
    async put(cacheKey, response) {
      const cache = await storage.open(cacheName)
      createdThisRuntime = true
      await cache.put(cacheKey, response)
    },
    async remove(cacheKey) {
      if (!(await exists())) return false
      return (await storage.open(cacheName)).delete(cacheKey)
    },
  }
}

export function createMemoryExtensionResponseCache(): BrowserExtensionResponseCache {
  const responses = new Map<string, Response>()
  return {
    location: 'memory responses (this session only)',
    async match(cacheKey) {
      return responses.get(cacheKey)?.clone()
    },
    async put(cacheKey, response) {
      responses.set(cacheKey, response.clone())
    },
    async remove(cacheKey) {
      return responses.delete(cacheKey)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// localStorage is intentionally limited to small presentation preferences

export interface BrowserExtensionUiPreferences {
  readonly selectedId?: string
  readonly showInstalledOnly: boolean
}

export interface BrowserLocalStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface BrowserExtensionUiPreferenceStore {
  readonly location: string
  read(): BrowserExtensionUiPreferences
  write(value: BrowserExtensionUiPreferences): void
}

export const MANAGED_EXTENSION_UI_PREFERENCES = 'modkit.app.web/managed-extension-ui-v1'

export function createLocalStorageExtensionUiPreferenceStore(
  storage: BrowserLocalStorageLike,
  key: string = MANAGED_EXTENSION_UI_PREFERENCES,
): BrowserExtensionUiPreferenceStore {
  return {
    location: `localStorage[${key}]`,
    read() {
      const raw = storage.getItem(key)
      if (raw === null) return { showInstalledOnly: false }
      try {
        const parsed = JSON.parse(raw) as { selectedId?: unknown; showInstalledOnly?: unknown }
        return {
          ...(nonEmpty(parsed.selectedId) ? { selectedId: parsed.selectedId } : {}),
          showInstalledOnly:
            typeof parsed.showInstalledOnly === 'boolean' ? parsed.showInstalledOnly : false,
        }
      } catch {
        return { showInstalledOnly: false }
      }
    },
    write(value) {
      const serialized = JSON.stringify({
        ...(nonEmpty(value.selectedId) ? { selectedId: value.selectedId } : {}),
        showInstalledOnly: value.showInstalledOnly,
      })
      if (serialized.length > 4096) {
        throw new Error('extension UI preferences exceed the 4 KiB localStorage budget')
      }
      storage.setItem(key, serialized)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// coordinated install/list/remove/enable service

function validateInstallRequest(
  request: BrowserExtensionInstallRequest,
): BrowserExtensionInstallRequest & { readonly digest: string } {
  if (!nonEmpty(request.id)) throw new Error('extension id must be a non-empty string')
  if (!nonEmpty(request.version)) throw new Error('extension version must be a non-empty string')
  if (!nonEmpty(request.sourceUrl))
    throw new Error('extension sourceUrl must be a non-empty string')
  const digest = request.digest.toLowerCase()
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error('extension digest must be a 64-character SHA-256 hex string')
  }
  if (request.settings !== undefined && normalizeSettings(request.settings) === undefined) {
    throw new Error('extension settings must be a JSON object')
  }
  return { ...request, digest }
}

function cacheKey(request: BrowserExtensionInstallRequest & { readonly digest: string }): string {
  const id = encodeURIComponent(request.id)
  const version = encodeURIComponent(request.version)
  return `https://extension-cache.modkit.invalid/${id}/${version}/${request.digest}`
}

async function defaultSha256(bytes: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error('Web Crypto SHA-256 is unavailable; inject BrowserSha256 for this environment')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function responseMatches(
  response: Response,
  expected: string,
  sha256: BrowserSha256,
): Promise<boolean> {
  const actual = (await sha256(await response.clone().arrayBuffer())).toLowerCase()
  return actual === expected
}

function findById(
  records: readonly InstalledBrowserExtension[],
  id: string,
): InstalledBrowserExtension | undefined {
  return records.find(record => record.id === id)
}

export function createBrowserExtensionStorage(
  options: BrowserExtensionStorageOptions,
): BrowserExtensionStorage {
  const sha256 = options.sha256 ?? defaultSha256
  const now = options.now ?? Date.now

  const verifiedCachedResponse = async (
    record: InstalledBrowserExtension,
  ): Promise<Response | undefined> => {
    const response = await options.responses.match(record.cacheKey)
    if (response === undefined) return undefined
    if (await responseMatches(response, record.digest, sha256)) return response
    await options.responses.remove(record.cacheKey)
    return undefined
  }

  return {
    metadataLocation: options.metadata.location,
    responseLocation: options.responses.location,
    list: () => options.metadata.list(),

    async install(unchecked) {
      const request = validateInstallRequest(unchecked)
      const records = await options.metadata.list()
      const previous = findById(records, request.id)
      const key = cacheKey(request)
      const pinned = Object.freeze({
        id: request.id,
        version: request.version,
        digest: request.digest,
        sourceUrl: request.sourceUrl,
        cacheKey: key,
        installedAt: now(),
        enabled: request.enabled ?? previous?.enabled ?? true,
        settings:
          normalizeSettings(request.settings ?? previous?.settings ?? {}) ?? Object.freeze({}),
      }) satisfies InstalledBrowserExtension

      let response = await options.responses.match(key)
      let wroteResponse = false
      if (response === undefined || !(await responseMatches(response, request.digest, sha256))) {
        if (response !== undefined) await options.responses.remove(key)
        response = await options.artifacts.acquire(request)
        if (!response.ok) {
          throw new Error(`extension package request failed with HTTP ${String(response.status)}`)
        }
        if (!(await responseMatches(response, request.digest, sha256))) {
          throw new Error(`extension package digest does not match ${request.digest}`)
        }
        await options.responses.put(key, response)
        wroteResponse = true
      }

      try {
        await options.metadata.put(pinned)
      } catch (error) {
        if (wroteResponse) await options.responses.remove(key)
        throw error
      }
      if (previous !== undefined && previous.cacheKey !== key) {
        await options.responses.remove(previous.cacheKey)
      }
      return pinned
    },

    async installVerified(unchecked) {
      const request = validateInstallRequest({
        id: unchecked.id,
        version: unchecked.version,
        digest: unchecked.digest,
        sourceUrl: unchecked.sourceUrl,
      })
      if (unchecked.roots.length === 0) {
        throw new Error('verified extension package must contain at least one root')
      }
      const expectedIds = new Set<string>()
      for (const root of unchecked.roots) {
        if (!nonEmpty(root.expectedId) || expectedIds.has(root.expectedId)) {
          throw new Error('verified extension roots require unique non-empty expectedId values')
        }
        expectedIds.add(root.expectedId)
      }
      const records = await options.metadata.list()
      const previous = findById(records, request.id)
      const key = cacheKey(request)
      const pinned = Object.freeze({
        id: request.id,
        version: request.version,
        digest: request.digest,
        sourceUrl: request.sourceUrl,
        cacheKey: key,
        installedAt: now(),
        // A new package is inert until the common manager commits EnablementStore=true. Updates
        // preserve the temporarily disabled state established before replacement.
        enabled: previous?.enabled ?? false,
        ...(unchecked.displayName === undefined
          ? previous?.displayName === undefined
            ? {}
            : { displayName: previous.displayName }
          : { displayName: unchecked.displayName }),
        ...(unchecked.publisher === undefined
          ? previous?.publisher === undefined
            ? {}
            : { publisher: previous.publisher }
          : { publisher: unchecked.publisher }),
        ...(unchecked.trusted === undefined ? {} : { trusted: unchecked.trusted }),
        roots: Object.freeze(unchecked.roots.map(root => Object.freeze({ ...root }))),
        settings: previous?.settings ?? Object.freeze({}),
      }) satisfies InstalledBrowserExtension

      const bytes = unchecked.bytes.slice()
      if ((await sha256(bytes.buffer as ArrayBuffer)).toLowerCase() !== request.digest) {
        throw new Error(`extension package digest does not match ${request.digest}`)
      }
      const previousResponse = await options.responses.match(key)
      let wroteResponse = false
      if (
        previousResponse === undefined ||
        !(await responseMatches(previousResponse, request.digest, sha256))
      ) {
        if (previousResponse !== undefined) await options.responses.remove(key)
        await options.responses.put(key, new Response(bytes))
        wroteResponse = true
      }
      try {
        await options.metadata.put(pinned)
      } catch (error) {
        if (wroteResponse) await options.responses.remove(key)
        throw error
      }
      if (previous !== undefined && previous.cacheKey !== key) {
        await options.responses.remove(previous.cacheKey)
      }
      return pinned
    },

    async remove(id) {
      const record = findById(await options.metadata.list(), id)
      if (record === undefined) return
      await options.metadata.remove(id)
      await options.responses.remove(record.cacheKey)
    },

    async enable(id, enabled) {
      const record = findById(await options.metadata.list(), id)
      if (record === undefined) throw new Error(`extension ${id} is not installed`)
      const updated = Object.freeze({ ...record, enabled })
      await options.metadata.put(updated)
      return updated
    },

    async updateSettings(id, settings) {
      const record = findById(await options.metadata.list(), id)
      if (record === undefined) throw new Error(`extension ${id} is not installed`)
      const normalized = normalizeSettings(settings)
      if (normalized === undefined) throw new Error('extension settings must be a JSON object')
      const updated = Object.freeze({ ...record, settings: normalized })
      await options.metadata.put(updated)
      return updated
    },

    async open(id) {
      const record = findById(await options.metadata.list(), id)
      if (record === undefined || !record.enabled) return undefined
      return verifiedCachedResponse(record)
    },

    async openInstalled(id) {
      const record = findById(await options.metadata.list(), id)
      if (record === undefined) return undefined
      return verifiedCachedResponse(record)
    },
  }
}
