import assert from 'node:assert/strict'
import test from 'node:test'
import { createModkitLanguageServer } from '../dist/server.js'

const noop = () => undefined
const disposable = () => ({ dispose: noop })
const token = { isCancellationRequested: false, onCancellationRequested: disposable }
const uri = 'untitled:Main.fixturelang'

function harness({ withCompletion = false } = {}) {
  const handlers = new Map()
  const calls = []
  const current = new Map()
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
      sendDiagnostics: noop,
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
    diagnostics: async () => ({ diagnostics: [], isIncomplete: false }),
    capabilities: async uri =>
      current.has(uri)
        ? { features: ['hover', 'workspace-symbols', ...(withCompletion ? ['completion'] : [])] }
        : undefined,
    completion: async request => {
      calls.push([
        'completion',
        request.documentVersion,
        request.semanticContextPolicy,
        request.signal.aborted,
      ])
      return { items: [], isIncomplete: false }
    },
    hover: async request => ({ markdown: String(request.documentVersion) }),
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
    server,
    open(version, text, documentUri = uri) {
      handlers.get('onDidOpenTextDocument')({
        textDocument: { uri: documentUri, languageId: 'fixture-language', version, text },
      })
    },
    change(version, text) {
      handlers.get('onDidChangeTextDocument')({
        textDocument: { uri, version },
        contentChanges: [{ text }],
      })
    },
    close() {
      handlers.get('onDidCloseTextDocument')({ textDocument: { uri } })
    },
    request(method, params) {
      return handlers.get(method)(params, token)
    },
  }
}

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
