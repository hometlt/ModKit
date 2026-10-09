/**
 * Bridge from digest-verified downloaded packages to the browser host's existing extension-root
 * loader.
 *
 * The portable browser package is UTF-8 `modkit.repository.json`, optionally gzip transported.
 * The common manager byte decoder bounds decoded JSON; transport digest/cache identity is retained.
 * Every enabled
 * repository entry must carry `id` and `files`, where each file value is base64. A path-only entry
 * is meaningful on Node but cannot name bytes inside a browser Cache Storage response, so it is
 * diagnosed and refused. Embedded files become structural in-memory directory handles and then
 * go through `loadUserExtensionRoots`: the same manifest normalization, per-file hashes,
 * `expectedId`, worker-only execution and verified synthetic fetch used for user-granted folders.
 *
 * There is intentionally no `import()` here. This module produces `ExtensionInput` records and a
 * byte source; the host's worker backend remains the only component allowed to evaluate one.
 */

import { decodeRepositoryArtifact, normalizeRepositoryManifest, type RepositoryArtifactDecodeOptions } from '@modkit/extension-manager/browser'
import type { BrowserFetchLike, BrowserSubtleCryptoLike } from '@modkit/host/browser'
import {
  loadUserExtensionRoots,
  NO_USER_EXTENSION_ROOTS,
  type LoadedUserExtensionRoots,
  type UserExtensionRootFailure,
  type WebExtensionDirectoryHandle,
} from './extension-roots.js'
import type { WebDirectoryHandleLike, WebFileHandleLike } from './files.js'
import type {
  BrowserExtensionStorage,
  InstalledBrowserExtension,
} from './managed-extension-storage.js'

interface NormalizedRepositoryExtension {
  readonly id?: string
  readonly path?: string
  readonly files?: Readonly<Record<string, string>>
  readonly enabled: boolean
}

interface NormalizedRepositoryManifest {
  readonly schemaVersion: 1
  readonly extensions: readonly NormalizedRepositoryExtension[]
}

export const MANAGED_EXTENSION_BUNDLE_FAILURE_CODES = Object.freeze({
  unavailable: 'x3.host/managed-extension-package-unavailable',
  invalid: 'x3.host/managed-extension-package-invalid',
  pathOnly: 'x3.host/managed-extension-path-only-bundle',
  identityMissing: 'x3.host/managed-extension-identity-missing',
  filePathInvalid: 'x3.host/managed-extension-file-path-invalid',
  base64Invalid: 'x3.host/managed-extension-base64-invalid',
})

export interface LoadManagedExtensionRootsOptions {
  readonly subtle: BrowserSubtleCryptoLike
  readonly claimed?: readonly string[]
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  readonly maxRepositoryDocumentBytes?: number
  readonly signal?: AbortSignal
}

export interface LoadedManagedExtensionRoots extends LoadedUserExtensionRoots {
  /** Exact distribution package owner for every successfully loaded extension coordinate. */
  readonly packageByCoordinate: Readonly<Record<string, string>>
  /** Coordinates retained in inventory but disabled because their package switch is off. */
  readonly disabledExtensionCoordinates: readonly string[]
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function failure(
  record: InstalledBrowserExtension,
  code: string,
  message: string,
  suffix = '',
): UserExtensionRootFailure {
  return {
    root: record.id,
    rootId: `${record.id}${suffix}`,
    code,
    message,
  }
}

function isNormalizedRepositoryManifest(value: unknown): value is NormalizedRepositoryManifest {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { readonly schemaVersion?: unknown; readonly extensions?: unknown }
  return candidate.schemaVersion === 1 && Array.isArray(candidate.extensions)
}

/** Stack-safe canonical alphabet/padding check for distribution files hundreds of MiB long. */
export function isCanonicalBase64(encoded: string): boolean {
  if (encoded.length % 4 !== 0) return false
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const contentLength = encoded.length - padding
  for (let index = 0; index < contentLength; index += 1) {
    const code = encoded.charCodeAt(index)
    if (!(
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f
    )) {
      return false
    }
  }
  for (let index = contentLength; index < encoded.length; index += 1) {
    if (encoded.charCodeAt(index) !== 0x3d) return false
  }
  return true
}

function decodeBase64(encoded: string, path: string): Uint8Array {
  if (!isCanonicalBase64(encoded)) {
    throw new Error(`${path} is not canonical base64`)
  }
  let binary: string
  try {
    binary = atob(encoded)
  } catch (error) {
    throw new Error(`${path} is not valid base64: ${messageOf(error)}`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function validateFilePath(path: string): void {
  const parts = path.split('/')
  if (
    path === '' ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    parts.some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`embedded file path «${path}» is not a safe relative POSIX path`)
  }
}

function memoryFileHandle(
  name: string,
  path: string,
  files: ReadonlyMap<string, Uint8Array>,
): WebFileHandleLike {
  return {
    kind: 'file',
    name,
    async getFile() {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error(`embedded file disappeared: ${path}`)
      return {
        name,
        size: bytes.byteLength,
        lastModified: 0,
        slice(start: number, end: number) {
          const part = bytes.slice(start, end)
          return {
            async arrayBuffer() {
              const buffer = new ArrayBuffer(part.byteLength)
              new Uint8Array(buffer).set(part)
              return buffer
            },
          }
        },
      }
    },
  }
}

function memoryDirectoryHandle(
  name: string,
  files: ReadonlyMap<string, Uint8Array>,
  prefix = '',
): WebExtensionDirectoryHandle {
  const scope = prefix === '' ? '' : `${prefix}/`
  const base: WebDirectoryHandleLike = {
    kind: 'directory',
    name,
    entries: async function* () {
      const children = new Map<string, 'directory' | 'file'>()
      for (const path of files.keys()) {
        if (!path.startsWith(scope)) continue
        const rest = path.slice(scope.length)
        const slash = rest.indexOf('/')
        const childName = slash === -1 ? rest : rest.slice(0, slash)
        if (childName === '') continue
        children.set(childName, slash === -1 ? 'file' : 'directory')
      }
      const ordered = [...children].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )
      for (const [childName, kind] of ordered) {
        const childPath = `${scope}${childName}`
        yield [
          childName,
          kind === 'file'
            ? memoryFileHandle(childName, childPath, files)
            : memoryDirectoryHandle(childName, files, childPath),
        ] as const
      }
    },
  }
  return { ...base, queryPermission: async () => 'granted' }
}

function embeddedHandle(
  name: string,
  encodedFiles: Readonly<Record<string, string>>,
): WebExtensionDirectoryHandle {
  const files = new Map<string, Uint8Array>()
  const entries = Object.entries(encodedFiles).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  for (const [path, encoded] of entries) {
    validateFilePath(path)
    files.set(path, decodeBase64(encoded, path))
  }
  return memoryDirectoryHandle(name, files)
}

/** Strict package-level validation used by the common manager's ArtifactStore adapter. */
export async function inspectPortableExtensionBundle(
  bytes: Uint8Array,
  options: RepositoryArtifactDecodeOptions = {},
): Promise<readonly string[]> {
  const decoded = await decodeRepositoryArtifact(bytes, options)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  const normalized = normalizeRepositoryManifest(JSON.parse(text) as unknown)
  if (!isNormalizedRepositoryManifest(normalized)) {
    throw new Error('repository normalizer returned an unsupported document')
  }
  const roots: string[] = []
  for (const [index, entry] of normalized.extensions.entries()) {
    if (!entry.enabled) continue
    if (entry.files === undefined) {
      throw new Error(
        `repository entry ${String(index)} is path-only; browser packages require files`,
      )
    }
    if (entry.id === undefined) {
      throw new Error(`repository entry ${String(index)} has no expected extension id`)
    }
    // Constructs and validates the complete safe file tree without retaining a second copy.
    embeddedHandle(entry.id, entry.files)
    roots.push(entry.id)
  }
  if (roots.length === 0) throw new Error('portable browser package contains no enabled roots')
  if (new Set(roots).size !== roots.length) {
    throw new Error('portable browser package contains duplicate root ids')
  }
  return Object.freeze(roots)
}

/**
 * Opens every installed digest-pinned package and turns its embedded repository entries into the
 * same loaded-root contract used by user folders. Disabled packages remain inert inventory/card
 * inputs and publish their root coordinates through `disabledExtensionCoordinates`; the host gate
 * still prevents their contributions from activating. One malformed package or entry becomes a
 * diagnostic and never blocks siblings.
 */
export async function loadManagedExtensionRoots(
  storage: BrowserExtensionStorage,
  options: LoadManagedExtensionRootsOptions,
): Promise<LoadedManagedExtensionRoots> {
  const records = await storage.list()
  const requests: {
    readonly record: InstalledBrowserExtension
    readonly id: string
    readonly expectedId: string
    readonly handle: WebExtensionDirectoryHandle
  }[] = []
  const failures: UserExtensionRootFailure[] = []

  for (const record of records) {
    options.signal?.throwIfAborted()
    const response = await storage.openInstalled(record.id)
    if (response === undefined) {
      failures.push(
        failure(
          record,
          MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.unavailable,
          `installed package ${record.id}@${record.version} is absent or failed its stored digest`,
        ),
      )
      continue
    }

    let document: unknown
    try {
      const bytes = await decodeRepositoryArtifact(new Uint8Array(await response.arrayBuffer()), {
        ...(options.maxRepositoryDocumentBytes === undefined ? {} : { maxDocumentBytes: options.maxRepositoryDocumentBytes }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      document = JSON.parse(text) as unknown
    } catch (error) {
      options.signal?.throwIfAborted()
      failures.push(
        failure(
          record,
          MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.invalid,
          `package is not a UTF-8 JSON modkit.repository.json: ${messageOf(error)}`,
        ),
      )
      continue
    }

    let manifest: NormalizedRepositoryManifest
    try {
      const normalized = normalizeRepositoryManifest(document)
      if (!isNormalizedRepositoryManifest(normalized)) {
        throw new Error('repository normalizer returned an unsupported document')
      }
      manifest = normalized
    } catch (error) {
      failures.push(
        failure(
          record,
          MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.invalid,
          `invalid modkit.repository.json: ${messageOf(error)}`,
        ),
      )
      continue
    }

    for (const [index, entry] of manifest.extensions.entries()) {
      options.signal?.throwIfAborted()
      if (!entry.enabled) continue
      const suffix = `#${String(index)}`
      if (entry.files === undefined) {
        failures.push(
          failure(
            record,
            MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.pathOnly,
            `repository entry ${String(index)} declares only path «${entry.path ?? ''}»; a browser package must embed extensions[].files as base64`,
            suffix,
          ),
        )
        continue
      }
      if (entry.id === undefined) {
        failures.push(
          failure(
            record,
            MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.identityMissing,
            `repository entry ${String(index)} has no id; downloaded browser roots require expectedId`,
            suffix,
          ),
        )
        continue
      }
      try {
        requests.push({
          record,
          id: `${record.id}@${record.digest}#${String(index)}`,
          expectedId: entry.id,
          handle: embeddedHandle(`${record.id}/${entry.id}`, entry.files),
        })
      } catch (error) {
        const code = /base64/u.test(messageOf(error))
          ? MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.base64Invalid
          : MANAGED_EXTENSION_BUNDLE_FAILURE_CODES.filePathInvalid
        failures.push(failure(record, code, messageOf(error), suffix))
      }
    }
  }

  const loaded = await loadUserExtensionRoots(
    requests.map(request => ({
      id: request.id,
      expectedId: request.expectedId,
      handle: request.handle,
    })),
    {
      subtle: options.subtle,
      ...(options.claimed === undefined ? {} : { claimed: options.claimed }),
      ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
      ...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  )

  const sources = new Map(requests.map(request => [request.id, request.record]))
  const inputs = loaded.inputs.map((input, index) => {
    const rootId = loaded.rootIds[index]
    const record = rootId === undefined ? undefined : sources.get(rootId)
    return record === undefined
      ? input
      : Object.freeze({ ...input, source: `managed-package/${record.id}@${record.version}` })
  })
  const packageByCoordinate = Object.fromEntries(
    loaded.coordinates.flatMap((coordinate, index) => {
      const rootId = loaded.rootIds[index]
      const record = rootId === undefined ? undefined : sources.get(rootId)
      return record === undefined ? [] : [[coordinate, record.id] as const]
    }),
  )
  const disabledExtensionCoordinates = loaded.coordinates.filter((_, index) => {
    const rootId = loaded.rootIds[index]
    const record = rootId === undefined ? undefined : sources.get(rootId)
    return record?.enabled === false
  })
  return Object.freeze({
    inputs: Object.freeze(inputs),
    failures: Object.freeze([...failures, ...loaded.failures]),
    coordinates: loaded.coordinates,
    rootIds: loaded.rootIds,
    moduleMap: loaded.moduleMap,
    moduleMapOwners: loaded.moduleMapOwners,
    verifiedModuleRoots: loaded.verifiedModuleRoots,
    packageByCoordinate: Object.freeze(packageByCoordinate),
    disabledExtensionCoordinates: Object.freeze(disabledExtensionCoordinates),
    serve: loaded.serve,
  })
}

/**
 * One synthetic fetch and one ordered list for bundled-managed-user composition. Earlier roots
 * win coordinate conflicts in `loadUserExtensionRoots`; fetch tries the same order and falls
 * through only on a 404.
 */
export function combineLoadedExtensionRoots(
  ...roots: readonly LoadedUserExtensionRoots[]
): LoadedUserExtensionRoots {
  if (roots.length === 0) return NO_USER_EXTENSION_ROOTS
  const claims = new Map<string, Set<string>>()
  for (const root of roots) {
    for (const specifier of Object.keys(root.moduleMap)) {
      const owner = root.moduleMapOwners[specifier]
      if (owner === undefined) continue
      const owners = claims.get(specifier) ?? new Set<string>()
      owners.add(owner)
      claims.set(specifier, owners)
    }
  }
  const conflictedRoots = new Set<string>()
  const collisionFailures: UserExtensionRootFailure[] = []
  for (const [specifier, owners] of claims) {
    if (owners.size < 2) continue
    for (const owner of owners) {
      conflictedRoots.add(owner)
      collisionFailures.push({
        root: owner,
        rootId: owner,
        code: 'x3.host/extension-module-map-conflict',
        message: `bare module specifier «${specifier}» is exported by more than one extension root; every claimant is refused`,
      })
    }
  }
  const moduleMapEntries = new Map<string, string>()
  const moduleMapOwnerEntries = new Map<string, string>()
  for (const root of roots) {
    for (const [specifier, url] of Object.entries(root.moduleMap)) {
      const owner = root.moduleMapOwners[specifier]
      if (owner === undefined || conflictedRoots.has(owner)) continue
      moduleMapEntries.set(specifier, url)
      moduleMapOwnerEntries.set(specifier, owner)
    }
  }
  const kept = roots.flatMap(root =>
    root.rootIds.flatMap((rootId, index) => {
      const input = root.inputs[index]
      const coordinate = root.coordinates[index]
      return conflictedRoots.has(rootId) || input === undefined || coordinate === undefined
        ? []
        : [{ rootId, input, coordinate }]
    }),
  )
  return Object.freeze({
    inputs: Object.freeze(kept.map(({ input }) => input)),
    failures: Object.freeze([...roots.flatMap(root => root.failures), ...collisionFailures]),
    coordinates: Object.freeze(kept.map(({ coordinate }) => coordinate)),
    rootIds: Object.freeze(kept.map(({ rootId }) => rootId)),
    moduleMap: Object.freeze(Object.fromEntries(moduleMapEntries)),
    moduleMapOwners: Object.freeze(Object.fromEntries(moduleMapOwnerEntries)),
    verifiedModuleRoots: Object.freeze(
      roots
        .flatMap(root => root.verifiedModuleRoots)
        .filter(root => !conflictedRoots.has(root.rootId)),
    ),
    serve: (async (url, init) => {
      let last
      for (const root of roots) {
        const response = await root.serve(url, init)
        if (response.ok || response.status !== 404) return response
        last = response
      }
      return (
        last ?? {
          ok: false,
          status: 404,
          arrayBuffer: () => Promise.reject(new Error(`404 ${url}`)),
        }
      )
    }) satisfies BrowserFetchLike,
  })
}
