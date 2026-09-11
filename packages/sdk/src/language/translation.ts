/**
 * Machine translation as a service, not as a feature of one format.
 *
 * StarCraft II's localization codec carried a working translator: six backends, and a scheme that
 * masks markup before sending text and refuses the result if a placeholder came back moved. Every
 * other format with localized text needs exactly that and none of it is about StarCraft II — so the
 * transport belongs to a provider that any codec can resolve, and only the masking, which is
 * format-specific, stays with the format.
 *
 * Two decisions are worth stating because both prevent a specific wrong answer.
 *
 * A provider translates text, never markup. It is given a string that the caller has already made
 * safe — placeholders masked, tags removed or sentinelled — and it does not attempt to understand
 * what is in it. A provider that tried to protect markup itself would have to know every format's
 * grammar, and would silently mangle the one it did not.
 *
 * The result may be the input. A backend that cannot translate a string returns it unchanged rather
 * than guessing, and the contract says so through `changed` instead of leaving the caller to compare
 * strings and infer. "Already in the target language" and "the service declined" look identical
 * otherwise.
 */

import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for machine translation. */
export const TRANSLATION_CONTRACT = 'common.language/translation' as const

/**
 * What a backend is, named rather than free-form.
 *
 * The list is the set of transports that exist, not a preference: a host chooses one, and a codec
 * that hard-codes a choice takes that decision away from the person paying for the API key.
 */
export type TranslationBackend =
  | 'google'
  | 'openai'
  | 'codex'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

export interface TranslationRequest {
  /** The text to translate, already made safe by the caller. */
  readonly text: string
  /** Source language, ISO 639-1 (`en`) or a locale tag the backend accepts. */
  readonly sourceLanguage: string
  readonly targetLanguage: string
  /** Which backend to use; the provider's default when omitted. */
  readonly backend?: TranslationBackend
  /**
   * Free-form context for backends that accept it — the surrounding document, the project, the
   * terminology of the game. Ignored by backends that translate a string in isolation.
   */
  readonly context?: string
  /** An identifier for the string, when the backend can use it as a hint. */
  readonly key?: string
  readonly signal?: AbortSignal
}

export interface TranslationResult {
  readonly text: string
  /**
   * False when the provider returned the input unchanged.
   *
   * A backend does that for a string with nothing translatable in it, and after a failed check of
   * its own result. Reporting it is the difference between "this needs no translation" and "the
   * translation was refused", which a caller cannot tell from the text alone.
   */
  readonly changed: boolean
  readonly backend: TranslationBackend
}

export interface TranslationBackendInfo {
  readonly id: TranslationBackend
  readonly label: string
  /** True when the backend needs a key or endpoint the host has not supplied. */
  readonly requiresCredentials: boolean
  /** True when this provider can reach it right now. */
  readonly available: boolean
}

export interface TranslationProvider {
  readonly contract: typeof TRANSLATION_CONTRACT
  /**
   * What this provider can reach, and what it is missing.
   *
   * Asked before offering a translation to a reader: a backend listed as unavailable because no key
   * was supplied is a setting to fix, not an error to report after the click.
   */
  backends(): Promise<readonly TranslationBackendInfo[]>
  translate(request: TranslationRequest): Promise<TranslationResult>
}

/** JSON-safe route advertised by a translation provider contribution. */
export interface TranslationProviderOfferFacet {
  readonly backends: readonly TranslationBackend[]
  /** Language tags the provider claims, or omitted when it accepts any pair. */
  readonly languages?: readonly string[]
}

/** JSON-safe route supplied by a caller. */
export interface TranslationProviderRequestFacet {
  readonly backend?: TranslationBackend
  readonly sourceLanguage?: string
  readonly targetLanguage?: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.language/translation': { 1: TranslationProvider }
  }

  interface ContractRequestMap {
    'common.language/translation': {
      1: { presence: 'optional'; facet: TranslationProviderRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.language/translation': {
      1: { presence: 'required'; facet: TranslationProviderOfferFacet }
    }
  }
}

export type TranslationProviderModule = ServiceProviderModule<typeof TRANSLATION_CONTRACT, 1>
