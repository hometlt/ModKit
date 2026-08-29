import { ModkitError, OperationCancelledError, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import type { LanguageAnalysis, LanguageDocument } from '@modkitx-x3/sdk/language'
import type {
  LanguageWorkspace,
  LanguageWorkspaceAnalysisResult,
  LanguageWorkspaceDocumentRequest,
} from '@modkitx-x3/host/language'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createLanguageSessionController,
  type EditorLanguageDocument,
} from '../src/language-session.js'

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
  return {
    opens,
    changes,
    closes,
    counts,
    async initialize() {
      counts.initialize += 1
    },
    async open(request) {
      opens.push(request)
      current = await (options.open?.(request) ?? Promise.resolve(resolved(request)))
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
      maxDocuments: 64,
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
      maxDocuments: 64,
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
