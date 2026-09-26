import { createHash, randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  composeLanguageDocumentSources,
  createKnowledgeCatalog,
  discoverServiceOperations,
  invokeServiceOperation,
  resolveContentLanguageSources,
  subjectTarget,
  type Inventory,
  type ServiceOperationCatalog,
  type ServiceOperationInvocation,
  type SubjectEditing,
} from '@modkit/host'
import { discoverGameInstallations } from '@modkit/host/games'
import {
  createLanguageWorkspace,
  languageWorkspaceContextToken,
  languageProviderRoutes,
  type LanguageWorkspace,
  type LanguageWorkspaceAnalysisResult,
  type LanguageWorkspaceCapability,
  type LanguageWorkspaceDocumentSource,
} from '@modkit/host/language'
import type {
  LanguageWorkspaceContext,
  LanguageWorkspaceDocumentOrigin,
} from '@modkit/sdk/language'
import {
  DEFAULT_SUBJECT_OPEN_BUDGET,
  createFilesystemLanguageDocumentSource,
  createContentSourceMapPreviewResourcePlanResolver,
  createModkit,
  createNodeMapPreviewResourcePlanResolver,
  type ModkitOpened,
  openDirectoryResolvedDataWorkspace,
  type DirectoryResolvedDataWorkspace,
  type ResolvedDataChangeRequest,
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
import { McpOperationError } from './runtime.js'
import { MCP_MAX_WORLD_PAGE_ITEMS } from './protocol.js'
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

/** The folder a `file:` subject names on this disk, when it is one. */
async function hostFolderOf(uri: string | undefined): Promise<string | undefined> {
  if (uri === undefined || !uri.startsWith('file:')) return undefined
  try {
    const path = fileURLToPath(uri)
    return (await stat(path)).isDirectory() ? path : undefined
  } catch {
    return undefined
  }
}

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
  | 'semantic-tokens'
  | 'completion'
  | 'hover'
  | 'signature-help'
  | 'definition'
  | 'references'
  | 'prepare-rename'
  | 'rename'
  | 'formatting'
  | 'on-type-formatting'
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
  readonly ch?: string
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
  readonly workspaceContext?: Pick<LanguageWorkspaceContext, 'id' | 'revision' | 'semanticComplete'>
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
  /** Ordered game-data locales used by localized semantic resolution. */
  readonly locales?: readonly string[]
}

export interface McpLanguageSessionContext {
  readonly descriptor: Pick<AnyDescriptor, 'operations' | 'subjectUri' | 'revision'>
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

export type McpResolvedDataWorkspace = DirectoryResolvedDataWorkspace
export type McpResolvedChange = ResolvedDataChangeRequest

export interface McpResolvedWorkspaceRequest {
  readonly gameId: string
  /** Absolute sibling mod directories in load order; the last one is the writable active mod. */
  readonly directories: readonly string[]
  readonly locales: readonly string[]
  readonly maxRequirements: number
}

/** A subject's mod context as the game's loader opens it: layers in load order, and what is missing. */
export interface McpModContext {
  readonly contextId: string
  readonly layers: readonly Readonly<{
    displayName: string
    sourceId: string
    sourcePath: string
    role: 'dependency' | 'base' | 'primary'
    provenance: 'declared' | 'implicit' | 'setting' | 'opened'
    fingerprint?: string
  }>[]
  readonly unresolved: readonly string[]
}

/** Minimal host-injected seam; all authority remains in the public Modkit host. */
export interface ModkitMcpHostPort {
  /** Present when content sources are configured. */
  modContext?(subjectUri: string): Promise<McpModContext>
  openResolvedDataWorkspace?(
    request: McpResolvedWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<
    | Readonly<{ state: 'resolved'; workspace: McpResolvedDataWorkspace }>
    | Readonly<{ state: 'unresolved'; diagnostics: readonly Diagnostic[] }>
  >
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
    maxPageSize: MCP_MAX_WORLD_PAGE_ITEMS,
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

/**
 * The opened subject together with the world its map preview built for it: the codec's own
 * descriptor, operations and edits, plus the preview's data sources (world, graph, selector) the
 * codec does not publish itself. Replacing the subject by its preview dropped every codec operation.
 */
function withPreviewSources(codec: AssetSession, preview: AssetSession): AssetSession {
  const key = (offer: { readonly contract: string; readonly major: number }) => `${offer.contract}@${offer.major}`
  const descriptor = async () => {
    const [own, previewed] = await Promise.all([codec.descriptor(), preview.descriptor()])
    const owned = new Set(own.dataSources.map(key))
    const added = previewed.dataSources.filter(offer => !owned.has(key(offer)))
    return { own, added, merged: Object.freeze({ ...own, dataSources: Object.freeze([...own.dataSources, ...added]) }) }
  }
  return Object.freeze({
    revision: codec.revision,
    state: () => codec.state(),
    descriptor: async () => (await descriptor()).merged,
    dataSource: (async (contract: string, major: number, ...rest: unknown[]) => {
      const { added } = await descriptor()
      const from = added.some(offer => offer.contract === contract && offer.major === major) ? preview : codec
      return (from.dataSource as (...args: unknown[]) => unknown)(contract, major, ...rest)
    }) as unknown as AssetSession['dataSource'],
    operations: () => codec.operations(),
    events: (signal?: AbortSignal) => codec.events(signal),
    // The preview session owns the opened one and releases both.
    dispose: () => preview.dispose(),
  })
}

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
    // Plans can target these bounded roots; committing still requires the MCP startup edit policy.
    writableRoots: roots,
    intent: 'inspect',
    // A map or mod folder reads files beyond the 64 MiB default; the open deadline stays.
    budget: { ...DEFAULT_SUBJECT_OPEN_BUDGET, ...mapPreviewBudget },
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    // An operation that names catalog entities is answered from its subject's mod context.
    subjectCatalog: {
      contentSources: async () => contentSources,
      baseMods: () => configuration.baseMods,
    },
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
  // A pack may keep its entries in a file of its extension; the catalog reads it on first query.
  const knowledgeFiles = new VirtualFileSystem().registerProvider(createFileVfsProvider())
  const knowledge = createKnowledgeCatalog(modkit.services.inventory, {}, { vfs: knowledgeFiles })
  /*
   * A map loads like a mod, as in VS Code: the configured content sources open it inside its mods,
   * and its mod context answers what the map places (the SC2 loader's catalog, not a second Data
   * analysis over a fixed file list). Without sources, or when they mount none of the map's
   * dependencies, the installation locator path stays.
   */
  const mapPreviewResources = createContentSourceMapPreviewResourcePlanResolver({
    contentSources: async () => contentSources,
    fallback: createNodeMapPreviewResourcePlanResolver({
      subjects: modkit.services,
    }),
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
    readonly origin: Omit<LanguageWorkspaceDocumentOrigin, 'sourceRevision'>
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
    let logicalId: string
    let precedence: number
    if (input.path !== undefined) {
      if (!isAbsolute(input.path)) throw new TypeError('language document path must be absolute')
      const canonical = await realpath(resolve(input.path))
      if (!inside(roots, canonical)) {
        throw new TypeError('language document path is outside configured roots')
      }
      uri = pathToFileURL(canonical).href
      const rootIndex = roots.findIndex(root => inside([root], canonical))
      const root = roots[rootIndex]
      if (root === undefined) throw new TypeError('language document path has no configured root')
      logicalId = relative(root, canonical).replaceAll('\\', '/')
      precedence = Number.MAX_SAFE_INTEGER - roots.length + rootIndex
      extension = extname(canonical).replace(/^\./u, '').toLowerCase()
      text =
        input.text ??
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readBoundedLanguageFile(canonical, signal),
        )
    } else {
      const inputUri = input.uri
      if (inputUri === undefined) throw new TypeError('language session document URI is missing')
      const parsed = new URL(inputUri)
      if (parsed.protocol === 'file:') {
        const canonical = await realpath(fileURLToPath(parsed))
        if (!inside(roots, canonical)) {
          throw new TypeError('language document URI is outside configured roots')
        }
        uri = pathToFileURL(canonical).href
        const rootIndex = roots.findIndex(root => inside([root], canonical))
        const root = roots[rootIndex]
        if (root === undefined) throw new TypeError('language document URI has no configured root')
        logicalId = relative(root, canonical).replaceAll('\\', '/')
        precedence = Number.MAX_SAFE_INTEGER - roots.length + rootIndex
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
        logicalId = decodeURIComponent(parsed.pathname)
          .replace(/^\/+content-dependencies\/\d+\//u, '')
          .replace(/^\/+/, '')
        precedence = Number.MAX_SAFE_INTEGER
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
      origin: Object.freeze({
        uri,
        layerId: `mcp-session:${precedence}`,
        logicalId,
        precedence,
        readOnly: false,
        overlay: true,
      }),
    })
  }
  const invokeLanguageFeature = async (
    workspace: LanguageWorkspace,
    document: Pick<SessionDocument, 'uri' | 'version'>,
    request: Omit<McpLanguageSessionFeatureRequest, 'primaryUri'>,
    analysis: LanguageWorkspaceAnalysisResult | undefined,
    signal?: AbortSignal,
    maxDocuments = LANGUAGE_SNAPSHOT_DOCUMENTS,
  ): Promise<unknown> => {
    signal?.throwIfAborted()
    const capabilities = await workspace.capabilities(document.uri, signal)
    if (capabilities === undefined) {
      throw new McpOperationError('x3.mcp/language-provider-unresolved', 'No language provider resolved for the primary document.')
    }
    if (!capabilities.features.includes(request.feature)) {
      throw new McpOperationError('x3.mcp/language-feature-unsupported', `The primary document's provider does not support ${request.feature}.`)
    }
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
      maxDocuments,
      ...(signal === undefined ? {} : { signal }),
    }
    const positioned = () => {
      if (request.position === undefined) throw new TypeError(`${request.feature} needs position`)
      return { ...common, position: request.position }
    }
    switch (request.feature) {
      case 'analyze':
        return analysis ?? (await workspace.current(document.uri, signal))
      case 'semantic-tokens': {
        const current = analysis ?? (await workspace.current(document.uri, signal))
        const tokens = current?.state === 'resolved' ? current.analysis.tokens : []
        return {
          documentUri: document.uri,
          documentVersion: document.version,
          tokens: tokens.slice(0, request.maxResults),
          isIncomplete: current?.state !== 'resolved' || tokens.length > request.maxResults,
        }
      }
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
      case 'on-type-formatting':
        if (request.formatting === undefined || request.ch === undefined) {
          throw new TypeError('on-type-formatting needs formatting options and ch')
        }
        return workspace.onTypeFormatting({ ...positioned(), options: request.formatting, ch: request.ch })
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
    const locales = request.locales ?? ['enUS']
    if (
      locales.length === 0 ||
      locales.length > 16 ||
      new Set(locales).size !== locales.length ||
      locales.some(locale => !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/u.test(locale))
    ) {
      throw new TypeError('language session locales must be 1..16 unique bounded identifiers')
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
    let dependencySnapshotComplete = false
    if (context !== undefined && contentSources === undefined) {
      dependencyDiagnostics.push(
        diagnostic(
          'information',
          'x3.mcp/content-sources-unavailable',
          'The MCP host has no configured content source for the subject dependency set.',
        ),
      )
    }
    /*
     * The subject's mod context (its dependencies and the editor add-on folders the provider layers
     * beneath it), through the same host projection the standalone LSP uses. Without a subject the
     * first document opens on its own — a file in no package still opens inside its base mods.
     */
    const primaryUri = documents[0]?.uri
    /*
     * A virtual document (`untitled:`, a container member) is on no disk: it opens as a file not yet
     * saved into the first root, which puts it in that root's mod or inside the base mods.
     */
    const looseUri =
      primaryUri === undefined || subjectTarget(primaryUri) !== undefined || roots[0] === undefined
        ? primaryUri
        : pathToFileURL(
            resolve(
              roots[0],
              basename(
                decodeURIComponent(
                  primaryUri.replace(/^[a-z][a-z0-9+.-]*:/iu, '').split(/[?#]/u)[0] ?? '',
                ),
              ) || 'Untitled',
            ),
          ).href
    const subjects =
      context !== undefined
        ? [context]
        : looseUri !== undefined && subjectTarget(looseUri) !== undefined
          ? [{ descriptor: { subjectUri: looseUri } }]
          : []
    const projected =
      contentSources === undefined
        ? undefined
        : await resolveContentLanguageSources({
            contentSources,
            routes: languageProviderRoutes(modkit.services.inventory),
            limits: {
              maxDocumentBytes: MCP_LANGUAGE_MAX_DOCUMENT_BYTES,
              maxWorkspaceBytes: MCP_LANGUAGE_MAX_WORKSPACE_BYTES,
              maxEntries: 16_384,
            },
            subjects,
            ...(configuration.baseMods === undefined
              ? {}
              : { baseMods: { '*': configuration.baseMods } }),
            ...(signal === undefined ? {} : { signal }),
          })
    dependencyDiagnostics.push(...(projected?.diagnostics ?? []))
    const dependencyResolutionComplete = projected?.dependenciesComplete === true
    /*
     * The package itself. The closure leaves the opened subject to the host that serves it, as the
     * LSP and VS Code serve their roots from disk; this session did not, so a rename could claim to
     * be whole while the package's unopened files went unseen. A package folder on this disk is
     * served from it (writable); one that is not (a packed archive, a content source) keeps the
     * session incomplete, and rename is refused instead of missing files.
     */
    const packageFolder = await hostFolderOf(context?.descriptor.subjectUri)
    const packageSource =
      packageFolder === undefined
        ? undefined
        : createFilesystemLanguageDocumentSource({
            roots: [packageFolder],
            routes: languageProviderRoutes(modkit.services.inventory),
            maxDocumentBytes: MCP_LANGUAGE_MAX_DOCUMENT_BYTES,
            maxWorkspaceBytes: MCP_LANGUAGE_MAX_WORKSPACE_BYTES,
          })
    const sources = [
      ...(projected?.sources ?? []),
      packageSource,
      options.languageDocumentSource,
    ].filter((source): source is LanguageWorkspaceDocumentSource => source !== undefined)
    const documentSource = composeLanguageDocumentSources(sources, complete => {
      dependencySnapshotComplete = complete
    })
    let observedWorkspaceContext: LanguageWorkspaceContext | undefined
    const workspaceIncomplete = () =>
      context === undefined ||
      packageSource === undefined ||
      !dependencyResolutionComplete ||
      !dependencySnapshotComplete
    const workspace = createLanguageWorkspace({
      services: modkit.services,
      grant: { id: `modkit-mcp-language-session:${randomUUID()}`, classes: ['read-source'] },
      budgets: mapPreviewBudget,
      workspaceIncomplete,
      semanticInputs: Object.freeze([
        Object.freeze({
          kind: 'locale-set',
          id: `selected-game-locales:${locales.join(',')}`,
          revision: languageWorkspaceContextToken(locales),
        }),
        ...(context === undefined
          ? []
          : [
              Object.freeze({
                kind: 'subject',
                id: context.descriptor.subjectUri,
                revision: String(context.descriptor.revision),
              }),
            ]),
      ]),
      ...(documentSource === undefined ? {} : { documentSource }),
      documentOrigin: document => {
        const session = byUri.get(document.uri)
        return session === undefined
          ? undefined
          : Object.freeze({
              ...session.origin,
              sourceRevision: languageWorkspaceContextToken({
                version: document.version,
                text: document.text,
              }),
            })
      },
      observeWorkspaceContext: context => {
        observedWorkspaceContext = context
      },
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
          throw new McpOperationError(
            'x3.mcp/language-provider-unresolved',
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
      if (observedWorkspaceContext !== undefined) {
        digest
          .update(observedWorkspaceContext.id)
          .update('\0')
          .update(observedWorkspaceContext.revision)
          .update('\0')
          .update(String(observedWorkspaceContext.semanticComplete))
      }
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
        ...(observedWorkspaceContext === undefined
          ? {}
          : {
              workspaceContext: Object.freeze({
                id: observedWorkspaceContext.id,
                revision: observedWorkspaceContext.revision,
                semanticComplete: observedWorkspaceContext.semanticComplete,
              }),
            }),
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
            throw new McpOperationError('x3.mcp/language-version-stale', 'language overlay version must strictly increase')
          }
          const bytes = new TextEncoder().encode(update.text).byteLength
          const otherBytes = [...byUri.values()]
            .filter(document => document.uri !== update.uri)
            .reduce((sum, document) => sum + new TextEncoder().encode(document.text).byteLength, 0)
          if (bytes > MCP_LANGUAGE_MAX_DOCUMENT_BYTES || otherBytes + bytes > 16_777_216) {
            throw new TypeError('language overlay exceeds session byte limits')
          }
          const next = Object.freeze({ ...current, version: update.version, text: update.text })
          observedWorkspaceContext = undefined
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
          observedWorkspaceContext = undefined
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
  const openModContext = contentSources?.openModContext?.bind(contentSources)
  const port: ModkitMcpHostPort = {
    ...(openModContext === undefined
      ? {}
      : {
          async modContext(subjectUri: string): Promise<McpModContext> {
            const target = subjectTarget(subjectUri)
            if (target === undefined) {
              throw new McpOperationError(
                'x3.mcp/mod-context-target-unavailable',
                'The subject is neither a file nor a path inside a content source.',
              )
            }
            const context = await openModContext({
              schemaVersion: 1,
              target,
              ...(configuration.baseMods === undefined ? {} : { baseMods: configuration.baseMods }),
            })
            try {
              return Object.freeze({
                contextId: context.contextId,
                layers: Object.freeze(
                  context.layers.map(layer =>
                    Object.freeze({
                      displayName: layer.displayName,
                      sourceId: layer.sourceId,
                      sourcePath: layer.sourcePath,
                      role: layer.role,
                      provenance: layer.provenance,
                      ...(layer.fingerprint === undefined ? {} : { fingerprint: layer.fingerprint }),
                    }),
                  ),
                ),
                unresolved: Object.freeze([...context.unresolved]),
              })
            } finally {
              await context.dispose()
            }
          },
        }),
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
    ...(configuration.allowEdits === true
      ? {
          async openResolvedDataWorkspace(resolvedRequest, signal) {
            const directories = resolvedRequest.directories.map(directory => {
              if (!isAbsolute(directory) || !inside(roots, resolve(directory))) {
                throw new TypeError(
                  'resolved workspace directories must be inside configured roots',
                )
              }
              return resolve(directory)
            })
            return openDirectoryResolvedDataWorkspace({
              services: modkit.services,
              gameId: resolvedRequest.gameId,
              directories,
              roots,
              locales: resolvedRequest.locales,
              limits: {
                ...MCP_MAP_PREVIEW_CATALOG_ENRICHMENT_POLICY.limits,
                maxRequirements: resolvedRequest.maxRequirements,
              },
              budgets: mapPreviewBudget,
              ...(signal === undefined ? {} : { signal }),
            })
          },
        }
      : {}),
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
        const primary = openedDocuments[request.primaryIndex]
        if (primary === undefined) throw new RangeError('language primaryIndex is out of bounds')
        const result = await invokeLanguageFeature(
          workspace,
          { uri: primary.uri, version: 1 },
          request,
          analyses[request.primaryIndex],
          signal,
          32,
        )
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
      // A folder (an unpacked map or mod) opens like a file: one host route, with its editing.
      const opened = await modkit.open(canonical, signal)
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
      const session = withPreviewSources(originalSession, preview.session)
      return Object.freeze({
        snapshot: Object.freeze({
          ...opened.snapshot,
          descriptor: (await session.descriptor()) as unknown as typeof opened.snapshot.descriptor,
          diagnostics: Object.freeze([...opened.snapshot.diagnostics, ...preview.diagnostics]),
        }),
        ...(opened.editing === undefined ? {} : { editing: opened.editing }),
        session,
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
      await Promise.all([modkit.close(), contentSources?.dispose(), knowledgeFiles.dispose()])
    },
  }
  return Object.freeze(port)
}
