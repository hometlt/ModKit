import { ModkitError, OperationCancelledError, diagnostic, type Diagnostic } from '@modkit/core'
import type { LanguageAnalysis, LanguageDocument } from '@modkit/sdk/language'
import type {
  LanguageWorkspace,
  LanguageWorkspaceAnalysisResult,
  LanguageWorkspaceDocumentRequest,
} from '@modkit/host/language'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyEditorOnTypeEditResult,
  caseInsensitiveExtensionPattern,
  createLanguageSessionController,
  plainLanguagePosition,
  type EditorLanguageDocument,
} from '../src/language-session.js'

it('builds case-insensitive suffix globs for mixed-case SC2 files', () => {
  expect(caseInsensitiveExtensionPattern('.sc2style')).toBe('[sS][cC]2[sS][tT][yY][lL][eE]')
  expect(caseInsensitiveExtensionPattern('xml')).toBe('[xX][mM][lL]')
})

it('copies editor-native positions to plain worker-safe language DTOs', () => {
  class NativePosition {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }
  const position = plainLanguagePosition(new NativePosition(2, 7))
  expect(position).toEqual({ line: 2, character: 7 })
  expect(Object.getPrototypeOf(position)).toBe(Object.prototype)
})

it('applies an on-type action before moving the caret and requesting completion', async () => {
  let text = 'value='
  let cursor = { line: 0, character: text.length }
  const requestCompletion = vi.fn(async () => {
    expect(text).toBe('value=""')
    expect(cursor).toEqual({ line: 0, character: 7 })
  })
  await expect(
    applyEditorOnTypeEditResult(
      {
        edits: [
          {
            range: { start: cursor, end: cursor },
            newText: '""',
          },
        ],
        isComplete: true,
        cursor: { line: 0, character: 7 },
        requestCompletion: true,
      },
      {
        async applyEdits(edits) {
          const [edit] = edits
          if (edit === undefined) return false
          text = `${text.slice(0, edit.range.start.character)}${edit.newText}${text.slice(edit.range.end.character)}`
          return true
        },
        moveCursor(position) {
          cursor = position
        },
        requestCompletion,
      },
    ),
  ).resolves.toBe(true)
  expect(text).toBe('value=""')
  expect(cursor).toEqual({ line: 0, character: 7 })
  expect(requestCompletion).toHaveBeenCalledOnce()
})

it('requests repeated completion for an on-type action without inventing an edit', async () => {
  const applyEdits = vi.fn(async () => true)
  const requestCompletion = vi.fn(async () => undefined)
  await expect(
    applyEditorOnTypeEditResult(
      { edits: [], isComplete: true, requestCompletion: true },
      {
        applyEdits,
        moveCursor: vi.fn(),
        requestCompletion,
      },
    ),
  ).resolves.toBe(true)
  expect(applyEdits).toHaveBeenCalledWith([])
  expect(requestCompletion).toHaveBeenCalledOnce()
})

const ROUTE = Object.freeze({
  languageId: 'fixture-language',
  documentKind: 'fixture-source',
  extension: 'fixture',
})

const editorDocument = (
  version: number,
  text = 'let value = 1',
  options: { readonly languageId?: string; readonly fileName?: string } = {},
): EditorLanguageDocument => ({
  uri: 'file:///workspace/sample.fixture',
  fileName: options.fileName ?? '/workspace/sample.fixture',
  languageId: options.languageId ?? 'plaintext',
  version,
  text,
})

const emptyAnalysis = (document: LanguageDocument): LanguageAnalysis => ({
  documentUri: document.uri,
  documentVersion: document.version,
  tokens: [],
  diagnostics: [],
  symbols: [],
})

const resolved = (
  request: LanguageWorkspaceDocumentRequest,
  analysis: LanguageAnalysis = emptyAnalysis(request.document),
  hostDiagnostics: readonly Diagnostic[] = [],
): LanguageWorkspaceAnalysisResult => ({ state: 'resolved', analysis, hostDiagnostics })

interface FakeWorkspace extends LanguageWorkspace {
  readonly opens: LanguageWorkspaceDocumentRequest[]
  readonly changes: LanguageWorkspaceDocumentRequest[]
  readonly closes: string[]
  readonly counts: { initialize: number; shutdown: number }
}

function fakeWorkspace(
  options: {
    readonly open?: (
      request: LanguageWorkspaceDocumentRequest,
    ) => Promise<LanguageWorkspaceAnalysisResult>
    readonly change?: (
      request: LanguageWorkspaceDocumentRequest,
    ) => Promise<LanguageWorkspaceAnalysisResult>
  } = {},
): FakeWorkspace {
  const opens: LanguageWorkspaceDocumentRequest[] = []
  const changes: LanguageWorkspaceDocumentRequest[] = []
  const closes: string[] = []
  const counts = { initialize: 0, shutdown: 0 }
  let current: LanguageWorkspaceAnalysisResult | undefined
  let analyzed = false
  return {
    opens,
    changes,
    closes,
    counts,
    async initialize() {
      counts.initialize += 1
    },
    async synchronize() {
      return { state: 'resolved', hostDiagnostics: [] }
    },
    async analyze(request) {
      if (!analyzed) {
        opens.push(request)
        current = await (options.open?.(request) ?? Promise.resolve(resolved(request)))
        analyzed = true
      } else {
        changes.push(request)
        current = await (options.change?.(request) ?? Promise.resolve(resolved(request)))
      }
      return current
    },
    async open(request) {
      opens.push(request)
      current = await (options.open?.(request) ?? Promise.resolve(resolved(request)))
      analyzed = true
      return current
    },
    async change(request) {
      changes.push(request)
      current = await (options.change?.(request) ?? Promise.resolve(resolved(request)))
      return current
    },
    async current() {
      return current
    },
    async capabilities() {
      return undefined
    },
    async completion() {
      return undefined
    },
    async hover() {
      return undefined
    },
    async signatureHelp() {
      return undefined
    },
    async definition() {
      return undefined
    },
    async references() {
      return undefined
    },
    async prepareRename() {
      return undefined
    },
    async rename() {
      return undefined
    },
    async formatting() {
      return undefined
    },
    async onTypeFormatting() {
      return undefined
    },
    async codeActions() {
      return undefined
    },
    async documentColors() {
      return undefined
    },
    async colorPresentations() {
      return undefined
    },
    async documentSymbols() {
      return undefined
    },
    async workspaceSymbols() {
      return undefined
    },
    async diagnostics() {
      return undefined
    },
    async close(uri) {
      closes.push(uri)
      current = undefined
      analyzed = false
    },
    async shutdown() {
      counts.shutdown += 1
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VS Code-free language session controller', () => {
  it('forwards document colours and presentations through the neutral workspace', async () => {
    const workspace = fakeWorkspace()
    const colors = vi.spyOn(workspace, 'documentColors').mockResolvedValue({
      colors: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
          color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
        },
      ],
      isIncomplete: false,
    })
    const presentations = vi.spyOn(workspace, 'colorPresentations').mockResolvedValue({
      presentations: [{ label: 'FF8000' }],
      isIncomplete: false,
    })
    const actions = vi.spyOn(workspace, 'codeActions').mockResolvedValue({
      actions: [{ title: 'Replace colour', disabledReason: 'fixture only' }],
      isIncomplete: false,
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
    })
    const document = editorDocument(1, 'FF8000')
    await controller.initialize()
    controller.open(document)
    await expect(controller.documentColors(document)).resolves.toMatchObject({
      colors: [expect.objectContaining({ color: { red: 1, green: 0.5, blue: 0, alpha: 1 } })],
    })
    await expect(
      controller.colorPresentations(
        document,
        { red: 1, green: 0.5, blue: 0, alpha: 1 },
        { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      ),
    ).resolves.toMatchObject({ presentations: [{ label: 'FF8000' }] })
    const actionRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
    await expect(
      controller.codeActions(document, actionRange, [
        {
          range: actionRange,
          severity: 'warning',
          message: 'fixture colour',
          code: 'fixture/colour',
        },
      ]),
    ).resolves.toMatchObject({ actions: [{ title: 'Replace colour' }] })
    expect(colors).toHaveBeenCalledWith(expect.objectContaining({ documentVersion: 1 }))
    expect(presentations).toHaveBeenCalledWith(
      expect.objectContaining({
        color: { red: 1, green: 0.5, blue: 0, alpha: 1 },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      }),
    )
    expect(actions).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersion: 1,
        range: actionRange,
        diagnostics: [expect.objectContaining({ code: 'fixture/colour' })],
        maxEdits: 4_096,
      }),
    )
    await controller.shutdown()
  })

  it('debounces and coalesces full snapshots by URI and version', async () => {
    vi.useFakeTimers()
    const workspace = fakeWorkspace()
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 25,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    await controller.initialize()
    controller.open(editorDocument(1, 'first'))
    controller.change(editorDocument(2, 'second'))
    controller.change(editorDocument(3, 'third'))
    expect(workspace.opens).toHaveLength(0)
    await vi.runAllTimersAsync()
    expect(workspace.opens).toHaveLength(1)
    expect(workspace.opens[0]?.document).toMatchObject({
      version: 3,
      text: 'third',
      languageId: 'fixture-language',
    })
    expect(workspace.changes).toHaveLength(0)
    expect(workspace.counts.initialize).toBe(1)
    await controller.shutdown()
  })

  it('hands the provider the dialect a game file association names', async () => {
    const workspace = fakeWorkspace()
    const controller = createLanguageSessionController({
      workspace,
      routes: [
        { languageId: 'lua', documentKind: 'lua-source', extension: 'scar', dialect: 'lua51' },
      ],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    controller.open(editorDocument(1, 'x = 1', { fileName: '/workspace/sample.scar' }))
    await vi.waitFor(() => expect(workspace.opens).toHaveLength(1))
    expect(workspace.opens[0]?.document).toMatchObject({ languageId: 'lua', dialect: 'lua51' })
    await controller.shutdown()
  })

  it('refuses an ambiguous extension mapping instead of guessing a provider route', async () => {
    const workspace = fakeWorkspace()
    const notices: { code: string }[] = []
    const controller = createLanguageSessionController({
      workspace,
      routes: [
        { languageId: 'one', extension: 'fixture' },
        { languageId: 'two', extension: 'fixture' },
      ],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
      reportNotice: notice => notices.push(notice),
    })
    await controller.initialize()
    controller.open(editorDocument(1))
    expect(await controller.documentSymbols(editorDocument(1))).toBeUndefined()
    expect(workspace.opens).toHaveLength(0)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ code: 'x3.app/vscode-language-route-ambiguous' })
    await controller.shutdown()
  })

  it('publishes document diagnostics separately from host diagnostics', async () => {
    const documentDiagnostic = {
      severity: 'warning' as const,
      message: 'fixture warning',
      code: 'fixture/warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    }
    const hostDiagnostic = diagnostic('information', 'fixture/host', 'host notice')
    const workspace = fakeWorkspace({
      open: request =>
        Promise.resolve(
          resolved(
            request,
            { ...emptyAnalysis(request.document), diagnostics: [documentDiagnostic] },
            [hostDiagnostic],
          ),
        ),
    })
    const documentPublications: (readonly unknown[])[] = []
    const hostPublications: (readonly Diagnostic[])[] = []
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: (_uri, items) => documentPublications.push(items),
      reportHostDiagnostics: (_uri, items) => hostPublications.push(items),
    })
    await controller.initialize()
    await controller.documentSymbols(editorDocument(1))
    expect(documentPublications).toEqual([[documentDiagnostic]])
    expect(hostPublications).toEqual([[hostDiagnostic]])
    await controller.shutdown()
  })

  it('publishes the provider semantic diagnostics after a document change', async () => {
    const analysisDiagnostic = {
      severity: 'warning' as const,
      message: 'syntax warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
    }
    const semanticDiagnostic = {
      severity: 'error' as const,
      message: "Function 'Missing' is not declared.",
      code: 'fixture/unresolved-call',
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 11 } },
    }
    const workspace = fakeWorkspace({
      open: request =>
        Promise.resolve(
          resolved(request, {
            ...emptyAnalysis(request.document),
            diagnostics: [analysisDiagnostic],
          }),
        ),
    })
    const diagnostics = vi.spyOn(workspace, 'diagnostics').mockResolvedValue({
      diagnostics: [semanticDiagnostic],
      isIncomplete: false,
    })
    const publications: (readonly unknown[])[] = []
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: (_uri, items) => publications.push(items),
    })
    await controller.initialize()
    await controller.documentSymbols(editorDocument(1))
    controller.change(editorDocument(2, 'let Missing = 1'))
    await controller.documentSymbols(editorDocument(2, 'let Missing = 1'))
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'file:///workspace/sample.fixture',
        documentVersion: 2,
        maxResults: 512,
        maxDocuments: 1_024,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(publications.at(-1)).toEqual([semanticDiagnostic])
    await controller.shutdown()
  })

  it('verifies the unsaved buffer and publishes semantic findings with incomplete status', async () => {
    const workspace = fakeWorkspace()
    const finding = {
      severity: 'error' as const,
      message: 'Unresolved live reference',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
    }
    vi.spyOn(workspace, 'diagnostics').mockResolvedValue({
      diagnostics: [finding],
      isIncomplete: true,
    })
    const publish = vi.fn()
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      publishDiagnostics: publish,
    })
    await controller.initialize()
    const buffer = editorDocument(7, 'Missing unsaved text')
    expect(controller.supports(buffer)).toBe(true)
    await expect(controller.verify(buffer)).resolves.toEqual({
      diagnostics: [finding],
      isIncomplete: true,
    })
    expect(workspace.opens[0]?.document.text).toBe(buffer.text)
    expect(publish).toHaveBeenLastCalledWith(buffer.uri, [finding])
    await controller.shutdown()
  })

  it('marks syntax-only verification incomplete when semantic diagnostics are unavailable', async () => {
    const workspace = fakeWorkspace()
    vi.spyOn(workspace, 'diagnostics').mockResolvedValue(undefined)
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    await expect(controller.verify(editorDocument(1))).resolves.toEqual({
      diagnostics: [],
      isIncomplete: true,
    })
    await controller.shutdown()
  })

  it('refuses stale verification before asking a provider to diagnose an older revision', async () => {
    const workspace = fakeWorkspace()
    const diagnostics = vi.spyOn(workspace, 'diagnostics')
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    await controller.documentSymbols(editorDocument(2, 'latest'))
    await expect(controller.verify(editorDocument(1, 'stale'))).rejects.toBeInstanceOf(
      OperationCancelledError,
    )
    expect(diagnostics).not.toHaveBeenCalled()
    await controller.shutdown()
  })

  it("answers a document's own trigger characters, not every language's", async () => {
    const controller = createLanguageSessionController({
      workspace: fakeWorkspace(),
      routes: [
        {
          ...ROUTE,
          completionTriggerCharacters: ['<', '"'],
          signatureHelpTriggerCharacters: ['('],
        },
        {
          languageId: 'strings',
          documentKind: 'strings-source',
          extension: 'txt',
          completionTriggerCharacters: [' ', ','],
        },
      ],
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    const fixture = editorDocument(1)
    // the space and comma of the strings language do not open this document's list
    expect(controller.triggerCharacters(fixture, 'completion')).toEqual(['<', '"'])
    expect(controller.triggerCharacters(fixture, 'signatureHelp')).toEqual(['('])
    const strings = editorDocument(1, '', { fileName: '/workspace/GameStrings.txt' })
    expect(controller.triggerCharacters(strings, 'completion')).toEqual([' ', ','])
    const other = editorDocument(1, '', { fileName: '/workspace/readme.unknown' })
    expect(controller.triggerCharacters(other, 'completion')).toBeUndefined()
    await controller.shutdown()
  })

  it('publishes semantic diagnostics when an editor first opens a document, before any edit', async () => {
    const semanticDiagnostic = {
      severity: 'error' as const,
      message: "Entity 'Missing' is not declared.",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
    }
    const workspace = fakeWorkspace()
    const diagnostics = vi.spyOn(workspace, 'diagnostics').mockResolvedValue({
      diagnostics: [semanticDiagnostic],
      isIncomplete: false,
    })
    const publications: (readonly unknown[])[] = []
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: (_uri, items) => publications.push(items),
    })
    await controller.initialize()
    controller.open(editorDocument(1))
    await vi.waitFor(() => expect(publications.at(-1)).toEqual([semanticDiagnostic]))
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ documentVersion: 1 }))
    await controller.shutdown()
  })

  it('does not verify unsupported or ambiguous document routes', async () => {
    const workspace = fakeWorkspace()
    const diagnostics = vi.spyOn(workspace, 'diagnostics')
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE, { ...ROUTE, languageId: 'other-language' }],
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    const ambiguous = editorDocument(1)
    const unsupported = editorDocument(1, 'hello', { fileName: '/workspace/readme.unknown' })
    for (const document of [ambiguous, unsupported]) {
      expect(controller.supports(document)).toBe(false)
      await expect(controller.verify(document)).resolves.toBeUndefined()
    }
    expect(diagnostics).not.toHaveBeenCalled()
    await controller.shutdown()
  })

  it.each(['change', 'close', 'cancel'] as const)(
    'does not publish an explicit verification after %s',
    async action => {
      const workspace = fakeWorkspace()
      const finding = {
        severity: 'error' as const,
        message: 'Stale finding',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      }
      let finish = (): void => undefined
      const diagnostics = vi.spyOn(workspace, 'diagnostics').mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = () => resolve({ diagnostics: [finding], isIncomplete: false })
          }),
      )
      const publish = vi.fn()
      const controller = createLanguageSessionController({
        workspace,
        routes: [ROUTE],
        debounceMs: 1000,
        publishDiagnostics: publish,
      })
      await controller.initialize()
      const buffer = editorDocument(1)
      const abort = new AbortController()
      const verifying = controller.verify(buffer, abort.signal)
      const rejected = expect(verifying).rejects.toBeInstanceOf(OperationCancelledError)
      await vi.waitFor(() => expect(diagnostics).toHaveBeenCalled())
      if (action === 'change') controller.change(editorDocument(2, 'fixed'))
      if (action === 'close') await controller.close(buffer.uri)
      if (action === 'cancel') abort.abort('cancelled')
      if (action === 'cancel') await rejected
      finish()
      await rejected
      expect(publish.mock.calls.some(([, items]) => items.includes(finding))).toBe(false)
      await controller.shutdown()
    },
  )

  it('does not make completion wait for semantic diagnostics after an edit', async () => {
    const workspace = fakeWorkspace()
    let finishDiagnostics = (): void => undefined
    const pendingDiagnostics = new Promise<{
      diagnostics: readonly []
      isIncomplete: boolean
    }>(resolve => {
      finishDiagnostics = () => resolve({ diagnostics: [], isIncomplete: false })
    })
    const diagnostics = vi.spyOn(workspace, 'diagnostics').mockReturnValue(pendingDiagnostics)
    const completion = vi.spyOn(workspace, 'completion').mockResolvedValue({
      items: [{ label: 'Catalog', kind: 'class' }],
      isIncomplete: true,
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      semanticDiagnosticsDelayMs: 25,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    await controller.documentSymbols(editorDocument(1))
    const edited = editorDocument(2, '<')
    controller.change(edited)

    await expect(controller.completion(edited, { line: 0, character: 1 })).resolves.toMatchObject({
      items: [{ label: 'Catalog' }],
    })
    expect(diagnostics).not.toHaveBeenCalled()
    expect(workspace.changes).toHaveLength(0)
    expect(completion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersion: 2,
        semanticContextPolicy: 'cached',
      }),
    )

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(workspace.changes.map(request => request.document.version)).toEqual([2])
    expect(diagnostics).toHaveBeenCalled()
    finishDiagnostics()
    await controller.shutdown()
  })

  it('maps UTF-16 positions directly, recurses symbols, and splits multiline tokens', async () => {
    const document = editorDocument(1, 'a😀\nxyz')
    const workspace = fakeWorkspace({
      open: request =>
        Promise.resolve(
          resolved(request, {
            ...emptyAnalysis(request.document),
            tokens: [
              {
                kind: 'string',
                range: { start: { line: 0, character: 1 }, end: { line: 1, character: 2 } },
                modifiers: ['documentation', 'provider-specific'],
              },
            ],
            symbols: [
              {
                name: 'Outer',
                kind: 'struct',
                range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } },
                selectionRange: {
                  start: { line: 0, character: 1 },
                  end: { line: 0, character: 3 },
                },
                children: [
                  {
                    name: 'inner',
                    kind: 'field',
                    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
                    selectionRange: {
                      start: { line: 1, character: 0 },
                      end: { line: 1, character: 3 },
                    },
                  },
                ],
              },
            ],
          }),
        ),
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    expect(await controller.semanticTokens(document)).toEqual([
      {
        line: 0,
        character: 1,
        length: 2,
        tokenType: 'string',
        modifiers: ['documentation'],
      },
      {
        line: 1,
        character: 0,
        length: 2,
        tokenType: 'string',
        modifiers: ['documentation'],
      },
    ])
    expect(await controller.documentSymbols(document)).toEqual([
      expect.objectContaining({
        name: 'Outer',
        selectionRange: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 3 },
        },
        children: [expect.objectContaining({ name: 'inner' })],
      }),
    ])
    await controller.shutdown()
  })

  it('forwards semantic requests as exact versioned bounded workspace calls', async () => {
    const workspace = fakeWorkspace()
    const completion = vi.spyOn(workspace, 'completion').mockResolvedValue({
      items: [{ label: 'FixtureNative', kind: 'function' }],
      isIncomplete: false,
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    await expect(
      controller.completion(editorDocument(4), { line: 0, character: 3 }),
    ).resolves.toEqual({
      items: [{ label: 'FixtureNative', kind: 'function' }],
      isIncomplete: false,
    })
    expect(completion).toHaveBeenCalledWith({
      uri: 'file:///workspace/sample.fixture',
      documentVersion: 4,
      position: { line: 0, character: 3 },
      maxResults: 512,
      maxDocuments: 1_024,
      semanticContextPolicy: 'cached',
    })
    const formatting = vi.spyOn(workspace, 'formatting').mockResolvedValue({
      edits: [],
      isComplete: true,
    })
    await expect(
      controller.formatting(editorDocument(4), { tabSize: 2, insertSpaces: true }),
    ).resolves.toEqual({ edits: [], isComplete: true })
    expect(formatting).toHaveBeenCalledWith({
      uri: 'file:///workspace/sample.fixture',
      documentVersion: 4,
      options: { tabSize: 2, insertSpaces: true },
      maxResults: 512,
      maxDocuments: 1_024,
    })
    const onTypeFormatting = vi.spyOn(workspace, 'onTypeFormatting').mockResolvedValue({
      edits: [
        {
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 3 },
          },
          newText: '""',
        },
      ],
      isComplete: true,
      cursor: { line: 0, character: 4 },
      requestCompletion: true,
    })
    await expect(
      controller.onTypeFormatting(editorDocument(4), { line: 0, character: 3 }, '=', {
        tabSize: 2,
        insertSpaces: true,
      }),
    ).resolves.toMatchObject({
      edits: [{ newText: '""' }],
      cursor: { line: 0, character: 4 },
      requestCompletion: true,
    })
    expect(onTypeFormatting).toHaveBeenCalledWith({
      uri: 'file:///workspace/sample.fixture',
      documentVersion: 4,
      position: { line: 0, character: 3 },
      ch: '=',
      options: { tabSize: 2, insertSpaces: true },
      maxResults: 512,
      maxDocuments: 1_024,
      semanticContextPolicy: 'cached',
    })
    await controller.shutdown()
  })

  it('never publishes a result for the wrong URI or version', async () => {
    const publications: (readonly unknown[])[] = []
    const workspace = fakeWorkspace({
      open: request =>
        Promise.resolve(
          resolved(request, {
            ...emptyAnalysis(request.document),
            documentUri: 'file:///workspace/wrong.fixture',
            documentVersion: request.document.version - 1,
            diagnostics: [
              {
                severity: 'error',
                message: 'must not publish',
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 1 },
                },
              },
            ],
          }),
        ),
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: (_uri, diagnostics) => publications.push(diagnostics),
    })
    await controller.initialize()
    expect(await controller.documentSymbols(editorDocument(1))).toBeUndefined()
    expect(publications).toEqual([])
    await controller.shutdown()
  })

  it('propagates caller cancellation and aborts in-flight provider work', async () => {
    let observedSignal: AbortSignal | undefined
    const workspace = fakeWorkspace({
      open: request => {
        observedSignal = request.signal
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new OperationCancelledError(request.signal?.reason)),
            { once: true },
          )
        })
      },
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
    })
    await controller.initialize()
    const abort = new AbortController()
    const pending = controller.documentSymbols(editorDocument(1), abort.signal)
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    abort.abort('editor cancelled request')
    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError)
    expect(observedSignal?.aborted).toBe(true)
    await controller.shutdown()
  })

  it('reopens after a failed initial analysis and shuts down idempotently', async () => {
    let attempt = 0
    const notices: string[] = []
    const workspace = fakeWorkspace({
      open: request => {
        attempt += 1
        if (attempt === 1) {
          return Promise.reject(
            new ModkitError({ code: 'x3.host/language-provider-failed', message: 'boom' }),
          )
        }
        return Promise.resolve(resolved(request))
      },
    })
    const controller = createLanguageSessionController({
      workspace,
      routes: [ROUTE],
      debounceMs: 0,
      publishDiagnostics: () => undefined,
      reportNotice: notice => notices.push(notice.code),
    })
    await controller.initialize()
    controller.open(editorDocument(1))
    await vi.waitFor(() => expect(notices).toEqual(['x3.host/language-provider-failed']))
    await controller.documentSymbols(editorDocument(2, 'fixed'))
    expect(workspace.opens.map(request => request.document.version)).toEqual([1, 2])
    await controller.shutdown()
    await controller.shutdown()
    expect(workspace.counts.shutdown).toBe(1)
  })
})
