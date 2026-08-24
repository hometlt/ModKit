/**
 * The archive-namespace origin backend for host-owned companion resolution (block 9, step 1).
 *
 * The second backend behind the same `CompanionOrigin` interface the filesystem one implements —
 * and the point of the exercise. If the resolver had needed one branch for a directory and another
 * for a container, the abstraction would have been wrong, and block 9 says so explicitly: the
 * algorithm sees requirements, scopes, patterns and cardinality, never a format and never a medium.
 *
 * Everything here goes through the parent container's own published surfaces — the entry listing
 * it offers as `common.view/namespace-entry-source`, and its own bounded `container.extract`
 * operation for bytes. There is no filesystem access on this path at all, by construction rather
 * than by promise: this module imports nothing from `node:*`, and the companion bytes never touch
 * a disk, which is what makes "temporary extraction to a temp file" not merely discouraged but
 * unrepresentable here.
 */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import {
  revisionIdFromRef,
  type ArtifactByteSource,
  type ArtifactSource,
  type AssetSourceRef,
  type InputSearchScope,
  type Lease,
  type NamespaceEntrySource,
  type RevisionId,
} from '@modkitx-x3/sdk'
import type {
  CompanionCaseSensitivity,
  CompanionEnumerationOptions,
  CompanionOrigin,
  CompanionOriginEntry,
} from './input-resolution.js'

/** An entry has no directory of its own to be a sibling of; it has the mount it came out of. */
const NAMESPACE_SCOPES: readonly InputSearchScope[] = Object.freeze([
  'current-mount',
  'enclosing-container',
])

export const NESTED_ENTRY_NOT_FOUND = 'x3.host/nested-entry-not-found'

/**
 * The snapshot of one entry inside a container snapshot.
 *
 * Derived rather than borrowed: a container hands every entry the archive's own revision, which
 * would make two different entries of one BIG indistinguishable by revision. Folding the entry id
 * and its extracted length in keeps each entry its own artifact while still naming the container
 * snapshot it was cut from — so reopening the archive changes every entry's revision, exactly as it
 * should. The nested-subject route and the companion backend both call this, so a primary entry and
 * a companion entry of the same archive are pinned the same way.
 */
export function containerEntryRevision(
  containerRevision: RevisionId,
  entryId: string,
  byteLength: number,
): RevisionId {
  // through the ref builder, not by string concatenation: a revision id is a kind-tagged token
  // whose value is percent-encoded, and the container's own revision is itself one of those
  return revisionIdFromRef({
    kind: 'provider-token',
    value: `${String(containerRevision)}!${entryId}:${byteLength}`,
  })
}

export interface NamespaceCompanionOriginOptions {
  /** The parent container's own entry listing, leased and retained by the caller. */
  readonly namespace: NamespaceEntrySource
  /** Logical id (entry path) of the entry that is being opened as the nested subject. */
  readonly primaryLogicalId: string
  /** Snapshot of the parent container; every entry revision is derived from it. */
  readonly containerRevision: RevisionId
  /** The parent's bounded extraction; the host never decompresses a container's payload itself. */
  readonly extract: (entryId: string, signal?: AbortSignal) => Promise<Uint8Array>
  /**
   * SAGE BIG paths are matched case-insensitively by the games that read them, and a container
   * index is not a filesystem — so the policy is stated here rather than inherited from whatever
   * machine the host happens to run on.
   */
  readonly caseSensitivity?: CompanionCaseSensitivity
  /** Entries per `list` page; the resolver's own entry budget still bounds the total. */
  readonly pageLimit?: number
}

interface IndexedEntry {
  readonly entryId: string
  readonly path: string
  readonly size?: bigint
  readonly revision: RevisionId
}

export function createNamespaceCompanionOrigin(
  options: NamespaceCompanionOriginOptions,
): CompanionOrigin {
  const pageLimit = options.pageLimit ?? 256
  const caseSensitivity = options.caseSensitivity ?? 'insensitive'
  const fold = (value: string): string =>
    caseSensitivity === 'insensitive' ? value.toLowerCase() : value
  /*
   * One listing per resolution, shared by `enumerate` and `open`.
   *
   * `open` needs the container's opaque entry id, and the only place that mapping exists is the
   * listing — so without this cache an open would re-page the whole archive to translate one name.
   * It is built lazily: a plan with no requirements never pages the container at all.
   */
  const index = new Map<string, Map<string, IndexedEntry>>()

  /**
   * Pages one prefix out of the container, merging the spellings a literal matcher might need.
   *
   * A container compares a listing prefix *literally*, but the hint the resolver derives comes from
   * a codec's patterns, whose casing is the author's. Folding the hint was wrong in one direction
   * (a BIG storing `art/skeletons/TANK_SKL.w3x` never matches a lower-cased prefix) and not folding
   * it was wrong in the other (a CASC index is entirely lower-case). So both spellings are asked
   * for and their results merged: two bounded listings instead of one, and no silent miss.
   *
   * The limit this leaves is worth naming: a container that stores some third casing — `ART/...` —
   * is still missed on a case-insensitive backend, and the companion reports as absent rather than
   * wrong. Covering that would mean giving up prefix narrowing altogether, which is what makes a
   * 666,588-entry namespace searchable at all.
   */
  const listing = async (
    prefix: string,
    signal?: AbortSignal,
  ): Promise<Map<string, IndexedEntry>> => {
    const cached = index.get(prefix)
    if (cached !== undefined) return cached
    const built = new Map<string, IndexedEntry>()
    const spellings = [...new Set(prefix === '' ? [''] : [prefix, fold(prefix)])]
    for (const spelling of spellings) {
      let cursor: string | undefined
      do {
        throwIfAborted(signal)
        const page = await options.namespace.list(
          spelling,
          cursor === undefined ? { limit: pageLimit } : { cursor, limit: pageLimit },
          signal,
        )
        for (const entry of page.items) {
          if (entry.kind !== 'file') continue
          const key = fold(entry.path)
          // first spelling wins, deterministically, because the resolver sorts before it selects
          if (!built.has(key)) {
            built.set(key, {
              entryId: entry.id,
              path: entry.path,
              ...(entry.size === undefined ? {} : { size: entry.size }),
              revision: entry.revision,
            })
          }
        }
        cursor = page.nextCursor
      } while (cursor !== undefined)
    }
    index.set(prefix, built)
    return built
  }

  return Object.freeze({
    primaryLogicalId: options.primaryLogicalId,
    caseSensitivity,
    scopes: NAMESPACE_SCOPES,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ): AsyncIterable<CompanionOriginEntry> {
      throwIfAborted(signal)
      /*
       * Both scopes resolve to the same place, and that is a statement, not a shortcut. A BIG is a
       * flat mount with no nesting: the mount the entry currently lives in and the container that
       * encloses it are the same namespace. A format where they differ (an archive inside an
       * archive) will need this backend to distinguish them, and the test suite pins today's
       * answer so that change is visible when it comes.
       */
      if (scope !== 'current-mount' && scope !== 'enclosing-container') return
      /*
       * The prefix goes straight to the container's own `list(prefix, …)`. This is the difference
       * between a bounded search and a scan: the installed StarCraft II CASC lists 666,588 entries,
       * and a requirement that names a directory reads a few hundred of them instead.
       */
      for (const entry of (await listing(enumeration.prefix, signal)).values()) {
        throwIfAborted(signal)
        yield Object.freeze({
          logicalId: entry.path,
          ...(entry.size === undefined ? {} : { size: entry.size }),
        })
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      /*
       * The id itself is the narrowest possible prefix, and opening asks for one exact entry — so
       * the listing behind an open is one entry, not the directory it sits in. That mattered
       * measurably: resolving a StarCraft II texture read 4,101 entries when the open re-listed its
       * folder, and 2 once it stopped.
       */
      const entry = (await listing(logicalId, signal)).get(fold(logicalId))
      if (entry === undefined) {
        throw new ModkitError({
          code: NESTED_ENTRY_NOT_FOUND,
          message: `container has no entry «${logicalId}»`,
          context: { logicalId },
        })
      }
      // the container's own reference for this entry, held for as long as the source it names
      const refLease = await options.namespace.openEntry(entry.entryId, signal)
      let bytes: Uint8Array
      try {
        bytes = await options.extract(entry.entryId, signal)
      } catch (error) {
        await refLease.release()
        throw error
      }
      const source = containerEntrySource(
        refLease.value,
        containerEntryRevision(options.containerRevision, entry.entryId, bytes.byteLength),
        bytes,
      )
      return Object.freeze({ value: source, release: () => refLease.release() })
    },
  })
}

/**
 * The extracted entry as a byte source.
 *
 * Held in memory on purpose. A companion staged to a temporary file would be a different artifact
 * at a different path with a revision of its own, and the whole requirement of the archive case is
 * that the codec reads the entry that is *in the container* — so the bytes stay where the host can
 * still say which container revision they came out of.
 */
export function containerEntrySource(
  ref: AssetSourceRef,
  revision: RevisionId,
  bytes: Uint8Array,
): ArtifactByteSource {
  return Object.freeze({
    kind: 'bytes' as const,
    ref,
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number, signal?: AbortSignal): Promise<Uint8Array> {
      throwIfAborted(signal)
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: 'x3.host/invalid-source-range',
          message: `container entry read of «${ref.uri}» must use a non-negative exact range`,
          context: { uri: ref.uri, offset: String(offset), length },
        })
      }
      if (offset > BigInt(bytes.byteLength)) {
        throw new ModkitError({
          code: 'x3.host/invalid-source-range',
          message: `container entry read of «${ref.uri}» starts beyond the entry size`,
          context: { uri: ref.uri, offset: String(offset), size: bytes.byteLength },
        })
      }
      const start = Number(offset)
      return bytes.slice(start, Math.min(bytes.byteLength, start + length))
    },
    async *stream(
      range?: { readonly offset: bigint; readonly length?: bigint },
      signal?: AbortSignal,
    ): AsyncIterable<Uint8Array> {
      throwIfAborted(signal)
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
      yield bytes.slice(start, Math.min(bytes.byteLength, end))
    },
  })
}
