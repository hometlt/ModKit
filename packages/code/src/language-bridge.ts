/**
 * One adapter from `common.language/document-analysis@1` to Monaco, for every language.
 *
 * The contract has been complete for a long time — completion, hover, diagnostics, definition,
 * references, rename, formatting, symbols — and StarCraft II already ships four providers against
 * it. None of them reached a reader, because nothing in `packages/ui` or `packages/code` ever
 * imported the contract: the editor offered syntax colouring and nothing else. This module is the
 * missing consumer, written once rather than per language, which is the simplification the port
 * plan settled on.
 *
 * Three rules shape what follows.
 *
 * Optional means optional. A provider that implements only `diagnostics` must not have Monaco
 * advertise completion on its behalf, so each Monaco provider is registered only when the matching
 * method exists.
 *
 * A provider never sees a document it did not claim. Registration is keyed by the language ids the
 * provider declares, and the model's language is passed through unchanged.
 *
 * Subject-reference completions are a request, not an answer. The contract lets a provider say
 * "offer units filtered like this" instead of embedding a list; resolving that needs the host's
 * subject selector, so when no resolver is supplied those items are omitted rather than rendered
 * as unusable placeholders.
 */
import type {
  LanguageCompletionItem,
  LanguageDiagnostic,
  LanguageDocument,
  LanguageProvider,
  LanguageProviderCompletionItem,
  LanguageRange,
  LanguageSymbol,
} from '@modkit/sdk'
import * as monaco from 'monaco-editor/editor/editor.main.js'

/** Resolve a declarative subject-reference completion into concrete labels. */
export interface SubjectCompletionResolver {
  (
    request: { readonly subjectKind: string; readonly filter?: unknown },
    signal?: AbortSignal,
  ): Promise<readonly { readonly id: string; readonly label?: string }[]>
}

export interface LanguageBridgeOptions {
  readonly maxResults?: number
  readonly maxDocuments?: number
  readonly subjects?: SubjectCompletionResolver
}

const SEVERITY: Readonly<Record<LanguageDiagnostic['severity'], monaco.MarkerSeverity>> =
  Object.freeze({
    error: monaco.MarkerSeverity.Error,
    warning: monaco.MarkerSeverity.Warning,
    information: monaco.MarkerSeverity.Info,
    hint: monaco.MarkerSeverity.Hint,
  })

/**
 * The contract counts lines and characters from zero, Monaco from one. Getting this wrong shifts
 * every squiggle up a line, which reads as "the checker is wrong" rather than "the bridge is".
 */
function toMonacoRange(range: LanguageRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

const COMPLETION_KIND: Readonly<Record<string, monaco.languages.CompletionItemKind>> =
  Object.freeze({
    keyword: monaco.languages.CompletionItemKind.Keyword,
    snippet: monaco.languages.CompletionItemKind.Snippet,
    text: monaco.languages.CompletionItemKind.Text,
    type: monaco.languages.CompletionItemKind.TypeParameter,
    parameter: monaco.languages.CompletionItemKind.Variable,
    function: monaco.languages.CompletionItemKind.Function,
    variable: monaco.languages.CompletionItemKind.Variable,
    class: monaco.languages.CompletionItemKind.Class,
    struct: monaco.languages.CompletionItemKind.Struct,
    field: monaco.languages.CompletionItemKind.Field,
    property: monaco.languages.CompletionItemKind.Property,
    constant: monaco.languages.CompletionItemKind.Constant,
    enum: monaco.languages.CompletionItemKind.Enum,
    'enum-member': monaco.languages.CompletionItemKind.EnumMember,
    namespace: monaco.languages.CompletionItemKind.Module,
    file: monaco.languages.CompletionItemKind.File,
  })

const SYMBOL_KIND: Readonly<Record<string, monaco.languages.SymbolKind>> = Object.freeze({
  function: monaco.languages.SymbolKind.Function,
  variable: monaco.languages.SymbolKind.Variable,
  class: monaco.languages.SymbolKind.Class,
  struct: monaco.languages.SymbolKind.Struct,
  field: monaco.languages.SymbolKind.Field,
  property: monaco.languages.SymbolKind.Property,
  constant: monaco.languages.SymbolKind.Constant,
  enum: monaco.languages.SymbolKind.Enum,
  'enum-member': monaco.languages.SymbolKind.EnumMember,
  namespace: monaco.languages.SymbolKind.Namespace,
  file: monaco.languages.SymbolKind.File,
})

function documentOf(model: monaco.editor.ITextModel): LanguageDocument {
  return {
    uri: model.uri.toString(),
    languageId: model.getLanguageId(),
    version: model.getVersionId(),
    text: model.getValue(),
  }
}

function isSubjectRequest(
  item: LanguageProviderCompletionItem,
): item is Extract<LanguageProviderCompletionItem, { kind: 'subject-ref' }> {
  return item.kind === 'subject-ref'
}

/**
 * Register every Monaco provider this language provider can actually back.
 * Returns a disposable that removes all of them, so a host can swap providers without leaking.
 */
export function bridgeLanguageProvider(
  provider: LanguageProvider,
  options: LanguageBridgeOptions = {},
): monaco.IDisposable {
  const selector = [...provider.languageIds]
  const maxResults = options.maxResults ?? 200
  const maxDocuments = options.maxDocuments ?? 1
  const disposables: monaco.IDisposable[] = []

  /** Every feature request carries the same bounded workspace snapshot. */
  const request = (model: monaco.editor.ITextModel, token: monaco.CancellationToken) => {
    const controller = new AbortController()
    token.onCancellationRequested(() => controller.abort('monaco-cancelled'))
    return {
      document: documentOf(model),
      workspaceDocuments: [],
      workspaceIncomplete: true,
      maxResults,
      maxDocuments,
      signal: controller.signal,
    }
  }

  if (provider.completion !== undefined) {
    const completion = provider.completion.bind(provider)
    disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        async provideCompletionItems(model, position, _context, token) {
          const word = model.getWordUntilPosition(position)
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }
          const list = await completion({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })
          const suggestions: monaco.languages.CompletionItem[] = []
          for (const item of list.items) {
            if (isSubjectRequest(item)) {
              if (options.subjects === undefined) continue
              const candidates = await options.subjects(
                { subjectKind: item.subjectKind, ...(item.filter === undefined ? {} : { filter: item.filter }) },
              )
              for (const candidate of candidates) {
                suggestions.push({
                  label: candidate.label ?? candidate.id,
                  kind: monaco.languages.CompletionItemKind.Reference,
                  insertText: candidate.id,
                  range,
                })
              }
              continue
            }
            const plain: LanguageCompletionItem = item
            suggestions.push({
              label: plain.label,
              kind: COMPLETION_KIND[plain.kind] ?? monaco.languages.CompletionItemKind.Text,
              insertText: plain.insertText ?? plain.label,
              range,
              ...(plain.detail === undefined ? {} : { detail: plain.detail }),
              ...(plain.documentation === undefined ? {} : { documentation: plain.documentation }),
              ...(plain.sortText === undefined ? {} : { sortText: plain.sortText }),
              ...(plain.insertTextFormat === 'snippet'
                ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet }
                : {}),
            })
          }
          return { suggestions, incomplete: list.isIncomplete }
        },
      }),
    )
  }

  if (provider.hover !== undefined) {
    const hover = provider.hover.bind(provider)
    disposables.push(
      monaco.languages.registerHoverProvider(selector, {
        async provideHover(model, position, token) {
          const result = await hover({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })
          if (result === undefined) return undefined
          return {
            contents: [{ value: result.markdown }],
            ...(result.range === undefined ? {} : { range: toMonacoRange(result.range) }),
          }
        },
      }),
    )
  }

  if (provider.definition !== undefined) {
    const definition = provider.definition.bind(provider)
    disposables.push(
      monaco.languages.registerDefinitionProvider(selector, {
        async provideDefinition(model, position, token) {
          const list = await definition({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })
          return list.locations.map((location): monaco.languages.Location => ({
            uri: monaco.Uri.parse(location.uri),
            range: toMonacoRange(location.range),
          }))
        },
      }),
    )
  }

  if (provider.documentSymbols !== undefined) {
    const symbols = provider.documentSymbols.bind(provider)
    const convert = (symbol: LanguageSymbol): monaco.languages.DocumentSymbol => ({
      name: symbol.name,
      detail: symbol.detail ?? '',
      kind: SYMBOL_KIND[symbol.kind] ?? monaco.languages.SymbolKind.Variable,
      tags: [],
      range: toMonacoRange(symbol.range),
      selectionRange: toMonacoRange(symbol.selectionRange),
      ...(symbol.children === undefined ? {} : { children: symbol.children.map(convert) }),
    })
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(selector, {
        async provideDocumentSymbols(model, token) {
          const list = await symbols(request(model, token))
          return list.symbols.map(convert)
        },
      }),
    )
  }

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
      disposables.length = 0
    },
  }
}

/**
 * Publish a provider's diagnostics as Monaco markers for one model.
 *
 * Diagnostics are pushed rather than pulled: Monaco has no "ask for problems" provider, the owner
 * string keys the marker set so a re-run replaces the previous findings instead of stacking them,
 * and the caller decides when to re-check — typically after an edit settles.
 */
export async function publishDiagnostics(
  provider: LanguageProvider,
  model: monaco.editor.ITextModel,
  options: { readonly owner?: string; readonly signal?: AbortSignal; readonly maxResults?: number } = {},
): Promise<number> {
  const owner = options.owner ?? 'modkit.language'
  const diagnose = provider.diagnostics?.bind(provider)
  if (diagnose === undefined) {
    monaco.editor.setModelMarkers(model, owner, [])
    return 0
  }
  const list = await diagnose({
    document: documentOf(model),
    workspaceDocuments: [],
    workspaceIncomplete: true,
    maxResults: options.maxResults ?? 1000,
    maxDocuments: 1,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const markers = list.diagnostics.map((item): monaco.editor.IMarkerData => ({
    ...toMonacoRange(item.range),
    message: item.message,
    severity: SEVERITY[item.severity],
    ...(item.code === undefined ? {} : { code: item.code }),
    ...(item.source === undefined ? {} : { source: item.source }),
  }))
  monaco.editor.setModelMarkers(model, owner, markers)
  return markers.length
}
