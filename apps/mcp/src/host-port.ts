import { createHash, randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  artifactNamespaceSourceFromVfsMount,
  contentDependencyDiagnostics,
  createContentDependencyLanguageDocumentSource,
  createKnowledgeCatalog,
  discoverServiceOperations,
  invokeServiceOperation,
  readOperationContentDependencies,
  openSubject,
  subjectOpenSnapshot,
  type Inventory,
  type ServiceOperationCatalog,
  type ServiceOperationInvocation,
  type SubjectEditing,
} from '@modkit/host'
import { discoverGameInstallations } from '@modkit/host/games'
import {
  createLanguageWorkspace,
  languageProviderRoutes,
  type LanguageWorkspace,
  type LanguageWorkspaceAnalysisResult,
  type LanguageWorkspaceCapability,
  type LanguageWorkspaceDocumentSource,
} from '@modkit/host/language'
import {
  createModkit,
  createNodeMapPreviewResourcePlanResolver,
  type ModkitOpened,
  workerBackendPolicy,
} from '@modkit/host/node'
import { sceneModule } from '@modkit/scene/module'
import { uvModule } from '@modkit/uv/module'
import { coordinateMapPreviewAssetSession } from '@modkit/host/maps'
import type {
  AnyDescriptor,
  AssetSession,
  JsonValue,
  KnowledgeCatalog,
  OperationSession,
} from '@modkit/sdk'
import { VirtualFileSystem } from '@modkit/vfs'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { loadContentSources } from '@modkit/vfs/content-sources/node'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import type { ModkitMcpConfiguration } from './config.js'

export interface McpOpenedSubject {
  readonly snapshot: ModkitOpened['snapshot']
  readonly session?: AssetSession
  /** Host-owned editing authority; never serialized into MCP responses. */
  readonly editing?: SubjectEditing
  readonly selectionCandidates?: readonly {
    readonly candidateId: string
    readonly displayName: string
    readonly sourcePath?: string
  }[]
  select?(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject>
  close(): Promise<void>
}

const MCP_LANGUAGE_MAX_DOCUMENT_BYTES = 4_194_304

async function readBoundedLanguageFile(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const handle = await open(path, 'r')
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size > MCP_LANGUAGE_MAX_DOCUMENT_BYTES) {
      throw new TypeError('language documents must be files no larger than 4 MiB')
    }
    const bytes = new Uint8Array(MCP_LANGUAGE_MAX_DOCUMENT_BYTES + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      signal?.throwIfAborted()
      const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (offset > MCP_LANGUAGE_MAX_DOCUMENT_BYTES) {
      throw new TypeError('language documents must be files no larger than 4 MiB')
    }
    return bytes.slice(0, offset)
  } finally {
    await handle.close()
  }
}

export interface McpDiscoveredSubject {
  readonly selectionId: string
  readonly gameId: string
  readonly displayName: string
  readonly openable: boolean
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
}

export interface McpDiscoveryResult {
  readonly snapshotId: string
  readonly complete: boolean
  readonly items: readonly McpDiscoveredSubject[]
  readonly diagnostics: readonly Diagnostic[]
}

export type McpLanguageFeature =
  | 'analyze'
  | 'completion'
  | 'hover'
  | 'signature-help'
  | 'definition'
  | 'references'
  | 'prepare-rename'
  | 'rename'
  | 'formatting'
  | 'code-actions'
  | 'document-colors'
  | 'color-presentations'
  | 'document-symbols'
  | 'workspace-symbols'
  | 'diagnostics'

export interface McpLanguageRequest {
  readonly documents: readonly {
    readonly path: string
    readonly languageId: string
    readonly documentKind?: string
  }[]
  readonly primaryIndex: number
  readonly feature: McpLanguageFeature
  readonly position?: { readonly line: number; readonly character: number }
  readonly includeDeclaration?: boolean
  readonly newName?: string
  readonly query?: string
  readonly formatting?: {
    readonly tabSize: number
    readonly insertSpaces: boolean
    readonly finalNewline?: boolean
  }
  readonly color?: {
    readonly red: number
    readonly green: number
    readonly blue: number
    readonly alpha: number
  }
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly languageDiagnostics?: readonly {
    readonly range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    }
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly message: string
    readonly code?: string
    readonly source?: string
  }[]
  readonly maxResults: number
  readonly maxEdits: number
}

export interface McpLanguageResult {
  readonly snapshotId: string
  readonly diagnostics: readonly Diagnostic[]
  readonly primaryUri: string
  readonly feature: McpLanguageFeature
  readonly result: unknown
}

export interface McpLanguageSessionDocument {
  readonly path?: string
  readonly uri?: string
  readonly languageId: string
  readonly documentKind?: string
  readonly text?: string
  readonly version?: number
}

export interface McpLanguageSessionOpenRequest {
  readonly documents: readonly McpLanguageSessionDocument[]
}

export interface McpLanguageSessionContext {
  readonly descriptor: Pick<AnyDescriptor, 'operations'>
  readonly operations: OperationSession
}

export type McpLanguageSessionFeatureRequest = Omit<
  McpLanguageRequest,
  'documents' | 'primaryIndex'
> & { readonly primaryUri: string }

export interface McpLanguageSessionUpdateRequest {
  readonly uri: string
  readonly version: number
  readonly text: string
}

export interface McpLanguageSession {
  readonly documents: readonly {
    readonly uri: string
    readonly languageId: string
    readonly documentKind?: string
    readonly version: number
    readonly features: readonly LanguageWorkspaceCapability[]
  }[]
  readonly workspaceIncomplete: boolean
  readonly diagnostics: readonly Diagnostic[]
  update(request: McpLanguageSessionUpdateRequest, signal?: AbortSignal): Promise<McpLanguageResult>
  invoke(
    request: McpLanguageSessionFeatureRequest,
    signal?: AbortSignal,
  ): Promise<McpLanguageResult>
  close(): Promise<void>
}

/** Minimal host-injected seam; all authority remains in the public Modkit host. */
export interface ModkitMcpHostPort {
  readonly outputArtifacts?: boolean
  readonly editsEnabled?: boolean
  readonly inventory: Inventory
  readonly knowledge: KnowledgeCatalog
  readonly roots: readonly string[]
  readonly extensionCoordinates: readonly string[]
  readonly executionProfiles: readonly string[]
  readonly supportedExtensions: readonly string[]
  readonly serviceOperationPermissions?: readonly string[]
  readonly effectfulServiceOperations?: boolean
  discoverInstallations?(
    gameId: string | undefined,
    maxCandidates: number,
    signal?: AbortSignal,
  ): Promise<McpDiscoveryResult>
  openDiscovered?(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject>
  language?(request: McpLanguageRequest, signal?: AbortSignal): Promise<McpLanguageResult>
  openLanguageSession?(
    request: McpLanguageSessionOpenRequest,
    signal?: AbortSignal,
    context?: McpLanguageSessionContext,
  ): Promise<McpLanguageSession>
  serviceOperations?(
    offset: number,
    limit: number,
    activate: boolean,
    signal?: AbortSignal,
  ): Promise<ServiceOperationCatalog>
  invokeServiceOperation?(
    operationId: string,
    input: JsonValue,
    signal?: AbortSignal,
  ): Promise<ServiceOperationInvocation>
  open(path: string, signal?: AbortSignal, selectionId?: string): Promise<McpOpenedSubject>
  close(): Promise<void>
}

export const MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY = Object.freeze({
  locales: Object.freeze(['enUS']),
  limits: Object.freeze({
    // Match the desktop/web adapters: six retail roots already need more than 64 reads.
    maxRequirements: 512,
    maxDocumentBytes: 16_777_216,
    maxTextBytes: 268_435_456,
    maxEntities: 100_000,
    maxDepth: 128,
    maxPageSize: 1_000,
  }),
})

const mapPreviewLimits = Object.freeze({
  maxCandidates: 64,
  maxSubjectEntries: 4_096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  limits: Object.freeze({
    maxDocuments: 16,
    maxRequirements: 16,
    maxDocumentBytes: 33_554_432,
    maxTotalBytes: 67_108_864,
    maxObjects: 100_000,
    maxRegions: 10_000,
    maxTerrainCells: 100_000,
    maxTerrainSamples: 100_000,
    maxDepth: 128,
    maxPageSize: 1_000,
    maxDiagnostics: 1_000,
  }),
  catalogEnrichment: MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY,
})

const mapPreviewBudget = Object.freeze({
  maxInputBytes: 1_073_741_824n,
  maxDepth: 256,
  maxNodes: 1_048_576,
  maxScalarBytes: 268_435_456,
  maxDiagnostics: 1_000,
})

const inside = (roots: readonly string[], path: string): boolean =>
  roots.some(root => {
    const child = relative(root, path)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

/** Read exact provider facets from the trusted inventory; this is not a second game registry. */
const installationGameIds = (inventory: Inventory): readonly string[] => {
  const ids = new Set<string>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const provides = recordOf(contribution.manifest?.spec)?.['provides']
      if (!Array.isArray(provides)) continue
      for (const offer of provides) {
        const row = recordOf(offer)
        if (row?.['contract'] !== 'common.game/installation-discovery' || row['major'] !== 1) {
          continue
        }
        const gameIds = recordOf(row['facet'])?.['gameIds']
        if (!Array.isArray(gameIds)) continue
        for (const gameId of gameIds) {
          const id = nonBlank(gameId)
          if (id !== undefined) ids.add(id)
        }
      }
    }
  }
  return Object.freeze([...ids].sort())
}

const discoveryBudget = Object.freeze({
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
})

const serviceOperationBudget = Object.freeze({
  maxInputBytes: 1_048_576n,
  maxDepth: 128,
  maxNodes: 250_000,
  maxScalarBytes: 1_048_576,
  maxDiagnostics: 100,
  deadlineMs: 1_800_000,
})

const MCP_MAX_DISCOVERY_GAME_IDS = 16
const MCP_MAX_DISCOVERY_SELECTIONS = 128

const discoverySnapshot = (items: readonly McpDiscoveredSubject[]): string => {
  const hash = createHash('sha256')
  for (const item of items) {
    hash.update(
      `${item.gameId}\u0000${item.displayName}\u0000${item.version ?? ''}\u0000${item.buildUid ?? ''}\u0000${item.openable}\n`,
    )
  }
  return `installations-v1:${hash.digest('hex')}`
}

const canonicalDirectories = async (
  paths: readonly string[],
  label: string,
): Promise<readonly string[]> =>
  Object.freeze(
    await Promise.all(
      paths.map(async path => {
        const canonical = await realpath(path)
        if (!(await stat(canonical)).isDirectory()) {
          throw new TypeError(`${label} is not a directory: ${path}`)
        }
        return canonical
      }),
    ),
  )

/** Compose the production proposal-capable host from explicit, canonical allowlists. */
export interface HostMcpPortOptions {
  /** Optional extension-owned, host-validated read-only language dependency source. */
  readonly languageDocumentSource?: LanguageWorkspaceDocumentSource
  /** Optional host-owned content provider. Ownership transfers to the returned MCP port. */
  readonly contentSources?: ContentSources
}

export async function createHostMcpPort(
  configuration: ModkitMcpConfiguration,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
  options: HostMcpPortOptions = {},
): Promise<ModkitMcpHostPort> {
  const [roots, extensions] = await Promise.all([
    canonicalDirectories(configuration.roots, 'root'),
    canonicalDirectories(configuration.extensions, 'extension'),
  ])
  const modkit = await createModkit({
    modules: [sceneModule, uvModule],
    extensions: [],
    ...(configuration.trustExtensions === true
      ? { trustedExtensions: extensions }
      : { userExtensions: extensions }),
    roots,
    // MCP exposes edit-plan calculation but no prepare/commit endpoint. Supplying the same bounded
    // roots here lets mutating codec operations produce plans while the transport remains non-writing.
    writableRoots: roots,
    intent: 'inspect',
    policy: workerBackendPolicy({
      resourceLimits: {
        maxOldGenerationSizeMb: 2_048,
        maxYoungGenerationSizeMb: 256,
      },
      loadDeadlineMs: 120_000,
      defaultCallDeadlineMs: 120_000,
      graceMs: 5_000,
      outputCapBytes: 1_048_576,
    }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
  })
  if (modkit.extensionFailures.length > 0) {
    await modkit.close()
    throw new TypeError(
      `${modkit.extensionFailures.length} explicitly configured extension root(s) failed to load`,
    )
  }
  let contentSources = options.contentSources
  if (
    contentSources === undefined &&
    configuration.contentSourceConfig !== undefined &&
    configuration.contentSourceStorage !== undefined
  ) {
    try {
      contentSources = await loadContentSources(
        configuration.contentSourceConfig,
        configuration.contentSourceStorage,
      )
    } catch (error) {
      await modkit.close()
      throw error
    }
  }
  const knowledge = createKnowledgeCatalog(modkit.services.inventory)
  const mapPreviewResources = createNodeMapPreviewResourcePlanResolver({
    subjects: modkit.services,
  })
  const discoveredById = new Map<string, { readonly path: string }>()
  const discoveryIdByCoordinate = new Map<string, string>()
  const advertisedGameIds = installationGameIds(modkit.services.inventory)
  interface SessionDocument {
    readonly uri: string
    readonly languageId: string
    readonly documentKind?: string
    readonly extension?: string
    readonly version: number
    readonly text: string
  }
  const sessionDocument = async (
    input: McpLanguageSessionDocument,
    signal?: AbortSignal,
  ): Promise<SessionDocument> => {
    signal?.throwIfAborted()
    if ((input.path === undefined) === (input.uri === undefined)) {
      throw new TypeError('language session document needs exactly one of path or uri')
    }
    let uri: string
    let text: string
    let extension = ''
    if (input.path !== undefined) {
      if (!isAbsolute(input.path)) throw new TypeError('language document path must be absolute')
      const canonical = await realpath(resolve(input.path))
      if (!inside(roots, canonical)) {
        throw new TypeError('language document path is outside configured roots')
      }
      uri = pathToFileURL(canonical).href
      extension = extname(canonical).replace(/^\./u, '').toLowerCase()
      text =
        input.text ??
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readBoundedLanguageFile(canonical, signal),
        )
    } else {
      const parsed = new URL(input.uri!)
      if (parsed.protocol === 'file:') {
        const canonical = await realpath(fileURLToPath(parsed))
        if (!inside(roots, canonical)) {
          throw new TypeError('language document URI is outside configured roots')
        }
        uri = pathToFileURL(canonical).href
        extension = extname(canonical).replace(/^\./u, '').toLowerCase()
        text =
          input.text ??
          new TextDecoder('utf-8', { fatal: true }).decode(
            await readBoundedLanguageFile(canonical, signal),
          )
      } else {
        if (
          !['modkit-source:', 'modkit-container:', 'content-source:', 'untitled:'].includes(
            parsed.protocol,
          )
        ) {
          throw new TypeError('language virtual URI uses an unsupported scheme')
        }
        if (input.text === undefined) {
          throw new TypeError('language virtual URI needs host-held source text')
        }
        uri = parsed.href
        extension = extname(parsed.pathname).replace(/^\./u, '').toLowerCase()
        text = input.text
      }
    }
    const textBytes = new TextEncoder().encode(text).byteLength
    if (textBytes > MCP_LANGUAGE_MAX_DOCUMENT_BYTES) {
      throw new TypeError('language documents must be no larger than 4 MiB')
    }
    const version = input.version ?? 1
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError('language document version must be a non-negative safe integer')
    }
    return Object.freeze({
      uri,
      languageId: input.languageId,
      ...(input.documentKind === undefined ? {} : { documentKind: input.documentKind }),
      ...(extension.length === 0 ? {} : { extension }),
      version,
      text,
    })
  }
  const invokeLanguageFeature = async (
    workspace: LanguageWorkspace,
    document: SessionDocument,
    request: Omit<McpLanguageSessionFeatureRequest, 'primaryUri'>,
    analysis: LanguageWorkspaceAnalysisResult | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const common = {
      uri: document.uri,
      documentVersion: document.version,
      maxResults: request.maxResults,
      /*
       * The bound on what the host may assemble, not on what the client sent.
       *
       * A session's explicit files stay capped at 32 and honestly incomplete — that cap is checked
       * where the session opens. The snapshot the host builds also holds the dependency documents
       * the mod resolver mounted, and a mod is hundreds of files: capping the assembly at 32 meant
       * a template or a string key in the next file resolved nowhere, through the one route the
       * plan sanctions for completeness.
       */
      maxDocuments: LANGUAGE_SNAPSHOT_DOCUMENTS,
      ...(signal === undefined ? {} : { signal }),
    }
    const positioned = () => {
      if (request.position === undefined) throw new TypeError(`${request.feature} needs position`)
      return { ...common, position: request.position }
    }
    switch (request.feature) {
      case 'analyze':
        return analysis ?? (await workspace.current(document.uri, signal))
      case 'completion':
        return workspace.completion(positioned())
      case 'hover':
        return workspace.hover(positioned())
      case 'signature-help':
        return workspace.signatureHelp(positioned())
      case 'definition':
        return workspace.definition(positioned())
      case 'references':
        return workspace.references({
          ...positioned(),
          ...(request.includeDeclaration === undefined
            ? {}
            : { includeDeclaration: request.includeDeclaration }),
        })
      case 'prepare-rename':
        return workspace.prepareRename(positioned())
      case 'rename':
        if (request.newName === undefined) throw new TypeError('rename needs newName')
        return workspace.rename({
          ...positioned(),
          newName: request.newName,
          maxEdits: request.maxEdits,
        })
      case 'formatting':
        if (request.formatting === undefined) throw new TypeError('formatting needs options')
        return workspace.formatting({ ...common, options: request.formatting })
      case 'code-actions':
        if (request.range === undefined) throw new TypeError('code-actions needs range')
        return workspace.codeActions({
          ...common,
          range: request.range,
          diagnostics: request.languageDiagnostics ?? [],
          maxEdits: request.maxEdits,
        })
      case 'document-colors':
        return workspace.documentColors(common)
      case 'color-presentations':
        if (request.color === undefined || request.range === undefined) {
          throw new TypeError('color-presentations needs color and range')
        }
        return workspace.colorPresentations({
          ...common,
          color: request.color,
          range: request.range,
        })
      case 'document-symbols':
        return workspace.documentSymbols(common)
      case 'workspace-symbols':
        return workspace.workspaceSymbols({ ...common, query: request.query ?? '' })
      case 'diagnostics':
        return workspace.diagnostics(common)
    }
  }
  const composedLanguageDocumentSource = (
    sources: readonly LanguageWorkspaceDocumentSource[],
    noteCompleteness: (complete: boolean) => void,
  ): LanguageWorkspaceDocumentSource | undefined => {
    if (sources.length === 0) return undefined
    return Object.freeze({
      async snapshot(request: Parameters<LanguageWorkspaceDocumentSource['snapshot']>[0]) {
        const documents = []
        const seen = new Set(request.workspaceDocuments.map(document => document.uri))
        let complete = true
        for (const source of sources) {
          const remaining = request.maxDocuments - documents.length
          if (remaining <= 0) {
            complete = false
            break
          }
          const result = await source.snapshot({ ...request, maxDocuments: remaining })
          complete = complete && result.isComplete
          for (const document of result.documents) {
            if (seen.has(document.uri)) continue
            if (documents.length >= request.maxDocuments) {
              complete = false
              break
            }
            seen.add(document.uri)
            documents.push(document)
          }
        }
        noteCompleteness(complete)
        return Object.freeze({ documents: Object.freeze(documents), isComplete: complete })
      },
    })
  }
/**
 * What a dependency-backed snapshot may weigh.
 *
 * StarCraft II's core mod alone is 25 MiB of layouts, scripts, catalogs and string catalogs, so a
 * 16 MiB ceiling dropped whole languages out of a snapshot the resolver had already mounted — the
 * same ceiling the editor and the LSP raised for the same reason.
 */
const MCP_LANGUAGE_MAX_WORKSPACE_BYTES = 67_108_864

/** What the host may assemble for one language request, dependencies included. */
const LANGUAGE_SNAPSHOT_DOCUMENTS = 1_024

  const openLanguageSession = async (
    request: McpLanguageSessionOpenRequest,
    signal?: AbortSignal,
    context?: McpLanguageSessionContext,
  ): Promise<McpLanguageSession> => {
    if (request.documents.length === 0 || request.documents.length > 32) {
      throw new TypeError('language session needs between 1 and 32 documents')
    }
    const documents = await Promise.all(
      request.documents.map(document => sessionDocument(document, signal)),
    )
    const byUri = new Map<string, SessionDocument>()
    let totalBytes = 0
    for (const document of documents) {
      if (byUri.has(document.uri)) throw new TypeError('language document URI is duplicated')
      totalBytes += new TextEncoder().encode(document.text).byteLength
      if (totalBytes > 16_777_216) throw new TypeError('language workspace exceeds 16 MiB')
      byUri.set(document.uri, document)
    }
    const dependencyDiagnostics: Diagnostic[] = []
    let dependencyResolutionComplete = false
    let dependencySnapshotComplete = false
    let dependencySource: LanguageWorkspaceDocumentSource | undefined
    if (context !== undefined) {
      const discovered = await readOperationContentDependencies({
        descriptor: context.descriptor,
        operations: context.operations,
        ...(signal === undefined ? {} : { signal }),
      })
      dependencyDiagnostics.push(...discovered.diagnostics)
      if (discovered.state === 'resolved') {
        if (contentSources === undefined) {
          dependencyDiagnostics.push(
            diagnostic(
              'information',
              'x3.mcp/content-sources-unavailable',
              'The MCP host has no configured content source for the subject dependency set.',
            ),
          )
        } else if (contentSources.resolveDependencies === undefined) {
          dependencyDiagnostics.push(
            diagnostic(
              'information',
              'x3.mcp/content-dependency-resolver-unavailable',
              'The configured content source cannot resolve subject dependencies.',
            ),
          )
        } else {
          try {
            const resolution = await contentSources.resolveDependencies(discovered.dependencies)
            signal?.throwIfAborted()
            dependencyDiagnostics.push(...contentDependencyDiagnostics(resolution.diagnostics))
            dependencyResolutionComplete = resolution.complete
            if (resolution.mounts.length > 0) {
              dependencySource = createContentDependencyLanguageDocumentSource({
                contentSources,
                resolution,
                routes: languageProviderRoutes(modkit.services.inventory),
                maxDocumentBytes: MCP_LANGUAGE_MAX_DOCUMENT_BYTES,
                maxWorkspaceBytes: MCP_LANGUAGE_MAX_WORKSPACE_BYTES,
                maxEntries: 16_384,
              })
            }
          } catch (error) {
            signal?.throwIfAborted()
            dependencyDiagnostics.push(
              diagnostic(
                'warning',
                'x3.mcp/content-dependency-resolution-failed',
                error instanceof Error ? error.message : String(error),
              ),
            )
          }
        }
      }
    }
    /*
     * Roots the configured provider loads regardless of the subject (editor add-on folders) join
     * every session through the same read-only projection a dependency closure uses. They add
     * documents only; they never make an otherwise partial workspace complete.
     */
    let standingSource: LanguageWorkspaceDocumentSource | undefined
    if (contentSources?.languageMounts !== undefined) {
      try {
        const standing = await contentSources.languageMounts()
        signal?.throwIfAborted()
        dependencyDiagnostics.push(...contentDependencyDiagnostics(standing.diagnostics))
        if (standing.mounts.length > 0) {
          standingSource = createContentDependencyLanguageDocumentSource({
            contentSources,
            resolution: standing,
            routes: languageProviderRoutes(modkit.services.inventory),
            maxDocumentBytes: MCP_LANGUAGE_MAX_DOCUMENT_BYTES,
            maxWorkspaceBytes: MCP_LANGUAGE_MAX_WORKSPACE_BYTES,
            maxEntries: 16_384,
          })
        }
      } catch (error) {
        signal?.throwIfAborted()
        dependencyDiagnostics.push(
          diagnostic(
            'warning',
            'x3.mcp/content-language-mounts-failed',
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
    }
    const sources = [dependencySource, standingSource, options.languageDocumentSource].filter(
      (source): source is LanguageWorkspaceDocumentSource => source !== undefined,
    )
    const documentSource = composedLanguageDocumentSource(sources, complete => {
      dependencySnapshotComplete = complete
    })
    const workspaceIncomplete = () =>
      context === undefined || !dependencyResolutionComplete || !dependencySnapshotComplete
    const workspace = createLanguageWorkspace({
      services: modkit.services,
      grant: { id: `modkit-mcp-language-session:${randomUUID()}`, classes: ['read-source'] },
      budgets: mapPreviewBudget,
      workspaceIncomplete,
      ...(documentSource === undefined ? {} : { documentSource }),
    })
    const analyses = new Map<string, LanguageWorkspaceAnalysisResult>()
    const featuresByUri = new Map<string, readonly LanguageWorkspaceCapability[]>()
    let closed = false
    let operationTail: Promise<void> = Promise.resolve()
    let closePromise: Promise<void> | undefined
    try {
      await workspace.initialize()
      for (const document of documents) {
        const analysis = await workspace.open({
          languageId: document.languageId,
          ...(document.documentKind === undefined ? {} : { documentKind: document.documentKind }),
          ...(document.extension === undefined ? {} : { extension: document.extension }),
          document,
          ...(signal === undefined ? {} : { signal }),
        })
        if (analysis.state === 'unresolved') {
          const detail = analysis.hostDiagnostics
            .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
            .join('; ')
          throw new TypeError(
            `language provider unresolved for ${document.uri}${detail.length === 0 ? '' : `: ${detail}`}`,
          )
        }
        analyses.set(document.uri, analysis)
        const capabilitySet = await workspace.capabilities(document.uri, signal)
        if (capabilitySet === undefined) {
          throw new TypeError(`language capabilities unavailable for ${document.uri}`)
        }
        featuresByUri.set(document.uri, capabilitySet.features)
      }
    } catch (error) {
      await workspace.shutdown()
      throw error
    }
    const result = async (
      document: SessionDocument,
      feature: McpLanguageFeature,
      value: unknown,
    ): Promise<McpLanguageResult> => {
      const digest = createHash('sha256')
      for (const item of [...byUri.values()].sort((left, right) =>
        left.uri.localeCompare(right.uri),
      )) {
        digest
          .update(item.uri)
          .update('\0')
          .update(String(item.version))
          .update('\0')
          .update(item.text)
      }
      return Object.freeze({
        snapshotId: `language-session-v1:${digest.digest('hex')}`,
        diagnostics: Object.freeze([
          ...dependencyDiagnostics,
          ...[...analyses.values()].flatMap(item => item.hostDiagnostics),
        ]),
        primaryUri: document.uri,
        feature,
        result: value,
      })
    }
    const run = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (closed) throw new TypeError('language session is closed')
      const predecessor = operationTail
      let release!: () => void
      operationTail = new Promise<void>(resolve => {
        release = resolve
      })
      await predecessor
      if (closed) {
        release()
        throw new TypeError('language session is closed')
      }
      try {
        return await operation()
      } finally {
        release()
      }
    }
    return Object.freeze({
      get documents() {
        return Object.freeze(
          [...byUri.values()].map(document =>
            Object.freeze({
              uri: document.uri,
              languageId: document.languageId,
              ...(document.documentKind === undefined
                ? {}
                : { documentKind: document.documentKind }),
              version: document.version,
              features: featuresByUri.get(document.uri) ?? Object.freeze([]),
            }),
          ),
        )
      },
      get workspaceIncomplete() {
        return workspaceIncomplete()
      },
      get diagnostics() {
        return Object.freeze([
          ...dependencyDiagnostics,
          ...[...analyses.values()].flatMap(item => item.hostDiagnostics),
        ])
      },
      async update(
        update: McpLanguageSessionUpdateRequest,
        updateSignal?: AbortSignal,
      ): Promise<McpLanguageResult> {
        return run(async () => {
          const current = byUri.get(update.uri)
          if (current === undefined) throw new TypeError('language session document is unknown')
          if (!Number.isSafeInteger(update.version) || update.version <= current.version) {
            throw new TypeError('language overlay version must strictly increase')
          }
          const bytes = new TextEncoder().encode(update.text).byteLength
          const otherBytes = [...byUri.values()]
            .filter(document => document.uri !== update.uri)
            .reduce((sum, document) => sum + new TextEncoder().encode(document.text).byteLength, 0)
          if (bytes > MCP_LANGUAGE_MAX_DOCUMENT_BYTES || otherBytes + bytes > 16_777_216) {
            throw new TypeError('language overlay exceeds session byte limits')
          }
          const next = Object.freeze({ ...current, version: update.version, text: update.text })
          const analysis = await workspace.change({
            languageId: next.languageId,
            ...(next.documentKind === undefined ? {} : { documentKind: next.documentKind }),
            ...(next.extension === undefined ? {} : { extension: next.extension }),
            document: next,
            ...(updateSignal === undefined ? {} : { signal: updateSignal }),
          })
          byUri.set(next.uri, next)
          analyses.set(next.uri, analysis)
          return result(next, 'analyze', analysis)
        })
      },
      async invoke(
        featureRequest: McpLanguageSessionFeatureRequest,
        invokeSignal?: AbortSignal,
      ): Promise<McpLanguageResult> {
        return run(async () => {
          const document = byUri.get(featureRequest.primaryUri)
          if (document === undefined) throw new TypeError('language session primary URI is unknown')
          const value = await invokeLanguageFeature(
            workspace,
            document,
            featureRequest,
            analyses.get(document.uri),
            invokeSignal,
          )
          return result(document, featureRequest.feature, value)
        })
      },
      async close() {
        if (closePromise !== undefined) return closePromise
        closed = true
        closePromise = (async () => {
          await operationTail
          byUri.clear()
          analyses.clear()
          featuresByUri.clear()
          await workspace.shutdown()
        })()
        return closePromise
      },
    })
  }
  // Generic service operations may own host state or external I/O and therefore advertise the
  // Node host realm. Subject codecs keep using the worker-targeted lane in modkit.services.
  const operationServices = Object.freeze({
    ...modkit.services,
    target: modkit.services.host.target,
  })
  const port: ModkitMcpHostPort = {
    ...(configuration.outputArtifacts === true ? { outputArtifacts: true } : {}),
    ...(configuration.allowEdits === true ? { editsEnabled: true } : {}),
    inventory: modkit.services.inventory,
    knowledge,
    roots,
    extensionCoordinates: modkit.extensionCoordinates,
    executionProfiles: modkit.services.executionProfiles,
    supportedExtensions: modkit.services.supportedExtensions,
    serviceOperationPermissions: Object.freeze([...(configuration.operationPermissions ?? [])]),
    effectfulServiceOperations: configuration.allowEffectfulServiceOperations === true,
    openLanguageSession,
    async serviceOperations(offset, limit, activate, signal) {
      return discoverServiceOperations({
        services: operationServices,
        alternateTargets: [modkit.services.target],
        grant: {
          id: 'modkit-mcp-service-operation-catalog',
          classes: configuration.operationPermissions ?? [],
        },
        budgets: serviceOperationBudget,
        offset,
        limit,
        activate,
        ...(signal === undefined ? {} : { signal }),
      })
    },
    async invokeServiceOperation(operationId, input, signal) {
      return invokeServiceOperation({
        services: operationServices,
        alternateTargets: [modkit.services.target],
        operationId,
        input,
        grant: {
          id: `modkit-mcp-service-operation:${randomUUID()}`,
          classes: configuration.operationPermissions ?? [],
        },
        budgets: serviceOperationBudget,
        allowedEffects:
          configuration.allowEffectfulServiceOperations === true
            ? ['none', 'host-state', 'external']
            : ['none'],
        ...(signal === undefined ? {} : { signal }),
      })
    },
    async language(request: McpLanguageRequest, signal?: AbortSignal): Promise<McpLanguageResult> {
      signal?.throwIfAborted()
      if (request.documents.length === 0 || request.documents.length > 32) {
        throw new TypeError('language request needs between 1 and 32 documents')
      }
      if (
        !Number.isSafeInteger(request.primaryIndex) ||
        request.primaryIndex < 0 ||
        request.primaryIndex >= request.documents.length
      ) {
        throw new TypeError('language primaryIndex is outside documents')
      }
      const openedDocuments: {
        readonly uri: string
        readonly languageId: string
        readonly documentKind?: string
        readonly extension?: string
        readonly text: string
      }[] = []
      const seen = new Set<string>()
      let totalBytes = 0
      for (const document of request.documents) {
        signal?.throwIfAborted()
        if (!isAbsolute(document.path)) {
          throw new TypeError('language document path must be absolute')
        }
        const canonical = await realpath(resolve(document.path))
        if (!inside(roots, canonical)) {
          throw new TypeError('language document path is outside configured roots')
        }
        if (seen.has(canonical)) throw new TypeError('language document path is duplicated')
        seen.add(canonical)
        const bytes = await readBoundedLanguageFile(canonical, signal)
        totalBytes += bytes.byteLength
        if (totalBytes > 16_777_216) throw new TypeError('language workspace exceeds 16 MiB')
        const suffix = extname(canonical).replace(/^\./u, '').toLowerCase()
        openedDocuments.push({
          uri: pathToFileURL(canonical).href,
          languageId: document.languageId,
          ...(document.documentKind === undefined ? {} : { documentKind: document.documentKind }),
          ...(suffix.length === 0 ? {} : { extension: suffix }),
          text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        })
      }
      const workspace = createLanguageWorkspace({
        services: modkit.services,
        grant: { id: `modkit-mcp-language:${randomUUID()}`, classes: ['read-source'] },
        budgets: mapPreviewBudget,
        workspaceIncomplete: true,
        ...(options.languageDocumentSource === undefined
          ? {}
          : { documentSource: options.languageDocumentSource }),
      })
      const diagnostics: Diagnostic[] = []
      try {
        await workspace.initialize()
        const analyses = []
        for (const document of openedDocuments) {
          const analysis = await workspace.open({
            languageId: document.languageId,
            ...(document.documentKind === undefined ? {} : { documentKind: document.documentKind }),
            ...(document.extension === undefined ? {} : { extension: document.extension }),
            document: {
              uri: document.uri,
              languageId: document.languageId,
              version: 1,
              text: document.text,
            },
            ...(signal === undefined ? {} : { signal }),
          })
          diagnostics.push(...analysis.hostDiagnostics)
          analyses.push(analysis)
        }
        const primary = openedDocuments[request.primaryIndex]!
        const common = {
          uri: primary.uri,
          documentVersion: 1,
          maxResults: request.maxResults,
          // Preserve capacity for an optional host-owned dependency source. Explicit documents
          // remain primary and the language workspace enforces the same 32-document MCP bound.
          maxDocuments: 32,
          ...(signal === undefined ? {} : { signal }),
        }
        const positioned = () => {
          if (request.position === undefined)
            throw new TypeError(`${request.feature} needs position`)
          return { ...common, position: request.position }
        }
        let result: unknown
        switch (request.feature) {
          case 'analyze':
            result = analyses[request.primaryIndex]
            break
          case 'completion':
            result = await workspace.completion(positioned())
            break
          case 'hover':
            result = await workspace.hover(positioned())
            break
          case 'signature-help':
            result = await workspace.signatureHelp(positioned())
            break
          case 'definition':
            result = await workspace.definition(positioned())
            break
          case 'references':
            result = await workspace.references({
              ...positioned(),
              ...(request.includeDeclaration === undefined
                ? {}
                : { includeDeclaration: request.includeDeclaration }),
            })
            break
          case 'prepare-rename':
            result = await workspace.prepareRename(positioned())
            break
          case 'rename':
            if (request.newName === undefined) throw new TypeError('rename needs newName')
            result = await workspace.rename({
              ...positioned(),
              newName: request.newName,
              maxEdits: request.maxEdits,
            })
            break
          case 'formatting':
            if (request.formatting === undefined) throw new TypeError('formatting needs options')
            result = await workspace.formatting({ ...common, options: request.formatting })
            break
          case 'code-actions':
            if (request.range === undefined) throw new TypeError('code-actions needs range')
            result = await workspace.codeActions({
              ...common,
              range: request.range,
              diagnostics: request.languageDiagnostics ?? [],
              maxEdits: request.maxEdits,
            })
            break
          case 'document-colors':
            result = await workspace.documentColors(common)
            break
          case 'color-presentations':
            if (request.color === undefined || request.range === undefined) {
              throw new TypeError('color-presentations needs color and range')
            }
            result = await workspace.colorPresentations({
              ...common,
              color: request.color,
              range: request.range,
            })
            break
          case 'document-symbols':
            result = await workspace.documentSymbols(common)
            break
          case 'workspace-symbols':
            result = await workspace.workspaceSymbols({ ...common, query: request.query ?? '' })
            break
          case 'diagnostics':
            result = await workspace.diagnostics(common)
            break
        }
        const digest = createHash('sha256')
        for (const document of openedDocuments) {
          digest.update(document.uri).update('\0').update(document.text).update('\0')
        }
        return Object.freeze({
          snapshotId: `language-v1:${digest.digest('hex')}`,
          diagnostics: Object.freeze(diagnostics),
          primaryUri: primary.uri,
          feature: request.feature,
          result,
        })
      } finally {
        await workspace.shutdown()
      }
    },
    async discoverInstallations(
      requestedGameId: string | undefined,
      maxCandidates: number,
      signal?: AbortSignal,
    ): Promise<McpDiscoveryResult> {
      signal?.throwIfAborted()
      const matchingGameIds =
        requestedGameId === undefined
          ? advertisedGameIds
          : advertisedGameIds.includes(requestedGameId)
            ? [requestedGameId]
            : []
      const diagnostics: Diagnostic[] = []
      const items: McpDiscoveredSubject[] = []
      let selectionLimitReported = false
      const gameIds = matchingGameIds.slice(0, MCP_MAX_DISCOVERY_GAME_IDS)
      let complete =
        (requestedGameId === undefined || gameIds.length === 1) &&
        gameIds.length === matchingGameIds.length
      if (matchingGameIds.length > gameIds.length) {
        diagnostics.push({
          code: 'x3.mcp/discovery-game-ids-capped',
          message: `Installation discovery was capped at ${MCP_MAX_DISCOVERY_GAME_IDS} advertised game IDs.`,
          severity: 'warning',
        })
      }
      if (requestedGameId !== undefined && matchingGameIds.length === 0) {
        diagnostics.push({
          code: 'x3.mcp/game-installation-provider-unavailable',
          message: `No loaded installation-discovery contribution advertises ${requestedGameId}.`,
          severity: 'information',
        })
      }
      for (const gameId of gameIds) {
        signal?.throwIfAborted()
        const discovery = await discoverGameInstallations({
          services: modkit.services,
          gameId,
          maxCandidates,
          grant: {
            id: `modkit-mcp-game-installation-discovery:${gameId}`,
            classes:
              process.platform === 'win32'
                ? ['filesystem-read', 'process-launch']
                : ['filesystem-read'],
          },
          budgets: discoveryBudget,
          ...(signal === undefined ? {} : { signal }),
        })
        diagnostics.push(...discovery.diagnostics)
        if (discovery.state !== 'discovered') {
          complete = false
          continue
        }
        complete &&= discovery.result.complete
        diagnostics.push(
          ...discovery.result.diagnostics.map(item => ({
            code: item.code,
            message: item.message,
            severity: item.severity,
          })),
        )
        for (const installation of discovery.result.installations) {
          signal?.throwIfAborted()
          let canonical: string
          try {
            canonical = await realpath(installation.installPath)
          } catch {
            complete = false
            diagnostics.push({
              code: 'x3.mcp/discovered-installation-stale',
              message: `A verified ${gameId} installation disappeared before it could be selected.`,
              severity: 'warning',
            })
            continue
          }
          const coordinate = `${gameId}\u0000${installation.normalizedPath}`
          let selectionId = discoveryIdByCoordinate.get(coordinate)
          if (selectionId === undefined) {
            if (discoveredById.size >= MCP_MAX_DISCOVERY_SELECTIONS) {
              complete = false
              if (!selectionLimitReported) {
                selectionLimitReported = true
                diagnostics.push({
                  code: 'x3.mcp/discovery-selection-limit',
                  message: `The process-local discovery selection limit (${MCP_MAX_DISCOVERY_SELECTIONS}) was reached.`,
                  severity: 'warning',
                })
              }
              continue
            }
            selectionId = randomUUID()
            discoveryIdByCoordinate.set(coordinate, selectionId)
          }
          discoveredById.set(selectionId, { path: canonical })
          items.push(
            Object.freeze({
              selectionId,
              gameId,
              displayName: installation.displayName,
              openable: inside(roots, canonical),
              ...(installation.version === undefined ? {} : { version: installation.version }),
              ...(installation.buildName === undefined
                ? {}
                : { buildName: installation.buildName }),
              ...(installation.buildUid === undefined ? {} : { buildUid: installation.buildUid }),
            }),
          )
        }
      }
      const boundedItems = Object.freeze(items.slice(0, 64))
      if (items.length > boundedItems.length) {
        complete = false
        diagnostics.push({
          code: 'x3.mcp/discovered-installations-capped',
          message: 'Installation discovery was capped at 64 selectable results.',
          severity: 'warning',
        })
      }
      return Object.freeze({
        snapshotId: discoverySnapshot(boundedItems),
        complete,
        items: boundedItems,
        diagnostics: Object.freeze(diagnostics),
      })
    },
    async openDiscovered(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject> {
      const selection = discoveredById.get(selectionId)
      if (selection === undefined) {
        throw new RangeError(
          'installation selection is unknown, stale or belongs to another MCP process',
        )
      }
      // The opaque selection removes path copying, but never widens the configured subject roots.
      return port.open(selection.path, signal)
    },
    async open(
      path: string,
      signal?: AbortSignal,
      selectionId?: string,
    ): Promise<McpOpenedSubject> {
      signal?.throwIfAborted()
      if (!isAbsolute(path)) throw new TypeError('subject path must be absolute')
      const lexical = resolve(path)
      if (!inside(roots, lexical)) throw new TypeError('subject path is outside configured roots')
      const canonical = await realpath(lexical)
      signal?.throwIfAborted()
      if (!inside(roots, canonical)) throw new TypeError('subject path is outside configured roots')
      const canonicalStat = await stat(canonical)
      const opened = canonicalStat.isDirectory()
        ? await (async (): Promise<McpOpenedSubject> => {
            const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
            const mount = await vfs.openMount(pathToFileURL(canonical).href)
            const result = await openSubject({
              inventory: modkit.services.inventory,
              source: artifactNamespaceSourceFromVfsMount(mount),
              path: basename(canonical),
              intent: 'inspect',
              target: modkit.services.target,
              grant: {
                id: `modkit-mcp-directory:${randomUUID()}`,
                classes: ['read-source', 'write-source'],
              },
              budget: mapPreviewBudget,
              executionBackends: modkit.services.executionBackends,
              ...(modkit.services.serviceDefinitions === undefined
                ? {}
                : { serviceDefinitions: modkit.services.serviceDefinitions }),
              ...(signal === undefined ? {} : { signal }),
            })
            const snapshot = subjectOpenSnapshot({
              result,
              sessionId: randomUUID,
              diagnostics: result.diagnostics,
            })
            if (result.state !== 'opened') {
              await vfs.dispose()
              return Object.freeze({ snapshot, close: async () => undefined })
            }
            const session = result.session
            let closed = false
            return Object.freeze({
              snapshot,
              session,
              async close(): Promise<void> {
                if (closed) return
                closed = true
                await session.dispose()
                await vfs.dispose()
              },
            })
          })()
        : await modkit.open(canonical, signal)
      if (opened.snapshot.state !== 'opened' || opened.session === undefined) return opened
      const originalSession = opened.session
      const coordinatePreview = (selectionId?: string, requestSignal = signal) =>
        coordinateMapPreviewAssetSession({
          services: modkit.services,
          grant: {
            id: 'modkit-mcp-map-preview',
            classes: ['read-source', 'write-source', 'filesystem-read', 'process-launch'],
          },
          budgets: mapPreviewBudget,
          original: originalSession,
          resourcePlanResolver: mapPreviewResources,
          ...mapPreviewLimits,
          ...(selectionId === undefined ? {} : { selectionId }),
          ...(requestSignal === undefined ? {} : { signal: requestSignal }),
        })
      let preview = await coordinatePreview(selectionId)
      if (preview.state === 'selection-required' && preview.candidates.length === 1) {
        const onlyCandidate = preview.candidates[0]
        if (onlyCandidate !== undefined) {
          preview = await coordinatePreview(onlyCandidate.candidateId)
        }
      }
      if (preview.state !== 'opened') {
        const selectionDiagnostic: readonly Diagnostic[] =
          preview.state === 'selection-required'
            ? [
                {
                  code: 'x3.mcp/map-preview-selection-required',
                  message: `Map preview requires one of ${preview.candidates.length} candidate(s): ${preview.candidates.map(item => `${item.candidateId} (${item.sourcePath ?? item.displayName})`).join(', ')}`,
                  severity: 'information',
                },
              ]
            : []
        return Object.freeze({
          ...opened,
          ...(preview.state === 'selection-required'
            ? {
                selectionCandidates: preview.candidates,
                async select(
                  requestedSelectionId: string,
                  requestSignal?: AbortSignal,
                ): Promise<McpOpenedSubject> {
                  const selectedPreview = await coordinatePreview(
                    requestedSelectionId,
                    requestSignal,
                  )
                  if (selectedPreview.state !== 'opened') {
                    throw new TypeError(
                      `map preview selection did not open (${selectedPreview.state}): ${selectedPreview.diagnostics.map(item => item.message).join('; ')}`,
                    )
                  }
                  let closed = false
                  return Object.freeze({
                    snapshot: Object.freeze({
                      ...opened.snapshot,
                      descriptor:
                        selectedPreview.descriptor as unknown as typeof opened.snapshot.descriptor,
                      diagnostics: Object.freeze([
                        ...opened.snapshot.diagnostics,
                        ...selectedPreview.diagnostics,
                      ]),
                    }),
                    session: selectedPreview.session,
                    async close(): Promise<void> {
                      if (closed) return
                      closed = true
                      await selectedPreview.session.dispose()
                      await opened.close()
                    },
                  })
                },
              }
            : {}),
          snapshot: Object.freeze({
            ...opened.snapshot,
            diagnostics: Object.freeze([
              ...opened.snapshot.diagnostics,
              ...preview.diagnostics,
              ...selectionDiagnostic,
            ]),
          }),
        })
      }
      let closed = false
      return Object.freeze({
        snapshot: Object.freeze({
          ...opened.snapshot,
          descriptor: preview.descriptor as unknown as typeof opened.snapshot.descriptor,
          diagnostics: Object.freeze([...opened.snapshot.diagnostics, ...preview.diagnostics]),
        }),
        session: preview.session,
        async close(): Promise<void> {
          if (closed) return
          closed = true
          await preview.session.dispose()
          await opened.close()
        },
      })
    },
    async close(): Promise<void> {
      discoveredById.clear()
      discoveryIdByCoordinate.clear()
      await Promise.all([modkit.close(), contentSources?.dispose()])
    },
  }
  return Object.freeze(port)
}
