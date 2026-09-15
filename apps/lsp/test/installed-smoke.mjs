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
const sheet = join(root, 'FontStyles.SC2Style')
const sheetText = '<StyleFile>\n<Style name="Title" textcolor="ffcc00"/>\n</StyleFile>\n'
const catalog = join(root, 'GameStrings.txt')
const catalogText = 'Unit/Name/Marine=<s val="Title">Marine</s>\n'
await Promise.all([writeFile(sheet, sheetText), writeFile(catalog, catalogText)])
const scene = join(root, 'Main.SC2Cutscene')
const sceneText =
  '<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.300000">\n' +
  '  <CCutsceneNodeFolder guid="200" name="Includes" referenceFile="Other.SC2Cutscene" referenceGuid="300"/>\n' +
  '</CutsceneState>\n'
const otherScene = join(root, 'Other.SC2Cutscene')
const otherSceneText =
  '<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.300000">\n' +
  '  <CCutsceneNodeCamera guid="300" name="Other Camera"/>\n</CutsceneState>\n'
await Promise.all([writeFile(scene, sceneText), writeFile(otherScene, otherSceneText)])

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
  assert.ok(semantic.result.data.length >= 5, 'SC2 Bank must publish semantic tokens')
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

  // SC2 Style: a second language through the same generic routing, reaching into an open catalog.
  const sheetUri = pathToFileURL(sheet).href
  const catalogUri = pathToFileURL(catalog).href
  for (const [documentUri, languageId, text] of [
    [sheetUri, 'sc2-style', sheetText],
    [catalogUri, 'sc2-strings', catalogText],
  ]) {
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: { textDocument: { uri: documentUri, languageId, version: 1, text } },
    })
  }
  send({
    jsonrpc: '2.0',
    id: 9,
    method: 'modkit/languageCapabilities',
    params: { textDocument: { uri: sheetUri } },
  })
  const styleCapabilities = await waitFor(message => message.id === 9, 'style capabilities')
  assert.equal(styleCapabilities.error, undefined, JSON.stringify(styleCapabilities.error))
  for (const feature of ['definition', 'references', 'rename', 'document-colors', 'semantic-tokens']) {
    assert.ok(
      styleCapabilities.result.features.includes(feature),
      `missing style feature ${feature}`,
    )
  }
  send({
    jsonrpc: '2.0',
    id: 10,
    method: 'textDocument/references',
    params: {
      textDocument: { uri: sheetUri },
      position: { line: 1, character: '<Style name="'.length + 1 },
      context: { includeDeclaration: false },
    },
  })
  const styleReferences = await waitFor(message => message.id === 10, 'style references')
  assert.equal(styleReferences.error, undefined, JSON.stringify(styleReferences.error))
  assert.deepEqual(
    styleReferences.result.map(location => location.uri),
    [catalogUri],
    'SC2 Style references must reach the open SC2 Strings catalog',
  )
  send({
    jsonrpc: '2.0',
    id: 11,
    method: 'textDocument/documentColor',
    params: { textDocument: { uri: sheetUri } },
  })
  const styleColors = await waitFor(message => message.id === 11, 'style colors')
  assert.equal(styleColors.error, undefined, JSON.stringify(styleColors.error))
  assert.equal(styleColors.result.length, 1, 'SC2 Style must publish one literal colour swatch')
  send({
    jsonrpc: '2.0',
    id: 12,
    method: 'textDocument/semanticTokens/full',
    params: { textDocument: { uri: sheetUri } },
  })
  const styleTokens = await waitFor(message => message.id === 12, 'style semantic tokens')
  assert.equal(styleTokens.error, undefined, JSON.stringify(styleTokens.error))
  assert.ok(styleTokens.result.data.length >= 5 * 5, 'SC2 Style must publish semantic tokens')

  // SC2 Cutscene: the generic adapter replaces the removed module CLI, including an include jump.
  const sceneUri = pathToFileURL(scene).href
  const otherSceneUri = pathToFileURL(otherScene).href
  for (const [documentUri, text] of [
    [sceneUri, sceneText],
    [otherSceneUri, otherSceneText],
  ]) {
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: { textDocument: { uri: documentUri, languageId: 'sc2-cutscene', version: 1, text } },
    })
  }
  send({
    jsonrpc: '2.0',
    id: 13,
    method: 'modkit/languageCapabilities',
    params: { textDocument: { uri: sceneUri } },
  })
  const sceneCapabilities = await waitFor(message => message.id === 13, 'cutscene capabilities')
  assert.equal(sceneCapabilities.error, undefined, JSON.stringify(sceneCapabilities.error))
  for (const feature of ['definition', 'references', 'rename', 'semantic-tokens']) {
    assert.ok(
      sceneCapabilities.result.features.includes(feature),
      `missing cutscene feature ${feature}`,
    )
  }
  const referenceLine = sceneText.split('\n')[2]
  send({
    jsonrpc: '2.0',
    id: 14,
    method: 'textDocument/definition',
    params: {
      textDocument: { uri: sceneUri },
      position: { line: 2, character: referenceLine.indexOf('referenceGuid="300"') + 'referenceGuid="'.length + 1 },
    },
  })
  const sceneDefinition = await waitFor(message => message.id === 14, 'cutscene definition')
  assert.equal(sceneDefinition.error, undefined, JSON.stringify(sceneDefinition.error))
  const definitionUris = (Array.isArray(sceneDefinition.result) ? sceneDefinition.result : [sceneDefinition.result])
    .filter(Boolean)
    .map(location => location.uri ?? location.targetUri)
  assert.deepEqual(definitionUris, [otherSceneUri], 'SC2 Cutscene referenceGuid must reach the included scene')
  send({
    jsonrpc: '2.0',
    id: 15,
    method: 'textDocument/semanticTokens/full',
    params: { textDocument: { uri: sceneUri } },
  })
  const sceneTokens = await waitFor(message => message.id === 15, 'cutscene semantic tokens')
  assert.equal(sceneTokens.error, undefined, JSON.stringify(sceneTokens.error))
  assert.ok(sceneTokens.result.data.length >= 5, 'SC2 Cutscene must publish semantic tokens')

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
    `installed LSP smoke passed: sc2-bank, sc2-style, sc2-cutscene; diagnostics=${diagnostics.params.diagnostics.length}; symbols=${symbols.result.length}; styleTokens=${styleTokens.result.data.length / 5}\n`,
  )
} finally {
  if (child.exitCode === null) child.kill()
  await rm(root, { recursive: true, force: true })
}
