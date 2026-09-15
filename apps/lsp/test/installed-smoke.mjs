import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const extension = process.argv[2]
if (extension === undefined)
  throw new Error('Usage: installed-smoke.mjs <absolute-extension-directory>')

const root = await mkdtemp(join(tmpdir(), 'modkit-lsp-installed-'))
const source = join(root, 'Accounts.SC2Bank')
const sourceText = '<?xml version="1.0" encoding="utf-8"?><Bank><Section name="Test"/></Bank>'
await writeFile(source, sourceText)

const executable = fileURLToPath(new URL('../dist/main.js', import.meta.url))
const child = spawn(
  process.execPath,
  [executable, '--root', root, '--extension', resolve(extension)],
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
  for (const waiter of [...waiters])
    if (waiter.predicate(message)) {
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
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const match = /Content-Length: (\d+)/iu.exec(header)
    if (match === null) throw new Error(`invalid LSP header: ${header}`)
    const length = Number(match[1])
    const end = headerEnd + 4 + length
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
      reject,
      timer: setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1)
        reject(new Error(`timed out waiting for ${label}; stderr=${stderr}`))
      }, 60_000),
    }
    waiters.push(waiter)
  })
}
child.once('exit', code => {
  for (const waiter of waiters.splice(0)) {
    clearTimeout(waiter.timer)
    waiter.reject?.(new Error(`LSP exited ${code} while waiting; stderr=${stderr}`))
  }
})

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} },
  })
  const initialized = await waitFor(message => message.id === 1, 'initialize response')
  assert.equal(initialized.error, undefined, JSON.stringify(initialized.error))
  assert.deepEqual(initialized.result.capabilities.semanticTokensProvider.full, { delta: true })
  assert.deepEqual(initialized.result.capabilities.diagnosticProvider, {
    identifier: 'modkit',
    interFileDependencies: true,
    workspaceDiagnostics: true,
  })
  send({ jsonrpc: '2.0', method: 'initialized', params: {} })
  const uri = pathToFileURL(source).href
  send({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: {
        uri,
        languageId: 'sc2-bank',
        version: 1,
        text: sourceText,
      },
    },
  })
  const diagnostics = await waitFor(
    message => message.method === 'textDocument/publishDiagnostics' && message.params?.uri === uri,
    'bank diagnostics',
  )
  assert.ok(Array.isArray(diagnostics.params.diagnostics))
  send({
    jsonrpc: '2.0',
    id: 6,
    method: 'modkit/languageCapabilities',
    params: { textDocument: { uri } },
  })
  const capabilities = await waitFor(message => message.id === 6, 'bank capabilities')
  assert.equal(capabilities.error, undefined, JSON.stringify(capabilities.error))
  for (const feature of ['definition', 'references', 'prepare-rename', 'rename']) {
    assert.ok(capabilities.result.features.includes(feature), `missing bank feature ${feature}`)
  }
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'textDocument/diagnostic',
    params: { textDocument: { uri } },
  })
  const pulled = await waitFor(message => message.id === 5, 'pull diagnostics')
  assert.equal(pulled.error, undefined, JSON.stringify(pulled.error))
  assert.equal(pulled.result.kind, 'full')
  assert.ok(Array.isArray(pulled.result.items))
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'textDocument/documentSymbol',
    params: { textDocument: { uri } },
  })
  const symbols = await waitFor(message => message.id === 2, 'document symbols')
  assert.equal(
    symbols.error,
    undefined,
    `${JSON.stringify(symbols.error)} diagnostics=${JSON.stringify(diagnostics.params.diagnostics)} stderr=${stderr}`,
  )
  assert.ok(Array.isArray(symbols.result))
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'textDocument/semanticTokens/full',
    params: { textDocument: { uri } },
  })
  const semantic = await waitFor(message => message.id === 3, 'semantic tokens')
  assert.equal(semantic.error, undefined, JSON.stringify(semantic.error))
  assert.ok(Array.isArray(semantic.result.data))
  const position = { line: 0, character: sourceText.indexOf('Test') + 1 }
  send({
    jsonrpc: '2.0',
    id: 7,
    method: 'textDocument/prepareRename',
    params: { textDocument: { uri }, position },
  })
  const prepared = await waitFor(message => message.id === 7, 'prepare bank rename')
  assert.equal(prepared.error, undefined, JSON.stringify(prepared.error))
  assert.equal(prepared.result.placeholder, 'Test')
  send({
    jsonrpc: '2.0',
    id: 8,
    method: 'textDocument/rename',
    params: { textDocument: { uri }, position, newName: 'Progress' },
  })
  const renamed = await waitFor(message => message.id === 8, 'bank rename')
  assert.equal(renamed.error, undefined, JSON.stringify(renamed.error))
  assert.equal(renamed.result.documentChanges[0].edits[0].newText, 'Progress')
  send({ jsonrpc: '2.0', id: 4, method: 'shutdown', params: null })
  await waitFor(message => message.id === 4, 'shutdown response')
  send({ jsonrpc: '2.0', method: 'exit', params: null })
  child.stdin.end()
  await new Promise((resolveExit, reject) => {
    child.once('exit', code =>
      code === 0 ? resolveExit() : reject(new Error(`LSP exited ${code}; stderr=${stderr}`)),
    )
  })
  process.stdout.write(
    `installed LSP smoke passed: sc2-bank; diagnostics=${diagnostics.params.diagnostics.length}; symbols=${symbols.result.length}\n`,
  )
} finally {
  if (child.exitCode === null) child.kill()
  await rm(root, { recursive: true, force: true })
}
