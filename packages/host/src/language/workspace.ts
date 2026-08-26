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
  type LanguageDocument,
  type LanguagePosition,
  type LanguageProviderOfferFacet,
  type LanguageProviderRequestFacet,
  type LanguageRange,
  type LanguageSymbol,
  type LanguageToken,
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

export interface LanguageWorkspace {
  initialize(): Promise<void>
  open(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  change(request: LanguageWorkspaceDocumentRequest): Promise<LanguageWorkspaceAnalysisResult>
  /** Await the newest analysis already requested for this URI. */
  current(uri: string, signal?: AbortSignal): Promise<LanguageWorkspaceAnalysisResult | undefined>
  close(uri: string): Promise<void>
  shutdown(): Promise<void>
}

interface OpenDocument {
  readonly uri: string
  readonly route: LanguageProviderRoute
  readonly resolution: Extract<LanguageProviderResolution, { readonly state: 'resolved' }>
  version: number
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
  let state: 'new' | 'ready' | 'shut-down' = 'new'
  let shutdownPromise: Promise<void> | undefined

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
        released: false,
      }
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
      entry.version = request.document.version
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

    async close(uri: string): Promise<void> {
      requireReady()
      const entry = documents.get(uri)
      if (entry !== undefined) await closeEntry(entry)
    },

    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise
      state = 'shut-down'
      shutdownPromise = (async () => {
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
