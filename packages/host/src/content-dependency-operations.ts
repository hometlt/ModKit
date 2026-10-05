/**
 * Host orchestration for subject dependency closures and their companion/language projections.
 * ContentSources owns package detection and native dependency rules. These adapters select base
 * mods, dispose opened contexts or transfer their leases, combine read-only resource origins and
 * compose language snapshots by layer precedence. Unavailable sources remain diagnostic/incomplete;
 * immutable semantic captures retain byte-sensitive identity without trusting caller revisions.
 */
import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  HOST_LAYER_SOURCE_ID,
  type ContentDependencyResolution,
  type ContentSources,
  type ModContext,
  type ModContextTarget,
} from '@modkit/vfs/content-sources'
import {
  contentDependencyDiagnostics,
  createContentDependencyLanguageDocumentSource,
} from './content-dependencies.js'
import { createContentDependencyAssetOrigin } from './content-dependencies.js'
import {
  createLayeredCompanionOrigin,
  normalizeCompanionLogicalId,
  type CompanionOrigin,
} from './input-resolution.js'
import { artifactByteSourceFromBytes } from './source-bridge.js'
import { revisionIdFromRef } from '@modkit/sdk'

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
} from './language/index.js'

/** A subject whose content closure a host projects. */
export interface ContentSubject {
  readonly descriptor: { readonly subjectUri?: string }
  /**
   * Where the subject is: a host path (a package, a file inside one, or a file inside none) or a
   * path inside one of the content sources. Defaults to the descriptor's `file:` or
   * `content-source://` subject URI; a host with its own schemes passes it.
   */
  readonly target?: ModContextTarget
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

/**
 * The target a subject URI names: the host path of a `file:` URI, or the source and path of a
 * `content-source://<source>/<path>` URI; undefined for any other scheme.
 */
export function subjectTarget(uri: string | undefined): ModContextTarget | undefined {
  if (uri === undefined) return undefined
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return undefined
  }
  if (url.protocol === 'content-source:') {
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const sourceId = decodeURIComponent(url.host)
    return sourceId === '' ? undefined : Object.freeze({ sourceId, path: segments.join('/') })
  }
  if (url.protocol !== 'file:') return undefined
  const path = decodeURIComponent(url.pathname)
  if (url.host !== '') return `//${url.host}${path}`
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path
}

/**
 * The layers of a mod context a host reads through its content sources, as the mounts of a
 * dependency closure — dependencies first. Anything on the host's own disk is left out: no content
 * source reads it, and the host serves it (the opened package among it). An opened package inside a
 * content source (a CASC mod) stays: no host serves it, and without it a document of that mod sees
 * none of its siblings — no references to `Marine` from Liberty's own data.
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
                ...(layer.fingerprint === undefined ? {} : { fingerprint: layer.fingerprint }),
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
 * One subject's closure: the mod context the provider opens for it. The one place every
 * projection — languages, assets, map previews — asks it.
 */
export async function resolveSubjectClosure(request: {
  readonly contentSources: ContentSources
  readonly subject: ContentSubject
  readonly baseMods?: BaseModSetting
  /** Hand the opened mod context back (the caller disposes it) instead of closing it here. */
  readonly keepContext?: boolean
  readonly signal?: AbortSignal
}): Promise<{
  readonly resolution?: ContentDependencyResolution
  readonly context?: ModContext
  readonly diagnostics: readonly Diagnostic[]
}> {
  const { contentSources, subject, signal } = request
  const target = subject.target ?? subjectTarget(subject.descriptor.subjectUri)
  if (target === undefined) {
    return Object.freeze({
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'x3.host/mod-context-target-unavailable',
          `${subject.descriptor.subjectUri ?? 'the subject'} is neither a host path nor a content-source path`,
        ),
      ]),
    })
  }
  if (contentSources.openModContext === undefined) {
    return Object.freeze({
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'x3.host/mod-context-unavailable',
          'the configured content sources do not open mod contexts',
        ),
      ]),
    })
  }
  try {
    // Only the `*` entry of the setting applies to a path inside a content source.
    const baseMods = baseModsFor(typeof target === 'string' ? target : '', request.baseMods)
    const context = await contentSources.openModContext({
      schemaVersion: 1,
      target,
      ...(baseMods === undefined ? {} : { baseMods }),
    })
    let kept = false
    try {
      signal?.throwIfAborted()
      const resolution = modContextResolution(context)
      kept = request.keepContext === true
      return Object.freeze({
        resolution,
        ...(kept ? { context } : {}),
        diagnostics: contentDependencyDiagnostics(resolution.diagnostics),
      })
    } finally {
      if (!kept) await context.dispose()
    }
  } catch (error) {
    signal?.throwIfAborted()
    return Object.freeze({
      diagnostics: Object.freeze([failure('x3.host/mod-context-failed', error)]),
    })
  }
}

/** Each subject's dependency closure — the answer every projection below is built from. */
async function subjectClosures(request: {
  readonly contentSources: ContentSources
  readonly subjects: readonly ContentSubject[]
  readonly baseMods?: BaseModSetting
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

export interface ContentAssetOriginRequest {
  readonly contentSources: ContentSources
  /** The subject being opened: a host path, or a path inside one of the content sources. */
  readonly target: ModContextTarget
  readonly baseMods?: BaseModSetting
  readonly maximumEntryBytes?: number
  /** Why the subject's mod gave no resources (no context, a failed closure), when it did not. */
  readonly onDiagnostic?: (item: Diagnostic) => void
}

/**
 * The resources of the mod one subject belongs to, for an ordinary open: the same closure as
 * {@link resolveContentAssetOrigins}, resolved only when a codec first asks for a resource in the
 * `workspace-dependency-layer` scope. A file that needs nothing from its mod opens without a mod
 * context; a map on disk that asks for its tileset, or a model for its texture, gets the layers.
 */
export function createContentAssetOrigin(request: ContentAssetOriginRequest): CompanionOrigin {
  let layers: Promise<CompanionOrigin | undefined> | undefined
  // No caller's signal here: the closure is shared by every later request of this open.
  const resolved = () =>
    (layers ??= resolveContentAssetOrigins({
      contentSources: request.contentSources,
      subjects: [{ descriptor: {}, target: request.target }],
      ...(request.baseMods === undefined ? {} : { baseMods: request.baseMods }),
      ...(request.maximumEntryBytes === undefined
        ? {}
        : { maximumEntryBytes: request.maximumEntryBytes }),
    }).then(result => {
      for (const item of result.diagnostics) request.onDiagnostic?.(item)
      return result.origins.length === 0 ? undefined : createLayeredCompanionOrigin(result.origins)
    }))
  const maximumEntryBytes = request.maximumEntryBytes ?? 64 * 1024 * 1024
  /**
   * A path in the game's own spelling that no layer holds as spelled (StarCraft II's
   * `Assets/Textures/btn-x.dds`, kept under `Base.SC2Assets` or a locale component): the mod
   * context's `locate` knows where the game keeps it. Read once, a context opened for the question
   * alone; an answer, or none, is kept for this open.
   */
  const located = new Map<
    string,
    Promise<Readonly<{ uri: string; revision: string; bytes: Uint8Array }> | undefined>
  >()
  const locate = (path: string) => {
    const key = path.toLowerCase()
    let found = located.get(key)
    if (found === undefined) {
      found = (async () => {
        if (request.contentSources.openModContext === undefined) return undefined
        const baseMods = baseModsFor(
          typeof request.target === 'string' ? request.target : '',
          request.baseMods,
        )
        const context = await request.contentSources.openModContext({
          schemaVersion: 1,
          target: request.target,
          ...(baseMods === undefined ? {} : { baseMods }),
        })
        try {
          const place = await context.locate(path)
          if (place === undefined) return undefined
          const layer = context.layers.find(item => item.id === place.layerId)
          const bytes = await context.read(place.layerId, place.path, maximumEntryBytes)
          const at = `${layer?.sourcePath ?? place.layerId}/${place.path}`
          return Object.freeze({
            uri:
              layer === undefined || layer.sourceId === HOST_LAYER_SOURCE_ID
                ? `mod-context-layer:${encodeURIComponent(place.layerId)}/${place.path.split('/').map(encodeURIComponent).join('/')}`
                : `content-source://${encodeURIComponent(layer.sourceId)}/${at.split('/').map(encodeURIComponent).join('/')}`,
            revision: layer?.fingerprint ?? `${context.contextId}\0${at}`,
            bytes,
          })
        } finally {
          await context.dispose()
        }
      })().catch(() => undefined)
      located.set(key, found)
    }
    return found
  }
  return Object.freeze({
    primaryLogicalId: '__content_dependency_workspace__',
    caseSensitivity: 'insensitive' as const,
    scopes: Object.freeze(['workspace-dependency-layer'] as const),
    async *enumerate(scope, options, signal) {
      const origin = await resolved()
      const path =
        options.prefix === '' || options.prefix.endsWith('/')
          ? ''
          : normalizeCompanionLogicalId(options.prefix)
      // a prefix the layers answer (the path itself, or a partial name of a listed file) needs no
      // locate; only a path no layer lists at all is asked where the game keeps it
      let answered = false
      if (origin !== undefined)
        for await (const entry of origin.enumerate(scope, options, signal)) {
          answered = true
          yield entry
        }
      if (answered || path === '' || options.namePrefix !== undefined) return
      const asset = await locate(path)
      if (asset !== undefined) yield Object.freeze({ logicalId: path })
    },
    async open(logicalId, signal) {
      const origin = await resolved()
      const path = normalizeCompanionLogicalId(logicalId)
      const asset = located.has(path.toLowerCase()) ? await locate(path) : undefined
      if (asset !== undefined) {
        const source = artifactByteSourceFromBytes(
          Object.freeze({ id: `mod-context:${path}`, uri: asset.uri }),
          revisionIdFromRef({ kind: 'provider-token', value: asset.revision }),
          asset.bytes,
        )
        return Object.freeze({ value: source, release: async () => undefined })
      }
      if (origin === undefined) throw new TypeError(`no mod layer holds «${logicalId}»`)
      return origin.open(logicalId, signal)
    },
  } satisfies CompanionOrigin)
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
  readonly signal?: AbortSignal
}

export interface ContentLanguageSources {
  readonly sources: readonly LanguageWorkspaceDocumentSource[]
  readonly diagnostics: readonly Diagnostic[]
  /** True when at least one subject was given and every subject's closure resolved completely. */
  readonly dependenciesComplete: boolean
}

/**
 * Read-only language documents from a content provider: each subject's closure. Shared by every host that serves language features over packed
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
                  // Captured inputs retain byte-sensitive tokens; composing them need not rehash
                  // the complete immutable payload on every request. Foreign inputs still validate.
                  semanticInputs: validatedLanguageWorkspaceSemanticInputs(
                    context.semanticInputs ?? [],
                  ).map(input => languageWorkspaceContextToken(input)),
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
