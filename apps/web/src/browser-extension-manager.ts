/**
 * Browser ports for the shared extension-manager client.
 *
 * Construction is inert. `client.snapshot()` reaches only Cache Storage and IndexedDB;
 * `CatalogSource.refresh()` is the sole registry read, and `ArtifactAcquirer.acquire()` is reached
 * only by explicit install/update. Trust and install policy remain in the common client.
 */

import {
  createBrowserExtensionVfs,
  createExtensionManagerClient,
  extensionCatalogSigningBytes,
  parseExtensionCatalog,
  readMountBytes,
  type AcquiredExtensionArtifact,
  type ArtifactAcquirer,
  type ArtifactStore,
  type ArtifactStoreInstallRequest,
  type CatalogSource,
  type CatalogSourceResult,
  type EnablementStore,
  type ExtensionManagerClient,
  type ExtensionRegistryCatalog,
  type InstalledExtensionRecord,
} from '@modkit/extension-manager/browser'
import { inspectPortableExtensionBundle } from './managed-extension-roots.js'
import {
  createBrowserExtensionStorage,
  createCacheStorageExtensionResponseCache,
  createIndexedDbManagedExtensionMetadataStore,
  type BrowserCacheLike,
  type BrowserCacheStorageLike,
  type BrowserExtensionStorage,
  type InstalledBrowserExtension,
  type ManagedExtensionIdbFactoryLike,
} from './managed-extension-storage.js'

export { extensionCatalogSigningBytes as browserCatalogSigningBytes } from '@modkit/extension-manager/browser'

export const BROWSER_EXTENSION_CATALOG_CACHE = 'modkit.app.web/extension-catalog-v1'
export const BROWSER_EXTENSION_MUTATION_LOCK = 'modkit.app.web/extension-manager-mutation-v1'
export const BROWSER_EXTENSION_LOCK_UNAVAILABLE =
  'extension-manager/browser-mutation-lock-unavailable'
export const DEFAULT_BROWSER_CATALOG_MAX_BYTES = 2 * 1024 * 1024
/** Wave 1B signed Blizzard bundle is 152,838,525 bytes; keep a bounded production ceiling. */
export const DEFAULT_BROWSER_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024
export const BROWSER_HOST_FACILITY_UNAVAILABLE = 'x3.host/facility-unavailable'
export const BROWSER_SC2_FACILITY = 'filesystem.read-random'

export type BrowserTrustedEd25519Key = CryptoKey | JsonWebKey | Uint8Array

export interface BrowserRuntimeAvailability {
  readonly available: boolean
  readonly code?: typeof BROWSER_HOST_FACILITY_UNAVAILABLE
  readonly facility?: typeof BROWSER_SC2_FACILITY
}

/** The generated A8 route declares a filesystem-backed SC2/CASC corpus as a typed refusal in PWA. */
export function browserRuntimeAvailability(pwa: unknown): BrowserRuntimeAvailability {
  if (
    typeof pwa === 'object' &&
    pwa !== null &&
    (pwa as { kind?: unknown }).kind === 'host-facility-refusal' &&
    (pwa as { code?: unknown }).code === BROWSER_HOST_FACILITY_UNAVAILABLE &&
    (pwa as { facility?: unknown }).facility === BROWSER_SC2_FACILITY
  ) {
    return Object.freeze({
      available: false,
      code: BROWSER_HOST_FACILITY_UNAVAILABLE,
      facility: BROWSER_SC2_FACILITY,
    })
  }
  return Object.freeze({ available: true })
}

export function assertBrowserArtifactBound(bytes: number, maximum: number): void {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maximum
  ) {
    throw new RangeError(`extension source exceeds the ${String(maximum)} byte browser limit`)
  }
}

/** Structural Web Locks surface, kept injectable for deterministic cross-tab tests. */
export interface BrowserExtensionLockManager {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>
}

export class BrowserExtensionMutationLockUnavailableError extends Error {
  readonly code = BROWSER_EXTENSION_LOCK_UNAVAILABLE

  constructor() {
    super(
      'browser extension mutations require Web Locks; this browser can only inspect installed extensions',
    )
    this.name = 'BrowserExtensionMutationLockUnavailableError'
  }
}

export interface BrowserExtensionRegistryConfiguration {
  readonly catalogUri: string
  readonly trustedPublicKeys: Readonly<Record<string, BrowserTrustedEd25519Key>>
  readonly cacheKey?: string
}

export interface BrowserExtensionManagerFactoryOptions {
  readonly indexedDB: ManagedExtensionIdbFactoryLike
  readonly cacheStorage?: BrowserCacheStorageLike
  readonly registry?: BrowserExtensionRegistryConfiguration
  /** Trusted custom source; its adapter owns any signature verification it reports. */
  readonly catalogSource?: CatalogSource
  readonly crypto?: SubtleCrypto
  readonly fetch?: unknown
  readonly allowedOrigins?: readonly string[]
  readonly memoryEntries?: Readonly<Record<string, Uint8Array>>
  readonly browserFiles?: Readonly<Record<string, unknown>>
  readonly resolveBrowserFile?: (uri: string) => unknown
  readonly maxCatalogBytes?: number
  readonly maxArtifactBytes?: number
  /** `null` explicitly disables the platform default; useful for a fail-closed capability test. */
  readonly locks?: BrowserExtensionLockManager | null
}

export interface BrowserExtensionManagerRuntime {
  readonly client: ExtensionManagerClient
  readonly storage: BrowserExtensionStorage
  readonly catalogLocation: string
  readonly protocols: readonly string[]
  dispose(): Promise<void>
}

interface BrowserAcquiredArtifact {
  readonly bytes: Uint8Array
  readonly integrity: `sha256:${string}`
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true })

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return selected
}

function memoryCacheStorage(): BrowserCacheStorageLike {
  const caches = new Map<string, Map<string, Response>>()
  return {
    async has(name): Promise<boolean> {
      return caches.has(name)
    },
    async open(name): Promise<BrowserCacheLike> {
      let rows = caches.get(name)
      if (rows === undefined) {
        rows = new Map()
        caches.set(name, rows)
      }
      return {
        match: async request => rows?.get(request)?.clone(),
        put: async (request, response) => {
          rows?.set(request, response.clone())
        },
        delete: async request => rows?.delete(request) ?? false,
      }
    },
  }
}

function platformLockManager(): BrowserExtensionLockManager | undefined {
  const candidate = (
    globalThis as typeof globalThis & {
      readonly navigator?: { readonly locks?: BrowserExtensionLockManager }
    }
  ).navigator?.locks
  return candidate !== undefined && typeof candidate.request === 'function' ? candidate : undefined
}

function canonicalBase64(value: string): Uint8Array | undefined {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return undefined
  }
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

function cryptoKey(value: BrowserTrustedEd25519Key): value is CryptoKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'algorithm' in value &&
    'usages' in value
  )
}

async function importTrustedKey(
  subtle: SubtleCrypto,
  value: BrowserTrustedEd25519Key,
): Promise<CryptoKey> {
  if (cryptoKey(value)) return value
  if (value instanceof Uint8Array) {
    const bytes = new Uint8Array(value.byteLength)
    bytes.set(value)
    return subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify'])
  }
  return subtle.importKey('jwk', value, { name: 'Ed25519' }, false, ['verify'])
}

async function verifyCatalog(
  catalog: ExtensionRegistryCatalog,
  keys: Readonly<Record<string, BrowserTrustedEd25519Key>>,
  subtle: SubtleCrypto,
): Promise<boolean> {
  const signature = catalog.signature
  if (signature === undefined || signature.algorithm !== 'Ed25519') return false
  const encoded = canonicalBase64(signature.value)
  const trusted = keys[signature.keyId]
  if (encoded === undefined || trusted === undefined) return false
  try {
    const key = await importTrustedKey(subtle, trusted)
    const signatureBytes = new Uint8Array(encoded.byteLength)
    signatureBytes.set(encoded)
    const signing = extensionCatalogSigningBytes(catalog)
    const signingBytes = new Uint8Array(signing.byteLength)
    signingBytes.set(signing)
    return subtle.verify('Ed25519', key, signatureBytes, signingBytes)
  } catch {
    return false
  }
}

function response(bytes: Uint8Array): Response {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Response(copy, { headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(strictDecoder.decode(bytes)) as unknown
  } catch (error) {
    throw new Error(
      `${label} is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function sha256(subtle: SubtleCrypto, bytes: Uint8Array): Promise<`sha256:${string}`> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = new Uint8Array(await subtle.digest('SHA-256', copy))
  return `sha256:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function commonRecord(record: InstalledBrowserExtension): InstalledExtensionRecord {
  const roots = record.roots ?? [{ expectedId: record.id }]
  return Object.freeze({
    id: record.id,
    version: record.version,
    ...(record.displayName === undefined ? {} : { displayName: record.displayName }),
    ...(record.publisher === undefined ? {} : { publisher: record.publisher }),
    source: record.sourceUrl,
    trusted: record.trusted ?? false,
    enabled: record.enabled,
    roots: Object.freeze(
      roots.map(root =>
        Object.freeze({
          root: Object.freeze({ packageId: record.id, expectedId: root.expectedId }),
          expectedId: root.expectedId,
        }),
      ),
    ),
  })
}

/**
 * Creates the real browser runtime. A registry-enabled build injects `registry`; the default shell
 * omits it and remains an entirely local, empty manager until configuration is supplied.
 */
export function createBrowserExtensionManager(
  options: BrowserExtensionManagerFactoryOptions,
): BrowserExtensionManagerRuntime {
  const subtle = options.crypto ?? globalThis.crypto?.subtle
  if (subtle === undefined)
    throw new Error('WebCrypto is required for browser extension management')
  const maxCatalogBytes = positiveLimit(
    options.maxCatalogBytes,
    DEFAULT_BROWSER_CATALOG_MAX_BYTES,
    'maxCatalogBytes',
  )
  const maxArtifactBytes = positiveLimit(
    options.maxArtifactBytes,
    DEFAULT_BROWSER_ARTIFACT_MAX_BYTES,
    'maxArtifactBytes',
  )
  const maximumVfsBytes = Math.max(maxCatalogBytes, maxArtifactBytes)
  const created = createBrowserExtensionVfs({
    limits: {
      maxMaterializedBytes: BigInt(maximumVfsBytes),
      maxFileBytes: BigInt(maximumVfsBytes),
      maxReadBytes: BigInt(maximumVfsBytes),
      maxReadRangeBytes: Math.min(maximumVfsBytes, 16 * 1024 * 1024),
      maxStreamBytes: BigInt(maximumVfsBytes),
    },
    ...(options.memoryEntries === undefined ? {} : { memoryEntries: options.memoryEntries }),
    ...(options.browserFiles === undefined ? {} : { files: options.browserFiles }),
    ...(options.resolveBrowserFile === undefined ? {} : { resolve: options.resolveBrowserFile }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    // Browser extension downloads are deny-by-default. A product build must opt each registry/CDN
    // origin in explicitly; VFS then checks the initial URL, every redirect hop and the final URL.
    allowedOrigins: options.allowedOrigins ?? [],
  })
  const cacheStorage = options.cacheStorage ?? memoryCacheStorage()
  const metadata = createIndexedDbManagedExtensionMetadataStore(options.indexedDB)
  const responses = createCacheStorageExtensionResponseCache(cacheStorage)
  const storage = createBrowserExtensionStorage({
    metadata,
    responses,
    artifacts: {
      acquire: () =>
        Promise.reject(new Error('common extension manager owns browser artifact acquisition')),
    },
    sha256: async bytes => (await sha256(subtle, new Uint8Array(bytes))).slice('sha256:'.length),
  })

  const readUri = async (uri: string, limit: number): Promise<Uint8Array> => {
    const mount = await created.vfs.openMount(uri, {
      limits: {
        maxMaterializedBytes: BigInt(limit),
        maxFileBytes: BigInt(limit),
        maxReadBytes: BigInt(limit),
        maxStreamBytes: BigInt(limit),
      },
    })
    try {
      const bytes = await readMountBytes(mount)
      if (bytes.byteLength > limit) {
        throw new Error(`extension source exceeds the ${String(limit)} byte browser limit`)
      }
      return bytes
    } finally {
      await mount.dispose()
    }
  }

  const registry = options.registry
  const catalogCacheKey =
    registry?.cacheKey ??
    `https://extension-cache.modkit.invalid/catalog/${encodeURIComponent(registry?.catalogUri ?? 'offline')}`
  let catalogCacheCreatedThisRuntime = false
  const catalogCacheExists = async (): Promise<boolean> =>
    catalogCacheCreatedThisRuntime ||
    (cacheStorage.has !== undefined && (await cacheStorage.has(BROWSER_EXTENSION_CATALOG_CACHE)))
  const cachedCatalogSource: CatalogSource = {
    async cached(): Promise<CatalogSourceResult | undefined> {
      if (registry === undefined) return undefined
      if (!(await catalogCacheExists())) return undefined
      const cache = await cacheStorage.open(BROWSER_EXTENSION_CATALOG_CACHE)
      const cached = await cache.match(catalogCacheKey)
      if (cached === undefined) return undefined
      const bytes = new Uint8Array(await cached.arrayBuffer())
      if (bytes.byteLength > maxCatalogBytes) return undefined
      const catalog = parseExtensionCatalog(parseJson(bytes, 'cached extension catalog'))
      return {
        catalog,
        source: registry.catalogUri,
        signatureVerified: await verifyCatalog(catalog, registry.trustedPublicKeys, subtle),
      }
    },
    async refresh(): Promise<CatalogSourceResult | undefined> {
      if (registry === undefined) return undefined
      const bytes = await readUri(registry.catalogUri, maxCatalogBytes)
      const catalog = parseExtensionCatalog(parseJson(bytes, 'extension catalog'))
      const signatureVerified = await verifyCatalog(catalog, registry.trustedPublicKeys, subtle)
      if (signatureVerified) {
        const cache = await cacheStorage.open(BROWSER_EXTENSION_CATALOG_CACHE)
        catalogCacheCreatedThisRuntime = true
        await cache.put(catalogCacheKey, response(bytes))
      }
      return { catalog, source: registry.catalogUri, signatureVerified }
    },
  }
  const catalogSource = options.catalogSource ?? cachedCatalogSource

  const artifactAcquirer: ArtifactAcquirer = {
    async acquire(entry): Promise<AcquiredExtensionArtifact> {
      if (entry.source.bytes !== undefined)
        assertBrowserArtifactBound(entry.source.bytes, maxArtifactBytes)
      const bytes = await readUri(entry.source.uri, maxArtifactBytes)
      const integrity = await sha256(subtle, bytes)
      const artifact: BrowserAcquiredArtifact = Object.freeze({ bytes, integrity })
      return Object.freeze({ artifact, integrity })
    },
  }

  const artifactStore: ArtifactStore = {
    async list() {
      return Object.freeze((await storage.list()).map(commonRecord))
    },
    async install(request: ArtifactStoreInstallRequest) {
      const artifact = request.artifact as Partial<BrowserAcquiredArtifact>
      if (!(artifact.bytes instanceof Uint8Array) || typeof artifact.integrity !== 'string') {
        throw new Error('browser ArtifactStore requires verified in-memory bytes')
      }
      const roots = inspectPortableExtensionBundle(artifact.bytes)
      const declaredRoots = [...request.entry.extensions].sort()
      const portableRoots = [...roots].sort()
      if (
        portableRoots.length !== declaredRoots.length ||
        portableRoots.some((root, index) => root !== declaredRoots[index])
      ) {
        throw new Error(
          `portable package roots do not match catalog entry: expected [${declaredRoots.join(', ')}], got [${portableRoots.join(', ')}]`,
        )
      }
      const digest = artifact.integrity.slice('sha256:'.length)
      const stored = await storage.installVerified({
        id: request.entry.id,
        version: request.entry.version,
        digest,
        sourceUrl: request.entry.source.uri,
        bytes: artifact.bytes,
        roots: roots.map(expectedId => ({ expectedId })),
        displayName: request.entry.displayName,
        publisher: request.entry.publisher,
        trusted: request.entry.trusted,
      })
      return commonRecord(stored)
    },
    remove: id => storage.remove(id),
  }

  const pendingEnablement = new Map<string, boolean>()
  const enablementStore: EnablementStore = {
    async list() {
      const installed = await storage.list()
      const installedIds = new Set(installed.map(record => record.id))
      return Object.freeze([
        ...installed.map(record => Object.freeze({ id: record.id, enabled: record.enabled })),
        ...[...pendingEnablement]
          .filter(([id]) => !installedIds.has(id))
          .map(([id, enabled]) => Object.freeze({ id, enabled })),
      ])
    },
    async setEnabled(id, enabled) {
      const installed = (await storage.list()).some(record => record.id === id)
      if (!installed) {
        pendingEnablement.set(id, enabled)
        return
      }
      await storage.enable(id, enabled)
      pendingEnablement.delete(id)
    },
    // The common client removes the artifact first; enablement shares that same IndexedDB record.
    remove: id => {
      pendingEnablement.delete(id)
      return Promise.resolve()
    },
  }

  const localClient = createExtensionManagerClient({
    catalogSource,
    artifactAcquirer,
    artifactStore,
    enablementStore,
  })
  const locks = options.locks === undefined ? platformLockManager() : (options.locks ?? undefined)
  const mutateAcrossTabs = <T>(operation: () => Promise<T>): Promise<T> => {
    if (locks === undefined) {
      return Promise.reject(new BrowserExtensionMutationLockUnavailableError())
    }
    return Promise.resolve().then(() =>
      locks.request(BROWSER_EXTENSION_MUTATION_LOCK, { mode: 'exclusive' }, operation),
    )
  }
  const client: ExtensionManagerClient = Object.freeze({
    snapshot: () => localClient.snapshot(),
    refresh: () => mutateAcrossTabs(() => localClient.refresh()),
    install: (id: string, version?: string) =>
      mutateAcrossTabs(() => localClient.install(id, version)),
    update: (id: string) => mutateAcrossTabs(() => localClient.update(id)),
    remove: (id: string) => mutateAcrossTabs(() => localClient.remove(id)),
    setEnabled: (id: string, enabled: boolean) =>
      mutateAcrossTabs(() => localClient.setEnabled(id, enabled)),
  })
  return Object.freeze({
    client,
    storage,
    catalogLocation: registry?.catalogUri ?? 'offline cache (no extension registry configured)',
    protocols: created.protocols,
    dispose: async () => {
      await created.vfs.dispose()
    },
  })
}
