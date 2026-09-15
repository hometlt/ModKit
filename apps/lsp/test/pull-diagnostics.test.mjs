import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { join, resolve } from 'node:path'

const executable = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const extension = fileURLToPath(
  new URL('../../mcp/test/fixtures/language-session-extension', import.meta.url),
)

test(
  'installed LSP serves versioned full and unchanged pull diagnostics',
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'modkit-lsp-pull-'))
    const source = join(root, 'Main.fixturelang')
    await writeFile(source, 'initial')
    const child = spawn(
      process.execPath,
      [
        executable,
        '--root',
        root,
        '--extension',
        extension,
        '--max-document-bytes',
        '64',
        '--max-workspace-bytes',
        '128',
      ],
      {
        cwd: resolve('.'),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let buffer = Buffer.alloc(0)
    let stderr = ''
    const messages = []
    const waiters = []
    const dispatch = message => {
      messages.push(message)
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(message)) continue
        waiters.splice(waiters.indexOf(waiter), 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
    }
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        const match = /Content-Length: (\d+)/iu.exec(
          buffer.subarray(0, headerEnd).toString('ascii'),
        )
        if (match === null) throw new Error('invalid LSP header')
        const end = headerEnd + 4 + Number(match[1])
        if (buffer.length < end) return
        dispatch(JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8')))
        buffer = buffer.subarray(end)
      }
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    const send = message => {
      const body = Buffer.from(JSON.stringify(message))
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
      child.stdin.write(body)
    }
    const waitFor = (predicate, label) => {
      const existing = messages.find(predicate)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolveWait, reject) => {
        const waiter = {
          predicate,
          resolve: resolveWait,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1)
            reject(new Error(`timed out waiting for ${label}; stderr=${stderr}`))
          }, 30_000),
        }
        waiters.push(waiter)
      })
    }
    try {
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          processId: process.pid,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
          },
        },
      })
      const initialized = await waitFor(message => message.id === 1, 'initialize')
      assert.equal(initialized.error, undefined, JSON.stringify(initialized.error))
      assert.equal(initialized.result.capabilities.diagnosticProvider.identifier, 'modkit')
      send({ jsonrpc: '2.0', method: 'initialized', params: {} })
      const watchedFilesRegistration = await waitFor(
        message => message.method === 'client/registerCapability',
        'watched-files registration',
      )
      assert.deepEqual(
        watchedFilesRegistration.params.registrations.map(registration => registration.method),
        ['workspace/didChangeWatchedFiles'],
      )
      assert.deepEqual(watchedFilesRegistration.params.registrations[0].registerOptions.watchers, [
        { globPattern: { baseUri: pathToFileURL(root).href, pattern: '**/*' } },
      ])
      send({ jsonrpc: '2.0', id: watchedFilesRegistration.id, result: null })
      const uri = pathToFileURL(source).href
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri, languageId: 'fixture-language', version: 1, text: 'initial' },
        },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' && message.params?.version === 1,
        'initial push diagnostics',
      )
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/diagnostic',
        params: { textDocument: { uri } },
      })
      const first = await waitFor(message => message.id === 2, 'full pull diagnostics')
      assert.equal(first.result.kind, 'full')
      assert.ok(typeof first.result.resultId === 'string')
      assert.deepEqual(first.result.items, [])
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/diagnostic',
        params: { textDocument: { uri }, previousResultId: first.result.resultId },
      })
      const unchanged = await waitFor(message => message.id === 3, 'unchanged pull diagnostics')
      assert.deepEqual(unchanged.result, { kind: 'unchanged', resultId: first.result.resultId })
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: 'invalid' }],
        },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' && message.params?.version === 2,
        'changed push diagnostics',
      )
      send({
        jsonrpc: '2.0',
        id: 4,
        method: 'textDocument/diagnostic',
        params: { textDocument: { uri }, previousResultId: first.result.resultId },
      })
      const changed = await waitFor(message => message.id === 4, 'changed pull diagnostics')
      assert.equal(changed.result.kind, 'full')
      assert.notEqual(changed.result.resultId, first.result.resultId)
      assert.equal(changed.result.items[0]?.code, 'fixture/invalid')
      const exact = '\ufeffA😀Bpadding\r\nline'
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 3 },
          contentChanges: [{ text: exact }],
        },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' && message.params?.version === 3,
        'UTF-16 source diagnostics',
      )
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 4 },
          contentChanges: [
            {
              range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
              text: 'Ω',
            },
          ],
        },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' && message.params?.version === 4,
        'UTF-16 incremental diagnostics',
      )
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 3 },
          contentChanges: [{ text: 'stale' }],
        },
      })
      send({
        jsonrpc: '2.0',
        id: 5,
        method: 'textDocument/hover',
        params: { textDocument: { uri }, position: { line: 0, character: 4 } },
      })
      const hover = await waitFor(message => message.id === 5, 'hover after stale change')
      assert.equal(hover.error, undefined, JSON.stringify(hover.error))
      assert.equal(hover.result.contents.value, 'version 4: \ufeffAΩBpadding\r\nline')
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri, version: 5 },
          contentChanges: [{ text: 'x'.repeat(65) }],
        },
      })
      const oversizedChange = await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params?.uri === uri &&
          message.params?.diagnostics?.[0]?.code === 'x3.lsp/document-too-large',
        'oversized change diagnostics',
      )
      assert.equal(oversizedChange.params.version, 4)
      send({
        jsonrpc: '2.0',
        id: 6,
        method: 'textDocument/hover',
        params: { textDocument: { uri }, position: { line: 0, character: 4 } },
      })
      const retainedHover = await waitFor(
        message => message.id === 6,
        'hover after rejected change',
      )
      assert.equal(retainedHover.error, undefined, JSON.stringify(retainedHover.error))
      assert.equal(retainedHover.result.contents.value, 'version 4: \ufeffAΩBpadding\r\nline')

      const virtualUri = 'content-source://fixture/dependency/Other.fixturelang'
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: virtualUri,
            languageId: 'fixture-language',
            version: 1,
            text: 'virtual',
          },
        },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params?.uri === virtualUri &&
          message.params?.version === 1,
        'virtual document diagnostics',
      )
      send({
        jsonrpc: '2.0',
        id: 7,
        method: 'textDocument/hover',
        params: { textDocument: { uri: virtualUri }, position: { line: 0, character: 0 } },
      })
      const virtualHover = await waitFor(message => message.id === 7, 'virtual document hover')
      assert.equal(virtualHover.error, undefined, JSON.stringify(virtualHover.error))
      assert.equal(virtualHover.result.contents.value, 'version 1: virtual')

      const virtualPushesBeforeWatch = messages.filter(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params?.uri === virtualUri,
      ).length
      send({
        jsonrpc: '2.0',
        method: 'workspace/didChangeWatchedFiles',
        params: { changes: [{ uri, type: 2 }] },
      })
      await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params?.uri === virtualUri &&
          messages.filter(
            candidate =>
              candidate.method === 'textDocument/publishDiagnostics' &&
              candidate.params?.uri === virtualUri,
          ).length > virtualPushesBeforeWatch,
        'virtual document refresh after watched-file change',
      )

      const oversizedUri = 'untitled:Oversized.fixturelang'
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: oversizedUri,
            languageId: 'fixture-language',
            version: 1,
            text: 'x'.repeat(65),
          },
        },
      })
      const oversizedOpen = await waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params?.uri === oversizedUri &&
          message.params?.diagnostics?.[0]?.code === 'x3.lsp/document-too-large',
        'oversized open diagnostics',
      )
      assert.equal(oversizedOpen.params.version, 1)

      send({
        jsonrpc: '2.0',
        id: 8,
        method: 'textDocument/documentSymbol',
        params: { textDocument: { uri } },
      })
      const symbols = await waitFor(message => message.id === 8, 'analysis-backed symbols')
      assert.equal(symbols.error, undefined, JSON.stringify(symbols.error))
      assert.equal(symbols.result[0]?.name, 'fixture')

      send({ jsonrpc: '2.0', id: 9, method: 'shutdown', params: null })
      await waitFor(message => message.id === 9, 'shutdown')
      send({ jsonrpc: '2.0', method: 'exit', params: null })
      child.stdin.end()
      await new Promise((resolveExit, reject) => {
        child.once('exit', code =>
          code === 0 ? resolveExit() : reject(new Error(`LSP exited ${code}; stderr=${stderr}`)),
        )
      })
    } finally {
      if (child.exitCode === null) child.kill()
      await rm(root, { recursive: true, force: true })
    }
  },
)
