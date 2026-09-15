import { extname, isAbsolute, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Diagnostic as HostDiagnostic } from '@modkit/core'
import type {
  LanguageWorkspaceFeatureRequest,
  LanguageWorkspaceCapabilitySet,
  LanguageWorkspacePositionRequest,
  LanguageWorkspaceAnalysisResult,
  LanguageWorkspaceDocumentRequest,
  LanguageWorkspaceRenameRequest,
  LanguageWorkspaceReferencesRequest,
  LanguageWorkspaceFormattingRequest,
  LanguageWorkspaceColorPresentationRequest,
  LanguageWorkspaceCodeActionsRequest,
  LanguageWorkspaceSymbolsRequest,
  LanguageWorkspace,
} from '@modkit/host/language'
import type {
  LanguageCodeAction,
  LanguageDiagnostic,
  LanguageSymbol,
  LanguageSymbolKind,
  LanguageTokenKind,
  LanguageWorkspaceEdit,
} from '@modkit/sdk'
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  DocumentSymbol,
  InsertTextFormat,
  ProposedFeatures,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
  createConnection,
  type CancellationToken,
  type CodeAction,
  type ColorInformation,
  type ColorPresentation,
  type CompletionItem,
  type Connection,
  type Diagnostic,
  type DocumentDiagnosticReport,
  type DocumentFormattingParams,
  type InitializeResult,
  type Location,
  type Position,
  type Range,
  type SemanticTokens,
  type SemanticTokensDelta,
  type SemanticTokensDeltaParams,
  type SemanticTokensParams,
  type SignatureHelp,
  type WorkspaceEdit,
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

const workspaceEditOf = (value: LanguageWorkspaceEdit): WorkspaceEdit => ({
  documentChanges: value.documentChanges.map(change => ({
    textDocument: { uri: change.uri, version: change.documentVersion },
    edits: change.edits.map(edit => TextEdit.replace(edit.range, edit.newText)),
  })),
})

const codeActionOf = (value: LanguageCodeAction): CodeAction => ({
  title: value.title,
  ...(value.kind === undefined
    ? {}
    : { kind: value.kind === 'rewrite' ? CodeActionKind.RefactorRewrite : value.kind }),
  ...(value.isPreferred === undefined ? {} : { isPreferred: value.isPreferred }),
  ...(value.edit === undefined ? {} : { edit: workspaceEditOf(value.edit) }),
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
  } finally {
    linked.dispose()
  }
}

export interface ModkitLanguageServerOptions {
  readonly workspace: LanguageWorkspace
  readonly roots: readonly string[]
  readonly maxDocuments: number
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  readonly maxResults?: number
  readonly connection?: Connection
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
  const pending = new Map<string, Promise<void>>()
  const workspaceUris = new Set<string>()
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
  const encoder = new TextEncoder()
  let supportsDynamicWatchedFiles = false
  let shutDown = false

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
  const awaitReady = async (uri: string): Promise<void> => {
    await pending.get(uri)
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
    const result =
      mode === 'change' && workspaceUris.has(document.uri)
        ? await options.workspace.change(route(document))
        : await options.workspace.open(route(document))
    if (result.state === 'unresolved') {
      acceptDocument(document)
      setDiagnostics(document.uri, document.version, result.hostDiagnostics.map(hostDiagnosticOf))
      return
    }
    acceptDocument(document)
    workspaceUris.add(document.uri)
    const feature = await options.workspace.diagnostics(request(document.uri))
    setDiagnostics(
      document.uri,
      document.version,
      feature?.diagnostics.map(diagnosticOf) ?? result.analysis.diagnostics.map(diagnosticOf),
    )
  }
  const schedule = (document: TextDocument, mode: 'open' | 'change' | 'refresh'): void => {
    const previous = pending.get(document.uri)
    const task = (async () => {
      await previous
      await publish(document, mode)
    })()
      .catch(error => {
        connection.console.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (pending.get(document.uri) === task) pending.delete(document.uri)
      })
    pending.set(document.uri, task)
  }

  const semanticTokensFor = async (
    uri: string,
    signal: AbortSignal,
  ): Promise<SemanticTokens & { readonly resultId: string }> => {
    await awaitReady(uri)
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
        completionProvider: { triggerCharacters: ['.', ':', '"', "'"] },
        hoverProvider: true,
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        documentFormattingProvider: true,
        colorProvider: true,
        codeActionProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        semanticTokensProvider: {
          legend: { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] },
          full: { delta: true },
        },
        diagnosticProvider: {
          identifier: 'modkit',
          interFileDependencies: true,
          workspaceDiagnostics: false,
        },
        experimental: { modkitLanguageCapabilities: { version: 1 } },
      },
    } satisfies InitializeResult
  })
  connection.onInitialized(async () => {
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
      await awaitReady(params.textDocument.uri)
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
        await awaitReady(uri)
        return (await options.workspace.capabilities(uri, signal)) ?? null
      }),
  )
  connection.onCompletion((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.completion(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
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
                }) satisfies CompletionItem,
            ),
          }
    }),
  )
  connection.onHover((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.hover(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return value === undefined
        ? null
        : {
            contents: { kind: 'markdown', value: value.markdown },
            ...(value.range === undefined ? {} : { range: value.range }),
          }
    }),
  )
  connection.onSignatureHelp((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
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
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.definition(
        positionRequest(params.textDocument.uri, params.position, signal),
      )
      return (value?.locations as Location[] | undefined) ?? null
    }),
  )
  connection.onReferences((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.references({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        includeDeclaration: params.context.includeDeclaration,
      } satisfies LanguageWorkspaceReferencesRequest)
      return (value?.locations as Location[] | undefined) ?? null
    }),
  )
  connection.onPrepareRename((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      return (
        (await options.workspace.prepareRename(
          positionRequest(params.textDocument.uri, params.position, signal),
        )) ?? null
      )
    }),
  )
  connection.onRenameRequest((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.rename({
        ...positionRequest(params.textDocument.uri, params.position, signal),
        newName: params.newName,
        maxEdits: maxResults,
      } satisfies LanguageWorkspaceRenameRequest)
      return value === undefined ? null : workspaceEditOf(value)
    }),
  )
  connection.onDocumentFormatting((params: DocumentFormattingParams, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
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
  connection.onDocumentColor((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.documentColors(request(params.textDocument.uri, signal))
      return (value?.colors as ColorInformation[] | undefined) ?? []
    }),
  )
  connection.onColorPresentation((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
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
      await awaitReady(params.textDocument.uri)
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
      return value?.actions.map(codeActionOf) ?? []
    }),
  )
  connection.onDocumentSymbol((params, token) =>
    withSignal(token, async signal => {
      await awaitReady(params.textDocument.uri)
      const value = await options.workspace.documentSymbols(
        request(params.textDocument.uri, signal),
      )
      return value?.symbols.map(documentSymbolOf) ?? []
    }),
  )
  connection.onWorkspaceSymbol(async (params, token) =>
    withSignal(token, async signal => {
      const open = [...acceptedDocuments.values()].sort((a, b) => a.uri.localeCompare(b.uri))[0]
      if (open === undefined) return []
      await awaitReady(open.uri)
      const value = await options.workspace.workspaceSymbols({
        ...request(open.uri, signal),
        query: params.query,
      } satisfies LanguageWorkspaceSymbolsRequest)
      return (
        value?.symbols.map(
          item =>
            ({
              name: item.name,
              kind: symbolKinds[item.kind],
              location: item.location,
              ...(item.containerName === undefined ? {} : { containerName: item.containerName }),
            }) satisfies WorkspaceSymbol,
        ) ?? []
      )
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
    for (const document of documents.all()) schedule(document, 'refresh')
  })
  documents.onDidClose(event => {
    const previous = pending.get(event.document.uri)
    pending.delete(event.document.uri)
    void (async () => {
      await previous
      if (workspaceUris.delete(event.document.uri))
        await options.workspace.close(event.document.uri)
    })().finally(() => {
      acceptedDocuments.delete(event.document.uri)
      diagnosticSnapshots.delete(event.document.uri)
      semanticTokenSnapshots.delete(event.document.uri)
      connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] })
    })
  })
  connection.onShutdown(async () => {
    shutDown = true
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
      await options.workspace.shutdown()
      connection.dispose()
    },
  })
}
