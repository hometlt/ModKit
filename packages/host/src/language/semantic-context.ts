import { compareUtf8, isCancellation, throwIfAborted } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import {
  RESOLVED_DATA_AUTHORING_INDEX_KIND,
  type DataCatalogDocument,
  type DataLocalizationDocument,
  type ResolvedDataAuthoringIndex,
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
import { resolveResolvedDataWorkspace, type DataHostServices } from '../data/index.js'
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
  readonly key: string
  /** Stable across edits to the same logical document set; used only for stale-while-editing reads. */
  readonly scopeKey: string
  readonly workspaceId: string
  readonly documents: readonly DataCatalogDocument[]
  /** Preferred locale first, from the workspace's `locale-set` input. */
  readonly locales: readonly string[]
  readonly localizationDocuments: readonly DataLocalizationDocument[]
  readonly complete: boolean
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
  const identities = selected.map(({ document, origin }) => {
    return {
      uri: document.uri,
      languageId: document.languageId,
      version: document.version,
      contentRevision: languageDocumentTextToken(document),
      origin,
    }
  })
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
    documents: identities,
    locales,
    localization: localizationIdentities,
    budgets:
      request.budgets === undefined
        ? undefined
        : {
            ...request.budgets,
            maxInputBytes: String(request.budgets.maxInputBytes),
          },
    complete,
  })
  const scopeKey = languageWorkspaceContextToken({
    requirement: request.requirement,
    locales,
    budgets:
      request.budgets === undefined
        ? undefined
        : {
            ...request.budgets,
            maxInputBytes: String(request.budgets.maxInputBytes),
          },
    documents: identities.map(identity => ({
      uri: identity.uri,
      languageId: identity.languageId,
      origin:
        identity.origin === undefined
          ? undefined
          : {
              layerId: identity.origin.layerId,
              logicalId: identity.origin.logicalId,
              precedence: identity.origin.precedence,
            },
    })),
    complete,
  })
  return Object.freeze({
    key,
    scopeKey,
    workspaceId: `language:${key}`,
    documents: Object.freeze(documents),
    locales,
    localizationDocuments: Object.freeze(localizationDocuments.map(item => item.document)),
    complete,
  })
}

export interface ResolvedDataSemanticContextResult {
  readonly input?: LanguageWorkspaceSemanticInput
  readonly complete: boolean
  /** Bounded reason for an unavailable optional context; never a stack trace. */
  readonly failure?: string
}

const unavailable = (message: string): ResolvedDataSemanticContextResult =>
  Object.freeze({ complete: false, failure: message.replaceAll('\0', '').slice(0, 2_048) })

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
  value.schemaVersion === 1 &&
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
        return Object.freeze({
          ...(input === undefined ? {} : { input }),
          complete: request.prepared.complete && index.complete && index.valuesComplete,
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
      return Object.freeze({
        ...(input === undefined ? {} : { input }),
        complete: request.prepared.complete && snapshot.complete,
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
