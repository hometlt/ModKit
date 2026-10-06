/**
 * Canonical language/translation service definitions, facet routing and secured activation.
 * Language method surfaces carry SDK features across in-process and worker execution, including
 * entity commands and focused completion documentation. Providers retain schemas and language
 * semantics; this module owns neither game parsing nor editor UI. Workspace.ts owns feature budgets.
 * Other published Host entries reference this language entry so immutable context capture and its
 * memoized tokens share one runtime owner; unknown inputs still cross defensive validation.
 */

import {
  contractId,
  diagnostic,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import {
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  LANGUAGE_DOCUMENT_MATCHER_PROFILE,
  TRANSLATION_CONTRACT,
  TRANSLATION_MATCHER_PROFILE,
  type LanguageProvider,
  type LanguageProviderOfferFacet,
  type LanguageProviderRequestFacet,
  type LanguageWorkspaceSemanticInput,
  type TranslationProviderOfferFacet,
  type TranslationProviderRequestFacet,
} from '@modkit/sdk/language'
import type {
  ContributionSettings,
  DefinitionInventoryResult,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'
import {
  languageWorkspaceContextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './context.js'
import { validatedLanguageSemanticContextRequirements } from './semantic-context.js'
import { languageFileAssociations } from './workspace.js'

/** Owner id under which the platform definition is registered. */
export const STANDARD_LANGUAGE_OWNER = 'modkit/language'

const OFFER_KEYS = new Set([
  'languageIds',
  'documentKinds',
  'extensions',
  'fileNames',
  'completionTriggerCharacters',
  'signatureHelpTriggerCharacters',
  'onTypeFormattingTriggerCharacters',
])
const REQUEST_KEYS = new Set(['languageId', 'documentKind', 'extension', 'fileName'])

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (!value.every(item => typeof item === 'string' && item.trim().length > 0)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function triggerCharacterList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (!value.every(item => typeof item === 'string' && [...item].length === 1)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function parseOffer(value: unknown): LanguageProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const languageIds = stringList(record['languageIds'])
  if (languageIds === undefined) return undefined
  const rawKinds = record['documentKinds']
  const rawExtensions = record['extensions']
  const rawFileNames = record['fileNames']
  const fileNames = rawFileNames === undefined ? undefined : stringList(rawFileNames)
  const rawCompletionTriggers = record['completionTriggerCharacters']
  const rawSignatureTriggers = record['signatureHelpTriggerCharacters']
  const rawOnTypeFormattingTriggers = record['onTypeFormattingTriggerCharacters']
  const documentKinds = rawKinds === undefined ? undefined : stringList(rawKinds)
  const extensions = rawExtensions === undefined ? undefined : stringList(rawExtensions)
  const completionTriggerCharacters =
    rawCompletionTriggers === undefined ? undefined : triggerCharacterList(rawCompletionTriggers)
  const signatureHelpTriggerCharacters =
    rawSignatureTriggers === undefined ? undefined : triggerCharacterList(rawSignatureTriggers)
  const onTypeFormattingTriggerCharacters =
    rawOnTypeFormattingTriggers === undefined
      ? undefined
      : triggerCharacterList(rawOnTypeFormattingTriggers)
  if (
    (rawKinds !== undefined && documentKinds === undefined) ||
    (rawExtensions !== undefined && extensions === undefined) ||
    (rawFileNames !== undefined && fileNames === undefined) ||
    (rawCompletionTriggers !== undefined && completionTriggerCharacters === undefined) ||
    (rawSignatureTriggers !== undefined && signatureHelpTriggerCharacters === undefined) ||
    (rawOnTypeFormattingTriggers !== undefined && onTypeFormattingTriggerCharacters === undefined)
  ) {
    return undefined
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

function parseRequest(value: unknown): LanguageProviderRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key)))
    return undefined
  const languageId = record['languageId']
  const documentKind = record['documentKind']
  const extension = record['extension']
  const fileName = record['fileName']
  if (typeof languageId !== 'string' || languageId.trim().length === 0) return undefined
  if (fileName !== undefined && (typeof fileName !== 'string' || fileName.length === 0)) {
    return undefined
  }
  if (
    documentKind !== undefined &&
    (typeof documentKind !== 'string' || documentKind.length === 0)
  ) {
    return undefined
  }
  if (extension !== undefined && (typeof extension !== 'string' || extension.length === 0)) {
    return undefined
  }
  return {
    languageId,
    ...(documentKind === undefined ? {} : { documentKind }),
    ...(extension === undefined ? {} : { extension }),
    ...(fileName === undefined ? {} : { fileName }),
  }
}

const normalizedExtension = (value: string): string => value.replace(/^\./u, '').toLowerCase()

function matchLanguageFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/language-facet-invalid',
          `${context.contract}@${context.major}: language request and offer routes must be well formed`,
        ),
      ],
    }
  }
  if (!offer.languageIds.includes(request.languageId)) return { state: 'no-match' }
  if (request.documentKind !== undefined && !offer.documentKinds?.includes(request.documentKind)) {
    return { state: 'no-match' }
  }
  if (request.fileName !== undefined) {
    const wanted = request.fileName.toLowerCase()
    if (!offer.fileNames?.some(name => name.toLowerCase() === wanted)) return { state: 'no-match' }
    return {
      state: 'match',
      selectionKey: [
        `language=${request.languageId}`,
        `document=${request.documentKind ?? '*'}`,
        `file=${wanted}`,
      ].join(';'),
    }
  }
  const requestExtension = request.extension
  /*
   * An offer that names no extensions is not constrained by one: it is selected by language id and
   * document kind. This lets a provider for a single well-known file (an SC2 `BankList.xml`) route
   * without claiming the `.xml` extension, which would make every other `.xml` ambiguous for
   * extension-only workspace snapshots.
   */
  if (
    requestExtension !== undefined &&
    offer.extensions !== undefined &&
    !offer.extensions.some(
      value => normalizedExtension(value) === normalizedExtension(requestExtension),
    )
  ) {
    return { state: 'no-match' }
  }
  return {
    state: 'match',
    selectionKey: [
      `language=${request.languageId}`,
      `document=${request.documentKind ?? '*'}`,
      `extension=${request.extension === undefined ? '*' : normalizedExtension(request.extension)}`,
    ].join(';'),
  }
}

/** Host-trusted deterministic router for language provider offers. */
export const LANGUAGE_DOCUMENT_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(LANGUAGE_DOCUMENT_MATCHER_PROFILE),
  major: 1,
  match: matchLanguageFacets,
})

/** Require every SDK method in the wire surface; optional implementation still needs a declared ABI. */
type LanguageMethodSurface = {
  [
    Key in keyof LanguageProvider as NonNullable<LanguageProvider[Key]> extends (
      ...args: never[]
    ) => unknown
      ? Key
      : never
  ]-?: unknown
}

/** Standard protocol-neutral language analysis definition. */
export const LANGUAGE_DOCUMENT_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/language-provider-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/language-provider-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: LANGUAGE_DOCUMENT_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.language/document-analysis-v1',
    surface: Object.freeze({
      fields: Object.freeze([
        'contract',
        'languageIds',
        'workspaceLanguageIds',
        'semanticInputs',
        'semanticContextRequirements',
      ]),
      methods: Object.freeze({
        analyze: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        completion: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        resolveCompletion: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        completionContext: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        hover: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        signatureHelp: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        definition: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        references: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        prepareRename: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        rename: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        formatting: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        onTypeFormatting: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        documentColors: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        foldingRanges: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        documentLinks: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        documentHighlights: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        inlayHints: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        colorPresentations: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        codeActions: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        codeLenses: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        documentSymbols: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        workspaceSymbols: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        diagnostics: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        referenceOccurrences: Object.freeze({
          kind: 'value',
          optional: true,
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      } satisfies LanguageMethodSurface),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
const TRANSLATION_OFFER_KEYS = new Set(['backends', 'languages'])
const TRANSLATION_REQUEST_KEYS = new Set(['backend', 'sourceLanguage', 'targetLanguage'])

function parseTranslationOffer(value: unknown): TranslationProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !TRANSLATION_OFFER_KEYS.has(key)))
    return undefined
  const backends = stringList(record['backends'])
  if (backends === undefined || backends.length === 0) return undefined
  const languages = record['languages'] === undefined ? undefined : stringList(record['languages'])
  if (record['languages'] !== undefined && languages === undefined) return undefined
  return {
    backends: backends as TranslationProviderOfferFacet['backends'],
    ...(languages === undefined ? {} : { languages }),
  }
}

function parseTranslationRequest(value: unknown): TranslationProviderRequestFacet | undefined {
  if (value === undefined) return {}
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !TRANSLATION_REQUEST_KEYS.has(key)))
    return undefined
  for (const key of TRANSLATION_REQUEST_KEYS) {
    const entry = record[key]
    if (entry !== undefined && (typeof entry !== 'string' || entry.trim().length === 0))
      return undefined
  }
  return record as TranslationProviderRequestFacet
}

/**
 * A request names a backend, a language pair, or neither.
 *
 * A caller that names a backend gets that backend or nothing — silently translating through a
 * different service is not a fallback, it is a different bill and a different privacy answer. A
 * provider that lists its languages is held to them; one that lists none accepts any pair, which is
 * what a general-purpose model does.
 */
function matchTranslationFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseTranslationOffer(context.offerFacet)
  const request = parseTranslationRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/translation-facet-invalid',
          `${context.contract}@${context.major}: translation request and offer routes must be well formed`,
        ),
      ],
    }
  }
  if (request.backend !== undefined && !offer.backends.includes(request.backend))
    return { state: 'no-match' }
  const languages = offer.languages
  if (languages !== undefined) {
    for (const language of [request.sourceLanguage, request.targetLanguage]) {
      if (language !== undefined && !languages.includes(language)) return { state: 'no-match' }
    }
  }
  const route = [
    request.backend === undefined ? 'backend=any' : `backend=${request.backend}`,
    `from=${request.sourceLanguage ?? 'any'}`,
    `to=${request.targetLanguage ?? 'any'}`,
  ].join(';')
  return { state: 'match', selectionKey: route }
}

/** Host-trusted deterministic router for machine-translation offers. */
export const TRANSLATION_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(TRANSLATION_MATCHER_PROFILE),
  major: 1,
  match: matchTranslationFacets,
})

/**
 * Standard machine-translation definition.
 *
 * Without it the contract exists only as a type: a codec that resolves it gets «arguments do not
 * name a registered surface», because a service can cross an execution boundary only through a
 * registered surface, and every codec in the editor, the CLI and the browser runs worker-brokered.
 * StarCraft II's localization codec has carried a working translator behind that wall.
 */
export const TRANSLATION_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire = Object.freeze({
  schemaVersion: 1,
  kind: 'service',
  contract: TRANSLATION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: 'required',
    schema: Object.freeze({
      $ref: 'https://schemas.modkit.org/x3/translation-provider-offer.v1.schema.json',
    }),
  }),
  requestFacet: Object.freeze({
    presence: 'optional',
    schema: Object.freeze({
      $ref: 'https://schemas.modkit.org/x3/translation-provider-request.v1.schema.json',
    }),
  }),
  matching: Object.freeze({ profile: TRANSLATION_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: 'common.language/translation-v1',
  surface: Object.freeze({
    fields: Object.freeze(['contract']),
    methods: Object.freeze({
      backends: Object.freeze({ kind: 'value' }),
      translate: Object.freeze({
        kind: 'value',
        signal: Object.freeze({ arg: 0, key: 'signal' }),
      }),
    }),
  }),
}) as ServiceContractDefinitionSpecV1Wire

export function registerStandardLanguageDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  return definitions.replaceOwnerInventory(
    STANDARD_LANGUAGE_OWNER,
    [LANGUAGE_DOCUMENT_CONTRACT_DEFINITION, TRANSLATION_CONTRACT_DEFINITION].map(definition => ({
      definition,
      provenance: {
        ownerExtensionId: STANDARD_LANGUAGE_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-language-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-language-definitions',
      },
    })),
  )
}

export interface LanguageHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
  /**
   * The host's settings for a language provider (hint verbosity, checks to run), by its id; the
   * provider reads them as `ContributionContext.settings`, as a codec does.
   */
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
}

export interface ResolveLanguageProviderRequest extends LanguageProviderRequestFacet {
  readonly services: LanguageHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type LanguageProviderResolution =
  | Readonly<{
      state: 'resolved'
      provider: LanguageProvider
      diagnostics: readonly Diagnostic[]
      /** Host-attested selected offer and artifact identity; providers cannot forge this input. */
      semanticInput: LanguageWorkspaceSemanticInput
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isLanguageProvider(value: unknown): value is LanguageProvider {
  const record = recordOf(value)
  const workspaceLanguageIds = record?.['workspaceLanguageIds']
  const semanticInputs = record?.['semanticInputs']
  const semanticContextRequirements = record?.['semanticContextRequirements']
  return (
    record?.['contract'] === LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT &&
    Array.isArray(record['languageIds']) &&
    record['languageIds'].every(item => typeof item === 'string') &&
    (workspaceLanguageIds === undefined ||
      (Array.isArray(workspaceLanguageIds) &&
        workspaceLanguageIds.length > 0 &&
        workspaceLanguageIds.length <= 16 &&
        workspaceLanguageIds.every(item => typeof item === 'string' && item.trim().length > 0) &&
        new Set(workspaceLanguageIds).size === workspaceLanguageIds.length)) &&
    (semanticInputs === undefined || validProviderSemanticInputs(semanticInputs)) &&
    (record['completionContext'] === undefined ||
      typeof record['completionContext'] === 'function') &&
    (semanticContextRequirements === undefined ||
      validProviderSemanticContextRequirements(
        semanticContextRequirements,
        workspaceLanguageIds === undefined ? record['languageIds'] : workspaceLanguageIds,
      )) &&
    typeof record['analyze'] === 'function'
  )
}

function validProviderSemanticContextRequirements(value: unknown, languageIds: unknown): boolean {
  if (!Array.isArray(languageIds)) return false
  try {
    const allowed = new Set(languageIds)
    return validatedLanguageSemanticContextRequirements(value).every(
      requirement =>
        requirement.kind !== 'resolved-data-snapshot' ||
        requirement.languageIds.every(languageId => allowed.has(languageId)),
    )
  } catch {
    return false
  }
}

function validProviderSemanticInputs(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false
  try {
    validatedLanguageWorkspaceSemanticInputs(value)
    return true
  } catch {
    return false
  }
}

/** Resolve and activate the language provider for one document route. */
export async function resolveLanguageProvider(
  request: ResolveLanguageProviderRequest,
): Promise<LanguageProviderResolution> {
  throwIfAborted(request.signal)
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/language-provider-unavailable',
          'this host registered no service-contract definitions, so language providers cannot be resolved',
        ),
      ],
    }
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.services.contributionSettings === undefined
      ? {}
      : { contributionSettings: request.services.contributionSettings }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  let released = false
  const releaseResolver = async (): Promise<void> => {
    if (released) return
    released = true
    await resolver.release()
  }
  // A game's file association (`.scar` → lua) is not an extension the language's provider knows:
  // that provider is selected by language alone.
  const associated =
    request.extension !== undefined &&
    languageFileAssociations(request.services.inventory).some(
      association =>
        association.languageId === request.languageId &&
        association.extension === normalizedExtension(request.extension!),
    )
  const facet: LanguageProviderRequestFacet = {
    languageId: request.languageId,
    ...(request.documentKind === undefined ? {} : { documentKind: request.documentKind }),
    ...(request.extension === undefined || associated ? {} : { extension: request.extension }),
  }
  try {
    const lease = await resolver.port.resolve({
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      major: 1,
      facet,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (!isLanguageProvider(lease.value) || !lease.value.languageIds.includes(request.languageId)) {
      await releaseResolver()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/language-provider-invalid',
            `the selected provider does not implement ${LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT}@1 for ${request.languageId}`,
          ),
        ],
      }
    }
    // Activation may complete concurrently with caller cancellation. Check while the resolver
    // still owns the lease so that this boundary can release it before cancellation escapes.
    throwIfAborted(request.signal)
    const fact = resolver.activationFacts.at(-1)
    if (fact === undefined || fact.contract !== LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT) {
      throw new TypeError('resolved language provider has no activation attestation')
    }
    return Object.freeze({
      state: 'resolved',
      provider: lease.value,
      semanticInput: Object.freeze({
        kind: 'provider-artifact',
        id: `${fact.providerId}/${fact.offerId}/${fact.runtimeVariant}`,
        revision: languageWorkspaceContextToken({
          artifactDigest: fact.artifactDigest,
          manifestDigest: fact.manifestDigest,
          offerFingerprint: fact.offerFingerprint,
        }),
      }),
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/language-provider-selected',
          `selected a language provider for ${request.languageId}`,
        ),
      ]),
      release: releaseResolver,
    })
  } catch (error) {
    let releaseError: unknown
    try {
      await releaseResolver()
    } catch (failure) {
      releaseError = failure
    }
    if (isCancellation(error)) throw error
    throwIfAborted(request.signal)
    if (releaseError !== undefined) throw releaseError
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/language-provider-unresolved',
          `no language provider resolved for ${request.languageId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

export {
  languageFileAssociations,
  languageFileAssociationFor,
  xmlRootElementName,
  createLanguageWorkspace,
  classifyLanguageFile,
  createLanguageFileClassifier,
  languageFileExtension,
  languageProviderRoutes,
  languageRouteServesFile,
  languageProviderTriggerCharacters,
  LANGUAGE_ANALYSIS_INVALID,
  LANGUAGE_DEFAULT_MAX_DOCUMENTS,
  LANGUAGE_DEFAULT_MAX_EDITS,
  LANGUAGE_DEFAULT_MAX_RESULTS,
  LANGUAGE_DOCUMENT_ALREADY_OPEN,
  LANGUAGE_DOCUMENT_CHANGE_INVALID,
  LANGUAGE_DOCUMENT_NOT_OPEN,
  LANGUAGE_FEATURE_INVALID,
  LANGUAGE_EDIT_READ_ONLY,
  LANGUAGE_MAX_DOCUMENTS,
  LANGUAGE_MAX_DOCUMENT_RESULTS,
  LANGUAGE_MAX_EDITS,
  LANGUAGE_MAX_RESULTS,
  LANGUAGE_PROVIDER_FAILED,
  LANGUAGE_SEMANTIC_CONTEXT_MEMORY_BYTES,
  LANGUAGE_WORKSPACE_NOT_INITIALIZED,
  LANGUAGE_WORKSPACE_SHUT_DOWN,
  languageAssetPictures,
  type LanguageAssetImage,
  type LanguageAssetImageRequest,
  type LanguageProjectDiagnostics,
  type LanguageProviderRoute,
  type LanguageWorkspace,
  type LanguageWorkspaceAnalysisResult,
  type LanguageWorkspaceCapability,
  type LanguageWorkspaceCapabilitySet,
  type LanguageWorkspaceCodeActionsRequest,
  type LanguageWorkspaceColorPresentationRequest,
  type LanguageWorkspaceDocumentSource,
  type LanguageWorkspaceDocumentSourceRequest,
  type LanguageWorkspaceDocumentSourceResult,
  type LanguageWorkspaceDocumentRequest,
  type LanguageWorkspaceFeatureRequest,
  type LanguageWorkspaceFormattingRequest,
  type LanguageWorkspaceInlayHintsRequest,
  type LanguageWorkspaceOnTypeFormattingRequest,
  type LanguageWorkspaceOptions,
  type LanguageWorkspacePositionRequest,
  type LanguageWorkspaceReferencesRequest,
  type LanguageWorkspaceRenameRequest,
  type LanguageWorkspaceSymbolsRequest,
} from './workspace.js'
export type {
  LanguageSemanticContextStore,
  LanguageSemanticContextStoreSaveRequest,
} from './semantic-context.js'
export { expandSubjectReferenceCompletions } from './subject-completion.js'
export {
  languageDocumentSnapshot,
  languageDocumentTextToken,
  languageImmutableCapture,
  languageWorkspaceContextToken,
  validatedLanguageWorkspaceSemanticInputs,
} from './context.js'
export { contentPathIndexSemanticInputs } from './content-path-index.js'
