/**
 * PWA authority for the shared command protocol.
 *
 * A command request never names a browser path or a FileSystemHandle directly. The page first
 * binds an already granted root/handle pair to one opaque ref and pins the complete host open
 * request behind it. The host-owned endpoint can then run the same command protocol as Electron,
 * CLI, automation and VS Code without gaining a second way around the browser's handle model.
 */
import {
  createSubjectCommandEndpoint,
  subjectOpenSnapshot,
  type SubjectCommandEndpoint,
  type SubjectOpenRequest,
  type SubjectServices,
} from '@modkitx-x3/host'
import { revisionIdFromRef, type ArtifactByteSource } from '@modkitx-x3/sdk'
import type { ExplorerEntry } from '@modkitx-x3/ui/explorer'
import type { WebFileAccess, WebFileHandleLike, WebPermissionHandleLike } from './files.js'

export const DEFAULT_WEB_COMMAND_MAX_AUTHORIZATIONS = 64
export const DEFAULT_WEB_COMMAND_MAX_CONCURRENT_RUNS = 8

export interface WebCommandSubjectAuthorization {
  /**
   * The existing bounded access built from the browser-granted directory/file handle.
   *
   * This first 14C contract intentionally admits durable FileSystemHandle authority only. A plain
   * File/Blob remains openable by the PWA, but has no root+handle identity to pin and is therefore
   * not promoted into the command realm by pretending its display name is a capability.
   */
  readonly access: WebFileAccess
  /** An entry already resolved through that access; its id is never re-parsed as a filesystem path. */
  readonly entry: ExplorerEntry
  /** Open policy pinned behind the ref. Source/path are derived from `access` + `entry`. */
  readonly request: Omit<SubjectOpenRequest, 'path' | 'signal' | 'source'>
}

interface PinnedWebCommandSubjectAuthorization extends WebCommandSubjectAuthorization {
  /** Object identities returned by the access at authorization time; checked again on every run. */
  readonly rootAuthority: WebPermissionHandleLike
  readonly fileHandle: WebFileHandleLike
}

export interface WebCommandSubjectLease {
  readonly ref: string
  readonly root: string
  readonly handle: string
  revoke(): boolean
}

export interface WebCommandProtocol extends SubjectCommandEndpoint {
  authorize(subject: WebCommandSubjectAuthorization): WebCommandSubjectLease
  revoke(ref: string): boolean
  readonly authorizedSubjects: number
}

export interface WebCommandProtocolOptions {
  readonly maxAuthorizations?: number
  readonly maxConcurrentRuns?: number
}

const assertNonEmpty = (value: string, name: string): void => {
  if (value === '') throw new TypeError(`${name} must not be empty`)
}

/** A bounded snapshot read through the already-granted WebFileAccess, never through a raw path. */
async function sourceFromAuthority(
  authorization: PinnedWebCommandSubjectAuthorization,
  signal?: AbortSignal,
): Promise<ArtifactByteSource> {
  const { access, entry, request } = authorization
  if (access.writeGrant !== authorization.rootAuthority) {
    throw new TypeError(`the browser root authority for «${entry.id}» changed after authorization`)
  }
  if (access.handleOf(entry.id) !== authorization.fileHandle) {
    throw new TypeError(`the browser file handle for «${entry.id}» changed after authorization`)
  }
  const snapshot = await access.snapshotOf(entry.id, signal)
  const size = snapshot?.size ?? access.sizeOf(entry.id)
  if (size === undefined) throw new TypeError(`authorized handle «${entry.id}» has no file size`)
  if (!Number.isSafeInteger(size) || size < 0 || BigInt(size) > request.budget.maxInputBytes) {
    throw new RangeError(`authorized handle «${entry.id}» exceeds the command input budget`)
  }
  const bytes = await access.read(entry.id, size, signal)
  if (bytes.byteLength !== size) {
    throw new TypeError(`authorized handle «${entry.id}» changed while its bytes were read`)
  }
  const uri = `memory://modkit-pwa-command/${encodeURIComponent(entry.id)}`
  const token =
    snapshot === undefined ? `size:${size}` : `${snapshot.size}:${snapshot.lastModified}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionIdFromRef({ kind: 'provider-token', value: token }),
    size: BigInt(size),
    async read(offset, length) {
      const start = Number(offset)
      return bytes.slice(start, Math.min(start + length, bytes.byteLength))
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n)
      const end =
        range?.length === undefined
          ? bytes.byteLength
          : Math.min(start + Number(range.length), bytes.byteLength)
      yield bytes.slice(start, end)
    },
  }
}

/** Bind the command endpoint to this PWA composition's exact worker-brokered subject services. */
export function createWebCommandProtocol(
  services: Pick<SubjectServices, 'open'>,
  options: WebCommandProtocolOptions = {},
): WebCommandProtocol {
  const maximum = options.maxAuthorizations ?? DEFAULT_WEB_COMMAND_MAX_AUTHORIZATIONS
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError('maxAuthorizations must be a positive safe integer')
  }
  const authorizations = new Map<string, PinnedWebCommandSubjectAuthorization>()
  let nextRef = 0
  const endpoint = createSubjectCommandEndpoint({
    maxConcurrentRuns: options.maxConcurrentRuns ?? DEFAULT_WEB_COMMAND_MAX_CONCURRENT_RUNS,
    openSubject: async (ref, signal) => {
      const authorization = authorizations.get(ref)
      if (authorization === undefined) {
        throw new TypeError(`subject reference «${ref}» is not authorized in this PWA realm`)
      }
      const source = await sourceFromAuthority(authorization, signal)
      const result = await services.open({
        ...authorization.request,
        source,
        path: authorization.entry.name,
        ...(signal === undefined ? {} : { signal }),
      })
      return {
        snapshot: subjectOpenSnapshot({
          result,
          diagnostics: result.diagnostics,
          sessionId: () => authorization.entry.id,
        }),
        ...(result.state === 'opened' ? { session: result.session } : {}),
      }
    },
  })

  const revoke = (ref: string): boolean => authorizations.delete(ref)
  return Object.freeze({
    catalog: endpoint.catalog,
    execute: endpoint.execute,
    cancel: endpoint.cancel,
    async dispose(): Promise<void> {
      authorizations.clear()
      await endpoint.dispose()
    },
    get activeRuns(): number {
      return endpoint.activeRuns
    },
    get closed(): boolean {
      return endpoint.closed
    },
    authorize(subject: WebCommandSubjectAuthorization): WebCommandSubjectLease {
      if (endpoint.closed) throw new Error('the PWA command protocol is closed')
      assertNonEmpty(subject.access.label, 'command root label')
      assertNonEmpty(subject.entry.id, 'command handle id')
      if (subject.entry.directory) throw new TypeError('a command subject handle must name a file')
      const rootAuthority = subject.access.writeGrant
      if (rootAuthority === undefined) {
        throw new TypeError('a command subject needs an existing durable browser root authority')
      }
      const fileHandle = subject.access.handleOf(subject.entry.id)
      if (fileHandle === undefined) {
        throw new TypeError(`«${subject.entry.id}» is not a file handle under the granted root`)
      }
      assertNonEmpty(subject.request.grant.id, 'command subject grant id')
      if (!subject.request.grant.classes.includes('read-source')) {
        throw new TypeError('a command subject grant must include read-source')
      }
      if (authorizations.size >= maximum) {
        throw new RangeError(
          `the PWA command realm already has its ${maximum} permitted subject authorizations`,
        )
      }
      nextRef += 1
      const ref = `modkit-pwa-subject:${nextRef}`
      const pinned = Object.freeze({
        ...subject,
        rootAuthority,
        fileHandle,
        entry: Object.freeze({ ...subject.entry }),
        request: Object.freeze({
          ...subject.request,
          grant: Object.freeze({
            ...subject.request.grant,
            classes: Object.freeze([...subject.request.grant.classes]),
          }),
          budget: Object.freeze({ ...subject.request.budget }),
        }),
      })
      authorizations.set(ref, pinned)
      let live = true
      return Object.freeze({
        ref,
        root: subject.access.label,
        handle: subject.entry.id,
        revoke(): boolean {
          if (!live) return false
          live = false
          return revoke(ref)
        },
      })
    },
    revoke,
    get authorizedSubjects(): number {
      return authorizations.size
    },
  })
}

export type { CommandProtocolRunOptions } from '@modkitx-x3/host'
