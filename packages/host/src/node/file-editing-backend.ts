/**
 * File editing backend (ADR-HOST-002 §4): the 13D `EditingBackend` for `file:` sources on a Node
 * host. It is the first product backend the host transaction coordinator commits through.
 *
 * Honest guarantees, nothing more:
 *  - every write is conditional: the live file revision (S7 vocabulary
 *    `provider-token:<dev>-<ino>-<size>-<mtimeNs>`) must equal the plan's expected revision, else
 *    `x3.host/edit-conditional-write-lost` and nothing is touched;
 *  - a `replace` (byte range, UTF-16 range, or whole source) and a `create` land as a temp file in
 *    the same directory followed by `rename` — atomic for one file on one volume;
 *  - `delete` and `rename` are single filesystem operations;
 *  - the pre-image of every touched file is copied to a per-transaction staging directory first,
 *    so `rollback` restores bytes (the restored file has a *new* identity/mtime, so the returned
 *    revision is the live one, never a replay of `before`);
 *  - `applyBatch` is sequential — `atomic` is honest for a single-edit plan; multi-edit plans are
 *    `recoverable` through rollback, never promised atomic (the capability says so).
 *
 * Confinement is two-layered: the coordinator's derived write set must fit the grant's
 * `sourceIds`, and this backend refuses any path outside its configured `roots` and any
 * non-`file:` source.
 */

import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { canonicalJsonStringify, throwIfAborted } from '@modkitx-x3/core'
import { fileSystemRevisionToken } from '@modkitx-x3/vfs/providers/file'
import {
  revisionId,
  type AssetRevision,
  type AssetSourceRef,
  type BackendCapability,
  type RevisionId,
  type SourceEdit,
  type SubjectEditTarget,
} from '@modkitx-x3/sdk'
import type { EditingBackend, EditingBackendApplyResult } from '../editing.js'
import {
  applySequentialBatch,
  editingError,
  payloadBytes,
  replacedBytes,
  type ReplaceEdit,
} from '../editing-splice.js'

export interface FileEditingBackendOptions {
  /** Identifies this backend in write sets and receipts. */
  readonly backendId?: string
  /**
   * Absolute directories the backend may touch. A function is read on every write, which is what a
   * host with dynamic grants needs (the user picks another folder and it becomes writable without
   * rebuilding the backend). An empty list confines nothing on its own — pass one only when
   * another layer does the confining, and say so where you pass it.
   */
  readonly roots?: readonly string[] | (() => readonly string[])
  /** Where pre-images are staged per transaction (default: a directory under the OS temp dir). */
  readonly stagingDirectory?: string
  /** Ceiling on a single staged payload the backend will materialize (default 256 MiB). */
  readonly maxPayloadBytes?: number
}

export interface FileEditingBackend extends EditingBackend {
  /** Remove staged pre-images; after this, rollback of past transactions is impossible. */
  dispose(): Promise<void>
}

export const FILE_EDITING_BACKEND_CAPABILITY: BackendCapability = Object.freeze({
  backendId: 'node-file',
  guarantees: Object.freeze(['atomic', 'recoverable', 'best-effort']) as readonly (
    'atomic' | 'recoverable' | 'best-effort'
  )[],
  supportsPrepare: true,
  supportsRollback: true,
  supportsJournal: false,
  supportsRename: true,
})

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024

function filePathOf(source: AssetSourceRef): string {
  let url: URL
  try {
    url = new URL(source.uri)
  } catch {
    throw editingError('x3.host/edit-source-not-file', `source «${source.uri}» is not a file: URL`)
  }
  if (url.protocol !== 'file:') {
    throw editingError('x3.host/edit-source-not-file', `source «${source.uri}» is not a file: URL`)
  }
  return fileURLToPath(url)
}

function revisionTokenOf(stats: {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}): string {
  return `provider-token:${stats.dev}-${stats.ino}-${stats.size}-${stats.mtimeNs}`
}

async function liveRevisionToken(path: string): Promise<string> {
  try {
    const stats = await stat(path, { bigint: true })
    if (!stats.isFile()) return 'provider-token:not-a-file'
    return revisionTokenOf(stats)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'provider-token:absent'
    throw error
  }
}

/**
 * The live token of the *directory* an edit creates into, read rather than remembered.
 *
 * This is the half that makes a namespace target's optimistic check real. Every `namespaceRevision`
 * in this backend used to be copied through from the plan's expected revision, so comparing live
 * against expected compared a value with itself and could never disagree. A directory's own
 * `dev-ino-size-mtimeNs` does change when an entry is created or removed, so observing it here is
 * what turns "two writers race to create the same name" into a detected conflict instead of a
 * silent last-writer-wins.
 *
 * It delegates to the VFS file provider on purpose. A namespace revision is *minted* by the mount
 * the subject was opened from, so the check has to speak that mint's exact dialect; this backend's
 * own `revisionTokenOf` reads `stat` with bigints and disagreed with the provider's plain-`stat`
 * form on every Windows directory, turning each commit into a phantom conflict.
 */
async function liveNamespaceToken(path: string): Promise<string> {
  return fileSystemRevisionToken(path)
}

/** The single-binding revision vector this backend reports (subject-open's fingerprint rule). */
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

/**
 * The revision vector a *namespace* target reports, matching `subjectEditTargetsFromDescriptor`.
 *
 * The shape has to agree exactly: `sameRevision` compares whole canonical JSON, fingerprint
 * included, so a namespace target whose live vector claimed `topology: 'single'` would never match
 * the plan and every commit would look like a lost conditional write.
 */
function namespaceRevisionFor(source: AssetSourceRef, token: string): AssetRevision {
  const revision = revisionId(token)
  return Object.freeze({
    bindings: Object.freeze({ [source.id]: revision }),
    namespaceRevision: revision,
    compositionFingerprint: canonicalJsonStringify({
      topology: 'namespace',
      root: { id: source.id, uri: source.uri },
      revision,
    }),
  })
}

/** Does this path name a directory? The discriminator between a file target and a namespace one. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function bindingIdOf(expected: AssetRevision): string {
  const ids = Object.keys(expected.bindings)
  if (ids.length !== 1 || ids[0] === undefined) {
    throw editingError(
      'x3.host/edit-topology-unsupported',
      `the file backend edits single-binding subjects; expected revision names ${ids.length} bindings`,
    )
  }
  return ids[0]
}

function sameRevision(left: AssetRevision, right: AssetRevision): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right)
}

interface PreImage {
  readonly kind: 'file' | 'absent'
  readonly path: string
  readonly staged?: string
}

export function createFileEditingBackend(
  options: FileEditingBackendOptions = {},
): FileEditingBackend {
  const backendId = options.backendId ?? FILE_EDITING_BACKEND_CAPABILITY.backendId
  const rootsOf = (): readonly string[] =>
    (typeof options.roots === 'function' ? options.roots() : (options.roots ?? [])).map(item =>
      resolve(item),
    )
  const staging =
    options.stagingDirectory ?? join(tmpdir(), `x3-edit-${process.pid}-${randomUUID()}`)
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  /** transactionId → ordered pre-images (latest last) */
  const preImages = new Map<string, PreImage[]>()

  const confine = (path: string): string => {
    const absolute = resolve(path)
    const roots = rootsOf()
    if (roots.length === 0) return absolute
    const inside = roots.some(root => {
      const rel = relative(root, absolute)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
    if (!inside) {
      throw editingError(
        'x3.host/edit-path-outside-roots',
        `«${absolute}» is outside the backend roots`,
      )
    }
    return absolute
  }

  const stagePreImage = async (transactionId: string, path: string): Promise<void> => {
    const list = preImages.get(transactionId) ?? []
    preImages.set(transactionId, list)
    try {
      const stats = await stat(path)
      if (!stats.isFile())
        throw editingError('x3.host/edit-source-not-file', `«${path}» is not a file`)
      await mkdir(join(staging, transactionId), { recursive: true })
      const staged = join(staging, transactionId, `${list.length}-${basename(path)}`)
      await copyFile(path, staged)
      list.push({ kind: 'file', path, staged })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      list.push({ kind: 'absent', path })
    }
  }

  const writeAtomically = async (path: string, bytes: Uint8Array): Promise<void> => {
    const temp = join(dirname(path), `.x3-edit-${randomUUID()}.tmp`)
    const handle = await open(temp, 'wx')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  const targetOf = (edit: SourceEdit): string => confine(filePathOf(edit.source))

  const backend: FileEditingBackend = {
    profile: Object.freeze({ ...FILE_EDITING_BACKEND_CAPABILITY, backendId }),
    writable: true,

    async currentRevision(target: SubjectEditTarget, signal?: AbortSignal): Promise<AssetRevision> {
      throwIfAborted(signal)
      const path = confine(filePathOf(target.ownerSource))
      if (await isDirectory(path)) {
        return namespaceRevisionFor(target.ownerSource, await liveNamespaceToken(path))
      }
      const bindingId = bindingIdOf(target.expectedRevision)
      return revisionFor(
        bindingId,
        target.ownerSource,
        await liveRevisionToken(path),
        target.expectedRevision.namespaceRevision,
      )
    },

    async apply(edit, applyOptions): Promise<EditingBackendApplyResult> {
      const { signal } = applyOptions
      throwIfAborted(signal)
      const path = targetOf(edit)
      // a directory target is a namespace: its revision is the directory's own, read now
      const namespaceDirectory = (await isDirectory(path)) ? path : undefined
      const bindingId = bindingIdOf(applyOptions.expectedRevision)
      const live =
        namespaceDirectory === undefined
          ? revisionFor(
              bindingId,
              edit.source,
              await liveRevisionToken(path),
              applyOptions.expectedRevision.namespaceRevision,
            )
          : namespaceRevisionFor(edit.source, await liveNamespaceToken(namespaceDirectory))
      if (!sameRevision(live, applyOptions.expectedRevision)) {
        throw editingError(
          'x3.host/edit-conditional-write-lost',
          `«${edit.source.uri}» is not at the revision the plan expects`,
          { expected: applyOptions.expectedRevision, actual: live },
        )
      }
      switch (edit.operation) {
        case 'replace': {
          // a whole-source replace does not need the current bytes; a range edit does
          const original =
            edit.range === undefined ? new Uint8Array() : new Uint8Array(await readFile(path))
          const next = await replacedBytes(
            edit as ReplaceEdit,
            original,
            applyOptions.payloads,
            maxPayloadBytes,
            signal,
          )
          await stagePreImage(applyOptions.transactionId, path)
          await writeAtomically(path, next)
          break
        }
        case 'create': {
          /*
           * A create resolves against the namespace it names, and the two targets name it
           * differently: a file target means "beside me", a directory target means "inside me".
           * Using `dirname` unconditionally would put a namespace target's new entries one level
           * above the directory the plan pinned — outside the very namespace whose revision was
           * checked, which is both wrong and unguarded by the conflict check.
           */
          const created = confine(
            isAbsolute(edit.newPath)
              ? edit.newPath
              : join(namespaceDirectory ?? dirname(path), edit.newPath),
          )
          const bytes = await payloadBytes(
            edit.payload,
            applyOptions.payloads,
            maxPayloadBytes,
            signal,
          )
          const list = preImages.get(applyOptions.transactionId) ?? []
          preImages.set(applyOptions.transactionId, list)
          list.push({ kind: 'absent', path: created })
          await writeFile(created, bytes, { flag: 'wx' })
          return {
            after:
              namespaceDirectory === undefined
                ? revisionFor(
                    bindingId,
                    { id: pathToFileURL(created).href, uri: pathToFileURL(created).href },
                    await liveRevisionToken(created),
                  )
                : // the namespace moved, so the vector that follows is the namespace's new one —
                  // a second create in the same plan is checked against it, not against a stale copy
                  namespaceRevisionFor(edit.source, await liveNamespaceToken(namespaceDirectory)),
          }
        }
        case 'delete': {
          await stagePreImage(applyOptions.transactionId, path)
          await unlink(path)
          break
        }
        case 'rename': {
          const renamed = confine(
            isAbsolute(edit.newPath) ? edit.newPath : join(dirname(path), edit.newPath),
          )
          await stagePreImage(applyOptions.transactionId, path)
          const list = preImages.get(applyOptions.transactionId) ?? []
          list.push({ kind: 'absent', path: renamed })
          await rename(path, renamed)
          return {
            after: revisionFor(
              bindingId,
              { id: pathToFileURL(renamed).href, uri: pathToFileURL(renamed).href },
              await liveRevisionToken(renamed),
            ),
          }
        }
      }
      return {
        after:
          namespaceDirectory === undefined
            ? revisionFor(
                bindingId,
                edit.source,
                await liveRevisionToken(path),
                applyOptions.expectedRevision.namespaceRevision,
              )
            : namespaceRevisionFor(edit.source, await liveNamespaceToken(namespaceDirectory)),
      }
    },

    async applyBatch(requests, batchOptions) {
      return applySequentialBatch(requests, (edit, expectedRevision) =>
        backend.apply(edit, {
          ...batchOptions,
          expectedRevision,
        }),
      )
    },

    async rollback(transactionId, edit, before, signal) {
      throwIfAborted(signal)
      const list = preImages.get(transactionId) ?? []
      // restore latest first, only the pre-images this edit's source touched
      const path = targetOf(edit)
      // the same "beside me / inside me" rule as apply: rolling back a namespace create must
      // recognise the entry it actually wrote, or the created file survives the rollback
      const namespaceDirectory = (await isDirectory(path)) ? path : undefined
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const image = list[index]
        if (image === undefined) continue
        const related =
          image.path === path ||
          (edit.operation !== 'replace' &&
            edit.operation !== 'delete' &&
            resolve(image.path) ===
              confine(
                isAbsolute(edit.newPath)
                  ? edit.newPath
                  : join(namespaceDirectory ?? dirname(path), edit.newPath),
              ))
        if (!related) continue
        if (image.kind === 'file' && image.staged !== undefined) {
          await copyFile(image.staged, image.path)
        } else {
          await rm(image.path, { force: true })
        }
        list.splice(index, 1)
      }
      const bindingId = bindingIdOf(before)
      return namespaceDirectory === undefined
        ? revisionFor(
            bindingId,
            edit.source,
            await liveRevisionToken(path),
            before.namespaceRevision,
          )
        : namespaceRevisionFor(edit.source, await liveNamespaceToken(namespaceDirectory))
    },

    async dispose() {
      preImages.clear()
      await rm(staging, { recursive: true, force: true })
    },
  }
  return Object.freeze(backend)
}
