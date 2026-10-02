import {
  compareUtf8,
  diagnostic,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import type { LanguageWorkspaceSemanticInput } from '@modkit/sdk/language'
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
  ContentSources,
} from '@modkit/vfs/content-sources'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from './language/workspace.js'
import { languageWorkspaceContextToken } from './language/context.js'
import { artifactByteSourceFromBytes } from './source-bridge.js'
import { classifyLanguageFile } from './language/workspace.js'
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
  readonly maxEntries?: number
}

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

function relativeEntry(mount: IndexedMount, entry: ContentSourceEntry): string | undefined {
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
 */
export function createContentDependencyLanguageDocumentSource(
  options: ContentDependencyLanguageDocumentSourceOptions,
): LanguageWorkspaceDocumentSource {
  const mounts = validateMounts(options.resolution)
  const maxDocumentBytes = options.maxDocumentBytes ?? 4_194_304
  const maxWorkspaceBytes = options.maxWorkspaceBytes ?? 16_777_216
  const maxEntries = options.maxEntries ?? 16_384
  for (const [name, value] of Object.entries({ maxDocumentBytes, maxWorkspaceBytes, maxEntries })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`)
  }
  if (maxDocumentBytes > maxWorkspaceBytes) {
    throw new TypeError('maxDocumentBytes cannot exceed maxWorkspaceBytes')
  }
  const revisions = new Map<string, { readonly signature: string; readonly version: number }>()
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
  return Object.freeze({
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      request.signal.throwIfAborted()
      const accepted = new Set(request.workspaceLanguageIds)
      const openUris = new Set(request.workspaceDocuments.map(document => document.uri))
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
      let visited = 0
      // Without a provider-authored content fingerprint, bytes may change while the mount identity
      // stays the same. Keep the documents usable, but never claim a complete/stable semantic
      // snapshot that could be cached or globally renamed.
      let complete =
        options.resolution.complete &&
        mounts.every(mount => mount.fingerprint !== undefined && isRevisionId(mount.fingerprint))
      let pathIndexComplete = options.resolution.complete
      const walk = async (mount: IndexedMount, path: string): Promise<void> => {
        if (visited > maxEntries) return
        request.signal.throwIfAborted()
        let entries: readonly ContentSourceEntry[]
        try {
          entries = await options.contentSources.list(mount.sourceId, path)
        } catch {
          complete = false
          pathIndexComplete = false
          return
        }
        for (const entry of entries) {
          request.signal.throwIfAborted()
          visited += 1
          if (visited > maxEntries) {
            complete = false
            pathIndexComplete = false
            return
          }
          const relative = relativeEntry(mount, entry)
          if (relative === undefined) {
            complete = false
            pathIndexComplete = false
            continue
          }
          if (entry.directory) {
            await walk(mount, entry.path)
            continue
          }
          contentPaths.set(relative, mounts.indexOf(mount))
          if (path === mount.sourcePath && wantedKnowledge.has(relative.toLowerCase())) {
            knowledge.push({ mount, path: entry.path, fileName: relative })
            continue
          }
          const { languageId, candidates: claimants } = classifyLanguageFile(
            options.routes,
            relative,
          )
          if (languageId === undefined) {
            if (claimants.some(id => accepted.has(id))) complete = false
            continue
          }
          if (!accepted.has(languageId)) continue
          const uri = contentSourceUri(mount.sourceId, entry.path)
          if (!openUris.has(uri) && candidates.length < request.maxDocuments) {
            candidates.push({ mount, path: entry.path, relative })
          } else if (!openUris.has(uri)) {
            complete = false
          }
        }
      }
      for (const mount of mounts) {
        if (visited > maxEntries) break
        await walk(mount, mount.sourcePath)
      }
      const indexedPaths = Object.freeze([...contentPaths.keys()].sort(compareUtf8))
      const pathLayers = Object.freeze(indexedPaths.map(path => contentPaths.get(path)!))
      const pathIndexRevision = languageWorkspaceContextToken({
        contextRevision,
        complete: pathIndexComplete,
        paths: indexedPaths,
        layers: pathLayers,
      })
      const documents = []
      const documentOrigins = []
      let totalBytes = 0
      for (const candidate of candidates.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const { languageId: classified, dialect } = classifyLanguageFile(
          options.routes,
          candidate.relative,
        )
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
        const signature = String(candidate.mount.revision)
        const previous = revisions.get(uri)
        const version =
          previous === undefined
            ? 1
            : previous.signature === signature
              ? previous.version
              : previous.version + 1
        revisions.set(uri, { signature, version })
        documents.push(
          Object.freeze({
            uri,
            languageId,
            version,
            text,
            ...(dialect === undefined ? {} : { dialect }),
          }),
        )
        documentOrigins.push(
          Object.freeze({
            uri,
            layerId: `${contextId}:${candidate.mount.order}:${candidate.mount.dependencyId}`,
            logicalId: candidate.relative,
            precedence: candidate.mount.order,
            sourceRevision: String(candidate.mount.revision),
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
        workspaceContext: Object.freeze({
          id: contextId,
          revision: contextRevision,
          semanticComplete: complete,
          documentOrigins: Object.freeze(documentOrigins),
          semanticInputs: Object.freeze([
            ...(knowledgeInputs as LanguageWorkspaceSemanticInput[]),
            Object.freeze({
              kind: 'dependency-closure',
              id: `${options.resolution.gameId}:${contextId}`,
              revision: contextRevision,
              // Where each layer's files live: a file `path` of layer `layerId` is
              // `content-source://<sourceId>/<sourcePath>/<path>`, open or not (weaker first).
              payload: Object.freeze({
                schemaVersion: 1,
                layers: Object.freeze(
                  mounts.map(mount =>
                    Object.freeze({
                      layerId: `${contextId}:${mount.order}:${mount.dependencyId}`,
                      sourceId: mount.sourceId,
                      sourcePath: mount.sourcePath,
                    }),
                  ),
                ),
              }),
            }),
            Object.freeze({
              kind: 'content-path-index',
              id: `${options.resolution.gameId}:${contextId}`,
              revision: pathIndexRevision,
              payload: Object.freeze({
                schemaVersion: 1,
                isComplete: pathIndexComplete,
                paths: indexedPaths,
                // the dependency-closure layer each path is read from (its strongest)
                layers: pathLayers,
              }),
            }),
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
