/** Host definition, routing matcher and activation adapter for the standard language contract. */

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
  type LanguageProvider,
  type LanguageProviderOfferFacet,
  type LanguageProviderRequestFacet,
} from '@modkit/sdk/language'
import type {
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

/** Owner id under which the platform definition is registered. */
export const STANDARD_LANGUAGE_OWNER = 'modkit/language'

const OFFER_KEYS = new Set(['languageIds', 'documentKinds', 'extensions'])
const REQUEST_KEYS = new Set(['languageId', 'documentKind', 'extension'])

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

function parseOffer(value: unknown): LanguageProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const languageIds = stringList(record['languageIds'])
  if (languageIds === undefined) return undefined
  const rawKinds = record['documentKinds']
  const rawExtensions = record['extensions']
  const documentKinds = rawKinds === undefined ? undefined : stringList(rawKinds)
  const extensions = rawExtensions === undefined ? undefined : stringList(rawExtensions)
  if (
    (rawKinds !== undefined && documentKinds === undefined) ||
    (rawExtensions !== undefined && extensions === undefined)
  ) {
    return undefined
  }
  return {
    languageIds,
    ...(documentKinds === undefined ? {} : { documentKinds }),
    ...(extensions === undefined ? {} : { extensions }),
  }
}

function parseRequest(value: unknown): LanguageProviderRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key)))
    return undefined
  const languageId = record['languageId']
  const documentKind = record['documentKind']
  const extension = record['extension']
  if (typeof languageId !== 'string' || languageId.trim().length === 0) return undefined
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
  const requestExtension = request.extension
  if (
    requestExtension !== undefined &&
    !offer.extensions?.some(
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
      fields: Object.freeze(['contract', 'languageIds', 'workspaceLanguageIds']),
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
        codeActions: Object.freeze({
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
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardLanguageDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = LANGUAGE_DOCUMENT_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_LANGUAGE_OWNER, [
    {
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
    },
  ])
}

export interface LanguageHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
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
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isLanguageProvider(value: unknown): value is LanguageProvider {
  const record = recordOf(value)
  const workspaceLanguageIds = record?.['workspaceLanguageIds']
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
    typeof record['analyze'] === 'function'
  )
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
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  let released = false
  const releaseResolver = async (): Promise<void> => {
    if (released) return
    released = true
    await resolver.release()
  }
  const facet: LanguageProviderRequestFacet = {
    languageId: request.languageId,
    ...(request.documentKind === undefined ? {} : { documentKind: request.documentKind }),
    ...(request.extension === undefined ? {} : { extension: request.extension }),
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
    return Object.freeze({
      state: 'resolved',
      provider: lease.value,
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
  createLanguageWorkspace,
  languageProviderRoutes,
  LANGUAGE_ANALYSIS_INVALID,
  LANGUAGE_DEFAULT_MAX_DOCUMENTS,
  LANGUAGE_DEFAULT_MAX_EDITS,
  LANGUAGE_DEFAULT_MAX_RESULTS,
  LANGUAGE_DOCUMENT_ALREADY_OPEN,
  LANGUAGE_DOCUMENT_CHANGE_INVALID,
  LANGUAGE_DOCUMENT_NOT_OPEN,
  LANGUAGE_FEATURE_INVALID,
  LANGUAGE_MAX_DOCUMENTS,
  LANGUAGE_MAX_EDITS,
  LANGUAGE_MAX_RESULTS,
  LANGUAGE_PROVIDER_FAILED,
  LANGUAGE_WORKSPACE_NOT_INITIALIZED,
  LANGUAGE_WORKSPACE_SHUT_DOWN,
  type LanguageProviderRoute,
  type LanguageWorkspace,
  type LanguageWorkspaceAnalysisResult,
  type LanguageWorkspaceCodeActionsRequest,
  type LanguageWorkspaceColorPresentationRequest,
  type LanguageWorkspaceDocumentSource,
  type LanguageWorkspaceDocumentSourceRequest,
  type LanguageWorkspaceDocumentSourceResult,
  type LanguageWorkspaceDocumentRequest,
  type LanguageWorkspaceFeatureRequest,
  type LanguageWorkspaceFormattingRequest,
  type LanguageWorkspaceOptions,
  type LanguageWorkspacePositionRequest,
  type LanguageWorkspaceReferencesRequest,
  type LanguageWorkspaceRenameRequest,
  type LanguageWorkspaceSymbolsRequest,
} from './workspace.js'
export { expandSubjectReferenceCompletions } from './subject-completion.js'
