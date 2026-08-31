/**
 * S12-web: what the installed-extensions panel says, and where the list survives a reload.
 *
 * The panel's DOM is not exercised here — these suites run in Node without a document — but its
 * *content* is: `describeExtensionList` is a pure function of the load result, so the rows, the
 * provenance sentences and the verbatim failure codes are asserted directly. The handle store is
 * asserted against a fake IndexedDB, because a list that does not survive a reload is not
 * persistence and a wrapper nobody ran is not a store.
 */
import { webcrypto } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  EXTENSION_ROOT_FAILURE_CODES,
  loadUserExtensionRoots,
  type WebExtensionDirectoryHandle,
} from '../src/extension-roots.js'
import {
  createIndexedDbExtensionStore,
  createMemoryExtensionStore,
  USER_EXTENSION_DATABASE,
  type IdbDatabaseLike,
  type IdbFactoryLike,
  type IdbObjectStoreLike,
  type IdbOpenRequestLike,
  type IdbRequestLike,
  type StoredUserExtension,
} from '../src/extension-store.js'
import {
  describeExtensionList,
  USER_EXTENSION_PROVENANCE_NOTE,
  USER_EXTENSION_TRUST_SENTENCE,
} from '../src/extensions-ui.js'
import { createWebLocalizer } from '../src/localization.js'
import { repositoryRoot } from './browser-harness.js'

const subtle = webcrypto.subtle as never

// ---------------------------------------------------------------------------------------------
// a directory handle over a real extension on disk (the same fake shape the loader suite uses)

function treeFromDisk(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(directory, entry.name), path)
      else files.set(path, new Uint8Array(readFileSync(join(directory, entry.name))))
    }
  }
  walk(root, '')
  return files
}

function directoryHandle(
  name: string,
  files: Map<string, Uint8Array>,
  prefix = '',
  permission?: 'granted' | 'prompt' | 'denied',
): WebExtensionDirectoryHandle {
  const scope = prefix === '' ? '' : `${prefix}/`
  const base: WebExtensionDirectoryHandle = {
    kind: 'directory',
    name,
    entries: async function* () {
      const seen = new Set<string>()
      for (const path of files.keys()) {
        if (!path.startsWith(scope)) continue
        const rest = path.slice(scope.length)
        const slash = rest.indexOf('/')
        const childName = slash === -1 ? rest : rest.slice(0, slash)
        if (childName === '' || seen.has(childName)) continue
        seen.add(childName)
        const childPath = `${scope}${childName}`
        if (slash === -1) {
          yield [
            childName,
            {
              kind: 'file' as const,
              name: childName,
              async getFile() {
                const bytes = files.get(childPath) ?? new Uint8Array()
                return {
                  name: childName,
                  size: bytes.byteLength,
                  lastModified: 1,
                  slice(start: number, end: number) {
                    const part = bytes.slice(start, end)
                    return {
                      async arrayBuffer() {
                        const copy = new ArrayBuffer(part.byteLength)
                        new Uint8Array(copy).set(part)
                        return copy
                      },
                    }
                  },
                }
              },
            },
          ] as const
        } else {
          yield [childName, directoryHandle(childName, files, childPath, permission)] as const
        }
      }
    },
  }
  if (permission === undefined) return base
  return { ...base, queryPermission: async () => permission }
}

const imagesRoot = join(repositoryRoot, 'extensions', 'images')

// ---------------------------------------------------------------------------------------------

describe('the installed-extensions panel', () => {
  it('states the trust model in one sentence, and does not let the two provenances blur', () => {
    expect(USER_EXTENSION_TRUST_SENTENCE).toContain('because you picked it')
    expect(USER_EXTENSION_TRUST_SENTENCE).toContain('nothing is signed')
    expect(USER_EXTENSION_TRUST_SENTENCE).toContain('worker')
    expect(USER_EXTENSION_PROVENANCE_NOTE).toContain('recorded when it was built')
    expect(USER_EXTENSION_PROVENANCE_NOTE).toContain('computed itself')
    expect(USER_EXTENSION_PROVENANCE_NOTE).toContain('not a claim about who wrote them')
  })

  it('lists every bundled extension and says where it came from', () => {
    const rows = describeExtensionList({
      catalog: WEB_EXTENSION_CATALOG,
      loaded: {
        inputs: [],
        failures: [],
        coordinates: [],
        rootIds: [],
        moduleMap: {},
        moduleMapOwners: {},
        verifiedModuleRoots: [],
        serve: async url => ({
          ok: false,
          status: 404,
          arrayBuffer: () => Promise.reject(new Error(url)),
        }),
      },
    })
    expect(rows).toHaveLength(WEB_EXTENSION_CATALOG.extensions.length)
    expect(rows.every(row => row.kind === 'bundled' && row.state === 'loaded')).toBe(true)
    expect(rows[0]?.provenance).toContain('Bundled with this build')
    expect(rows.some(row => row.coordinate === 'modkit/images')).toBe(true)
  })

  it('localizes provenance rows for a Russian host without changing their technical identity', () => {
    const rows = describeExtensionList(
      {
        catalog: WEB_EXTENSION_CATALOG,
        loaded: {
          inputs: [],
          failures: [],
          coordinates: [],
          rootIds: [],
          moduleMap: {},
          moduleMapOwners: {},
          verifiedModuleRoots: [],
          serve: async url => ({
            ok: false,
            status: 404,
            arrayBuffer: () => Promise.reject(new Error(url)),
          }),
        },
      },
      createWebLocalizer('ru'),
    )
    expect(rows[0]?.provenance).toContain('Встроено в эту сборку')
    expect(rows.some(row => row.coordinate === 'modkit/images')).toBe(true)
  })

  it('shows a granted folder with its coordinate, the folder name, and a provenance that is not an attestation', async () => {
    const handle = directoryHandle('my-codecs', treeFromDisk(imagesRoot))
    const loaded = await loadUserExtensionRoots([{ id: 'root-1', handle }], { subtle })
    const stored: StoredUserExtension[] = [
      { id: 'root-1', label: 'my-codecs', addedAt: 1, coordinate: 'modkit/images', handle },
    ]
    const rows = describeExtensionList({ catalog: WEB_EXTENSION_CATALOG, loaded, stored })

    const user = rows.filter(row => row.kind === 'user')
    expect(user).toHaveLength(1)
    expect(user[0]).toMatchObject({
      state: 'loaded',
      rootId: 'root-1',
      label: 'my-codecs',
      coordinate: 'modkit/images',
    })
    expect(user[0]?.provenance).toContain('Folder you granted')
    expect(user[0]?.provenance).toContain('computed by this page')
    expect(user[0]?.provenance).not.toContain('attested')
  })

  it('keeps a folder whose grant lapsed in the list, as "needs permission" with its code', async () => {
    const handle = directoryHandle('my-codecs', treeFromDisk(imagesRoot), '', 'prompt')
    const loaded = await loadUserExtensionRoots([{ id: 'root-1', handle }], { subtle })
    const rows = describeExtensionList({
      catalog: WEB_EXTENSION_CATALOG,
      loaded,
      stored: [{ id: 'root-1', label: 'my-codecs', addedAt: 1, handle }],
    })

    const user = rows.filter(row => row.kind === 'user')
    expect(user).toHaveLength(1)
    expect(user[0]?.state).toBe('needs-permission')
    expect(user[0]?.rootId).toBe('root-1')
    expect(user[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.permissionRequired)
  })

  it('shows failures verbatim, including ones the composition found afterwards', async () => {
    const loaded = await loadUserExtensionRoots(
      [{ id: 'root-x', handle: directoryHandle('Downloads', new Map()) }],
      { subtle },
    )
    const rows = describeExtensionList({
      catalog: WEB_EXTENSION_CATALOG,
      loaded,
      extraFailures: [
        {
          root: 'user-folder/other',
          rootId: 'root-y',
          code: 'x3.host/extension-coordinate-conflict',
          message: '«modkit/images» is already loaded from another root; this one is ignored',
        },
      ],
    })

    const failed = rows.filter(row => row.state === 'failed')
    expect(failed).toHaveLength(2)
    expect(failed[0]?.code).toBe(EXTENSION_ROOT_FAILURE_CODES.notAnExtension)
    expect(failed[1]?.code).toBe('x3.host/extension-coordinate-conflict')
    expect(failed[1]?.detail).toContain('already loaded from another root')
  })
})

// ---------------------------------------------------------------------------------------------
// the handle store

class FakeRequest<T> implements IdbRequestLike<T> {
  result: T
  error: unknown = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(initial: T) {
    this.result = initial
  }
}

class FakeOpenRequest<T> extends FakeRequest<T> implements IdbOpenRequestLike<T> {
  onupgradeneeded: ((event: Event) => void) | null = null
  transaction?: { abort(): void } | null
}

function settled<T>(initial: T, work: () => T): FakeRequest<T> {
  const request = new FakeRequest<T>(initial)
  queueMicrotask(() => {
    try {
      request.result = work()
      request.onsuccess?.(new Event('success'))
    } catch (error) {
      request.error = error
      request.onerror?.(new Event('error'))
    }
  })
  return request
}

/** Just enough IndexedDB to run the wrapper: one database, one keyPath store, real async edges. */
function fakeIndexedDb(): { readonly factory: IdbFactoryLike; closes(): number } {
  const stores = new Map<string, Map<string, unknown>>()
  let closes = 0

  const objectStore = (name: string): IdbObjectStoreLike => {
    const rows = stores.get(name)
    if (rows === undefined) throw new Error(`no object store «${name}»`)
    return {
      put: value =>
        settled<unknown>(undefined, () => {
          const id = (value as { readonly id?: unknown }).id
          if (typeof id !== 'string') throw new Error('records need a string id')
          rows.set(id, value)
          return undefined
        }),
      delete: key => settled<unknown>(undefined, () => void rows.delete(key)),
      getAll: () => settled<readonly unknown[]>([], () => [...rows.values()]),
    }
  }

  const database: IdbDatabaseLike = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      stores.set(name, new Map())
      return objectStore(name)
    },
    transaction: name => ({ objectStore: () => objectStore(name) }),
    close: () => void (closes += 1),
  }

  return {
    closes: () => closes,
    factory: {
      databases: async () => (stores.has('roots') ? [{ name: USER_EXTENSION_DATABASE }] : []),
      open: () => {
        const request = new FakeOpenRequest<IdbDatabaseLike>(database)
        queueMicrotask(() => {
          if (!stores.has('roots')) request.onupgradeneeded?.(new Event('upgradeneeded'))
          request.onsuccess?.(new Event('success'))
        })
        return request
      },
    },
  }
}

function fallbackIndexedDb(): {
  readonly factory: IdbFactoryLike
  readonly exists: () => boolean
  readonly opens: () => number
} {
  const stores = new Map<string, Map<string, unknown>>()
  let databaseExists = false
  let openCount = 0

  const objectStore = (name: string): IdbObjectStoreLike => {
    const rows = stores.get(name)
    if (rows === undefined) throw new Error(`no fallback object store «${name}»`)
    return {
      put: value =>
        settled<unknown>(undefined, () => {
          const id = (value as { readonly id?: unknown }).id
          if (typeof id !== 'string') throw new Error('records need a string id')
          rows.set(id, structuredClone(value))
          return undefined
        }),
      delete: key => settled<unknown>(undefined, () => void rows.delete(key)),
      getAll: () => settled<readonly unknown[]>([], () => [...rows.values()]),
    }
  }
  const database: IdbDatabaseLike = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      stores.set(name, new Map())
      return objectStore(name)
    },
    transaction: name => ({ objectStore: () => objectStore(name) }),
    close: () => undefined,
  }
  return {
    factory: {
      open: () => {
        openCount += 1
        let aborted = false
        const request = new FakeOpenRequest<IdbDatabaseLike>(database)
        request.transaction = { abort: () => void (aborted = true) }
        queueMicrotask(() => {
          if (!databaseExists) request.onupgradeneeded?.(new Event('upgradeneeded'))
          queueMicrotask(() => {
            if (aborted) {
              stores.clear()
              request.error = new Error('AbortError')
              request.onerror?.(new Event('error', { cancelable: true }))
              return
            }
            databaseExists = true
            request.onsuccess?.(new Event('success'))
          })
        })
        return request
      },
    },
    exists: () => databaseExists,
    opens: () => openCount,
  }
}

const record = (id: string, label: string, addedAt: number): StoredUserExtension => ({
  id,
  label,
  addedAt,
  coordinate: `org.example/${id}`,
  handle: { kind: 'directory', name: label },
})

describe('the granted-folder store', () => {
  it('leaves no database on an empty-shell read and finds an existing database without databases()', async () => {
    const idb = fallbackIndexedDb()
    const emptyShellStore = createIndexedDbExtensionStore(idb.factory)
    expect(await emptyShellStore.list()).toEqual([])
    expect(idb.opens()).toBe(1)
    expect(idb.exists()).toBe(false)

    await emptyShellStore.add(record('a', 'codecs', 1))
    expect(idb.exists()).toBe(true)
    const afterReload = createIndexedDbExtensionStore(idb.factory)
    expect((await afterReload.list()).map(entry => entry.id)).toEqual(['a'])
    expect(idb.exists()).toBe(true)
  })

  it('survives a reload: what was added is what the next load lists', async () => {
    const idb = fakeIndexedDb()
    const first = createIndexedDbExtensionStore(idb.factory)
    await first.add(record('a', 'codecs', 2))
    await first.add(record('b', 'more-codecs', 1))

    // a fresh store object over the same database is what a reload actually looks like
    const second = createIndexedDbExtensionStore(idb.factory)
    const listed = await second.list()
    expect(listed.map(entry => entry.id)).toEqual(['b', 'a'])
    expect(listed[0]?.handle.name).toBe('more-codecs')
    expect(listed[0]?.coordinate).toBe('org.example/b')

    await second.remove('b')
    expect((await second.list()).map(entry => entry.id)).toEqual(['a'])
    expect(idb.closes()).toBeGreaterThan(0)
  })

  it('stores no digest: a reload re-reads and re-hashes, it never inherits a measurement', async () => {
    const idb = fakeIndexedDb()
    const store = createIndexedDbExtensionStore(idb.factory)
    await store.add(record('a', 'codecs', 1))
    const listed = await store.list()
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      'addedAt',
      'coordinate',
      'handle',
      'id',
      'label',
    ])
  })

  it('ignores rows it did not write instead of throwing the whole list away', async () => {
    const idb = fakeIndexedDb()
    const store = createIndexedDbExtensionStore(idb.factory)
    await store.add(record('a', 'codecs', 1))
    // something else wrote into the same store
    const database = await new Promise<IdbDatabaseLike>(resolve => {
      const request = idb.factory.open('x', 1)
      request.onsuccess = () => resolve(request.result)
    })
    const raw = database.transaction('roots', 'readwrite').objectStore('roots')
    await new Promise<void>(resolve => {
      const put = raw.put({ id: 'junk', note: 'not one of ours' })
      put.onsuccess = () => resolve()
    })

    const listed = await store.list()
    expect(listed.map(entry => entry.id)).toEqual(['a'])
  })

  it('the in-memory store is the same contract, and says it does not survive a reload', async () => {
    const store = createMemoryExtensionStore([record('a', 'codecs', 1)])
    expect(store.location).toContain('this session only')
    await store.add(record('b', 'more', 2))
    expect((await store.list()).map(entry => entry.id)).toEqual(['a', 'b'])
    await store.remove('a')
    expect((await store.list()).map(entry => entry.id)).toEqual(['b'])
  })
})
