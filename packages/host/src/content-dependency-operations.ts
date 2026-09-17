import { diagnostic, type Diagnostic } from '@modkit/core'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import type {
  ContentDependencyRequest,
  ContentDependencyResolution,
  ContentSources,
} from '@modkit/vfs/content-sources'
import {
  analyzeReadOnlyContentDependencies,
  contentDependencyDiagnostics,
  createContentDependencyLanguageDocumentSource,
  type AnalyzeReadOnlyContentDependenciesRequest,
} from './content-dependencies.js'
import type { LanguageDocument } from '@modkit/sdk'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from './language/workspace.js'
import type { AnalyzedResolvedDataWorkspace } from './data/index.js'

const DEFAULT_DEPENDENCY_OPERATION = 'content.resolve-dependencies'

export interface ReadOperationContentDependenciesRequest {
  readonly descriptor: Pick<AnyDescriptor, 'operations'>
  readonly operations: OperationSession
  readonly operationId?: string
  readonly signal?: AbortSignal
}

export type ReadOperationContentDependenciesResult =
  | Readonly<{
      state: 'resolved'
      dependencies: ContentDependencyRequest
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

export interface AnalyzeOperationContentDependenciesRequest
  extends Omit<AnalyzeReadOnlyContentDependenciesRequest, 'dependencies'>,
    ReadOperationContentDependenciesRequest {}

function dependencyRequest(value: unknown): ContentDependencyRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Readonly<Record<string, unknown>>
  if (
    record['schemaVersion'] !== 1 ||
    typeof record['gameId'] !== 'string' ||
    record['gameId'].length === 0 ||
    record['gameId'].length > 256 ||
    typeof record['complete'] !== 'boolean' ||
    !Array.isArray(record['dependencies']) ||
    record['dependencies'].length > 256
  ) {
    return undefined
  }
  return value as ContentDependencyRequest
}

/** Invoke the standard dependency operation without granting the codec access to content sources. */
export async function readOperationContentDependencies(
  request: ReadOperationContentDependenciesRequest,
): Promise<ReadOperationContentDependenciesResult> {
  request.signal?.throwIfAborted()
  const operationId = request.operationId ?? DEFAULT_DEPENDENCY_OPERATION
  const declaration = request.descriptor.operations.find(operation => operation.id === operationId)
  if (declaration === undefined || declaration.state !== 'available') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([diagnostic(
        'information',
        'x3.host/content-dependency-operation-unavailable',
        declaration?.reason ?? `the subject does not provide ${operationId}`,
      )]),
    })
  }
  const result = await request.operations.invoke(
    declaration.handlerId,
    {},
    request.signal === undefined ? undefined : { signal: request.signal },
  )
  if (result.state !== 'ok') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          'warning',
          'x3.host/content-dependency-operation-rejected',
          `${operationId} was rejected: ${result.reason}`,
        ),
      ]),
    })
  }
  // A codec whose operation answers with its own workspace lock carries the request beside it.
  const output = result.output.kind === 'json' ? result.output.value : undefined
  const dependencies =
    dependencyRequest(output) ??
    (output !== null && typeof output === 'object' && !Array.isArray(output)
      ? dependencyRequest((output as Readonly<Record<string, unknown>>)['contentDependencies'])
      : undefined)
  if (dependencies === undefined) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...result.diagnostics,
        diagnostic(
          'warning',
          'x3.host/content-dependency-operation-invalid',
          `${operationId} did not return a bounded schemaVersion 1 dependency request`,
        ),
      ]),
    })
  }
  return Object.freeze({
    state: 'resolved',
    dependencies,
    diagnostics: Object.freeze([...result.diagnostics]),
  })
}

/**
 * Turn a subject-owned dependency operation into the normal host-owned resolved Data workspace.
 * Physical cache paths and source credentials remain inside ContentSources and ResourceSession.
 */
export async function analyzeOperationContentDependencies(
  request: AnalyzeOperationContentDependenciesRequest,
): Promise<AnalyzedResolvedDataWorkspace> {
  const discovered = await readOperationContentDependencies(request)
  if (discovered.state === 'unresolved') return discovered
  const analyzed = await analyzeReadOnlyContentDependencies({
    contentSources: request.contentSources,
    dependencies: discovered.dependencies,
    workspaceId: request.workspaceId,
    services: request.services,
    grant: request.grant,
    budgets: request.budgets,
    locales: request.locales,
    queries: request.queries,
    ...(request.localizationKeys === undefined ? {} : { localizationKeys: request.localizationKeys }),
    limits: request.limits,
    ...(request.maximumEntryBytes === undefined ? {} : { maximumEntryBytes: request.maximumEntryBytes }),
    ...(request.resourceLimits === undefined ? {} : { resourceLimits: request.resourceLimits }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  if (analyzed.state === 'unresolved') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([...discovered.diagnostics, ...analyzed.diagnostics]),
    })
  }
  let released = false
  return Object.freeze({
    ...analyzed,
    diagnostics: Object.freeze([...discovered.diagnostics, ...analyzed.diagnostics]),
    async release() {
      if (released) return
      released = true
      await analyzed.release()
    },
  })
}

export interface ContentLanguageSourceLimits {
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  readonly maxEntries: number
}

export interface ContentLanguageSourcesRequest {
  readonly contentSources: ContentSources
  readonly routes: readonly LanguageProviderRoute[]
  readonly limits: ContentLanguageSourceLimits
  /** Subjects whose `content.resolve-dependencies` names the dependency closure to project. */
  readonly subjects: readonly Omit<ReadOperationContentDependenciesRequest, 'signal'>[]
  /** Also project the provider's standing mounts (content loaded regardless of the subject). */
  readonly standingMounts?: boolean
  readonly signal?: AbortSignal
}

export interface ContentLanguageSources {
  readonly sources: readonly LanguageWorkspaceDocumentSource[]
  readonly diagnostics: readonly Diagnostic[]
  /** True when at least one subject was given and every subject's closure resolved completely. */
  readonly dependenciesComplete: boolean
}

/**
 * Read-only language documents from a content provider: each subject's resolved dependency
 * closure, then the provider's standing mounts. Shared by every host that serves language features
 * over packed dependencies (MCP sessions, the standalone LSP), so they project them identically.
 * Standing mounts add documents only; they never make a partial dependency closure complete.
 */
export async function resolveContentLanguageSources(
  request: ContentLanguageSourcesRequest,
): Promise<ContentLanguageSources> {
  const { contentSources, routes, limits, signal } = request
  const sources: LanguageWorkspaceDocumentSource[] = []
  const diagnostics: Diagnostic[] = []
  let complete = request.subjects.length > 0
  const project = (resolution: ContentDependencyResolution) =>
    createContentDependencyLanguageDocumentSource({ contentSources, resolution, routes, ...limits })
  for (const subject of request.subjects) {
    let discovered: ReadOperationContentDependenciesResult
    try {
      discovered = await readOperationContentDependencies({
        ...subject,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      signal?.throwIfAborted()
      discovered = Object.freeze({
        state: 'unresolved',
        diagnostics: Object.freeze([
          diagnostic(
            'warning',
            'x3.host/content-dependency-operation-failed',
            error instanceof Error ? error.message : String(error),
          ),
        ]),
      })
    }
    diagnostics.push(...discovered.diagnostics)
    if (discovered.state !== 'resolved') {
      complete = false
      continue
    }
    if (contentSources.resolveDependencies === undefined) {
      complete = false
      diagnostics.push(
        diagnostic(
          'information',
          'x3.host/content-dependency-resolver-unavailable',
          'the configured content source cannot resolve subject dependencies',
        ),
      )
      continue
    }
    try {
      const resolution = await contentSources.resolveDependencies(discovered.dependencies)
      signal?.throwIfAborted()
      diagnostics.push(...contentDependencyDiagnostics(resolution.diagnostics))
      complete &&= resolution.complete
      if (resolution.mounts.length > 0) sources.push(project(resolution))
    } catch (error) {
      signal?.throwIfAborted()
      complete = false
      diagnostics.push(
        diagnostic(
          'warning',
          'x3.host/content-dependency-resolution-failed',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }
  if (request.standingMounts === true && contentSources.languageMounts !== undefined) {
    try {
      const standing = await contentSources.languageMounts()
      signal?.throwIfAborted()
      diagnostics.push(...contentDependencyDiagnostics(standing.diagnostics))
      if (standing.mounts.length > 0) sources.push(project(standing))
    } catch (error) {
      signal?.throwIfAborted()
      diagnostics.push(
        diagnostic(
          'warning',
          'x3.host/content-language-mounts-failed',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    diagnostics: Object.freeze(diagnostics),
    dependenciesComplete: complete,
  })
}

/**
 * One document source over several, in order: a URI seen earlier (or open in the workspace) is
 * not repeated, and the combined answer is complete only when every part is.
 */
export function composeLanguageDocumentSources(
  sources: readonly LanguageWorkspaceDocumentSource[],
  noteCompleteness?: (complete: boolean) => void,
): LanguageWorkspaceDocumentSource | undefined {
  if (sources.length === 0) return undefined
  if (sources.length === 1 && noteCompleteness === undefined) return sources[0]
  return Object.freeze({
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      const documents: LanguageDocument[] = []
      const seen = new Set(request.workspaceDocuments.map(document => document.uri))
      seen.add(request.document.uri)
      let complete = true
      for (const source of sources) {
        const remaining = request.maxDocuments - documents.length
        if (remaining <= 0) {
          complete = false
          break
        }
        const result = await source.snapshot({ ...request, maxDocuments: remaining })
        complete &&= result.isComplete
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
      noteCompleteness?.(complete)
      return Object.freeze({ documents: Object.freeze(documents), isComplete: complete })
    },
  })
}
