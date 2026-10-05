/**
 * Host adapters over provider-resolved dependency mounts: virtual source identity, read-only
 * companion origins, bounded language documents, knowledge inputs and complete path/layer indexes.
 * Access goes through ContentSources for loose and packed storage; no game parser or native writer
 * lives here. Mount bounds, routes and revisions are preserved, current listings/bytes are checked
 * on each language snapshot, and retained immutable captures share the source's byte allowance.
 */
import {
  compareUtf8,
  diagnostic,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import type {
  LanguageDocument,
  LanguageWorkspaceDocumentOrigin,
  LanguageWorkspaceSemanticInput,
} from '@modkit/sdk/language'
import {
  isRevisionId,
  revisionId,
  revisionIdFromRef,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type ModWorkspaceDiagnostic,
  type RevisionId,
} from '@modkit/sdk'
import type {
  ContentDependencyMount,
  ContentDependencyResolution,
  ContentSourceEntry,
  ContentSourceFilesPage,
  ContentSources,
} from '@modkit/vfs/content-sources'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from './language/workspace.js'
import {
  contentPathIndexSemanticInputs,
  createLanguageFileClassifier,
  languageDocumentSnapshot,
  languageDocumentTextToken,
  languageWorkspaceContextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './language/index.js'
import { artifactByteSourceFromBytes } from './source-bridge.js'
import {
  normalizeCompanionLogicalId,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
  type CompanionOriginEntry,
} from './input-resolution.js'

const DEPENDENCY_SCOPE = Object.freeze(['workspace-dependency-layer'] as const)
/** A language-knowledge file (an API dump) and all of them together; beyond this, a status, not a cut. */
const KNOWLEDGE_FILE_MAX_BYTES = 8 * 1024 * 1024
const KNOWLEDGE_TOTAL_MAX_BYTES = 32 * 1024 * 1024

export interface ContentDependencyLanguageDocumentSourceOptions {
  readonly contentSources: ContentSources
  readonly resolution: ContentDependencyResolution
  readonly routes: readonly LanguageProviderRoute[]
  readonly maxDocumentBytes?: number
  readonly maxWorkspaceBytes?: number
  /** Files of the workspace's languages one snapshot considers (default 16 384). */
  readonly maxEntries?: number
  /**
   * Files of all layers the path index holds (default 1 048 576): every texture and model counts,
   * Liberty alone has some 180 000; past it the index and the snapshot are incomplete.
   */
  readonly maxIndexedPaths?: number
}

/** Files one page of a layer's bulk listing asks for. */
const FILES_PAGE = 4096

interface IndexedMount extends ContentDependencyMount {
  readonly rootId: string
  readonly logicalPrefix: string
  readonly revision: RevisionId
}

function nonEmpty(value: string, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${name} must be a bounded non-empty string`)
  }
  return value
}

function normalizeOpaquePath(value: string): string {
  return value === '' ? '' : normalizeCompanionLogicalId(value)
}

function joinPath(prefix: string, path: string): string {
  return prefix === '' ? path : path === '' ? prefix : `${prefix}/${path}`
}

function relativeEntry(mount: IndexedMount, entry: { readonly path: string }): string | undefined {
  const path = normalizeOpaquePath(entry.path)
  if (mount.sourcePath === '') return path
  const prefix = `${mount.sourcePath}/`
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : undefined
}

/**
 * Where a dependency file lives: `content-source://<sourceId>/<path in the source>`, so a link to it
 * opens the file itself (the layer's own path, not the closure's synthetic `content-dependencies/N`).
 */
/** The URI of a path of a content source, as documents and companions name it. */
export function contentSourceUri(sourceId: string, path: string): string {
  return `content-source://${encodeURIComponent(sourceId)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function entryRevision(mount: ContentDependencyMount): RevisionId {
  return mount.fingerprint !== undefined && isRevisionId(mount.fingerprint)
    ? revisionId(mount.fingerprint)
    : revisionIdFromRef({
        kind: 'provider-token',
        value: `${mount.sourceId}\0${mount.sourcePath}\0${mount.dependencyId}`,
      })
}

function validateMounts(resolution: ContentDependencyResolution): readonly IndexedMount[] {
  if (resolution.schemaVersion !== 1 || !nonEmpty(resolution.gameId, 'gameId')) {
    throw new TypeError('invalid content dependency resolution')
  }
  if (
    !Array.isArray(resolution.mounts) ||
    resolution.mounts.length === 0 ||
    resolution.mounts.length > 256
  ) {
    throw new TypeError('content dependency workspace requires 1..256 resolved mounts')
  }
  const ids = new Set<string>()
  const roots = resolution.mounts.map((mount, index) => {
    const dependencyId = nonEmpty(mount.dependencyId, `mount ${index} dependencyId`)
    if (ids.has(dependencyId) || !Number.isSafeInteger(mount.order) || mount.order < 0) {
      throw new TypeError(`invalid content dependency mount ${index}`)
    }
    ids.add(dependencyId)
    return Object.freeze({
      ...mount,
      dependencyId,
      sourceId: nonEmpty(mount.sourceId, `mount ${index} sourceId`),
      sourcePath: normalizeOpaquePath(mount.sourcePath),
      displayName: nonEmpty(mount.displayName, `mount ${index} displayName`),
      kind: nonEmpty(mount.kind, `mount ${index} kind`),
      rootId: `content-dependency:${dependencyId}`,
      logicalPrefix: '',
      revision: entryRevision(mount),
    })
  })
  roots.sort((left, right) => left.order - right.order)
  return Object.freeze(
    roots.map((root, index) =>
      Object.freeze({
        ...root,
        logicalPrefix: `content-dependencies/${index}`,
      }),
    ),
  )
}

function workspaceDiagnostic(value: unknown): ModWorkspaceDiagnostic {
  const item =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : undefined
  const severity = item?.['severity']
  return Object.freeze({
    severity:
      severity === 'error' || severity === 'warning' || severity === 'information'
        ? severity
        : 'warning',
    code:
      typeof item?.['code'] === 'string' && item['code']
        ? item['code']
        : 'x3.host/content-dependency-diagnostic',
    message:
      typeof item?.['message'] === 'string' && item['message']
        ? item['message']
        : 'content dependency provider returned an unstructured diagnostic',
  })
}

export function contentDependencyDiagnostics(values: readonly unknown[]): readonly Diagnostic[] {
  return Object.freeze(
    values.map(value => {
      const item = workspaceDiagnostic(value)
      return diagnostic(item.severity, item.code, item.message)
    }),
  )
}

function createContentDependencyOrigin(
  contentSources: ContentSources,
  mounts: readonly IndexedMount[],
  maximumEntryBytes: number,
): CompanionOrigin {
  const overlay = Object.freeze([...mounts].reverse())
  const locations = new Map<string, IndexedMount>()
  const fold = (value: string) => value.toLowerCase()
  const relativeRequest = (mount: IndexedMount, logicalId: string): string | undefined => {
    if (logicalId === '') return ''
    if (fold(logicalId) === fold(mount.logicalPrefix)) return ''
    const prefix = `${mount.logicalPrefix}/`
    return fold(logicalId).startsWith(fold(prefix)) ? logicalId.slice(prefix.length) : undefined
  }
  const findEntries = async (
    mount: IndexedMount,
    logicalPrefix: string,
    signal?: AbortSignal,
  ): Promise<readonly CompanionOriginEntry[]> => {
    throwIfAborted(signal)
    const relativePrefix = relativeRequest(mount, logicalPrefix)
    if (relativePrefix === undefined) return Object.freeze([])
    const parent = relativePrefix.slice(0, relativePrefix.lastIndexOf('/') + 1).replace(/\/$/u, '')
    let entries: readonly ContentSourceEntry[]
    if (relativePrefix === '' && contentSources.files !== undefined) {
      const files: ContentSourceEntry[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        throwIfAborted(signal)
        const page = await contentSources.files(mount.sourceId, mount.sourcePath, {
          limit: FILES_PAGE,
          ...(cursor === undefined ? {} : { cursor }),
        })
        if (page === undefined) {
          if (cursor !== undefined)
            throw new TypeError('content files paging stopped before completion')
          files.push(...(await contentSources.list(mount.sourceId, mount.sourcePath)))
          break
        }
        if (files.length + page.items.length > 1_048_576)
          throw new RangeError('content companion namespace exceeds 1048576 files')
        for (const file of page.items)
          files.push({
            ...file,
            name: file.path.slice(file.path.lastIndexOf('/') + 1),
            directory: false,
          })
        cursor = page.nextCursor
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new TypeError('content files paging repeated a cursor')
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
      entries = files
    } else
      try {
        entries = await contentSources.list(mount.sourceId, joinPath(mount.sourcePath, parent))
      } catch {
        return Object.freeze([])
      }
    const output: CompanionOriginEntry[] = []
    for (const entry of entries) {
      throwIfAborted(signal)
      if (entry.directory) continue
      const relative = relativeEntry(mount, entry)
      if (relative === undefined || !fold(relative).startsWith(fold(relativePrefix))) continue
      const logicalId = joinPath(mount.logicalPrefix, relative)
      locations.set(fold(logicalId), mount)
      output.push(
        Object.freeze({
          logicalId,
          ...(entry.size === undefined ? {} : { size: BigInt(entry.size) }),
        }),
      )
    }
    return Object.freeze(output)
  }
  return Object.freeze({
    primaryLogicalId: '__content_dependency_workspace__',
    caseSensitivity: 'insensitive',
    scopes: DEPENDENCY_SCOPE,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ) {
      if (scope !== 'workspace-dependency-layer') return
      // a prefix ending in `/` is a folder to list (`tileset/` of `tileset/*.cv5`), not a name in
      // its parent; normalizing drops that slash, so it is put back
      const prefix =
        enumeration.prefix === ''
          ? ''
          : `${normalizeCompanionLogicalId(enumeration.prefix)}${enumeration.prefix.endsWith('/') ? '/' : ''}`
      const emitted = new Set<string>()
      for (const mount of overlay) {
        const rootScoped = relativeRequest(mount, prefix) !== undefined
        const query = rootScoped ? prefix : joinPath(mount.logicalPrefix, prefix)
        for (const found of await findEntries(mount, query, signal)) {
          // A path that names no layer is a lookup through the overlay, as ModContext.locate does:
          // it is answered in the caller's spelling, by the strongest layer that holds it.
          const entry = rootScoped
            ? found
            : Object.freeze({
                ...found,
                logicalId: found.logicalId.slice(mount.logicalPrefix.length + 1),
              })
          const key = fold(entry.logicalId)
          if (emitted.has(key)) continue
          emitted.add(key)
          if (!rootScoped) locations.set(key, mount)
          yield entry
        }
      }
    },
    async open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(signal)
      const normalized = normalizeCompanionLogicalId(logicalId)
      // A layer-qualified id names its layer; any other path is relative to every layer (overlay).
      const qualifiedIn = (candidate: IndexedMount) =>
        relativeRequest(candidate, normalized) === undefined
          ? joinPath(candidate.logicalPrefix, normalized)
          : normalized
      let mount = locations.get(fold(normalized))
      // the exact path first: a source that fetches on demand names an asset no listing holds yet
      if (mount === undefined && contentSources.lookup !== undefined) {
        for (const candidate of overlay) {
          const relative = relativeRequest(candidate, qualifiedIn(candidate))
          if (relative === undefined || relative === '') continue
          const entry = await contentSources
            .lookup(candidate.sourceId, joinPath(candidate.sourcePath, relative))
            .catch(() => undefined)
          throwIfAborted(signal)
          if (entry !== undefined && !entry.directory) {
            mount = candidate
            break
          }
        }
      }
      if (mount === undefined) {
        for (const candidate of overlay) {
          const qualified = qualifiedIn(candidate)
          const found = await findEntries(candidate, qualified, signal)
          if (found.some(entry => fold(entry.logicalId) === fold(qualified))) {
            mount = candidate
            break
          }
        }
      }
      if (mount === undefined) throw new RangeError(`content dependency has no entry ${normalized}`)
      const relative = relativeRequest(mount, qualifiedIn(mount))
      if (relative === undefined || relative === '')
        throw new RangeError(`content dependency has no file ${normalized}`)
      const bytes = await contentSources.read(
        mount.sourceId,
        joinPath(mount.sourcePath, relative),
        maximumEntryBytes,
      )
      const uri = contentSourceUri(mount.sourceId, joinPath(mount.sourcePath, relative))
      const source = artifactByteSourceFromBytes(
        Object.freeze({ id: `${mount.rootId}:${normalized}`, uri }),
        mount.revision,
        bytes,
      )
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}

/**
 * Project a provider-resolved dependency closure into protocol-neutral language documents.
 *
 * The adapter only uses ContentSources, so loose directories, MPQ and CASC mounts share the same
 * path. Physical cache paths and credentials remain in the provider, while virtual URIs preserve
 * dependency load order and revision identity. Extension-only routing is admitted only when the
 * extension identifies one language across the whole active inventory.
 * Every snapshot lists current paths and reads current document bytes. One exact immutable path
 * capture may be retained alongside document captures within the aggregate retention allowance;
 * changed ownership, listing failures or completeness replace it without dropping any output.
 */
export function createContentDependencyLanguageDocumentSource(
  options: ContentDependencyLanguageDocumentSourceOptions,
): LanguageWorkspaceDocumentSource {
  const mounts = validateMounts(options.resolution)
  const classify = createLanguageFileClassifier(options.routes)
  const maxDocumentBytes = options.maxDocumentBytes ?? 4_194_304
  const maxWorkspaceBytes = options.maxWorkspaceBytes ?? 16_777_216
  const maxEntries = options.maxEntries ?? 16_384
  const maxIndexedPaths = options.maxIndexedPaths ?? 1_048_576
  for (const [name, value] of Object.entries({
    maxDocumentBytes,
    maxWorkspaceBytes,
    maxEntries,
    maxIndexedPaths,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`)
  }
  if (maxDocumentBytes > maxWorkspaceBytes) {
    throw new TypeError('maxDocumentBytes cannot exceed maxWorkspaceBytes')
  }
  const revisions = new Map<
    string,
    {
      readonly signature: string
      readonly version: number
      document?: LanguageDocument
      bytes: number
    }
  >()
  let retainedDocumentBytes = 0
  let retainedPathIndex:
    | Readonly<{
        paths: readonly string[]
        layers: readonly number[]
        complete: boolean
        inputs: readonly LanguageWorkspaceSemanticInput[]
        bytes: number
      }>
    | undefined
  /** Evict document captures until their bytes and the retained index fit the source allowance. */
  const trimDocumentCaptures = (): void => {
    for (const entry of revisions.values()) {
      if (retainedDocumentBytes <= maxWorkspaceBytes - (retainedPathIndex?.bytes ?? 0)) break
      retainedDocumentBytes -= entry.bytes
      entry.bytes = 0
      delete entry.document
    }
  }
  const contextId = languageWorkspaceContextToken({
    gameId: options.resolution.gameId,
    mounts: mounts.map(mount => ({
      dependencyId: mount.dependencyId,
      order: mount.order,
      kind: mount.kind,
    })),
  })
  const contextRevision = languageWorkspaceContextToken({
    contextId,
    complete: options.resolution.complete,
    mounts: mounts.map(mount => ({
      dependencyId: mount.dependencyId,
      order: mount.order,
      revision: mount.revision,
    })),
  })
  const closureInputs = validatedLanguageWorkspaceSemanticInputs([
    {
      kind: 'dependency-closure',
      id: `${options.resolution.gameId}:${contextId}`,
      revision: contextRevision,
      // Each listed path belongs to the strongest layer; the closure addresses every layer.
      payload: {
        schemaVersion: 1,
        layers: mounts.map(mount => ({
          layerId: `${contextId}:${mount.order}:${mount.dependencyId}`,
          sourceId: mount.sourceId,
          sourcePath: mount.sourcePath,
        })),
      },
    },
  ])
  return Object.freeze({
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      request.signal.throwIfAborted()
      const accepted = new Set(request.workspaceLanguageIds)
      const openDocuments = new Map(
        [...request.workspaceDocuments, request.document].map(document => [document.uri, document]),
      )
      const documentOrigins: LanguageWorkspaceDocumentOrigin[] = []
      const candidates: {
        readonly mount: IndexedMount
        readonly path: string
        readonly relative: string
      }[] = []
      // Each path with the strongest mount that lists it (mounts walk weaker first).
      const contentPaths = new Map<string, number>()
      // Knowledge files the provider asked for, at a layer's root, in layer order (weaker first).
      const wantedKnowledge = new Set(
        (request.knowledgeFileNames ?? []).map(name => name.toLowerCase()),
      )
      const knowledge: {
        readonly mount: IndexedMount
        readonly path: string
        readonly fileName: string
      }[] = []
      let claimed = 0
      let indexed = 0
      // Without a provider-authored content fingerprint, bytes may change while the mount identity
      // stays the same. Keep the documents usable, but never claim a complete/stable semantic
      // snapshot that could be cached or globally renamed.
      let complete =
        options.resolution.complete &&
        mounts.every(mount => mount.fingerprint !== undefined && isRevisionId(mount.fingerprint))
      let pathIndexComplete = options.resolution.complete
      /**
       * One file of a layer: into the path index, and a candidate document when a route of the
       * workspace's languages claims it. Only those count against `maxEntries` (a layer's textures
       * and models are most of its files); false once the path index is full.
       */
      const visit = (mount: IndexedMount, path: string): boolean => {
        indexed += 1
        if (indexed > maxIndexedPaths) {
          complete = false
          pathIndexComplete = false
          return false
        }
        const relative = relativeEntry(mount, { path })
        if (relative === undefined) {
          complete = false
          pathIndexComplete = false
          return true
        }
        contentPaths.set(relative, mounts.indexOf(mount))
        if (!relative.includes('/') && wantedKnowledge.has(relative.toLowerCase())) {
          knowledge.push({ mount, path, fileName: relative })
          return true
        }
        const { languageId, dialect, candidates: claimants } = classify(relative)
        if (languageId === undefined) {
          if (claimants.some(id => accepted.has(id))) complete = false
          return true
        }
        if (!accepted.has(languageId)) return true
        claimed += 1
        const uri = contentSourceUri(mount.sourceId, path)
        const open = openDocuments.get(uri)
        if (open !== undefined) {
          documentOrigins.push(
            Object.freeze({
              uri,
              layerId: `${contextId}:${mount.order}:${mount.dependencyId}`,
              logicalId: relative,
              precedence: mount.order,
              sourceRevision: languageWorkspaceContextToken({
                mountRevision: String(mount.revision),
                languageId,
                dialect,
                contentRevision: languageDocumentTextToken(open),
              }),
              readOnly: true,
            }),
          )
          return true
        }
        if (claimed <= maxEntries && candidates.length < request.maxDocuments)
          candidates.push({ mount, path, relative })
        else complete = false
        return true
      }
      /** A layer that cannot list its files in bulk, folder after folder. */
      const walk = async (mount: IndexedMount, path: string): Promise<boolean> => {
        request.signal.throwIfAborted()
        let entries: readonly ContentSourceEntry[]
        try {
          entries = await options.contentSources.list(mount.sourceId, path)
        } catch {
          complete = false
          pathIndexComplete = false
          return true
        }
        for (const entry of entries) {
          request.signal.throwIfAborted()
          if (!entry.directory) {
            if (!visit(mount, entry.path)) return false
          } else if (relativeEntry(mount, entry) === undefined) {
            complete = false
            pathIndexComplete = false
          } else if (!(await walk(mount, entry.path))) return false
        }
        return true
      }
      /** A layer's files in pages from the source's own index where it has one (CASC, folders). */
      const layer = async (mount: IndexedMount): Promise<boolean> => {
        let cursor: string | undefined
        do {
          request.signal.throwIfAborted()
          let page: ContentSourceFilesPage | undefined
          try {
            page = await options.contentSources.files?.(mount.sourceId, mount.sourcePath, {
              limit: FILES_PAGE,
              ...(cursor === undefined ? {} : { cursor }),
            })
          } catch {
            complete = false
            pathIndexComplete = false
            return true
          }
          if (page === undefined) {
            if (cursor === undefined) return walk(mount, mount.sourcePath)
            complete = false
            pathIndexComplete = false
            return true
          }
          for (const file of page.items) if (!visit(mount, file.path)) return false
          cursor = page.nextCursor
        } while (cursor !== undefined)
        return true
      }
      for (const mount of mounts) if (!(await layer(mount))) break
      let pathInputs = retainedPathIndex?.inputs
      if (
        retainedPathIndex === undefined ||
        retainedPathIndex.complete !== pathIndexComplete ||
        retainedPathIndex.paths.length !== contentPaths.size ||
        !retainedPathIndex.paths.every(
          (path, index) => contentPaths.get(path) === retainedPathIndex!.layers[index],
        )
      ) {
        const indexedPaths = Object.freeze([...contentPaths.keys()].sort(compareUtf8))
        const pathLayers = Object.freeze(indexedPaths.map(path => contentPaths.get(path)!))
        const pathIndexRevision = languageWorkspaceContextToken({
          contextRevision,
          complete: pathIndexComplete,
          paths: indexedPaths,
          layers: pathLayers,
        })
        pathInputs = contentPathIndexSemanticInputs({
          id: `${options.resolution.gameId}:${contextId}`,
          revision: pathIndexRevision,
          isComplete: pathIndexComplete,
          paths: indexedPaths,
          layers: pathLayers,
        })
        // Conservative string/array allowance includes both the comparison and captured arrays.
        const bytes =
          indexedPaths.reduce((total, path) => total + path.length * 2 + 32, 0) +
          pathInputs.length * 512
        retainedPathIndex =
          bytes <= maxWorkspaceBytes
            ? {
                paths: indexedPaths,
                layers: pathLayers,
                complete: pathIndexComplete,
                inputs: pathInputs,
                bytes,
              }
            : undefined
      }
      trimDocumentCaptures()
      const documents = []
      let totalBytes = 0
      for (const candidate of candidates.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const { languageId: classified, dialect } = classify(candidate.relative)
        const languageId = classified!
        let bytes: Uint8Array
        try {
          bytes = await options.contentSources.read(
            candidate.mount.sourceId,
            candidate.path,
            Math.min(maxDocumentBytes, maxWorkspaceBytes - totalBytes),
          )
        } catch {
          complete = false
          continue
        }
        if (
          bytes.byteLength > maxDocumentBytes ||
          totalBytes + bytes.byteLength > maxWorkspaceBytes
        ) {
          complete = false
          continue
        }
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          complete = false
          continue
        }
        totalBytes += bytes.byteLength
        const uri = contentSourceUri(candidate.mount.sourceId, candidate.path)
        const previous = revisions.get(uri)
        const captured =
          previous?.document?.text === text &&
          previous.document.languageId === languageId &&
          previous.document.dialect === dialect
            ? previous.document
            : languageDocumentSnapshot({
                uri,
                languageId,
                version: previous?.version ?? 1,
                text,
                ...(dialect === undefined ? {} : { dialect }),
              })
        const signature = languageWorkspaceContextToken({
          mountRevision: String(candidate.mount.revision),
          languageId,
          dialect,
          contentRevision: languageDocumentTextToken(captured),
        })
        const version =
          previous === undefined
            ? 1
            : previous.signature === signature
              ? previous.version
              : previous.version + 1
        const document =
          version === captured.version
            ? captured
            : languageDocumentSnapshot({ ...captured, version })
        const retainedBytes = Math.max(bytes.byteLength, text.length * 2)
        retainedDocumentBytes -= previous?.bytes ?? 0
        revisions.delete(uri)
        revisions.set(uri, { signature, version, document, bytes: retainedBytes })
        retainedDocumentBytes += retainedBytes
        // The existing revision metadata owns these immutable copies; retain no more than the
        // source's aggregate byte bound. Reads still check current bytes on every snapshot.
        trimDocumentCaptures()
        documents.push(document)
        documentOrigins.push(
          Object.freeze({
            uri,
            layerId: `${contextId}:${candidate.mount.order}:${candidate.mount.dependencyId}`,
            logicalId: candidate.relative,
            precedence: candidate.mount.order,
            sourceRevision: signature,
            readOnly: true,
          }),
        )
      }
      const knowledgeInputs: object[] = []
      let knowledgeBytes = 0
      for (const file of knowledge) {
        request.signal.throwIfAborted()
        const layerId = `${contextId}:${file.mount.order}:${file.mount.dependencyId}`
        const id = `${layerId}/${file.fileName}`
        const unavailable = (message: string) =>
          knowledgeInputs.push(
            Object.freeze({
              kind: 'semantic-context-status',
              id: `language-knowledge:${id}`,
              revision: languageWorkspaceContextToken({ id, message }),
              payload: Object.freeze({
                state: 'unavailable',
                requirement: 'language-knowledge',
                message,
              }),
            }),
          )
        let text: string
        try {
          const bytes = await options.contentSources.read(
            file.mount.sourceId,
            file.path,
            KNOWLEDGE_FILE_MAX_BYTES,
          )
          if (
            bytes.byteLength > KNOWLEDGE_FILE_MAX_BYTES ||
            knowledgeBytes + bytes.byteLength > KNOWLEDGE_TOTAL_MAX_BYTES
          ) {
            unavailable(
              `${file.fileName} exceeds the knowledge budget (8 MiB a file, 32 MiB in all)`,
            )
            continue
          }
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          knowledgeBytes += bytes.byteLength
        } catch (error) {
          if (isCancellation(error)) throw error
          unavailable(`${file.fileName} could not be read as UTF-8 within 8 MiB`)
          continue
        }
        knowledgeInputs.push(
          Object.freeze({
            kind: 'language-knowledge',
            id,
            revision: languageWorkspaceContextToken({ layer: String(file.mount.revision), text }),
            payload: Object.freeze({ fileName: file.fileName, layerId, text }),
          }),
        )
      }
      return Object.freeze({
        documents: Object.freeze(documents),
        isComplete: complete,
        scopeWorkspaceDocuments: true,
        workspaceContext: Object.freeze({
          id: contextId,
          revision: contextRevision,
          semanticComplete: complete,
          documentOrigins: Object.freeze(documentOrigins),
          semanticInputs: Object.freeze([
            ...(knowledgeInputs as LanguageWorkspaceSemanticInput[]),
            ...closureInputs,
            ...pathInputs!,
          ]),
        }),
      })
    },
  })
}

/** Bind provider-resolved content roots to a read-only workspace and revision-pinned resource port. */
/**
 * The resolved mounts of one dependency closure, as a place a subject's resources may be found.
 *
 * This is the same origin the resolved-Data workspace and the language sources read through — the
 * mod, then what the mod depends on, in the order the provider resolved them. Handed to a subject
 * open as an asset origin, it is what lets a model inside a mod reach a texture that the mod's
 * dependency carries, without any part of the host knowing which game or which folders those are.
 */
export function createContentDependencyAssetOrigin(options: {
  readonly contentSources: ContentSources
  readonly resolution: ContentDependencyResolution
  readonly maximumEntryBytes?: number
}): CompanionOrigin | undefined {
  const maximumEntryBytes = options.maximumEntryBytes ?? 64 * 1024 * 1024
  if (!Number.isSafeInteger(maximumEntryBytes) || maximumEntryBytes <= 0) {
    throw new TypeError('maximumEntryBytes must be a positive safe integer')
  }
  const mounts = validateMounts(options.resolution)
  // No mount is not an empty origin: an origin that serves a scope and answers nothing would make
  // "this provider resolved no layers" indistinguishable from "the layers hold no such file".
  if (mounts.length === 0) return undefined
  return createContentDependencyOrigin(options.contentSources, mounts, maximumEntryBytes)
}
