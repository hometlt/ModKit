/**
 * One protocol-neutral v1 language-provider lifecycle for an editor workspace.
 *
 * This is deliberately a coordinator over the existing service contract, not a second language
 * composition root. A successful `open` owns exactly one provider lease until `close`/`shutdown`;
 * `change` only replaces analysis work for that document and never re-resolves the provider.
 * Snapshot features revalidate source documents and provenance. Opted-in hover/semantic completion
 * read the synchronized retained ModContext and check its revision; standalone or
 * position-specific fallback keeps the snapshot path. The server owns values/provenance. Only
 * unchanged immutable captures may be retained within the caller's bounded workspace allowance;
 * retention never changes the documents, authority or completeness forwarded to a provider.
 * Whole-document projections use their own bounded result ceiling; interactive completion and
 * searches retain the smaller ceiling. Providers still declare incomplete results explicitly.
 */

import { base64Of } from '../execution/frame-json.js'
import {
  ModkitError,
  OperationCancelledError,
  canonicalJsonStringify,
  compareUtf8,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import {
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  languageWorkspaceIsSemanticallyIncomplete,
  type LanguageAnalysis,
  type LanguageAnalysisRequest,
  type LanguageCodeActionList,
  type LanguageColor,
  type LanguageAssetRef,
  type LanguageCodeLensList,
  type LanguageCompletionItem,
  type LanguageColorList,
  type LanguageDocumentHighlightList,
  type LanguageDocumentLinkList,
  type LanguageFoldingRangeList,
  type LanguageInlayHintList,
  type LanguageColorPresentationList,
  type LanguageCompletionList,
  type LanguageProviderCompletionList,
  type LanguageCommand,
  type LanguageDiagnostic,
  type LanguageDiagnosticList,
  type LanguageDocument,
  type LanguageDocumentSymbolList,
  type LanguageDocumentLocalFeature,
  type LanguageModContextFeature,
  type LanguageFeatureRequest,
  type LanguageFormattingOptions,
  type LanguageHover,
  type LanguageLocationList,
  type LanguageOnTypeEditResult,
  type LanguagePosition,
  type LanguageProvider,
  type LanguageProviderOfferFacet,
  type LanguageProviderRequestFacet,
  type LanguageRange,
  type LanguageRenamePreparation,
  type LanguageModContextSemanticContextRequirement,
  type LanguageSignatureHelp,
  type LanguageSignatureParameter,
  type LanguageSymbol,
  type LanguageTextEdit,
  type LanguageTextEditList,
  type LanguageToken,
  type LanguageWorkspaceEdit,
  type LanguageWorkspaceContext,
  type LanguageWorkspaceDocumentOrigin,
  type LanguageWorkspaceModContext,
  type LanguageWorkspaceSemanticInput,
  type LanguageWorkspaceSymbolList,
} from '@modkit/sdk/language'
import type {
  JsonValue,
  LanguageFileAssociation,
  ModContextQueryPort,
  PermissionGrant,
  ReferenceOccurrence,
  ResourceBudget,
  SubjectCandidateProviderSource,
  SubjectFilter,
} from '@modkit/sdk'
import type { Inventory } from '../inventory.js'
import { offersFromInventory } from '../offers.js'
import {
  resolveLanguageProvider,
  type LanguageHostServices,
  type LanguageProviderResolution,
} from './index.js'
import { expandSubjectReferenceCompletions } from './subject-completion.js'
import {
  canonicalJsonAtDepth,
  languageImmutableCapture,
  languageWorkspaceContextToken,
  createLanguageContextTokenCache,
  languageDocumentSnapshot,
  languageDocumentTextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './context.js'
import { createWorkspaceReferenceIndex } from '../references.js'
import type { LanguageModContexts } from './mod-contexts.js'
import { validatedLanguageSemanticContextRequirements } from './semantic-context.js'

export const LANGUAGE_WORKSPACE_NOT_INITIALIZED = 'x3.host/language-workspace-not-initialized'
export const LANGUAGE_WORKSPACE_SHUT_DOWN = 'x3.host/language-workspace-shut-down'
export const LANGUAGE_DOCUMENT_ALREADY_OPEN = 'x3.host/language-document-already-open'
export const LANGUAGE_DOCUMENT_NOT_OPEN = 'x3.host/language-document-not-open'
export const LANGUAGE_DOCUMENT_CHANGE_INVALID = 'x3.host/language-document-change-invalid'
export const LANGUAGE_PROVIDER_FAILED = 'x3.host/language-provider-failed'
export const LANGUAGE_ANALYSIS_INVALID = 'x3.host/language-analysis-invalid'
export const LANGUAGE_FEATURE_INVALID = 'x3.host/language-feature-invalid'
/** A workspace edit would change a document its origin marks read-only (an installed dependency). */
export const LANGUAGE_EDIT_READ_ONLY = 'x3.host/language-edit-read-only'

export const LANGUAGE_DEFAULT_MAX_RESULTS = 256
export const LANGUAGE_MAX_RESULTS = 2_048
/** Whole-document projections need room for every symbol/lens/link, independent of interactive lists. */
export const LANGUAGE_MAX_DOCUMENT_RESULTS = 65_536
export const LANGUAGE_DEFAULT_MAX_DOCUMENTS = 32
/*
 * A real mod is the unit of meaning for these languages: Blizzard's core mod alone holds 110 GameData
 * catalogs and 377 layouts, and a cross-file template or entity reference is unresolvable without
 * them. Document sources enforce their separately configured document and workspace byte limits;
 * the count ceiling only has to stop an unbounded request.
 */
export const LANGUAGE_MAX_DOCUMENTS = 4_096
export const LANGUAGE_DEFAULT_MAX_EDITS = 1_024
export const LANGUAGE_MAX_EDITS = 4_096

/** The knowledge files a provider asked for, as a document source request field (or nothing). */
function knowledgeFileNamesOf(provider: LanguageProvider): {
  readonly knowledgeFileNames?: readonly string[]
} {
  try {
    const requirement = validatedLanguageSemanticContextRequirements(
      provider.semanticContextRequirements ?? [],
    ).find(item => item.kind === 'language-knowledge')
    return requirement?.kind === 'language-knowledge'
      ? { knowledgeFileNames: requirement.fileNames }
      : {}
  } catch {
    return {}
  }
}

/** One exact request route plus provider-owned editor activation metadata. */
export interface LanguageProviderRoute extends LanguageProviderRequestFacet {
  /** The dialect a game's file association declares for this extension route. */
  readonly dialect?: string
  readonly completionTriggerCharacters?: readonly string[]
  readonly signatureHelpTriggerCharacters?: readonly string[]
  readonly onTypeFormattingTriggerCharacters?: readonly string[]
}

const ROUTE_KEYS = new Set([
  'languageIds',
  'documentKinds',
  'extensions',
  'fileNames',
  'completionTriggerCharacters',
  'signatureHelpTriggerCharacters',
  'onTypeFormattingTriggerCharacters',
])
const TOKEN_KINDS = new Set([
  'comment',
  'function',
  'keyword',
  'number',
  'operator',
  'parameter',
  'property',
  'string',
  'type',
  'variable',
])
const SYMBOL_KINDS = new Set([
  'class',
  'constant',
  'enum',
  'field',
  'function',
  'interface',
  'module',
  'namespace',
  'property',
  'struct',
  'variable',
])
const COMPLETION_KINDS = new Set([
  ...SYMBOL_KINDS,
  'keyword',
  'parameter',
  'snippet',
  'text',
  'type',
  'color',
  'file',
  'folder',
  'enum-member',
  'event',
])
const CODE_ACTION_KINDS = new Set([
  'quickfix',
  'refactor',
  'refactor.extract',
  'refactor.inline',
  'rewrite',
  'source',
])

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function nonBlankStrings(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(item => typeof item === 'string' && item.trim().length > 0)
  ) {
    return undefined
  }
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function triggerCharacters(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (!value.every(item => typeof item === 'string' && [...item].length === 1)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function languageOfferFacet(value: unknown): LanguageProviderOfferFacet {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !ROUTE_KEYS.has(key))) {
    throw new TypeError('language provider offer facet must contain only route fields')
  }
  const languageIds = nonBlankStrings(record['languageIds'])
  const documentKinds =
    record['documentKinds'] === undefined ? undefined : nonBlankStrings(record['documentKinds'])
  const extensions =
    record['extensions'] === undefined ? undefined : nonBlankStrings(record['extensions'])
  const fileNames =
    record['fileNames'] === undefined ? undefined : nonBlankStrings(record['fileNames'])
  const completionTriggerCharacters =
    record['completionTriggerCharacters'] === undefined
      ? undefined
      : triggerCharacters(record['completionTriggerCharacters'])
  const signatureHelpTriggerCharacters =
    record['signatureHelpTriggerCharacters'] === undefined
      ? undefined
      : triggerCharacters(record['signatureHelpTriggerCharacters'])
  const onTypeFormattingTriggerCharacters =
    record['onTypeFormattingTriggerCharacters'] === undefined
      ? undefined
      : triggerCharacters(record['onTypeFormattingTriggerCharacters'])
  if (
    languageIds === undefined ||
    (record['documentKinds'] !== undefined && documentKinds === undefined) ||
    (record['extensions'] !== undefined && extensions === undefined) ||
    (record['fileNames'] !== undefined && fileNames === undefined) ||
    (record['completionTriggerCharacters'] !== undefined &&
      completionTriggerCharacters === undefined) ||
    (record['signatureHelpTriggerCharacters'] !== undefined &&
      signatureHelpTriggerCharacters === undefined) ||
    (record['onTypeFormattingTriggerCharacters'] !== undefined &&
      onTypeFormattingTriggerCharacters === undefined)
  ) {
    throw new TypeError('language provider offer facet contains an invalid route list')
  }
  return {
    languageIds,
    ...(documentKinds === undefined ? {} : { documentKinds }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(fileNames === undefined ? {} : { fileNames }),
    ...(completionTriggerCharacters === undefined ? {} : { completionTriggerCharacters }),
    ...(signatureHelpTriggerCharacters === undefined ? {} : { signatureHelpTriggerCharacters }),
    ...(onTypeFormattingTriggerCharacters === undefined
      ? {}
      : { onTypeFormattingTriggerCharacters }),
  }
}

const normalizedExtension = (value: string): string => value.replace(/^\./u, '').toLowerCase()

/** Read the last component under either separator without copying the entire resource path. */
const baseNameOf = (path: string): string => {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** The extension of a file name or path, lower-case and without the dot; none for `Objects`. */
export function languageFileExtension(path: string): string | undefined {
  const name = baseNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? undefined : name.slice(dot + 1).toLowerCase()
}

/**
 * The local name of an XML text's document element, or none when the text does not start one. A
 * byte-order mark, white space, the declaration, processing instructions, comments and a document
 * type before it are skipped; `head` may be only the start of the file.
 */
export function xmlRootElementName(head: string): string | undefined {
  let at = head.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (at < head.length && /\s/u.test(head[at]!)) at += 1
    if (head.startsWith('<?', at)) {
      const end = head.indexOf('?>', at + 2)
      if (end < 0) return undefined
      at = end + 2
    } else if (head.startsWith('<!--', at)) {
      const end = head.indexOf('-->', at + 4)
      if (end < 0) return undefined
      at = end + 3
    } else if (head.startsWith('<!', at)) {
      // a document type, with an internal subset in brackets
      let depth = 0
      let end = at + 2
      for (; end < head.length; end += 1) {
        if (head[end] === '[') depth += 1
        else if (head[end] === ']') depth -= 1
        else if (head[end] === '>' && depth <= 0) break
      }
      if (end >= head.length) return undefined
      at = end + 1
    } else break
  }
  const name = /^<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)(?=[\s/>])/u.exec(head.slice(at, at + 260))
  return name?.[2]
}

/**
 * The game association of a file (`modkit.languageFiles`). An association naming a root element
 * applies when the start of the file, `head`, opens that element, and wins over the plain ones of
 * its extension; without `head` only plain associations apply.
 */
export function languageFileAssociationFor(
  associations: readonly LanguageFileAssociation[],
  path: string,
  head?: string,
): LanguageFileAssociation | undefined {
  const extension = languageFileExtension(path)
  if (extension === undefined) return undefined
  const matching = associations.filter(association => association.extension === extension)
  const rooted = matching.filter(association => association.rootElement !== undefined)
  if (head !== undefined && rooted.length > 0) {
    const root = xmlRootElementName(head)
    const hit = rooted.find(association => association.rootElement === root)
    if (hit !== undefined) return hit
  }
  return matching.find(association => association.rootElement === undefined)
}

/** Whether a route serves this file: by its exact name, else by its extension. */
function languageRouteServesName(
  route: LanguageProviderRequestFacet,
  name: string,
  extension: string | undefined,
): boolean {
  return route.fileName !== undefined
    ? route.fileName.toLowerCase() === name
    : route.extension !== undefined && route.extension === extension
}

export function languageRouteServesFile(
  route: LanguageProviderRequestFacet,
  path: string,
): boolean {
  const name = baseNameOf(path)
  return languageRouteServesName(route, name.toLowerCase(), languageFileExtension(name))
}

/**
 * The language of a file in a workspace snapshot, by the advertised routes. A route that names the
 * file wins over extension routes; an extension more than one language claims decides nothing
 * (`candidates` lists them, so a snapshot that wanted one can report itself incomplete).
 */
export function createLanguageFileClassifier(
  routes: readonly LanguageProviderRoute[],
): (
  path: string,
) => Readonly<{ languageId?: string; dialect?: string; candidates: readonly string[] }> {
  const named = new Map<string, LanguageProviderRoute[]>()
  const extensions = new Map<string, LanguageProviderRoute[]>()
  for (const route of routes) {
    const key = route.fileName?.toLowerCase() ?? route.extension
    if (key === undefined) continue
    const index = route.fileName === undefined ? extensions : named
    const group = index.get(key) ?? []
    group.push(route)
    index.set(key, group)
  }
  /** Capture each advertised selector once; file contents and document revisions stay uncached. */
  const collapse = (index: ReadonlyMap<string, readonly LanguageProviderRoute[]>) =>
    new Map(
      [...index].map(([key, matching]) => {
        const candidates = [...new Set(matching.map(route => route.languageId))].sort(compareUtf8)
        const dialects = [
          ...new Set(
            matching.flatMap(route => (route.dialect === undefined ? [] : [route.dialect])),
          ),
        ]
        return [
          key,
          Object.freeze({
            ...(candidates.length === 1 ? { languageId: candidates[0] as string } : {}),
            ...(candidates.length === 1 && dialects.length === 1
              ? { dialect: dialects[0] as string }
              : {}),
            candidates: Object.freeze(candidates),
          }),
        ] as const
      }),
    )
  const byName = collapse(named)
  const byExtension = collapse(extensions)
  const absent = Object.freeze({ candidates: Object.freeze([] as string[]) })
  return path => {
    const name = baseNameOf(path)
    const extension = languageFileExtension(name)
    return (
      byName.get(name.toLowerCase()) ??
      (extension === undefined ? undefined : byExtension.get(extension)) ??
      absent
    )
  }
}

/** Classify one path; sources that classify many paths retain the inventory-scoped classifier. */
export function classifyLanguageFile(
  routes: readonly LanguageProviderRoute[],
  path: string,
): Readonly<{ languageId?: string; dialect?: string; candidates: readonly string[] }> {
  return createLanguageFileClassifier(routes)(path)
}

/**
 * File associations the inventory's extensions declare (`modkit.languageFiles`): a game names the
 * language and dialect of its own file kinds (`.scar` → `lua`, `lua51`) without providing a language.
 */
export function languageFileAssociations(inventory: Inventory): readonly LanguageFileAssociation[] {
  const seen = new Map<string, LanguageFileAssociation>()
  for (const extension of inventory.extensions)
    for (const association of extension.manifest.languageFiles ?? []) {
      const normalized: LanguageFileAssociation = Object.freeze({
        extension: normalizedExtension(association.extension),
        languageId: association.languageId,
        ...(association.dialect === undefined ? {} : { dialect: association.dialect }),
        ...(association.rootElement === undefined ? {} : { rootElement: association.rootElement }),
      })
      seen.set(canonicalJsonStringify(normalized), normalized)
    }
  return Object.freeze(
    [...seen.entries()].sort(([a], [b]) => compareUtf8(a, b)).map(([, value]) => value),
  )
}

/**
 * Return the active inventory's validated, expanded language routes.
 *
 * Multiple runtime variants and providers may advertise the same route. The application needs the
 * selector once, while provider choice remains the resolver's job, so exact duplicates collapse
 * and the result is canonical-JSON sorted.
 */
export function languageProviderRoutes(inventory: Inventory): readonly LanguageProviderRoute[] {
  const routes = new Map<string, LanguageProviderRoute>()
  for (const provider of offersFromInventory(inventory)) {
    for (const offer of provider.provides) {
      if (offer.contract !== LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT || offer.major !== 1) continue
      const facet = languageOfferFacet(offer.facet)
      const kinds = facet.documentKinds ?? [undefined]
      // A file-name-only offer adds no catch-all extension route: its files are known by name.
      const extensions = facet.extensions ?? (facet.fileNames === undefined ? [undefined] : [])
      const targets: readonly (
        | { readonly extension?: string; readonly fileName?: undefined }
        | { readonly fileName: string; readonly extension?: undefined }
      )[] = [
        ...extensions.map(rawExtension => {
          const extension =
            rawExtension === undefined ? undefined : normalizedExtension(rawExtension)
          if (extension !== undefined && extension.length === 0) {
            throw new TypeError('language provider extension route must not be only a dot')
          }
          return extension === undefined ? {} : { extension }
        }),
        ...(facet.fileNames ?? []).map(fileName => ({ fileName })),
      ]
      for (const languageId of facet.languageIds) {
        for (const documentKind of kinds) {
          for (const target of targets) {
            const identity: LanguageProviderRequestFacet = {
              languageId,
              ...(documentKind === undefined ? {} : { documentKind }),
              ...(target.extension === undefined ? {} : { extension: target.extension }),
              ...(target.fileName === undefined ? {} : { fileName: target.fileName }),
            }
            const key = canonicalJsonStringify(identity)
            const prior = routes.get(key)
            const merge = (
              left: readonly string[] | undefined,
              right: readonly string[] | undefined,
            ): readonly string[] | undefined => {
              const values = [...new Set([...(left ?? []), ...(right ?? [])])].sort(compareUtf8)
              return values.length === 0 ? undefined : Object.freeze(values)
            }
            const completionTriggerCharacters = merge(
              prior?.completionTriggerCharacters,
              facet.completionTriggerCharacters,
            )
            const signatureHelpTriggerCharacters = merge(
              prior?.signatureHelpTriggerCharacters,
              facet.signatureHelpTriggerCharacters,
            )
            const onTypeFormattingTriggerCharacters = merge(
              prior?.onTypeFormattingTriggerCharacters,
              facet.onTypeFormattingTriggerCharacters,
            )
            const route: LanguageProviderRoute = Object.freeze({
              ...identity,
              ...(completionTriggerCharacters === undefined ? {} : { completionTriggerCharacters }),
              ...(signatureHelpTriggerCharacters === undefined
                ? {}
                : { signatureHelpTriggerCharacters }),
              ...(onTypeFormattingTriggerCharacters === undefined
                ? {}
                : { onTypeFormattingTriggerCharacters }),
            })
            routes.set(key, route)
          }
        }
      }
    }
  }
  // A game's association routes its extension to a language it does not provide; the provider of
  // that language is resolved without the extension (see resolveLanguageProvider).
  const provided = new Set([...routes.values()].map(route => route.languageId))
  for (const association of languageFileAssociations(inventory)) {
    // a root element is decided by content (languageFileAssociationFor), never by the extension alone
    if (!provided.has(association.languageId) || association.rootElement !== undefined) continue
    const identity = { languageId: association.languageId, extension: association.extension }
    routes.set(
      canonicalJsonStringify({ ...identity, dialect: association.dialect ?? null }),
      Object.freeze({
        ...identity,
        ...(association.dialect === undefined ? {} : { dialect: association.dialect }),
      }),
    )
  }
  return Object.freeze(
    [...routes.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([, route]) => route),
  )
}

/** Canonical union used by every editor protocol adapter. */
export function languageProviderTriggerCharacters(
  routes: readonly LanguageProviderRoute[],
  feature: 'completion' | 'signatureHelp' | 'onTypeFormatting',
): readonly string[] {
  const field = `${feature}TriggerCharacters` as const
  return Object.freeze([...new Set(routes.flatMap(route => route[field] ?? []))].sort(compareUtf8))
}

/** A picture of an asset a hover or a completion names, asked of the application. */
export interface LanguageAssetImageRequest {
  /** The document whose workspace (its mod and dependencies) the path is looked up in. */
  readonly documentUri: string
  /** The path as the game spells it (`Assets\\Textures\\btn-unit-terran-marine.dds`). */
  readonly path: string
  /** Longest edge of the picture, in pixels. */
  readonly maxEdge: number
  readonly signal?: AbortSignal
}

export interface LanguageAssetImage {
  readonly mediaType: 'image/png' | 'image/svg+xml'
  readonly bytes: Uint8Array
}

export interface LanguageWorkspaceOptions {
  /**
   * Draw an asset a provider names: the application finds it in the document's workspace and
   * gives back a small picture, which the host puts into the hover or the resolved completion.
   * Absent, a hover keeps its asset references for the client and draws nothing.
   */
  readonly assetImage?: (
    request: LanguageAssetImageRequest,
  ) => Promise<LanguageAssetImage | undefined>
  readonly services: LanguageHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  /** Aggregate semantic analysis budget; document activation keeps using `budgets`. */
  readonly workspaceBudgets?: ResourceBudget
  /** URI-scoped selector source shared with subject-ref field editors. */
  readonly subjectCandidates?: SubjectCandidateProviderSource
  /** True when the caller knows that documents outside this bounded workspace are omitted. */
  readonly workspaceIncomplete?: boolean | (() => boolean)
  /** Optional host-owned source of read-only dependency documents for semantic feature snapshots. */
  readonly documentSource?: LanguageWorkspaceDocumentSource
  /**
   * The loaded mod servers of the workspace's subjects (owner decision 07.10). A provider that
   * declares a `mod-context` requirement reads the server of its document's chain, named in
   * `workspaceContext.modContext`, after the editor's open buffers reached it; it asks through
   * the port the workspace gives it at activation. A function is asked again on every request.
   */
  readonly modContexts?: LanguageModContexts | (() => LanguageModContexts | undefined)
  /** Identity of an open document inside the selected mod/dependency context, when known. */
  readonly documentOrigin?: (
    document: LanguageDocument,
  ) => LanguageWorkspaceDocumentOrigin | undefined
  /** Host-selected locale, subject and other non-document semantic inputs. */
  readonly semanticInputs?:
    readonly LanguageWorkspaceSemanticInput[] | (() => readonly LanguageWorkspaceSemanticInput[])
  /** Observe the exact provider context and requesting URI; concurrent mods have separate scopes. */
  readonly observeWorkspaceContext?: (
    context: LanguageWorkspaceContext | undefined,
    documentUri: string,
  ) => void
}

export interface LanguageWorkspaceDocumentSourceRequest {
  readonly document: LanguageDocument
  readonly workspaceDocuments: readonly LanguageDocument[]
  readonly workspaceDocumentOrigins: readonly LanguageWorkspaceDocumentOrigin[]
  readonly workspaceLanguageIds: readonly string[]
  /** Maximum number of additional documents the source may return. */
  readonly maxDocuments: number
  /** Knowledge files the provider requested (`language-knowledge`), found at context layer roots. */
  readonly knowledgeFileNames?: readonly string[]
  readonly signal: AbortSignal
}

export interface LanguageWorkspaceDocumentSourceResult {
  readonly documents: readonly LanguageDocument[]
  /** False when more matching dependency documents exist outside this bounded result. */
  readonly isComplete: boolean
  /** Present when the source can prove identity, precedence and revision of its snapshot. */
  readonly workspaceContext?: LanguageWorkspaceContext
  /** When true, context origins admit open documents into this source's dependency scope.
   * The requested document remains present without an origin, leaving the context incomplete.
   * Omitted preserves the historical unscoped editor workspace. */
  readonly scopeWorkspaceDocuments?: boolean
}

/**
 * Supplies immutable semantic context that is not explicitly open in the editor.
 *
 * These documents take part in lookup features. Each one's origin says whether it is writable: a
 * project file (`readOnly: false`) may receive a rename edit although nobody opened it, a dependency
 * layer (`readOnly: true`) never — an edit reaching one is refused whole. A document without an
 * origin leaves the workspace incomplete, since nothing says what it is.
 */
export interface LanguageWorkspaceDocumentSource {
  snapshot(
    request: LanguageWorkspaceDocumentSourceRequest,
  ): Promise<LanguageWorkspaceDocumentSourceResult>
}

export interface LanguageWorkspaceDocumentRequest extends LanguageProviderRequestFacet {
  readonly document: LanguageDocument
  /** Omitted means all products. */
  readonly include?: LanguageAnalysisRequest['include']
  readonly signal?: AbortSignal
}

export type LanguageWorkspaceAnalysisResult =
  | Readonly<{
      state: 'resolved'
      analysis: LanguageAnalysis
      /** Host selection/activation diagnostics, never document diagnostics. */
      hostDiagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      hostDiagnostics: readonly Diagnostic[]
    }>

/** A document version accepted by the host before provider analysis is requested. */
export type LanguageWorkspaceSynchronizationResult =
  | Readonly<{
      state: 'resolved'
      /** Host selection/activation diagnostics, never document diagnostics. */
      hostDiagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      hostDiagnostics: readonly Diagnostic[]
    }>

export interface LanguageWorkspaceFeatureRequest {
  readonly uri: string
  readonly documentVersion: number
  readonly maxResults?: number
  readonly maxDocuments?: number
  readonly signal?: AbortSignal
}

export interface LanguageWorkspacePositionRequest extends LanguageWorkspaceFeatureRequest {
  readonly position: LanguagePosition
}

export interface LanguageWorkspaceInlayHintsRequest extends LanguageWorkspaceFeatureRequest {
  readonly range: LanguageRange
}

export interface LanguageWorkspaceCompletionRequest extends LanguageWorkspacePositionRequest {
  /**
   * `cached` keeps editor completion responsive while a new resolved Data context is prepared for
   * the current document version. The provider still receives the live document overlay.
   */
  readonly semanticContextPolicy?: 'fresh' | 'cached'
}

export interface LanguageWorkspaceReferencesRequest extends LanguageWorkspacePositionRequest {
  readonly includeDeclaration?: boolean
}

export interface LanguageWorkspaceRenameRequest extends LanguageWorkspacePositionRequest {
  readonly newName: string
  readonly maxEdits?: number
}

export interface LanguageWorkspaceFormattingRequest extends LanguageWorkspaceFeatureRequest {
  readonly options: LanguageFormattingOptions
}

export interface LanguageWorkspaceOnTypeFormattingRequest extends LanguageWorkspacePositionRequest {
  readonly ch: string
  readonly options: LanguageFormattingOptions
  readonly semanticContextPolicy?: 'fresh' | 'cached'
}

export interface LanguageWorkspaceColorPresentationRequest extends LanguageWorkspaceFeatureRequest {
  readonly color: LanguageColor
  readonly range: LanguageRange
}

export interface LanguageWorkspaceCodeActionsRequest extends LanguageWorkspaceFeatureRequest {
  readonly range: LanguageRange
  readonly diagnostics: readonly LanguageDiagnostic[]
  readonly maxEdits?: number
}

export interface LanguageWorkspaceSymbolsRequest extends LanguageWorkspaceFeatureRequest {
  readonly query: string
}

export type LanguageWorkspaceCapability =
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
  | 'document-colors'
  | 'color-presentations'
  | 'code-actions'
  | 'code-lenses'
  | 'folding-ranges'
  | 'document-links'
  | 'document-highlights'
  | 'inlay-hints'
  | 'document-symbols'
  | 'workspace-symbols'
  | 'diagnostics'

/** What `projectDiagnostics` found in the project documents nobody has open. */
export interface LanguageProjectDiagnostics {
  readonly documents: readonly {
    readonly uri: string
    readonly version: number
    readonly diagnostics: readonly LanguageDiagnostic[]
  }[]
  /** Project documents were left out: the snapshot was bounded, or its source said so. */
  readonly isIncomplete: boolean
}

export interface LanguageWorkspaceCapabilitySet {
  readonly uri: string
  readonly documentVersion: number
  readonly features: readonly LanguageWorkspaceCapability[]
}

export interface LanguageWorkspace {
  initialize(): Promise<void>
  /** Accept the newest full document snapshot without putting provider analysis ahead of UI work. */
  synchronize(
    request: LanguageWorkspaceDocumentRequest,
  ): Promise<LanguageWorkspaceSynchronizationResult>
  /** Analyze a document snapshot already accepted by `synchronize`. */
  analyze(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  open(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  change(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  /** Await the newest analysis already requested for this URI. */
  current(uri: string, signal?: AbortSignal): Promise<LanguageWorkspaceAnalysisResult | undefined>
  /** Return the activated provider's exact feature surface for an open document. */
  capabilities(
    uri: string,
    signal?: AbortSignal,
  ): Promise<LanguageWorkspaceCapabilitySet | undefined>
  completion(
    request: LanguageWorkspaceCompletionRequest,
  ): Promise<LanguageCompletionList | undefined>
  hover(request: LanguageWorkspacePositionRequest): Promise<LanguageHover | undefined>
  /** Fill in a completion item the editor focused; its asset, if any, becomes a picture. */
  resolveCompletion(
    request: LanguageWorkspacePositionRequest & { readonly item: LanguageCompletionItem },
  ): Promise<LanguageCompletionItem | undefined>
  signatureHelp(
    request: LanguageWorkspacePositionRequest,
  ): Promise<LanguageSignatureHelp | undefined>
  definition(request: LanguageWorkspacePositionRequest): Promise<LanguageLocationList | undefined>
  references(request: LanguageWorkspaceReferencesRequest): Promise<LanguageLocationList | undefined>
  prepareRename(
    request: LanguageWorkspacePositionRequest,
  ): Promise<LanguageRenamePreparation | undefined>
  rename(request: LanguageWorkspaceRenameRequest): Promise<LanguageWorkspaceEdit | undefined>
  formatting(request: LanguageWorkspaceFormattingRequest): Promise<LanguageTextEditList | undefined>
  onTypeFormatting(
    request: LanguageWorkspaceOnTypeFormattingRequest,
  ): Promise<LanguageOnTypeEditResult | undefined>
  documentColors(request: LanguageWorkspaceFeatureRequest): Promise<LanguageColorList | undefined>
  colorPresentations(
    request: LanguageWorkspaceColorPresentationRequest,
  ): Promise<LanguageColorPresentationList | undefined>
  codeActions(
    request: LanguageWorkspaceCodeActionsRequest,
  ): Promise<LanguageCodeActionList | undefined>
  codeLenses(request: LanguageWorkspaceFeatureRequest): Promise<LanguageCodeLensList | undefined>
  foldingRanges(
    request: LanguageWorkspaceFeatureRequest,
  ): Promise<LanguageFoldingRangeList | undefined>
  documentLinks(
    request: LanguageWorkspaceFeatureRequest,
  ): Promise<LanguageDocumentLinkList | undefined>
  documentHighlights(
    request: LanguageWorkspacePositionRequest,
  ): Promise<LanguageDocumentHighlightList | undefined>
  inlayHints(
    request: LanguageWorkspaceInlayHintsRequest,
  ): Promise<LanguageInlayHintList | undefined>
  documentSymbols(
    request: LanguageWorkspaceFeatureRequest,
  ): Promise<LanguageDocumentSymbolList | undefined>
  workspaceSymbols(
    request: LanguageWorkspaceSymbolsRequest,
  ): Promise<LanguageWorkspaceSymbolList | undefined>
  diagnostics(request: LanguageWorkspaceFeatureRequest): Promise<LanguageDiagnosticList | undefined>
  /**
   * «Check the mod»: the diagnostics of every writable project document in the open document's
   * workspace snapshot that is not open itself, analyzed by the same provider. Run on request, not
   * in the background: it analyzes each of those documents.
   */
  projectDiagnostics(
    request: LanguageWorkspaceFeatureRequest,
  ): Promise<LanguageProjectDiagnostics | undefined>
  /** Cancel in-flight features after dependency, schema, locale or transaction state changes. */
  invalidate(reason?: string): void
  close(uri: string): Promise<void>
  shutdown(): Promise<void>
}

interface OpenDocument {
  readonly uri: string
  readonly route: LanguageProviderRoute
  readonly resolution: Extract<LanguageProviderResolution, { readonly state: 'resolved' }>
  version: number
  document: LanguageDocument
  analysisController?: AbortController
  pending?: Promise<LanguageWorkspaceAnalysisResult>
  current?: LanguageWorkspaceAnalysisResult
  released: boolean
}

const routeOf = (request: LanguageWorkspaceDocumentRequest): LanguageProviderRoute =>
  Object.freeze({
    languageId: request.languageId,
    ...(request.documentKind === undefined ? {} : { documentKind: request.documentKind }),
    ...(request.extension === undefined
      ? {}
      : { extension: normalizedExtension(request.extension) }),
  })

const routeKey = (route: LanguageProviderRoute): string => canonicalJsonStringify(route)

function workspaceError(code: string, message: string, context = {}): ModkitError {
  return new ModkitError({ code, message, context })
}

function validateRequest(request: LanguageWorkspaceDocumentRequest): void {
  if (
    typeof request.languageId !== 'string' ||
    request.languageId.trim().length === 0 ||
    typeof request.document.uri !== 'string' ||
    request.document.uri.trim().length === 0 ||
    typeof request.document.languageId !== 'string' ||
    request.document.languageId !== request.languageId ||
    !Number.isSafeInteger(request.document.version) ||
    request.document.version < 0 ||
    typeof request.document.text !== 'string' ||
    (request.documentKind !== undefined &&
      (typeof request.documentKind !== 'string' || request.documentKind.trim().length === 0)) ||
    (request.extension !== undefined &&
      (typeof request.extension !== 'string' || request.extension.trim().length === 0))
  ) {
    throw workspaceError(
      LANGUAGE_DOCUMENT_CHANGE_INVALID,
      'language documents need a non-empty URI, a matching route language and a non-negative safe version',
      { uri: request.document.uri, languageId: request.languageId },
    )
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw workspaceError(
      LANGUAGE_FEATURE_INVALID,
      `${name} must be a safe integer from 1 through ${maximum}`,
      { [name]: String(selected) },
    )
  }
  return selected
}

function validatedFormattingOptions(
  formatting: LanguageFormattingOptions,
  uri: string,
): LanguageFormattingOptions {
  if (
    typeof formatting !== 'object' ||
    formatting === null ||
    !Number.isSafeInteger(formatting.tabSize) ||
    formatting.tabSize < 1 ||
    formatting.tabSize > 8 ||
    typeof formatting.insertSpaces !== 'boolean' ||
    (formatting.finalNewline !== undefined && typeof formatting.finalNewline !== 'boolean')
  ) {
    throw workspaceError(
      LANGUAGE_FEATURE_INVALID,
      'formatting options need tabSize 1 through 8 and boolean indentation settings',
      { uri },
    )
  }
  return Object.freeze({
    tabSize: formatting.tabSize,
    insertSpaces: formatting.insertSpaces,
    ...(formatting.finalNewline === undefined ? {} : { finalNewline: formatting.finalNewline }),
  })
}

function validateFeatureRequest(
  request: LanguageWorkspaceFeatureRequest,
  positioned: boolean,
  maxAllowedResults = LANGUAGE_MAX_RESULTS,
): void {
  if (
    typeof request.uri !== 'string' ||
    request.uri.trim().length === 0 ||
    !Number.isSafeInteger(request.documentVersion) ||
    request.documentVersion < 0
  ) {
    throw workspaceError(
      LANGUAGE_FEATURE_INVALID,
      'language feature requests need a non-empty URI and exact non-negative document version',
      { uri: request.uri, version: String(request.documentVersion) },
    )
  }
  boundedInteger(request.maxResults, LANGUAGE_DEFAULT_MAX_RESULTS, maxAllowedResults, 'maxResults')
  boundedInteger(
    request.maxDocuments,
    LANGUAGE_DEFAULT_MAX_DOCUMENTS,
    LANGUAGE_MAX_DOCUMENTS,
    'maxDocuments',
  )
  if (positioned) {
    const position = (request as LanguageWorkspacePositionRequest).position
    if (
      position === undefined ||
      !Number.isSafeInteger(position.line) ||
      position.line < 0 ||
      !Number.isSafeInteger(position.character) ||
      position.character < 0
    ) {
      throw workspaceError(LANGUAGE_FEATURE_INVALID, 'language feature position is invalid', {
        uri: request.uri,
      })
    }
  }
}

function lineLengths(text: string): readonly number[] {
  return text.split('\n').map(line => (line.endsWith('\r') ? line.length - 1 : line.length))
}

function validPosition(
  position: LanguagePosition | undefined,
  lengths: readonly number[],
): boolean {
  if (position === undefined) return false
  const length = lengths[position.line]
  return (
    Number.isSafeInteger(position.line) &&
    Number.isSafeInteger(position.character) &&
    position.line >= 0 &&
    position.character >= 0 &&
    length !== undefined &&
    position.character <= length
  )
}

/** The shape of a location in any document: its range cannot be checked against text not held. */
function validLocationShape(value: unknown): boolean {
  const location = value as { readonly uri?: unknown; readonly range?: LanguageRange } | undefined
  const position = (item: LanguagePosition | undefined) =>
    item !== undefined &&
    Number.isSafeInteger(item.line) &&
    Number.isSafeInteger(item.character) &&
    item.line >= 0 &&
    item.character >= 0
  return (
    typeof location === 'object' &&
    location !== null &&
    typeof location.uri === 'string' &&
    location.uri.length > 0 &&
    location.uri.length <= 4096 &&
    position(location.range?.start) &&
    position(location.range?.end)
  )
}

function validCommand(value: unknown): value is LanguageCommand {
  const command = value as Record<string, unknown> | undefined
  if (typeof command !== 'object' || command === null) return false
  if (command['kind'] === 'open-subject')
    return (
      Object.keys(command).every(key => ['kind', 'subjectId', 'view'].includes(key)) &&
      typeof command['subjectId'] === 'string' &&
      command['subjectId'].length > 0 &&
      command['subjectId'].length <= 512 &&
      (command['view'] === undefined ||
        ['card', 'graph', 'resolved'].includes(String(command['view'])))
    )
  return (
    command['kind'] === 'open-location' &&
    Object.keys(command).every(key => key === 'kind' || key === 'location') &&
    validLocationShape(command['location'])
  )
}

function validDiagnostic(item: LanguageDiagnostic, lengths: readonly number[]): boolean {
  return (
    validRange(item.range, lengths) &&
    typeof item.message === 'string' &&
    ['error', 'warning', 'information', 'hint'].includes(item.severity) &&
    (item.code === undefined || typeof item.code === 'string') &&
    (item.source === undefined || typeof item.source === 'string') &&
    (item.tags === undefined ||
      (Array.isArray(item.tags) &&
        item.tags.length <= 2 &&
        item.tags.every(tag => tag === 'unnecessary' || tag === 'deprecated'))) &&
    (item.relatedInformation === undefined ||
      (Array.isArray(item.relatedInformation) &&
        item.relatedInformation.length <= 32 &&
        item.relatedInformation.every(
          related =>
            validLocationShape(related?.location) &&
            typeof related.message === 'string' &&
            related.message.length <= 1024,
        ))) &&
    (item.codeDescription === undefined ||
      (typeof item.codeDescription === 'string' &&
        item.codeDescription.length <= 2048 &&
        /^https?:\/\//u.test(item.codeDescription)))
  )
}

function validRange(range: LanguageRange | undefined, lengths: readonly number[]): boolean {
  if (range === undefined) return false
  return (
    validPosition(range.start, lengths) &&
    validPosition(range.end, lengths) &&
    (range.start.line < range.end.line ||
      (range.start.line === range.end.line && range.start.character <= range.end.character))
  )
}

function validToken(token: LanguageToken | undefined, lengths: readonly number[]): boolean {
  if (token === undefined) return false
  return (
    validRange(token.range, lengths) &&
    TOKEN_KINDS.has(token.kind) &&
    (token.modifiers === undefined || token.modifiers.every(item => typeof item === 'string'))
  )
}

function validSymbol(
  symbol: LanguageSymbol | undefined,
  lengths: readonly number[],
  depth = 0,
): boolean {
  if (symbol === undefined) return false
  return (
    depth <= 64 &&
    typeof symbol.name === 'string' &&
    symbol.name.length > 0 &&
    SYMBOL_KINDS.has(symbol.kind) &&
    validRange(symbol.range, lengths) &&
    validRange(symbol.selectionRange, lengths) &&
    (symbol.detail === undefined || typeof symbol.detail === 'string') &&
    (symbol.children === undefined ||
      (Array.isArray(symbol.children) &&
        symbol.children.every(child => validSymbol(child, lengths, depth + 1))))
  )
}

function validLooseRange(range: LanguageRange | undefined): boolean {
  if (range === undefined) return false
  const positions = [range.start, range.end]
  return (
    positions.every(
      position =>
        Number.isSafeInteger(position.line) &&
        position.line >= 0 &&
        Number.isSafeInteger(position.character) &&
        position.character >= 0,
    ) &&
    (range.start.line < range.end.line ||
      (range.start.line === range.end.line && range.start.character <= range.end.character))
  )
}

/** Whether a feature is one a provider may opt into answering from the loaded mod's server. */
function isModContextFeature(
  feature: LanguageDocumentLocalFeature | LanguageModContextFeature,
): feature is LanguageModContextFeature {
  return (
    feature === 'hover' ||
    feature === 'completion' ||
    feature === 'definition' ||
    feature === 'references' ||
    feature === 'signatureHelp' ||
    feature === 'diagnostics'
  )
}

function invalidFeature(message: string, uri: string): never {
  throw workspaceError(LANGUAGE_FEATURE_INVALID, message, { uri })
}

function validJsonValue(value: unknown, seen: ReadonlySet<object> = new Set()): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object' || seen.has(value)) return false
  const next = new Set(seen).add(value)
  if (Array.isArray(value)) return value.every(item => validJsonValue(item, next))
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false
  }
  return Object.entries(value).every(
    ([key, item]) =>
      key !== '__proto__' &&
      key !== 'prototype' &&
      key !== 'constructor' &&
      validJsonValue(item, next),
  )
}

const validFilterStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.every(item => typeof item === 'string' && item.length > 0) &&
  new Set(value).size === value.length

function validSubjectFilter(value: unknown): value is SubjectFilter {
  const filter = recordOf(value)
  if (
    filter === undefined ||
    Object.keys(filter).some(
      key =>
        !['type', 'sameTypeAs', 'text', 'requireTags', 'excludeTags', 'predicate'].includes(key),
    ) ||
    (filter['type'] !== undefined &&
      (typeof filter['type'] !== 'string' || filter['type'].length === 0)) ||
    (filter['sameTypeAs'] !== undefined &&
      (typeof filter['sameTypeAs'] !== 'string' || filter['sameTypeAs'].length === 0)) ||
    (filter['text'] !== undefined && typeof filter['text'] !== 'string') ||
    (filter['requireTags'] !== undefined && !validFilterStrings(filter['requireTags'])) ||
    (filter['excludeTags'] !== undefined && !validFilterStrings(filter['excludeTags']))
  ) {
    return false
  }
  if (filter['predicate'] === undefined) return true
  const predicate = recordOf(filter['predicate'])
  return (
    predicate !== undefined &&
    Object.keys(predicate).every(key => key === 'id' || key === 'params') &&
    typeof predicate['id'] === 'string' &&
    predicate['id'].length > 0 &&
    (predicate['params'] === undefined || validJsonValue(predicate['params']))
  )
}

const validCompletionItem = (
  item: Readonly<Record<string, unknown>>,
  lengths: readonly number[],
): boolean =>
  typeof item['label'] === 'string' &&
  item['label'].length > 0 &&
  typeof item['kind'] === 'string' &&
  COMPLETION_KINDS.has(item['kind']) &&
  (item['detail'] === undefined || typeof item['detail'] === 'string') &&
  (item['documentation'] === undefined || typeof item['documentation'] === 'string') &&
  (item['insertText'] === undefined || typeof item['insertText'] === 'string') &&
  (item['insertTextFormat'] === undefined ||
    item['insertTextFormat'] === 'plain-text' ||
    item['insertTextFormat'] === 'snippet') &&
  (item['replacementRange'] === undefined ||
    validRange(item['replacementRange'] as LanguageRange, lengths)) &&
  (item['sortText'] === undefined || typeof item['sortText'] === 'string') &&
  (item['filterText'] === undefined || typeof item['filterText'] === 'string') &&
  (item['preselect'] === undefined || typeof item['preselect'] === 'boolean') &&
  (item['retrigger'] === undefined || typeof item['retrigger'] === 'boolean') &&
  (item['deprecated'] === undefined || typeof item['deprecated'] === 'boolean') &&
  (item['commitCharacters'] === undefined ||
    (Array.isArray(item['commitCharacters']) &&
      item['commitCharacters'].length <= 16 &&
      item['commitCharacters'].every(
        character => typeof character === 'string' && [...character].length === 1,
      )))

function validateProviderCompletionList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageProviderCompletionList {
  const list = recordOf(value)
  const items = list?.['items']
  const lengths = lineLengths(request.document.text)
  if (
    list === undefined ||
    !Array.isArray(items) ||
    items.length > request.maxResults ||
    typeof list['isIncomplete'] !== 'boolean' ||
    !items.every(item => {
      const record = recordOf(item)
      if (record === undefined) return false
      if (record['kind'] !== 'subject-ref') return validCompletionItem(record, lengths)
      return (
        Object.keys(record).every(
          key => key === 'kind' || key === 'subjectKind' || key === 'filter',
        ) &&
        typeof record['subjectKind'] === 'string' &&
        record['subjectKind'].length > 0 &&
        (record['filter'] === undefined || validSubjectFilter(record['filter']))
      )
    })
  ) {
    invalidFeature(
      'language provider returned an invalid or unbounded completion list',
      request.document.uri,
    )
  }
  return value as LanguageProviderCompletionList
}

function validateCompletionList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageCompletionList {
  const list = value as LanguageCompletionList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.items) ||
    list.items.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.items.every(item => {
      const record = recordOf(item)
      return record !== undefined && validCompletionItem(record, lengths)
    })
  ) {
    invalidFeature(
      'language provider returned an invalid or unbounded completion list',
      request.document.uri,
    )
  }
  return list
}

function validAssetRef(value: unknown): boolean {
  const asset = value as { readonly path?: unknown; readonly label?: unknown } | undefined
  return (
    typeof asset === 'object' &&
    asset !== null &&
    typeof asset.path === 'string' &&
    asset.path.length > 0 &&
    asset.path.length <= 512 &&
    (asset.label === undefined || (typeof asset.label === 'string' && asset.label.length <= 256))
  )
}

const ASSET_IMAGE_EDGE = 128
const ASSET_IMAGE_MAX_BYTES = 96 * 1024

/**
 * Markdown pictures of assets a hover or a completion names, drawn by the application; a failed
 * one is left out. The host puts them into its hovers; an editor bridge calling a provider
 * directly (Monaco) does the same with this function.
 */
export async function languageAssetPictures(
  draw: NonNullable<LanguageWorkspaceOptions['assetImage']>,
  request: {
    readonly documentUri: string
    readonly assets: readonly LanguageAssetRef[]
    readonly signal?: AbortSignal
  },
): Promise<string> {
  const { documentUri, assets, signal } = request
  let markdown = ''
  for (const asset of assets.slice(0, 4)) {
    throwIfAborted(signal)
    const image = await draw({
      documentUri,
      path: asset.path,
      maxEdge: ASSET_IMAGE_EDGE,
      ...(signal === undefined ? {} : { signal }),
    }).catch(error => {
      if (isCancellation(error)) throw error
      return undefined
    })
    if (
      image === undefined ||
      !(image.bytes instanceof Uint8Array) ||
      image.bytes.byteLength > ASSET_IMAGE_MAX_BYTES ||
      (image.mediaType !== 'image/png' && image.mediaType !== 'image/svg+xml')
    )
      continue
    // a label may not close the image syntax; a game path reads with forward slashes
    const label = (asset.label ?? asset.path).replace(/[[\]]/gu, '').replaceAll('\\', '/')
    markdown += `\n\n![${label}](data:${image.mediaType};base64,${base64Of(image.bytes)})`
  }
  return markdown
}

function validateHover(value: unknown, request: LanguageFeatureRequest): LanguageHover | undefined {
  if (value === undefined) return undefined
  const hover = value as LanguageHover
  if (
    typeof hover !== 'object' ||
    hover === null ||
    typeof hover.markdown !== 'string' ||
    (hover.range !== undefined && !validRange(hover.range, lineLengths(request.document.text))) ||
    (hover.provenance !== undefined && typeof hover.provenance !== 'string') ||
    (hover.assets !== undefined &&
      (!Array.isArray(hover.assets) ||
        hover.assets.length > 8 ||
        !hover.assets.every(validAssetRef))) ||
    (hover.commands !== undefined &&
      (!Array.isArray(hover.commands) ||
        hover.commands.length > 8 ||
        !hover.commands.every(
          item =>
            typeof item?.title === 'string' &&
            item.title.length > 0 &&
            item.title.length <= 256 &&
            validCommand(item.command),
        )))
  ) {
    invalidFeature('language provider returned invalid hover information', request.document.uri)
  }
  return hover
}

function validateSignatureHelp(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageSignatureHelp | undefined {
  if (value === undefined) return undefined
  const help = value as LanguageSignatureHelp
  const parameterCount =
    typeof help === 'object' && help !== null && Array.isArray(help.signatures)
      ? help.signatures.reduce(
          (count: number, signature: { readonly parameters?: readonly unknown[] }) =>
            count + (Array.isArray(signature.parameters) ? signature.parameters.length : 0),
          0,
        )
      : request.maxResults + 1
  if (
    typeof help !== 'object' ||
    help === null ||
    !Array.isArray(help.signatures) ||
    help.signatures.length > request.maxResults ||
    help.signatures.length === 0 ||
    parameterCount > request.maxResults ||
    !Number.isSafeInteger(help.activeSignature) ||
    help.activeSignature < 0 ||
    help.activeSignature >= help.signatures.length ||
    !Number.isSafeInteger(help.activeParameter) ||
    help.activeParameter < 0 ||
    help.activeParameter >=
      Math.max(1, help.signatures[help.activeSignature]?.parameters.length ?? 0) ||
    !help.signatures.every(
      signature =>
        typeof signature.label === 'string' &&
        (signature.documentation === undefined || typeof signature.documentation === 'string') &&
        Array.isArray(signature.parameters) &&
        signature.parameters.length <= request.maxResults &&
        signature.parameters.every(
          (parameter: LanguageSignatureParameter) =>
            typeof parameter.label === 'string' &&
            (parameter.documentation === undefined || typeof parameter.documentation === 'string'),
        ),
    )
  ) {
    invalidFeature('language provider returned invalid signature help', request.document.uri)
  }
  return help
}

function validateLocationList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageLocationList {
  const list = value as LanguageLocationList
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.locations) ||
    list.locations.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.locations.every(
      location =>
        typeof location === 'object' &&
        location !== null &&
        typeof location.uri === 'string' &&
        location.uri.length > 0 &&
        validLooseRange(location.range),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded locations',
      request.document.uri,
    )
  }
  return list
}

function validatePreparation(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageRenamePreparation | undefined {
  if (value === undefined) return undefined
  const preparation = value as LanguageRenamePreparation
  if (
    typeof preparation !== 'object' ||
    preparation === null ||
    typeof preparation.placeholder !== 'string' ||
    preparation.placeholder.length === 0 ||
    !validRange(preparation.range, lineLengths(request.document.text))
  ) {
    invalidFeature('language provider returned invalid rename preparation', request.document.uri)
  }
  return preparation
}

const comparePosition = (left: LanguagePosition, right: LanguagePosition): number =>
  left.line - right.line || left.character - right.character

function validateTextEditList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageTextEditList {
  const list = value as LanguageTextEditList
  const lengths = lineLengths(request.document.text)
  const edits =
    typeof list === 'object' && list !== null && Array.isArray(list.edits) ? list.edits : []
  const editShapesValid = edits.every(
    item =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.newText === 'string' &&
      validRange(item.range, lengths),
  )
  const ordered = editShapesValid
    ? [...edits].sort(
        (left, right) =>
          comparePosition(left.range.start, right.range.start) ||
          comparePosition(left.range.end, right.range.end),
      )
    : []
  const overlaps = ordered.some((item, index) => {
    const previous = ordered[index - 1]
    return previous !== undefined && comparePosition(previous.range.end, item.range.start) > 0
  })
  if (
    typeof list !== 'object' ||
    list === null ||
    list.isComplete !== true ||
    !Array.isArray(list.edits) ||
    list.edits.length > request.maxResults ||
    overlaps ||
    !editShapesValid
  ) {
    invalidFeature(
      'language provider returned invalid, overlapping or unbounded formatting edits',
      request.document.uri,
    )
  }
  return list
}

function offsetAt(text: string, position: LanguagePosition): number {
  const lines = text.split('\n')
  let offset = 0
  for (let line = 0; line < position.line; line += 1) offset += (lines[line]?.length ?? 0) + 1
  return offset + position.character
}

function textAfterEdits(text: string, edits: readonly LanguageTextEdit[]): string {
  let result = text
  const descending = [...edits].sort(
    (left, right) =>
      comparePosition(right.range.start, left.range.start) ||
      comparePosition(right.range.end, left.range.end),
  )
  for (const edit of descending) {
    result = `${result.slice(0, offsetAt(text, edit.range.start))}${edit.newText}${result.slice(
      offsetAt(text, edit.range.end),
    )}`
  }
  return result
}

function validateOnTypeEditResult(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageOnTypeEditResult {
  const edits = validateTextEditList(value, request)
  const result = value as LanguageOnTypeEditResult
  if (
    (result.requestCompletion !== undefined && typeof result.requestCompletion !== 'boolean') ||
    (result.cursor !== undefined &&
      !validPosition(
        result.cursor,
        lineLengths(textAfterEdits(request.document.text, edits.edits)),
      ))
  ) {
    invalidFeature(
      'language provider returned an invalid on-type editor action',
      request.document.uri,
    )
  }
  return result
}

function validateDocumentSymbols(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageDocumentSymbolList {
  const list = value as LanguageDocumentSymbolList
  let count = 0
  const countSymbol = (symbol: LanguageSymbol): void => {
    count += 1
    for (const child of symbol.children ?? []) countSymbol(child)
  }
  if (typeof list === 'object' && list !== null && Array.isArray(list.symbols)) {
    for (const symbol of list.symbols) countSymbol(symbol)
  }
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.symbols) ||
    count > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.symbols.every(symbol => validSymbol(symbol, lineLengths(request.document.text)))
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded document symbols',
      request.document.uri,
    )
  }
  return list
}

function validateWorkspaceSymbols(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageWorkspaceSymbolList {
  const list = value as LanguageWorkspaceSymbolList
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.symbols) ||
    list.symbols.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.symbols.every(
      symbol =>
        typeof symbol.name === 'string' &&
        symbol.name.length > 0 &&
        SYMBOL_KINDS.has(symbol.kind) &&
        typeof symbol.location?.uri === 'string' &&
        symbol.location.uri.length > 0 &&
        validLooseRange(symbol.location.range) &&
        (symbol.containerName === undefined || typeof symbol.containerName === 'string') &&
        (symbol.detail === undefined || typeof symbol.detail === 'string'),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded workspace symbols',
      request.document.uri,
    )
  }
  return list
}

function validateDiagnosticList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageDiagnosticList {
  const list = value as LanguageDiagnosticList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.diagnostics) ||
    list.diagnostics.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.diagnostics.every(item => validDiagnostic(item, lengths))
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded diagnostics',
      request.document.uri,
    )
  }
  return {
    ...list,
    isIncomplete: list.isIncomplete || languageWorkspaceIsSemanticallyIncomplete(request),
  }
}

function validColor(value: LanguageColor | undefined): boolean {
  return (
    value !== undefined &&
    [value.red, value.green, value.blue, value.alpha].every(
      channel =>
        typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1,
    )
  )
}

function validateColorList(value: unknown, request: LanguageFeatureRequest): LanguageColorList {
  const list = value as LanguageColorList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.colors) ||
    list.colors.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.colors.every(item => validRange(item.range, lengths) && validColor(item.color))
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded document colours',
      request.document.uri,
    )
  }
  return list
}

const optionalString = (value: unknown, maximum: number): boolean =>
  value === undefined || (typeof value === 'string' && value.length <= maximum)

function validateCodeLenses(value: unknown, request: LanguageFeatureRequest): LanguageCodeLensList {
  const list = value as LanguageCodeLensList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.lenses) ||
    list.lenses.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.lenses.every(
      item =>
        validRange(item.range, lengths) &&
        typeof item.title === 'string' &&
        item.title.length > 0 &&
        item.title.length <= 256 &&
        (item.command === undefined || validCommand(item.command)),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded code lenses',
      request.document.uri,
    )
  }
  return list
}

function validateFoldingRanges(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageFoldingRangeList {
  const list = value as LanguageFoldingRangeList
  const lines = lineLengths(request.document.text).length
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.ranges) ||
    list.ranges.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.ranges.every(
      item =>
        Number.isSafeInteger(item.startLine) &&
        Number.isSafeInteger(item.endLine) &&
        item.startLine >= 0 &&
        item.startLine <= item.endLine &&
        item.endLine < lines &&
        (item.kind === undefined || ['comment', 'imports', 'region'].includes(item.kind)),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded folding ranges',
      request.document.uri,
    )
  }
  return list
}

function validateDocumentLinks(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageDocumentLinkList {
  const list = value as LanguageDocumentLinkList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.links) ||
    list.links.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.links.every(
      item =>
        validRange(item.range, lengths) &&
        typeof item.target === 'string' &&
        item.target.length > 0 &&
        item.target.length <= 4096 &&
        optionalString(item.tooltip, 1024),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded document links',
      request.document.uri,
    )
  }
  return list
}

function validateDocumentHighlights(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageDocumentHighlightList {
  const list = value as LanguageDocumentHighlightList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.highlights) ||
    list.highlights.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.highlights.every(
      item =>
        validRange(item.range, lengths) &&
        (item.kind === undefined || ['text', 'read', 'write'].includes(item.kind)),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded highlights',
      request.document.uri,
    )
  }
  return list
}

function validateInlayHints(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageInlayHintList {
  const list = value as LanguageInlayHintList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.hints) ||
    list.hints.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.hints.every(
      item =>
        validPosition(item.position, lengths) &&
        typeof item.label === 'string' &&
        item.label.length > 0 &&
        item.label.length <= 256 &&
        (item.kind === undefined || item.kind === 'type' || item.kind === 'parameter') &&
        optionalString(item.tooltip, 1024) &&
        (item.paddingLeft === undefined || typeof item.paddingLeft === 'boolean') &&
        (item.paddingRight === undefined || typeof item.paddingRight === 'boolean'),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded inlay hints',
      request.document.uri,
    )
  }
  return list
}

function validateColorPresentations(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageColorPresentationList {
  const list = value as LanguageColorPresentationList
  const lengths = lineLengths(request.document.text)
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.presentations) ||
    list.presentations.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.presentations.every(
      item =>
        typeof item.label === 'string' &&
        item.label.length > 0 &&
        (item.textEdit === undefined ||
          (typeof item.textEdit.newText === 'string' && validRange(item.textEdit.range, lengths))),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded colour presentations',
      request.document.uri,
    )
  }
  return list
}

function validateAnalysis(value: unknown, document: LanguageDocument): LanguageAnalysis {
  const lengths = lineLengths(document.text)
  let valid = false
  try {
    const analysis = value as LanguageAnalysis
    valid =
      analysis.documentUri === document.uri &&
      analysis.documentVersion === document.version &&
      Array.isArray(analysis.tokens) &&
      analysis.tokens.every(token => validToken(token, lengths)) &&
      Array.isArray(analysis.diagnostics) &&
      analysis.diagnostics.every(item => validDiagnostic(item, lengths)) &&
      Array.isArray(analysis.symbols) &&
      analysis.symbols.every(symbol => validSymbol(symbol, lengths))
  } catch {
    valid = false
  }
  if (!valid) {
    throw workspaceError(
      LANGUAGE_ANALYSIS_INVALID,
      `language provider returned an invalid analysis for ${document.uri}@${document.version}`,
      { uri: document.uri, version: String(document.version) },
    )
  }
  return value as LanguageAnalysis
}

function linkedSignal(controller: AbortController, signal: AbortSignal | undefined): () => void {
  if (signal === undefined) return () => undefined
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => undefined
  }
  const abort = (): void => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

async function waitWithSignal<Value>(
  promise: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  throwIfAborted(signal)
  if (signal === undefined) return promise
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(new OperationCancelledError(signal.reason))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

const boundedContextText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

function validatedDocumentOrigin(
  value: unknown,
  expectedUri?: string,
): LanguageWorkspaceDocumentOrigin {
  const origin = value as LanguageWorkspaceDocumentOrigin
  if (
    typeof origin !== 'object' ||
    origin === null ||
    !boundedContextText(origin.uri) ||
    (expectedUri !== undefined && origin.uri !== expectedUri) ||
    !boundedContextText(origin.layerId) ||
    !boundedContextText(origin.logicalId) ||
    !Number.isSafeInteger(origin.precedence) ||
    origin.precedence < 0 ||
    !boundedContextText(origin.sourceRevision) ||
    typeof origin.readOnly !== 'boolean' ||
    (origin.overlay !== undefined && typeof origin.overlay !== 'boolean')
  ) {
    throw new TypeError('language workspace document origin is invalid')
  }
  return Object.freeze({ ...origin })
}

function validatedWorkspaceContext(
  value: unknown,
  allowedUris: ReadonlySet<string>,
): LanguageWorkspaceContext {
  const context = value as LanguageWorkspaceContext
  if (
    typeof context !== 'object' ||
    context === null ||
    !boundedContextText(context.id) ||
    !boundedContextText(context.revision) ||
    typeof context.semanticComplete !== 'boolean' ||
    !Array.isArray(context.documentOrigins) ||
    context.documentOrigins.length > allowedUris.size
  ) {
    throw new TypeError('language workspace context is invalid')
  }
  const seenUris = new Set<string>()
  const origins = context.documentOrigins.map(value => {
    const origin = validatedDocumentOrigin(value)
    if (!allowedUris.has(origin.uri) || seenUris.has(origin.uri)) {
      throw new TypeError('language workspace context contains an unknown or duplicate URI')
    }
    seenUris.add(origin.uri)
    return origin
  })
  const semanticInputs = validatedLanguageWorkspaceSemanticInputs(context.semanticInputs ?? [])
  return Object.freeze({ ...context, documentOrigins: Object.freeze(origins), semanticInputs })
}

/*
 * A request's context identity and revision describe every snapshot document (thousands in a mod
 * chain). Their canonical description is assembled from per-document fragments rendered once and
 * kept per Host-owned immutable document copy, together with the exact origin fields they were
 * rendered from; every request still compares those fields and re-renders on any difference. The
 * assembled string is byte-identical to `canonicalJsonStringify` of the whole description, so the
 * tokens are unchanged. Documents that are not Host captures are rendered on every request.
 */
interface DocumentFragments {
  readonly origin: LanguageWorkspaceDocumentOrigin | undefined
  readonly identityOrder: string | undefined
  readonly identity: string | undefined
  readonly revision: string
}
const documentFragmentCache = new WeakMap<LanguageDocument, DocumentFragments>()
const sameOrigin = (
  left: LanguageWorkspaceDocumentOrigin | undefined,
  right: LanguageWorkspaceDocumentOrigin | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.uri === right.uri &&
    left.layerId === right.layerId &&
    left.logicalId === right.logicalId &&
    left.precedence === right.precedence &&
    left.sourceRevision === right.sourceRevision &&
    left.readOnly === right.readOnly &&
    left.overlay === right.overlay)
function documentFragments(
  document: LanguageDocument,
  origin: LanguageWorkspaceDocumentOrigin | undefined,
): DocumentFragments {
  const cached = documentFragmentCache.get(document)
  if (cached !== undefined && sameOrigin(cached.origin, origin)) return cached
  const identity =
    origin === undefined
      ? undefined
      : {
          uri: origin.uri,
          layerId: origin.layerId,
          logicalId: origin.logicalId,
          precedence: origin.precedence,
        }
  const identityOrder = identity === undefined ? undefined : canonicalJsonStringify(identity)
  const fragments: DocumentFragments = Object.freeze({
    origin,
    identityOrder,
    identity: identityOrder === undefined ? undefined : canonicalJsonAtDepth(identityOrder, 2),
    revision: canonicalJsonAtDepth(
      canonicalJsonStringify({
        uri: document.uri,
        version: document.version,
        contentRevision: languageDocumentTextToken(document),
        origin,
      }),
      2,
    ),
  })
  if (languageImmutableCapture(document)) documentFragmentCache.set(document, fragments)
  return fragments
}
const DOCUMENTS_SENTINEL = '\0modkit-workspace-documents\0'
/**
 * `canonicalJsonStringify(value)` for a description whose first key is `documents`, the array whose
 * depth-two element renderings are given; undefined when the description is not of that shape.
 */
function canonicalWithDocuments(
  value: Readonly<Record<string, unknown>>,
  fragments: readonly string[],
): string | undefined {
  const head = `{\n  "documents": ${JSON.stringify(DOCUMENTS_SENTINEL)}`
  const rest = canonicalJsonStringify({ ...value, documents: DOCUMENTS_SENTINEL })
  if (!rest.startsWith(head)) return undefined
  const array = fragments.length === 0 ? '[]' : `[\n    ${fragments.join(',\n    ')}\n  ]`
  return `{\n  "documents": ${array}${rest.slice(head.length)}`
}

/** Create a single-provider v1 document lifecycle coordinator. */
export function createLanguageWorkspace(options: LanguageWorkspaceOptions): LanguageWorkspace {
  const documents = new Map<string, OpenDocument>()
  // Retain just the last validated source set, never provider leases or its source authority.
  let sourceDocumentCaptures = new Map<string, LanguageDocument>()
  const sourceCaptureMaxBytes = Math.max(
    0,
    Math.min(
      256 * 1_024 * 1_024,
      Number((options.workspaceBudgets ?? options.budgets).maxInputBytes),
    ),
  )
  const advertisedRoutes = languageProviderRoutes(options.services.inventory)
  // Identity and revision descriptions of several languages must coexist: a 4 MiB cap
  // evicted unchanged contexts on every language switch in a real dependency closure.
  const contextTokens = createLanguageContextTokenCache(
    Math.min(sourceCaptureMaxBytes, 16 * 1_024 * 1_024),
  )
  // Provider instances may answer differently for the primary document or request limits. Keep
  // their validated indexes apart, rather than replacing the last language's index on every switch.
  const indexedOccurrences: Readonly<{
    provider: LanguageProvider
    documentUri: string
    contextId: string
    contextRevision: string
    maxDocuments: number
    maxResults: number
    bytes: number
    index: ReturnType<typeof createWorkspaceReferenceIndex>
  }>[] = []
  let referenceIndexBytes = 0
  // Full closure indexes can evict one another. Keep small exact-query answers separately so a
  // repeated navigation does not transfer and rebuild a large index just to find the same span.
  const referenceAnswers: Readonly<{
    provider: LanguageProvider
    key: string
    serialized: string | undefined
    bytes: number
  }>[] = []
  let referenceAnswerBytes = 0
  /*
   * Requests a provider answers from its synchronized ModContext carry only the live document: the
   * typed reference index, built from snapshot occurrences, has nothing to index for them.
   */
  const modContextServed = new WeakSet<LanguageFeatureRequest>()
  const featureControllers = new Set<AbortController>()
  /*
   * Content tokens of the semantic inputs this owner validated. Such an input is a deep-frozen copy
   * (a source's path index is the same object while its listing stands), so its full content is
   * hashed once, not canonicalized again on every request; any other input is hashed every time.
   */
  const semanticInputTokens = new WeakMap<LanguageWorkspaceSemanticInput, string>()
  const semanticInputToken = (input: LanguageWorkspaceSemanticInput): string => {
    if (!languageImmutableCapture(input)) return languageWorkspaceContextToken(input)
    let token = semanticInputTokens.get(input)
    if (token === undefined) {
      token = languageWorkspaceContextToken(input)
      semanticInputTokens.set(input, token)
    }
    return token
  }
  let state: 'new' | 'ready' | 'shut-down' = 'new'
  let shutdownPromise: Promise<void> | undefined
  let workspaceGeneration = 0
  const modContextsNow = (): LanguageModContexts | undefined =>
    typeof options.modContexts === 'function' ? options.modContexts() : options.modContexts
  /** One port for every provider: a question goes to the server its scope names, now. */
  const modContextPort: ModContextQueryPort = Object.freeze({
    query(scope: string, question: JsonValue, signal?: AbortSignal): Promise<JsonValue> {
      const registry = modContextsNow()
      if (registry === undefined) {
        return Promise.reject(new TypeError(`no loaded mod is served as ${scope}`))
      }
      return registry.query(scope, question, signal)
    },
  })
  /**
   * The server a request of this document reads, for a provider that declared a `mod-context`
   * requirement: the chain holding the document, after every open buffer of that chain reached it.
   */
  const requestModContext = async (
    entry: OpenDocument,
    signal: AbortSignal,
  ): Promise<LanguageWorkspaceModContext | undefined> => {
    const registry = modContextsNow()
    if (registry === undefined) return undefined
    const requirement = validatedLanguageSemanticContextRequirements(
      entry.resolution.provider.semanticContextRequirements ?? [],
    ).find(
      (item): item is LanguageModContextSemanticContextRequirement => item.kind === 'mod-context',
    )
    if (requirement === undefined) return undefined
    const place = registry.placeOf(entry.uri, requirement.gameId)
    if (place === undefined) return undefined
    try {
      const synchronized = await registry.synchronize(
        place.scope,
        [...documents.values()].map(open => open.document),
        signal,
      )
      return Object.freeze({
        ...synchronized,
        document: Object.freeze({ layerId: place.layerId, path: place.path }),
      })
    } catch (error) {
      if (isCancellation(error)) throw error
      throwIfAborted(signal)
      throw workspaceError(
        LANGUAGE_PROVIDER_FAILED,
        `the loaded mod of ${entry.uri}@${entry.version} did not take the open buffers`,
        {
          uri: entry.uri,
          version: String(entry.version),
          error: error instanceof Error ? error.message : String(error),
        },
      )
    }
  }

  const routeForRequest = (request: LanguageWorkspaceDocumentRequest): LanguageProviderRoute => {
    const identity = routeOf(request)
    return (
      advertisedRoutes.find(
        route =>
          route.languageId === identity.languageId &&
          route.documentKind === identity.documentKind &&
          route.extension === identity.extension,
      ) ?? identity
    )
  }

  const invalidateFeatures = (reason: string): void => {
    workspaceGeneration += 1
    contextTokens.clear()
    indexedOccurrences.length = 0
    referenceIndexBytes = 0
    referenceAnswers.length = 0
    referenceAnswerBytes = 0
    for (const controller of featureControllers) controller.abort(reason)
    featureControllers.clear()
  }

  const requireReady = (): void => {
    if (state === 'new') {
      throw workspaceError(
        LANGUAGE_WORKSPACE_NOT_INITIALIZED,
        'initialize the language workspace before opening documents',
      )
    }
    if (state === 'shut-down') {
      throw workspaceError(LANGUAGE_WORKSPACE_SHUT_DOWN, 'the language workspace is shut down')
    }
  }

  const release = async (entry: OpenDocument): Promise<void> => {
    if (entry.released) return
    entry.released = true
    await entry.resolution.release()
  }

  const requireFeatureEntry = (
    request: LanguageWorkspaceFeatureRequest,
    positioned: boolean,
    maxAllowedResults = LANGUAGE_MAX_RESULTS,
  ): OpenDocument => {
    requireReady()
    validateFeatureRequest(request, positioned, maxAllowedResults)
    const entry = documents.get(request.uri)
    if (entry === undefined) {
      throw workspaceError(
        LANGUAGE_DOCUMENT_NOT_OPEN,
        `language document ${request.uri} is not open`,
        { uri: request.uri },
      )
    }
    if (entry.version !== request.documentVersion) {
      throw new OperationCancelledError('stale language feature request')
    }
    if (
      positioned &&
      !validPosition(
        (request as LanguageWorkspacePositionRequest).position,
        lineLengths(entry.document.text),
      )
    ) {
      throw workspaceError(
        LANGUAGE_FEATURE_INVALID,
        'language feature position is outside the document',
        {
          uri: request.uri,
        },
      )
    }
    return entry
  }

  const assetPictures = (
    documentUri: string,
    assets: readonly LanguageAssetRef[],
    signal?: AbortSignal,
  ): Promise<string> =>
    options.assetImage === undefined
      ? Promise.resolve('')
      : languageAssetPictures(options.assetImage, {
          documentUri,
          assets,
          ...(signal === undefined ? {} : { signal }),
        })

  const invokeFeature = async <Value>(
    workspaceRequest: LanguageWorkspaceFeatureRequest,
    positioned: boolean,
    call: (
      provider: LanguageProvider,
      request: LanguageFeatureRequest,
    ) => Promise<unknown> | undefined,
    validate: (value: unknown, request: LanguageFeatureRequest) => Value | Promise<Value>,
    additions: Readonly<Record<string, unknown>> = {},
    preferCachedSemanticContext = false,
    discoverCompletionContext = false,
    maxAllowedResults = LANGUAGE_MAX_RESULTS,
    inputFeature?: LanguageDocumentLocalFeature | LanguageModContextFeature,
  ): Promise<Value | undefined> => {
    const entry = requireFeatureEntry(workspaceRequest, positioned, maxAllowedResults)
    throwIfAborted(workspaceRequest.signal)
    const maxResults = boundedInteger(
      workspaceRequest.maxResults,
      LANGUAGE_DEFAULT_MAX_RESULTS,
      maxAllowedResults,
      'maxResults',
    )
    const maxDocuments = boundedInteger(
      workspaceRequest.maxDocuments,
      LANGUAGE_DEFAULT_MAX_DOCUMENTS,
      LANGUAGE_MAX_DOCUMENTS,
      'maxDocuments',
    )
    const workspaceLanguageIds = entry.resolution.provider.workspaceLanguageIds
    const acceptedLanguageIds = new Set(
      workspaceLanguageIds === undefined ? [entry.route.languageId] : workspaceLanguageIds,
    )
    // An opt-in that omits its own primary route is invalid for this request. Falling back to the
    // historical one-language snapshot is safer than silently passing an unexpected composition.
    if (!acceptedLanguageIds.has(entry.route.languageId)) {
      acceptedLanguageIds.clear()
      acceptedLanguageIds.add(entry.route.languageId)
    }
    const candidates = [...documents.values()]
      // By default snapshots cross filename routes for one language id (for example several
      // `.galaxy` files), but never cross into another language unless the provider opts in.
      // A provider may explicitly opt in to a small set of auxiliary language ids through its
      // registered surface field; maxDocuments and workspaceIncomplete remain host-owned.
      .filter(candidate => acceptedLanguageIds.has(candidate.route.languageId))
      .sort((left, right) => compareUtf8(left.uri, right.uri))
    const primary = candidates.findIndex(candidate => candidate === entry)
    if (primary > 0) candidates.unshift(...candidates.splice(primary, 1))
    const selected = candidates.slice(0, maxDocuments)
    const generation = workspaceGeneration
    const controller = new AbortController()
    featureControllers.add(controller)
    const unlink = linkedSignal(controller, workspaceRequest.signal)
    try {
      let documentOnly =
        inputFeature !== undefined &&
        !isModContextFeature(inputFeature) &&
        entry.resolution.provider.documentLocalFeatures?.includes(inputFeature) === true
      if (
        discoverCompletionContext &&
        preferCachedSemanticContext &&
        entry.resolution.provider.completionContext !== undefined
      ) {
        const context = await entry.resolution.provider.completionContext({
          document: entry.document,
          position: (workspaceRequest as LanguageWorkspacePositionRequest).position,
          signal: controller.signal,
        })
        throwIfAborted(controller.signal)
        if (context !== 'document' && context !== 'workspace') {
          invalidFeature('language provider returned an invalid completion context mode', entry.uri)
        }
        documentOnly = context === 'document'
      }
      let modContext: LanguageWorkspaceModContext | undefined
      let readsModContext =
        !documentOnly &&
        inputFeature !== undefined &&
        isModContextFeature(inputFeature) &&
        entry.resolution.provider.modContextFeatures?.includes(inputFeature) === true
      if (
        readsModContext &&
        inputFeature === 'completion' &&
        entry.resolution.provider.modContextCompletionApplies !== undefined
      ) {
        const applies = await entry.resolution.provider.modContextCompletionApplies({
          document: entry.document,
          position: (workspaceRequest as LanguageWorkspacePositionRequest).position,
          signal: controller.signal,
        })
        throwIfAborted(controller.signal)
        if (typeof applies !== 'boolean') {
          invalidFeature('language provider returned an invalid ModContext completion applicability', entry.uri)
        }
        readsModContext = applies
      }
      if (
        readsModContext &&
        inputFeature !== undefined &&
        isModContextFeature(inputFeature) &&
        inputFeature !== 'completion' &&
        // a document's diagnostics have no position to prove
        inputFeature !== 'diagnostics' &&
        entry.resolution.provider.modContextFeatureApplies !== undefined
      ) {
        const applies = await entry.resolution.provider.modContextFeatureApplies({
          feature: inputFeature,
          document: entry.document,
          position: (workspaceRequest as LanguageWorkspacePositionRequest).position,
          signal: controller.signal,
        })
        throwIfAborted(controller.signal)
        if (typeof applies !== 'boolean') {
          invalidFeature('language provider returned an invalid ModContext feature applicability', entry.uri)
        }
        readsModContext = applies
      }
      if (readsModContext) {
        modContext = await requestModContext(entry, controller.signal)
        throwIfAborted(controller.signal)
      }
      const modContextOnly = readsModContext && modContext !== undefined
      const snapshotDocuments =
        documentOnly || modContextOnly
          ? [entry.document]
          : selected.map(candidate => candidate.document)
      const originsByUri = new Map<string, LanguageWorkspaceDocumentOrigin>()
      for (const document of snapshotDocuments) {
        const origin = options.documentOrigin?.(document)
        if (origin !== undefined)
          originsByUri.set(document.uri, validatedDocumentOrigin(origin, document.uri))
      }
      let sourceIncomplete = false
      let hasReadOnlyContext = false
      let sourceContext: LanguageWorkspaceContext | undefined
      if (!documentOnly && !modContextOnly && options.documentSource !== undefined) {
        let snapshot: LanguageWorkspaceDocumentSourceResult
        try {
          snapshot = await options.documentSource.snapshot(
            Object.freeze({
              document: entry.document,
              workspaceDocuments: Object.freeze([...snapshotDocuments]),
              workspaceDocumentOrigins: Object.freeze([...originsByUri.values()]),
              workspaceLanguageIds: Object.freeze([...acceptedLanguageIds].sort(compareUtf8)),
              maxDocuments: Math.max(0, maxDocuments - snapshotDocuments.length),
              ...knowledgeFileNamesOf(entry.resolution.provider),
              signal: controller.signal,
            }),
          )
        } catch (error) {
          if (isCancellation(error)) throw error
          throwIfAborted(controller.signal)
          throw workspaceError(
            LANGUAGE_PROVIDER_FAILED,
            `language workspace document source failed for ${entry.uri}@${entry.version}`,
            {
              uri: entry.uri,
              version: String(entry.version),
              error: error instanceof Error ? error.message : String(error),
            },
          )
        }
        throwIfAborted(controller.signal)
        if (
          typeof snapshot !== 'object' ||
          snapshot === null ||
          !Array.isArray(snapshot.documents) ||
          snapshot.documents.length > Math.max(0, maxDocuments - snapshotDocuments.length) ||
          typeof snapshot.isComplete !== 'boolean' ||
          (snapshot.scopeWorkspaceDocuments !== undefined &&
            typeof snapshot.scopeWorkspaceDocuments !== 'boolean') ||
          (snapshot.scopeWorkspaceDocuments === true && snapshot.workspaceContext === undefined)
        ) {
          invalidFeature(
            'language workspace document source returned an invalid snapshot',
            entry.uri,
          )
        }
        if (snapshot.workspaceContext !== undefined) {
          const allowedUris = new Set([
            ...snapshotDocuments.map(document => document.uri),
            ...snapshot.documents.map(document => document.uri),
          ])
          try {
            sourceContext = validatedWorkspaceContext(snapshot.workspaceContext, allowedUris)
          } catch {
            invalidFeature(
              'language workspace document source returned an invalid context',
              entry.uri,
            )
          }
          // A composed source may rebase an open overlay after weaker dependency layers. Its
          // context is the host-owned final precedence authority for this request.
          for (const origin of sourceContext.documentOrigins) originsByUri.set(origin.uri, origin)
          if (snapshot.scopeWorkspaceDocuments === true) {
            const admitted = new Set(sourceContext.documentOrigins.map(origin => origin.uri))
            for (let index = snapshotDocuments.length - 1; index >= 0; index -= 1) {
              const document = snapshotDocuments[index]
              if (
                document !== undefined &&
                document.uri !== entry.uri &&
                !admitted.has(document.uri)
              )
                snapshotDocuments.splice(index, 1)
            }
            for (const uri of originsByUri.keys()) {
              if (!admitted.has(uri)) originsByUri.delete(uri)
            }
          }
        }
        const seenUris = new Set(snapshotDocuments.map(document => document.uri))
        const overlayKey = (origin: LanguageWorkspaceDocumentOrigin): string =>
          `${origin.layerId}\0${origin.logicalId}`
        const openOverlayIds = new Set(
          [...originsByUri.values()]
            .filter(origin => origin.overlay === true && seenUris.has(origin.uri))
            .map(overlayKey),
        )
        const nextSourceCaptures = new Map<string, LanguageDocument>()
        let captureBytes = 0
        for (const document of snapshot.documents) {
          if (
            typeof document !== 'object' ||
            document === null ||
            typeof document.uri !== 'string' ||
            document.uri.trim().length === 0 ||
            seenUris.has(document.uri) ||
            typeof document.languageId !== 'string' ||
            !acceptedLanguageIds.has(document.languageId) ||
            !Number.isSafeInteger(document.version) ||
            document.version < 0 ||
            typeof document.text !== 'string'
          ) {
            invalidFeature(
              'language workspace document source returned an invalid document',
              entry.uri,
            )
          }
          seenUris.add(document.uri)
          const origin = originsByUri.get(document.uri)
          if (origin !== undefined && openOverlayIds.has(overlayKey(origin))) {
            originsByUri.delete(document.uri)
            continue
          }
          let captured = languageDocumentSnapshot(document)
          const previous = sourceDocumentCaptures.get(captured.uri)
          if (
            previous !== undefined &&
            previous.languageId === captured.languageId &&
            previous.version === captured.version &&
            previous.dialect === captured.dialect &&
            previous.text === captured.text
          ) {
            captured = previous
          }
          snapshotDocuments.push(captured)
          // UTF-8 needs at most three bytes per UTF-16 code unit. Reserve metadata too.
          const cost =
            128 +
            3 *
              (captured.text.length +
                captured.uri.length +
                captured.languageId.length +
                (captured.dialect?.length ?? 0))
          if (cost <= sourceCaptureMaxBytes - captureBytes) {
            nextSourceCaptures.set(captured.uri, captured)
            captureBytes += cost
          }
        }
        sourceDocumentCaptures = nextSourceCaptures
        sourceIncomplete = !snapshot.isComplete
        hasReadOnlyContext = snapshot.documents.length > 0
      }
      const callerIncomplete =
        typeof options.workspaceIncomplete === 'function'
          ? options.workspaceIncomplete()
          : options.workspaceIncomplete === true
      const allDocumentsHaveOrigins = snapshotDocuments.every(document =>
        originsByUri.has(document.uri),
      )
      if (allDocumentsHaveOrigins) {
        snapshotDocuments.sort((left, right) => {
          const leftOrigin = originsByUri.get(left.uri)!
          const rightOrigin = originsByUri.get(right.uri)!
          return (
            leftOrigin.precedence - rightOrigin.precedence ||
            compareUtf8(leftOrigin.logicalId, rightOrigin.logicalId) ||
            compareUtf8(left.uri, right.uri)
          )
        })
      }
      const documentOrigins = Object.freeze(
        snapshotDocuments.flatMap(document => {
          const origin = originsByUri.get(document.uri)
          return origin === undefined ? [] : [origin]
        }),
      )
      const baseSemanticComplete =
        candidates.length <= selected.length &&
        !sourceIncomplete &&
        !callerIncomplete &&
        allDocumentsHaveOrigins &&
        (sourceContext === undefined || sourceContext.semanticComplete)
      let semanticInputs: readonly LanguageWorkspaceSemanticInput[]
      try {
        const hostInputs =
          typeof options.semanticInputs === 'function'
            ? options.semanticInputs()
            : (options.semanticInputs ?? [])
        semanticInputs = validatedLanguageWorkspaceSemanticInputs([
          ...(sourceContext?.semanticInputs ?? []),
          entry.resolution.semanticInput,
          ...(entry.resolution.provider.semanticInputs ?? []),
          ...hostInputs,
        ])
      } catch (error) {
        throwIfAborted(controller.signal)
        if (isCancellation(error)) throw error
        const reason =
          error instanceof Error ? error.message.replaceAll('\0', '').slice(0, 512) : ''
        invalidFeature(
          `language workspace semantic inputs are invalid or conflicting${reason === '' ? '' : `: ${reason}`}`,
          entry.uri,
        )
      }
      // A document-only feature reads no workspace: its context is never complete.
      if (!documentOnly && modContext === undefined) {
        modContext = await requestModContext(entry, controller.signal)
        throwIfAborted(controller.signal)
      }
      const semanticComplete = modContextOnly
        ? modContext!.complete && !callerIncomplete
        : baseSemanticComplete && !documentOnly
      const fragments = snapshotDocuments.map(document =>
        documentFragments(document, originsByUri.get(document.uri)),
      )
      // Origins in snapshot order; each one's identity sorts by its exact canonical encoding.
      const identities = fragments
        .filter(item => item.identityOrder !== undefined)
        .sort((left, right) => compareUtf8(left.identityOrder!, right.identityOrder!))
      const idDescription = {
        sourceContextId: sourceContext?.id,
        semanticInputs: semanticInputs.map(input => ({ kind: input.kind, id: input.id })),
        ...(modContext === undefined ? {} : { modContext: modContext.scope }),
      }
      const revisionDescription = {
        sourceRevision: sourceContext?.revision,
        semanticInputs: semanticInputs.map(input => ({
          kind: input.kind,
          id: input.id,
          contentRevision: semanticInputToken(input),
        })),
        semanticComplete,
        ...(modContext === undefined
          ? {}
          : { modContext: { revision: modContext.revision, complete: modContext.complete } }),
      }
      const canonicalId = canonicalWithDocuments(
        idDescription,
        identities.map(item => item.identity!),
      )
      const canonicalRevision = canonicalWithDocuments(
        revisionDescription,
        fragments.map(item => item.revision),
      )
      const workspaceContext =
        sourceContext === undefined &&
        documentOrigins.length === 0 &&
        semanticInputs.length === 0 &&
        modContext === undefined
          ? undefined
          : Object.freeze({
              id:
                canonicalId === undefined
                  ? contextTokens.token({
                      ...idDescription,
                      documents: identities.map(item => {
                        const origin = item.origin!
                        return {
                          uri: origin.uri,
                          layerId: origin.layerId,
                          logicalId: origin.logicalId,
                          precedence: origin.precedence,
                        }
                      }),
                    })
                  : contextTokens.canonicalToken(canonicalId),
              revision:
                canonicalRevision === undefined
                  ? contextTokens.token({
                      ...revisionDescription,
                      documents: snapshotDocuments.map(document => ({
                        uri: document.uri,
                        version: document.version,
                        contentRevision: languageDocumentTextToken(document),
                        origin: originsByUri.get(document.uri),
                      })),
                    })
                  : contextTokens.canonicalToken(canonicalRevision),
              semanticComplete,
              documentOrigins,
              semanticInputs,
              ...(modContext === undefined ? {} : { modContext }),
            } satisfies LanguageWorkspaceContext)
      const providerRequest = Object.freeze({
        document: entry.document,
        workspaceDocuments: Object.freeze(snapshotDocuments),
        ...(workspaceContext === undefined ? {} : { workspaceContext }),
        /*
         * Incomplete means documents may be missing: more candidates than were taken, a source
         * that said so, a caller that knows, or a document of unknown origin. Read-only layers are
         * present, not missing — an edit that would change one is refused where edits are checked.
         */
        workspaceIncomplete:
          (modContextOnly ? !modContext!.complete : candidates.length > selected.length) ||
          sourceIncomplete ||
          (hasReadOnlyContext && !allDocumentsHaveOrigins) ||
          callerIncomplete,
        maxResults,
        maxDocuments,
        ...additions,
        signal: controller.signal,
      }) as LanguageFeatureRequest
      options.observeWorkspaceContext?.(workspaceContext, entry.uri)
      if (modContextOnly) modContextServed.add(providerRequest)
      const pending = call(entry.resolution.provider, providerRequest)
      if (pending === undefined) return undefined
      let candidate: unknown
      try {
        candidate = await pending
      } catch (error) {
        if (isCancellation(error)) throw error
        throwIfAborted(controller.signal)
        throw workspaceError(
          LANGUAGE_PROVIDER_FAILED,
          `language provider feature failed for ${entry.uri}@${entry.version}`,
          {
            uri: entry.uri,
            version: String(entry.version),
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
      throwIfAborted(controller.signal)
      // A shared server can advance while the provider answers. Never attach a result from a
      // different revision to this request, including after dependency invalidation.
      if (modContextOnly) {
        const current = await requestModContext(entry, controller.signal)
        if (current?.scope !== modContext!.scope || current.revision !== modContext!.revision) {
          throw new OperationCancelledError('stale mod context feature result')
        }
      }
      if (
        generation !== workspaceGeneration ||
        documents.get(entry.uri) !== entry ||
        entry.version !== workspaceRequest.documentVersion
      ) {
        throw new OperationCancelledError('stale language feature result')
      }
      const validated = await validate(candidate, providerRequest)
      throwIfAborted(controller.signal)
      if (
        generation !== workspaceGeneration ||
        documents.get(entry.uri) !== entry ||
        entry.version !== workspaceRequest.documentVersion
      ) {
        throw new OperationCancelledError('stale language feature result')
      }
      return validated
    } finally {
      unlink()
      featureControllers.delete(controller)
    }
  }

  const validateWorkspaceEdit = (
    value: unknown,
    request: LanguageFeatureRequest,
    maxEdits: number,
    allowPrimaryOnlyWhenIncomplete = false,
  ): LanguageWorkspaceEdit | undefined => {
    if (value === undefined) return undefined
    if (request.workspaceIncomplete && !allowPrimaryOnlyWhenIncomplete) return undefined
    const edit = value as LanguageWorkspaceEdit
    const origins = new Map(
      (request.workspaceContext?.documentOrigins ?? []).map(origin => [origin.uri, origin]),
    )
    /*
     * An edit reaching a read-only document — a dependency mounted from an installation — cannot
     * be applied whole, and a part of a rename is worse than none: refused, with the documents named.
     */
    const locked =
      typeof edit === 'object' && edit !== null && Array.isArray(edit.documentChanges)
        ? edit.documentChanges
            .map(change => change?.uri)
            .filter(uri => typeof uri === 'string' && origins.get(uri)?.readOnly === true)
        : []
    if (locked.length > 0) {
      throw workspaceError(
        LANGUAGE_EDIT_READ_ONLY,
        `the edit would change ${locked.length} read-only document(s): ${locked.slice(0, 4).join(', ')}`,
        { uri: request.document.uri, readOnly: locked.slice(0, 32) },
      )
    }
    /*
     * A rename reaches files nobody opened: the snapshot carries them, and their origin says whether
     * they are the project's own (writable) — a document of unknown origin stays out of reach.
     */
    const snapshot = new Map(request.workspaceDocuments.map(document => [document.uri, document]))
    let editCount = 0
    const seen = new Set<string>()
    const valid =
      typeof edit === 'object' &&
      edit !== null &&
      edit.isComplete === true &&
      Array.isArray(edit.documentChanges) &&
      edit.documentChanges.length <= request.maxDocuments &&
      edit.documentChanges.every(change => {
        const open = documents.get(change.uri)
        const target =
          open !== undefined
            ? { text: open.document.text, version: open.version }
            : origins.get(change.uri)?.readOnly === false
              ? snapshot.get(change.uri)
              : undefined
        editCount += Array.isArray(change.edits) ? change.edits.length : maxEdits + 1
        if (
          target === undefined ||
          (request.workspaceIncomplete && change.uri !== request.document.uri) ||
          seen.has(change.uri) ||
          change.documentVersion !== target.version ||
          !Array.isArray(change.edits) ||
          editCount > maxEdits
        ) {
          return false
        }
        seen.add(change.uri)
        const lengths = lineLengths(target.text)
        return change.edits.every(
          (item: LanguageTextEdit) =>
            typeof item.newText === 'string' && validRange(item.range, lengths),
        )
      })
    if (!valid) {
      invalidFeature(
        'language provider returned an invalid or unbounded workspace edit',
        request.document.uri,
      )
    }
    return edit
  }

  const validateCodeActionList = (
    value: unknown,
    request: LanguageFeatureRequest,
    maxEdits: number,
  ): LanguageCodeActionList => {
    const list = value as LanguageCodeActionList
    if (
      typeof list !== 'object' ||
      list === null ||
      !Array.isArray(list.actions) ||
      list.actions.length > request.maxResults ||
      typeof list.isIncomplete !== 'boolean'
    ) {
      invalidFeature(
        'language provider returned invalid or unbounded code actions',
        request.document.uri,
      )
    }
    let editCount = 0
    for (const value of list.actions) {
      const action = recordOf(value)
      if (action === undefined) {
        invalidFeature('language provider returned an invalid code action', request.document.uri)
      }
      const diagnosticCodes = action['diagnosticCodes']
      const validCodes =
        diagnosticCodes === undefined ||
        (Array.isArray(diagnosticCodes) &&
          diagnosticCodes.length <= request.maxResults &&
          diagnosticCodes.every(
            code => typeof code === 'string' && code.length > 0 && code.length <= 256,
          ))
      const edit = action['edit'] as LanguageWorkspaceEdit | undefined
      const disabledReason = action['disabledReason']
      const command = action['command']
      const hasEdit = edit !== undefined || command !== undefined
      const hasDisabledReason = disabledReason !== undefined
      if (
        typeof action['title'] !== 'string' ||
        action['title'].length === 0 ||
        action['title'].length > 512 ||
        (action['kind'] !== undefined &&
          (typeof action['kind'] !== 'string' || !CODE_ACTION_KINDS.has(action['kind']))) ||
        (action['isPreferred'] !== undefined && typeof action['isPreferred'] !== 'boolean') ||
        !validCodes ||
        hasEdit === hasDisabledReason ||
        (command !== undefined && !validCommand(command)) ||
        (hasDisabledReason &&
          (typeof disabledReason !== 'string' ||
            disabledReason.length === 0 ||
            disabledReason.length > 1_024))
      ) {
        invalidFeature('language provider returned an invalid code action', request.document.uri)
      }
      if (edit !== undefined) {
        if (!Array.isArray(edit.documentChanges)) {
          invalidFeature(
            'language provider returned an invalid code-action edit',
            request.document.uri,
          )
        }
        for (const change of edit.documentChanges) {
          editCount += Array.isArray(change.edits) ? change.edits.length : maxEdits + 1
        }
        if (editCount > maxEdits) {
          invalidFeature(
            'language provider returned too many code-action edits',
            request.document.uri,
          )
        }
        validateWorkspaceEdit(edit, request, maxEdits, true)
      }
    }
    return list
  }

  const analyzeEntry = (
    entry: OpenDocument,
    request: LanguageWorkspaceDocumentRequest,
  ): Promise<LanguageWorkspaceAnalysisResult> => {
    entry.analysisController?.abort('superseded by a newer language analysis')
    const controller = new AbortController()
    entry.analysisController = controller
    const unlink = linkedSignal(controller, request.signal)
    const pending = (async (): Promise<LanguageWorkspaceAnalysisResult> => {
      try {
        throwIfAborted(controller.signal)
        let candidate: unknown
        try {
          candidate = await entry.resolution.provider.analyze({
            document: request.document,
            ...(request.include === undefined ? {} : { include: request.include }),
            signal: controller.signal,
          })
        } catch (error) {
          if (isCancellation(error)) throw error
          throwIfAborted(controller.signal)
          throw workspaceError(
            LANGUAGE_PROVIDER_FAILED,
            `language provider failed for ${request.document.uri}@${request.document.version}`,
            {
              uri: request.document.uri,
              version: String(request.document.version),
              error: error instanceof Error ? error.message : String(error),
            },
          )
        }
        throwIfAborted(controller.signal)
        const analysis = validateAnalysis(candidate, request.document)
        throwIfAborted(controller.signal)
        const result: LanguageWorkspaceAnalysisResult = Object.freeze({
          state: 'resolved',
          analysis,
          hostDiagnostics: entry.resolution.diagnostics,
        })
        if (documents.get(entry.uri) !== entry || entry.version !== request.document.version) {
          throw new OperationCancelledError('stale language analysis')
        }
        entry.current = result
        return result
      } finally {
        unlink()
        if (entry.analysisController === controller) delete entry.analysisController
      }
    })()
    entry.pending = pending
    return pending
  }

  type SynchronizedDocument =
    | Readonly<{
        state: 'resolved'
        entry: OpenDocument
        hostDiagnostics: readonly Diagnostic[]
      }>
    | Readonly<{
        state: 'unresolved'
        hostDiagnostics: readonly Diagnostic[]
      }>

  const synchronizeOpen = async (
    request: LanguageWorkspaceDocumentRequest,
  ): Promise<SynchronizedDocument> => {
    requireReady()
    validateRequest(request)
    throwIfAborted(request.signal)
    if (documents.has(request.document.uri)) {
      throw workspaceError(
        LANGUAGE_DOCUMENT_ALREADY_OPEN,
        `language document ${request.document.uri} is already open`,
        { uri: request.document.uri },
      )
    }
    const route = routeForRequest(request)
    const resolution = await resolveLanguageProvider({
      services: options.services,
      ...route,
      grant: options.grant,
      budgets: options.budgets,
      ...(options.modContexts === undefined ? {} : { modContexts: modContextPort }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (resolution.state === 'unresolved') {
      throwIfAborted(request.signal)
      return Object.freeze({ state: 'unresolved', hostDiagnostics: resolution.diagnostics })
    }
    try {
      throwIfAborted(request.signal)
    } catch (error) {
      await resolution.release()
      throw error
    }
    const entry: OpenDocument = {
      uri: request.document.uri,
      route,
      resolution,
      version: request.document.version,
      document: languageDocumentSnapshot(request.document),
      released: false,
    }
    invalidateFeatures('language document opened')
    documents.set(entry.uri, entry)
    return Object.freeze({
      state: 'resolved',
      entry,
      hostDiagnostics: resolution.diagnostics,
    })
  }

  const synchronizeChange = (request: LanguageWorkspaceDocumentRequest): OpenDocument => {
    requireReady()
    validateRequest(request)
    const entry = documents.get(request.document.uri)
    if (entry === undefined) {
      throw workspaceError(
        LANGUAGE_DOCUMENT_NOT_OPEN,
        `language document ${request.document.uri} is not open`,
        { uri: request.document.uri },
      )
    }
    const nextRoute = routeForRequest(request)
    if (
      routeKey(entry.route) !== routeKey(nextRoute) ||
      request.document.version <= entry.version
    ) {
      throw workspaceError(
        LANGUAGE_DOCUMENT_CHANGE_INVALID,
        'a language document change must preserve its route and strictly increase its version',
        {
          uri: request.document.uri,
          currentVersion: String(entry.version),
          nextVersion: String(request.document.version),
        },
      )
    }
    invalidateFeatures('language document changed')
    entry.analysisController?.abort('superseded by a newer document version')
    entry.version = request.document.version
    entry.document = languageDocumentSnapshot(request.document)
    delete entry.current
    return entry
  }

  const closeEntry = async (entry: OpenDocument): Promise<void> => {
    if (documents.get(entry.uri) === entry) documents.delete(entry.uri)
    entry.analysisController?.abort('language document closed')
    try {
      await entry.pending
    } catch (error) {
      if (!isCancellation(error)) {
        // Closing owns lease release, not the analysis outcome. A caller already observed a
        // provider/validation failure; repeating it here would make cleanup fail spuriously.
      }
    }
    await release(entry)
    // The editor no longer holds the buffer; the server reads the file on disk again.
    await modContextsNow()
      ?.release(entry.uri)
      .catch(() => undefined)
  }

  const positionAtOffset = (text: string, rawOffset: number): LanguagePosition => {
    const offset = Math.max(0, Math.min(rawOffset, text.length))
    const before = text.slice(0, offset)
    const line = before.split('\n').length - 1
    const start = before.lastIndexOf('\n') + 1
    return { line, character: offset - start }
  }

  const occurrenceRange = (
    occurrence: ReferenceOccurrence,
    document: LanguageDocument,
  ): LanguageRange | undefined => {
    const span = occurrence.source.span as Readonly<Record<string, unknown>>
    if (!Number.isSafeInteger(span['utf16Offset']) || !Number.isSafeInteger(span['utf16Length'])) {
      return undefined
    }
    const start = span['utf16Offset'] as number
    const length = span['utf16Length'] as number
    return {
      start: positionAtOffset(document.text, start),
      end: positionAtOffset(document.text, start + length),
    }
  }

  const mergeLocationLists = (
    ...lists: readonly (LanguageLocationList | undefined)[]
  ): LanguageLocationList | undefined => {
    const present = lists.filter((list): list is LanguageLocationList => list !== undefined)
    if (present.length === 0) return undefined
    const seen = new Set<string>()
    const locations = present
      .flatMap(list => list.locations)
      .filter(location => {
        const { start, end } = location.range
        const key = `${location.uri}#${start.line}:${start.character}-${end.line}:${end.character}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    // the union is at least as complete as its most complete part
    return { locations, isIncomplete: present.every(list => list.isIncomplete) }
  }

  const indexedReferenceLocations = async (
    provider: LanguageProvider,
    feature: LanguageFeatureRequest,
    position: LanguagePosition,
    mode: 'definition' | 'references',
    includeDeclaration = false,
  ): Promise<LanguageLocationList | undefined> => {
    if (
      provider.referenceOccurrences === undefined ||
      feature.workspaceContext === undefined ||
      modContextServed.has(feature)
    ) {
      return undefined
    }
    const context = feature.workspaceContext
    const answerKey = JSON.stringify([
      feature.document.uri,
      context.id,
      context.revision,
      feature.maxDocuments,
      feature.maxResults,
      position.line,
      position.character,
      mode,
      includeDeclaration,
    ])
    const answerAt = referenceAnswers.findIndex(
      answer => answer.provider === provider && answer.key === answerKey,
    )
    const answer = referenceAnswers[answerAt]
    if (answer !== undefined) {
      referenceAnswers.splice(answerAt, 1)
      referenceAnswers.push(answer)
      // Decode an owner-produced answer so a caller cannot mutate a retained result.
      return answer.serialized === undefined
        ? undefined
        : (JSON.parse(answer.serialized) as LanguageLocationList)
    }
    const retainAnswer = (value: LanguageLocationList | undefined): typeof value => {
      const serialized = value === undefined ? undefined : JSON.stringify(value)
      const bytes = 256 + 2 * (answerKey.length + (serialized?.length ?? 0))
      const budget = Math.min(sourceCaptureMaxBytes, 1_024 * 1_024)
      if (bytes > budget) return value
      const priorAt = referenceAnswers.findIndex(
        prior => prior.provider === provider && prior.key === answerKey,
      )
      const prior = referenceAnswers[priorAt]
      if (prior !== undefined) {
        referenceAnswers.splice(priorAt, 1)
        referenceAnswerBytes -= prior.bytes
      }
      while (referenceAnswers.length >= 128 || referenceAnswerBytes + bytes > budget) {
        const oldest = referenceAnswers.shift()
        if (oldest === undefined) break
        referenceAnswerBytes -= oldest.bytes
      }
      referenceAnswers.push({ provider, key: answerKey, serialized, bytes })
      referenceAnswerBytes += bytes
      return value
    }
    if (provider.referenceIndexApplies !== undefined) {
      const applies = await provider.referenceIndexApplies({
        document: feature.document,
        position,
        ...(feature.signal === undefined ? {} : { signal: feature.signal }),
      })
      throwIfAborted(feature.signal)
      if (typeof applies !== 'boolean') {
        invalidFeature(
          'language provider returned an invalid reference index applicability',
          feature.document.uri,
        )
      }
      if (!applies) return retainAnswer(undefined)
    }
    const byUri = new Map(feature.workspaceDocuments.map(document => [document.uri, document]))
    const heldAt = indexedOccurrences.findIndex(
      held =>
        held.provider === provider &&
        held.documentUri === feature.document.uri &&
        held.contextId === context.id &&
        held.contextRevision === context.revision &&
        held.maxDocuments === feature.maxDocuments &&
        held.maxResults === feature.maxResults,
    )
    const held = indexedOccurrences[heldAt]
    const referenceIndex = held?.index ?? createWorkspaceReferenceIndex()
    if (held === undefined) {
      const generation = workspaceGeneration
      const batches = await provider.referenceOccurrences(feature)
      throwIfAborted(feature.signal)
      if (generation !== workspaceGeneration) {
        throw new OperationCancelledError('stale language reference occurrences')
      }
      if (!Array.isArray(batches) || batches.length > feature.maxDocuments) {
        invalidFeature(
          'language provider returned invalid reference occurrence batches',
          feature.document.uri,
        )
      }
      const origins = new Map(context.documentOrigins.map(origin => [origin.uri, origin]))
      for (const batch of batches) {
        const document = byUri.get(batch.sourceUri)
        const origin = origins.get(batch.sourceUri)
        if (
          batch.contextId !== context.id ||
          batch.contextRevision !== context.revision ||
          (batch.semanticComplete && !context.semanticComplete) ||
          document === undefined ||
          origin === undefined ||
          batch.sourceRevision !== origin.sourceRevision
        ) {
          invalidFeature(
            'language provider returned a reference batch for another snapshot',
            feature.document.uri,
          )
        }
        referenceIndex.replace(batch)
      }
      // Account for retained text and index bookkeeping. Oversized answers remain usable for this
      // call, but do not stay resident. This uses the existing bounded workspace byte allowance.
      const bytes =
        JSON.stringify(batches).length * 2 +
        referenceIndex.snapshot().occurrences * 192 +
        batches.length * 256
      if (bytes <= sourceCaptureMaxBytes) {
        // Replace stale revisions or a slot filled by a concurrent identical request. Keep distinct
        // request limits separate so alternating bounded queries can reuse their own valid index.
        for (let at = indexedOccurrences.length - 1; at >= 0; at -= 1) {
          const prior = indexedOccurrences[at]
          if (
            prior !== undefined &&
            prior.provider === provider &&
            prior.documentUri === feature.document.uri &&
            (prior.contextId !== context.id ||
              prior.contextRevision !== context.revision ||
              (prior.maxDocuments === feature.maxDocuments &&
                prior.maxResults === feature.maxResults))
          ) {
            referenceIndexBytes -= prior.bytes
            indexedOccurrences.splice(at, 1)
          }
        }
        while (
          indexedOccurrences.length >= 8 ||
          referenceIndexBytes + bytes > sourceCaptureMaxBytes
        ) {
          const oldest = indexedOccurrences.shift()
          if (oldest === undefined) break
          referenceIndexBytes -= oldest.bytes
        }
        indexedOccurrences.push(
          Object.freeze({
            provider,
            documentUri: feature.document.uri,
            contextId: context.id,
            contextRevision: context.revision,
            maxDocuments: feature.maxDocuments,
            maxResults: feature.maxResults,
            bytes,
            index: referenceIndex,
          }),
        )
        referenceIndexBytes += bytes
      }
    } else {
      indexedOccurrences.splice(heldAt, 1)
      indexedOccurrences.push(held)
    }
    const sourceLines = feature.document.text.split('\n')
    const cursorOffset =
      sourceLines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) +
      position.character
    const atCursor = referenceIndex
      .occurrencesIn(feature.document.uri)
      .flatMap(occurrence => {
        const span = occurrence.source.span as Readonly<Record<string, unknown>>
        const start = span['utf16Offset']
        const length = span['utf16Length']
        return Number.isSafeInteger(start) &&
          Number.isSafeInteger(length) &&
          cursorOffset >= (start as number) &&
          cursorOffset <= (start as number) + (length as number)
          ? [occurrence]
          : []
      })
      .sort((left, right) => {
        const l = (left.source.span as Readonly<Record<string, unknown>>)['utf16Length'] as number
        const r = (right.source.span as Readonly<Record<string, unknown>>)['utf16Length'] as number
        return l - r
      })[0]
    if (atCursor === undefined) return retainAnswer(undefined)
    const occurrences = referenceIndex.occurrences(atCursor.target)
    let selected: readonly Pick<ReferenceOccurrence, 'source' | 'role'>[]
    if (mode === 'definition') {
      const resolution = referenceIndex.resolveIndexed(atCursor.target)
      // An occurrence index may recognize a cross-language reference before it owns the target's
      // declaration. Let the provider's direct definition resolver answer that case.
      if (resolution.state !== 'resolved') return retainAnswer(undefined)
      selected = [...[resolution.declaration], ...resolution.shadowedDeclarations].map(item => ({
        source: item.source,
        role: 'declaration' as const,
      }))
    } else selected = occurrences.filter(item => includeDeclaration || item.role !== 'declaration')
    const locations = selected.flatMap(item => {
      const document = byUri.get(item.source.uri)
      if (document === undefined) return []
      const range = occurrenceRange(item as ReferenceOccurrence, document)
      return range === undefined ? [] : [{ uri: item.source.uri, range }]
    })
    return retainAnswer({
      locations: locations.slice(0, feature.maxResults),
      isIncomplete:
        locations.length > feature.maxResults || !referenceIndex.snapshot().semanticComplete,
    })
  }

  return Object.freeze({
    async initialize(): Promise<void> {
      if (state === 'shut-down') {
        throw workspaceError(LANGUAGE_WORKSPACE_SHUT_DOWN, 'the language workspace is shut down')
      }
      state = 'ready'
    },

    async synchronize(
      request: LanguageWorkspaceDocumentRequest,
    ): Promise<LanguageWorkspaceSynchronizationResult> {
      requireReady()
      validateRequest(request)
      throwIfAborted(request.signal)
      const current = documents.get(request.document.uri)
      if (current === undefined) {
        const synchronized = await synchronizeOpen(request)
        return Object.freeze({
          state: synchronized.state,
          hostDiagnostics: synchronized.hostDiagnostics,
        })
      }
      const nextRoute = routeForRequest(request)
      if (
        current.version === request.document.version &&
        routeKey(current.route) === routeKey(nextRoute) &&
        current.document.text === request.document.text
      ) {
        throwIfAborted(request.signal)
        return Object.freeze({
          state: 'resolved',
          hostDiagnostics: current.resolution.diagnostics,
        })
      }
      const entry = synchronizeChange(request)
      throwIfAborted(request.signal)
      return Object.freeze({
        state: 'resolved',
        hostDiagnostics: entry.resolution.diagnostics,
      })
    },

    analyze(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult> {
      requireReady()
      validateRequest(request)
      const entry = documents.get(request.document.uri)
      const route = routeForRequest(request)
      if (
        entry === undefined ||
        entry.version !== request.document.version ||
        entry.document.text !== request.document.text ||
        routeKey(entry.route) !== routeKey(route)
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_DOCUMENT_CHANGE_INVALID,
            'language analysis needs the exact synchronized document version',
            {
              uri: request.document.uri,
              requestedVersion: String(request.document.version),
              currentVersion: entry === undefined ? 'closed' : String(entry.version),
            },
          ),
        )
      }
      return analyzeEntry(entry, request)
    },

    async open(
      request: LanguageWorkspaceDocumentRequest,
    ): Promise<LanguageWorkspaceAnalysisResult> {
      const synchronized = await synchronizeOpen(request)
      if (synchronized.state === 'unresolved') return synchronized
      try {
        return await analyzeEntry(synchronized.entry, request)
      } catch (error) {
        if (documents.get(synchronized.entry.uri) === synchronized.entry) {
          await closeEntry(synchronized.entry)
        }
        throw error
      }
    },

    async change(
      request: LanguageWorkspaceDocumentRequest,
    ): Promise<LanguageWorkspaceAnalysisResult> {
      return analyzeEntry(synchronizeChange(request), request)
    },

    async current(
      uri: string,
      signal?: AbortSignal,
    ): Promise<LanguageWorkspaceAnalysisResult | undefined> {
      requireReady()
      const entry = documents.get(uri)
      if (entry === undefined) return undefined
      if (entry.pending !== undefined) return waitWithSignal(entry.pending, signal)
      return entry.current
    },

    async capabilities(
      uri: string,
      signal?: AbortSignal,
    ): Promise<LanguageWorkspaceCapabilitySet | undefined> {
      requireReady()
      const entry = documents.get(uri)
      if (entry === undefined) return undefined
      // The activated provider owns this metadata; document analysis cannot change its methods.
      throwIfAborted(signal)
      const provider = entry.resolution.provider
      const optional: readonly [LanguageWorkspaceCapability, keyof LanguageProvider][] = [
        ['completion', 'completion'],
        ['hover', 'hover'],
        ['signature-help', 'signatureHelp'],
        ['definition', 'definition'],
        ['references', 'references'],
        ['prepare-rename', 'prepareRename'],
        ['rename', 'rename'],
        ['formatting', 'formatting'],
        ['on-type-formatting', 'onTypeFormatting'],
        ['document-colors', 'documentColors'],
        ['color-presentations', 'colorPresentations'],
        ['code-actions', 'codeActions'],
        ['code-lenses', 'codeLenses'],
        ['folding-ranges', 'foldingRanges'],
        ['document-links', 'documentLinks'],
        ['document-highlights', 'documentHighlights'],
        ['inlay-hints', 'inlayHints'],
        ['workspace-symbols', 'workspaceSymbols'],
      ]
      return Object.freeze({
        uri: entry.uri,
        documentVersion: entry.version,
        features: Object.freeze([
          'analyze',
          'semantic-tokens',
          'document-symbols',
          'diagnostics',
          ...optional
            .filter(([, property]) => typeof provider[property] === 'function')
            .map(([feature]) => feature),
        ] satisfies LanguageWorkspaceCapability[]),
      })
    },

    completion(
      request: LanguageWorkspaceCompletionRequest,
    ): Promise<LanguageCompletionList | undefined> {
      if (
        request.semanticContextPolicy !== undefined &&
        request.semanticContextPolicy !== 'fresh' &&
        request.semanticContextPolicy !== 'cached'
      ) {
        throw workspaceError(
          LANGUAGE_FEATURE_INVALID,
          'language completion semantic context policy must be fresh or cached',
          { uri: request.uri },
        )
      }
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.completion?.({
            ...feature,
            position: request.position,
          }),
        async (value, feature) => {
          const declared = validateProviderCompletionList(value, feature)
          // Most completions are provider-owned syntax/schema items. Resolving a served subject can
          // open a complete mod and its dependencies, so only pay that cost when the provider has
          // explicitly asked the host to expand a subject reference marker.
          if (!declared.items.some(item => item.kind === 'subject-ref')) {
            return validateCompletionList(declared, feature)
          }
          const candidateLease = await options.subjectCandidates?.open(
            { uri: feature.document.uri },
            feature.signal,
          )
          try {
            const expanded = await expandSubjectReferenceCompletions(
              declared,
              candidateLease?.value,
              feature.maxResults,
              feature.signal,
            )
            return validateCompletionList(expanded, feature)
          } finally {
            await candidateLease?.release()
          }
        },
        { position: request.position },
        request.semanticContextPolicy === 'cached',
        true,
        LANGUAGE_MAX_RESULTS,
        'completion',
      )
    },

    async hover(request: LanguageWorkspacePositionRequest): Promise<LanguageHover | undefined> {
      const hover = await invokeFeature(
        request,
        true,
        (provider, feature) => provider.hover?.({ ...feature, position: request.position }),
        validateHover,
        { position: request.position },
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'hover',
      )
      if (hover?.assets === undefined || hover.assets.length === 0) return hover
      const pictures = await assetPictures(request.uri, hover.assets, request.signal)
      return pictures === '' ? hover : { ...hover, markdown: `${hover.markdown}${pictures}` }
    },

    async resolveCompletion(
      request: LanguageWorkspacePositionRequest & { readonly item: LanguageCompletionItem },
    ): Promise<LanguageCompletionItem | undefined> {
      const resolved = await invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.resolveCompletion?.({
            ...feature,
            position: request.position,
            item: request.item,
          }) ?? Promise.resolve(request.item),
        (value, feature) => {
          const item = recordOf(value)
          if (
            item === undefined ||
            !validCompletionItem(item, lineLengths(feature.document.text)) ||
            item['label'] !== request.item.label ||
            item['kind'] !== request.item.kind ||
            (item['asset'] !== undefined && !validAssetRef(item['asset']))
          )
            invalidFeature(
              'language provider resolved a completion item into another one',
              feature.document.uri,
            )
          return value as LanguageCompletionItem
        },
        { position: request.position, item: request.item },
      )
      if (resolved?.asset === undefined) return resolved
      const pictures = await assetPictures(request.uri, [resolved.asset], request.signal)
      return pictures === ''
        ? resolved
        : { ...resolved, documentation: `${resolved.documentation ?? ''}${pictures}` }
    },

    signatureHelp(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageSignatureHelp | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) => provider.signatureHelp?.({ ...feature, position: request.position }),
        validateSignatureHelp,
        { position: request.position },
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'signatureHelp',
      )
    },

    definition(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageLocationList | undefined> {
      return invokeFeature(
        request,
        true,
        async (provider, feature) => {
          const indexed = await indexedReferenceLocations(
            provider,
            feature,
            request.position,
            'definition',
          )
          return indexed !== undefined && indexed.locations.length > 0
            ? indexed
            : provider.definition?.({ ...feature, position: request.position })
        },
        validateLocationList,
        { position: request.position },
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'definition',
      )
    },

    references(
      request: LanguageWorkspaceReferencesRequest,
    ): Promise<LanguageLocationList | undefined> {
      return invokeFeature(
        request,
        true,
        async (provider, feature) => {
          const indexed = await indexedReferenceLocations(
            provider,
            feature,
            request.position,
            'references',
            request.includeDeclaration === true,
          )
          // The index and the provider each see part of the answer (a Data provider merges the
          // references of every language; the index holds typed occurrences): one deduplicated list.
          const answered = await provider.references?.({
            ...feature,
            position: request.position,
            ...(request.includeDeclaration === undefined
              ? {}
              : { includeDeclaration: request.includeDeclaration }),
          })
          return mergeLocationLists(indexed, answered)
        },
        validateLocationList,
        {
          position: request.position,
          ...(request.includeDeclaration === undefined
            ? {}
            : { includeDeclaration: request.includeDeclaration }),
        },
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'references',
      )
    },

    prepareRename(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageRenamePreparation | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) => provider.prepareRename?.({ ...feature, position: request.position }),
        validatePreparation,
        { position: request.position },
      )
    },

    rename(request: LanguageWorkspaceRenameRequest): Promise<LanguageWorkspaceEdit | undefined> {
      if (
        typeof request.newName !== 'string' ||
        request.newName.length === 0 ||
        request.newName.length > 256 ||
        /[\u0000-\u001f\u007f]/u.test(request.newName)
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'rename needs a non-empty bounded name without control characters',
            {
              uri: request.uri,
            },
          ),
        )
      }
      const maxEdits = boundedInteger(
        request.maxEdits,
        LANGUAGE_DEFAULT_MAX_EDITS,
        LANGUAGE_MAX_EDITS,
        'maxEdits',
      )
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.rename?.({
            ...feature,
            position: request.position,
            newName: request.newName,
            maxEdits,
          }),
        (value, feature) => validateWorkspaceEdit(value, feature, maxEdits, true),
        { position: request.position, newName: request.newName, maxEdits },
      )
    },

    formatting(
      request: LanguageWorkspaceFormattingRequest,
    ): Promise<LanguageTextEditList | undefined> {
      let providerOptions: LanguageFormattingOptions
      try {
        providerOptions = validatedFormattingOptions(request.options, request.uri)
      } catch (error) {
        return Promise.reject(error)
      }
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.formatting?.({ ...feature, options: providerOptions }),
        validateTextEditList,
        { options: providerOptions },
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'formatting',
      )
    },

    onTypeFormatting(
      request: LanguageWorkspaceOnTypeFormattingRequest,
    ): Promise<LanguageOnTypeEditResult | undefined> {
      if (
        request.semanticContextPolicy !== undefined &&
        request.semanticContextPolicy !== 'fresh' &&
        request.semanticContextPolicy !== 'cached'
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'on-type formatting semantic context policy must be fresh or cached',
            { uri: request.uri },
          ),
        )
      }
      if (typeof request.ch !== 'string' || [...request.ch].length !== 1) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'on-type formatting needs exactly one trigger character',
            { uri: request.uri },
          ),
        )
      }
      if (
        !requireFeatureEntry(request, true).route.onTypeFormattingTriggerCharacters?.includes(
          request.ch,
        )
      ) {
        return Promise.resolve(undefined)
      }
      let providerOptions: LanguageFormattingOptions
      try {
        providerOptions = validatedFormattingOptions(request.options, request.uri)
      } catch (error) {
        return Promise.reject(error)
      }
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.onTypeFormatting?.({
            ...feature,
            position: request.position,
            ch: request.ch,
            options: providerOptions,
          }),
        validateOnTypeEditResult,
        { position: request.position, ch: request.ch, options: providerOptions },
        request.semanticContextPolicy === 'cached',
      )
    },

    documentColors(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageColorList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.documentColors?.(feature),
        validateColorList,
        {},
        false,
        false,
        LANGUAGE_MAX_DOCUMENT_RESULTS,
      )
    },

    codeLenses(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageCodeLensList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.codeLenses?.(feature),
        validateCodeLenses,
        {},
        false,
        false,
        LANGUAGE_MAX_DOCUMENT_RESULTS,
      )
    },

    foldingRanges(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageFoldingRangeList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.foldingRanges?.(feature),
        validateFoldingRanges,
        {},
        false,
        false,
        LANGUAGE_MAX_DOCUMENT_RESULTS,
        'foldingRanges',
      )
    },

    documentLinks(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageDocumentLinkList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.documentLinks?.(feature),
        validateDocumentLinks,
        {},
        false,
        false,
        LANGUAGE_MAX_DOCUMENT_RESULTS,
      )
    },

    documentHighlights(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageDocumentHighlightList | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.documentHighlights?.({ ...feature, position: request.position }),
        validateDocumentHighlights,
        { position: request.position },
      )
    },

    inlayHints(
      request: LanguageWorkspaceInlayHintsRequest,
    ): Promise<LanguageInlayHintList | undefined> {
      const entry = requireFeatureEntry(request, false)
      if (!validRange(request.range, lineLengths(entry.document.text))) {
        return Promise.reject(
          workspaceError(LANGUAGE_FEATURE_INVALID, 'inlay hints need a range inside the document', {
            uri: request.uri,
          }),
        )
      }
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.inlayHints?.({ ...feature, range: request.range }),
        validateInlayHints,
        { range: request.range },
      )
    },

    colorPresentations(
      request: LanguageWorkspaceColorPresentationRequest,
    ): Promise<LanguageColorPresentationList | undefined> {
      const entry = requireFeatureEntry(request, false)
      if (
        !validColor(request.color) ||
        !validRange(request.range, lineLengths(entry.document.text))
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'colour presentation needs normalized RGBA channels and a valid document range',
            { uri: request.uri },
          ),
        )
      }
      const color = Object.freeze({ ...request.color })
      const range = Object.freeze({
        start: Object.freeze({ ...request.range.start }),
        end: Object.freeze({ ...request.range.end }),
      })
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.colorPresentations?.({ ...feature, color, range }),
        validateColorPresentations,
        { color, range },
      )
    },

    codeActions(
      request: LanguageWorkspaceCodeActionsRequest,
    ): Promise<LanguageCodeActionList | undefined> {
      const entry = requireFeatureEntry(request, false)
      const lengths = lineLengths(entry.document.text)
      if (
        !validRange(request.range, lengths) ||
        !Array.isArray(request.diagnostics) ||
        request.diagnostics.length > (request.maxResults ?? LANGUAGE_DEFAULT_MAX_RESULTS) ||
        !request.diagnostics.every(item => validDiagnostic(item, lengths))
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'code actions need a valid range and bounded document diagnostics',
            { uri: request.uri },
          ),
        )
      }
      const maxEdits = boundedInteger(
        request.maxEdits,
        LANGUAGE_DEFAULT_MAX_EDITS,
        LANGUAGE_MAX_EDITS,
        'maxEdits',
      )
      const range = Object.freeze({
        start: Object.freeze({ ...request.range.start }),
        end: Object.freeze({ ...request.range.end }),
      })
      const diagnostics = Object.freeze(request.diagnostics.map(item => Object.freeze({ ...item })))
      return invokeFeature(
        request,
        false,
        (provider, feature) =>
          provider.codeActions?.({
            ...feature,
            range,
            diagnostics,
            maxEdits,
          }),
        (value, feature) => validateCodeActionList(value, feature, maxEdits),
        { range, diagnostics, maxEdits },
      )
    },

    documentSymbols(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageDocumentSymbolList | undefined> {
      const entry = requireFeatureEntry(request, false, LANGUAGE_MAX_DOCUMENT_RESULTS)
      return invokeFeature(
        request,
        false,
        async (provider, feature) => {
          if (provider.documentSymbols !== undefined) return provider.documentSymbols(feature)
          const current =
            entry.pending === undefined
              ? entry.current
              : await waitWithSignal(entry.pending, feature.signal)
          if (current?.state !== 'resolved') return { symbols: [], isIncomplete: true }
          return {
            symbols: current.analysis.symbols,
            isIncomplete: feature.workspaceIncomplete,
          }
        },
        validateDocumentSymbols,
        {},
        false,
        false,
        LANGUAGE_MAX_DOCUMENT_RESULTS,
        'documentSymbols',
      )
    },

    workspaceSymbols(
      request: LanguageWorkspaceSymbolsRequest,
    ): Promise<LanguageWorkspaceSymbolList | undefined> {
      if (typeof request.query !== 'string') {
        return Promise.reject(
          workspaceError(LANGUAGE_FEATURE_INVALID, 'workspace symbol query must be a string', {
            uri: request.uri,
          }),
        )
      }
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.workspaceSymbols?.({ ...feature, query: request.query }),
        validateWorkspaceSymbols,
        { query: request.query },
      )
    },

    projectDiagnostics(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageProjectDiagnostics | undefined> {
      return invokeFeature(
        request,
        false,
        async (provider, feature) => {
          const writable = new Set(
            (feature.workspaceContext?.documentOrigins ?? [])
              .filter(origin => !origin.readOnly)
              .map(origin => origin.uri),
          )
          const found: LanguageProjectDiagnostics['documents'][number][] = []
          let isIncomplete = languageWorkspaceIsSemanticallyIncomplete(feature)
          for (const document of feature.workspaceDocuments) {
            if (
              documents.has(document.uri) ||
              !writable.has(document.uri) ||
              !provider.languageIds.includes(document.languageId)
            )
              continue
            throwIfAborted(feature.signal)
            // Closed files need the same semantic validation and workspace context as Verify.
            const documentFeature = { ...feature, document }
            const report = validateDiagnosticList(
              provider.diagnostics === undefined
                ? {
                    diagnostics: (
                      await provider.analyze({
                        document,
                        include: { diagnostics: true },
                        ...(feature.signal === undefined ? {} : { signal: feature.signal }),
                      })
                    ).diagnostics,
                    isIncomplete: false,
                  }
                : await provider.diagnostics(documentFeature),
              documentFeature,
            )
            isIncomplete ||= report.isIncomplete
            found.push({
              uri: document.uri,
              version: document.version,
              diagnostics: report.diagnostics,
            })
          }
          return { documents: found, isIncomplete }
        },
        (value, feature) => {
          const result = value as LanguageProjectDiagnostics
          const texts = new Map(feature.workspaceDocuments.map(item => [item.uri, item.text]))
          const valid =
            typeof result === 'object' &&
            result !== null &&
            typeof result.isIncomplete === 'boolean' &&
            Array.isArray(result.documents) &&
            result.documents.every(item => {
              const text = texts.get(item.uri)
              return (
                text !== undefined &&
                Array.isArray(item.diagnostics) &&
                item.diagnostics.length <= feature.maxResults &&
                item.diagnostics.every((diagnostic: LanguageDiagnostic) =>
                  validDiagnostic(diagnostic, lineLengths(text)),
                )
              )
            })
          if (!valid)
            invalidFeature(
              'language provider returned invalid or unbounded project diagnostics',
              feature.document.uri,
            )
          return result
        },
      )
    },

    diagnostics(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageDiagnosticList | undefined> {
      const entry = requireFeatureEntry(request, false)
      return invokeFeature(
        request,
        false,
        async (provider, feature) => {
          if (provider.diagnostics !== undefined) return provider.diagnostics(feature)
          const current =
            entry.pending === undefined
              ? entry.current
              : await waitWithSignal(entry.pending, feature.signal)
          if (current?.state !== 'resolved') return { diagnostics: [], isIncomplete: true }
          return {
            diagnostics: current.analysis.diagnostics,
            isIncomplete: languageWorkspaceIsSemanticallyIncomplete(feature),
          }
        },
        validateDiagnosticList,
        {},
        false,
        false,
        LANGUAGE_MAX_RESULTS,
        'diagnostics',
      )
    },

    invalidate(reason = 'language workspace context changed'): void {
      requireReady()
      invalidateFeatures(reason)
    },

    async close(uri: string): Promise<void> {
      requireReady()
      const entry = documents.get(uri)
      if (entry !== undefined) {
        invalidateFeatures('language document closed')
        await closeEntry(entry)
      }
    },

    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise
      state = 'shut-down'
      shutdownPromise = (async () => {
        invalidateFeatures('language workspace shut down')
        sourceDocumentCaptures.clear()
        const open = [...documents.values()]
        documents.clear()
        for (const entry of open) entry.analysisController?.abort('language workspace shut down')
        const failures: unknown[] = []
        for (const entry of open) {
          try {
            await closeEntry(entry)
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length > 0) throw failures[0]
      })()
      return shutdownPromise
    },
  })
}
