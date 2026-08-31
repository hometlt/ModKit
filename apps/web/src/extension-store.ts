/**
 * Where the browser keeps the folders a user granted.
 *
 * A directory handle is not a path and cannot be serialised to text: `localStorage` (which holds
 * this app's settings) can only ever store the *idea* of a folder, never a usable reference to
 * one. IndexedDB can — it structured-clones a File System Access handle — so the installed list
 * lives here and survives a reload.
 *
 * What is stored is the handle, an id, the folder's name and the coordinate the folder declared
 * when it was added. What is deliberately **not** stored is any digest. Digests are re-computed
 * from the bytes on every load (`./extension-roots.ts`); a cached one would turn a measurement
 * this page took into a claim this page inherited, which is precisely the confusion the trust
 * model refuses to make.
 *
 * A stored handle also carries no standing grant: browsers let the read permission lapse between
 * sessions, and re-affirming it needs a user gesture. That is a UI concern, not a storage one —
 * the store hands back the handle and the loader reports what the grant currently says.
 *
 * Every IndexedDB shape is declared structurally, so the wrapper is unit-tested in Node against a
 * fake and runs unchanged in the page.
 */

import type { WebExtensionDirectoryHandle } from './extension-roots.js'

// ---------------------------------------------------------------------------------------------
// structural IndexedDB shapes

export interface IdbRequestLike<T> {
  readonly result: T
  readonly error: unknown
  onsuccess: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

export interface IdbOpenRequestLike<T> extends IdbRequestLike<T> {
  onupgradeneeded: ((event: Event) => void) | null
  /** Present on a real IDBOpenDBRequest while an initial create/upgrade is running. */
  readonly transaction?: { abort(): void } | null
}

export interface IdbObjectStoreLike {
  put(value: unknown): IdbRequestLike<unknown>
  delete(key: string): IdbRequestLike<unknown>
  getAll(): IdbRequestLike<readonly unknown[]>
}

export interface IdbTransactionLike {
  objectStore(name: string): IdbObjectStoreLike
}

export interface IdbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string, options: { readonly keyPath: string }): IdbObjectStoreLike
  transaction(name: string, mode: 'readonly' | 'readwrite'): IdbTransactionLike
  close(): void
}

export interface IdbFactoryLike {
  open(name: string, version?: number): IdbOpenRequestLike<IdbDatabaseLike>
  /** Current browsers expose a non-creating database-name probe. */
  databases?(): Promise<readonly { readonly name?: string }[]>
}

export interface IndexedDbExtensionStoreOptions {
  /** Test/host seam for a non-creating database-name probe. */
  readonly databaseExists?: (name: string) => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------
// records and the store contract

export interface StoredUserExtension {
  /** Stable identity assigned when the folder was added; also the synthetic artifact root's id. */
  readonly id: string
  /** The folder's name at the time it was added — all a page ever learns of where it is. */
  readonly label: string
  readonly addedAt: number
  /** Coordinate the folder declared when it was added; a later change is reported as a mismatch. */
  readonly coordinate?: string
  readonly handle: WebExtensionDirectoryHandle
}

export interface UserExtensionStore {
  /** Human-readable location, for a settings panel that says where the list actually lives. */
  readonly location: string
  list(): Promise<readonly StoredUserExtension[]>
  add(record: StoredUserExtension): Promise<void>
  remove(id: string): Promise<void>
}

export const USER_EXTENSION_DATABASE = 'modkit.app.web/extensions'
export const USER_EXTENSION_STORE = 'roots'

// ---------------------------------------------------------------------------------------------
// helpers

function settle<T>(request: IdbRequestLike<T>): Promise<T> {
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

/**
 * Probe a database on browsers which predate `indexedDB.databases()` without leaving an empty
 * database behind. Opening a missing database starts its initial versionchange transaction; an
 * abort rolls that creation back. Opening an existing database has no upgrade event and is closed
 * immediately after the successful probe.
 */
async function probeExistingDatabase(
  factory: IdbFactoryLike,
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
        // The AbortError is the expected completion of the non-creating probe. Prevent it from
        // bubbling as an unhandled IndexedDB error in a real page.
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

/** Reads back only what this module wrote; anything else in the store is ignored, not thrown on. */
function toRecord(value: unknown): StoredUserExtension | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as {
    readonly id?: unknown
    readonly label?: unknown
    readonly addedAt?: unknown
    readonly coordinate?: unknown
    readonly handle?: unknown
  }
  if (typeof candidate.id !== 'string' || candidate.id === '') return undefined
  if (typeof candidate.label !== 'string') return undefined
  const handle = candidate.handle
  if (typeof handle !== 'object' || handle === null) return undefined
  if ((handle as { readonly kind?: unknown }).kind !== 'directory') return undefined
  return {
    id: candidate.id,
    label: candidate.label,
    addedAt: typeof candidate.addedAt === 'number' ? candidate.addedAt : 0,
    ...(typeof candidate.coordinate === 'string' ? { coordinate: candidate.coordinate } : {}),
    handle: handle as WebExtensionDirectoryHandle,
  }
}

const byAddedAt = (left: StoredUserExtension, right: StoredUserExtension): number =>
  left.addedAt === right.addedAt
    ? left.id < right.id
      ? -1
      : left.id > right.id
        ? 1
        : 0
    : left.addedAt - right.addedAt

// ---------------------------------------------------------------------------------------------
// IndexedDB store

/**
 * The installed list in IndexedDB.
 *
 * The database is opened per operation and closed again: the list changes rarely, and an open
 * connection would block a version change made by another tab of the same app.
 */
export function createIndexedDbExtensionStore(
  factory: IdbFactoryLike,
  databaseName: string = USER_EXTENSION_DATABASE,
  storeName: string = USER_EXTENSION_STORE,
  options: IndexedDbExtensionStoreOptions = {},
): UserExtensionStore {
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
  const open = async (): Promise<IdbDatabaseLike> => {
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
    body: (store: IdbObjectStoreLike) => Promise<T>,
  ): Promise<T> => {
    const database = await open()
    try {
      return await body(database.transaction(storeName, mode).objectStore(storeName))
    } finally {
      database.close()
    }
  }

  return {
    location: `indexedDB[${databaseName}/${storeName}]`,

    async list() {
      if (!(await exists())) return Object.freeze([])
      const rows = await withStore('readonly', store => settle(store.getAll()))
      const records: StoredUserExtension[] = []
      for (const row of rows) {
        const record = toRecord(row)
        if (record !== undefined) records.push(record)
      }
      return Object.freeze(records.sort(byAddedAt))
    },

    async add(record) {
      await withStore('readwrite', store => settle(store.put(record)))
    },

    async remove(id) {
      if (!(await exists())) return
      await withStore('readwrite', store => settle(store.delete(id)))
    },
  }
}

// ---------------------------------------------------------------------------------------------
// in-memory store

/** The same contract without a browser: what tests use, and the honest fallback in a private
 * window where IndexedDB is unavailable — the list then simply does not survive the reload, and
 * the settings panel says so through `location`. */
export function createMemoryExtensionStore(
  seed: readonly StoredUserExtension[] = [],
): UserExtensionStore {
  const records = new Map<string, StoredUserExtension>(seed.map(entry => [entry.id, entry]))
  return {
    location: 'memory (this session only)',
    async list() {
      return Object.freeze([...records.values()].sort(byAddedAt))
    },
    async add(record) {
      records.set(record.id, record)
    },
    async remove(id) {
      records.delete(id)
    },
  }
}
