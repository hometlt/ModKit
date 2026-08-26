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
 *  3. **Confinement is the path opener's, unchanged.** A container is reached through
 *    `createPathSubjectOpener` with this window's granted roots, so a `modkit-container:` URI can
 *    never name a file the same window would refuse to open directly. The URI is an encoding of a
 *    path, not a capability.
 *
 * What it deliberately does not own: any knowledge of BIG, CASC or MPQ. It asks for the standard
 * `common.view/namespace-entry-source` and the standard `container.extract`; a container that
 * publishes both is browsable here, and one that does not is refused by name.
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import type {
  AssetSession,
  NamespaceEntry,
  NamespaceEntrySource,
  PermissionGrant,
  ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  nestedSubjectServices,
  openNestedSubject,
  subjectOpenSnapshot,
  type SubjectOpener,
  type SubjectServices,
} from '@modkitx-x3/host'
import { createPathSubjectOpener } from '@modkitx-x3/host/node'

import { findArchiveExtractOperation } from './archive-entry.js'
import {
  buildContainerIndex,
  listContainerDirectory,
  parseContainerUriText,
  statContainerEntry,
  type ContainerIndex,
  type ContainerNode,
} from './container-uri.js'

/** The subject at this path publishes no entry listing — it is not a container this host can browse. */
export const NOT_A_CONTAINER = 'x3.app/vscode-not-a-container'
/** The URI named a member the container's own listing does not hold. */
export const CONTAINER_ENTRY_NOT_FOUND = 'x3.app/vscode-container-entry-not-found'

const NAMESPACE_ENTRY_SOURCE = 'common.view/namespace-entry-source'
/** Entries requested per listing page. The same bound the archive stage pages with. */
const PAGE_LIMIT = 512
/** Pages a single container listing will read before it stops describing itself as complete. */
const MAXIMUM_PAGES = 512

export interface ContainerRegistryOptions {
  readonly services: SubjectServices
  /** Granted directories, read per request: opening another workspace folder widens them. */
  readonly roots: () => readonly string[]
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  /** Named non-fatal outcomes — a companion absent inside the archive, a capped listing. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
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
  /** True when the listing stopped at `MAXIMUM_PAGES` rather than at the container's last page. */
  readonly capped: boolean
}

export function createContainerRegistry(options: ContainerRegistryOptions): ContainerRegistry {
  const held = new Map<string, Promise<HeldContainer>>()

  const openContainer = async (container: string, signal?: AbortSignal): Promise<HeldContainer> => {
    const opener = createPathSubjectOpener({
      subjects: options.services,
      roots: options.roots(),
      grant: options.grant,
      budget: options.budget,
    })
    const answer = await opener(container, signal)
    if (answer.snapshot.state !== 'opened' || answer.session === undefined) {
      throw new ModkitError({
        code: NOT_A_CONTAINER,
        message:
          answer.snapshot.state === 'opened'
            ? 'the container opened without a session'
            : `no contribution claimed this file: ${answer.snapshot.reason}`,
        context: { state: answer.snapshot.state },
      })
    }
    const session = answer.session
    try {
      const descriptor = await session.descriptor()
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
        return { session, index: buildContainerIndex(entries), capped }
      } finally {
        await lease.release()
      }
    } catch (error) {
      // The container is not kept when its listing could not be read: a half-open session that
      // answers nothing is a file handle held for no reason.
      await session.dispose().catch(() => undefined)
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
      held.delete(key)
      throw error
    }
  }

  const entryIdOf = (holder: HeldContainer, container: string, entry: string): string => {
    const node = statContainerEntry(holder.index, entry)
    if (node?.kind !== 'file' || node.entryId === undefined) {
      throw new ModkitError({
        code: CONTAINER_ENTRY_NOT_FOUND,
        message:
          node === undefined
            ? `this container lists no «${entry}»`
            : `«${entry}» is a directory inside this container, not a member`,
        context: { entry, container },
      })
    }
    return node.entryId
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
      if (node === undefined) {
        throw new ModkitError({
          code: CONTAINER_ENTRY_NOT_FOUND,
          message: `this container lists no «${entry}»`,
          context: { entry, container },
        })
      }
      return node
    },

    async read(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const entryId = entryIdOf(holder, container, entry)
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
      const entryId = entryIdOf(holder, location.container, location.entry)
      const diagnostics: Diagnostic[] = []
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
      const snapshot = subjectOpenSnapshot({
        result: nested.result,
        sessionId: () => `container:${randomUUID()}`,
        diagnostics: carried,
      })
      return { snapshot, session: nested.result.session }
    },

    held: () => [...held.keys()],

    async dispose() {
      const opening = [...held.values()]
      held.clear()
      for (const pending of opening) {
        try {
          const holder = await pending
          await holder.session.dispose()
        } catch {
          // A container that never opened has nothing to close, and a disposal that threw must not
          // stop the ones after it: this runs when the window is going away.
        }
      }
    },
  }
  return Object.freeze(registry)
}
