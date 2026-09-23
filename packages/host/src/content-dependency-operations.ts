import { compareUtf8, diagnostic, type Diagnostic } from '@modkit/core'
import type { AnyDescriptor, OperationSession } from '@modkit/sdk'
import {
  HOST_LAYER_SOURCE_ID,
  type ContentDependencyRequest,
  type ContentDependencyResolution,
  type ContentSources,
  type ModContext,
} from '@modkit/vfs/content-sources'
import {
  analyzeReadOnlyContentDependencies,
  contentDependencyDiagnostics,
  createContentDependencyLanguageDocumentSource,
  type AnalyzeReadOnlyContentDependenciesRequest,
} from './content-dependencies.js'
import { createContentDependencyAssetOrigin } from './content-dependencies.js'
import type { CompanionOrigin } from './input-resolution.js'

import type {
  LanguageDocument,
  LanguageWorkspaceContext,
  LanguageWorkspaceDocumentOrigin,
} from '@modkit/sdk/language'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from './language/workspace.js'
import {
  languageWorkspaceContextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './language/context.js'
import type { AnalyzedResolvedDataWorkspace } from './data/index.js'

const DEFAULT_DEPENDENCY_OPERATION = 'content.resolve-dependencies'

export interface ReadOperationContentDependenciesRequest {
  readonly descriptor: Pick<AnyDescriptor, 'operations'> & { readonly subjectUri?: string }
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
  extends
    Omit<AnalyzeReadOnlyContentDependenciesRequest, 'dependencies'>,
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
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'x3.host/content-dependency-operation-unavailable',
          declaration?.reason ?? `the subject does not provide ${operationId}`,
        ),
      ]),
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
    ...(request.localizationKeys === undefined
      ? {}
      : { localizationKeys: request.localizationKeys }),
    limits: request.limits,
    ...(request.maximumEntryBytes === undefined
      ? {}
      : { maximumEntryBytes: request.maximumEntryBytes }),
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

/** A subject whose content closure a host projects. */
export interface ContentSubject extends Omit<ReadOperationContentDependenciesRequest, 'signal'> {
  /**
   * Host path of the subject — a package, a file inside one, or a file inside none. Defaults to
   * the descriptor's `file:` subject URI. With it, the closure comes from the provider's
   * `openModContext`; without it, from the subject's `content.resolve-dependencies` operation.
   */
  readonly target?: string
}

/**
 * Packages a file outside any package opens inside, keyed by the host path of a folder or a file
 * (`*` for anywhere), as the game names them (`Mods/Void.SC2Mod`, or a mod folder's path). Several
 * packages, of several games, may be listed; each game's loader takes the ones it knows.
 */
export type BaseModSetting = Readonly<Record<string, readonly string[]>>

const foldHostPath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()

/** The setting's packages for a host path: the longest key that holds the path wins. */
export function baseModsFor(
  target: string,
  setting: BaseModSetting | undefined,
): readonly string[] | undefined {
  if (setting === undefined) return undefined
  const wanted = foldHostPath(target)
  let best: { readonly length: number; readonly mods: readonly string[] } | undefined
  for (const [key, mods] of Object.entries(setting)) {
    const folded = key === '*' ? '' : foldHostPath(key)
    const holds = folded === '' || wanted === folded || wanted.startsWith(`${folded}/`)
    if (holds && (best === undefined || folded.length > best.length)) {
      best = { length: folded.length, mods }
    }
  }
  return best?.mods
}

/** The host path of a `file:` URI; undefined for any other scheme. */
function hostPathOf(uri: string | undefined): string | undefined {
  if (uri === undefined || !uri.startsWith('file:')) return undefined
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return undefined
  }
  const path = decodeURIComponent(url.pathname)
  if (url.host !== '') return `//${url.host}${path}`
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path
}

/**
 * The layers of a mod context a host reads through its content sources, as the mounts of a
 * dependency closure — dependencies first. The opened package on the host's disk is left out: the
 * host already serves it as the subject itself.
 */
export function modContextResolution(context: ModContext): ContentDependencyResolution {
  return Object.freeze({
    schemaVersion: 1,
    gameId: context.gameId,
    complete: context.unresolved.length === 0,
    mounts: Object.freeze(
      context.layers.flatMap((layer, order) =>
        layer.sourceId === HOST_LAYER_SOURCE_ID
          ? []
          : [
              Object.freeze({
                dependencyId: `${layer.sourceId}:${layer.sourcePath}`,
                order,
                sourceId: layer.sourceId,
                sourcePath: layer.sourcePath,
                displayName: layer.displayName,
                kind: layer.role,
              }),
            ],
      ),
    ),
    dependencies: Object.freeze([]),
    diagnostics: context.diagnostics,
  })
}

interface SubjectClosures {
  readonly resolutions: readonly ContentDependencyResolution[]
  readonly diagnostics: readonly Diagnostic[]
  readonly complete: boolean
}

const failure = (code: string, error: unknown): Diagnostic =>
  diagnostic('warning', code, error instanceof Error ? error.message : String(error))

/**
 * One subject's closure: its mod context when the subject is on disk and the provider opens
 * contexts, else its `content.resolve-dependencies` operation resolved by the provider. The one
 * place every projection — languages, assets, map previews — asks it.
 */
export async function resolveSubjectClosure(request: {
  readonly contentSources: ContentSources
  readonly subject: ContentSubject
  readonly baseMods?: BaseModSetting
  readonly signal?: AbortSignal
}): Promise<{
  readonly resolution?: ContentDependencyResolution
  readonly diagnostics: readonly Diagnostic[]
}> {
  const { contentSources, subject, signal } = request
  const target = subject.target ?? hostPathOf(subject.descriptor.subjectUri)
  if (target !== undefined && contentSources.openModContext !== undefined) {
    try {
      const baseMods = baseModsFor(target, request.baseMods)
      const context = await contentSources.openModContext({
        schemaVersion: 1,
        target,
        ...(baseMods === undefined ? {} : { baseMods }),
      })
      try {
        signal?.throwIfAborted()
        const resolution = modContextResolution(context)
        return Object.freeze({
          resolution,
          diagnostics: contentDependencyDiagnostics(resolution.diagnostics),
        })
      } finally {
        await context.dispose()
      }
    } catch (error) {
      signal?.throwIfAborted()
      return Object.freeze({ diagnostics: Object.freeze([failure('x3.host/mod-context-failed', error)]) })
    }
  }
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
      diagnostics: Object.freeze([failure('x3.host/content-dependency-operation-failed', error)]),
    })
  }
  if (discovered.state !== 'resolved') return Object.freeze({ diagnostics: discovered.diagnostics })
  if (contentSources.resolveDependencies === undefined) {
    return Object.freeze({
      diagnostics: Object.freeze([
        ...discovered.diagnostics,
        diagnostic(
          'information',
          'x3.host/content-dependency-resolver-unavailable',
          'the configured content source cannot resolve subject dependencies',
        ),
      ]),
    })
  }
  try {
    const resolution = await contentSources.resolveDependencies(discovered.dependencies)
    signal?.throwIfAborted()
    return Object.freeze({
      resolution,
      diagnostics: Object.freeze([
        ...discovered.diagnostics,
        ...contentDependencyDiagnostics(resolution.diagnostics),
      ]),
    })
  } catch (error) {
    signal?.throwIfAborted()
    return Object.freeze({
      diagnostics: Object.freeze([
        ...discovered.diagnostics,
        failure('x3.host/content-dependency-resolution-failed', error),
      ]),
    })
  }
}

/**
 * Each subject's dependency closure, then the provider's standing mounts — the two answers every
 * projection below is built from. Standing mounts a subject's closure already holds are dropped,
 * and they never make a partial closure complete.
 */
async function subjectClosures(request: {
  readonly contentSources: ContentSources
  readonly subjects: readonly ContentSubject[]
  readonly baseMods?: BaseModSetting
  readonly standingMounts?: boolean
  readonly signal?: AbortSignal
}): Promise<SubjectClosures> {
  const { contentSources, signal } = request
  const resolutions: ContentDependencyResolution[] = []
  const diagnostics: Diagnostic[] = []
  let complete = request.subjects.length > 0
  for (const subject of request.subjects) {
    const closure = await resolveSubjectClosure({
      contentSources,
      subject,
      ...(request.baseMods === undefined ? {} : { baseMods: request.baseMods }),
      ...(signal === undefined ? {} : { signal }),
    })
    diagnostics.push(...closure.diagnostics)
    if (closure.resolution === undefined) complete = false
    else {
      complete &&= closure.resolution.complete
      resolutions.push(closure.resolution)
    }
  }
  if (request.standingMounts === true && contentSources.languageMounts !== undefined) {
    try {
      const standing = await contentSources.languageMounts()
      signal?.throwIfAborted()
      diagnostics.push(...contentDependencyDiagnostics(standing.diagnostics))
      const held = new Set(
        resolutions.flatMap(resolution =>
          resolution.mounts.map(mount => `${mount.sourceId}\0${foldHostPath(mount.sourcePath)}`),
        ),
      )
      resolutions.push(
        Object.freeze({
          ...standing,
          mounts: Object.freeze(
            standing.mounts.filter(
              mount => !held.has(`${mount.sourceId}\0${foldHostPath(mount.sourcePath)}`),
            ),
          ),
        }),
      )
    } catch (error) {
      signal?.throwIfAborted()
      diagnostics.push(failure('x3.host/content-language-mounts-failed', error))
    }
  }
  return Object.freeze({
    resolutions: Object.freeze(resolutions.filter(resolution => resolution.mounts.length > 0)),
    diagnostics: Object.freeze(diagnostics),
    complete,
  })
}

export interface ContentAssetOriginsRequest {
  readonly contentSources: ContentSources
  /** Subjects whose content closure to project. */
  readonly subjects: readonly ContentSubject[]
  /** Packages a subject outside any package opens inside, per host path. */
  readonly baseMods?: BaseModSetting
  /** Also project the provider's standing mounts (content the game loads whatever is open). */
  readonly standingMounts?: boolean
  readonly maximumEntryBytes?: number
  readonly signal?: AbortSignal
}

export interface ContentAssetOrigins {
  /** Weakest first; a subject open searches them in this order behind its own directory. */
  readonly origins: readonly CompanionOrigin[]
  readonly diagnostics: readonly Diagnostic[]
  /** True when every subject given resolved its closure completely. */
  readonly dependenciesComplete: boolean
}

/**
 * Where a subject's *resources* may be found, as the mod it belongs to and what that mod depends on.
 *
 * The twin of `resolveContentLanguageSources`, over the same closures, because "which files does
 * this document read" and "which files does this model's texture come out of" are the same question
 * asked of the same provider.
 */
export async function resolveContentAssetOrigins(
  request: ContentAssetOriginsRequest,
): Promise<ContentAssetOrigins> {
  const closures = await subjectClosures(request)
  return Object.freeze({
    origins: Object.freeze(
      closures.resolutions.flatMap(resolution => {
        const origin = createContentDependencyAssetOrigin({
          contentSources: request.contentSources,
          resolution,
          ...(request.maximumEntryBytes === undefined
            ? {}
            : { maximumEntryBytes: request.maximumEntryBytes }),
        })
        return origin === undefined ? [] : [origin]
      }),
    ),
    diagnostics: closures.diagnostics,
    dependenciesComplete: closures.complete,
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
  /** Subjects whose content closure to project. */
  readonly subjects: readonly ContentSubject[]
  /** Packages a subject outside any package opens inside, per host path. */
  readonly baseMods?: BaseModSetting
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
 * Read-only language documents from a content provider: each subject's closure, then the
 * provider's standing mounts. Shared by every host that serves language features over packed
 * dependencies (VS Code, MCP sessions, the standalone LSP), so they project them identically.
 */
export async function resolveContentLanguageSources(
  request: ContentLanguageSourcesRequest,
): Promise<ContentLanguageSources> {
  const { contentSources, routes, limits } = request
  const closures = await subjectClosures(request)
  return Object.freeze({
    sources: Object.freeze(
      closures.resolutions.map(resolution =>
        createContentDependencyLanguageDocumentSource({
          contentSources,
          resolution,
          routes,
          ...limits,
        }),
      ),
    ),
    diagnostics: closures.diagnostics,
    dependenciesComplete: closures.complete,
  })
}

/**
 * One document source over several sources ordered from weakest to strongest. An open URI is never
 * repeated; a later source replaces an earlier source with the same URI. The combined answer is
 * complete only when every part is.
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
      const originsByUri = new Map<string, LanguageWorkspaceDocumentOrigin>()
      const contexts: LanguageWorkspaceContext[] = []
      const openUris = new Set(request.workspaceDocuments.map(document => document.uri))
      openUris.add(request.document.uri)
      const documentIndex = new Map<string, number>()
      let complete = true
      let contextsComplete = true
      let precedenceBase = 0
      for (const source of sources) {
        const remaining = request.maxDocuments - documents.length
        if (remaining <= 0) {
          complete = false
          break
        }
        const result = await source.snapshot({ ...request, maxDocuments: remaining })
        complete &&= result.isComplete
        if (result.workspaceContext === undefined) contextsComplete = false
        else contexts.push(result.workspaceContext)
        const origins = new Map(
          (result.workspaceContext?.documentOrigins ?? []).map(origin => [origin.uri, origin]),
        )
        let maximumPrecedence = -1
        for (const origin of origins.values()) {
          maximumPrecedence = Math.max(maximumPrecedence, origin.precedence)
          if (!openUris.has(origin.uri)) continue
          originsByUri.set(
            origin.uri,
            Object.freeze({
              ...origin,
              precedence: precedenceBase + origin.precedence,
            }),
          )
        }
        for (const document of result.documents) {
          if (openUris.has(document.uri)) continue
          const existingIndex = documentIndex.get(document.uri)
          if (existingIndex === undefined && documents.length >= request.maxDocuments) {
            complete = false
            break
          }
          if (existingIndex === undefined) {
            documentIndex.set(document.uri, documents.length)
            documents.push(document)
          } else documents[existingIndex] = document
          const origin = origins.get(document.uri)
          if (origin !== undefined) {
            originsByUri.set(
              document.uri,
              Object.freeze({
                ...origin,
                precedence: precedenceBase + origin.precedence,
              }),
            )
          } else {
            contextsComplete = false
            originsByUri.delete(document.uri)
          }
        }
        precedenceBase += Math.max(1, maximumPrecedence + 1)
      }
      noteCompleteness?.(complete)
      const semanticInputs = validatedLanguageWorkspaceSemanticInputs(
        contexts.flatMap(context => context.semanticInputs ?? []),
      )
      const workspaceContext =
        contexts.length === 0
          ? undefined
          : Object.freeze({
              id: languageWorkspaceContextToken(contexts.map(context => context.id)),
              revision: languageWorkspaceContextToken(
                contexts.map(context => ({
                  id: context.id,
                  revision: context.revision,
                  semanticInputs: context.semanticInputs,
                })),
              ),
              semanticComplete:
                complete &&
                contextsComplete &&
                contexts.length === sources.length &&
                contexts.every(context => context.semanticComplete),
              documentOrigins: Object.freeze(
                [
                  ...new Map(
                    [...request.workspaceDocuments, request.document, ...documents].map(
                      document => [document.uri, document],
                    ),
                  ).values(),
                ].flatMap(document => {
                  const origin = originsByUri.get(document.uri)
                  return origin === undefined ? [] : [origin]
                }),
              ),
              semanticInputs,
            })
      return Object.freeze({
        documents: Object.freeze(documents),
        isComplete: complete,
        ...(workspaceContext === undefined ? {} : { workspaceContext }),
      })
    },
  })
}
