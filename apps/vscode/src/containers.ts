/**
 * Containers as a browsable source, on the extension-host side (no `vscode` import).
 *
 * The host has had `openNestedSubject` since block 9 — a route that opens one member of an already
 * open container as a subject in its own right, with its companions resolved *inside* that same
 * container. Electron reached it from its composition and no application surface did: VS Code's
 * archive stage went on extracting an entry's bytes into a hex pane, which is a preview of a member
 * and not the member itself. This is the missing half for VS Code, kept here rather than in
 * `extension.ts` so it can be exercised in plain Node against a real archive.
 *
 * Three things it owns, and nothing else:
 *
 *  1. **One open container per path, shared.** An Explorer expanding a tree asks for many
 *    directories and the custom editor then asks for a member; opening the BIG again for each of
 *    those would re-read and re-detect a multi-hundred-megabyte file every time. The session is
 *    cached under the container's resolved path and disposed with the window.
 *  2. **The listing, indexed once.** A container lists leaves; an Explorer asks for directories.
 *    `buildContainerIndex` bridges that, and its result is cached with the session, because paging
 *    a large archive's namespace is the expensive part of answering `readDirectory`.
 *  3. **Confinement stays host-owned.** Regular files use `createPathSubjectOpener`. The one
 *    directory-backed container admitted here (CASC) must pass both lexical and physical-root
 *    confinement before a file-VFS mount exists. The URI is an encoding of a path, not a
 *    capability.
 *
 * It otherwise stays format-neutral: every subject must publish the standard
 * `common.view/namespace-entry-source` and `container.extract`. The `casc` identity check is only
 * the narrow admission boundary for a physical directory; ordinary directory subjects remain a
 * later program step.
 */

import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ModkitError, type Diagnostic } from '@modkit/core'
import type {
  AssetSession,
  NamespaceEntry,
  NamespaceEntrySource,
  PermissionGrant,
  ResourceBudget,
} from '@modkit/sdk'
import {
  artifactNamespaceSourceFromVfsMount,
  nestedSubjectServices,
  openNestedSubject,
  openSubject,
  subjectOpenSnapshot,
  type SubjectOpener,
  type SubjectOpenedSnapshot,
  type SubjectServices,
} from '@modkit/host'
import { createPathSubjectOpener } from '@modkit/host/node'
import { VirtualFileSystem } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'

import { findArchiveExtractOperation } from './archive-entry.js'
import {
  buildContainerIndex,
  listContainerDirectory,
  parseContainerUriText,
  statContainerEntry,
  type ContainerIndex,
  type ContainerNode,
} from './container-uri.js'
import { searchContainerIndex, type ContainerSearchHit } from './workbench-workflows.js'

/** The subject at this path publishes no entry listing — it is not a container this host can browse. */
export const NOT_A_CONTAINER = 'x3.app/vscode-not-a-container'
/** The URI named a member the container's own listing does not hold. */
export const CONTAINER_ENTRY_NOT_FOUND = 'x3.app/vscode-container-entry-not-found'

const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'
/** Entries requested per listing page. The same bound the archive stage pages with. */
const PAGE_LIMIT = 256
/** Pages a single container listing will read before it stops describing itself as complete. */
const MAXIMUM_PAGES = 512
/** Wave 1B's sole directory-backed container; general directory subjects remain out of scope. */
const DIRECTORY_CONTAINER_FORMAT = 'casc'

export interface ContainerRegistryOptions {
  readonly services: SubjectServices
  /** Granted directories, read per request: opening another workspace folder widens them. */
  readonly roots: () => readonly string[]
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  /** Named non-fatal outcomes — a companion absent inside the archive, a capped listing. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Host-open seam for the namespace-only container branch; production uses `openSubject`. */
  readonly openNamespaceSubject?: typeof openSubject
}

export interface ContainerRegistry {
  /** The indexed listing of one container, opening it if this window has not already. */
  index(container: string, signal?: AbortSignal): Promise<ContainerIndex>
  /** Children of one directory inside a container. */
  list(container: string, entry: string, signal?: AbortSignal): Promise<readonly ContainerNode[]>
  /** What one entry path names inside a container. */
  stat(container: string, entry: string, signal?: AbortSignal): Promise<ContainerNode>
  /** The member's bytes, through the container's own bounded extraction. */
  read(container: string, entry: string, signal?: AbortSignal): Promise<Uint8Array>
  /** Focused, bounded search over the listing already owned by this registry. */
  search(
    container: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly ContainerSearchHit[]>
  /** Drop one held listing/session and open it again from its current source revision. */
  refresh(container: string, signal?: AbortSignal): Promise<ContainerIndex>
  /** Release one held container without disturbing other sources in this window. */
  release(container: string): Promise<boolean>
  /**
   * The member as a subject: the same snapshot a file on disk produces, so the page cannot tell
   * which of the two it asked for.
   */
  open: SubjectOpener
  /** Containers this window is holding open, for the status surfaces. */
  readonly held: () => readonly string[]
  dispose(): Promise<void>
}

interface HeldContainer {
  readonly session: AssetSession
  readonly index: ContainerIndex
  /** Releases a directory-backed namespace mount; a regular file owns no extra source. */
  readonly releaseSource: () => Promise<void>
  /** Actual parent selection, with no container path or entry locator. */
  readonly selectedRoute: NonNullable<SubjectOpenedSnapshot['selectedRoute']>
  /** True when the listing stopped at `MAXIMUM_PAGES` rather than at the container's last page. */
  readonly capped: boolean
  /** CASC's stable namespace entry ids are normalized member paths, including unlisted hashes. */
  readonly directPathEntryIds: boolean
  /** Child sessions retaining this parent for companions and nested reads. */
  retainers: number
  /** A release/dispose arrived; disposal runs once the last child is gone. */
  releaseRequested: boolean
  disposal?: Promise<void>
}

function insideGrantedRoots(roots: readonly string[], path: string): boolean {
  return roots.some(root => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

export function createContainerRegistry(options: ContainerRegistryOptions): ContainerRegistry {
  const held = new Map<string, Promise<HeldContainer>>()

  const openContainer = async (container: string, signal?: AbortSignal): Promise<HeldContainer> => {
    const roots = options.roots().map(root => resolve(root))
    if (roots.length === 0 || !insideGrantedRoots(roots, container)) {
      throw new TypeError('path is outside the granted roots')
    }

    let releaseSource = async (): Promise<void> => undefined
    let sessionToDispose: AssetSession | undefined
    try {
      const info = await stat(container)
      let answer: Awaited<ReturnType<SubjectOpener>>
      if (info.isDirectory()) {
        /*
         * CASC installations are physical directories but logical containers. This branch is
         * deliberately private to the container registry: it does not make directories generic
         * VS Code subjects, and the descriptor checks below still require the standard namespace
         * and extract contracts before the source can be held or browsed.
         */
        const physicalContainer = await realpath(container)
        const physicalRoots = await Promise.all(roots.map(path => realpath(path)))
        if (!insideGrantedRoots(physicalRoots, physicalContainer)) {
          throw new TypeError('path is outside the physically granted roots')
        }
        const filesystem = new VirtualFileSystem().registerProvider(createFileVfsProvider())
        releaseSource = async () => filesystem.dispose()
        const mount = await filesystem.openMount(
          pathToFileURL(physicalContainer).href,
          signal === undefined ? {} : { signal },
        )
        const result = await (options.openNamespaceSubject ?? openSubject)({
          inventory: options.services.inventory,
          source: artifactNamespaceSourceFromVfsMount(mount),
          path: container,
          intent: 'full',
          target: options.services.target,
          grant: {
            ...options.grant,
            id: `${options.grant.id}:container:${randomUUID()}`,
          },
          budget: options.budget,
          executionBackends: options.services.executionBackends,
          ...(options.services.serviceDefinitions === undefined
            ? {}
            : { serviceDefinitions: options.services.serviceDefinitions }),
          ...(signal === undefined ? {} : { signal }),
        })
        const diagnostics = result.diagnostics.map(item => ({
          code: item.code,
          message: item.message,
          severity: item.severity,
        }))
        if (result.state === 'unresolved') {
          answer = {
            snapshot: subjectOpenSnapshot({
              result,
              sessionId: randomUUID,
              diagnostics,
            }),
          }
        } else {
          sessionToDispose = result.session
          answer = {
            snapshot: subjectOpenSnapshot({
              result,
              sessionId: randomUUID,
              diagnostics,
            }),
            session: result.session,
          }
        }
      } else {
        const opener = createPathSubjectOpener({
          subjects: options.services,
          roots,
          grant: options.grant,
          budget: options.budget,
        })
        answer = await opener(container, signal)
        sessionToDispose = answer.session
      }
      if (answer.snapshot.state !== 'opened' || answer.session === undefined) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message:
            answer.snapshot.state === 'opened'
              ? 'the container opened without a session'
              : `no contribution claimed this container: ${answer.snapshot.reason}`,
          context: { state: answer.snapshot.state },
        })
      }
      const session = answer.session
      const descriptor = await session.descriptor()
      const identity = 'identity' in descriptor ? descriptor.identity : undefined
      const directoryFormatId = identity?.formatId
      if (info.isDirectory() && directoryFormatId !== DIRECTORY_CONTAINER_FORMAT) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message:
            `directory-backed containers are limited to ${DIRECTORY_CONTAINER_FORMAT}; ` +
            `this subject resolved as ${directoryFormatId ?? 'unresolved'}`,
          context: { formatId: directoryFormatId ?? 'unresolved' },
        })
      }
      if (
        !descriptor.dataSources.some(
          item => item.contract === NAMESPACE_ENTRY_SOURCE && item.major === 1,
        )
      ) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message: `this subject publishes no ${NAMESPACE_ENTRY_SOURCE}@1, so it holds no entries`,
          context: { dataSources: descriptor.dataSources.map(item => item.contract) },
        })
      }
      if (findArchiveExtractOperation(descriptor.operations) === undefined) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message:
            'this container publishes no available container.extract, so its entries cannot be read',
          context: { operations: descriptor.operations.map(item => item.id) },
        })
      }
      const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
      try {
        const namespace = lease.value as NamespaceEntrySource
        const entries: NamespaceEntry[] = []
        let cursor: string | undefined
        let pages = 0
        do {
          const page = await namespace.list(
            '',
            cursor === undefined ? { limit: PAGE_LIMIT } : { cursor, limit: PAGE_LIMIT },
            signal,
          )
          entries.push(...page.items)
          cursor = page.nextCursor
          pages += 1
        } while (cursor !== undefined && pages < MAXIMUM_PAGES)
        const capped = cursor !== undefined
        if (capped) {
          options.onDiagnostic?.({
            code: 'x3.app/vscode-container-listing-capped',
            severity: 'warning',
            message:
              `the listing stopped after ${MAXIMUM_PAGES} pages (${entries.length} entries); ` +
              'members beyond that are not shown',
          })
        }
        const holder: HeldContainer = {
          session,
          index: buildContainerIndex(entries),
          releaseSource,
          selectedRoute: Object.freeze([...(answer.snapshot.selectedRoute ?? [])]),
          capped,
          directPathEntryIds: info.isDirectory(),
          retainers: 0,
          releaseRequested: false,
        }
        sessionToDispose = undefined
        return holder
      } finally {
        await lease.release()
      }
    } catch (error) {
      // The container is not kept when its listing could not be read: a half-open session that
      // answers nothing is a file handle held for no reason.
      await sessionToDispose?.dispose().catch(() => undefined)
      await releaseSource().catch(() => undefined)
      throw error
    }
  }

  const holderFor = async (container: string, signal?: AbortSignal): Promise<HeldContainer> => {
    const key = resolve(container)
    const known = held.get(key)
    if (known !== undefined) return known
    const opening = openContainer(key, signal)
    held.set(key, opening)
    try {
      return await opening
    } catch (error) {
      // A failed open is not cached: the file may appear, or a folder may be granted, later.
      // A release can remove this promise and a new request can already own the same key. The old
      // failure must never delete that newer holder and orphan its live session/VFS mount.
      if (held.get(key) === opening) held.delete(key)
      throw error
    }
  }

  const requestHolderDisposal = async (holder: HeldContainer): Promise<void> => {
    holder.releaseRequested = true
    if (holder.retainers > 0) return
    holder.disposal ??= (async () => {
      try {
        await holder.session.dispose()
      } finally {
        await holder.releaseSource()
      }
    })()
    await holder.disposal
  }

  const releaseRetainer = async (holder: HeldContainer): Promise<void> => {
    if (holder.retainers <= 0) return
    holder.retainers -= 1
    if (holder.retainers === 0 && holder.releaseRequested) await requestHolderDisposal(holder)
  }

  const retainedChildSession = (holder: HeldContainer, child: AssetSession): AssetSession => {
    let disposed = false
    return {
      revision: child.revision,
      state: () => child.state(),
      descriptor: () => child.descriptor(),
      dataSource: (contract, major) => child.dataSource(contract, major),
      operations: () => child.operations(),
      events: signal => child.events(signal),
      async dispose() {
        if (disposed) return
        disposed = true
        try {
          await child.dispose()
        } finally {
          await releaseRetainer(holder)
        }
      },
    }
  }

  const release = async (container: string): Promise<boolean> => {
    const key = resolve(container)
    const pending = held.get(key)
    if (pending === undefined) return false
    held.delete(key)
    try {
      const holder = await pending
      await requestHolderDisposal(holder)
    } catch {
      // A failed open was never a live session. A disposal failure must not leave a stale cache key.
    }
    return true
  }

  const entryIdOf = async (
    holder: HeldContainer,
    container: string,
    entry: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    const node = statContainerEntry(holder.index, entry)
    if (node?.kind === 'file' && node.entryId !== undefined) return node.entryId
    if (node === undefined) {
      /*
       * An Explorer index is intentionally capped. A caller that already has an exact member path
       * must not lose it merely because that path sorts beyond the cap: ask the container's own
       * bounded namespace for that exact prefix and admit only an exact file match.
       */
      const lease = await holder.session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
      try {
        const namespace = lease.value as NamespaceEntrySource
        if (holder.directPathEntryIds) {
          try {
            const entryLease = await namespace.openEntry(entry, signal)
            await entryLease.release()
            return entry
          } catch (error) {
            if (signal?.aborted === true) throw error
            // An invalid direct path can still be represented by an opaque listed entry id.
          }
        }
        const requested = entry.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase()
        const page = await namespace.list(entry, { limit: 1 }, signal)
        const exact = page.items.find(
          item =>
            item.kind === 'file' &&
            item.path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase() === requested,
        )
        if (exact !== undefined) return exact.id
      } finally {
        await lease.release()
      }
    }
    throw new ModkitError({
      code: CONTAINER_ENTRY_NOT_FOUND,
      message:
        node === undefined
          ? `this container lists no «${entry}»`
          : `«${entry}» is a directory inside this container, not a member`,
      context: { entry, container },
    })
  }

  const registry: ContainerRegistry = {
    async index(container, signal) {
      return (await holderFor(container, signal)).index
    },

    async list(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const children = listContainerDirectory(holder.index, entry)
      if (children === undefined) {
        throw new ModkitError({
          code: CONTAINER_ENTRY_NOT_FOUND,
          message: `this container has no directory «${entry}»`,
          context: { entry, container },
        })
      }
      return children
    },

    async stat(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const node = statContainerEntry(holder.index, entry)
      if (node !== undefined) return node

      /*
       * VS Code asks its FileSystemProvider for stat before it lets a custom editor read/open the
       * URI. A capped Explorer index is therefore not allowed to be the existence oracle for an
       * exact member path: CASC names after the visible prefix would otherwise be rejected before
       * `read` or `openNestedSubject` can use the container's bounded exact lookup.
       */
      const entryId = await entryIdOf(holder, container, entry, signal)
      const normalized = entry.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
      return {
        name: normalized.slice(normalized.lastIndexOf('/') + 1),
        kind: 'file',
        entryId,
      }
    },

    async read(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const entryId = await entryIdOf(holder, container, entry, signal)
      const descriptor = await holder.session.descriptor()
      const extract = findArchiveExtractOperation(descriptor.operations)
      if (extract === undefined) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message: 'this container no longer publishes an available container.extract',
          context: { entry, container },
        })
      }
      const invoked = await holder.session
        .operations()
        .invoke(extract.handlerId, { entryId }, signal === undefined ? {} : { signal })
      if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') {
        throw new ModkitError({
          code: CONTAINER_ENTRY_NOT_FOUND,
          message: `the container refused to extract «${entry}»`,
          context: {
            entry,
            state: invoked.state,
            ...(invoked.state === 'rejected' ? { reason: invoked.reason } : {}),
          },
        })
      }
      return invoked.output.value
    },

    async search(container, query, signal) {
      return searchContainerIndex((await holderFor(container, signal)).index, query)
    },

    async refresh(container, signal) {
      await release(container)
      return (await holderFor(container, signal)).index
    },

    release,

    /**
     * A member, opened as a subject.
     *
     * This is the whole point of the slice: the parent stays open and leased for as long as the
     * child lives, so a W3D inside a BIG finds its texture inside the same BIG — never through a
     * temporary file on disk. The snapshot is built by the host's own mapper, the same one the path
     * opener uses, so the page receives one shape and not two.
     */
    async open(requested, signal) {
      const location = parseContainerUriText(requested)
      if (location === undefined) {
        throw new TypeError(`«${requested}» does not name a container member`)
      }
      const holder = await holderFor(location.container, signal)
      const diagnostics: Diagnostic[] = []
      // The exact-entry lookup below can suspend on the namespace provider. Retain before that
      // first await: a concurrent Explorer release must not dispose this parent/VFS mount while the
      // child open is still resolving its member id.
      holder.retainers += 1
      let childToDispose: AssetSession | undefined
      let retainerTransferredToChild = false
      try {
        const entryId = await entryIdOf(holder, location.container, location.entry, signal)
        const nested = await openNestedSubject({
          parent: holder.session,
          entryId,
          ...nestedSubjectServices(options.services),
          grant: options.grant,
          budget: options.budget,
          pageLimit: PAGE_LIMIT,
          onDiagnostic: item => {
            diagnostics.push(item)
            options.onDiagnostic?.(item)
          },
          ...(signal === undefined ? {} : { signal }),
        })
        const carried = [...nested.result.diagnostics, ...diagnostics].map(item => ({
          code: item.code,
          message: item.message,
          severity: item.severity,
        }))
        if (nested.result.state === 'unresolved') {
          return {
            snapshot: subjectOpenSnapshot({
              result: nested.result,
              sessionId: () => '',
              diagnostics: carried,
            }),
          }
        }
        childToDispose = nested.result.session
        const snapshot = subjectOpenSnapshot({
          result: nested.result,
          sessionId: () => `container:${randomUUID()}`,
          diagnostics: carried,
        })
        const selectedRoute = Object.freeze([
          ...holder.selectedRoute,
          ...(snapshot.selectedRoute ?? []),
        ])
        const session = retainedChildSession(holder, nested.result.session)
        childToDispose = undefined
        retainerTransferredToChild = true
        return {
          snapshot: selectedRoute.length === 0 ? snapshot : { ...snapshot, selectedRoute },
          session,
        }
      } catch (error) {
        await childToDispose?.dispose().catch(() => undefined)
        throw error
      } finally {
        if (!retainerTransferredToChild) await releaseRetainer(holder)
      }
    },

    held: () => [...held.keys()],

    async dispose() {
      const opening = [...held.values()]
      held.clear()
      for (const pending of opening) {
        try {
          const holder = await pending
          await requestHolderDisposal(holder)
        } catch {
          // A container that never opened has nothing to close, and a disposal that threw must not
          // stop the ones after it: this runs when the window is going away.
        }
      }
    },
  }
  return Object.freeze(registry)
}
