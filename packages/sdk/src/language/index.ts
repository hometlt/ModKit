/**
 * Protocol-neutral language analysis contract.
 *
 * Editors, command-line checks and LSP adapters consume the same provider handle. Routing stays
 * inert and JSON-safe in the service offer/request facets; source text and analysis results cross
 * the activated provider boundary only after the host has resolved and admitted that offer.
 */

import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for syntax-aware document analysis. */
export const LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = 'common.language/document-analysis' as const

/** Host-owned matcher profile used by the standard language contract definition. */
export const LANGUAGE_DOCUMENT_MATCHER_PROFILE = 'org.modkitx/language-document-matcher' as const

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

/** Activated provider surface. It is deliberately independent of any LSP transport package. */
export interface LanguageProvider {
  readonly contract: typeof LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT
  readonly languageIds: readonly string[]
  analyze(request: LanguageAnalysisRequest): Promise<LanguageAnalysis>
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
