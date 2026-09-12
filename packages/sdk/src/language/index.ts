/**
 * Protocol-neutral language analysis contract.
 *
 * Editors, command-line checks and LSP adapters consume the same provider handle. Routing stays
 * inert and JSON-safe in the service offer/request facets; source text and analysis results cross
 * the activated provider boundary only after the host has resolved and admitted that offer.
 */

import type { ServiceProviderModule } from '../runtime-abi.js'
import type { SubjectFilter } from '../fields/index.js'

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

export type LanguageCompletionItemKind =
  LanguageSymbolKind | 'keyword' | 'parameter' | 'snippet' | 'text' | 'type'

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
  /** Rename is refused instead of returning this object when the workspace snapshot is partial. */
  readonly isComplete: true
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

/**
 * Full snapshots supplied to one semantic request. `workspaceDocuments` includes `document` and
 * never exceeds `maxDocuments`; no provider owns mutable editor state or transport objects.
 */
export interface LanguageFeatureRequest {
  readonly document: LanguageDocument
  readonly workspaceDocuments: readonly LanguageDocument[]
  readonly workspaceIncomplete: boolean
  readonly maxResults: number
  readonly maxDocuments: number
  readonly signal?: AbortSignal
}

export interface LanguagePositionRequest extends LanguageFeatureRequest {
  readonly position: LanguagePosition
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

export interface LanguageColorPresentationRequest extends LanguageFeatureRequest {
  readonly color: LanguageColor
  readonly range: LanguageRange
}

/** Activated provider surface. It is deliberately independent of any LSP transport package. */
export interface LanguageProvider {
  readonly contract: typeof LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT
  readonly languageIds: readonly string[]
  /**
   * Explicit opt-in for bounded mixed-language workspace snapshots.
   *
   * Omission preserves the v1 behavior: feature requests contain only documents whose language
   * id matches the primary document. Providers that compose protocol-neutral cross-language
   * indexes may list the additional language ids they can parse here. The host still applies the
   * caller's maxDocuments bound and marks truncated snapshots incomplete.
   */
  readonly workspaceLanguageIds?: readonly string[]
  analyze(request: LanguageAnalysisRequest): Promise<LanguageAnalysis>
  completion?(request: LanguagePositionRequest): Promise<LanguageProviderCompletionList>
  hover?(request: LanguagePositionRequest): Promise<LanguageHover | undefined>
  signatureHelp?(request: LanguagePositionRequest): Promise<LanguageSignatureHelp | undefined>
  definition?(request: LanguagePositionRequest): Promise<LanguageLocationList>
  references?(request: LanguageReferencesRequest): Promise<LanguageLocationList>
  prepareRename?(request: LanguagePositionRequest): Promise<LanguageRenamePreparation | undefined>
  rename?(request: LanguageRenameRequest): Promise<LanguageWorkspaceEdit | undefined>
  formatting?(request: LanguageFormattingRequest): Promise<LanguageTextEditList>
  documentColors?(request: LanguageFeatureRequest): Promise<LanguageColorList>
  colorPresentations?(
    request: LanguageColorPresentationRequest,
  ): Promise<LanguageColorPresentationList>
  documentSymbols?(request: LanguageFeatureRequest): Promise<LanguageDocumentSymbolList>
  workspaceSymbols?(request: LanguageWorkspaceSymbolsRequest): Promise<LanguageWorkspaceSymbolList>
  diagnostics?(request: LanguageFeatureRequest): Promise<LanguageDiagnosticList>
}

/** JSON-safe route advertised by a provider contribution. */
export interface LanguageProviderOfferFacet {
  readonly languageIds: readonly string[]
  readonly documentKinds?: readonly string[]
  readonly extensions?: readonly string[]
}

/** JSON-safe route supplied by an editor, checker or LSP adapter. */
export interface LanguageProviderRequestFacet {
  readonly languageId: string
  readonly documentKind?: string
  readonly extension?: string
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
