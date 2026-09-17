// Pinned MK2 Galaxy oracle: the legacy codec session plus the exact @modkitx/galaxy exports.
import { fileURLToPath } from 'node:url'
import { caseBytes, caseName, resolveInput, kitFile, loadPinned } from '../lib/kit.mjs'
import { project, workspaceProbe } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/galaxy/src'
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function prepareOracle({ operation, corpus }) {
  const load = (entry, execution) =>
    loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'galaxy-parity-v1', execution },
    })
  const [codecLoaded, coreLoaded, langLoaded, assetsLoaded] = await Promise.all([
    load(`${root}/codec.ts`, 'pinned-GalaxyScriptCodec'),
    load(`${root}/core/index.ts`, 'pinned-galaxy-core'),
    load(`${root}/language-core/index.ts`, 'pinned-galaxy-language-core'),
    load('packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'),
  ])
  const core = coreLoaded.module
  const lang = langLoaded.module
  const codec = codecLoaded.module.createGalaxyScriptCodec()

  const session = async (bytes, name) => {
    const source = assetsLoaded.module.createMemoryAssetSource(bytes, { path: name, name })
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    const opened = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source', 'write-source'] })
    return { document, descriptor, opened }
  }

  const typeCheck = (text, name) => {
    const source = new lang.Parser().parseFile(name, text)
    const host = { documents: new Map(), qualifiedDocuments: new Map(), resolveGlobalSymbol: () => undefined }
    lang.bindSourceFile(source, host)
    return new lang.TypeChecker(host).checkSourceFile(source, true) ?? []
  }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    if (probe === 'workspace') {
      const files = await Promise.all(input.files.map(async index => {
        const file = resolveInput({ f: index }, corpus)
        return { name: caseName(file), text: decoder.decode(await caseBytes(file)) }
      }))
      return project(probe, { value: { store: workspaceProbe(new core.GalaxyStore(), files, input), index: workspaceProbe(new core.GalaxyWorkspaceIndex(), files, input) } })
    }
    const bytes = await caseBytes(input)
    const name = caseName(input)
    const text = decoder.decode(bytes)
    if (['view.inspect', 'script.symbols', 'script.references', 'asset.validate', 'script.completion',
      'script.format', 'edit.structure', 'export.convert', 'script.compile'].includes(probe)) {
      const { descriptor, opened } = await session(bytes, name)
      try {
        const handler = id => `galaxy.${id}`
        const call = (id, request) => opened.invoke(handler(id), request)
        switch (probe) {
          case 'view.inspect': return project(probe, { legacy: await call('view.inspect') })
          case 'script.symbols': return project(probe, { legacy: await call('script.symbols') })
          case 'script.references': return project(probe, { value: await call('script.references', { offset: input.offset }) })
          case 'asset.validate': return project(probe, { legacy: await call('asset.validate') })
          case 'script.completion': return project(probe, { value: await call('script.completion', { offset: input.offset }) })
          case 'script.format': return project(probe, { text: await call('script.format', input.options ?? {}) })
          case 'edit.structure': return project(probe, { text, legacy: await call('edit.structure', { offset: input.offset, newName: input.newName }) })
          case 'export.convert': return project(probe, { text: await call('export.convert') })
          case 'script.compile': return project(probe, { legacy: descriptor.operations.find(item => item.id === 'script.compile') })
        }
      } finally { await opened.dispose?.() }
    }
    switch (probe) {
      case 'analyze-script': return project(probe, { value: core.analyzeGalaxyScript(name, text) })
      case 'language-index': return project(probe, { value: core.analyzeGalaxyLanguage(text, name) })
      case 'type-check': return project(probe, { legacy: typeCheck(text, name) })
      case 'to-engine': return project(probe, {
        value: core.galaxySourceToEngineProgram(core.parseGalaxySource(text, { fileName: name }), { moduleId: name, includeRawFallbacks: true }),
      })
      case 'language-at': return project(probe, {
        value: {
          hover: core.galaxyHoverAt(text, input.offset, name) ?? null,
          definition: core.galaxyDefinitionAt(text, input.offset, name) ?? null,
          signature: core.galaxySignatureAt(text, input.offset, name) ?? null,
          word: core.galaxyWordAt(text, input.offset) ?? null,
        },
      })
    }
    throw new Error(`unknown galaxy probe: ${probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: [codecLoaded.evidence, coreLoaded.evidence, langLoaded.evidence, assetsLoaded.evidence] },
  }
}
