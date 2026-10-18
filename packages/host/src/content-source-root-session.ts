/**
 * A content-source root as a subject (§4.4 `storageOf`): an installation folder that a root of the
 * window's content sources reads opens as that root — browsed by its listing, its files extracted by
 * the root's own reader — instead of a second reader of the same storage through a folder codec.
 * `open <installation folder>` in the CLI and MCP then gives the tree VS Code mounts.
 */
import { CONTAINER_EXTRACT_OPERATION_ID, ModkitError } from '@modkit/core'
import {
  revisionIdFromRef,
  type AnyDescriptorWire,
  type AssetSession,
  type JsonValue,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type OperationDecl,
  type OperationOutput,
  type PermissionGrant,
  type ResourceBudget,
} from '@modkit/sdk'
import type {
  ContentSourceEntry,
  ContentSourceRoot,
  ContentSources,
} from '@modkit/vfs/content-sources'
import { contentSourceUri } from './content-dependencies.js'
import { assembleSubjectDescriptor, createAssetSession } from './session.js'
import { openContentSourceRange } from './content-source-range.js'

const NAMESPACE = 'common.view/namespace-entry-source'
const EXTRACT_HANDLER = 'x3.host/content-source-root-extract'
/** Files one page of a flat listing asks the source for. */
const FILES_PAGE = 1_000

const hostPath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
const sourcePath = (path: string): string => path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
const fold = (path: string): string => sourcePath(path).toLowerCase()

/** Whether `root` reads the storage of `directory` (a host path): its `storageOf`, without case. */
export function contentSourceRootServes(root: ContentSourceRoot, directory: string): boolean {
  return root.storageOf !== undefined && hostPath(root.storageOf) === hostPath(directory)
}

/** The root of `sources` that reads the storage of `directory` (a host path), if one does. */
export async function contentSourceRootServing(
  sources: Pick<ContentSources, 'snapshot'>,
  directory: string,
): Promise<ContentSourceRoot | undefined> {
  const snapshot = await sources.snapshot()
  return snapshot.roots.find(root => contentSourceRootServes(root, directory))
}

export interface ContentSourceRootSessionOptions {
  readonly sources: ContentSources
  readonly root: ContentSourceRoot
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  /** Hidden entries too (a client's "show hidden files"); a listing leaves them out by default. */
  readonly includeHidden?: boolean
}

/**
 * The root as a read-only container subject: `namespace-entry-source` (a flat listing of the files
 * under a prefix, a folder's children, a lookup by exact path) and `container.extract` reading one
 * file whole within the budget. Entry ids are the root's paths.
 */
export async function openContentSourceRootSession(
  options: ContentSourceRootSessionOptions,
): Promise<{
  readonly session: AssetSession
  readonly descriptor: Awaited<ReturnType<typeof assembleSubjectDescriptor>>
}> {
  const { sources, root, budget } = options
  const subjectUri = contentSourceUri(root.id, '')
  const revision = revisionIdFromRef({
    kind: 'provider-token',
    value: `${root.id}:${root.revision ?? '-'}`,
  })
  const hidden = options.includeHidden === true ? { includeHidden: true } : {}
  const entryOf = (
    path: string,
    kind: 'file' | 'directory',
    size?: number,
    rangeAccess?: true,
  ): NamespaceEntry =>
    Object.freeze({
      id: path,
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind,
      revision,
      ...(size === undefined ? {} : { size: BigInt(size) }),
      ...(rangeAccess === true && kind === 'file' ? { rangeAccess: true as const } : {}),
    })
  const fromListing = (item: ContentSourceEntry): NamespaceEntry =>
    entryOf(
      sourcePath(item.path),
      item.directory ? 'directory' : 'file',
      item.size,
      item.rangeAccess,
    )
  const page = <Item>(items: readonly Item[], cursor: string | undefined, limit: number) => {
    const start = cursor === undefined ? 0 : Number(cursor)
    if (!Number.isSafeInteger(start) || start < 0 || start > items.length)
      throw new RangeError('content source root cursor is invalid')
    const end = Math.min(items.length, start + limit)
    return Object.freeze({
      items: Object.freeze(items.slice(start, end)),
      ...(end < items.length ? { nextCursor: String(end) } : {}),
    })
  }
  /** Every file under a folder, walked by listings within the node budget. */
  const walk = async (folder: string, signal?: AbortSignal): Promise<NamespaceEntry[]> => {
    const files: NamespaceEntry[] = []
    const pending = [folder]
    while (pending.length > 0) {
      signal?.throwIfAborted()
      for (const item of await sources.list(root.id, pending.pop()!, hidden)) {
        if (item.directory) pending.push(item.path)
        else files.push(fromListing(item))
        if (files.length > budget.maxNodes)
          throw new RangeError(
            `${root.label} holds more than ${budget.maxNodes} files below ${folder}`,
          )
      }
    }
    return files
  }
  const namespace: NamespaceEntrySource = {
    async list(prefix, request, signal) {
      signal?.throwIfAborted()
      const folder = sourcePath(prefix)
      // the source pages its own flat listing where it can (a storage's name index)
      const files = await sources.files?.(root.id, folder, {
        limit: Math.min(request.limit, FILES_PAGE),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...hidden,
      })
      if (files !== undefined) {
        return Object.freeze({
          items: Object.freeze(
            files.items.map(file =>
              entryOf(sourcePath(file.path), 'file', file.size, file.rangeAccess),
            ),
          ),
          ...(files.nextCursor === undefined ? {} : { nextCursor: files.nextCursor }),
        })
      }
      return page(await walk(folder, signal), request.cursor, request.limit)
    },
    async children(path, request, signal) {
      signal?.throwIfAborted()
      const items = await sources.list(root.id, sourcePath(path), hidden)
      return page(items.map(fromListing), request.cursor, request.limit)
    },
    async lookup(path, signal) {
      signal?.throwIfAborted()
      const wanted = fold(path)
      const parent = wanted.includes('/')
        ? sourcePath(path).slice(0, sourcePath(path).lastIndexOf('/'))
        : ''
      // the hidden entries too: an exact path reads what a listing leaves out
      const items = await sources.list(root.id, parent, { includeHidden: true }).catch(() => [])
      const found = items.find(item => !item.directory && fold(item.path) === wanted)
      return found === undefined ? undefined : fromListing(found)
    },
    async openEntry(entryId) {
      const uri = contentSourceUri(root.id, sourcePath(entryId))
      return { value: Object.freeze({ id: uri, uri }), release: async () => undefined }
    },
    /** Preserve provider identity/context while retaining the native range through child lifetime. */
    async openEntryArtifactSource(entryId, signal) {
      signal?.throwIfAborted()
      const path = sourcePath(entryId)
      const uri = contentSourceUri(root.id, path)
      const range = await openContentSourceRange(
        sources,
        root.id,
        path,
        Object.freeze({ id: uri, uri }),
        signal,
      )
      if (range === undefined)
        throw new RangeError(`Content source entry ${entryId} does not support ranges`)
      return range
    },
    /** Legacy namespace clients keep the same ranged bytes and release the same retained lease. */
    async openEntrySource(entryId, signal) {
      const lease = await namespace.openEntryArtifactSource!(entryId, signal)
      return {
        value: {
          async size() {
            if (lease.value.size === undefined)
              throw new TypeError('Content source range has no size')
            return lease.value.size
          },
          read: lease.value.read.bind(lease.value),
        },
        release: lease.release,
      }
    },
  }
  const descriptor = await assembleSubjectDescriptor({
    schemaVersion: 2,
    subjectUri,
    origin: { kind: 'namespace', root: { id: subjectUri, uri: subjectUri }, revision },
    interpretation: 'none',
    candidates: [],
    traits: [{ id: 'container.directories', descriptorVersion: 1, state: 'available' }],
    operations: [
      {
        id: CONTAINER_EXTRACT_OPERATION_ID,
        handlerId: EXTRACT_HANDLER,
        state: 'available',
        mutatesSource: false,
      },
    ],
    constraints: { readOnly: true, seekable: false, randomAccess: true, trusted: false },
    dataSources: [{ contract: NAMESPACE, major: 1 }],
    diagnostics: [],
    revision,
  } as AnyDescriptorWire)
  // the descriptor's own operation, its id branded by the descriptor authority
  const declarations: OperationDecl[] = descriptor.operations.map(operation => ({
    id: operation.id,
    handlerId: operation.handlerId,
    mutatesSource: false,
    outputKinds: ['bytes'],
  }))
  const maxBytes = Number(
    budget.maxInputBytes > BigInt(Number.MAX_SAFE_INTEGER)
      ? BigInt(Number.MAX_SAFE_INTEGER)
      : budget.maxInputBytes,
  )
  const extract = async (input: JsonValue): Promise<OperationOutput> => {
    const entryId =
      typeof input === 'object' && input !== null && !Array.isArray(input)
        ? (input as Readonly<Record<string, JsonValue>>)['entryId']
        : undefined
    if (typeof entryId !== 'string' || entryId === '')
      throw new ModkitError({
        code: 'x3.host/content-source-root-entry-required',
        message: 'container.extract of a content-source root names its entry by path',
      })
    return { kind: 'bytes', value: await sources.read(root.id, sourcePath(entryId), maxBytes) }
  }
  const managed = createAssetSession({
    revision,
    descriptor,
    operationDeclarations: declarations,
    permissionGrant: options.grant,
    handlers: new Map([[EXTRACT_HANDLER, extract]]),
    async openDataSource(contract, major) {
      if (contract === NAMESPACE && major === 1)
        return { value: namespace, release: async () => undefined } as never
      throw new ModkitError({
        code: 'x3.host/content-source-root-data-source-unavailable',
        message: `a content-source root publishes no ${contract}@${String(major)}`,
      })
    },
  })
  return Object.freeze({ session: managed.session, descriptor })
}
