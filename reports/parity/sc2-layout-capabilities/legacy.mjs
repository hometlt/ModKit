// Execute pinned MK2 capability metadata and the unmodified workspace diagnostics provider.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { kitFile, loadPinned } from '../lib/kit.mjs'
import { projectDiagnostics } from './projection.mjs'

export async function prepareOracle({ operation, corpus }) {
  const loaderFiles = [
    fileURLToPath(import.meta.url),
    fileURLToPath(new URL('./projection.mjs', import.meta.url)),
    kitFile,
  ]
  const root = 'extensions/blizzard/starcraft-2/codecs/sc2-layout/src/language'
  const loaded = []
  for (const entry of [
    `${root}/capabilities.ts`,
    `${root}/providers/diagnostics.ts`,
    'packages/layouts-processing/src/sc2-layout-core/index.ts',
    'packages/layouts-processing/bundled-schema.js',
  ])
    loaded.push(
      await loadPinned(entry, {
        operation,
        corpus,
        loaderFiles,
        additionalFiles: entry.endsWith('bundled-schema.js')
          ? ['packages/layouts-processing/generated/sc2layout-schema-data.json']
          : [],
        runtimeDependencies: [
          { name: 'vscode-languageserver' },
          { name: 'vscode-uri' },
          { name: 'fast-xml-parser' },
        ],
        operationOptions: {
          execution:
            'MK2 capabilities and DiagnosticsProvider.analyzeWorkspace; synthetic archive membership, no archive I/O; normalize Markdown keys for the oracle OS',
        },
      }),
    )
  const [capabilities, diagnostics, core, schema] = loaded.map(item => item.module)
  const { URI } = createRequire(import.meta.url)('vscode-uri')
  const invoke = async input => {
    if (input.kind === 'capabilities') {
      const value = capabilities.LAYOUT_CAPABILITIES
      return {
        textDocumentSync: value.textDocumentSync,
        documentSymbols: value.documentSymbolProvider,
        workspaceSymbols: value.workspaceSymbolProvider,
        completionTriggerCharacters: value.completionProvider.triggerCharacters,
        definition: value.definitionProvider,
        hover: value.hoverProvider,
        references: value.referencesProvider,
        colors: value.colorProvider,
        verifyWorkspace: value.executeCommandProvider.commands.includes(
          'sc2layout.analyzeWorkspace',
        ),
      }
    }
    const archiveUri = URI.file('C:/MKTEMP/parity-layout-workspace/')
    const archive = {
      name: 'Synthetic.SC2Mod',
      directory: archiveUri.fsPath.replace(/[\\/]$/u, ''),
      uri: archiveUri,
      native: false,
    }
    const workspace = new core.BasicLayoutWorkspace()
    await workspace.addArchive(archive)
    const schemaData = schema.default
    const store = new core.Store(
      core.createRegistry({
        ...schemaData,
        mdStorage: Object.fromEntries(
          Object.entries(schemaData.mdStorage).map(([key, value]) => [path.normalize(key), value]),
        ),
      }),
      workspace,
    )
    for (const [file, text] of Object.entries(input.files))
      store.updateDocument(`${archive.uri.toString()}${file}`, text, 1)
    const provider = new diagnostics.DiagnosticsProvider()
    provider.init(
      {
        errHandler: ({ err }) => {
          throw err
        },
      },
      store,
    )
    const result = provider.analyzeWorkspace()
    const documents = Object.keys(input.files).map(file => ({
      uri: `${archive.uri.toString()}${file}`,
      diagnostics: [],
    }))
    for (const item of result.diagnostics)
      documents.find(document => document.uri === item.uri).diagnostics.push(item)
    return {
      filesProcessed: result.filesProcessed,
      isIncomplete: false,
      documents: projectDiagnostics(documents),
    }
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
