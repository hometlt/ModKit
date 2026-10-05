import assert from 'node:assert/strict'
import test from 'node:test'
import { createModkitLanguageServer } from '../dist/server.js'

const noop = () => undefined
const disposable = () => ({ dispose: noop })
const token = { isCancellationRequested: false, onCancellationRequested: disposable }
const uri = 'untitled:Main.fixturelang'

function harness({
  withCompletion = false,
  blockDiagnostics = false,
  blockCompletion = false,
} = {}) {
  const handlers = new Map()
  const calls = []
  const current = new Map()
  const publications = []
  const diagnosticRequests = []
  let diagnosticEntered
  const diagnosticsStarted = new Promise(resolve => {
    diagnosticEntered = resolve
  })
  let releaseDiagnostics
  const diagnosticGate = new Promise(resolve => {
    releaseDiagnostics = resolve
  })
  let completionEntered
  const completionStarted = new Promise(resolve => {
    completionEntered = resolve
  })
  let releaseCompletion
  const completionGate = new Promise(resolve => {
    releaseCompletion = resolve
  })
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  const connection = new Proxy(
    {
      console: { error: message => calls.push(['error', message]), warn: noop },
      languages: {
        diagnostics: { on: handler => handlers.set('diagnostic', handler) },
        inlayHint: { on: handler => handlers.set('inlayHint', handler) },
      },
      sendDiagnostics: value => publications.push(value),
      listen: noop,
      dispose: noop,
    },
    {
      get(target, name) {
        return (
          target[name] ??
          ((...args) => {
            handlers.set(name === 'onRequest' ? args[0] : name, args.at(-1))
            return disposable()
          })
        )
      },
    },
  )
  const analyze = async (kind, request) => {
    const { document } = request
    calls.push([kind, document.uri, document.version, document.text])
    if (kind === 'open' && calls.length === 1) await gate
    const value = {
      state: 'resolved',
      hostDiagnostics: [],
      analysis: { diagnostics: [], tokens: [], symbols: [] },
    }
    current.set(document.uri, value)
    return value
  }
  const workspace = {
    open: request => analyze('open', request),
    change: request => analyze('change', request),
    synchronize: request => analyze(current.has(request.document.uri) ? 'change' : 'open', request),
    analyze: async () => ({
      state: 'resolved',
      hostDiagnostics: [],
      analysis: { diagnostics: [], tokens: [], symbols: [] },
    }),
    diagnostics: async request => {
      const text = calls
        .filter(call => call[1] === request.uri && ['open', 'change'].includes(call[0]))
        .at(-1)[3]
      diagnosticRequests.push(request)
      diagnosticEntered()
      if (blockDiagnostics && diagnosticRequests.length === 1) await diagnosticGate
      return {
        diagnostics: blockDiagnostics
          ? [
              {
                code: text,
                message: text,
                severity: 'error',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              },
            ]
          : [],
        isIncomplete: false,
      }
    },
    capabilities: async uri =>
      current.has(uri)
        ? { features: ['hover', 'workspace-symbols', 'code-lenses', ...(withCompletion ? ['completion'] : [])] }
        : undefined,
    completion: async request => {
      completionEntered()
      if (blockCompletion) await completionGate
      calls.push([
        'completion',
        request.documentVersion,
        request.semanticContextPolicy,
        request.signal.aborted,
      ])
      if (blockDiagnostics) calls.push(['completion-documents', [...current.keys()]])
      return { items: [], isIncomplete: false }
    },
    hover: async request => ({ markdown: String(request.documentVersion) }),
    codeLenses: async request => {
      calls.push(['code-lenses-budget', request.maxResults])
      const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
      return {
        lenses: Array.from({ length: Math.min(3_000, request.maxResults) }, (_, index) => ({
          range, title: `Card ${index}`, command: { kind: 'open-subject', subjectId: `Fixture/${index}`, view: 'card' },
        })), isIncomplete: request.maxResults < 3_000,
      }
    },
    workspaceSymbols: async () => ({ symbols: [], isIncomplete: false }),
    close: async uri => {
      calls.push(['close', uri])
      current.delete(uri)
    },
    shutdown: async () => {
      calls.push(['shutdown'])
      current.clear()
    },
  }
  const server = createModkitLanguageServer({
    connection,
    workspace,
    roots: [],
    routes: [],
    maxDocuments: 4,
    maxDocumentBytes: 1024,
    maxWorkspaceBytes: 4096,
  })
  server.listen()
  return {
    calls,
    release,
    diagnosticsStarted,
    releaseDiagnostics,
    diagnosticRequests,
    publications,
    completionStarted,
    releaseCompletion,
    server,
    open(version, text, documentUri = uri) {
      handlers.get('onDidOpenTextDocument')({
        textDocument: { uri: documentUri, languageId: 'fixture-language', version, text },
      })
    },
    change(version, text, documentUri = uri) {
      handlers.get('onDidChangeTextDocument')({
        textDocument: { uri: documentUri, version },
        contentChanges: [{ text }],
      })
    },
    close() {
      handlers.get('onDidCloseTextDocument')({ textDocument: { uri } })
    },
    request(method, params, requestToken = token) {
      return handlers.get(method)(params, requestToken)
    },
  }
}

test('document projections keep the last lens beyond the interactive result limit', async () => {
  const h = harness()
  h.open(1, 'one')
  h.release()
  try {
    const lenses = await h.request('onCodeLens', { textDocument: { uri } })
    assert.equal(lenses.length, 3_000)
    assert.equal(lenses.at(-1).command.arguments[0].subjectId, 'Fixture/2999')
    assert.ok(h.calls.some(call => call[0] === 'code-lenses-budget' && call[1] === 65_536))
  } finally {
    await h.server.close()
  }
})

test('queued notifications retain their own text/version and close before reopening', async () => {
  const h = harness()
  h.open(1, 'one')
  h.change(2, 'two')
  h.change(3, 'three')
  h.close()
  h.open(1, 'reopened')
  h.release()
  try {
    const result = await h.request('onHover', {
      textDocument: { uri },
      position: { line: 0, character: 0 },
    })
    assert.equal(result.contents.value, '1')
    assert.deepEqual(h.calls, [
      ['open', uri, 1, 'one'],
      ['change', uri, 2, 'two'],
      ['change', uri, 3, 'three'],
      ['close', uri],
      ['open', uri, 1, 'reopened'],
    ])
  } finally {
    await h.server.close()
  }
})

test('completion sees all queued document versions while diagnostics remain blocked', async () => {
  const h = harness({ withCompletion: true, blockDiagnostics: true })
  const other = 'untitled:Other.fixturelang'
  h.open(1, 'one')
  h.release()
  await h.diagnosticsStarted
  h.open(1, 'other', other)
  h.change(2, 'two')
  const completion = h.request('onCompletion', {
    textDocument: { uri },
    position: { line: 0, character: 1 },
  })
  try {
    const answer = await Promise.race([
      completion,
      new Promise(resolve => setImmediate(() => resolve('blocked'))),
    ])
    assert.deepEqual(answer, { items: [], isIncomplete: false })
    assert.ok(h.calls.some(call => call[0] === 'completion' && call[1] === 2))
    assert.deepEqual(h.calls.at(-1), ['completion-documents', [uri, other]])
    assert.equal(h.diagnosticRequests[0].signal.aborted, true)
  } finally {
    h.releaseDiagnostics()
    await completion
    await h.server.close()
  }
})

test('diagnostics from a closed document never overwrite its reopened version', async () => {
  const h = harness({ withCompletion: true, blockDiagnostics: true })
  h.open(1, 'old incarnation')
  h.release()
  await h.diagnosticsStarted
  h.close()
  h.open(1, 'new incarnation')
  const completion = h.request('onCompletion', {
    textDocument: { uri },
    position: { line: 0, character: 1 },
  })
  try {
    assert.deepEqual(
      await Promise.race([
        completion,
        new Promise(resolve => setImmediate(() => resolve('blocked'))),
      ]),
      { items: [], isIncomplete: false },
    )
    h.releaseDiagnostics()
    const report = await h.request('diagnostic', { textDocument: { uri } })
    assert.equal(report.items[0].code, 'new incarnation')
    assert.equal(
      h.publications.some(item =>
        item.diagnostics.some(diagnostic => diagnostic.code === 'old incarnation'),
      ),
      false,
    )
  } finally {
    h.releaseDiagnostics()
    await completion
    await h.server.close()
  }
})

test('a change refreshes diagnostics of other synchronized documents', async () => {
  const h = harness()
  const other = 'untitled:Other.fixturelang'
  h.open(1, 'one')
  h.open(1, 'other', other)
  h.release()
  try {
    await h.request('workspace/diagnostic', { previousResultIds: [] })
    const before = h.diagnosticRequests.filter(request => request.uri === other).length
    h.change(2, 'two')
    const report = await h.request('workspace/diagnostic', { previousResultIds: [] })
    assert.equal(h.diagnosticRequests.filter(request => request.uri === other).length, before + 1)
    assert.deepEqual(
      report.items.map(item => [item.uri, item.version]),
      [
        [uri, 2],
        [other, 1],
      ],
    )
  } finally {
    await h.server.close()
  }
})

test('pull cancellation does not wait for or cancel shared background diagnostics', async () => {
  const h = harness({ blockDiagnostics: true })
  h.open(1, 'one')
  h.release()
  await h.diagnosticsStarted
  let cancel
  const cancellation = {
    isCancellationRequested: false,
    onCancellationRequested: callback => {
      cancel = callback
      return disposable()
    },
  }
  try {
    const report = h.request('diagnostic', { textDocument: { uri } }, cancellation)
    cancel()
    await assert.rejects(report, { code: -32800 })
    assert.equal(h.diagnosticRequests[0].signal.aborted, false)
    h.releaseDiagnostics()
    assert.equal((await h.request('diagnostic', { textDocument: { uri } })).items[0].code, 'one')
  } finally {
    h.releaseDiagnostics()
    await h.server.close()
  }
})

test('shutdown cancels and drains background work before releasing the workspace', async () => {
  const h = harness({ blockDiagnostics: true })
  h.open(1, 'one')
  h.release()
  await h.diagnosticsStarted
  const shutdown = h.request('onShutdown')
  assert.equal(h.diagnosticRequests[0].signal.aborted, true)
  assert.equal(
    h.calls.some(call => call[0] === 'shutdown'),
    false,
  )
  h.releaseDiagnostics()
  await shutdown
  assert.equal(h.calls.at(-1)[0], 'shutdown')
  assert.equal(h.publications.length, 0)
})

test('background diagnostics wait until a long interactive request finishes', async () => {
  const h = harness({ withCompletion: true, blockCompletion: true })
  h.open(1, 'one')
  h.release()
  const completion = h.request('onCompletion', {
    textDocument: { uri },
    position: { line: 0, character: 1 },
  })
  await h.completionStarted
  try {
    await new Promise(resolve => setTimeout(resolve, 225))
    assert.equal(h.diagnosticRequests.length, 0)
    // An automatic pull must also leave the interactive request ahead of analysis.
    const diagnostics = h.request('diagnostic', { textDocument: { uri } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.diagnosticRequests.length, 0)
    h.releaseCompletion()
    await completion
    await diagnostics
    assert.equal(h.diagnosticRequests.length, 1)
  } finally {
    h.releaseCompletion()
    await completion
    await h.server.close()
  }
})

test('workspace diagnostics wait for pending opens before enumerating documents', async () => {
  const h = harness()
  h.open(1, 'one')
  const result = h.request('workspace/diagnostic', { previousResultIds: [] })
  h.release()
  try {
    assert.deepEqual(
      (await result).items.map(item => [item.uri, item.version]),
      [[uri, 1]],
    )
  } finally {
    await h.server.close()
  }
})

test('shutdown drains pending document work before releasing the workspace', async () => {
  const h = harness()
  h.open(1, 'one')
  const shutdown = h.request('onShutdown')
  h.release()
  await shutdown
  assert.deepEqual(
    h.calls.map(call => call[0]),
    ['open', 'shutdown'],
  )
})

test('interactive LSP completion selects cached context after the queued document version', async () => {
  const h = harness({ withCompletion: true })
  h.open(1, 'one')
  h.change(2, 'two')
  h.release()
  try {
    assert.deepEqual(
      await h.request('onCompletion', {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      }),
      { items: [], isIncomplete: false },
    )
    assert.deepEqual(h.calls.at(-1), ['completion', 2, 'cached', false])
  } finally {
    await h.server.close()
  }
})
