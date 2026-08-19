/**
 * Editing backend over File System Access handles (S13) — the browser's answer to the Node file
 * backend, so a subject opened in the PWA can be saved through the same 13D coordinator.
 *
 * What the browser gives and what it does not:
 *  - a `FileSystemFileHandle` yields a snapshot (`size`, `lastModified`) — enough for the revision
 *    the PWA already pins its sources with (`provider-token:<size>-<lastModified>`), so a
 *    conditional write is a real check, not a formality;
 *  - `createWritable()` writes through a swap file that replaces the target on `close()`: atomic
 *    for one file, which is what this backend claims and no more;
 *  - there is no rename or delete on a *file* handle (they need the parent directory handle and a
 *    permission the user granted for it), so this backend refuses `create`, `delete` and `rename`
 *    honestly instead of half-implementing them;
 *  - `lastModified` has millisecond resolution: two writes inside the same millisecond produce the
 *    same revision. The backend therefore verifies its own write and reports a revision it read
 *    back, rather than predicting one.
 *
 * Structural types only — no `lib.dom` — so the host still compiles for Node, and tests drive it
 * with fakes exactly as the browser worker backend is tested.
 */

import { canonicalJsonStringify, throwIfAborted } from '@modkitx-x3/core'
import {
  revisionId,
  type AssetRevision,
  type AssetSourceRef,
  type BackendCapability,
  type RevisionId,
  type SubjectEditTarget,
} from '@modkitx-x3/sdk'
import type { EditingBackend, EditingBackendApplyResult } from '../editing.js'
import { editingError, replacedBytes, type ReplaceEdit } from '../editing-splice.js'
import type { BrowserFileSnapshot } from './sources.js'

/** The writable stream `FileSystemFileHandle.createWritable()` returns. */
export interface BrowserWritableFile {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort?(reason?: string): Promise<void>
}

/** A file handle the user granted write permission for. */
export interface BrowserWritableFileHandle {
  readonly name?: string
  getFile(): Promise<BrowserFileSnapshot & { readonly lastModified?: number }>
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<BrowserWritableFile>
}

export interface BrowserEditingBackendOptions {
  /** The handle a subject's source id refers to; `undefined` means "not writable in this host". */
  handleFor(sourceId: string): BrowserWritableFileHandle | undefined
  readonly backendId?: string
  /** Ceiling on a single staged payload this backend will materialize (default 64 MiB). */
  readonly maxPayloadBytes?: number
  /**
   * How a file snapshot becomes a revision. The default matches what the PWA pins its sources
   * with; a host that pins differently must pass the same function it opened with, or every write
   * would be refused as a lost conditional write.
   */
  readonly revisionOf?: (snapshot: {
    readonly size: number
    readonly lastModified?: number
  }) => string
}

export interface BrowserEditingBackend extends EditingBackend {
  /** Drop the pre-images kept for rollback; after this, past transactions cannot be rolled back. */
  dispose(): Promise<void>
}

export const BROWSER_EDITING_BACKEND_CAPABILITY: BackendCapability = Object.freeze({
  backendId: 'browser-file-system-access',
  guarantees: Object.freeze(['atomic', 'recoverable', 'best-effort']) as readonly (
    'atomic' | 'recoverable' | 'best-effort'
  )[],
  supportsPrepare: true,
  supportsRollback: true,
  supportsJournal: false,
  // a file handle cannot rename or delete itself; those need the parent directory handle
  supportsRename: false,
})

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024

const defaultRevisionOf = (snapshot: {
  readonly size: number
  readonly lastModified?: number
}): string => `provider-token:${snapshot.size}-${snapshot.lastModified ?? 0}`

function bindingIdOf(expected: AssetRevision): string {
  const ids = Object.keys(expected.bindings)
  if (ids.length !== 1 || ids[0] === undefined) {
    throw editingError(
      'x3.host/edit-topology-unsupported',
      `the browser backend edits single-binding subjects; expected revision names ${ids.length} bindings`,
    )
  }
  return ids[0]
}

function revisionFor(
  bindingId: string,
  source: AssetSourceRef,
  token: string,
  namespaceRevision?: RevisionId,
): AssetRevision {
  const revision = revisionId(token)
  return Object.freeze({
    bindings: Object.freeze({ [bindingId]: revision }),
    ...(namespaceRevision === undefined ? {} : { namespaceRevision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId,
      source: { id: source.id, uri: source.uri },
      revision,
    }),
  })
}

async function readAll(snapshot: BrowserFileSnapshot): Promise<Uint8Array> {
  return new Uint8Array(await snapshot.slice(0, snapshot.size).arrayBuffer())
}

export function createBrowserEditingBackend(
  options: BrowserEditingBackendOptions,
): BrowserEditingBackend {
  const backendId = options.backendId ?? BROWSER_EDITING_BACKEND_CAPABILITY.backendId
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  const revisionOf = options.revisionOf ?? defaultRevisionOf
  /** transactionId → pre-image bytes per source, oldest first (the first one restores the file). */
  const preImages = new Map<string, Map<string, Uint8Array>>()

  const handle = (source: AssetSourceRef): BrowserWritableFileHandle => {
    const found = options.handleFor(source.id)
    if (found === undefined) {
      throw editingError(
        'x3.host/edit-source-not-writable',
        `«${source.uri}» has no writable handle in this host`,
        { sourceId: source.id },
      )
    }
    return found
  }

  const liveRevision = async (
    file: BrowserWritableFileHandle,
    bindingId: string,
    source: AssetSourceRef,
    namespaceRevision?: RevisionId,
  ): Promise<AssetRevision> => {
    const snapshot = await file.getFile()
    return revisionFor(bindingId, source, revisionOf(snapshot), namespaceRevision)
  }

  const backend: BrowserEditingBackend = {
    profile: Object.freeze({ ...BROWSER_EDITING_BACKEND_CAPABILITY, backendId }),
    writable: true,

    async currentRevision(target: SubjectEditTarget, signal?: AbortSignal): Promise<AssetRevision> {
      throwIfAborted(signal)
      return liveRevision(
        handle(target.ownerSource),
        bindingIdOf(target.expectedRevision),
        target.ownerSource,
        target.expectedRevision.namespaceRevision,
      )
    },

    async apply(edit, applyOptions): Promise<EditingBackendApplyResult> {
      const { signal } = applyOptions
      throwIfAborted(signal)
      if (edit.operation !== 'replace') {
        throw editingError(
          'x3.host/edit-operation-unsupported',
          `the browser backend replaces file contents; «${edit.operation}» needs a directory handle`,
          { operation: edit.operation },
        )
      }
      const file = handle(edit.source)
      const bindingId = bindingIdOf(applyOptions.expectedRevision)
      const live = await liveRevision(
        file,
        bindingId,
        edit.source,
        applyOptions.expectedRevision.namespaceRevision,
      )
      if (canonicalJsonStringify(live) !== canonicalJsonStringify(applyOptions.expectedRevision)) {
        throw editingError(
          'x3.host/edit-conditional-write-lost',
          `«${edit.source.uri}» is not at the revision the plan expects`,
          { expected: applyOptions.expectedRevision, actual: live },
        )
      }
      const original = await readAll(await file.getFile())
      const next = await replacedBytes(
        edit as ReplaceEdit,
        original,
        applyOptions.payloads,
        maxPayloadBytes,
        signal,
      )
      const images = preImages.get(applyOptions.transactionId) ?? new Map<string, Uint8Array>()
      preImages.set(applyOptions.transactionId, images)
      if (!images.has(edit.source.id)) images.set(edit.source.id, original)

      const writable = await file.createWritable({ keepExistingData: false })
      try {
        await writable.write(next)
        await writable.close()
      } catch (error) {
        // a failed write must not leave the swap file behind holding the target
        await writable.abort?.(String(error)).catch(() => undefined)
        throw error
      }
      // the revision is read back, never predicted: `lastModified` is millisecond-resolution and
      // a same-millisecond write would otherwise be reported as a change that did not happen
      return {
        after: await liveRevision(
          file,
          bindingId,
          edit.source,
          applyOptions.expectedRevision.namespaceRevision,
        ),
      }
    },

    async applyBatch(requests, batchOptions) {
      const results = []
      for (const request of requests) {
        const result = await backend.apply(request.edit, {
          ...batchOptions,
          expectedRevision: request.expectedRevision,
        })
        results.push({ targetId: request.edit.targetId, ...result })
      }
      return results
    },

    async rollback(transactionId, edit, before, signal) {
      throwIfAborted(signal)
      const images = preImages.get(transactionId)
      const original = images?.get(edit.source.id)
      const file = handle(edit.source)
      const bindingId = bindingIdOf(before)
      if (original === undefined) {
        // nothing was written for this source in this transaction: report what is live
        return liveRevision(file, bindingId, edit.source, before.namespaceRevision)
      }
      const writable = await file.createWritable({ keepExistingData: false })
      try {
        await writable.write(original)
        await writable.close()
      } catch (error) {
        await writable.abort?.(String(error)).catch(() => undefined)
        throw error
      }
      images?.delete(edit.source.id)
      return liveRevision(file, bindingId, edit.source, before.namespaceRevision)
    },

    async dispose() {
      preImages.clear()
    },
  }
  return Object.freeze(backend)
}
