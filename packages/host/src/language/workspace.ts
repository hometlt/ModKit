/**
 * One protocol-neutral v1 language-provider lifecycle for an editor workspace.
 *
 * This is deliberately a coordinator over the existing service contract, not a second language
 * composition root. A successful `open` owns exactly one provider lease until `close`/`shutdown`;
 * `change` only replaces analysis work for that document and never re-resolves the provider.
 */

import {
  ModkitError,
  OperationCancelledError,
  canonicalJsonStringify,
  compareUtf8,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  type LanguageAnalysis,
  type LanguageAnalysisRequest,
  type LanguageCompletionList,
  type LanguageDiagnosticList,
  type LanguageDocument,
  type LanguageDocumentSymbolList,
  type LanguageFeatureRequest,
  type LanguageFormattingOptions,
  type LanguageHover,
  type LanguageLocationList,
  type LanguagePosition,
  type LanguageProvider,
  type LanguageProviderOfferFacet,
  type LanguageProviderRequestFacet,
  type LanguageRange,
  type LanguageRenamePreparation,
  type LanguageSignatureHelp,
  type LanguageSignatureParameter,
  type LanguageSymbol,
  type LanguageTextEdit,
  type LanguageTextEditList,
  type LanguageToken,
  type LanguageWorkspaceEdit,
  type LanguageWorkspaceSymbolList,
} from '@modkitx-x3/sdk/language'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import type { Inventory } from '../inventory.js'
import { offersFromInventory } from '../offers.js'
import {
  resolveLanguageProvider,
  type LanguageHostServices,
  type LanguageProviderResolution,
} from './index.js'

export const LANGUAGE_WORKSPACE_NOT_INITIALIZED = 'x3.host/language-workspace-not-initialized'
export const LANGUAGE_WORKSPACE_SHUT_DOWN = 'x3.host/language-workspace-shut-down'
export const LANGUAGE_DOCUMENT_ALREADY_OPEN = 'x3.host/language-document-already-open'
export const LANGUAGE_DOCUMENT_NOT_OPEN = 'x3.host/language-document-not-open'
export const LANGUAGE_DOCUMENT_CHANGE_INVALID = 'x3.host/language-document-change-invalid'
export const LANGUAGE_PROVIDER_FAILED = 'x3.host/language-provider-failed'
export const LANGUAGE_ANALYSIS_INVALID = 'x3.host/language-analysis-invalid'
export const LANGUAGE_FEATURE_INVALID = 'x3.host/language-feature-invalid'

export const LANGUAGE_DEFAULT_MAX_RESULTS = 256
export const LANGUAGE_MAX_RESULTS = 2_048
export const LANGUAGE_DEFAULT_MAX_DOCUMENTS = 32
export const LANGUAGE_MAX_DOCUMENTS = 64
export const LANGUAGE_DEFAULT_MAX_EDITS = 1_024
export const LANGUAGE_MAX_EDITS = 4_096

/** One exact request route projected from a provider offer. */
export type LanguageProviderRoute = Readonly<LanguageProviderRequestFacet>

const ROUTE_KEYS = new Set(['languageIds', 'documentKinds', 'extensions'])
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
  if (
    languageIds === undefined ||
    (record['documentKinds'] !== undefined && documentKinds === undefined) ||
    (record['extensions'] !== undefined && extensions === undefined)
  ) {
    throw new TypeError('language provider offer facet contains an invalid route list')
  }
  return {
    languageIds,
    ...(documentKinds === undefined ? {} : { documentKinds }),
    ...(extensions === undefined ? {} : { extensions }),
  }
}

const normalizedExtension = (value: string): string => value.replace(/^\./u, '').toLowerCase()

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
      const extensions = facet.extensions ?? [undefined]
      for (const languageId of facet.languageIds) {
        for (const documentKind of kinds) {
          for (const rawExtension of extensions) {
            const extension =
              rawExtension === undefined ? undefined : normalizedExtension(rawExtension)
            if (extension !== undefined && extension.length === 0) {
              throw new TypeError('language provider extension route must not be only a dot')
            }
            const route: LanguageProviderRoute = Object.freeze({
              languageId,
              ...(documentKind === undefined ? {} : { documentKind }),
              ...(extension === undefined ? {} : { extension }),
            })
            routes.set(canonicalJsonStringify(route), route)
          }
        }
      }
    }
  }
  return Object.freeze(
    [...routes.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([, route]) => route),
  )
}

export interface LanguageWorkspaceOptions {
  readonly services: LanguageHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
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

export interface LanguageWorkspaceSymbolsRequest extends LanguageWorkspaceFeatureRequest {
  readonly query: string
}

export interface LanguageWorkspace {
  initialize(): Promise<void>
  open(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  change(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  /** Await the newest analysis already requested for this URI. */
  current(uri: string, signal?: AbortSignal): Promise<LanguageWorkspaceAnalysisResult | undefined>
  completion(request: LanguageWorkspacePositionRequest): Promise<LanguageCompletionList | undefined>
  hover(request: LanguageWorkspacePositionRequest): Promise<LanguageHover | undefined>
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
  documentSymbols(
    request: LanguageWorkspaceFeatureRequest,
  ): Promise<LanguageDocumentSymbolList | undefined>
  workspaceSymbols(
    request: LanguageWorkspaceSymbolsRequest,
  ): Promise<LanguageWorkspaceSymbolList | undefined>
  diagnostics(request: LanguageWorkspaceFeatureRequest): Promise<LanguageDiagnosticList | undefined>
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

function validateFeatureRequest(
  request: LanguageWorkspaceFeatureRequest,
  positioned: boolean,
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
  boundedInteger(
    request.maxResults,
    LANGUAGE_DEFAULT_MAX_RESULTS,
    LANGUAGE_MAX_RESULTS,
    'maxResults',
  )
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

function invalidFeature(message: string, uri: string): never {
  throw workspaceError(LANGUAGE_FEATURE_INVALID, message, { uri })
}

function validateCompletionList(
  value: unknown,
  request: LanguageFeatureRequest,
): LanguageCompletionList {
  const list = value as LanguageCompletionList
  if (
    typeof list !== 'object' ||
    list === null ||
    !Array.isArray(list.items) ||
    list.items.length > request.maxResults ||
    typeof list.isIncomplete !== 'boolean' ||
    !list.items.every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.label === 'string' &&
        item.label.length > 0 &&
        COMPLETION_KINDS.has(item.kind) &&
        (item.detail === undefined || typeof item.detail === 'string') &&
        (item.documentation === undefined || typeof item.documentation === 'string') &&
        (item.insertText === undefined || typeof item.insertText === 'string') &&
        (item.insertTextFormat === undefined ||
          item.insertTextFormat === 'plain-text' ||
          item.insertTextFormat === 'snippet') &&
        (item.sortText === undefined || typeof item.sortText === 'string'),
    )
  ) {
    invalidFeature(
      'language provider returned an invalid or unbounded completion list',
      request.document.uri,
    )
  }
  return list
}

function validateHover(value: unknown, request: LanguageFeatureRequest): LanguageHover | undefined {
  if (value === undefined) return undefined
  const hover = value as LanguageHover
  if (
    typeof hover !== 'object' ||
    hover === null ||
    typeof hover.markdown !== 'string' ||
    (hover.range !== undefined && !validRange(hover.range, lineLengths(request.document.text))) ||
    (hover.provenance !== undefined && typeof hover.provenance !== 'string')
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
    !list.diagnostics.every(
      item =>
        validRange(item.range, lengths) &&
        typeof item.message === 'string' &&
        ['error', 'warning', 'information', 'hint'].includes(item.severity) &&
        (item.code === undefined || typeof item.code === 'string') &&
        (item.source === undefined || typeof item.source === 'string'),
    )
  ) {
    invalidFeature(
      'language provider returned invalid or unbounded diagnostics',
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
      analysis.diagnostics.every(
        item =>
          validRange(item.range, lengths) &&
          typeof item.message === 'string' &&
          ['error', 'warning', 'information', 'hint'].includes(item.severity) &&
          (item.code === undefined || typeof item.code === 'string') &&
          (item.source === undefined || typeof item.source === 'string'),
      ) &&
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

/** Create a single-provider v1 document lifecycle coordinator. */
export function createLanguageWorkspace(options: LanguageWorkspaceOptions): LanguageWorkspace {
  const documents = new Map<string, OpenDocument>()
  const featureControllers = new Set<AbortController>()
  let state: 'new' | 'ready' | 'shut-down' = 'new'
  let shutdownPromise: Promise<void> | undefined
  let workspaceGeneration = 0

  const invalidateFeatures = (reason: string): void => {
    workspaceGeneration += 1
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
  ): OpenDocument => {
    requireReady()
    validateFeatureRequest(request, positioned)
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

  const invokeFeature = async <Value>(
    workspaceRequest: LanguageWorkspaceFeatureRequest,
    positioned: boolean,
    call: (
      provider: LanguageProvider,
      request: LanguageFeatureRequest,
    ) => Promise<unknown> | undefined,
    validate: (value: unknown, request: LanguageFeatureRequest) => Value,
    additions: Readonly<Record<string, unknown>> = {},
  ): Promise<Value | undefined> => {
    const entry = requireFeatureEntry(workspaceRequest, positioned)
    throwIfAborted(workspaceRequest.signal)
    const maxResults = boundedInteger(
      workspaceRequest.maxResults,
      LANGUAGE_DEFAULT_MAX_RESULTS,
      LANGUAGE_MAX_RESULTS,
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
      // By default snapshots cross filename routes (Galaxy .galaxy/.ai) but not language ids.
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
    const providerRequest = Object.freeze({
      document: entry.document,
      workspaceDocuments: Object.freeze(selected.map(candidate => candidate.document)),
      workspaceIncomplete: candidates.length > selected.length,
      maxResults,
      maxDocuments,
      ...additions,
      signal: controller.signal,
    }) as LanguageFeatureRequest
    try {
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
      if (
        generation !== workspaceGeneration ||
        documents.get(entry.uri) !== entry ||
        entry.version !== workspaceRequest.documentVersion
      ) {
        throw new OperationCancelledError('stale language feature result')
      }
      return validate(candidate, providerRequest)
    } finally {
      unlink()
      featureControllers.delete(controller)
    }
  }

  const validateWorkspaceEdit = (
    value: unknown,
    request: LanguageFeatureRequest,
    maxEdits: number,
  ): LanguageWorkspaceEdit | undefined => {
    if (value === undefined) return undefined
    const edit = value as LanguageWorkspaceEdit
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
        editCount += Array.isArray(change.edits) ? change.edits.length : maxEdits + 1
        if (
          open === undefined ||
          seen.has(change.uri) ||
          change.documentVersion !== open.version ||
          !Array.isArray(change.edits) ||
          editCount > maxEdits
        ) {
          return false
        }
        seen.add(change.uri)
        const lengths = lineLengths(open.document.text)
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

  const analyze = (
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
  }

  return Object.freeze({
    async initialize(): Promise<void> {
      if (state === 'shut-down') {
        throw workspaceError(LANGUAGE_WORKSPACE_SHUT_DOWN, 'the language workspace is shut down')
      }
      state = 'ready'
    },

    async open(
      request: LanguageWorkspaceDocumentRequest,
    ): Promise<LanguageWorkspaceAnalysisResult> {
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
      const route = routeOf(request)
      const resolution = await resolveLanguageProvider({
        services: options.services,
        ...route,
        grant: options.grant,
        budgets: options.budgets,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      if (resolution.state === 'unresolved') {
        throwIfAborted(request.signal)
        return Object.freeze({
          state: 'unresolved',
          hostDiagnostics: resolution.diagnostics,
        })
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
        document: request.document,
        released: false,
      }
      invalidateFeatures('language document opened')
      documents.set(entry.uri, entry)
      try {
        return await analyze(entry, request)
      } catch (error) {
        if (documents.get(entry.uri) === entry) await closeEntry(entry)
        throw error
      }
    },

    async change(
      request: LanguageWorkspaceDocumentRequest,
    ): Promise<LanguageWorkspaceAnalysisResult> {
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
      const nextRoute = routeOf(request)
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
      entry.version = request.document.version
      entry.document = request.document
      delete entry.current
      return analyze(entry, request)
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

    completion(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageCompletionList | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.completion?.({
            ...feature,
            position: request.position,
          }),
        validateCompletionList,
        { position: request.position },
      )
    },

    hover(request: LanguageWorkspacePositionRequest): Promise<LanguageHover | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) => provider.hover?.({ ...feature, position: request.position }),
        validateHover,
        { position: request.position },
      )
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
      )
    },

    definition(
      request: LanguageWorkspacePositionRequest,
    ): Promise<LanguageLocationList | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) => provider.definition?.({ ...feature, position: request.position }),
        validateLocationList,
        { position: request.position },
      )
    },

    references(
      request: LanguageWorkspaceReferencesRequest,
    ): Promise<LanguageLocationList | undefined> {
      return invokeFeature(
        request,
        true,
        (provider, feature) =>
          provider.references?.({
            ...feature,
            position: request.position,
            ...(request.includeDeclaration === undefined
              ? {}
              : { includeDeclaration: request.includeDeclaration }),
          }),
        validateLocationList,
        {
          position: request.position,
          ...(request.includeDeclaration === undefined
            ? {}
            : { includeDeclaration: request.includeDeclaration }),
        },
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
        request.newName.length > 256 ||
        !/^[A-Za-z_]\w*$/u.test(request.newName)
      ) {
        return Promise.reject(
          workspaceError(LANGUAGE_FEATURE_INVALID, 'rename needs a valid language identifier', {
            uri: request.uri,
          }),
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
        (value, feature) => validateWorkspaceEdit(value, feature, maxEdits),
        { position: request.position, newName: request.newName, maxEdits },
      )
    },

    formatting(
      request: LanguageWorkspaceFormattingRequest,
    ): Promise<LanguageTextEditList | undefined> {
      const formatting = request.options
      if (
        typeof formatting !== 'object' ||
        formatting === null ||
        !Number.isSafeInteger(formatting.tabSize) ||
        formatting.tabSize < 1 ||
        formatting.tabSize > 8 ||
        typeof formatting.insertSpaces !== 'boolean' ||
        (formatting.finalNewline !== undefined && typeof formatting.finalNewline !== 'boolean')
      ) {
        return Promise.reject(
          workspaceError(
            LANGUAGE_FEATURE_INVALID,
            'formatting options need tabSize 1 through 8 and boolean indentation settings',
            { uri: request.uri },
          ),
        )
      }
      const providerOptions = Object.freeze({
        tabSize: formatting.tabSize,
        insertSpaces: formatting.insertSpaces,
        ...(formatting.finalNewline === undefined ? {} : { finalNewline: formatting.finalNewline }),
      })
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.formatting?.({ ...feature, options: providerOptions }),
        validateTextEditList,
        { options: providerOptions },
      )
    },

    documentSymbols(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageDocumentSymbolList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.documentSymbols?.(feature),
        validateDocumentSymbols,
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

    diagnostics(
      request: LanguageWorkspaceFeatureRequest,
    ): Promise<LanguageDiagnosticList | undefined> {
      return invokeFeature(
        request,
        false,
        (provider, feature) => provider.diagnostics?.(feature),
        validateDiagnosticList,
      )
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
