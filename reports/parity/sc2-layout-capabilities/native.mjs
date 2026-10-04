// Published MK3 LSP, including common projectDiagnostics over files that have never been opened.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { workspace } from '../lib/kit.mjs'
import { startServer } from '../sc2-language/lsp-client.mjs'
import { projectDiagnostics } from './projection.mjs'

export async function prepareMigrated({ operation }) {
  const lspMain = path.join(workspace, 'modkit-core/apps/lsp/dist/main.js')
  const extension = path.join(workspace, '.acceptance/modkit-extensions-blizzard/starcraft2')
  const manifestFile = path.join(extension, 'modules/layout/providers/language/provider.json')
  const facet = JSON.parse(await readFile(manifestFile)).spec.provides[0].facet
  const servers = []
  const invoke = async input => {
    const root = await mkdtemp('C:/MKTEMP/modkit-layout-capability-parity-')
    const layouts = path.join(root, 'Synthetic.SC2Mod/Base.SC2Data/UI/Layout')
    await mkdir(layouts, { recursive: true })
    for (const [file, text] of Object.entries(input.files))
      await writeFile(path.join(layouts, file), text)
    const server = startServer(process.execPath, [
      lspMain,
      '--root',
      root,
      '--extension',
      extension,
    ])
    servers.push(server)
    const request = async (method, params) => {
      const answer = await server.request(method, params)
      if (answer.error !== undefined)
        throw new Error(`${method}: ${JSON.stringify(answer.error)}\n${server.stderr()}`)
      return answer.result
    }
    const initialized = await request('initialize', {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {},
    })
    server.notify('initialized', {})
    const uri = pathToFileURL(path.join(layouts, 'Open.SC2Layout')).href
    server.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'sc2-layout',
        version: 1,
        text: input.files['Open.SC2Layout'],
      },
    })
    await request('textDocument/documentSymbol', { textDocument: { uri } })
    if (input.kind === 'capabilities') {
      for (const trigger of facet.completionTriggerCharacters)
        assert(initialized.capabilities.completionProvider.triggerCharacters.includes(trigger))
      const actual = await request('modkit/languageCapabilities', { textDocument: { uri } })
      const features = new Set(actual.features)
      const project = await request('modkit/projectDiagnostics', { textDocument: { uri } })
      assert.equal(project.isIncomplete, false, 'Capability probe needs a complete workspace')
      return {
        textDocumentSync: {
          change: initialized.capabilities.textDocumentSync.change,
          openClose: initialized.capabilities.textDocumentSync.openClose,
        },
        documentSymbols: features.has('document-symbols'),
        workspaceSymbols: features.has('workspace-symbols'),
        completionTriggerCharacters: facet.completionTriggerCharacters,
        definition: features.has('definition'),
        hover: features.has('hover'),
        references: features.has('references'),
        colors: features.has('document-colors'),
        verifyWorkspace: features.has('diagnostics') && project !== undefined,
      }
    }
    const closed = await request('modkit/projectDiagnostics', { textDocument: { uri } })
    const opened = await request('workspace/diagnostic', { previousResultIds: [] })
    const documents = [
      ...closed.documents,
      ...opened.items.map(item => ({ uri: item.uri, diagnostics: item.items })),
    ]
    assert.equal(
      documents.length,
      Object.keys(input.files).length,
      'All open and closed layout documents must be verified',
    )
    return {
      filesProcessed: documents.length,
      isIncomplete: closed.isIncomplete,
      documents: projectDiagnostics(documents),
    }
  }
  const files = [
    fileURLToPath(import.meta.url),
    fileURLToPath(new URL('./projection.mjs', import.meta.url)),
    fileURLToPath(new URL('../sc2-language/lsp-client.mjs', import.meta.url)),
    lspMain,
    path.join(workspace, 'modkit-core/packages/host/dist/language/workspace.js'),
    manifestFile,
    path.join(extension, 'modules/layout/providers/language/runtime.js'),
  ]
  const artifacts = await Promise.all(
    files.map(async file => ({
      file,
      sha256: createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    })),
  )
  return {
    module: { [operation]: invoke },
    evidence: {
      transport:
        'public modkit-lsp stdio; Layout route capability discovery and common projectDiagnostics plus open-document pull diagnostics',
      adaptation:
        'MK2 sc2layout.analyzeWorkspace is exposed through MK3 common Verify Mod, not a second game-specific command',
      artifacts,
    },
    release: async () => {
      for (const server of servers) await server.close()
    },
  }
}
