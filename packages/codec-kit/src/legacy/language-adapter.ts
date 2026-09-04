import {
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  type LanguageProvider,
  type LanguageAnalysisRequest,
  type LanguageAnalysis,
} from '@modkit/sdk/language'
import type { LanguageModule } from './language-contracts/module.js'
import { adaptLegacyError } from './diagnostics.js'

/** Explicit protocol-neutral product projections for an already initialized legacy module. */
export interface LanguageModuleProjection {
  analyze(module: LanguageModule, request: LanguageAnalysisRequest): Promise<LanguageAnalysis>
  readonly features?: Partial<Omit<LanguageProvider, 'contract' | 'languageIds' | 'analyze'>>
}

/** Host registers the returned provider through MK3. No connection or document registry is created. */
export function adaptLanguageModule(
  module: LanguageModule,
  projection: LanguageModuleProjection,
): LanguageProvider {
  return {
    ...projection.features,
    contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
    languageIds: [module.languageId],
    async analyze(request) {
      request.signal?.throwIfAborted()
      if (request.document.languageId !== module.languageId)
        throw new TypeError('Language document does not match the selected provider')
      try {
        const result = await projection.analyze(module, request)
        request.signal?.throwIfAborted()
        if (
          result.documentUri !== request.document.uri ||
          result.documentVersion !== request.document.version
        )
          throw new TypeError('Legacy analysis returned a different document snapshot')
        return result
      } catch (error) {
        throw adaptLegacyError(error)
      }
    },
  }
}
