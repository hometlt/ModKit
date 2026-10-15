/**
 * Protocol adapter for the common Host language workspace: versioned documents, completion,
 * diagnostics, navigation, edits and document projections over registered providers.
 * Host owns validation and separate interactive/document result ceilings; providers own language
 * semantics. This adapter contains no game parser or independent dependency resolver.
 */
import { extname, isAbsolute, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isCancellation, type Diagnostic as HostDiagnostic } from '@modkit/core'
import type {
  LanguageWorkspaceFeatureRequest,
  LanguageWorkspaceCapability,
  LanguageWorkspaceCapabilitySet,
  LanguageWorkspacePositionRequest,
  LanguageWorkspaceDocumentRequest,
  LanguageWorkspaceRenameRequest,
  LanguageWorkspaceReferencesRequest,
  LanguageWorkspaceFormattingRequest,
  LanguageWorkspaceInlayHintsRequest,
  LanguageWorkspaceOnTypeFormattingRequest,
  LanguageWorkspaceColorPresentationRequest,
  LanguageWorkspaceCodeActionsRequest,
  LanguageWorkspaceSymbolsRequest,
  LanguageWorkspace,
} from '@modkit/host/language'
import {
  LANGUAGE_MAX_DOCUMENT_RESULTS,
  languageProviderTriggerCharacters,
  type LanguageProviderRoute,
} from '@modkit/host/language'
import type {
  LanguageCodeAction,
  LanguageCommand,
  LanguageCompletionItem,
  LanguageDiagnostic,
  LanguageSymbol,
  LanguageSymbolKind,
  LanguageTokenKind,
  LanguageWorkspaceEdit,
} from '@modkit/sdk'
import {
  CodeActionKind,
  CompletionItemKind,
  CompletionItemTag,
  DiagnosticSeverity,
  DiagnosticTag,
  DidChangeWatchedFilesNotification,
  DocumentHighlightKind,
  DocumentSymbol,
  InlayHintKind,
  InsertTextFormat,
  LSPErrorCodes,
  ProposedFeatures,
  ResponseError,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
  createConnection,
  type CancellationToken,
  type CodeAction,
  type Command,
  type ColorInformation,
  type ColorPresentation,
  type CompletionItem,
  type Connection,
  type Diagnostic,
  type DocumentDiagnosticReport,
  type DocumentFormattingParams,
  type DocumentOnTypeFormattingParams,
  type InitializeResult,
  type Location,
  type Position,
  type SemanticTokens,
  type SemanticTokensDelta,
  type SemanticTokensDeltaParams,
  type SemanticTokensParams,
  type SignatureHelp,
  type WorkspaceEdit,
  type WorkspaceDiagnosticParams,
  type WorkspaceDiagnosticReport,
  type WorkspaceSymbol,
} from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'

const TOKEN_TYPES: readonly LanguageTokenKind[] = Object.freeze([
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

const symbolKinds: Readonly<Record<LanguageSymbolKind, SymbolKind>> = Object.freeze({
  class: SymbolKind.Class,
  constant: SymbolKind.Constant,
  enum: SymbolKind.Enum,
  field: SymbolKind.Field,
  function: SymbolKind.Function,
  interface: SymbolKind.Interface,
  module: SymbolKind.Module,
  namespace: SymbolKind.Namespace,
  property: SymbolKind.Property,
  struct: SymbolKind.Struct,
  variable: SymbolKind.Variable,
})

const completionKinds: Readonly<Record<string, CompletionItemKind>> = Object.freeze({
  class: CompletionItemKind.Class,
  constant: CompletionItemKind.Constant,
  enum: CompletionItemKind.Enum,
  field: CompletionItemKind.Field,
  function: CompletionItemKind.Function,
  interface: CompletionItemKind.Interface,
  module: CompletionItemKind.Module,
  namespace: CompletionItemKind.Module,
  property: CompletionItemKind.Property,
  struct: CompletionItemKind.Struct,
  variable: CompletionItemKind.Variable,
  keyword: CompletionItemKind.Keyword,
  parameter: CompletionItemKind.Variable,
  snippet: CompletionItemKind.Snippet,
  text: CompletionItemKind.Text,
  type: CompletionItemKind.TypeParameter,
  color: CompletionItemKind.Color,
  file: CompletionItemKind.File,
  folder: CompletionItemKind.Folder,
  'enum-member': CompletionItemKind.EnumMember,
  event: CompletionItemKind.Event,
})

const severity = (value: LanguageDiagnostic['severity']): DiagnosticSeverity =>
  ({
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  })[value]

const diagnosticOf = (value: LanguageDiagnostic): Diagnostic => ({
  range: value.range,
  severity: severity(value.severity),
  message: value.message,
  ...(value.code === undefined ? {} : { code: value.code }),
  ...(value.source === undefined ? {} : { source: value.source }),
  ...(value.tags === undefined
    ? {}
    : {
        tags: value.tags.map(tag =>
          tag === 'unnecessary' ? DiagnosticTag.Unnecessary : DiagnosticTag.Deprecated,
        ),
      }),
  ...(value.relatedInformation === undefined
    ? {}
    : {
        relatedInformation: value.relatedInformation.map(item => ({
          location: item.location,
          message: item.message,
        })),
      }),
  ...(value.codeDescription === undefined
    ? {}
    : { codeDescription: { href: value.codeDescription } }),
})

/**
 * A language command as an LSP command: the client runs `modkit.runLanguageCommand` with the
 * command itself as its one argument (the Modkit client opens the card, graph or place).
 */
/** A completion item carries its request; displayed descriptions are reused at resolve. */
interface CompletionResolveData {
  readonly uri: string
  readonly position: Position
  readonly item: LanguageCompletionItem
}

/** Keep provider-specific identity/edits/assets for resolve without copying displayed descriptions. */
function completionResolveItem(item: LanguageCompletionItem): LanguageCompletionItem {
  const { detail: _detail, documentation: _documentation, ...identity } = item
  return identity
}

export const LSP_LANGUAGE_COMMAND = 'modkit.runLanguageCommand'
const commandOf = (title: string, command: LanguageCommand): Command => ({
  title,
  command: LSP_LANGUAGE_COMMAND,
  arguments: [command],
})

const hostDiagnosticOf = (value: HostDiagnostic): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  severity:
    value.severity === 'error'
      ? DiagnosticSeverity.Error
      : value.severity === 'warning'
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Information,
  message: value.message,
  code: value.code,
  source: 'modkit-host',
})

const documentSymbolOf = (value: LanguageSymbol): DocumentSymbol => ({
  name: value.name,
  kind: symbolKinds[value.kind],
  range: value.range,
  selectionRange: value.selectionRange,
  ...(value.detail === undefined ? {} : { detail: value.detail }),
  ...(value.children === undefined ? {} : { children: value.children.map(documentSymbolOf) }),
})

const workspaceEditOf = (value: LanguageWorkspaceEdit, isOpen: (uri: string) => boolean): WorkspaceEdit => ({
  documentChanges: value.documentChanges.map(change => ({
    textDocument: { uri: change.uri, version: isOpen(change.uri) ? change.documentVersion : null },
    edits: change.edits.map(edit => TextEdit.replace(edit.range, edit.newText)),
  })),
})

const codeActionOf = (value: LanguageCodeAction, isOpen: (uri: string) => boolean): CodeAction => ({
  title: value.title,
  ...(value.kind === undefined
    ? {}
    : { kind: value.kind === 'rewrite' ? CodeActionKind.RefactorRewrite : value.kind }),
  ...(value.isPreferred === undefined ? {} : { isPreferred: value.isPreferred }),
  ...(value.edit === undefined ? {} : { edit: workspaceEditOf(value.edit, isOpen) }),
  ...(value.command === undefined ? {} : { command: commandOf(value.title, value.command) }),
  ...(value.disabledReason === undefined ? {} : { disabled: { reason: value.disabledReason } }),
})

const signalOf = (token: CancellationToken): { signal: AbortSignal; dispose(): void } => {
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort('LSP request cancelled')
  const subscription = token.onCancellationRequested(() =>
    controller.abort('LSP request cancelled'),
  )
  return { signal: controller.signal, dispose: () => subscription.dispose() }
}

const withSignal = async <T>(
  token: CancellationToken,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const linked = signalOf(token)
  try {
    return await call(linked.signal)
  } catch (error) {
    // LSP clients recognise a cancelled request only by its reserved code.
    if (linked.signal.aborted) {
      throw new ResponseError(LSPErrorCodes.RequestCancelled, 'request cancelled')
    }
    throw error
  } finally {
    linked.dispose()
  }
}

export interface ModkitLanguageServerOptions {
  readonly workspace: LanguageWorkspace
  readonly routes: readonly LanguageProviderRoute[]
  readonly roots: readonly string[]
  readonly maxDocuments: number
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  readonly maxResults?: number
  /** Bounded whole-document projections, independent of completion/search lists. */
  readonly maxDocumentResults?: number
  readonly connection?: Connection
  /** Files inside the roots changed on disk: the loaded mods' servers read them again first. */
  readonly filesChanged?: () => Promise<void>
  /** Schedule optional background work after the client handshake; never block readiness on it. */
  readonly clientInitialized?: () => void
}

export interface RunningModkitLanguageServer {
  readonly connection: Connection
  listen(): void
  close(): Promise<void>
}

export function createModkitLanguageServer(
  options: ModkitLanguageServerOptions,
): RunningModkitLanguageServer {
  const connection =
    options.connection ?? createConnection(ProposedFeatures.all, process.stdin, process.stdout)
  const documents = new TextDocuments(TextDocument)
  const acceptedDocuments = new Map<string, TextDocument>()
  let pending: Promise<void> = Promise.resolve()
  const workspaceUris = new Set<string>()
  const dirtyDiagnostics = new Set<string>()
  const diagnosticWork = new Set<Promise<void>>()
  let workspaceGeneration = 0
  let interactiveRequests = 0
  let interactiveIdle: Promise<void> = Promise.resolve()
  let finishInteractive = (): void => undefined
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined
  let diagnosticJob:
    { readonly controller: AbortController; readonly task: Promise<void> } | undefined
  const diagnosticSnapshots = new Map<
    string,
    {
      readonly version: number
      readonly resultId: string
      readonly diagnostics: readonly Diagnostic[]
    }
  >()
  const semanticTokenSnapshots = new Map<
    string,
    { readonly version: number; readonly resultId: string; readonly data: readonly number[] }
  >()
  let diagnosticRevision = 0
  let semanticTokenRevision = 0
  const maxResults = options.maxResults ?? 1_000
  const maxDocumentResults = options.maxDocumentResults ?? LANGUAGE_MAX_DOCUMENT_RESULTS
  const encoder = new TextEncoder()
  let supportsDynamicWatchedFiles = false
  let shutDown = false
  let clientReady = false
  const completionTriggerCharacters = languageProviderTriggerCharacters(
    options.routes,
    'completion',
  )
  const signatureHelpTriggerCharacters = languageProviderTriggerCharacters(
    options.routes,
    'signatureHelp',
  )
  const onTypeFormattingTriggerCharacters = languageProviderTriggerCharacters(
    options.routes,
    'onTypeFormatting',
  )

  const fileInsideRoots = (uri: string): boolean => {
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      return false
    }
    if (parsed.protocol !== 'file:') return false
    let path: string
    try {
      path = fileURLToPath(uri)
    } catch {
      return false
    }
    return options.roots.some(root => {
      const rel = relative(root, path)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
  }

  const allowedUri = (uri: string): boolean => {
    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      return false
    }
    if (
      ['modkit-source:', 'modkit-container:', 'content-source:', 'untitled:'].includes(
        parsed.protocol,
      )
    ) {
      return parsed.username === '' && parsed.password === ''
    }
    return fileInsideRoots(uri)
  }
  const route = (document: TextDocument): LanguageWorkspaceDocumentRequest => ({
    languageId: document.languageId,
    extension: extname(new URL(document.uri).pathname).replace(/^\./u, '').toLowerCase(),
    document: {
      uri: document.uri,
      languageId: document.languageId,
      version: document.version,
      text: document.getText(),
    },
  })
  const request = (uri: string, signal?: AbortSignal): LanguageWorkspaceFeatureRequest => {
    const document = acceptedDocuments.get(uri)
    if (document === undefined) throw new Error(`document ${uri} is not open`)
    return {
      uri,
      documentVersion: document.version,
      maxDocuments: options.maxDocuments,
      maxResults,
      ...(signal === undefined ? {} : { signal }),
    }
  }
  const positionRequest = (
    uri: string,
    position: Position,
    signal?: AbortSignal,
  ): LanguageWorkspacePositionRequest => ({
    ...request(uri, signal),
    position,
  })
  /** Preserve all bounded document projections without increasing interactive result lists. */
  const documentRequest = (uri: string, signal?: AbortSignal): LanguageWorkspaceFeatureRequest => ({
    ...request(uri, signal), maxResults: maxDocumentResults,
  })
  /*
   * LSP orders notifications before the requests that follow them, so a feature request must see
   * every document the client has already opened or changed. Waiting only for the primary document
   * answered a cross-file definition from a workspace that did not yet contain the other file — an
   * empty result indistinguishable from "no definition".
   */
  const awaitReady = async (): Promise<void> => pending
  /**
   * A method the selected provider does not implement is an explicit error, never an empty
   * success: an empty answer would claim "no references" where the truth is "not supported".
   */
  const requireFeature = async (
    uri: string,
    feature: LanguageWorkspaceCapability,
    signal: AbortSignal,
  ): Promise<void> => {
    await awaitReady()
    const capabilities = await options.workspace.capabilities(uri, signal)
    if (capabilities === undefined && acceptedDocuments.has(uri)) {
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `no language provider resolved for ${uri}; see its diagnostics`,
        { code: 'x3.lsp/provider-unresolved', feature },
      )
    }
    if (capabilities !== undefined && !capabilities.features.includes(feature)) {
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `the language provider for ${uri} does not support ${feature}`,
        { code: 'x3.lsp/feature-unsupported', feature },
      )
    }
  }
  const acceptDocument = (document: TextDocument): void => {
    acceptedDocuments.set(
      document.uri,
      TextDocument.create(document.uri, document.languageId, document.version, document.getText()),
    )
  }
  const setDiagnostics = (
    uri: string,
    version: number,
    diagnostics: readonly Diagnostic[],
  ): void => {
    const resultId = `modkit-diagnostics-v1:${++diagnosticRevision}:${version}`
    diagnosticSnapshots.set(uri, {
      version,
      resultId,
      diagnostics: Object.freeze([...diagnostics]),
    })
    connection.sendDiagnostics({ uri, version, diagnostics: [...diagnostics] })
  }
  const cancelDiagnostics = (): void => {
    workspaceGeneration += 1
    if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer)
    diagnosticTimer = undefined
    diagnosticJob?.controller.abort('language workspace changed')
  }
  const refreshDiagnostics = (): void => {
    // A declaration changed in one file can invalidate diagnostics in every open file.
    for (const uri of workspaceUris) {
      dirtyDiagnostics.add(uri)
      diagnosticSnapshots.delete(uri)
    }
  }
  const scheduleDiagnostics = (): void => {
    if (
      shutDown ||
      interactiveRequests > 0 ||
      dirtyDiagnostics.size === 0 ||
      diagnosticTimer !== undefined
    )
      return
    diagnosticTimer = setTimeout(() => {
      diagnosticTimer = undefined
      void pending.then(() => {
        startDiagnostics()
      })
    }, 150)
  }
  const startDiagnostics = (): Promise<void> => {
    if (shutDown || dirtyDiagnostics.size === 0) return Promise.resolve()
    if (interactiveRequests > 0) return interactiveIdle.then(startDiagnostics)
    if (diagnosticJob !== undefined && !diagnosticJob.controller.signal.aborted)
      return diagnosticJob.task
    if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer)
    diagnosticTimer = undefined
    const controller = new AbortController()
    const generation = workspaceGeneration
    const task = (async (): Promise<void> => {
      for (const uri of [...dirtyDiagnostics]) {
        const document = acceptedDocuments.get(uri)
        if (document === undefined || !workspaceUris.has(uri)) {
          dirtyDiagnostics.delete(uri)
          continue
        }
        try {
          controller.signal.throwIfAborted()
          const result = await options.workspace.analyze({
            ...route(document),
            signal: controller.signal,
          })
          const feature = await options.workspace.diagnostics(request(uri, controller.signal))
          // Version alone is insufficient: a reopened file may start again at version 1.
          if (
            controller.signal.aborted ||
            generation !== workspaceGeneration ||
            acceptedDocuments.get(uri) !== document
          )
            return
          setDiagnostics(
            uri,
            document.version,
            feature?.diagnostics.map(diagnosticOf) ??
              (result.state === 'resolved'
                ? result.analysis.diagnostics.map(diagnosticOf)
                : result.hostDiagnostics.map(hostDiagnosticOf)),
          )
          dirtyDiagnostics.delete(uri)
        } catch (error) {
          if (controller.signal.aborted || isCancellation(error)) return
          dirtyDiagnostics.delete(uri)
          connection.console.error(error instanceof Error ? error.message : String(error))
        }
      }
    })().finally(() => {
      diagnosticWork.delete(task)
      if (diagnosticJob?.task === task) {
        diagnosticJob = undefined
        scheduleDiagnostics()
      }
    })
    diagnosticJob = { controller, task }
    diagnosticWork.add(task)
    return task
  }
  const withInteractiveSignal = async <T>(
    token: CancellationToken,
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    if (interactiveRequests++ === 0)
      interactiveIdle = new Promise(resolve => {
        finishInteractive = resolve
      })
    cancelDiagnostics()
    try {
      return await withSignal(token, call)
    } finally {
      if (--interactiveRequests === 0) {
        finishInteractive()
        scheduleDiagnostics()
      }
    }
  }
  const awaitDiagnostics = async (signal: AbortSignal): Promise<void> => {
    let abort = (): void => undefined
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      do {
        signal.throwIfAborted()
        await Promise.race([awaitReady().then(startDiagnostics), cancelled])
        signal.throwIfAborted()
      } while (dirtyDiagnostics.size > 0 && !shutDown)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  const publish = async (
    document: TextDocument,
    mode: 'open' | 'change' | 'refresh',
  ): Promise<void> => {
    const accepted = acceptedDocuments.get(document.uri)
    if (mode === 'change' && accepted !== undefined && document.version <= accepted.version) {
      connection.console.warn(
        `ignored stale language change ${document.uri}@${document.version}; current version is ${accepted.version}`,
      )
      return
    }
    if (!allowedUri(document.uri)) {
      setDiagnostics(document.uri, document.version, [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          severity: DiagnosticSeverity.Error,
          code: 'x3.lsp/outside-root',
          source: 'modkit-host',
          message: 'Document is outside the configured Modkit workspace roots.',
        },
      ])
      return
    }
    const bytes = encoder.encode(document.getText()).byteLength
    const otherBytes = [...acceptedDocuments.values()]
      .filter(candidate => candidate.uri !== document.uri)
      .reduce((total, candidate) => total + encoder.encode(candidate.getText()).byteLength, 0)
    const limitDiagnostic =
      bytes > options.maxDocumentBytes
        ? {
            code: 'x3.lsp/document-too-large',
            message: `Document exceeds the configured ${options.maxDocumentBytes} byte limit.`,
          }
        : otherBytes + bytes > options.maxWorkspaceBytes
          ? {
              code: 'x3.lsp/workspace-too-large',
              message: `Open documents exceed the configured ${options.maxWorkspaceBytes} byte limit.`,
            }
          : accepted === undefined && acceptedDocuments.size >= options.maxDocuments
            ? {
                code: 'x3.lsp/document-limit',
                message: `At most ${options.maxDocuments} documents may be open at once.`,
              }
            : undefined
    if (limitDiagnostic !== undefined) {
      dirtyDiagnostics.delete(document.uri)
      setDiagnostics(document.uri, accepted?.version ?? document.version, [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          severity: DiagnosticSeverity.Error,
          source: 'modkit-host',
          ...limitDiagnostic,
        },
      ])
      return
    }
    if (mode === 'refresh' && workspaceUris.delete(document.uri))
      await options.workspace.close(document.uri)
    const result = await options.workspace.synchronize(route(document))
    if (result.state === 'unresolved') {
      acceptDocument(document)
      workspaceUris.delete(document.uri)
      dirtyDiagnostics.delete(document.uri)
      refreshDiagnostics()
      setDiagnostics(document.uri, document.version, result.hostDiagnostics.map(hostDiagnosticOf))
      return
    }
    acceptDocument(document)
    workspaceUris.add(document.uri)
    refreshDiagnostics()
  }
  const enqueue = (operation: () => Promise<void>): void => {
    if (shutDown) return
    cancelDiagnostics()
    // Feature requests wait for ordered synchronization, never for background diagnostics.
    pending = pending
      .then(operation)
      .catch(error => {
        connection.console.error(error instanceof Error ? error.message : String(error))
      })
      .then(scheduleDiagnostics)
  }
  const schedule = (document: TextDocument, mode: 'open' | 'change' | 'refresh'): void => {
    // TextDocuments mutates its instances in place on the next notification.
    const snapshot = TextDocument.create(
      document.uri,
      document.languageId,
      document.version,
      document.getText(),
    )
    enqueue(() => publish(snapshot, mode))
  }

  const semanticTokensFor = async (
    uri: string,
    signal: AbortSignal,
  ): Promise<SemanticTokens & { readonly resultId: string }> => {
    await awaitDiagnostics(signal)
    const current = await options.workspace.current(uri, signal)
    const document = acceptedDocuments.get(uri)
    const data: number[] = []
    if (current?.state === 'resolved' && document !== undefined) {
      const lineLengths = document
        .getText()
        .split(/\r\n|\r|\n/u)
        .map(line => line.length)
      const tokens = current.analysis.tokens
        .flatMap(token => {
          const segments = []
          for (let line = token.range.start.line; line <= token.range.end.line; line += 1) {
            const start = line === token.range.start.line ? token.range.start.character : 0
            const end =
              line === token.range.end.line ? token.range.end.character : (lineLengths[line] ?? 0)
            if (end > start) segments.push({ line, start, end, kind: token.kind })
          }
          return segments
        })
        .sort((a, b) => a.line - b.line || a.start - b.start || a.end - b.end)
      let previousLine = 0
      let previousCharacter = 0
      for (const token of tokens) {
        const deltaLine = token.line - previousLine
        const deltaStart = deltaLine === 0 ? token.start - previousCharacter : token.start
        data.push(
          deltaLine,
          deltaStart,
          token.end - token.start,
          TOKEN_TYPES.indexOf(token.kind),
          0,
        )
        previousLine = token.line
        previousCharacter = token.start
      }
    }
    const previous = semanticTokenSnapshots.get(uri)
    if (
      previous !== undefined &&
      previous.version === document?.version &&
      previous.data.length === data.length &&
      previous.data.every((value, index) => value === data[index])
    ) {
      return { resultId: previous.resultId, data: [...previous.data] }
    }
    const snapshot = Object.freeze({
      version: document?.version ?? 0,
      resultId: `semantic-v1:${++semanticTokenRevision}`,
      data: Object.freeze(data),
    })
    semanticTokenSnapshots.set(uri, snapshot)
    return { resultId: snapshot.resultId, data: [...snapshot.data] }
  }

  const firstOnTypeFormattingTriggerCharacter = onTypeFormattingTriggerCharacters[0]
  connection.onInitialize(params => {
    supportsDynamicWatchedFiles =
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: { includeText: true },
        },
        completionProvider: {
          triggerCharacters: [...completionTriggerCharacters],
          resolveProvider: true,
        },
        hoverProvider: true,
        signatureHelpProvider: { triggerCharacters: [...signatureHelpTriggerCharacters] },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        documentFormattingProvider: true,
        ...(firstOnTypeFormattingTriggerCharacter === undefined
          ? {}
          : {
              documentOnTypeFormattingProvider: {
                firstTriggerCharacter: firstOnTypeFormattingTriggerCharacter,
                moreTriggerCharacter: onTypeFormattingTriggerCharacters.slice(1),
              },
            }),
        colorProvider: true,
        codeActionProvider: true,
        codeLensProvider: { resolveProvider: false },
        foldingRangeProvider: true,
        documentLinkProvider: {},
        documentHighlightProvider: true,
        inlayHintProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] },
          full: { delta: true },
        },
        diagnosticProvider: {
          identifier: 'modkit',
          interFileDependencies: true,
          workspaceDiagnostics: true,
        },
        experimental: {
          modkitLanguageCapabilities: {
            version: 1,
            ...(onTypeFormattingTriggerCharacters.length === 0
              ? {}
              : {
                  onTypeEdit: {
                    requestMethod: 'modkit/onTypeEdit',
                    cursor: true,
                    requestCompletion: true,
                  },
                }),
          },
        },
      },
    } satisfies InitializeResult
  })
  connection.onInitialized(async () => {
    if (shutDown || clientReady) return
    clientReady = true
    options.clientInitialized?.()
    if (!supportsDynamicWatchedFiles) return
    await connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: options.roots.map(root => ({
        globPattern: { baseUri: pathToFileURL(root).href, pattern: '**/*' },
      })),
    })
  })
  connection.languages.diagnostics.on(async (params, token): Promise<DocumentDiagnosticReport> =>
    withSignal(token, async signal => {
      signal.throwIfAborted()
      await awaitDiagnostics(signal)
      signal.throwIfAborted()
      const snapshot = diagnosticSnapshots.get(params.textDocument.uri)
      if (snapshot === undefined) return { kind: 'full', items: [] }
      if (params.previousResultId === snapshot.resultId) {
        return { kind: 'unchanged', resultId: snapshot.resultId }
      }
      return {
        kind: 'full',
        resultId: snapshot.resultId,
        items: [...snapshot.diagnostics],
      }
    }),
  )
  connection.onRequest(
    'workspace/diagnostic',
    (
      params: WorkspaceDiagnosticParams,
      token: CancellationToken,
    ): Promise<WorkspaceDiagnosticReport> =>
      withSignal(token, async signal => {
        await awaitDiagnostics(signal)
        const previous = new Map(params.previousResultIds.map(item => [item.uri, item.value]))
        const items = []
        for (const document of [...acceptedDocuments.values()].sort((a, b) =>
          a.uri.localeCompare(b.uri),
        )) {
          signal.throwIfAborted()
          await awaitDiagnostics(signal)
          signal.throwIfAborted()
          const snapshot = diagnosticSnapshots.get(document.uri)
          if (snapshot === undefined) continue
          if (previous.get(document.uri) === snapshot.resultId) {
            items.push({
              kind: 'unchanged' as const,
              uri: document.uri,
              version: document.version,
              resultId: snapshot.resultId,
            })
          } else {
            items.push({
              kind: 'full' as const,
              uri: document.uri,
              version: document.version,
              resultId: snapshot.resultId,
              items: [...snapshot.diagnostics],
            })
          }
        }
        return { items }
      }),
  )
  /**
   * «Check the mod»: diagnostics of the project documents nobody has open, in the open document's
   * workspace. A client asks on the user's action; nothing runs it in the background.
   */
  connection.onRequest(
    'modkit/projectDiagnostics',
    (
      params: { readonly textDocument?: { readonly uri?: string } },
      token: CancellationToken,
    ): Promise<{
      readonly documents: readonly { uri: string; version: number; diagnostics: Diagnostic[] }[]
      readonly isIncomplete: boolean
    }> =>
      withSignal(token, async signal => {
        const uri = params.textDocument?.uri
        if (typeof uri !== 'string' || uri.length === 0) {
          throw new TypeError('modkit/projectDiagnostics needs a textDocument URI')
        }
        await awaitReady()
        const value = await options.workspace.projectDiagnostics(request(uri, signal))
        return {
          documents: (value?.documents ?? []).map(item => ({
            uri: item.uri,
            version: item.version,
            diagnostics: item.diagnostics.map(diagnosticOf),
          })),
          isIncomplete: value?.isIncomplete ?? true,
        }
      }),
  )
  connection.onRequest(
    'modkit/languageCapabilities',
    (
      params: { readonly textDocument?: { readonly uri?: string } },
      token: CancellationToken,
    ): Promise<LanguageWorkspaceCapabilitySet | null> =>
      withSignal(token, async signal => {
        const uri = params.textDocument?.uri
        if (typeof uri !== 'string' || uri.length === 0) {
          throw new TypeError('modkit/languageCapabilities needs a textDocument URI')
        }
        await awaitReady()
        return (await options.workspace.capabilities(uri, signal)) ?? null
      }),
  )
  connection.onCompletion((params, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'completion', signal)
      const value = await options.workspace.completion({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        semanticContextPolicy: 'cached',
      })
      return value === undefined
        ? null
        : {
            isIncomplete: value.isIncomplete,
            items: value.items.map(
              item =>
                ({
                  label: item.label,
                  kind: completionKinds[item.kind] ?? CompletionItemKind.Text,
                  ...(item.detail === undefined ? {} : { detail: item.detail }),
                  ...(item.documentation === undefined
                    ? {}
                    : { documentation: { kind: 'markdown', value: item.documentation } }),
                  ...(item.insertText === undefined ? {} : { insertText: item.insertText }),
                  ...(item.insertTextFormat === undefined
                    ? {}
                    : {
                        insertTextFormat:
                          item.insertTextFormat === 'snippet'
                            ? InsertTextFormat.Snippet
                            : InsertTextFormat.PlainText,
                      }),
                  ...(item.replacementRange === undefined
                    ? {}
                    : {
                        textEdit: TextEdit.replace(
                          item.replacementRange,
                          item.insertText ?? item.label,
                        ),
                      }),
                  ...(item.sortText === undefined ? {} : { sortText: item.sortText }),
                  ...(item.filterText === undefined ? {} : { filterText: item.filterText }),
                  ...(item.preselect === undefined ? {} : { preselect: item.preselect }),
                  ...(item.commitCharacters === undefined
                    ? {}
                    : { commitCharacters: [...item.commitCharacters] }),
                  ...(item.deprecated === true ? { tags: [CompletionItemTag.Deprecated] } : {}),
                  // the client's own command: ask for completions again after this insertion
                  ...(item.retrigger === true
                    ? { command: { title: 'Suggest', command: 'editor.action.triggerSuggest' } }
                    : {}),
                  // what completionItem/resolve needs to ask the provider about this very item
                  data: {
                    uri: params.textDocument.uri,
                    position: params.position,
                    item: completionResolveItem(item),
                  } satisfies CompletionResolveData,
                }) satisfies CompletionItem,
            ),
          }
    }),
  )
  connection.onCompletionResolve((native, token) =>
    withSignal(token, async signal => {
      const data = native.data as CompletionResolveData | undefined
      if (data === undefined || typeof data.uri !== 'string') return native
      await requireFeature(data.uri, 'completion', signal)
      const documentation =
        typeof native.documentation === 'string' ? native.documentation : native.documentation?.value
      const value = await options.workspace.resolveCompletion({
        ...positionRequest(data.uri, data.position, signal),
        item: {
          ...data.item,
          ...(native.detail === undefined ? {} : { detail: native.detail }),
          ...(documentation === undefined ? {} : { documentation }),
        },
      })
      if (value === undefined) return native
      return {
        ...native,
        ...(value.detail === undefined ? {} : { detail: value.detail }),
        ...(value.documentation === undefined
          ? {}
          : { documentation: { kind: 'markdown', value: value.documentation } }),
      } satisfies CompletionItem
    }),
  )
  connection.onHover((params, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'hover', signal)
      const value = await options.workspace.hover(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return value === undefined
        ? null
        : {
            contents: {
              kind: 'markdown',
              // the hover's links run as the client's language command, when it trusts them
              value:
                value.commands === undefined || value.commands.length === 0
                  ? value.markdown
                  : `${value.markdown}\n\n${value.commands
                      .map(
                        item =>
                          `[${item.title}](command:${LSP_LANGUAGE_COMMAND}?${encodeURIComponent(
                            JSON.stringify([item.command]),
                          )})`,
                      )
                      .join(' · ')}`,
            },
            ...(value.range === undefined ? {} : { range: value.range }),
          }
    }),
  )
  connection.onSignatureHelp((params, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'signature-help', signal)
      const value = await options.workspace.signatureHelp(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return value === undefined
        ? null
        : ({
            signatures: value.signatures.map(signature => ({
              label: signature.label,
              ...(signature.documentation === undefined
                ? {}
                : { documentation: signature.documentation }),
              parameters: signature.parameters.map(parameter => ({
                label: parameter.label,
                ...(parameter.documentation === undefined
                  ? {}
                  : { documentation: parameter.documentation }),
              })),
            })),
            activeSignature: value.activeSignature,
            activeParameter: value.activeParameter,
          } satisfies SignatureHelp)
    }),
  )
  connection.onDefinition((params, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'definition', signal)
      const value = await options.workspace.definition(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return (value?.locations as Location[] | undefined) ?? null
    }),
  )
  connection.onReferences((params, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'references', signal)
      const value = await options.workspace.references({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        includeDeclaration: params.context.includeDeclaration,
      } satisfies LanguageWorkspaceReferencesRequest)
      return (value?.locations as Location[] | undefined) ?? null
    }),
  )
  connection.onPrepareRename((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'prepare-rename', signal)
      return (
        (await options.workspace.prepareRename(
          positionRequest(params.textDocument.uri, params.position, signal),
        )) ?? null
      )
    }),
  )
  connection.onRenameRequest((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'rename', signal)
      const value = await options.workspace.rename({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        newName: params.newName,
        maxEdits: maxResults,
      } satisfies LanguageWorkspaceRenameRequest)
      return value === undefined ? null : workspaceEditOf(value, uri => documents.get(uri) !== undefined)
    }),
  )
  connection.onDocumentFormatting((params: DocumentFormattingParams, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'formatting', signal)
      const value = await options.workspace.formatting({
        ...request(params.textDocument.uri, signal),
        options: {
          tabSize: params.options.tabSize,
          insertSpaces: params.options.insertSpaces,
          ...(params.options.insertFinalNewline === undefined
            ? {}
            : { finalNewline: params.options.insertFinalNewline }),
        },
      } satisfies LanguageWorkspaceFormattingRequest)
      return value?.edits.map(edit => TextEdit.replace(edit.range, edit.newText)) ?? null
    }),
  )
  connection.onDocumentOnTypeFormatting((params: DocumentOnTypeFormattingParams, token) =>
    withInteractiveSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'on-type-formatting', signal)
      const value = await options.workspace.onTypeFormatting({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        ch: params.ch,
        semanticContextPolicy: 'cached',
        options: {
          tabSize: params.options.tabSize,
          insertSpaces: params.options.insertSpaces,
          ...(params.options.insertFinalNewline === undefined
            ? {}
            : { finalNewline: params.options.insertFinalNewline }),
        },
      } satisfies LanguageWorkspaceOnTypeFormattingRequest)
      return value?.edits.map(edit => TextEdit.replace(edit.range, edit.newText)) ?? null
    }),
  )
  // Standard LSP can return only edits. Clients that read the advertised experimental capability
  // use this request to preserve the post-edit caret and completion request as one Modkit action.
  connection.onRequest(
    'modkit/onTypeEdit',
    (params: DocumentOnTypeFormattingParams, token: CancellationToken) =>
      withInteractiveSignal(token, async signal => {
        await requireFeature(params.textDocument.uri, 'on-type-formatting', signal)
        return (
          (await options.workspace.onTypeFormatting({
            ...positionRequest(params.textDocument.uri, params.position, signal),
            ch: params.ch,
            semanticContextPolicy: 'cached',
            options: {
              tabSize: params.options.tabSize,
              insertSpaces: params.options.insertSpaces,
              ...(params.options.insertFinalNewline === undefined
                ? {}
                : { finalNewline: params.options.insertFinalNewline }),
            },
          } satisfies LanguageWorkspaceOnTypeFormattingRequest)) ?? null
        )
      }),
  )
  connection.onDocumentColor((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'document-colors', signal)
      const value = await options.workspace.documentColors(documentRequest(params.textDocument.uri, signal))
      return (value?.colors as ColorInformation[] | undefined) ?? []
    }),
  )
  connection.onCodeLens((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'code-lenses', signal)
      const value = await options.workspace.codeLenses(documentRequest(params.textDocument.uri, signal))
      return (
        value?.lenses.map(lens => ({
          range: lens.range,
          // a lens without a command still shows its title: an empty command id is not clickable
          command:
            lens.command === undefined
              ? { title: lens.title, command: '' }
              : commandOf(lens.title, lens.command),
        })) ?? []
      )
    }),
  )
  connection.onFoldingRanges((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'folding-ranges', signal)
      const value = await options.workspace.foldingRanges(documentRequest(params.textDocument.uri, signal))
      return (
        value?.ranges.map(range => ({
          startLine: range.startLine,
          endLine: range.endLine,
          ...(range.kind === undefined ? {} : { kind: range.kind }),
        })) ?? []
      )
    }),
  )
  connection.onDocumentLinks((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'document-links', signal)
      const value = await options.workspace.documentLinks(documentRequest(params.textDocument.uri, signal))
      return (
        value?.links.map(link => ({
          range: link.range,
          target: link.target,
          ...(link.tooltip === undefined ? {} : { tooltip: link.tooltip }),
        })) ?? []
      )
    }),
  )
  connection.onDocumentHighlight((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'document-highlights', signal)
      const value = await options.workspace.documentHighlights(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return (
        value?.highlights.map(highlight => ({
          range: highlight.range,
          ...(highlight.kind === undefined
            ? {}
            : {
                kind:
                  highlight.kind === 'read'
                    ? DocumentHighlightKind.Read
                    : highlight.kind === 'write'
                      ? DocumentHighlightKind.Write
                      : DocumentHighlightKind.Text,
              }),
        })) ?? []
      )
    }),
  )
  connection.languages.inlayHint.on((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'inlay-hints', signal)
      const value = await options.workspace.inlayHints({
        ...request(params.textDocument.uri, signal),
        range: params.range,
      } satisfies LanguageWorkspaceInlayHintsRequest)
      return (
        value?.hints.map(hint => ({
          position: hint.position,
          label: hint.label,
          ...(hint.kind === undefined
            ? {}
            : { kind: hint.kind === 'type' ? InlayHintKind.Type : InlayHintKind.Parameter }),
          ...(hint.tooltip === undefined ? {} : { tooltip: hint.tooltip }),
          ...(hint.paddingLeft === undefined ? {} : { paddingLeft: hint.paddingLeft }),
          ...(hint.paddingRight === undefined ? {} : { paddingRight: hint.paddingRight }),
        })) ?? []
      )
    }),
  )
  connection.onColorPresentation((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'color-presentations', signal)
      const value = await options.workspace.colorPresentations({
        ...request(params.textDocument.uri, signal),
        color: params.color,
        range: params.range,
      } satisfies LanguageWorkspaceColorPresentationRequest)
      return (
        value?.presentations.map(
          item =>
            ({
              label: item.label,
              ...(item.textEdit === undefined
                ? {}
                : { textEdit: TextEdit.replace(item.textEdit.range, item.textEdit.newText) }),
            }) satisfies ColorPresentation,
        ) ?? []
      )
    }),
  )
  connection.onCodeAction((params, token) =>
    withSignal(token, async signal => {
      await requireFeature(params.textDocument.uri, 'code-actions', signal)
      const diagnostics: LanguageDiagnostic[] = params.context.diagnostics.map(item => ({
        range: item.range,
        severity:
          item.severity === DiagnosticSeverity.Error
            ? 'error'
            : item.severity === DiagnosticSeverity.Warning
              ? 'warning'
              : item.severity === DiagnosticSeverity.Hint
                ? 'hint'
                : 'information',
        message: typeof item.message === 'string' ? item.message : item.message.value,
        ...(item.code === undefined ? {} : { code: String(item.code) }),
        ...(item.source === undefined ? {} : { source: item.source }),
      }))
      const value = await options.workspace.codeActions({
        ...request(params.textDocument.uri, signal),
        range: params.range,
        diagnostics,
        maxEdits: maxResults,
      } satisfies LanguageWorkspaceCodeActionsRequest)
      return value?.actions.map(action => codeActionOf(action, uri => documents.get(uri) !== undefined)) ?? []
    }),
  )
  connection.onDocumentSymbol((params, token) =>
    withInteractiveSignal(token, async signal => {
      // The outline needs applied edits, not the completed diagnostics of every open document.
      await awaitReady()
      const value = await options.workspace.documentSymbols(
        documentRequest(params.textDocument.uri, signal),
      )
      return value?.symbols.map(documentSymbolOf) ?? []
    }),
  )
  connection.onWorkspaceSymbol(async (params, token) =>
    withSignal(token, async signal => {
      await awaitReady()
      // One query per open language: each provider answers only for its own documents.
      const byLanguage = new Map<string, string>()
      for (const document of [...acceptedDocuments.values()].sort((a, b) =>
        a.uri.localeCompare(b.uri),
      )) {
        if (!byLanguage.has(document.languageId)) byLanguage.set(document.languageId, document.uri)
      }
      const symbols: WorkspaceSymbol[] = []
      const seen = new Set<string>()
      let supported = byLanguage.size === 0
      for (const uri of byLanguage.values()) {
        await awaitReady()
        const capabilities = await options.workspace.capabilities(uri, signal)
        if (capabilities?.features.includes('workspace-symbols') !== true) continue
        supported = true
        const value = await options.workspace.workspaceSymbols({
          ...request(uri, signal),
          query: params.query,
        } satisfies LanguageWorkspaceSymbolsRequest)
        for (const item of value?.symbols ?? []) {
          const key = JSON.stringify([item.name, item.location])
          if (seen.has(key) || symbols.length >= maxResults) continue
          seen.add(key)
          symbols.push({
            name: item.name,
            kind: symbolKinds[item.kind],
            location: item.location,
            ...(item.containerName === undefined ? {} : { containerName: item.containerName }),
          })
        }
      }
      if (!supported) {
        throw new ResponseError(
          LSPErrorCodes.RequestFailed,
          'no open document has a language provider that supports workspace-symbols',
          { code: 'x3.lsp/feature-unsupported', feature: 'workspace-symbols' },
        )
      }
      return symbols
    }),
  )
  connection.onRequest(
    'textDocument/semanticTokens/full',
    (params: SemanticTokensParams, token: CancellationToken) =>
      withSignal(token, signal => semanticTokensFor(params.textDocument.uri, signal)),
  )
  connection.onRequest(
    'textDocument/semanticTokens/full/delta',
    (params: SemanticTokensDeltaParams, token: CancellationToken) =>
      withSignal(token, async (signal): Promise<SemanticTokens | SemanticTokensDelta> => {
        const previous = semanticTokenSnapshots.get(params.textDocument.uri)
        const current = await semanticTokensFor(params.textDocument.uri, signal)
        if (params.previousResultId === current.resultId) {
          return { resultId: current.resultId, edits: [] }
        }
        if (previous?.resultId !== params.previousResultId) return current
        return {
          resultId: current.resultId,
          edits: [
            {
              start: 0,
              deleteCount: previous.data.length,
              ...(current.data.length === 0 ? {} : { data: current.data }),
            },
          ],
        }
      }),
  )

  documents.onDidOpen(event => schedule(event.document, 'open'))
  documents.onDidChangeContent(event => schedule(event.document, 'change'))
  documents.onDidSave(event => schedule(event.document, 'refresh'))
  connection.onDidChangeWatchedFiles(params => {
    if (!params.changes.some(change => fileInsideRoots(change.uri))) return
    // The servers read the changed files before any refreshed request reaches them.
    const filesChanged = options.filesChanged
    if (filesChanged !== undefined) enqueue(() => filesChanged())
    for (const document of documents.all()) schedule(document, 'refresh')
  })
  documents.onDidClose(event => {
    const uri = event.document.uri
    enqueue(async () => {
      try {
        if (workspaceUris.delete(uri)) await options.workspace.close(uri)
      } finally {
        acceptedDocuments.delete(uri)
        dirtyDiagnostics.delete(uri)
        diagnosticSnapshots.delete(uri)
        semanticTokenSnapshots.delete(uri)
        connection.sendDiagnostics({ uri, diagnostics: [] })
        refreshDiagnostics()
      }
    })
  })
  connection.onShutdown(async () => {
    shutDown = true
    cancelDiagnostics()
    await awaitReady()
    await Promise.all(diagnosticWork)
    await options.workspace.shutdown()
    return undefined
  })
  connection.onExit(() => {
    if (!shutDown) process.exitCode = 1
  })

  return Object.freeze({
    connection,
    listen(): void {
      documents.listen(connection)
      connection.listen()
    },
    async close(): Promise<void> {
      shutDown = true
      cancelDiagnostics()
      await awaitReady()
      await Promise.all(diagnosticWork)
      await options.workspace.shutdown()
      connection.dispose()
    },
  })
}
