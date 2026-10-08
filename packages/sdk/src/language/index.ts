/**
 * Protocol-neutral language analysis contract.
 *
 * Editors, command-line checks and LSP adapters consume the same provider handle. Routing stays
 * inert and JSON-safe in the service offer/request facets; source text and analysis results cross
 * the activated provider boundary only after the host has resolved and admitted that offer.
 */

import type { ServiceProviderModule } from '../runtime-abi.js'
import type { SubjectFilter } from '../fields/index.js'
import type { ReferenceOccurrenceBatch } from '../references.js'
import type { JsonValue } from '../asset-capabilities/types.js'

/** Standard service coordinate for syntax-aware document analysis. */
export const LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = 'common.language/document-analysis' as const

/** Host-owned matcher profile used by the standard language contract definition. */
export const LANGUAGE_DOCUMENT_MATCHER_PROFILE = 'modkit/language-document-matcher' as const

export interface LanguagePosition {
  /** Zero-based line. */
  readonly line: number
  /** Zero-based UTF-16 code-unit offset, matching editor and LSP coordinates. */
  readonly character: number
}

export interface LanguageRange {
  readonly start: LanguagePosition
  readonly end: LanguagePosition
}

export interface LanguageDocument {
  readonly uri: string
  readonly languageId: string
  readonly version: number
  readonly text: string
  /**
   * The dialect a game declared for this file (`modkit.languageFiles`, `.scar` → `lua51`). A
   * provider that knows it parses in it; an unknown one falls back to its own detection.
   */
  readonly dialect?: string
}

export type LanguageTokenKind =
  | 'comment'
  | 'function'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'parameter'
  | 'property'
  | 'string'
  | 'type'
  | 'variable'

export interface LanguageToken {
  readonly range: LanguageRange
  readonly kind: LanguageTokenKind
  readonly modifiers?: readonly string[]
}

export type LanguageDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface LanguageDiagnostic {
  readonly range: LanguageRange
  readonly severity: LanguageDiagnosticSeverity
  readonly message: string
  readonly code?: string
  readonly source?: string
  /** `unnecessary`: drawn faded (an unused variable); `deprecated`: struck through. */
  readonly tags?: readonly ('unnecessary' | 'deprecated')[]
  /** Other places the problem involves: the first declaration of a duplicate id, say. */
  readonly relatedInformation?: readonly LanguageDiagnosticRelatedInformation[]
  /** An http(s) page that explains the code. */
  readonly codeDescription?: string
}

export interface LanguageDiagnosticRelatedInformation {
  readonly location: LanguageLocation
  readonly message: string
}

/**
 * What a lens or a code action asks the application to do, from a closed set it runs with its own
 * UI: open an entity of the document's workspace (its card, relation graph or resolved view, by
 * the id its facts use, `Unit/Marine`), or open a place.
 */
export type LanguageCommand =
  | {
      readonly kind: 'open-subject'
      readonly subjectId: string
      readonly view?: 'card' | 'graph' | 'resolved'
    }
  | { readonly kind: 'open-location'; readonly location: LanguageLocation }

/** A line of actions above a declaration: «inherited from Liberty», «card», «graph». */
export interface LanguageCodeLens {
  readonly range: LanguageRange
  readonly title: string
  readonly command?: LanguageCommand
}

export interface LanguageCodeLensList {
  readonly lenses: readonly LanguageCodeLens[]
  readonly isIncomplete: boolean
}

export type LanguageSymbolKind =
  | 'class'
  | 'constant'
  | 'enum'
  | 'field'
  | 'function'
  | 'interface'
  | 'module'
  | 'namespace'
  | 'property'
  | 'struct'
  | 'variable'

export interface LanguageSymbol {
  readonly name: string
  readonly kind: LanguageSymbolKind
  readonly range: LanguageRange
  readonly selectionRange: LanguageRange
  readonly detail?: string
  readonly children?: readonly LanguageSymbol[]
}

export interface LanguageAnalysisRequest {
  readonly document: LanguageDocument
  /** Omitted means all three products. */
  readonly include?: Readonly<{
    readonly tokens?: boolean
    readonly diagnostics?: boolean
    readonly symbols?: boolean
  }>
  readonly signal?: AbortSignal
}

export interface LanguageAnalysis {
  readonly documentUri: string
  readonly documentVersion: number
  readonly tokens: readonly LanguageToken[]
  readonly diagnostics: readonly LanguageDiagnostic[]
  readonly symbols: readonly LanguageSymbol[]
}

/** A location in an open or provider-owned protocol-neutral document. */
export interface LanguageLocation {
  readonly uri: string
  readonly range: LanguageRange
}

/**
 * `color`: the editor draws a swatch from the item's `documentation` (or `label`) when it is a CSS
 * colour (`#rrggbb`); `file` and `folder`: asset paths and includes.
 */
export type LanguageCompletionItemKind =
  | LanguageSymbolKind
  | 'keyword'
  | 'parameter'
  | 'snippet'
  | 'text'
  | 'type'
  | 'color'
  | 'file'
  | 'folder'
  | 'enum-member'
  | 'event'

export interface LanguageCompletionItem {
  readonly label: string
  readonly kind: LanguageCompletionItemKind
  readonly detail?: string
  readonly documentation?: string
  readonly insertText?: string
  readonly insertTextFormat?: 'plain-text' | 'snippet'
  /** Document range replaced when this item is accepted. Defaults to the editor's current word. */
  readonly replacementRange?: LanguageRange
  readonly sortText?: string
  /**
   * The text the editor matches what is typed against, when it is not the label: an item whose
   * `replacementRange` starts at a shortcut character (`:`, `.`, `@`, `/`) names that character
   * here too, or the editor filters it out.
   */
  readonly filterText?: string
  /** Selected when the list opens (a required hook before the optional ones). */
  readonly preselect?: boolean
  /** Characters that accept the item as typed, then insert themselves (`.`, `(`). */
  readonly commitCharacters?: readonly string[]
  /** Ask for completions again once this item is inserted: `name=""` then its values. */
  readonly retrigger?: boolean
  /** Still accepted, but on its way out; the editor strikes it through. */
  readonly deprecated?: boolean
  /** An asset the item names; the host draws it when the item is resolved, not in the list. */
  readonly asset?: LanguageAssetRef
}

/**
 * Declarative request for workspace candidates. A language provider states the semantic target;
 * the host obtains identities from the same selector used by schema-driven field editors.
 */
export interface LanguageSubjectReferenceCompletion {
  readonly kind: 'subject-ref'
  readonly subjectKind: string
  readonly filter?: SubjectFilter
}

export type LanguageProviderCompletionItem =
  LanguageCompletionItem | LanguageSubjectReferenceCompletion

export interface LanguageProviderCompletionList {
  readonly items: readonly LanguageProviderCompletionItem[]
  readonly isIncomplete: boolean
}

export interface LanguageCompletionList {
  readonly items: readonly LanguageCompletionItem[]
  /** True when a caller limit or a bounded workspace snapshot omitted possible items. */
  readonly isIncomplete: boolean
}

export interface LanguageHover {
  readonly markdown: string
  readonly range?: LanguageRange
  readonly provenance?: string
  /** Pictures to show with it (a texture path under the cursor); the host draws them. */
  readonly assets?: readonly LanguageAssetRef[]
  /** Links the reader can follow: the entity's card, its relation graph. */
  readonly commands?: readonly LanguageHoverCommand[]
}

/**
 * An asset a hover or a completion names, by the path its game spells it with
 * (`Assets\Textures\btn-unit-terran-marine.dds`). The provider never decodes it: the host finds it
 * in the document's workspace and draws a small picture.
 */
export interface LanguageAssetRef {
  readonly path: string
  readonly label?: string
}

export interface LanguageHoverCommand {
  readonly title: string
  readonly command: LanguageCommand
}

/** RGBA channels in the normalized 0..1 range used by editor colour APIs. */
export interface LanguageColor {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

export interface LanguageColorInformation {
  readonly range: LanguageRange
  readonly color: LanguageColor
}

export interface LanguageColorList {
  readonly colors: readonly LanguageColorInformation[]
  readonly isIncomplete: boolean
}

/** Lines `startLine`..`endLine` (zero-based, inclusive) the editor can fold. */
export interface LanguageFoldingRange {
  readonly startLine: number
  readonly endLine: number
  readonly kind?: 'comment' | 'imports' | 'region'
}

export interface LanguageFoldingRangeList {
  readonly ranges: readonly LanguageFoldingRange[]
  readonly isIncomplete: boolean
}

/** A span that opens something else: an included file, an asset, a subject. */
export interface LanguageDocumentLink {
  readonly range: LanguageRange
  /** A URI the host can open: a workspace document, an asset, a serialized subject ref. */
  readonly target: string
  readonly tooltip?: string
}

export interface LanguageDocumentLinkList {
  readonly links: readonly LanguageDocumentLink[]
  readonly isIncomplete: boolean
}

/** Another place in the document naming what is under the cursor. */
export interface LanguageDocumentHighlight {
  readonly range: LanguageRange
  readonly kind?: 'text' | 'read' | 'write'
}

export interface LanguageDocumentHighlightList {
  readonly highlights: readonly LanguageDocumentHighlight[]
  readonly isIncomplete: boolean
}

/** A short note drawn inside the text: a parameter's name, a resolved type or value. */
export interface LanguageInlayHint {
  readonly position: LanguagePosition
  readonly label: string
  readonly kind?: 'type' | 'parameter'
  readonly tooltip?: string
  readonly paddingLeft?: boolean
  readonly paddingRight?: boolean
}

export interface LanguageInlayHintList {
  readonly hints: readonly LanguageInlayHint[]
  readonly isIncomplete: boolean
}

export interface LanguageColorPresentation {
  readonly label: string
  /** Optional exact replacement for `range`; omission lets the editor insert `label`. */
  readonly textEdit?: LanguageTextEdit
}

export interface LanguageColorPresentationList {
  readonly presentations: readonly LanguageColorPresentation[]
  readonly isIncomplete: boolean
}

export interface LanguageSignatureParameter {
  readonly label: string
  readonly documentation?: string
}

export interface LanguageSignatureInformation {
  readonly label: string
  readonly documentation?: string
  readonly parameters: readonly LanguageSignatureParameter[]
}

export interface LanguageSignatureHelp {
  readonly signatures: readonly LanguageSignatureInformation[]
  readonly activeSignature: number
  readonly activeParameter: number
}

export interface LanguageLocationList {
  readonly locations: readonly LanguageLocation[]
  readonly isIncomplete: boolean
}

export interface LanguageRenamePreparation {
  readonly range: LanguageRange
  readonly placeholder: string
}

export interface LanguageTextEdit {
  readonly range: LanguageRange
  readonly newText: string
}

export interface LanguageFormattingOptions {
  /** Indentation width in UTF-16 columns. */
  readonly tabSize: number
  readonly insertSpaces: boolean
  /** Omitted preserves the source document's final-newline state. */
  readonly finalNewline?: boolean
}

export interface LanguageTextEditList {
  readonly edits: readonly LanguageTextEdit[]
  /** Formatting is refused instead of returning a partial edit set. */
  readonly isComplete: true
}

export interface LanguageTextDocumentEdit {
  readonly uri: string
  /** Exact open snapshot version against which the edits were calculated. */
  readonly documentVersion: number
  readonly edits: readonly LanguageTextEdit[]
}

export interface LanguageWorkspaceEdit {
  readonly documentChanges: readonly LanguageTextDocumentEdit[]
  /** A partial workspace may return only an exact-version edit of its primary document. */
  readonly isComplete: true
}

export type LanguageCodeActionKind =
  'quickfix' | 'refactor' | 'refactor.extract' | 'refactor.inline' | 'rewrite' | 'source'

/** A bounded, command-free editor action. Mutations are exact-version workspace edits. */
export interface LanguageCodeAction {
  readonly title: string
  readonly kind?: LanguageCodeActionKind
  readonly isPreferred?: boolean
  readonly diagnosticCodes?: readonly string[]
  readonly edit?: LanguageWorkspaceEdit
  /** Run after the edit, or alone: open the entity a fix concerns. */
  readonly command?: LanguageCommand
  readonly disabledReason?: string
}

export interface LanguageCodeActionList {
  readonly actions: readonly LanguageCodeAction[]
  readonly isIncomplete: boolean
}

export interface LanguageWorkspaceSymbol {
  readonly name: string
  readonly kind: LanguageSymbolKind
  readonly location: LanguageLocation
  readonly containerName?: string
  readonly detail?: string
}

export interface LanguageWorkspaceSymbolList {
  readonly symbols: readonly LanguageWorkspaceSymbol[]
  readonly isIncomplete: boolean
}

export interface LanguageDocumentSymbolList {
  readonly symbols: readonly LanguageSymbol[]
  readonly isIncomplete: boolean
}

export interface LanguageDiagnosticList {
  readonly diagnostics: readonly LanguageDiagnostic[]
  readonly isIncomplete: boolean
}

/** Host-authored identity of one document inside a resolved semantic context. */
export interface LanguageWorkspaceDocumentOrigin {
  readonly uri: string
  /** Stable identity of the mod, dependency, root, or other precedence layer. */
  readonly layerId: string
  /** Logical file identity shared across layers for merge and precedence semantics. */
  readonly logicalId: string
  /** Weakest to strongest. Higher precedence overrides lower precedence. */
  readonly precedence: number
  readonly sourceRevision: string
  readonly readOnly: boolean
  /** True for an open buffer replacing the same logical file in the same layer. */
  readonly overlay?: boolean
}

/**
 * One non-document input whose identity or revision can change semantic answers.
 *
 * `kind` names the authority (for example `locale-set`, `provider` or `schema`), `id` selects the
 * concrete authority, and `revision` changes whenever the selected authority's meaning changes.
 * Hosts include these inputs in workspace snapshot identities so caches never reuse answers across
 * a schema, provider, dependency closure or locale change.
 */
export interface LanguageWorkspaceSemanticInput {
  readonly kind: string
  readonly id: string
  readonly revision: string
  /** Optional bounded, immutable JSON data supplied by the input's owning authority. */
  readonly payload?: JsonValue
}

/**
 * Provider-declared request for game knowledge files the subject's context carries (an API dump,
 * a module map). The host finds a file with one of these names at the root of any context layer
 * and supplies each as a `language-knowledge` semantic input
 * (`payload: { fileName, layerId, text }`), weaker layers first. They never become documents.
 */
export interface LanguageKnowledgeSemanticContextRequirement {
  readonly kind: 'language-knowledge'
  readonly fileNames: readonly string[]
}

/**
 * Provider-declared request for the server of the loaded mod the document belongs to (owner
 * decision 07.10). The host names that server in `LanguageWorkspaceContext.modContext` and gives the
 * provider `ContributionContext.modContexts` to ask it; no resolved Data is analysed or sent whole.
 */
export interface LanguageModContextSemanticContextRequirement {
  readonly kind: 'mod-context'
  readonly gameId: string
}

export type LanguageSemanticContextRequirement =
  LanguageKnowledgeSemanticContextRequirement | LanguageModContextSemanticContextRequirement

/** Versioned host-owned mod/dependency context shared by every language provider. */
export interface LanguageWorkspaceContext {
  readonly id: string
  readonly revision: string
  readonly semanticComplete: boolean
  readonly documentOrigins: readonly LanguageWorkspaceDocumentOrigin[]
  readonly semanticInputs?: readonly LanguageWorkspaceSemanticInput[]
  /**
   * The loaded mod's server this request reads, for a provider that declared a `mod-context`
   * requirement: the scope to ask through `ContributionContext.modContexts`, the server's revision
   * after the editor's open buffers reached it, and whether the mod's chain is complete.
   */
  readonly modContext?: LanguageWorkspaceModContext
}

export interface LanguageWorkspaceModContext {
  readonly scope: string
  readonly gameId: string
  readonly revision: string
  readonly complete: boolean
}

/**
 * Bounded inputs for one semantic request. `workspaceDocuments` includes `document` and never
 * exceeds `maxDocuments`. An opted-in ModContext feature receives only that live document and
 * reads dependency semantics from the synchronized server; its completeness follows the server.
 * No provider owns mutable editor state or transport objects.
 */
export interface LanguageFeatureRequest {
  readonly document: LanguageDocument
  readonly workspaceDocuments: readonly LanguageDocument[]
  readonly workspaceContext?: LanguageWorkspaceContext
  readonly workspaceIncomplete: boolean
  readonly maxResults: number
  readonly maxDocuments: number
  readonly signal?: AbortSignal
}

/** True when read-only semantic answers may omit documents, independent of editability. */
export const languageWorkspaceIsSemanticallyIncomplete = (
  request: Pick<LanguageFeatureRequest, 'workspaceContext' | 'workspaceIncomplete'>,
): boolean =>
  request.workspaceContext === undefined
    ? request.workspaceIncomplete
    : !request.workspaceContext.semanticComplete

export interface LanguagePositionRequest extends LanguageFeatureRequest {
  readonly position: LanguagePosition
}

/** One item of a completion list, to fill in when the editor focuses it (documentation, detail). */
export interface LanguageCompletionResolveRequest extends LanguagePositionRequest {
  readonly item: LanguageCompletionItem
}

export interface LanguageInlayHintsRequest extends LanguageFeatureRequest {
  readonly range: LanguageRange
}

export interface LanguageReferencesRequest extends LanguagePositionRequest {
  readonly includeDeclaration?: boolean
}

export interface LanguageRenameRequest extends LanguagePositionRequest {
  readonly newName: string
  readonly maxEdits: number
}

export interface LanguageWorkspaceSymbolsRequest extends LanguageFeatureRequest {
  readonly query: string
}

export interface LanguageFormattingRequest extends LanguageFeatureRequest {
  readonly options: LanguageFormattingOptions
}

/** A formatting request made immediately after the editor inserted one trigger character. */
export interface LanguageOnTypeFormattingRequest extends LanguagePositionRequest {
  readonly ch: string
  readonly options: LanguageFormattingOptions
}

/** Atomic on-type editor action calculated against the request's exact document version. */
export interface LanguageOnTypeEditResult extends LanguageTextEditList {
  /** Absolute caret position in the document after `edits` are applied. */
  readonly cursor?: LanguagePosition
  /** Ask an interactive editor to open completion after applying edits and moving the caret. */
  readonly requestCompletion?: boolean
}

export interface LanguageColorPresentationRequest extends LanguageFeatureRequest {
  readonly color: LanguageColor
  readonly range: LanguageRange
}

export interface LanguageCodeActionsRequest extends LanguageFeatureRequest {
  readonly range: LanguageRange
  readonly diagnostics: readonly LanguageDiagnostic[]
  readonly maxEdits: number
}

/** Features that may explicitly prove they need only the live document and provider schema. */
export type LanguageDocumentLocalFeature = 'documentSymbols' | 'foldingRanges' | 'formatting'

/** Activated provider surface. It is deliberately independent of any LSP transport package. */
export interface LanguageProvider {
  readonly contract: typeof LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT
  readonly languageIds: readonly string[]
  /** Provider-owned schemas/specifications that participate in semantic cache identity. */
  readonly semanticInputs?: readonly LanguageWorkspaceSemanticInput[]
  /** Host-resolved semantic contexts required by this provider. */
  readonly semanticContextRequirements?: readonly LanguageSemanticContextRequirement[]
  /**
   * Explicit opt-in for bounded mixed-language workspace snapshots.
   *
   * Omission preserves the v1 behavior: feature requests contain only documents whose language
   * id matches the primary document. Providers that compose protocol-neutral cross-language
   * indexes may list the additional language ids they can parse here. The host still applies the
   * caller's maxDocuments bound and marks truncated snapshots incomplete.
   */
  readonly workspaceLanguageIds?: readonly string[]
  /**
   * Opt-in per feature: receive only the current document, without a workspace scan or ModContext.
   * The workspace context stays semantically incomplete; providers must judge the completeness of
   * the local result themselves. Omission keeps the full workspace, including on older hosts.
   * Never declare a feature here if its answer depends on inherited values or other documents.
   */
  readonly documentLocalFeatures?: readonly LanguageDocumentLocalFeature[]
  /**
   * Read semantic hover from the synchronized ModContext instead of a workspace snapshot. The
   * request keeps the live document, host/provider semantic inputs (including locales) and server
   * revision/completeness; dependency values and provenance come from that server. Without a
   * loaded server the host supplies the usual bounded snapshot. Older hosts ignore this opt-in.
   */
  readonly modContextFeatures?: readonly 'hover'[]
  analyze(request: LanguageAnalysisRequest): Promise<LanguageAnalysis>
  /**
   * Optional proof that completion at this position needs only the live document and provider
   * schema. Omission means workspace. The host uses document mode only for interactive cached
   * completion; fresh requests and all other features retain the full dependency context.
   */
  completionContext?(
    request: Pick<LanguagePositionRequest, 'document' | 'position' | 'signal'>,
  ): Promise<'document' | 'workspace'>
  completion?(request: LanguagePositionRequest): Promise<LanguageProviderCompletionList>
  /**
   * Fill in one item the editor focused, so the list itself stays cheap: documentation read on
   * demand, a heavy detail. The label, kind and edit stay as they were.
   */
  resolveCompletion?(request: LanguageCompletionResolveRequest): Promise<LanguageCompletionItem>
  hover?(request: LanguagePositionRequest): Promise<LanguageHover | undefined>
  signatureHelp?(request: LanguagePositionRequest): Promise<LanguageSignatureHelp | undefined>
  definition?(request: LanguagePositionRequest): Promise<LanguageLocationList>
  references?(request: LanguageReferencesRequest): Promise<LanguageLocationList>
  prepareRename?(request: LanguagePositionRequest): Promise<LanguageRenamePreparation | undefined>
  rename?(request: LanguageRenameRequest): Promise<LanguageWorkspaceEdit | undefined>
  formatting?(request: LanguageFormattingRequest): Promise<LanguageTextEditList>
  onTypeFormatting?(request: LanguageOnTypeFormattingRequest): Promise<LanguageOnTypeEditResult>
  documentColors?(request: LanguageFeatureRequest): Promise<LanguageColorList>
  colorPresentations?(
    request: LanguageColorPresentationRequest,
  ): Promise<LanguageColorPresentationList>
  codeActions?(request: LanguageCodeActionsRequest): Promise<LanguageCodeActionList>
  codeLenses?(request: LanguageFeatureRequest): Promise<LanguageCodeLensList>
  foldingRanges?(request: LanguageFeatureRequest): Promise<LanguageFoldingRangeList>
  documentLinks?(request: LanguageFeatureRequest): Promise<LanguageDocumentLinkList>
  documentHighlights?(request: LanguagePositionRequest): Promise<LanguageDocumentHighlightList>
  /** Hints within `range`, the part of the document the editor shows. */
  inlayHints?(request: LanguageInlayHintsRequest): Promise<LanguageInlayHintList>
  documentSymbols?(request: LanguageFeatureRequest): Promise<LanguageDocumentSymbolList>
  workspaceSymbols?(request: LanguageWorkspaceSymbolsRequest): Promise<LanguageWorkspaceSymbolList>
  diagnostics?(request: LanguageFeatureRequest): Promise<LanguageDiagnosticList>
  /** Typed owner-authored occurrences used by the host cross-module reference index. */
  referenceOccurrences?(
    request: LanguageFeatureRequest,
  ): Promise<readonly ReferenceOccurrenceBatch[]>
  /**
   * Optional local proof that this position can name an occurrence emitted by referenceOccurrences.
   * False skips only the typed index; normal provider definition/references still run. Return true
   * whenever uncertain. Omission preserves full indexing. This must use the same occurrence owner.
   */
  referenceIndexApplies?(
    request: Pick<LanguagePositionRequest, 'document' | 'position' | 'signal'>,
  ): Promise<boolean>
}

/** JSON-safe route advertised by a provider contribution. */
export interface LanguageProviderOfferFacet {
  readonly languageIds: readonly string[]
  readonly documentKinds?: readonly string[]
  readonly extensions?: readonly string[]
  /**
   * Files the provider serves by their exact name (case-insensitive), for documents a game knows
   * by name rather than extension (`Objects`, `Preload.xml`). A file-name route wins over an
   * extension route for that file.
   */
  readonly fileNames?: readonly string[]
  /** Characters that should automatically request completion in editor and LSP adapters. */
  readonly completionTriggerCharacters?: readonly string[]
  /** Characters that should automatically request signature help in editor and LSP adapters. */
  readonly signatureHelpTriggerCharacters?: readonly string[]
  /** Characters after which editor and LSP adapters should request on-type formatting edits. */
  readonly onTypeFormattingTriggerCharacters?: readonly string[]
}

/** JSON-safe route supplied by an editor, checker or LSP adapter. */
export interface LanguageProviderRequestFacet {
  readonly languageId: string
  readonly documentKind?: string
  readonly extension?: string
  /** The exact file name, when the route is a file-name route. */
  readonly fileName?: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.language/document-analysis': { 1: LanguageProvider }
  }

  interface ContractRequestMap {
    'common.language/document-analysis': {
      1: { presence: 'required'; facet: LanguageProviderRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.language/document-analysis': {
      1: { presence: 'required'; facet: LanguageProviderOfferFacet }
    }
  }
}

export type LanguageProviderModule = ServiceProviderModule<
  typeof LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  1
>

export * from './translation.js'
