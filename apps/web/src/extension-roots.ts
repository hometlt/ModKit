/**
 * A user's own extension folders, in the browser (the twin of
 * `packages/host/src/node/extension-roots.ts`).
 *
 * Electron already does this: the user grants directories, the host loads each one independently,
 * and a broken one becomes a record instead of an exception. The page had no equivalent — it could
 * only compose the build-time attested catalog — so the settings surface honestly refused to add
 * anything. This module removes the reason for that refusal.
 *
 * ---------------------------------------------------------------------------------------------
 * The trust model, stated once so the rest of the file can be read against it
 *
 *  1. **No signature is required, and none is checked.** There is no publisher PKI in this lab.
 *     A folder is trusted because the user picked it in a picker dialog, and for nothing else.
 *
 *  2. **The page computes the digests itself**, with WebCrypto, over the bytes it just read
 *     through the granted handle. Be exact about what that buys and what it does not:
 *       - it does NOT attest provenance. Nobody vouches for these bytes; the digest is a
 *         measurement the page took of a folder the user pointed at, not a claim about origin,
 *         authorship or review;
 *       - it DOES pin the bytes between the moment they were read and the moment they are
 *         evaluated. The recorded per-file digests travel into the inventory, and the verified
 *         loader re-reads each file, re-hashes it and refuses on any difference before minting
 *         the immutable module URL it evaluates (verify-then-snapshot). A file edited underneath
 *         a running page therefore cannot become the thing that runs — it becomes a refusal.
 *     A bundled catalog digest is a build-time claim by a third party. A user-folder digest is
 *     not a claim about origin at all. The UI must never present the two as the same fact.
 *
 *  3. **User extensions are worker-only, always.** `execution` is fixed to
 *     `{ origin: 'installed', allowTrustedInProcess: false }`; the origin is not a parameter and
 *     `allowTrustedInProcess` exists in the options solely so that a caller which sets it is
 *     refused loudly (`x3.host/extension-trust-misdeclared`) instead of quietly getting the
 *     worker-only load it did not ask for. The Node loader refuses the same combination; a
 *     browser host additionally has no in-page execution backend at all.
 *
 *  4. **Bare-specifier imports stay confined to the host module map.** A user extension that
 *     imports something the map does not carry is refused by the verified loader with the
 *     specifier named. That refusal is correct and is surfaced, not swallowed.
 *
 * ---------------------------------------------------------------------------------------------
 * Bytes
 *
 * The verified loader fetches artifact files by URL, and a picked folder has none. Rather than
 * teach the loader about directory handles — which would mean a second, unverified load path —
 * this module mints a synthetic artifact root under a reserved-invalid host
 * (`https://user-extension.invalid/<root-id>/`) and hands back a `fetch` that answers exactly
 * those URLs from the granted handle. The verified loader, the digests and the blob module URLs
 * are untouched. The host is deliberately unresolvable (RFC 2606 `.invalid`): if a composition
 * ever forgets to install this fetch, the request fails instead of reaching a real server.
 *
 * Every platform shape is structural (as in `./files.ts`), so all of this is unit-tested in Node
 * against fakes and runs unchanged in the page.
 */

import { ModkitError } from '@modkitx-x3/core'
import { expandContributionManifests, normalizeExtensionManifest } from '@modkitx-x3/sdk'
import type { ExtensionInput, ExtensionOrigin } from '@modkitx-x3/host'
import type {
  BrowserFetchLike,
  BrowserResponseLike,
  BrowserSubtleCryptoLike,
  VerifiedModuleRoot,
} from '@modkitx-x3/host/browser'
import {
  iterateDirectoryChildren,
  type WebDirectoryHandleLike,
  type WebFileHandleLike,
} from './files.js'

// ---------------------------------------------------------------------------------------------
// platform shapes

/** The three states `FileSystemHandle.queryPermission` answers with. */
export type WebPermissionState = 'granted' | 'denied' | 'prompt'

/**
 * The grant surface of a File System Access handle. Both methods are optional: a browser that
 * ships the pickers without them, and every structural fake, simply has no lapse to report.
 */
export interface WebGrantQueryable {
  queryPermission?(descriptor: { readonly mode: 'read' }): Promise<WebPermissionState>
  requestPermission?(descriptor: { readonly mode: 'read' }): Promise<WebPermissionState>
}

/** A directory handle the user granted, as this module uses it. */
export type WebExtensionDirectoryHandle = WebDirectoryHandleLike & WebGrantQueryable

// ---------------------------------------------------------------------------------------------
// vocabulary

/**
 * Failure codes, one family with the Node loader so a product can report both hosts the same way.
 * The first four are byte-for-byte the Node codes; the last two name conditions only a browser
 * has (a grant that lapsed between reloads, and a folder too big to read without freezing a page).
 */
export const EXTENSION_ROOT_FAILURE_CODES = Object.freeze({
  unreadable: 'x3.host/extension-root-unreadable',
  notAnExtension: 'x3.host/extension-not-an-extension',
  coordinateConflict: 'x3.host/extension-coordinate-conflict',
  identityMismatch: 'x3.host/extension-identity-mismatch',
  permissionRequired: 'x3.host/extension-root-permission-required',
  tooLarge: 'x3.host/extension-root-too-large',
  moduleMapInvalid: 'x3.host/extension-module-map-invalid',
  moduleMapConflict: 'x3.host/extension-module-map-conflict',
})

/** Origin every user-picked folder is loaded under. Not a parameter — see the header, point 3. */
export const USER_EXTENSION_ORIGIN: ExtensionOrigin = 'installed'

/** Synthetic, deliberately unresolvable artifact origin for user-picked folders. */
export const USER_EXTENSION_ARTIFACT_ORIGIN = 'https://user-extension.invalid/'

/**
 * Ceilings for reading one picked folder. A granted folder can be a whole drive, and the artifact
 * digest is taken over every file in it, so the walk has to stop somewhere and say where. These
 * bound the *read*; the module graph that is later evaluated is bounded separately by the
 * verified loader's own `maxFiles`/`maxTotalBytes`.
 */
export const DEFAULT_EXTENSION_ROOT_MAX_FILES = 2000
export const DEFAULT_EXTENSION_ROOT_MAX_TOTAL_BYTES = 32 * 1024 * 1024

/** Directory names skipped exactly as the Node loader skips them. */
const SKIPPED_EVERYWHERE = new Set(['node_modules', '.git'])
/** Skipped from the inventory file listing only; still part of the artifact digest. */
const SKIPPED_FROM_LISTING = 'dist'

// ---------------------------------------------------------------------------------------------
// requests and results

export interface UserExtensionRootRequest {
  /**
   * Stable identity this host assigned when the folder was added, reused as the path segment of
   * the synthetic artifact root. A folder has no path the page may see, so the id is what
   * persistence, the UI list and the served URLs agree on.
   */
  readonly id: string
  readonly handle: WebExtensionDirectoryHandle
  /** Coordinate recorded when the folder was added; a later mismatch is reported, not enforced. */
  readonly expectedId?: string
}

export interface UserExtensionRootFailure {
  /** Display identity of the folder — its name, which is all a page ever learns about it. */
  readonly root: string
  /** The request id, so a list can map a failure back to the stored folder and offer an action. */
  readonly rootId: string
  readonly code: string
  readonly message: string
}

export interface LoadedUserExtensionRoots {
  /** Inputs for `createWebSubjectServices`, in request order. */
  readonly inputs: readonly ExtensionInput[]
  /** One record per folder that did not load, or loaded into a conflict. */
  readonly failures: readonly UserExtensionRootFailure[]
  /** Coordinate (`publisher/id`) of every loaded folder, in the same order as `inputs`. */
  readonly coordinates: readonly string[]
  /** Request id of every loaded folder, parallel to `inputs`, so a list can offer a Remove. */
  readonly rootIds: readonly string[]
  /** Bare package exports mapped to digest-pinned synthetic artifact URLs. */
  readonly moduleMap: Readonly<Record<string, string>>
  /** Root request that owns each module-map entry, used to refuse collisions as a whole root. */
  readonly moduleMapOwners: Readonly<Record<string, string>>
  /** Digest contexts recognized by the worker loader for mapped cross-root imports. */
  readonly verifiedModuleRoots: readonly (VerifiedModuleRoot & { readonly rootId: string })[]
  /**
   * Answers the synthetic artifact URLs of the folders that loaded, and nothing else. A
   * composition installs it in front of the page's own `fetch`; see `./subjects.ts`.
   */
  readonly serve: BrowserFetchLike
}

export interface LoadUserExtensionRootsOptions {
  /** WebCrypto's `subtle`; the page computes every digest itself. */
  readonly subtle: BrowserSubtleCryptoLike
  /** Coordinates already claimed (the attested catalog loads first); duplicates are reported. */
  readonly claimed?: readonly string[]
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  /**
   * Present only to be refused. There is no in-page execution backend in a browser host and a
   * user folder would not be eligible for one anyway; a caller that sets this has a bug, and a
   * loud `x3.host/extension-trust-misdeclared` is a better answer than a silent downgrade.
   */
  readonly allowTrustedInProcess?: boolean
  readonly signal?: AbortSignal
}

// ---------------------------------------------------------------------------------------------
// small helpers

const messageOf = (error: unknown): string =>
  error instanceof ModkitError || error instanceof Error ? error.message : String(error)

const codeOf = (error: unknown): string =>
  error instanceof ModkitError ? error.code : EXTENSION_ROOT_FAILURE_CODES.unreadable

const compareNames = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

function refuse(code: string, message: string, context?: Record<string, unknown>): ModkitError {
  return new ModkitError({ code, message, ...(context === undefined ? {} : { context }) })
}

/** `publisher/id` from the authored container, exactly as the Node twin reads it. */
export function containerCoordinate(containers: ExtensionInput['containers']): string | undefined {
  const blocks = [
    (containers.packageJson as { readonly modkit?: unknown } | undefined)?.modkit,
    containers.standalone,
  ]
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const authored = block as { readonly publisher?: unknown; readonly id?: unknown }
    if (typeof authored.publisher === 'string' && typeof authored.id === 'string') {
      return `${authored.publisher}/${authored.id}`
    }
  }
  return undefined
}

/** The same, for an input that has already been read. */
export const extensionCoordinate = (input: ExtensionInput): string | undefined =>
  containerCoordinate(input.containers)

async function sha256(subtle: BrowserSubtleCryptoLike, bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes))
  let hex = ''
  for (const byte of hash) hex += byte.toString(16).padStart(2, '0')
  return `sha256:${hex}`
}

const encoder = new TextEncoder()

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** The synthetic artifact root of one folder, with a trailing slash as the loader expects. */
export function userExtensionArtifactRoot(rootId: string): string {
  return `${USER_EXTENSION_ARTIFACT_ORIGIN}${encodeURIComponent(rootId)}/`
}

// ---------------------------------------------------------------------------------------------
// the walk

interface WalkedFile {
  /** Posix path relative to the granted folder. */
  readonly path: string
  readonly handle: WebFileHandleLike
  readonly size: number
}

/**
 * Depth-first, children sorted by name — the same order `readdirSync(...).sort()` produces on
 * Node, so the artifact digest of a folder is identical on both hosts for identical bytes.
 *
 * The bounds are checked while walking rather than afterwards: the point is not to describe an
 * enormous folder accurately, it is to stop reading it. A handle graph that somehow cycles is
 * caught by the file ceiling for the same reason.
 */
async function walkGrantedFolder(
  root: WebDirectoryHandleLike,
  label: string,
  maxFiles: number,
  maxTotalBytes: number,
  signal: AbortSignal | undefined,
): Promise<readonly WalkedFile[]> {
  const walked: WalkedFile[] = []
  let totalBytes = 0

  const visit = async (directory: WebDirectoryHandleLike, prefix: string): Promise<void> => {
    signal?.throwIfAborted()
    const children: { readonly name: string; readonly handle: unknown }[] = []
    for await (const child of iterateDirectoryChildren(directory)) {
      children.push({ name: child.name, handle: child })
    }
    children.sort((left, right) => compareNames(left.name, right.name))
    for (const child of children) {
      signal?.throwIfAborted()
      if (SKIPPED_EVERYWHERE.has(child.name)) continue
      const handle = child.handle as WebDirectoryHandleLike | WebFileHandleLike
      const path = prefix === '' ? child.name : `${prefix}/${child.name}`
      if (handle.kind === 'directory') {
        await visit(handle, path)
        continue
      }
      if (walked.length >= maxFiles) {
        throw refuse(
          EXTENSION_ROOT_FAILURE_CODES.tooLarge,
          `«${label}» holds more than ${maxFiles} files; this host reads at most that many per extension folder (bound: maxFiles=${maxFiles})`,
          { bound: 'maxFiles', maxFiles },
        )
      }
      const file = await handle.getFile()
      totalBytes += file.size
      if (totalBytes > maxTotalBytes) {
        throw refuse(
          EXTENSION_ROOT_FAILURE_CODES.tooLarge,
          `«${label}» holds more than ${maxTotalBytes} bytes; this host reads at most that many per extension folder (bound: maxTotalBytes=${maxTotalBytes})`,
          { bound: 'maxTotalBytes', maxTotalBytes },
        )
      }
      walked.push({ path, handle, size: file.size })
    }
  }

  await visit(root, '')
  return walked
}

async function readAll(handle: WebFileHandleLike): Promise<Uint8Array> {
  const file = await handle.getFile()
  return new Uint8Array(await file.slice(0, file.size).arrayBuffer())
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw refuse(
      EXTENSION_ROOT_FAILURE_CODES.unreadable,
      `${path} is not valid JSON: ${messageOf(error)}`,
      { path },
    )
  }
}

interface ReadRoot {
  readonly input: ExtensionInput
  /** Path → handle for every artifact file, so the synthetic fetch can re-read the bytes. */
  readonly files: ReadonlyMap<string, WebFileHandleLike>
  readonly moduleMap: Readonly<Record<string, string>>
  readonly verifiedModuleRoot: VerifiedModuleRoot
}

const PACKAGE_NAME = /^(?:@[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+|[A-Za-z0-9._~-]+)$/u

function moduleMapFromPackage(
  packageJson: unknown,
  artifactRoot: string,
  fileDigests: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (typeof packageJson !== 'object' || packageJson === null) return Object.freeze({})
  const candidate = packageJson as { readonly name?: unknown; readonly exports?: unknown }
  if (candidate.exports === undefined) return Object.freeze({})
  if (typeof candidate.name !== 'string' || !PACKAGE_NAME.test(candidate.name)) {
    throw refuse(
      EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
      'package.json with exports must declare a bounded bare package name',
      { field: 'name' },
    )
  }

  const declared: readonly (readonly [string, unknown])[] =
    typeof candidate.exports === 'string'
      ? [['.', candidate.exports]]
      : typeof candidate.exports === 'object' && candidate.exports !== null
        ? Object.entries(candidate.exports as Readonly<Record<string, unknown>>)
        : []
  if (declared.length === 0 && candidate.exports !== undefined) {
    throw refuse(
      EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
      'package.json exports must be a relative string or a subpath-to-file object',
      { field: 'exports' },
    )
  }

  const map = new Map<string, string>()
  for (const [subpath, target] of declared) {
    if ((subpath !== '.' && !subpath.startsWith('./')) || typeof target !== 'string') {
      throw refuse(
        EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
        `package export «${subpath}» must map directly to one relative file`,
        { subpath },
      )
    }
    if (
      !target.startsWith('./') ||
      target.includes('\\') ||
      target.includes('?') ||
      target.includes('#') ||
      target
        .slice(2)
        .split('/')
        .some(part => part === '' || part === '.' || part === '..')
    ) {
      throw refuse(
        EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
        `package export «${subpath}» escapes or does not name a bounded relative file`,
        { subpath, target },
      )
    }
    const subpathStars = [...subpath.matchAll(/\*/gu)].length
    const targetStars = [...target.matchAll(/\*/gu)].length
    if (subpathStars !== targetStars || subpathStars > 1) {
      throw refuse(
        EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
        `package export «${subpath}» must use at most one matching wildcard`,
        { subpath, target },
      )
    }
    const targetRelative = target.slice(2)
    const targets: readonly (readonly [string, string])[] =
      targetStars === 0
        ? [[subpath, targetRelative]]
        : Object.keys(fileDigests)
            .map(path => {
              const [prefix = '', suffix = ''] = targetRelative.split('*')
              if (!path.startsWith(prefix) || !path.endsWith(suffix)) return undefined
              const capture = path.slice(prefix.length, path.length - suffix.length)
              if (capture === '') return undefined
              return [subpath.replace('*', capture), path] as const
            })
            .filter((entry): entry is readonly [string, string] => entry !== undefined)
    if (
      targets.length === 0 ||
      targets.some(([, relative]) => fileDigests[relative] === undefined)
    ) {
      throw refuse(
        EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
        `package export «${subpath}» targets no inventoried file`,
        { subpath, target },
      )
    }
    for (const [resolvedSubpath, relative] of targets) {
      const specifier =
        resolvedSubpath === '.' ? candidate.name : `${candidate.name}/${resolvedSubpath.slice(2)}`
      const url = new URL(relative, artifactRoot).href
      if (map.has(specifier) && map.get(specifier) !== url) {
        throw refuse(
          EXTENSION_ROOT_FAILURE_CODES.moduleMapInvalid,
          `package exports declare duplicate specifier «${specifier}»`,
          { specifier },
        )
      }
      map.set(specifier, url)
    }
  }
  return Object.freeze(Object.fromEntries(map))
}

/**
 * Read one granted folder into an inventory input.
 *
 * Mirrors `loadExtensionDirectory` field for field: the two candidate authored containers, the
 * relative listing (minus `dist`, as there), the declared contribution documents, and one walk
 * that yields both the artifact digest and the per-file digests.
 *
 * `verifyArtifactDigest` compares against the digest taken in *this* walk, on *this* page load —
 * never a value carried across a reload. It is not a provenance check and does not pretend to be
 * one; the check that matters happens later, when the verified loader re-reads each file through
 * the fetch below, re-hashes it against `fileDigests` and refuses any difference.
 */
async function readGrantedRoot(
  request: UserExtensionRootRequest,
  options: LoadUserExtensionRootsOptions,
): Promise<ReadRoot> {
  const label = request.handle.name === '' ? request.id : request.handle.name
  const walked = await walkGrantedFolder(
    request.handle,
    label,
    options.maxFiles ?? DEFAULT_EXTENSION_ROOT_MAX_FILES,
    options.maxTotalBytes ?? DEFAULT_EXTENSION_ROOT_MAX_TOTAL_BYTES,
    options.signal,
  )

  const handles = new Map<string, WebFileHandleLike>()
  const fileDigests: Record<string, string> = {}
  const bytesByPath = new Map<string, Uint8Array>()
  const artifactStream: Uint8Array[] = []
  for (const entry of walked) {
    options.signal?.throwIfAborted()
    const bytes = await readAll(entry.handle)
    handles.set(entry.path, entry.handle)
    fileDigests[entry.path] = await sha256(options.subtle, bytes)
    bytesByPath.set(entry.path, bytes)
    // The Node twin's stream, byte for byte: len(path) 0 path 0 len(content) 0 content.
    const pathBytes = encoder.encode(entry.path)
    artifactStream.push(
      encoder.encode(String(pathBytes.byteLength)),
      new Uint8Array([0]),
      pathBytes,
      new Uint8Array([0]),
      encoder.encode(String(bytes.byteLength)),
      new Uint8Array([0]),
      bytes,
    )
  }
  const artifactDigest = await sha256(options.subtle, concatenate(artifactStream))

  const packageBytes = bytesByPath.get('package.json')
  const standaloneBytes = bytesByPath.get('modkit.extension.json')
  const containers = {
    ...(packageBytes === undefined ? {} : { packageJson: parseJson(packageBytes, 'package.json') }),
    ...(standaloneBytes === undefined
      ? {}
      : { standalone: parseJson(standaloneBytes, 'modkit.extension.json') }),
  }

  const files = walked
    .map(entry => entry.path)
    .filter(path => !path.split('/').includes(SKIPPED_FROM_LISTING))

  const documents = new Map<string, unknown>()
  const documentDigests = new Map<string, string>()
  const normalized = await normalizeExtensionManifest(containers)
  if (normalized.manifest) {
    options.signal?.throwIfAborted()
    const expansion = expandContributionManifests(normalized.manifest.contributionManifests, files)
    for (const entry of expansion.entries) {
      const bytes = bytesByPath.get(entry.path)
      const digest = fileDigests[entry.path]
      if (bytes === undefined || digest === undefined) continue
      documents.set(entry.path, parseJson(bytes, entry.path))
      documentDigests.set(entry.path, digest)
    }
  }

  const artifactRoot = userExtensionArtifactRoot(request.id)
  const moduleMap = moduleMapFromPackage(containers.packageJson, artifactRoot, fileDigests)
  return {
    files: handles,
    moduleMap,
    verifiedModuleRoot: Object.freeze({ artifactRoot, fileDigests: Object.freeze(fileDigests) }),
    input: {
      source: `user-folder/${label}`,
      containers,
      files,
      documents,
      documentDigests,
      artifact: {
        inventoryRecordId: `artifact:${artifactDigest}`,
        artifactDigest,
        artifactRoot: new URL(artifactRoot),
        fileDigests: Object.freeze(fileDigests),
        verifyArtifactDigest: expected => expected === artifactDigest,
      },
      execution: { origin: USER_EXTENSION_ORIGIN, allowTrustedInProcess: false },
    },
  }
}

// ---------------------------------------------------------------------------------------------
// the synthetic byte source

/** Splits `https://user-extension.invalid/<id>/<path>` back into its two parts. */
function decodeUserExtensionUrl(url: string): { id: string; path: string } | undefined {
  if (!url.startsWith(USER_EXTENSION_ARTIFACT_ORIGIN)) return undefined
  const rest = url.slice(USER_EXTENSION_ARTIFACT_ORIGIN.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const query = rest.indexOf('?')
  const tail = query === -1 ? rest.slice(slash + 1) : rest.slice(slash + 1, query)
  try {
    return { id: decodeURIComponent(rest.slice(0, slash)), path: decodeURIComponent(tail) }
  } catch {
    return undefined
  }
}

/** True for any URL this module's `serve` owns, so a composition can route without guessing. */
export const isUserExtensionUrl = (url: string): boolean =>
  url.startsWith(USER_EXTENSION_ARTIFACT_ORIGIN)

const notFound = (url: string): BrowserResponseLike => ({
  ok: false,
  status: 404,
  arrayBuffer: () => Promise.reject(new Error(`404 ${url}`)),
})

/**
 * A `fetch` over the granted handles.
 *
 * The bytes are re-read from the handle here, at load time, rather than replayed from a buffer
 * captured during the walk. That is the whole point: the verified loader hashes exactly what this
 * returns and compares it with the digest recorded during the walk, so a file edited in between
 * is a refusal (`x3.host/artifact-digest-mismatch`) instead of an evaluated surprise. Replaying a
 * buffer would make that check tautological.
 */
function createUserExtensionFetch(
  roots: ReadonlyMap<string, ReadonlyMap<string, WebFileHandleLike>>,
): BrowserFetchLike {
  return async (url, init) => {
    init?.signal?.throwIfAborted()
    const decoded = decodeUserExtensionUrl(url)
    if (decoded === undefined) return notFound(url)
    const handle = roots.get(decoded.id)?.get(decoded.path)
    if (handle === undefined) return notFound(url)
    const file = await handle.getFile()
    const buffer = await file.slice(0, file.size).arrayBuffer()
    return { ok: true, status: 200, arrayBuffer: async () => buffer }
  }
}

// ---------------------------------------------------------------------------------------------
// grants

/**
 * What the stored grant says right now, asked without prompting.
 *
 * A handle restored from IndexedDB usually needs the user to re-affirm it, and a browser only
 * accepts that from a user gesture. Asking on load would either be ignored or would train the
 * user to dismiss dialogs, so load only *queries*, reports `-permission-required`, and leaves
 * `requestUserExtensionPermission` to a click.
 */
export async function queryUserExtensionPermission(
  handle: WebGrantQueryable,
): Promise<WebPermissionState> {
  if (handle.queryPermission === undefined) return 'granted'
  return handle.queryPermission({ mode: 'read' })
}

/** Prompts for read access. Call this from a user gesture; anywhere else a browser refuses it. */
export async function requestUserExtensionPermission(
  handle: WebGrantQueryable,
): Promise<WebPermissionState> {
  if (handle.requestPermission === undefined) return queryUserExtensionPermission(handle)
  return handle.requestPermission({ mode: 'read' })
}

// ---------------------------------------------------------------------------------------------
// the loader

/**
 * Load every requested folder, keeping what loads and reporting what does not.
 *
 * One bad folder never takes out the others: every failure mode below is a record. The order of
 * the checks is the Node twin's, and so is what each one means:
 *  - a folder with no authored container is **not an extension**. Returning an inert artifact for
 *    it would be a silent success for a user who picked the wrong folder, so it is a failure with
 *    its own code;
 *  - two folders claiming one coordinate are a conflict: the first wins, the second is reported,
 *    because loading both would make resolution order the authority;
 *  - a folder that declares a different coordinate than the one recorded when it was added is a
 *    mismatch — reported, never silently accepted, because the folder was swapped underneath.
 */
export async function loadUserExtensionRoots(
  requests: readonly UserExtensionRootRequest[],
  options: LoadUserExtensionRootsOptions,
): Promise<LoadedUserExtensionRoots> {
  if (options.allowTrustedInProcess === true) {
    throw refuse(
      'x3.host/extension-trust-misdeclared',
      `only bundled roots may be admitted in-process; «${USER_EXTENSION_ORIGIN}» roots may not, and a browser host has no in-page boundary to admit them to`,
      { origin: USER_EXTENSION_ORIGIN },
    )
  }
  const inputs: ExtensionInput[] = []
  const failures: UserExtensionRootFailure[] = []
  const coordinates: string[] = []
  const rootIds: string[] = []
  const served = new Map<string, ReadonlyMap<string, WebFileHandleLike>>()
  const claimed = new Set(options.claimed ?? [])
  const moduleMaps = new Map<string, Readonly<Record<string, string>>>()
  const verifiedRoots = new Map<string, VerifiedModuleRoot>()
  const specifierOwner = new Map<string, string>()
  const conflictedRoots = new Set<string>()
  const reportedConflicts = new Set<string>()

  for (const request of requests) {
    options.signal?.throwIfAborted()
    const label = request.handle.name === '' ? request.id : request.handle.name
    const fail = (code: string, message: string): void => {
      failures.push({ root: label, rootId: request.id, code, message })
    }

    let permission: WebPermissionState
    try {
      permission = await queryUserExtensionPermission(request.handle)
    } catch (error) {
      fail(EXTENSION_ROOT_FAILURE_CODES.unreadable, messageOf(error))
      continue
    }
    if (permission !== 'granted') {
      fail(
        EXTENSION_ROOT_FAILURE_CODES.permissionRequired,
        `this page no longer holds read access to «${label}»; grant it again to load this extension`,
      )
      continue
    }

    let read: ReadRoot
    try {
      read = await readGrantedRoot(request, options)
    } catch (error) {
      fail(codeOf(error), messageOf(error))
      continue
    }

    const coordinate = extensionCoordinate(read.input)
    if (coordinate === undefined) {
      fail(
        EXTENSION_ROOT_FAILURE_CODES.notAnExtension,
        'no authored container: the folder has neither package.json#modkit nor modkit.extension.json',
      )
      continue
    }
    if (claimed.has(coordinate)) {
      fail(
        EXTENSION_ROOT_FAILURE_CODES.coordinateConflict,
        `«${coordinate}» is already loaded from another root; this one is ignored`,
      )
      continue
    }
    if (request.expectedId !== undefined && request.expectedId !== coordinate) {
      fail(
        EXTENSION_ROOT_FAILURE_CODES.identityMismatch,
        `recorded as «${request.expectedId}» but the folder declares «${coordinate}»`,
      )
      continue
    }
    claimed.add(coordinate)
    coordinates.push(coordinate)
    rootIds.push(request.id)
    inputs.push(read.input)
    served.set(request.id, read.files)
    moduleMaps.set(request.id, read.moduleMap)
    verifiedRoots.set(request.id, read.verifiedModuleRoot)
    for (const specifier of Object.keys(read.moduleMap)) {
      const existing = specifierOwner.get(specifier)
      if (existing === undefined) {
        specifierOwner.set(specifier, request.id)
        continue
      }
      conflictedRoots.add(existing)
      conflictedRoots.add(request.id)
      for (const owner of [existing, request.id]) {
        const key = `${owner}\0${specifier}`
        if (reportedConflicts.has(key)) continue
        reportedConflicts.add(key)
        failures.push({
          root: owner,
          rootId: owner,
          code: EXTENSION_ROOT_FAILURE_CODES.moduleMapConflict,
          message: `bare module specifier «${specifier}» is exported by more than one extension root; every claimant is refused`,
        })
      }
    }
  }

  const kept = rootIds
    .map((rootId, index) => ({ rootId, index }))
    .filter(({ rootId }) => !conflictedRoots.has(rootId))
  const moduleMapEntries = new Map<string, string>()
  const moduleMapOwnerEntries = new Map<string, string>()
  const keptVerifiedRoots: (VerifiedModuleRoot & { readonly rootId: string })[] = []
  for (const { rootId } of kept) {
    for (const [specifier, url] of Object.entries(moduleMaps.get(rootId) ?? {})) {
      moduleMapEntries.set(specifier, url)
      moduleMapOwnerEntries.set(specifier, rootId)
    }
    const verified = verifiedRoots.get(rootId)
    if (verified !== undefined) keptVerifiedRoots.push(Object.freeze({ ...verified, rootId }))
  }

  return Object.freeze({
    inputs: Object.freeze(kept.map(({ index }) => inputs[index] as ExtensionInput)),
    failures: Object.freeze(failures),
    coordinates: Object.freeze(kept.map(({ index }) => coordinates[index] as string)),
    rootIds: Object.freeze(kept.map(({ rootId }) => rootId)),
    moduleMap: Object.freeze(Object.fromEntries(moduleMapEntries)),
    moduleMapOwners: Object.freeze(Object.fromEntries(moduleMapOwnerEntries)),
    verifiedModuleRoots: Object.freeze(keptVerifiedRoots),
    serve: createUserExtensionFetch(served),
  })
}

/** An empty result, so a composition without user extensions needs no special case. */
export const NO_USER_EXTENSION_ROOTS: LoadedUserExtensionRoots = Object.freeze({
  inputs: Object.freeze([]),
  failures: Object.freeze([]),
  coordinates: Object.freeze([]),
  rootIds: Object.freeze([]),
  moduleMap: Object.freeze({}),
  moduleMapOwners: Object.freeze({}),
  verifiedModuleRoots: Object.freeze([]),
  serve: async (url: string) => notFound(url),
})
