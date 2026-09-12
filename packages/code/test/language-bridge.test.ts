import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  registered: new Map<string, any>(),
  disposed: vi.fn(),
}))

vi.mock('monaco-editor/editor/editor.main.js', () => {
  const register = (name: string) => vi.fn((_selector, provider) => {
    harness.registered.set(name, provider)
    return { dispose: harness.disposed }
  })
  return {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    Range: class Range {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    Uri: { parse: (value: string) => ({ value }) },
    editor: { setModelMarkers: vi.fn() },
    languages: {
      CompletionItemKind: new Proxy({}, { get: (_target, key) => String(key) }),
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      SymbolKind: new Proxy({}, { get: (_target, key) => String(key) }),
      registerCompletionItemProvider: register('completion'),
      registerDocumentSemanticTokensProvider: register('semanticTokens'),
      registerHoverProvider: register('hover'),
      registerColorProvider: register('colors'),
      registerDefinitionProvider: register('definition'),
      registerReferenceProvider: register('references'),
      registerRenameProvider: register('rename'),
      registerDocumentFormattingEditProvider: register('formatting'),
      registerSignatureHelpProvider: register('signatureHelp'),
      registerDocumentSymbolProvider: register('documentSymbols'),
    },
  }
})

import { bridgeLanguageProvider } from '../src/language-bridge.js'

const model = {
  uri: { toString: () => 'file:///primary.test' },
  getLanguageId: () => 'test',
  getVersionId: () => 7,
  getValue: () => 'call(value)',
  getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
}
const token = { onCancellationRequested: () => ({ dispose() {} }) }

describe('Monaco language bridge', () => {
  beforeEach(() => {
    harness.registered.clear()
    harness.disposed.mockClear()
  })

  it('binds references, rename, formatting, and signature help without domain logic', async () => {
    const references = vi.fn(async () => ({
      locations: [{ uri: 'file:///use.test', range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } }],
      isIncomplete: false,
    }))
    const prepareRename = vi.fn(async () => ({
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } },
      placeholder: 'value',
    }))
    const rename = vi.fn(async () => ({
      isComplete: true as const,
      documentChanges: [{
        uri: 'file:///use.test',
        documentVersion: 3,
        edits: [{ range: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } }, newText: 'next' }],
      }],
    }))
    const formatting = vi.fn(async () => ({
      isComplete: true as const,
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } }, newText: 'call(next)' }],
    }))
    const signatureHelp = vi.fn(async () => ({
      signatures: [{ label: 'call(value)', documentation: 'Call it.', parameters: [{ label: 'value', documentation: 'Input.' }] }],
      activeSignature: 0,
      activeParameter: 0,
    }))
    const disposable = bridgeLanguageProvider(
      {
        contract: 'common.language/document-analysis',
        languageIds: ['test'],
        analyze: async request => ({ documentUri: request.document.uri, documentVersion: request.document.version, tokens: [], diagnostics: [], symbols: [] }),
        references,
        prepareRename,
        rename,
        formatting,
        signatureHelp,
      },
      { workspaceIncomplete: false },
    )

    const referenceResult = await harness.registered.get('references').provideReferences(
      model,
      { lineNumber: 2, column: 4 },
      { includeDeclaration: true },
      token,
    )
    expect(references).toHaveBeenCalledWith(expect.objectContaining({
      position: { line: 1, character: 3 },
      includeDeclaration: true,
    }))
    expect(referenceResult).toEqual([{
      uri: { value: 'file:///use.test' },
      range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 },
    }])

    const renameProvider = harness.registered.get('rename')
    expect(await renameProvider.resolveRenameLocation(model, { lineNumber: 1, column: 6 }, token))
      .toMatchObject({ text: 'value', range: { startLineNumber: 1, startColumn: 6, endColumn: 11 } })
    expect(await renameProvider.provideRenameEdits(model, { lineNumber: 1, column: 6 }, 'next', token))
      .toEqual({ edits: [{
        resource: { value: 'file:///use.test' },
        versionId: 3,
        textEdit: {
          range: { startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 5 },
          text: 'next',
        },
      }] })
    expect(rename).toHaveBeenCalledWith(expect.objectContaining({ newName: 'next', maxEdits: 200 }))
    expect(rename).toHaveBeenCalledWith(expect.objectContaining({ workspaceIncomplete: false }))

    const formatResult = await harness.registered.get('formatting').provideDocumentFormattingEdits(
      model,
      { tabSize: 2, insertSpaces: true },
      token,
    )
    expect(formatting).toHaveBeenCalledWith(expect.objectContaining({
      options: { tabSize: 2, insertSpaces: true },
    }))
    expect(formatResult[0]).toMatchObject({ text: 'call(next)', range: { startColumn: 1 } })

    const signatures = await harness.registered.get('signatureHelp').provideSignatureHelp(
      model,
      { lineNumber: 1, column: 7 },
      token,
      {},
    )
    expect(signatures.value).toEqual({
      signatures: [{ label: 'call(value)', documentation: 'Call it.', parameters: [{ label: 'value', documentation: 'Input.' }] }],
      activeSignature: 0,
      activeParameter: 0,
    })
    signatures.dispose()

    disposable.dispose()
    expect(harness.disposed).toHaveBeenCalledTimes(5)
  })
})
