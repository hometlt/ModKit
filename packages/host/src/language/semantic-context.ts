/**
 * Host-owned language semantic context: validate provider requirements, prepare ordered Data and
 * localization inputs, invoke the canonical Data provider under workspace budgets and retain its
 * full authoring values/provenance. Partial results carry bounded diagnostic reasons; cancellation
 * propagates and every opened Data workspace releases through its normal lifecycle.
 *
 * A prepared context is keyed by what the provider analyses — each document's layer, logical path
 * and text, the locales, budgets and completeness — never by editor URIs, versions or overlays, so
 * opening a file of a loaded mod reuses its analysis. A complete analysis whose strongest Data layer
 * is one of the provider's persistent roots may also be kept by a host-supplied store
 * (`LanguageSemanticContextStore`, Node: `createResolvedDataContextStore`): stored under the same
 * content key plus the provider artifacts, one per chain slot, and validated again when loaded.
 */
import { compareUtf8, isCancellation, throwIfAborted } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import {
  RESOLVED_DATA_AUTHORING_INDEX_KIND,
  type DataCatalogDocument,
  type DataLocalizationDocument,
  type ResolvedDataAuthoringIndex,
  type ResolvedDataPersistentRoot,
  type ResolvedDataWorkspaceAnalysisRequest,
  type ResolvedDataWorkspaceSnapshot,
} from '@modkit/sdk/data'
import type {
  LanguageDocument,
  LanguageResolvedDataSemanticContextRequirement,
  LanguageSemanticContextRequirement,
  LanguageWorkspaceDocumentOrigin,
  LanguageWorkspaceSemanticInput,
} from '@modkit/sdk/language'
import {
  resolvedDataPersistentRoots,
  resolveResolvedDataWorkspace,
  type DataHostServices,
} from '../data/index.js'
import {
  LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES,
  languageWorkspaceContextToken,
  languageDocumentTextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './context.js'

const MAX_SEMANTIC_CONTEXT_REQUIREMENTS = 8
const MAX_LANGUAGE_RESOLVED_DATA_ENTITIES = 100_000
const MAX_LANGUAGE_AUTHORING_INDEX_BYTES = 48 * 1_024 * 1_024
const MAX_LANGUAGE_RESOLVED_DATA_INPUT_BYTES = 256 * 1_024 * 1_024

const boundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

/** Validate and copy provider declarations before the host acts on them. */
export function validatedLanguageSemanticContextRequirements(
  value: unknown,
): readonly LanguageSemanticContextRequirement[] {
  if (!Array.isArray(value) || value.length > MAX_SEMANTIC_CONTEXT_REQUIREMENTS) {
    throw new TypeError('language semantic context requirements are invalid')
  }
  const requirements: LanguageSemanticContextRequirement[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const keys = typeof item === 'object' && item !== null ? Reflect.ownKeys(item) : []
    const knowledge =
      typeof item === 'object' &&
      item !== null &&
      (item as { kind?: unknown }).kind === 'language-knowledge'
    const allowed = knowledge
      ? ['kind', 'fileNames']
      : ['kind', 'gameId', 'languageIds', 'localizationLanguageIds']
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item) ||
      (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) ||
      keys.some(key => typeof key !== 'string' || !allowed.includes(key))
    ) {
      throw new TypeError('language semantic context requirement is invalid')
    }
    if (knowledge) {
      const fileNames = Object.getOwnPropertyDescriptor(item, 'fileNames')?.value
      // Plain file names at a layer root: no separators, one requirement per provider.
      if (
        seen.has('\0language-knowledge') ||
        !Array.isArray(fileNames) ||
        fileNames.length === 0 ||
        fileNames.length > 8 ||
        !fileNames.every(
          name =>
            boundedText(name) &&
            name.length <= 255 &&
            !/[\\/:*?"<>|]/u.test(name) &&
            name !== '.' &&
            name !== '..',
        ) ||
        new Set(fileNames.map(name => (name as string).toLowerCase())).size !== fileNames.length
      ) {
        throw new TypeError('language semantic context requirement is invalid')
      }
      seen.add('\0language-knowledge')
      requirements.push(
        Object.freeze({ kind: 'language-knowledge', fileNames: Object.freeze([...fileNames]) }),
      )
      continue
    }
    const descriptors = Object.getOwnPropertyDescriptors(item)
    if (
      keys.some(key => {
        if (typeof key !== 'string') return true
        const descriptor = descriptors[key]
        return descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)
      })
    ) {
      throw new TypeError('language semantic context requirement is invalid')
    }
    const kind = descriptors['kind']?.value
    const gameId = descriptors['gameId']?.value
    const languageIds = descriptors['languageIds']?.value
    const localizationLanguageIds = descriptors['localizationLanguageIds']?.value
    const idList = (value: unknown): value is string[] =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 16 &&
      Object.keys(value).length === value.length &&
      value.every(boundedText) &&
      new Set(value).size === value.length
    if (
      kind !== 'resolved-data-snapshot' ||
      (localizationLanguageIds !== undefined && !idList(localizationLanguageIds)) ||
      !boundedText(gameId) ||
      !Array.isArray(languageIds) ||
      languageIds.length === 0 ||
      languageIds.length > 16 ||
      Object.keys(languageIds).length !== languageIds.length ||
      !languageIds.every(boundedText) ||
      new Set(languageIds).size !== languageIds.length ||
      seen.has(gameId)
    ) {
      throw new TypeError('language semantic context requirement is invalid')
    }
    seen.add(gameId)
    requirements.push(
      Object.freeze({
        kind,
        gameId,
        languageIds: Object.freeze([...languageIds]),
        ...(localizationLanguageIds === undefined
          ? {}
          : { localizationLanguageIds: Object.freeze([...localizationLanguageIds]) }),
      }),
    )
  }
  return Object.freeze(requirements)
}

export interface PreparedResolvedDataSemanticContext {
  /** What the provider analyses (layers, logical paths, texts, locales, budgets, completeness). */
  readonly key: string
  /** Stable across edits to the same logical document set; used only for stale-while-editing reads. */
  readonly scopeKey: string
  readonly workspaceId: string
  readonly documents: readonly DataCatalogDocument[]
  /** Preferred locale first, from the workspace's `locale-set` input. */
  readonly locales: readonly string[]
  readonly localizationDocuments: readonly DataLocalizationDocument[]
  readonly complete: boolean
  /** Present for a complete context with documents: what a host may keep of it on disk. */
  readonly persistence?: PreparedResolvedDataPersistence
}

/** One layer a snapshot's `dependency-closure` input names (payload `{ layers }`). */
export interface LanguageContextLayer {
  readonly layerId: string
  readonly sourceId?: string
  readonly sourcePath?: string
}

/** How a complete context is kept: its slot, its label and the layer persistent roots match. */
export interface PreparedResolvedDataPersistence {
  /** One kept analysis per slot: the same layers under the same requirement, locales and budgets. */
  readonly slot: string
  /** The chain as a person reads it (`Mods/Core.SC2Mod → Mods/Liberty.SC2Mod · enUS`). */
  readonly label: string
  /** The strongest Data layer: its content-source path, or the host folder it was read from. */
  readonly top: Readonly<{ sourcePath?: string; directory?: string }>
}

/** The layers the `dependency-closure` inputs name, in order; malformed entries are skipped. */
export function semanticInputLayers(
  inputs: readonly LanguageWorkspaceSemanticInput[],
): readonly LanguageContextLayer[] {
  const layers: LanguageContextLayer[] = []
  for (const input of inputs) {
    if (input.kind !== 'dependency-closure') continue
    const listed = (input.payload as { readonly layers?: unknown } | undefined)?.layers
    if (!Array.isArray(listed)) continue
    for (const item of listed as unknown[]) {
      const layer = item as Partial<Record<'layerId' | 'sourceId' | 'sourcePath', unknown>> | null
      if (typeof layer !== 'object' || layer === null || !boundedText(layer.layerId)) continue
      layers.push(
        Object.freeze({
          layerId: layer.layerId,
          ...(boundedText(layer.sourceId) ? { sourceId: layer.sourceId } : {}),
          ...(boundedText(layer.sourcePath) ? { sourcePath: layer.sourcePath } : {}),
        }),
      )
    }
  }
  return Object.freeze(layers)
}

/** The host folder a `file:` document was read from: its path without the logical path. */
function fileDirectory(uri: string, logicalId: string): string | undefined {
  if (!uri.startsWith('file:')) return undefined
  let path: string
  try {
    path = decodeURIComponent(new URL(uri).pathname)
  } catch {
    return undefined
  }
  if (/^\/[A-Za-z]:/u.test(path)) path = path.slice(1)
  const suffix = `/${logicalId}`
  if (
    path.length <= suffix.length ||
    path.slice(-suffix.length).toLowerCase() !== suffix.toLowerCase()
  ) {
    return undefined
  }
  return path.slice(0, -suffix.length)
}

const comparablePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()

/** Whether a provider's persistent roots name the context's strongest Data layer. */
export function persistentRootsInclude(
  roots: readonly ResolvedDataPersistentRoot[],
  top: PreparedResolvedDataPersistence['top'],
): boolean {
  const named = [top.sourcePath, top.directory].flatMap(path =>
    path === undefined ? [] : [comparablePath(path)],
  )
  return roots.some(root =>
    [root.sourcePath, root.path].some(
      path => path !== undefined && named.includes(comparablePath(path)),
    ),
  )
}

/** The locales a workspace's `locale-set` input names (payload `{ locales }`), preferred first. */
export function semanticInputLocales(
  inputs: readonly LanguageWorkspaceSemanticInput[],
): readonly string[] {
  for (const input of inputs) {
    if (input.kind !== 'locale-set') continue
    const locales = (input.payload as { readonly locales?: unknown } | undefined)?.locales
    if (Array.isArray(locales) && locales.every(boundedText)) return Object.freeze([...locales])
  }
  return Object.freeze([])
}

/** The first locale that begins one of the path's segments (`enUS.SC2Data/…` is enUS). */
function localeOfPath(path: string, locales: readonly string[]): string | undefined {
  const segments = path.split('/').map(segment => segment.toLowerCase())
  return locales.find(locale => segments.some(segment => segment.startsWith(locale.toLowerCase())))
}

export function prepareResolvedDataSemanticContext(request: {
  readonly requirement: LanguageResolvedDataSemanticContextRequirement
  readonly documents: readonly LanguageDocument[]
  readonly origins: ReadonlyMap<string, LanguageWorkspaceDocumentOrigin>
  readonly complete: boolean
  /** From `semanticInputLocales`; without locales no string file enters the analysis. */
  readonly locales?: readonly string[]
  readonly budgets?: ResourceBudget
  /** From `semanticInputLayers`: names content-source layers for persistence slots and labels. */
  readonly layers?: readonly LanguageContextLayer[]
}): PreparedResolvedDataSemanticContext {
  let complete = request.complete
  const locales = request.locales ?? []
  const localizationLanguageIds = request.requirement.localizationLanguageIds ?? []
  const localizationDocuments = request.documents.flatMap(document => {
    const origin = request.origins.get(document.uri)
    if (!localizationLanguageIds.includes(document.languageId) || origin === undefined) return []
    const locale = localeOfPath(origin.logicalId, locales)
    return locale === undefined
      ? []
      : [
          {
            origin,
            sourceDocument: document,
            document: Object.freeze({
              rootId: origin.layerId,
              path: origin.logicalId,
              text: document.text,
              locale,
            }),
          },
        ]
  })
  localizationDocuments.sort(
    (left, right) =>
      left.origin.precedence - right.origin.precedence ||
      compareUtf8(left.origin.logicalId, right.origin.logicalId),
  )
  const selected = request.documents
    .filter(document => request.requirement.languageIds.includes(document.languageId))
    .map(document => ({ document, origin: request.origins.get(document.uri) }))
    .sort((left, right) => {
      if (left.origin === undefined) return right.origin === undefined ? 0 : 1
      if (right.origin === undefined) return -1
      return (
        left.origin.precedence - right.origin.precedence ||
        compareUtf8(left.origin.logicalId, right.origin.logicalId) ||
        compareUtf8(left.document.uri, right.document.uri)
      )
    })
  const documents = selected.flatMap(({ document, origin }) => {
    if (origin === undefined) {
      complete = false
      return []
    }
    return [
      Object.freeze({
        rootId: origin.layerId,
        path: origin.logicalId,
        text: document.text,
      }),
    ]
  })
  const budgets =
    request.budgets === undefined
      ? undefined
      : {
          ...request.budgets,
          maxInputBytes: String(request.budgets.maxInputBytes),
        }
  // Exactly what the provider reads, in its order: editor URIs, versions and overlay flags of the
  // same text change nothing it answers, so they stay out of the key.
  const analysed = selected.flatMap(({ document, origin }) =>
    origin === undefined
      ? []
      : [
          {
            layerId: origin.layerId,
            logicalId: origin.logicalId,
            languageId: document.languageId,
            contentRevision: languageDocumentTextToken(document),
          },
        ],
  )
  const localizationIdentities = localizationDocuments.map(
    ({ document, origin, sourceDocument }) => ({
      path: origin.logicalId,
      layerId: origin.layerId,
      locale: document.locale,
      contentRevision: languageDocumentTextToken(sourceDocument),
    }),
  )
  const key = languageWorkspaceContextToken({
    requirement: request.requirement,
    documents: analysed,
    locales,
    localization: localizationIdentities,
    budgets,
    complete,
  })
  const scopeKey = languageWorkspaceContextToken({
    requirement: request.requirement,
    locales,
    budgets,
    documents: selected.map(({ document, origin }) => ({
      uri: document.uri,
      languageId: document.languageId,
      origin:
        origin === undefined
          ? undefined
          : {
              layerId: origin.layerId,
              logicalId: origin.logicalId,
              precedence: origin.precedence,
            },
    })),
    complete,
  })
  const persistence = complete
    ? resolvedDataPersistence(request, selected, locales, budgets)
    : undefined
  return Object.freeze({
    key,
    scopeKey,
    workspaceId: `language:${key}`,
    documents: Object.freeze(documents),
    locales,
    localizationDocuments: Object.freeze(localizationDocuments.map(item => item.document)),
    complete,
    ...(persistence === undefined ? {} : { persistence }),
  })
}

/**
 * The slot, label and strongest layer of a complete context. The slot names the analysed layers in
 * order, so a later analysis of the same chain (an edit, a new game build) replaces the kept one;
 * the strongest layer is a content-source package or the host folder of `file:` documents.
 */
function resolvedDataPersistence(
  request: Parameters<typeof prepareResolvedDataSemanticContext>[0],
  selected: readonly {
    readonly document: LanguageDocument
    readonly origin: LanguageWorkspaceDocumentOrigin | undefined
  }[],
  locales: readonly string[],
  budgets: unknown,
): PreparedResolvedDataPersistence | undefined {
  const closure = new Map((request.layers ?? []).map(layer => [layer.layerId, layer]))
  // Layers in precedence order (documents arrive sorted weakest first).
  const byLayer = new Map<string, { layerId: string; sourcePath?: string; directory?: string }>()
  for (const { document, origin } of selected) {
    if (origin === undefined) continue
    const layer = byLayer.get(origin.layerId) ?? { layerId: origin.layerId }
    if (!byLayer.has(origin.layerId)) {
      const sourcePath = closure.get(origin.layerId)?.sourcePath
      if (sourcePath !== undefined) layer.sourcePath = sourcePath
      byLayer.set(origin.layerId, layer)
    }
    if (layer.directory === undefined) {
      const directory = fileDirectory(document.uri, origin.logicalId)
      if (directory !== undefined) layer.directory = directory
    }
  }
  const layers = [...byLayer.values()]
  const top = layers.at(-1)
  if (top === undefined) return undefined
  const label = layers
    .map(layer => layer.sourcePath ?? layer.directory ?? layer.layerId)
    .join(' → ')
  return Object.freeze({
    slot: languageWorkspaceContextToken({
      requirement: request.requirement,
      locales,
      budgets,
      layers: layers.map(layer => layer.layerId),
    }),
    label: `${label}${locales.length === 0 ? '' : ` · ${locales.join(', ')}`}`.slice(0, 2_048),
    top: Object.freeze({
      ...(top.sourcePath === undefined ? {} : { sourcePath: top.sourcePath }),
      ...(top.directory === undefined ? {} : { directory: top.directory }),
    }),
  })
}

export interface ResolvedDataSemanticContextResult {
  readonly input?: LanguageWorkspaceSemanticInput
  readonly complete: boolean
  /** Bounded reason for an unavailable or incomplete context; never a stack trace. */
  readonly failure?: string
  /** The analysing provider's persistent roots (its settings): what a host may keep on disk. */
  readonly persistentRoots?: readonly ResolvedDataPersistentRoot[]
}

const unavailable = (message: string): ResolvedDataSemanticContextResult =>
  Object.freeze({ complete: false, failure: message.replaceAll('\0', '').slice(0, 2_048) })

/** Explain partial analysis while preserving the available index and its completeness flags. */
function resolvedDataCompletenessFailure(
  prepared: PreparedResolvedDataSemanticContext,
  analysis: Readonly<{ complete: boolean; diagnostics: unknown }>,
  valuesComplete = true,
): string | undefined {
  const reasons: string[] = []
  if (!prepared.complete) reasons.push('language workspace inputs are incomplete')
  if (!analysis.complete) {
    const diagnostics = analysis.diagnostics
    const items = Array.isArray(diagnostics)
      ? diagnostics
      : typeof diagnostics === 'object' && diagnostics !== null && 'items' in diagnostics
        ? diagnostics.items
        : []
    const messages = Array.isArray(items)
      ? items
          .slice(0, 3)
          .flatMap(item =>
            typeof item === 'object' && item !== null && typeof item.message === 'string'
              ? [item.message.replaceAll('\0', '').slice(0, 512)]
              : [],
          )
      : []
    reasons.push(
      `resolved Data analysis is incomplete${messages.length === 0 ? '' : `: ${messages.join('; ')}`}`,
    )
  }
  if (!valuesComplete)
    reasons.push('resolved Data authoring values were omitted by the output budget')
  return reasons.length === 0 ? undefined : reasons.join('; ').slice(0, 2_048)
}

const jsonSnapshotPayload = (snapshot: ResolvedDataWorkspaceSnapshot): unknown => ({
  schemaVersion: snapshot.schemaVersion,
  workspaceId: snapshot.workspaceId,
  gameId: snapshot.gameId,
  analyzerId: snapshot.analyzerId,
  typeIds: snapshot.typeIds,
  ...(snapshot.schemas === undefined ? {} : { schemas: snapshot.schemas }),
  namespaces: snapshot.namespaces,
  entityCount: snapshot.entityCount,
  patchCount: snapshot.patchCount,
  definitions: snapshot.definitions,
  entities: snapshot.entities,
  relations: snapshot.relations,
  localizedStrings: snapshot.localizedStrings,
  diagnostics: snapshot.diagnostics,
  ...(snapshot.ownerMetadata === undefined ? {} : { ownerMetadata: snapshot.ownerMetadata }),
  snapshotId: snapshot.snapshotId,
  complete: snapshot.complete,
})

const validAuthoringIndex = (value: ResolvedDataAuthoringIndex, gameId: string): boolean =>
  (value.schemaVersion === 1 ||
    (value.schemaVersion === 2 && Array.isArray(value.sourceDocuments))) &&
  value.kind === RESOLVED_DATA_AUTHORING_INDEX_KIND &&
  value.gameId === gameId &&
  boundedText(value.snapshotId) &&
  Array.isArray(value.sourceTable) &&
  Array.isArray(value.entities) &&
  value.entityCount === value.entities.length &&
  typeof value.complete === 'boolean' &&
  typeof value.valuesComplete === 'boolean'

/** Resolve the standard Data provider once and analyze already-open final language documents. */
export async function analyzeResolvedDataSemanticContext(request: {
  readonly services: DataHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly requirement: LanguageResolvedDataSemanticContextRequirement
  readonly prepared: PreparedResolvedDataSemanticContext
  readonly signal?: AbortSignal
}): Promise<ResolvedDataSemanticContextResult> {
  try {
    throwIfAborted(request.signal)
    if (request.prepared.documents.length === 0) {
      return unavailable('resolved Data context has no documents with the requested language ids')
    }
    const maximumInputBytes = Number(
      request.budgets.maxInputBytes > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : request.budgets.maxInputBytes,
    )
    const maxTextBytes = Math.min(maximumInputBytes, MAX_LANGUAGE_RESOLVED_DATA_INPUT_BYTES)
    const textBytes = [
      ...request.prepared.documents,
      ...request.prepared.localizationDocuments,
    ].reduce((total, document) => total + new TextEncoder().encode(document.text).byteLength, 0)
    if (
      maxTextBytes <= 0 ||
      textBytes > maxTextBytes ||
      request.budgets.maxNodes <= 0 ||
      request.budgets.maxDepth <= 0
    ) {
      return unavailable('resolved Data context exceeds the language workspace resource budget')
    }
    const resolution = await resolveResolvedDataWorkspace({
      services: request.services,
      gameId: request.requirement.gameId,
      grant: request.grant,
      budgets: request.budgets,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (resolution.state === 'unresolved') {
      throwIfAborted(request.signal)
      return unavailable(
        resolution.diagnostics.map(item => item.message).join('; ') ||
          `no resolved Data workspace provider accepts ${request.requirement.gameId}`,
      )
    }
    try {
      throwIfAborted(request.signal)
      const analysisRequest: ResolvedDataWorkspaceAnalysisRequest = {
        workspaceId: request.prepared.workspaceId,
        gameId: request.requirement.gameId,
        documents: request.prepared.documents,
        localizationDocuments: request.prepared.localizationDocuments,
        locales: request.prepared.locales,
        localizationKeys: [],
        queries: [],
        plannedDocumentCount:
          request.prepared.documents.length +
          request.prepared.localizationDocuments.length +
          (request.prepared.complete ? 0 : 1),
        unresolvedRequirementIds: request.prepared.complete
          ? []
          : ['language-workspace-incomplete'],
        snapshotId: request.prepared.key,
        maxDocuments:
          request.prepared.documents.length + request.prepared.localizationDocuments.length,
        maxTextBytes,
        maxEntities: Math.min(request.budgets.maxNodes, MAX_LANGUAGE_RESOLVED_DATA_ENTITIES),
        maxDepth: request.budgets.maxDepth,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }
      const analyzeAuthoringIndex = resolution.workspace.analyzeAuthoringIndex
      if (analyzeAuthoringIndex !== undefined) {
        const index = await analyzeAuthoringIndex.call(resolution.workspace, {
          ...analysisRequest,
          maxOutputBytes: Math.min(
            LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES,
            MAX_LANGUAGE_AUTHORING_INDEX_BYTES,
          ),
        })
        throwIfAborted(request.signal)
        if (!validAuthoringIndex(index, request.requirement.gameId)) {
          return unavailable('resolved Data workspace returned an invalid authoring index')
        }
        const [input] = validatedLanguageWorkspaceSemanticInputs([
          {
            kind: RESOLVED_DATA_AUTHORING_INDEX_KIND,
            id: request.requirement.gameId,
            revision: languageWorkspaceContextToken({
              context: request.prepared.key,
              snapshot: index.snapshotId,
            }),
            payload: index,
          },
        ])
        const failure = resolvedDataCompletenessFailure(
          request.prepared,
          index,
          index.valuesComplete,
        )
        const persistentRoots = resolvedDataPersistentRoots(resolution.workspace)
        return Object.freeze({
          ...(input === undefined ? {} : { input }),
          complete: request.prepared.complete && index.complete && index.valuesComplete,
          ...(failure === undefined ? {} : { failure }),
          ...(persistentRoots.length === 0 ? {} : { persistentRoots }),
        })
      }
      const snapshot = await resolution.workspace.analyze(analysisRequest)
      throwIfAborted(request.signal)
      if (
        snapshot.gameId !== request.requirement.gameId ||
        !boundedText(snapshot.snapshotId) ||
        !Array.isArray(snapshot.definitions)
      ) {
        return unavailable('resolved Data workspace returned an invalid snapshot identity')
      }
      const [input] = validatedLanguageWorkspaceSemanticInputs([
        {
          kind: 'resolved-data-snapshot',
          id: request.requirement.gameId,
          revision: languageWorkspaceContextToken({
            context: request.prepared.key,
            snapshot: snapshot.snapshotId,
          }),
          payload: jsonSnapshotPayload(snapshot),
        },
      ])
      const failure = resolvedDataCompletenessFailure(request.prepared, snapshot)
      return Object.freeze({
        ...(input === undefined ? {} : { input }),
        complete: request.prepared.complete && snapshot.complete,
        ...(failure === undefined ? {} : { failure }),
      })
    } finally {
      await resolution.release()
    }
  } catch (error) {
    if (isCancellation(error) || request.signal?.aborted === true) {
      throwIfAborted(request.signal)
      throw error
    }
    return unavailable(error instanceof Error ? error.message : String(error))
  }
}

/** Format of kept resolved Data contexts; changing it makes every kept context a miss. */
const RESOLVED_DATA_CONTEXT_STORE_FORMAT = 1

/**
 * A host's persistent store of complete resolved Data contexts (Node:
 * `createResolvedDataContextStore` over the shared index cache directory). The store keeps opaque
 * inputs under exact keys; it never decides validity, and the host validates every loaded input
 * as it validates a fresh analysis.
 */
export interface LanguageSemanticContextStore {
  /** The input kept under exactly this key, or undefined (absent, unreadable, foreign format). */
  load(request: {
    readonly key: string
    readonly signal?: AbortSignal
  }): Promise<LanguageWorkspaceSemanticInput | undefined>
  /** Keep a complete context, replacing the slot's previous one; failures stay inside the store. */
  save(request: LanguageSemanticContextStoreSaveRequest): Promise<void>
}

export interface LanguageSemanticContextStoreSaveRequest {
  /** From `resolvedDataContextStoreKey`: the content key, the provider artifacts, the format. */
  readonly key: string
  /** `PreparedResolvedDataPersistence.slot`: a later analysis of the same chain replaces this one. */
  readonly slot: string
  readonly gameId: string
  /** `PreparedResolvedDataPersistence.label`, for an application's list of caches. */
  readonly label: string
  readonly input: LanguageWorkspaceSemanticInput
  readonly signal?: AbortSignal
}

/**
 * The store key of a prepared context analysed by these provider artifacts
 * (`resolvedDataAnalyzerIdentity`) under this host's analysis limits.
 */
export function resolvedDataContextStoreKey(
  prepared: PreparedResolvedDataSemanticContext,
  analyzer: string,
): string {
  return languageWorkspaceContextToken({
    format: RESOLVED_DATA_CONTEXT_STORE_FORMAT,
    context: prepared.key,
    analyzer,
    limits: {
      maxEntities: MAX_LANGUAGE_RESOLVED_DATA_ENTITIES,
      maxOutputBytes: Math.min(
        LANGUAGE_WORKSPACE_SEMANTIC_PAYLOAD_MAX_BYTES,
        MAX_LANGUAGE_AUTHORING_INDEX_BYTES,
      ),
      maxTextBytes: MAX_LANGUAGE_RESOLVED_DATA_INPUT_BYTES,
    },
  })
}

/**
 * A kept context for this prepared one, validated like a fresh analysis: a complete authoring index
 * of the requirement's game whose revision is the one this content gives. Anything else, including
 * a store failure, is a miss; cancellation propagates.
 */
export async function loadResolvedDataSemanticContext(request: {
  readonly store: LanguageSemanticContextStore
  readonly prepared: PreparedResolvedDataSemanticContext
  readonly requirement: LanguageResolvedDataSemanticContextRequirement
  readonly analyzer: string
  readonly signal?: AbortSignal
}): Promise<ResolvedDataSemanticContextResult | undefined> {
  if (!request.prepared.complete || request.prepared.documents.length === 0) return undefined
  let stored: LanguageWorkspaceSemanticInput | undefined
  try {
    stored = await request.store.load({
      key: resolvedDataContextStoreKey(request.prepared, request.analyzer),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    if (isCancellation(error) || request.signal?.aborted === true) {
      throwIfAborted(request.signal)
      throw error
    }
    return undefined
  }
  throwIfAborted(request.signal)
  if (stored === undefined) return undefined
  try {
    const [input] = validatedLanguageWorkspaceSemanticInputs([stored])
    const index = input?.payload as unknown as ResolvedDataAuthoringIndex | undefined
    if (
      input === undefined ||
      index === undefined ||
      input.kind !== RESOLVED_DATA_AUTHORING_INDEX_KIND ||
      input.id !== request.requirement.gameId ||
      !validAuthoringIndex(index, request.requirement.gameId) ||
      !index.complete ||
      !index.valuesComplete ||
      input.revision !==
        languageWorkspaceContextToken({
          context: request.prepared.key,
          snapshot: index.snapshotId,
        })
    ) {
      return undefined
    }
    return Object.freeze({ input, complete: true })
  } catch {
    return undefined
  }
}

/**
 * The persistence of a fresh analysis worth keeping: complete, an authoring index, and a strongest
 * Data layer that the analysing provider's persistent roots name.
 */
export function resolvedDataContextToKeep(
  prepared: PreparedResolvedDataSemanticContext,
  result: ResolvedDataSemanticContextResult,
): PreparedResolvedDataPersistence | undefined {
  return prepared.complete &&
    prepared.persistence !== undefined &&
    result.complete &&
    result.input?.kind === RESOLVED_DATA_AUTHORING_INDEX_KIND &&
    result.persistentRoots !== undefined &&
    persistentRootsInclude(result.persistentRoots, prepared.persistence.top)
    ? prepared.persistence
    : undefined
}
