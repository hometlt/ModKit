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
/// <reference path="./monaco-module.d.ts" />
import type {
  LanguageCodeActionKind,
  LanguageCompletionItem,
  LanguageDiagnostic,
  LanguageDocument,
  LanguageProvider,
  LanguageProviderCompletionItem,
  LanguageRange,
  LanguageSymbol,
} from '@modkit/sdk'
import * as monaco from 'monaco-editor/editor/editor.main.js'
import { encodeSemanticTokens, SEMANTIC_TOKEN_TYPES } from './semantic-tokens.js'

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
  /** Characters that ask Monaco to request the provider's signature help automatically. */
  readonly signatureHelpTriggerCharacters?: readonly string[]
  /** Characters after which Monaco requests protocol-neutral on-type formatting edits. */
  readonly onTypeFormattingTriggerCharacters?: readonly string[]
  /** Trigger characters used while an existing signature-help popup is active. */
  readonly signatureHelpRetriggerCharacters?: readonly string[]
  /**
   * Monaco language ids to register under, when they differ from the ones the provider declares.
   *
   * The two are not always the same, and the difference is not a mistake. A provider names the
   * *format* it understands — `sc2-bank` — while a model is opened in the language Monaco can
   * colour, which for a bank is `xml`. Routing is the host's job in this contract: the host knows
   * this buffer is a bank, so it says so here rather than the provider claiming every XML file in
   * the workspace.
   */
  readonly languageIds?: readonly string[]
  /**
   * Restrict the registration to models this predicate accepts.
   *
   * Without it, a provider registered under `xml` would answer for every XML document open in the
   * editor. With it, a host that routed by format keeps that routing: the bank provider is asked
   * about the bank buffer and nothing else.
   */
  readonly models?: (model: monaco.editor.ITextModel) => boolean
  /**
   * The language id the provider should see on the document, when it differs from the one Monaco
   * colours with.
   *
   * These are two different things and conflating them silently disables a provider. A GameData
   * document is coloured as `xml` and understood as `sc2-data`; SC2's triggers and Galaxy providers
   * check the id they were given and refuse anything else, so handed `xml` they answer "cannot
   * inspect xml" — correctly, and invisibly, because a refusal looks exactly like a file with no
   * problems. The host knows which document this is, so the host says so.
   */
  readonly documentLanguageId?: string
  /**
   * Put the open document into its own workspace snapshot.
   *
   * Providers disagree about this and both readings are defensible, so it is stated rather than
   * assumed. Galaxy refuses outright when the primary document is absent from the snapshot — it
   * resolves includes against that set. sc2-data reads a non-empty snapshot as "other files are
   * visible" and switches on cross-file reference checking, so handing it only itself would report
   * every link into another catalog as broken. Defaulting either way breaks one of them quietly.
   */
  readonly includePrimaryInWorkspace?: boolean
  /**
   * Whether the supplied workspace snapshot is partial. Defaults to `true`, so rename and other
   * complete-snapshot operations refuse until the embedding host explicitly proves completeness.
   */
  readonly workspaceIncomplete?: boolean | (() => boolean)
  /**
   * Neighbouring documents to put in the workspace snapshot with every request.
   *
   * The contract has always carried this and no host ever filled it, which quietly capped what the
   * SC2 providers could answer: a localization buffer's style and colour names live in
   * `FontStyles.SC2Style`, and its entity names live in a GameData catalog. It is a callback rather
   * than a list because the neighbours change as the reader opens files, and a provider asked today
   * should see today's set.
   */
  readonly workspaceDocuments?: () => readonly LanguageDocument[]
}

const SEVERITY: Readonly<Record<LanguageDiagnostic['severity'], monaco.MarkerSeverity>> =
  Object.freeze({
    error: monaco.MarkerSeverity.Error,
    warning: monaco.MarkerSeverity.Warning,
    information: monaco.MarkerSeverity.Info,
    hint: monaco.MarkerSeverity.Hint,
  })

const diagnosticFromMarker = (marker: monaco.editor.IMarkerData): LanguageDiagnostic => ({
  range: {
    start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
    end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
  },
  severity:
    marker.severity === monaco.MarkerSeverity.Error
      ? 'error'
      : marker.severity === monaco.MarkerSeverity.Warning
        ? 'warning'
        : marker.severity === monaco.MarkerSeverity.Hint
          ? 'hint'
          : 'information',
  message: marker.message,
  ...(marker.code === undefined ? {} : { code: String(marker.code) }),
  ...(marker.source === undefined ? {} : { source: marker.source }),
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

function toMonacoLocation(location: { readonly uri: string; readonly range: LanguageRange }) {
  return {
    uri: monaco.Uri.parse(location.uri),
    range: toMonacoRange(location.range),
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

function documentOf(
  model: monaco.editor.ITextModel,
  languageId?: string,
): LanguageDocument {
  return {
    uri: model.uri.toString(),
    languageId: languageId ?? model.getLanguageId(),
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
  const selector = [...(options.languageIds ?? provider.languageIds)]
  const claims = options.models ?? (() => true)
  const maxResults = options.maxResults ?? 200
  const maxDocuments = options.maxDocuments ?? 1
  const disposables: monaco.IDisposable[] = []

  /** Every feature request carries the same bounded workspace snapshot. */
  const request = (model: monaco.editor.ITextModel, token: monaco.CancellationToken) => {
    const controller = new AbortController()
    token.onCancellationRequested(() => controller.abort('monaco-cancelled'))
    const document = documentOf(model, options.documentLanguageId)
    const neighbours = options.workspaceDocuments?.() ?? []
    return {
      document,
      workspaceDocuments:
        options.includePrimaryInWorkspace === true ? [document, ...neighbours] : neighbours,
      workspaceIncomplete:
        typeof options.workspaceIncomplete === 'function'
          ? options.workspaceIncomplete()
          : (options.workspaceIncomplete ?? true),
      maxResults,
      // A cap below the snapshot size would make the provider ignore documents the host chose to
      // send, which reads as a missing neighbour rather than a deliberate limit.
      maxDocuments: Math.max(maxDocuments, neighbours.length + 1),
      signal: controller.signal,
    }
  }

  if (provider.completion !== undefined) {
    const completion = provider.completion.bind(provider)
    disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        async provideCompletionItems(model, position, _context, token) {
          if (!claims(model)) return { suggestions: [] }
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
              range:
                plain.replacementRange === undefined
                  ? range
                  : toMonacoRange(plain.replacementRange),
              ...(plain.detail === undefined ? {} : { detail: plain.detail }),
              ...(plain.documentation === undefined ? {} : { documentation: plain.documentation }),
              ...(plain.sortText === undefined ? {} : { sortText: plain.sortText }),
              ...(plain.filterText === undefined ? {} : { filterText: plain.filterText }),
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

  /*
   * Syntax colouring from the codec's own tokenizer.
   *
   * A format like GameStrings has no Monaco grammar and was opened as `ini`, which is to say with no
   * colouring of its own at all. Writing a Monarch grammar would be a second tokenizer beside the
   * one the provider already runs — two of them disagree eventually, and the disagreement shows up
   * as text that is coloured one way in the editor and another in the tree. So the editor is fed the
   * provider's own tokens instead, and there is one tokenizer per format for every surface.
   */
  {
    const analyze = provider.analyze.bind(provider)
    const legend = { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] }
    disposables.push(
      monaco.languages.registerDocumentSemanticTokensProvider(selector, {
        getLegend: () => legend,
        async provideDocumentSemanticTokens(model, _lastResultId, token) {
          if (!claims(model)) return null
          const controller = new AbortController()
          token.onCancellationRequested(() => controller.abort('monaco-cancelled'))
          const analysis = await analyze({
            document: documentOf(model, options.documentLanguageId),
            // Only the tokens are wanted here; a checker run on every keystroke is waste.
            include: { tokens: true, diagnostics: false, symbols: false },
            signal: controller.signal,
          })
          return { data: encodeSemanticTokens(analysis) }
        },
        releaseDocumentSemanticTokens() {
          // Full results only: there is no cached previous state to release.
        },
      }),
    )
  }

  if (provider.hover !== undefined) {
    const hover = provider.hover.bind(provider)
    disposables.push(
      monaco.languages.registerHoverProvider(selector, {
        async provideHover(model, position, token) {
          if (!claims(model)) return undefined
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

  if (provider.documentColors !== undefined && provider.colorPresentations !== undefined) {
    const documentColors = provider.documentColors.bind(provider)
    const colorPresentations = provider.colorPresentations.bind(provider)
    disposables.push(
      monaco.languages.registerColorProvider(selector, {
        async provideDocumentColors(model, token) {
          if (!claims(model)) return []
          const list = await documentColors(request(model, token))
          return list.colors.map(item => ({
            range: toMonacoRange(item.range),
            color: item.color,
          }))
        },
        async provideColorPresentations(model, colorInfo, token) {
          if (!claims(model)) return []
          const list = await colorPresentations({
            ...request(model, token),
            color: colorInfo.color,
            range: {
              start: {
                line: colorInfo.range.startLineNumber - 1,
                character: colorInfo.range.startColumn - 1,
              },
              end: {
                line: colorInfo.range.endLineNumber - 1,
                character: colorInfo.range.endColumn - 1,
              },
            },
          })
          return list.presentations.map(item => ({
            label: item.label,
            ...(item.textEdit === undefined
              ? {}
              : {
                  textEdit: {
                    range: toMonacoRange(item.textEdit.range),
                    text: item.textEdit.newText,
                  },
                }),
          }))
        },
      }),
    )
  }
  if (provider.definition !== undefined) {
    const definition = provider.definition.bind(provider)
    disposables.push(
      monaco.languages.registerDefinitionProvider(selector, {
        async provideDefinition(model, position, token) {
          if (!claims(model)) return []
          const list = await definition({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })
          return list.locations.map(toMonacoLocation)
        },
      }),
    )
  }

  if (provider.references !== undefined) {
    const references = provider.references.bind(provider)
    disposables.push(
      monaco.languages.registerReferenceProvider(selector, {
        async provideReferences(model, position, context, token) {
          if (!claims(model)) return []
          const list = await references({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            includeDeclaration: context.includeDeclaration,
          })
          return list.locations.map(toMonacoLocation)
        },
      }),
    )
  }

  if (provider.rename !== undefined) {
    const rename = provider.rename.bind(provider)
    const prepareRename = provider.prepareRename?.bind(provider)
    disposables.push(
      monaco.languages.registerRenameProvider(selector, {
        async provideRenameEdits(model, position, newName, token) {
          if (!claims(model)) return { edits: [], rejectReason: 'Document is not claimed' }
          const edit = await rename({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            newName,
            maxEdits: maxResults,
          })
          if (edit === undefined) {
            return { edits: [], rejectReason: 'Rename is unavailable for this workspace snapshot' }
          }
          return {
            edits: edit.documentChanges.flatMap(change =>
              change.edits.map(item => ({
                resource: monaco.Uri.parse(change.uri),
                versionId: change.documentVersion,
                textEdit: { range: toMonacoRange(item.range), text: item.newText },
              })),
            ),
          }
        },
        ...(prepareRename === undefined
          ? {}
          : {
              async resolveRenameLocation(model, position, token) {
                if (!claims(model)) {
                  return {
                    range: new monaco.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column,
                    ),
                    text: '',
                    rejectReason: 'Document is not claimed',
                  }
                }
                const prepared = await prepareRename({
                  ...request(model, token),
                  position: { line: position.lineNumber - 1, character: position.column - 1 },
                })
                if (prepared === undefined) {
                  return {
                    range: new monaco.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column,
                    ),
                    text: '',
                    rejectReason: 'Rename is unavailable at this position',
                  }
                }
                return { range: toMonacoRange(prepared.range), text: prepared.placeholder }
              },
            }),
      }),
    )
  }

  if (provider.formatting !== undefined) {
    const formatting = provider.formatting.bind(provider)
    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(selector, {
        async provideDocumentFormattingEdits(model, formattingOptions, token) {
          if (!claims(model)) return []
          const list = await formatting({
            ...request(model, token),
            options: {
              tabSize: formattingOptions.tabSize,
              insertSpaces: formattingOptions.insertSpaces,
            },
          })
          return list.edits.map(item => ({
            range: toMonacoRange(item.range),
            text: item.newText,
          }))
        },
      }),
    )
  }

  if (
    provider.onTypeFormatting !== undefined &&
    options.onTypeFormattingTriggerCharacters !== undefined &&
    options.onTypeFormattingTriggerCharacters.length > 0
  ) {
    const onTypeFormatting = provider.onTypeFormatting.bind(provider)
    disposables.push(
      monaco.languages.registerOnTypeFormattingEditProvider(selector, {
        autoFormatTriggerCharacters: [...options.onTypeFormattingTriggerCharacters],
        async provideOnTypeFormattingEdits(model, position, ch, formattingOptions, token) {
          if (!claims(model)) return []
          const list = await onTypeFormatting({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
            ch,
            options: {
              tabSize: formattingOptions.tabSize,
              insertSpaces: formattingOptions.insertSpaces,
            },
          })
          return list.edits.map(item => ({ range: toMonacoRange(item.range), text: item.newText }))
        },
      }),
    )
  }

  if (provider.codeActions !== undefined) {
    const codeActions = provider.codeActions.bind(provider)
    disposables.push(
      monaco.languages.registerCodeActionProvider(
        selector,
        {
          async provideCodeActions(model, range, context, token) {
            if (!claims(model)) return { actions: [], dispose() {} }
            const diagnostics = context.markers.map(diagnosticFromMarker)
            const list = await codeActions({
              ...request(model, token),
              range: {
                start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
                end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
              },
              diagnostics,
              maxEdits: maxResults,
            })
            return {
              actions: list.actions.map(action => {
                const codes = new Set(action.diagnosticCodes ?? [])
                return {
                  title: action.title,
                  ...(action.kind === undefined ? {} : { kind: action.kind as LanguageCodeActionKind }),
                  ...(action.isPreferred === undefined ? {} : { isPreferred: action.isPreferred }),
                  ...(action.disabledReason === undefined ? {} : { disabled: action.disabledReason }),
                  ...(codes.size === 0
                    ? {}
                    : { diagnostics: context.markers.filter(marker => codes.has(String(marker.code))) }),
                  ...(action.edit === undefined
                    ? {}
                    : {
                        edit: {
                          edits: action.edit.documentChanges.flatMap(change =>
                            change.edits.map(item => ({
                              resource: monaco.Uri.parse(change.uri),
                              versionId: change.documentVersion,
                              textEdit: { range: toMonacoRange(item.range), text: item.newText },
                            })),
                          ),
                        },
                      }),
                }
              }),
              dispose() {},
            }
          },
        },
        { providedCodeActionKinds: ['quickfix', 'refactor', 'rewrite', 'source'] },
      ),
    )
  }

  if (provider.signatureHelp !== undefined) {
    const signatureHelp = provider.signatureHelp.bind(provider)
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(selector, {
        signatureHelpTriggerCharacters: [...(options.signatureHelpTriggerCharacters ?? ['(', ','])],
        signatureHelpRetriggerCharacters: [
          ...(options.signatureHelpRetriggerCharacters ?? [',']),
        ],
        async provideSignatureHelp(model, position, token) {
          if (!claims(model)) return undefined
          const result = await signatureHelp({
            ...request(model, token),
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })
          if (result === undefined) return undefined
          return {
            value: {
              signatures: result.signatures.map(signature => ({
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
              activeSignature: result.activeSignature,
              activeParameter: result.activeParameter,
            },
            dispose() {},
          }
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
          if (!claims(model)) return []
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
  options: {
    readonly owner?: string
    readonly signal?: AbortSignal
    readonly maxResults?: number
    /** The id the provider should see; see `documentLanguageId` on the bridge options. */
    readonly documentLanguageId?: string
  /**
   * Put the open document into its own workspace snapshot.
   *
   * Providers disagree about this and both readings are defensible, so it is stated rather than
   * assumed. Galaxy refuses outright when the primary document is absent from the snapshot — it
   * resolves includes against that set. sc2-data reads a non-empty snapshot as "other files are
   * visible" and switches on cross-file reference checking, so handing it only itself would report
   * every link into another catalog as broken. Defaulting either way breaks one of them quietly.
   */
  readonly includePrimaryInWorkspace?: boolean
    /** Neighbouring documents to check against; see the bridge option of the same name. */
    readonly workspaceDocuments?: readonly LanguageDocument[]
  } = {},
): Promise<number> {
  const owner = options.owner ?? 'modkit.language'
  const diagnose = provider.diagnostics?.bind(provider)
  if (diagnose === undefined) {
    monaco.editor.setModelMarkers(model, owner, [])
    return 0
  }
  const primary = documentOf(model, options.documentLanguageId)
  const neighbours = options.workspaceDocuments ?? []
  const list = await diagnose({
    document: primary,
    workspaceDocuments:
      options.includePrimaryInWorkspace === true ? [primary, ...neighbours] : neighbours,
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
