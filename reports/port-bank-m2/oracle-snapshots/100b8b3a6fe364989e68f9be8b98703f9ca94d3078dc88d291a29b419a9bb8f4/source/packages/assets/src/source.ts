/**
 * `AssetSource`: the entry point of the whole detection pipeline.
 *
 * "Every file, directory, archive entry, mounted artifact, or installation is first an
 * `AssetSource`. It becomes a UI only after resolution produces the normative
 * `AssetDescriptor`" (canonical architecture, section 5). Section 5.2 additionally requires the
 * source contract to cover files, directories, archive entries, mounted VFS roots, and
 * installation roots, because `SC2Data`, a dependency chain, and an installation are not
 * single byte files.
 *
 * Two things are deliberately separated:
 *
 * - {@link AssetSource} is the *runtime handle*: it has methods, may hold a session, and is
 *   never embedded in a descriptor;
 * - {@link AssetSourceDescriptor} is its *serializable projection*: it identifies and restores
 *   the same source after a reload and is what `AssetDescriptor.source` carries.
 */

import { CancellationError, type CancellationToken } from './cancellation.js'
import type { AssetRequest } from './companions.js'
import { normalizeFormatExtension } from './format-registry.js'

/**
 * Structural shape of a source. This is the axis codecs declare in `sourceKinds`; it answers
 * "what am I opening", not "where did the bytes come from" (see {@link AssetSourceOrigin}).
 */
export const ASSET_SOURCE_KINDS = [
  /** One addressable byte payload: a loose file, an in-memory buffer, or a remote object. */
  'file',
  /** A directory treated as one artifact (an SC2Mod/SC2Map folder, an asset bundle folder). */
  'directory',
  /** An entry inside an opened container session (MPQ/CASC/ZIP/BIG, possibly nested). */
  'archive-entry',
  /** A mounted virtual filesystem root composed from providers, archives, and overlays. */
  'vfs-root',
  /** A detected game installation root, before any mount ordering is applied. */
  'installation-root',
] as const

export type AssetSourceKind = (typeof ASSET_SOURCE_KINDS)[number]

export function isKnownAssetSourceKind(value: string): value is AssetSourceKind {
  return (ASSET_SOURCE_KINDS as readonly string[]).includes(value)
}

/**
 * How the bytes are actually acquired. Orthogonal to {@link AssetSourceKind}: an in-memory
 * buffer and a file on disk are both `kind: 'file'`, and both a ZIP entry and a CASC entry are
 * `kind: 'archive-entry'`. Origin drives capability/permission questions (network access,
 * random access, in-place write), never codec routing.
 */
export const ASSET_SOURCE_ORIGINS = [
  'memory',
  'local-file',
  'browser-handle',
  'http-range',
  'git-blob',
  'archive-session',
  'vfs',
  'unknown',
] as const

export type AssetSourceOrigin = (typeof ASSET_SOURCE_ORIGINS)[number]

/**
 * A byte range. Offsets are plain numbers (safe to `2^53 - 1`, i.e. ~9 PB) so ranges stay
 * JSON-serializable inside descriptors and detection results; the paged random-access hex
 * engine keeps its own bigint cursor over `RandomAccessSource` in the VFS layer.
 */
export interface SourceRange {
  readonly offset: number
  readonly length: number
}

/**
 * Declared context collected before detection: the parent artifact, game, and role that make
 * `Catalog` XML inside an SC2Mod different from an arbitrary `.xml` on disk. Detection may use
 * it as evidence; it is never sufficient on its own (pipeline rule 1).
 */
export interface AssetSourceContext {
  /** Stable game codec ID, e.g. `starcraft-2`. Never a display name. */
  readonly gameId?: string
  /** Game build/version string when the host knows it. */
  readonly build?: string
  /** Stable codec IDs of enclosing semantic artifacts, outermost first, e.g. `['sc2-mod']`. */
  readonly parentArtifactIds?: readonly string[]
  /** Requester-declared role, matching {@link AssetRequest.role}. */
  readonly role?: string
  /** Locale of a localized mount, e.g. `enUS`. */
  readonly locale?: string
}

/**
 * Serializable identity of a source. Descriptor-backed roots restore archive-sourced tabs
 * after a reload, so this value must be enough to reopen the source from scratch.
 */
export interface AssetSourceDescriptor {
  readonly schemaVersion: 1
  /**
   * Stable, restorable identity. URI-shaped by convention (`modkit-vfs://mount/path`,
   * `file:///c:/games/x.m3`); compared by value for session reuse, together with
   * {@link versionToken}.
   */
  readonly id: string
  readonly kind: AssetSourceKind
  readonly origin: AssetSourceOrigin
  /** Logical path within the owning root, forward-slashed. */
  readonly path: string
  /** Final path segment. */
  readonly name: string
  /** Normalized lowercase extension including the dot, or `''`. Candidate selection only. */
  readonly extension: string
  /** Byte size when cheaply known. */
  readonly size?: number
  /** Media type when the host or provider supplied one; never guessed from the extension. */
  readonly mediaType?: string
  /** Last-modified time, epoch milliseconds. */
  readonly modifiedAt?: number
  /**
   * Freshness token (etag, mtime+size hash, archive build key). Session reuse is keyed by
   * `id` *plus* this token, so a changed file cannot be served from a stale session.
   */
  readonly versionToken?: string
  /** Container/mount chain: the archive an entry lives in, recursively for nested archives. */
  readonly parent?: AssetSourceDescriptor
  /** ID of the source provider that can reopen this source. */
  readonly providerId?: string
  readonly readOnly: boolean
  readonly randomAccess: boolean
  readonly seekable: boolean
  readonly context?: AssetSourceContext
}

export interface AssetReadOptions {
  readonly cancellation?: CancellationToken
  /** Hard cap for this read. Producers must reject rather than silently truncate beyond it. */
  readonly maxBytes?: number
}

export interface AssetChildListOptions {
  /** Sub-path within the source; omit for the root. */
  readonly path?: string
  readonly recursive?: boolean
  /** Normalized lowercase extensions (`['.m3']`) used as a cheap listing prefilter. */
  readonly extensions?: readonly string[]
  readonly includeDirectories?: boolean
  readonly cancellation?: CancellationToken
}

/** One streamed child of a directory, archive, VFS root, or installation source. */
export interface AssetChild {
  readonly name: string
  /** Path relative to the listed source root, forward-slashed. */
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly source: AssetSourceDescriptor
  readonly size?: number
  /** `false` proves a directory is empty; `undefined` means "unknown, expand to find out". */
  readonly hasChildren?: boolean
  /** {@link import('./content.js').ContentMount.id} the child was resolved from. */
  readonly mountId?: string
}

/**
 * Runtime source handle. Implementations live in VFS/providers and archive sessions, never in
 * this package; `@modkitx/assets` owns only the contract plus the in-memory reference
 * implementation used by tests and fixtures.
 */
export interface AssetSource {
  readonly descriptor: AssetSourceDescriptor
  /** Byte size, or `undefined` when the origin cannot report it without a full read. */
  size(options?: AssetReadOptions): Promise<number | undefined>
  /** Whole payload. Honours `maxBytes` and rejects when the source is larger. */
  read(options?: AssetReadOptions): Promise<Uint8Array>
  /** Bounded range read. Clamped at end-of-source; a range fully past the end yields empty. */
  readRange(range: SourceRange, options?: AssetReadOptions): Promise<Uint8Array>
  /** Present for `directory`, `archive-entry` containers, `vfs-root`, `installation-root`. */
  children?(options?: AssetChildListOptions): AsyncIterable<AssetChild>
  /** Resolves a declared companion relative to this source. Never a global filesystem scan. */
  resolve?(request: AssetRequest, options?: AssetReadOptions): Promise<AssetSource | undefined>
  /** Releases sessions, handles, and caches. Idempotent. */
  dispose?(): void | Promise<void>
}

/** Fields a caller supplies to {@link createAssetSourceDescriptor}. */
export interface AssetSourceDescriptorInit extends Partial<
  Omit<AssetSourceDescriptor, 'schemaVersion' | 'kind' | 'id'>
> {
  readonly id?: string
  readonly kind?: AssetSourceKind
  readonly path: string
}

/**
 * Normalizes a source descriptor: forward-slashed path, derived `name`/`extension`, and
 * conservative defaults (`readOnly: true`, no random access) so a provider must opt in to
 * every capability it actually has.
 */
export function createAssetSourceDescriptor(
  init: AssetSourceDescriptorInit,
): AssetSourceDescriptor {
  const path = init.path.replace(/\\/g, '/')
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    schemaVersion: 1,
    id: init.id ?? path,
    kind: init.kind ?? 'file',
    origin: init.origin ?? 'unknown',
    path,
    name: init.name ?? name,
    extension: init.extension ?? normalizeFormatExtension(name),
    readOnly: init.readOnly ?? true,
    randomAccess: init.randomAccess ?? false,
    seekable: init.seekable ?? false,
    ...(init.size === undefined ? {} : { size: init.size }),
    ...(init.mediaType === undefined ? {} : { mediaType: init.mediaType }),
    ...(init.modifiedAt === undefined ? {} : { modifiedAt: init.modifiedAt }),
    ...(init.versionToken === undefined ? {} : { versionToken: init.versionToken }),
    ...(init.parent === undefined ? {} : { parent: init.parent }),
    ...(init.providerId === undefined ? {} : { providerId: init.providerId }),
    ...(init.context === undefined ? {} : { context: init.context }),
  }
}

/**
 * Human-readable location including the container chain, outermost first, e.g.
 * `Base.SC2Assets!/Assets/Units/Marine.m3`. Display only — never parse it back.
 */
export function formatSourceLocation(descriptor: AssetSourceDescriptor): string {
  const segments: string[] = []
  let current: AssetSourceDescriptor | undefined = descriptor
  while (current) {
    segments.unshift(current.path)
    current = current.parent
  }
  return segments.join('!/')
}

/**
 * Session-reuse identity: two sources may share a session only when both the restorable ID and
 * the freshness token match (VFS runbook, slice V3, rule 4).
 */
export function sourceIdentityKey(descriptor: AssetSourceDescriptor): string {
  return `${descriptor.id}@${descriptor.versionToken ?? ''}`
}

/** Container depth: `0` for a loose source, `1` for an entry inside one archive, and so on. */
export function sourceNestingDepth(descriptor: AssetSourceDescriptor): number {
  let depth = 0
  let current = descriptor.parent
  while (current) {
    depth += 1
    current = current.parent
  }
  return depth
}

/**
 * In-memory {@link AssetSource} over a byte buffer. This is the reference implementation used
 * by detection tests and fixtures; real sources come from VFS providers and archive sessions.
 */
export function createMemoryAssetSource(
  bytes: Uint8Array,
  init: Omit<AssetSourceDescriptorInit, 'origin' | 'size'> = { path: 'memory' },
): AssetSource {
  const descriptor = createAssetSourceDescriptor({
    ...init,
    origin: 'memory',
    size: bytes.byteLength,
    randomAccess: init.randomAccess ?? true,
    seekable: init.seekable ?? true,
  })
  const guard = (options: AssetReadOptions | undefined, length: number): void => {
    if (options?.cancellation?.isCancellationRequested) {
      throw new CancellationError('Read cancelled')
    }
    if (options?.maxBytes !== undefined && length > options.maxBytes) {
      throw new RangeError(`Read of ${length} bytes exceeds maxBytes ${options.maxBytes}`)
    }
  }
  return {
    descriptor,
    size: async () => bytes.byteLength,
    read: async options => {
      guard(options, bytes.byteLength)
      return bytes.slice()
    },
    readRange: async (range, options) => {
      const offset = Math.max(0, Math.min(range.offset, bytes.byteLength))
      const end = Math.max(offset, Math.min(offset + Math.max(0, range.length), bytes.byteLength))
      guard(options, end - offset)
      return bytes.slice(offset, end)
    },
  }
}

/**
 * Bounded header read for detection. Detectors declare a maximum sniff size and must never
 * decode the whole asset (pipeline rule 2).
 */
export async function readSourceHeader(
  source: AssetSource,
  byteCount: number,
  cancellation?: CancellationToken,
): Promise<Uint8Array> {
  return source.readRange(
    { offset: 0, length: byteCount },
    cancellation ? { cancellation } : undefined,
  )
}

/** Bounded tail read for formats whose directory/footer lives at the end (ZIP, MPQ variants). */
export async function readSourceTail(
  source: AssetSource,
  byteCount: number,
  cancellation?: CancellationToken,
): Promise<Uint8Array> {
  const size = (await source.size()) ?? 0
  const offset = Math.max(0, size - byteCount)
  return source.readRange(
    { offset, length: Math.min(byteCount, size) },
    cancellation ? { cancellation } : undefined,
  )
}
