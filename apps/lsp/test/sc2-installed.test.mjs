/**
 * The built `modkit-lsp` bin over the StarCraft II directory extension: the MK2 language parity
 * methods for Galaxy, GameData and GameStrings, including a cross-file Galaxy dependency the
 * client never opened (it arrives through the host-owned filesystem snapshot).
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startLanguageServer } from './lsp-client.mjs'

const extension = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'modkit-extensions-blizzard',
  'starcraft2',
)

const MAIN = 'include "Lib"\nvoid Init() {\n    int x = Helper(2);\n}\n'
const LIB = 'int Helper(int amount) {\n    return amount;\n}\n'
const DATA =
  '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <CUnit id="Marine">\n' +
  '        <LifeMax value="45"/>\n    </CUnit>\n    <CUnit id="Hero" parent="Marine"/>\n</Catalog>\n'
const STRINGS = 'Unit/Name/Marine=Marine\nUnit/Name/Hero=Hero\n'

test(
  'installed LSP serves SC2 Galaxy, GameData and GameStrings with MK2 parity methods',
  { timeout: 300_000, skip: existsSync(extension) ? false : `missing ${extension}` },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'modkit-lsp-sc2-'))
    const base = join(root, 'Probe.SC2Mod', 'Base.SC2Data')
    const locale = join(root, 'Probe.SC2Mod', 'enUS.SC2Data', 'LocalizedData')
    await mkdir(join(base, 'GameData'), { recursive: true })
    await mkdir(locale, { recursive: true })
    const paths = {
      main: join(base, 'MapScript.galaxy'),
      lib: join(base, 'Lib.galaxy'),
      data: join(base, 'GameData', 'UnitData.xml'),
      strings: join(locale, 'GameStrings.txt'),
    }
    await Promise.all([
      writeFile(paths.main, MAIN),
      writeFile(paths.lib, LIB),
      writeFile(paths.data, DATA),
      writeFile(paths.strings, STRINGS),
    ])
    const uri = key => pathToFileURL(paths[key]).href
    const server = startLanguageServer(['--root', root, '--extension', extension], {
      timeoutMs: 120_000,
    })
    const ok = async (method, params) => {
      const answer = await server.request(method, params)
      assert.equal(answer.error, undefined, `${method}: ${JSON.stringify(answer.error)}`)
      return answer.result
    }
    const open = (key, languageId, text, version = 1) =>
      server.notify('textDocument/didOpen', {
        textDocument: { uri: uri(key), languageId, version, text },
      })
    const at = (key, line, character) => ({
      textDocument: { uri: uri(key) },
      position: { line, character },
    })
    try {
      const initialized = await ok('initialize', {
        processId: null,
        rootUri: pathToFileURL(root).href,
        capabilities: {},
      })
      for (const provider of [
        'completionProvider',
        'hoverProvider',
        'definitionProvider',
        'referencesProvider',
        'renameProvider',
        'documentFormattingProvider',
        'documentSymbolProvider',
        'workspaceSymbolProvider',
        'diagnosticProvider',
      ]) {
        assert.ok(initialized.capabilities[provider], `missing ${provider}`)
      }
      server.notify('initialized', {})

      // Galaxy: only MapScript is opened; Lib.galaxy comes from the host workspace snapshot.
      open('main', 'galaxy', MAIN)
      const galaxy = await ok('modkit/languageCapabilities', { textDocument: { uri: uri('main') } })
      assert.ok(galaxy, 'Galaxy provider did not resolve')
      for (const feature of [
        'completion',
        'hover',
        'definition',
        'references',
        'rename',
        'formatting',
      ]) {
        assert.ok(galaxy.features.includes(feature), `Galaxy lacks ${feature}`)
      }
      const definition = await ok('textDocument/definition', at('main', 2, 13))
      assert.deepEqual(
        definition.map(item => item.uri),
        [uri('lib')],
        'Helper must resolve into the unopened Lib.galaxy dependency',
      )
      const hover = await ok('textDocument/hover', at('main', 2, 13))
      assert.match(hover.contents.value, /int Helper\(int amount\)/u)
      const completion = await ok('textDocument/completion', at('main', 2, 14))
      assert.ok(completion.items.some(item => item.label === 'Helper'))
      const pulled = await ok('textDocument/diagnostic', { textDocument: { uri: uri('main') } })
      assert.equal(pulled.kind, 'full')
      const symbols = await ok('textDocument/documentSymbol', {
        textDocument: { uri: uri('main') },
      })
      assert.ok(symbols.some(symbol => symbol.name === 'Init'))
      const formatted = await ok('textDocument/formatting', {
        textDocument: { uri: uri('main') },
        options: { tabSize: 4, insertSpaces: true },
      })
      assert.ok(Array.isArray(formatted))

      // GameData.
      // Renames need a complete writable snapshot: read-only dependencies and ambiguous
      // .xml/.txt files keep it partial, so every workspace file is opened from here on.
      open('lib', 'galaxy', LIB)
      open('data', 'sc2-data', DATA)
      open('strings', 'sc2-strings', STRINGS)
      const dataHover = await ok('textDocument/hover', at('data', 3, 10))
      assert.match(dataHover.contents.value, /LifeMax/u)
      const parent = await ok('textDocument/definition', at('data', 5, 30))
      assert.deepEqual(
        parent.map(item => [item.uri, item.range.start.line]),
        [[uri('data'), 2]],
      )
      const dataReferences = await ok('textDocument/references', {
        ...at('data', 2, 19),
        context: { includeDeclaration: true },
      })
      assert.equal(dataReferences.length, 2)
      const fields = await ok('textDocument/completion', at('data', 3, 9))
      assert.ok(fields.items.length > 0)
      const dataRename = await ok('textDocument/rename', {
        ...at('data', 2, 19),
        newName: 'Trooper',
      })
      assert.equal(dataRename.documentChanges.length, 1)
      assert.equal(dataRename.documentChanges[0].edits.length, 2)

      // GameStrings.
      const stringHover = await ok('textDocument/hover', at('strings', 0, 12))
      assert.match(stringHover.contents.value, /Unit\/Name\/Marine/u)
      const stringDefinition = await ok('textDocument/definition', at('strings', 0, 12))
      assert.equal(stringDefinition[0].uri, uri('strings'))
      const stringRename = await ok('textDocument/rename', {
        ...at('strings', 0, 12),
        newName: 'Unit/Name/Trooper',
      })
      assert.equal(stringRename.documentChanges[0].edits[0].newText, 'Unit/Name/Trooper')
      // GameStrings has no formatter: the answer says so instead of returning no edits.
      const noFormatter = await server.request('textDocument/formatting', {
        textDocument: { uri: uri('strings') },
        options: { tabSize: 4, insertSpaces: true },
      })
      assert.equal(noFormatter.error?.data?.code, 'x3.lsp/feature-unsupported')

      // With every workspace file open the snapshot is complete, so rename may touch both files.
      const references = await ok('textDocument/references', {
        ...at('lib', 0, 6),
        context: { includeDeclaration: true },
      })
      assert.deepEqual(
        [...new Set(references.map(item => item.uri))].sort(),
        [uri('lib'), uri('main')].sort(),
      )
      const galaxyRename = await ok('textDocument/rename', {
        ...at('lib', 0, 6),
        newName: 'Assist',
      })
      assert.deepEqual(
        galaxyRename.documentChanges.map(change => change.textDocument.uri).sort(),
        [uri('lib'), uri('main')].sort(),
      )

      // Workspace symbols reach every open language, not just the first document.
      const workspaceSymbols = await ok('workspace/symbol', { query: 'Helper' })
      assert.ok(
        workspaceSymbols.some(item => item.name === 'Helper' && item.location.uri === uri('lib')),
      )

      // Change, save, cancel and close.
      server.notify('textDocument/didChange', {
        textDocument: { uri: uri('main'), version: 2 },
        contentChanges: [
          {
            range: { start: { line: 2, character: 12 }, end: { line: 2, character: 18 } },
            text: 'Missing',
          },
        ],
      })
      const changed = await ok('textDocument/diagnostic', { textDocument: { uri: uri('main') } })
      assert.equal(changed.kind, 'full')
      assert.notEqual(changed.resultId, pulled.resultId)
      server.notify('textDocument/didSave', {
        textDocument: { uri: uri('main') },
        text: MAIN.replace('Helper', 'Missing'),
      })
      const cancelledId = server.nextId()
      server.send({
        jsonrpc: '2.0',
        id: cancelledId,
        method: 'textDocument/hover',
        params: at('main', 2, 13),
      })
      server.notify('$/cancelRequest', { id: cancelledId })
      const cancelled = await server.waitFor(
        message => message.id === cancelledId,
        'cancelled hover',
      )
      assert.ok(
        cancelled.error?.code === -32800 || 'result' in cancelled,
        `cancellation must end the request: ${JSON.stringify(cancelled)}`,
      )
      server.notify('textDocument/didClose', { textDocument: { uri: uri('main') } })
      await server.waitFor(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params.uri === uri('main') &&
          message.params.diagnostics.length === 0,
        'cleared diagnostics on close',
      )
      assert.equal(await server.shutdown(), 0)
    } finally {
      server.child.kill()
      await rm(root, { recursive: true, force: true })
    }
  },
)
