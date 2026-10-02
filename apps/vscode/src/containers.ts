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
  ArtifactNamespaceSource,
  ArtifactSource,
  AssetSession,
  ContainerPackCreateFileV1,
  ContainerPackEntryRefV1,
  ContainerPackEntryRenameV1,
  ContainerPackEntryReplacementV1,
  ContainerPackInputV1,
  RevisionId,
  NamespaceEntry,
  NamespaceEntrySource,
  OperationSession,
  Lease,
  PayloadStore,
  PermissionGrant,
  ResourceBudget,
  SourceEdit,
  SubjectEditTarget,
} from '@modkit/sdk'
import {
  artifactNamespaceSourceFromVfsMount,
  codecFidelityEvidenceRecords,
  createContainerNamespaceComposition,
  createEvidenceRegistry,
  createSubjectEditing,
  invokeContainerPack,
  nestedSubjectServices,
  replacedBytes,
  type CompanionOrigin,
  type EditingBackend,
  openNestedSubject,
  openSubject,
  subjectOpenSnapshot,
  type OpenedSubject,
  type SubjectOpener,
  type SubjectOpenedSnapshot,
  type SubjectServices,
} from '@modkit/host'
import { createFileEditingBackend, createPathSubjectOpener } from '@modkit/host/node'
import { VirtualFileSystem } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'

import { findArchiveExtractOperation } from './archive-entry.js'
import {
  buildContainerIndex,
  listContainerDirectory,
  CONTAINER_SEPARATOR,
  joinContainer,
  normalizeEntryPath,
  parseContainerUriText,
  splitContainer,
  statContainerEntry,
  type ContainerIndex,
  type ContainerNode,
} from './container-uri.js'
import { searchContainerIndex, type ContainerSearchHit } from './workbench-workflows.js'

/** The subject at this path publishes no entry listing — it is not a container this host can browse. */
export const NOT_A_CONTAINER = 'x3.app/vscode-not-a-container'
/** The URI named a member the container's own listing does not hold. */
export const CONTAINER_ENTRY_NOT_FOUND = 'x3.app/vscode-container-entry-not-found'
export const CONTAINER_NOT_WRITABLE = 'x3.app/vscode-container-not-writable'
/** A create or rename named a path the container already holds. */
export const CONTAINER_ENTRY_EXISTS = 'x3.app/vscode-container-entry-exists'

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
  /**
   * Optional acceptance telemetry. It observes only a completed ordinary `container.extract`
   * result; it neither changes selection nor gains a write path into a provider.
   */
  readonly onExtract?: (event: {
    readonly container: string
    readonly entry: string
    readonly bytes: number
  }) => void
  /** Host-open seam for the namespace-only container branch; production uses `openSubject`. */
  readonly openNamespaceSubject?: typeof openSubject
  /**
   * Whether listings include entries the codec calls hidden, read per request so a changed setting
   * applies to the next listing. Absent means they are left out; opening one by path always works.
   */
  readonly showHidden?: () => boolean
  /**
   * The places a member searches behind its container, for the member's own path (the container's
   * file joined with its members): the resources of its mod — a model in a zipped resource pack
   * reaches the game's textures. Absent, a member reaches only its container.
   */
  readonly assetOriginsFor?: (target: string) => Promise<readonly CompanionOrigin[]>
  /**
   * Turns an opened member into the subject its view shows, as a file open does — a map into its
   * world. Absent, the member is shown as its codec opened it.
   */
  readonly prepareOpened?: (request: {
    readonly opened: OpenedSubject
    readonly grant: PermissionGrant
    readonly budget: ResourceBudget
    readonly signal?: AbortSignal
  }) => Promise<OpenedSubject>
}

export interface ContainerRegistry {
  /** The indexed listing of one container, opening it if this window has not already. */
  index(container: string, signal?: AbortSignal): Promise<ContainerIndex>
  /** Children of one directory inside a container. */
  list(container: string, entry: string, signal?: AbortSignal): Promise<readonly ContainerNode[]>
  /** Bounded flat files beneath a prefix, using the provider's paged namespace directly. */
  walk(
    container: string,
    entry: string,
    maximum: number,
    signal?: AbortSignal,
  ): Promise<readonly NamespaceEntry[]>
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
  /**
   * Write one member back into its container through the standard `container.pack`, committed to
   * the container file under `write-source`. A container whose codec publishes no pack refuses
   * with a reason a person can act on — save a copy instead.
   */
  write(container: string, entry: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>
  /**
   * What a file manager does inside a container — write or create files, create folders, remove
   * and rename files or folders — as one repack through `container.pack`. `container` may itself
   * be a member (`a.zip!/b.zip`): the repacked inner container is written into its parent.
   */
  edit(container: string, change: ContainerChange, signal?: AbortSignal): Promise<void>
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
  /** One operation facade for the lifetime of the session; remote facades are RPC handles. */
  readonly operations: OperationSession
  readonly extractHandlerId: string
  /** One namespace lease for every hierarchical lookup; reacquiring it exhausts RPC handle ids. */
  readonly namespace: NamespaceEntrySource
  readonly releaseNamespace: () => Promise<void>
  /** Original source retained so a directory subtree can become its own semantic subject. */
  readonly namespaceSource?: ArtifactNamespaceSource
  readonly index: ContainerIndex
  /** A namespace that can enumerate one directory without flattening the entire container. */
  readonly hierarchical: boolean
  /** Directory listings retained by normalized, case-insensitive member path. */
  readonly directoryChildren: Map<string, Promise<readonly ContainerNode[]>>
  /** Releases a directory-backed namespace mount; a regular file owns no extra source. */
  readonly releaseSource: () => Promise<void>
  /** Actual parent selection, with no container path or entry locator. */
  readonly selectedRoute: NonNullable<SubjectOpenedSnapshot['selectedRoute']>
  /** True when the listing stopped at `MAXIMUM_PAGES` rather than at the container's last page. */
  readonly capped: boolean
  /** CASC's stable namespace entry ids are normalized paths, including entries outside the index. */
  readonly directPathEntryIds: boolean
  /** Child sessions retaining this parent for companions and nested reads. */
  retainers: number
  /** A release/dispose arrived; disposal runs once the last child is gone. */
  releaseRequested: boolean
  disposal?: Promise<void>
}

const nodeOf = (entry: NamespaceEntry): ContainerNode => ({
  name: entry.name,
  kind: entry.kind,
  ...(entry.kind === 'file' ? { entryId: entry.id } : {}),
  ...(entry.size === undefined ? {} : { size: Number(entry.size) }),
  ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
  ...(entry.hidden === true ? { hidden: true as const } : {}),
})

async function listImmediateChildren(
  namespace: NamespaceEntrySource,
  path: string,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly ContainerNode[]; readonly capped: boolean }> {
  if (namespace.children === undefined) {
    throw new TypeError('the namespace does not publish hierarchical listing')
  }
  const items: ContainerNode[] = []
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < MAXIMUM_PAGES; pageNumber += 1) {
    const page = await namespace.children(
      path,
      cursor === undefined
        ? { limit: PAGE_LIMIT, includeHidden: true }
        : { cursor, limit: PAGE_LIMIT, includeHidden: true },
      signal,
    )
    items.push(...page.items.map(nodeOf))
    cursor = page.nextCursor
    if (cursor === undefined) return { items: Object.freeze(items), capped: false }
  }
  return { items: Object.freeze(items), capped: true }
}

function insideGrantedRoots(roots: readonly string[], path: string): boolean {
  return roots.some(root => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/** A change to a container's members, by path; a folder is every member under its path. */
export interface ContainerChange {
  readonly write?: readonly { readonly entry: string; readonly bytes: Uint8Array }[]
  readonly folders?: readonly string[]
  readonly remove?: readonly string[]
  readonly rename?: readonly { readonly from: string; readonly to: string }[]
}

async function listAll(session: AssetSession, signal?: AbortSignal): Promise<NamespaceEntry[]> {
  const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  try {
    const namespace = lease.value as NamespaceEntrySource
    const entries: NamespaceEntry[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
      const listed = await namespace.list(
        '',
        { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }), includeHidden: true },
        signal,
      )
      entries.push(...listed.items)
      cursor = listed.nextCursor
      if (cursor === undefined) return entries
    }
    throw new ModkitError({
      code: CONTAINER_NOT_WRITABLE,
      message: 'this container lists more members than one change may account for',
    })
  } finally {
    await lease.release()
  }
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/**
 * The standard `container.pack` input for a change named by paths. Folders the container only
 * implies are expanded to the members under them; a change that only rewrites existing files
 * stays in the replacement form every packing codec understands.
 */
export function packInput(
  revision: RevisionId,
  listed: readonly NamespaceEntry[],
  change: ContainerChange,
): ContainerPackInputV1 {
  const pathOf = (entry: NamespaceEntry): string => normalizeEntryPath(entry.path)
  const files = new Map(
    listed.filter(entry => entry.kind === 'file').map(entry => [pathOf(entry), entry]),
  )
  const under = (folder: string): NamespaceEntry[] =>
    listed.filter(entry => pathOf(entry) === folder || pathOf(entry).startsWith(`${folder}/`))
  const exists = (path: string): boolean => files.has(path) || under(path).length > 0
  const ref = (entry: NamespaceEntry): ContainerPackEntryRefV1 => ({
    entryId: entry.id,
    expectedRevision: entry.revision,
  })
  const missing = (path: string): never => {
    throw new ModkitError({
      code: CONTAINER_ENTRY_NOT_FOUND,
      message: `this container holds no «${path}»`,
    })
  }
  const taken = (path: string): never => {
    throw new ModkitError({
      code: CONTAINER_ENTRY_EXISTS,
      message: `«${path}» already exists in this container`,
    })
  }
  const replacements: ContainerPackEntryReplacementV1[] = []
  const add: ContainerPackCreateFileV1[] = []
  const remove: ContainerPackEntryRefV1[] = []
  const rename: ContainerPackEntryRenameV1[] = []
  for (const item of change.write ?? []) {
    const path = normalizeEntryPath(item.entry)
    const existing = files.get(path)
    if (existing !== undefined) {
      replacements.push({ ...ref(existing), bytesBase64: base64Of(item.bytes) })
    } else if (exists(path)) {
      taken(path)
    } else {
      add.push({ name: path, bytesBase64: base64Of(item.bytes) })
    }
  }
  for (const folder of change.folders ?? []) {
    const path = normalizeEntryPath(folder)
    if (exists(path)) taken(path)
    add.push({ name: `${path}/`, bytesBase64: '' })
  }
  for (const item of change.remove ?? []) {
    const path = normalizeEntryPath(item)
    const file = files.get(path)
    const members = file === undefined ? under(path) : [file]
    if (members.length === 0) missing(path)
    remove.push(...members.map(ref))
  }
  for (const item of change.rename ?? []) {
    const from = normalizeEntryPath(item.from)
    const to = normalizeEntryPath(item.to)
    if (to === '') missing(to)
    if (exists(to)) taken(to)
    const file = files.get(from)
    if (file !== undefined) {
      rename.push({ ...ref(file), name: to })
      continue
    }
    const members = under(from)
    if (members.length === 0) missing(from)
    for (const entry of members) {
      const suffix = entry.kind === 'directory' ? '/' : ''
      rename.push({ ...ref(entry), name: `${to}${pathOf(entry).slice(from.length)}${suffix}` })
    }
  }
  if (add.length + remove.length + rename.length === 0) {
    return { schemaVersion: 1, expectedContainerRevision: revision, replacements }
  }
  return {
    schemaVersion: 1,
    mode: 'edit',
    expectedContainerRevision: revision,
    ...(add.length === 0 ? {} : { add }),
    ...(remove.length === 0 ? {} : { remove }),
    ...(rename.length === 0 ? {} : { rename }),
    ...(replacements.length === 0 ? {} : { replacements }),
  }
}

/** A container's cache key: its file resolved, its member levels as the container names them. */
function keyOf(container: string): string {
  const { file, members } = splitContainer(container)
  return joinContainer(resolve(file), members)
}

export function createContainerRegistry(options: ContainerRegistryOptions): ContainerRegistry {
  const held = new Map<string, Promise<HeldContainer>>()
  const showHidden = (): boolean => options.showHidden?.() === true
  const writeGrant = (): PermissionGrant => ({
    ...options.grant,
    id: `${options.grant.id}:container-write:${randomUUID()}`,
    classes: Object.freeze([
      ...options.grant.classes.filter(item => item !== 'write-source'),
      'write-source' as const,
    ]),
  })

  const openContainer = async (container: string, signal?: AbortSignal): Promise<HeldContainer> => {
    const roots = options.roots().map(root => resolve(root))
    const { file, members } = splitContainer(container)
    if (roots.length === 0 || !insideGrantedRoots(roots, file)) {
      throw new TypeError('path is outside the granted roots')
    }

    let releaseSource = async (): Promise<void> => undefined
    let sessionToDispose: AssetSession | undefined
    let namespaceSource: ArtifactNamespaceSource | undefined
    try {
      const inner = members.at(-1)
      const directory = inner === undefined && (await stat(container)).isDirectory()
      let answer: Awaited<ReturnType<SubjectOpener>>
      if (inner !== undefined) {
        /*
         * An archive inside an archive: the member is opened as a subject of its parent, which is
         * held for as long as this one is, and then checked and listed like any container.
         */
        const parentKey = joinContainer(file, members.slice(0, -1))
        const parent = await holderFor(parentKey, signal)
        parent.retainers += 1
        releaseSource = () => releaseRetainer(parent)
        answer = await openMember(parent, parentKey, inner, signal)
        sessionToDispose = answer.session
      } else if (directory) {
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
        namespaceSource = artifactNamespaceSourceFromVfsMount(mount)
        const result = await (options.openNamespaceSubject ?? openSubject)({
          inventory: options.services.inventory,
          source: namespaceSource,
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
          ...(options.services.contributionSettings === undefined
            ? {}
            : { contributionSettings: options.services.contributionSettings }),
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
        // A container file reaches its mod's resources too, as any file opened by path does.
        const assetOrigins = await options.assetOriginsFor?.(container)
        const opener = createPathSubjectOpener({
          subjects: options.services,
          roots,
          grant: options.grant,
          budget: options.budget,
          ...(assetOrigins === undefined || assetOrigins.length === 0 ? {} : { assetOrigins }),
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
          context: {
            state: answer.snapshot.state,
            // Keep the actual resolver explanations with the typed refusal. The workbench can
            // then distinguish an attempted codec from a caller-supplied family label without
            // widening ordinary directory subjects or retrying an unsafe source.
            attemptedCandidates: answer.snapshot.candidates,
            diagnostics: answer.snapshot.diagnostics,
          },
        })
      }
      const session = answer.session
      const descriptor = await session.descriptor()
      const identity = 'identity' in descriptor ? descriptor.identity : undefined
      const directoryFormatId = identity?.formatId
      if (directory && directoryFormatId !== DIRECTORY_CONTAINER_FORMAT) {
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
      const extract = findArchiveExtractOperation(descriptor.operations)
      if (extract === undefined) {
        throw new ModkitError({
          code: NOT_A_CONTAINER,
          message:
            'this container publishes no available container.extract, so its entries cannot be read',
          context: { operations: descriptor.operations.map(item => item.id) },
        })
      }
      const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
      let keepNamespaceLease = false
      try {
        const namespace = lease.value as NamespaceEntrySource
        if (directory && namespace.children !== undefined) {
          const root = await listImmediateChildren(namespace, '', signal)
          const rootItems = [...root.items].sort((left, right) => {
            const rank = (name: string): number =>
              name.toLowerCase() === 'mods' ? 0 : name.toLowerCase() === 'campaigns' ? 1 : 2
            return rank(left.name) - rank(right.name) || left.name.localeCompare(right.name)
          })
          if (root.capped) {
            options.onDiagnostic?.({
              code: 'x3.app/vscode-container-listing-capped',
              severity: 'warning',
              message:
                `the root listing stopped after ${MAXIMUM_PAGES} pages ` +
                `(${rootItems.length} entries); later children are not shown`,
            })
          }
          const holder: HeldContainer = {
            session,
            operations: session.operations(),
            extractHandlerId: extract.handlerId,
            namespace,
            releaseNamespace: () => lease.release(),
            ...(namespaceSource === undefined ? {} : { namespaceSource }),
            index: buildContainerIndex(
              rootItems.map(item => ({
                id: item.entryId ?? item.name,
                path: item.name,
                name: item.name,
                kind: item.kind,
                ...(item.size === undefined ? {} : { size: BigInt(item.size) }),
                ...(item.modifiedAt === undefined ? {} : { modifiedAt: item.modifiedAt }),
              })),
            ),
            hierarchical: true,
            directoryChildren: new Map([['', Promise.resolve(Object.freeze(rootItems))]]),
            releaseSource,
            selectedRoute: Object.freeze([...(answer.snapshot.selectedRoute ?? [])]),
            capped: root.capped,
            directPathEntryIds: true,
            retainers: 0,
            releaseRequested: false,
          }
          keepNamespaceLease = true
          sessionToDispose = undefined
          return holder
        }
        const entries: NamespaceEntry[] = []
        let cursor: string | undefined
        let pages = 0
        do {
          const page = await namespace.list(
            '',
            cursor === undefined
              ? { limit: PAGE_LIMIT, includeHidden: true }
              : { cursor, limit: PAGE_LIMIT, includeHidden: true },
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
          operations: session.operations(),
          extractHandlerId: extract.handlerId,
          namespace,
          releaseNamespace: () => lease.release(),
          ...(namespaceSource === undefined ? {} : { namespaceSource }),
          index: buildContainerIndex(entries),
          hierarchical: false,
          directoryChildren: new Map(),
          releaseSource,
          selectedRoute: Object.freeze([...(answer.snapshot.selectedRoute ?? [])]),
          capped,
          directPathEntryIds: directory,
          retainers: 0,
          releaseRequested: false,
        }
        keepNamespaceLease = true
        sessionToDispose = undefined
        return holder
      } finally {
        if (!keepNamespaceLease) await lease.release()
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
    const key = keyOf(container)
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
        await holder.releaseNamespace()
      } finally {
        try {
          await holder.session.dispose()
        } finally {
          await holder.releaseSource()
        }
      }
    })()
    await holder.disposal
  }

  const releaseRetainer = async (holder: HeldContainer): Promise<void> => {
    if (holder.retainers <= 0) return
    holder.retainers -= 1
    if (holder.retainers === 0 && holder.releaseRequested) await requestHolderDisposal(holder)
  }

  const retainedChildSession = (
    holder: HeldContainer,
    child: AssetSession,
    releaseResources: () => Promise<void> = async () => undefined,
  ): AssetSession => {
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
          try {
            await releaseResources()
          } finally {
            await releaseRetainer(holder)
          }
        }
      },
    }
  }

  const release = async (container: string): Promise<boolean> => {
    const key = keyOf(container)
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
      if (holder.directPathEntryIds) return normalizeEntryPath(entry)
      const namespace = holder.namespace
      const requested = entry.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase()
      const page = await namespace.list(entry, { limit: PAGE_LIMIT, includeHidden: true }, signal)
      const exact = page.items.find(
        item =>
          item.kind === 'file' &&
          item.path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase() === requested,
      )
      if (exact !== undefined) return exact.id
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

  const hierarchicalChildren = async (
    holder: HeldContainer,
    path: string,
    signal?: AbortSignal,
  ): Promise<readonly ContainerNode[]> => {
    const normalized = normalizeEntryPath(path)
    const key = normalized.toLowerCase()
    const known = holder.directoryChildren.get(key)
    if (known !== undefined) return known
    const loading = (async () => {
      const result = await listImmediateChildren(holder.namespace, normalized, signal)
      if (result.capped) {
        options.onDiagnostic?.({
          code: 'x3.app/vscode-container-listing-capped',
          severity: 'warning',
          message:
            `the directory «${normalized}» stopped after ${MAXIMUM_PAGES} pages ` +
            `(${result.items.length} entries); later children are not shown`,
        })
      }
      return result.items
    })()
    holder.directoryChildren.set(key, loading)
    try {
      return await loading
    } catch (error) {
      if (holder.directoryChildren.get(key) === loading) holder.directoryChildren.delete(key)
      throw error
    }
  }

  const prepared = (opened: OpenedSubject, signal?: AbortSignal): Promise<OpenedSubject> =>
    options.prepareOpened === undefined
      ? Promise.resolve(opened)
      : options.prepareOpened({
          opened,
          grant: writeGrant(),
          budget: options.budget,
          ...(signal === undefined ? {} : { signal }),
        })

  /** What preparing added to a member's diagnostics (a map's world that could not be built). */
  const addedDiagnostics = (before: OpenedSubject, after: OpenedSubject) =>
    after.diagnostics.slice(before.diagnostics.length).map(item => ({
      code: item.code,
      message: item.message,
      severity: item.severity,
    }))

  /**
   * One member of a held container, opened as a subject in its own right — the parent's retainer
   * is the caller's to take and give back.
   */
  const openMember = async (
    holder: HeldContainer,
    container: string,
    entry: string,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<SubjectOpener>>> => {
    const diagnostics: Diagnostic[] = []
    const entryId = await entryIdOf(holder, container, entry, signal)
    const { file, members } = splitContainer(container)
    const assetOrigins = await options.assetOriginsFor?.(
      [file.replace(/[\\/]+$/u, ''), ...members, entry].filter(Boolean).join('/'),
    )
    const nested = await openNestedSubject({
      parent: holder.session,
      entryId,
      ...nestedSubjectServices(options.services),
      ...(assetOrigins === undefined || assetOrigins.length === 0 ? {} : { assetOrigins }),
      /*
       * A member may plan its own edits: `write-source` lets its codec's mutating operations
       * run. They only return plans; the host commits them back through `edit`.
       */
      grant: writeGrant(),
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
    const opened = await prepared(nested.result, signal)
    const snapshot = subjectOpenSnapshot({
      result: opened,
      sessionId: () => `container:${randomUUID()}`,
      diagnostics: [...carried, ...addedDiagnostics(nested.result, opened)],
    })
    const selectedRoute = Object.freeze([
      ...holder.selectedRoute,
      ...(snapshot.selectedRoute ?? []),
    ])
    return {
      snapshot: selectedRoute.length === 0 ? snapshot : { ...snapshot, selectedRoute },
      session: opened.session,
      // the port a member's textures are read through, as a file's are (v85: Earth .kfr in a WD)
      ...(opened.rasterResources === undefined ? {} : { rasterResources: opened.rasterResources }),
    }
  }

  /**
   * Open a directory subtree as a namespace subject. An SC2Mod inside CASC must keep its package
   * root: its codec reads DocumentInfo, ComponentList and companions relative to this source.
   */
  const openDirectory = async (
    holder: HeldContainer,
    entry: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly answer: Awaited<ReturnType<SubjectOpener>>
    readonly releaseResources: () => Promise<void>
  }> => {
    const root = holder.namespaceSource
    if (root === undefined) {
      throw new ModkitError({
        code: NOT_A_CONTAINER,
        message: 'this container cannot open directory members as namespace subjects',
        context: { entry },
      })
    }
    const composition = await createContainerNamespaceComposition({
      parent: holder.session,
      root: root.ref,
      revision: root.revision,
      budget: options.budget,
      ...(signal === undefined ? {} : { signal }),
    })
    const rootLease = await composition.source.openNamespace(signal)
    let subtreeLease: Lease<ArtifactSource> | undefined
    let released = false
    const releaseResources = async (): Promise<void> => {
      if (released) return
      released = true
      let firstError: unknown
      try {
        await subtreeLease?.release()
      } catch (error) {
        firstError = error
      }
      try {
        await rootLease.release()
      } catch (error) {
        firstError ??= error
      }
      try {
        await composition.dispose()
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
    }
    try {
      const openedSubtree = await rootLease.value.open(normalizeEntryPath(entry), signal)
      subtreeLease = openedSubtree
      if (openedSubtree.value.kind !== 'namespace') {
        throw new ModkitError({
          code: CONTAINER_ENTRY_NOT_FOUND,
          message: `«${entry}» is not a directory inside this container`,
          context: { entry },
        })
      }
      const result = await (options.openNamespaceSubject ?? openSubject)({
        inventory: options.services.inventory,
        source: openedSubtree.value,
        path: entry,
        intent: 'full',
        target: options.services.target,
        grant: writeGrant(),
        budget: options.budget,
        executionBackends: options.services.executionBackends,
        ...(options.services.serviceDefinitions === undefined
          ? {}
          : { serviceDefinitions: options.services.serviceDefinitions }),
        ...(options.services.contributionSettings === undefined
          ? {}
          : { contributionSettings: options.services.contributionSettings }),
        ...(signal === undefined ? {} : { signal }),
      })
      const diagnostics = result.diagnostics.map(item => ({
        code: item.code,
        message: item.message,
        severity: item.severity,
      }))
      if (result.state === 'unresolved') {
        await releaseResources()
        return {
          answer: {
            snapshot: subjectOpenSnapshot({
              result,
              sessionId: () => '',
              diagnostics,
            }),
          },
          releaseResources: async () => undefined,
        }
      }
      const opened = await prepared(result, signal)
      const snapshot = subjectOpenSnapshot({
        result: opened,
        sessionId: () => `container-directory:${randomUUID()}`,
        diagnostics: [...diagnostics, ...addedDiagnostics(result, opened)],
      })
      const selectedRoute = Object.freeze([
        ...holder.selectedRoute,
        ...(snapshot.selectedRoute ?? []),
      ])
      return {
        answer: {
          snapshot: selectedRoute.length === 0 ? snapshot : { ...snapshot, selectedRoute },
          session: opened.session,
          // a package's card draws its pictures through it (an SC2 mod inside the game's storage)
          ...(opened.rasterResources === undefined
            ? {}
            : { rasterResources: opened.rasterResources }),
        },
        releaseResources,
      }
    } catch (error) {
      await releaseResources().catch(() => undefined)
      throw error
    }
  }

  const registry: ContainerRegistry = {
    async index(container, signal) {
      return (await holderFor(container, signal)).index
    },

    async list(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const children = holder.hierarchical
        ? await hierarchicalChildren(holder, entry, signal)
        : listContainerDirectory(holder.index, entry)
      if (children === undefined) {
        throw new ModkitError({
          code: CONTAINER_ENTRY_NOT_FOUND,
          message: `this container has no directory «${entry}»`,
          context: { entry, container },
        })
      }
      /*
       * The registry lists everything (`includeHidden: true`): its index answers exact lookups of a
       * hidden member too. What the Explorer shows follows the option.
       */
      return showHidden() ? children : children.filter(item => item.hidden !== true)
    },

    async walk(container, entry, maximum, signal) {
      if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 1_000_000) {
        throw new RangeError('container walk maximum must be within 1..1000000')
      }
      const holder = await holderFor(container, signal)
      const prefix = normalizeEntryPath(entry)
      const foldedPrefix = prefix.toLowerCase()
      const inside = (path: string): boolean => {
        const folded = normalizeEntryPath(path).toLowerCase()
        return (
          foldedPrefix === '' || folded === foldedPrefix || folded.startsWith(`${foldedPrefix}/`)
        )
      }
      const files: NamespaceEntry[] = []
      let cursor: string | undefined
      for (
        let pageNumber = 0;
        pageNumber < MAXIMUM_PAGES && files.length < maximum;
        pageNumber += 1
      ) {
        signal?.throwIfAborted()
        const page = await holder.namespace.list(
          prefix,
          cursor === undefined
            ? { limit: PAGE_LIMIT, includeHidden: true }
            : { cursor, limit: PAGE_LIMIT, includeHidden: true },
          signal,
        )
        const hiddenToo = showHidden()
        for (const item of page.items) {
          if (item.kind !== 'file' || !inside(item.path)) continue
          if (item.hidden === true && !hiddenToo) continue
          files.push(item)
          if (files.length >= maximum) break
        }
        cursor = page.nextCursor
        if (cursor === undefined) break
      }
      return Object.freeze(files)
    },

    async stat(container, entry, signal) {
      const holder = await holderFor(container, signal)
      const node = statContainerEntry(holder.index, entry)
      if (node !== undefined) return node

      if (holder.hierarchical) {
        const normalized = normalizeEntryPath(entry)
        const cut = normalized.lastIndexOf('/')
        const parent = cut === -1 ? '' : normalized.slice(0, cut)
        const name = cut === -1 ? normalized : normalized.slice(cut + 1)
        const child = (await hierarchicalChildren(holder, parent, signal)).find(
          item => item.name.toLowerCase() === name.toLowerCase(),
        )
        if (child !== undefined) return child
      }

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
      const invoked = await holder.operations.invoke(
        holder.extractHandlerId,
        { entryId },
        signal === undefined ? {} : { signal },
      )
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
      options.onExtract?.(
        Object.freeze({ container, entry, bytes: invoked.output.value.byteLength }),
      )
      return invoked.output.value
    },

    async search(container, query, signal) {
      return searchContainerIndex((await holderFor(container, signal)).index, query)
    },

    async refresh(container, signal) {
      await release(container)
      return (await holderFor(container, signal)).index
    },

    async write(container, entry, bytes, signal) {
      await registry.edit(container, { write: [{ entry, bytes }] }, signal)
    },

    async edit(container, change, signal) {
      const { file, members } = splitContainer(container)
      const roots = options.roots().map(root => resolve(root))
      if (roots.length === 0 || !insideGrantedRoots(roots, file)) {
        throw new TypeError('path is outside the granted roots')
      }
      const inner = members.at(-1)
      /*
       * The container that is packed: a file is opened afresh under `write-source`; a container
       * inside another is the held member session, which was opened with it.
       */
      let session: AssetSession
      let disposeSession = async (): Promise<void> => undefined
      if (inner === undefined) {
        const answer = await createPathSubjectOpener({
          subjects: options.services,
          roots,
          grant: writeGrant(),
          budget: options.budget,
        })(file, signal)
        if (answer.snapshot.state !== 'opened' || answer.session === undefined) {
          throw new ModkitError({ code: NOT_A_CONTAINER, message: 'the container did not open' })
        }
        const opened = answer.session
        session = opened
        disposeSession = () => opened.dispose()
      } else {
        session = (await holderFor(container, signal)).session
      }
      const backend = inner === undefined ? createFileEditingBackend({ roots }) : undefined
      try {
        const descriptor = await session.descriptor()
        if (!('identity' in descriptor)) throw new TypeError('the container did not open')
        if (!descriptor.operations.some(item => item.id === 'container.pack')) {
          throw new ModkitError({
            code: CONTAINER_NOT_WRITABLE,
            message: `${descriptor.identity.formatId.toUpperCase()} archives cannot be written back; save a copy instead`,
          })
        }
        const packed = await invokeContainerPack(
          { descriptor, session },
          packInput(descriptor.revision, await listAll(session, signal), change),
          signal === undefined ? {} : { signal },
        )
        if (packed.state !== 'ok') {
          throw new ModkitError({
            code: CONTAINER_NOT_WRITABLE,
            message: `the container refused the change: ${packed.reason}`,
          })
        }
        const plan = packed.output.plan
        const evidence = codecFidelityEvidenceRecords(options.services.inventory, {
          codecId: descriptor.identity.codecId,
          formatId: descriptor.identity.formatId,
        }).reduce((registry, record) => registry.with(record), createEvidenceRegistry())
        if (evidence.evidenceFor(plan) === undefined) {
          throw new ModkitError({
            code: CONTAINER_NOT_WRITABLE,
            message: `no fidelity evidence covers how ${descriptor.identity.formatId.toUpperCase()} repacks; save a copy instead`,
          })
        }
        if (inner !== undefined) {
          // The repacked inner container is one member of its parent: write it there, and so on
          // outwards until a file on disk takes the commit.
          const edit = plan.edits[0]
          if (
            plan.edits.length !== 1 ||
            edit?.operation !== 'replace' ||
            edit.range !== undefined ||
            edit.payload.kind !== 'inline'
          ) {
            throw new ModkitError({
              code: CONTAINER_NOT_WRITABLE,
              message: 'a nested container must repack into whole inline bytes',
            })
          }
          await registry.edit(
            joinContainer(file, members.slice(0, -1)),
            { write: [{ entry: inner, bytes: edit.payload.bytes }] },
            signal,
          )
          return
        }
        const editing = createSubjectEditing({
          opened: { state: 'opened', session, descriptor } as never,
          grant: writeGrant(),
          backendFor: () => backend,
          evidenceFor: item => evidence.evidenceFor(item),
        })
        const prepared = await editing.coordinator.prepare(plan, {
          grant: editing.grantSnapshot,
          ...(signal === undefined ? {} : { signal }),
        })
        if (prepared.state !== 'ready') {
          throw new ModkitError({
            code: CONTAINER_NOT_WRITABLE,
            message: `the write was refused: ${prepared.state === 'rejected' ? prepared.reason : 'the container changed on disk'}`,
          })
        }
        const committed = await editing.coordinator.commit(prepared.prepared, {
          grant: editing.grantSnapshot,
          ...(signal === undefined ? {} : { signal }),
        })
        if (committed.state !== 'committed') {
          throw new ModkitError({
            code: CONTAINER_NOT_WRITABLE,
            message: `the write did not complete (${committed.state})`,
          })
        }
      } finally {
        await backend?.dispose()
        await disposeSession()
      }
      // Every held listing of this file, and of every container inside it, describes old bytes.
      const root = keyOf(file)
      const stale = [...held.keys()]
        .filter(key => key === root || key.startsWith(`${root}${CONTAINER_SEPARATOR}`))
        .sort((left, right) => right.length - left.length)
      for (const key of stale) await release(key)
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
      // The exact-entry lookup below can suspend on the namespace provider. Retain before that
      // first await: a concurrent Explorer release must not dispose this parent/VFS mount while the
      // child open is still resolving its member id.
      holder.retainers += 1
      let childToDispose: AssetSession | undefined
      let retainerTransferredToChild = false
      let releaseResources = async (): Promise<void> => undefined
      try {
        const node = await registry.stat(location.container, location.entry, signal)
        const opened =
          node.kind === 'directory'
            ? await openDirectory(holder, location.entry, signal)
            : {
                answer: await openMember(holder, location.container, location.entry, signal),
                releaseResources: async () => undefined,
              }
        const answer = opened.answer
        releaseResources = opened.releaseResources
        if (answer.session === undefined) return answer
        childToDispose = answer.session
        const session = retainedChildSession(holder, answer.session, releaseResources)
        childToDispose = undefined
        releaseResources = async () => undefined
        retainerTransferredToChild = true
        return {
          snapshot: answer.snapshot,
          session,
          ...(answer.rasterResources === undefined
            ? {}
            : { rasterResources: answer.rasterResources }),
        }
      } catch (error) {
        await childToDispose?.dispose().catch(() => undefined)
        throw error
      } finally {
        if (!retainerTransferredToChild) {
          await releaseResources().catch(() => undefined)
          await releaseRetainer(holder)
        }
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

/** Whole-member payloads a container write accepts; the host's own inline cap covers the rest. */
const MAXIMUM_MEMBER_BYTES = 256 * 1024 * 1024

/**
 * The editing backend of one container member: a commit is the member's new bytes, packed back
 * into the container through `write`.
 *
 * Atomic, because a pack is a single replace of the container file, and a batch folds into that
 * one write. There is no rollback and no revision of its own: the member's revision is the
 * container's, which the pack itself re-reads and pins at write time.
 * ponytail: no conflict check between open and save beyond that pin; add a container stat
 * compare in `currentRevision` if two writers to one archive become a real case.
 */
export function containerMemberEditingBackend(
  registry: Pick<ContainerRegistry, 'read' | 'write'>,
  container: string,
  entry: string,
): EditingBackend {
  const nextBytes = async (
    edits: readonly SourceEdit[],
    payloads: PayloadStore,
    signal?: AbortSignal,
  ): Promise<Uint8Array> => {
    let bytes: Uint8Array | undefined
    for (const edit of edits) {
      if (edit.operation !== 'replace') {
        throw new TypeError(
          `a container member takes content replacements, not «${edit.operation}»`,
        )
      }
      bytes ??=
        edit.range === undefined ? new Uint8Array() : await registry.read(container, entry, signal)
      bytes = await replacedBytes(edit, bytes, payloads, MAXIMUM_MEMBER_BYTES, signal)
    }
    if (bytes === undefined) throw new TypeError('nothing to write')
    return bytes
  }
  return Object.freeze({
    profile: Object.freeze({
      backendId: 'vscode-container-member',
      guarantees: Object.freeze(['atomic'] as const),
      supportsPrepare: true,
      supportsRollback: false,
      supportsJournal: false,
      supportsRename: false,
    }),
    writable: true,
    async currentRevision(target: SubjectEditTarget) {
      return target.expectedRevision
    },
    async apply(edit, options) {
      await registry.write(
        container,
        entry,
        await nextBytes([edit], options.payloads, options.signal),
        options.signal,
      )
      return { after: options.expectedRevision }
    },
    async applyBatch(requests, options) {
      const bytes = await nextBytes(
        requests.map(request => request.edit),
        options.payloads,
        options.signal,
      )
      await registry.write(container, entry, bytes, options.signal)
      return requests.map(request => ({
        targetId: request.edit.targetId,
        after: request.expectedRevision,
      }))
    },
  } satisfies EditingBackend)
}
