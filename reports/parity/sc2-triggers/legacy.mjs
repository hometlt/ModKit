// Pinned MK2 sc2-triggers oracle: the legacy codec session plus the exact @modkitx/triggers exports.
import { fileURLToPath } from 'node:url'
import { caseBytes, caseName, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { DISABLED_VERBS, project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-triggers/src'
const decoder = new TextDecoder('utf-8', { fatal: false })
const SESSION = new Set(['view.inspect', 'script.symbols', 'script.references', 'asset.validate', 'asset.search',
  'export.convert', 'edit.content', 'disabled-verbs', 'content-scripts'])

export async function prepareOracle({ operation, corpus }) {
  const load = (entry, execution, extra = {}) =>
    loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-triggers-parity-v1', execution },
      ...extra,
    })
  const [codecLoaded, coreLoaded, detectLoaded, assetsLoaded] = await Promise.all([
    load(`${root}/codec.ts`, 'pinned-Sc2TriggersCodec', { runtimeDependencies: [{ name: 'xml2js' }] }),
    load(`${root}/core/index.ts`, 'pinned-triggers-core', { runtimeDependencies: [{ name: 'xml2js' }] }),
    load(`${root}/detect.ts`, 'pinned-detectSc2Triggers'),
    load('packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'),
  ])
  const core = coreLoaded.module
  const assets = assetsLoaded.module
  const plainCodec = codecLoaded.module.createSc2TriggersCodec()
  // A permissive catalog makes edit.content available, as a coordinating mod catalog would.
  const catalogCodec = codecLoaded.module.createSc2TriggersCodec({ catalogContext: { hasEntity: () => true } })
  const source = (bytes, name) => assets.createMemoryAssetSource(bytes, { path: name, name })

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    const name = caseName(input)
    const text = decoder.decode(bytes)
    if (SESSION.has(probe)) {
      const codec = probe === 'edit.content' ? catalogCodec : plainCodec
      const document = await codec.open(source(bytes, name), {})
      const descriptor = await codec.describe(document, {})
      const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source', 'write-source', 'write-workspace'] })
      const call = (id, request) => session.invoke(`sc2-triggers.${id}`, request)
      try {
        switch (probe) {
          case 'view.inspect': return project(probe, { legacy: await call('view.inspect') })
          case 'script.symbols': return project(probe, { legacy: await call('script.symbols') })
          case 'script.references': return project(probe, { legacy: await call('script.references', input.target) })
          case 'asset.validate': return project(probe, { legacy: await call('asset.validate') })
          case 'asset.search': return project(probe, { legacy: await call('asset.search', { query: input.query, ...(input.types ? { types: input.types } : {}) }) })
          case 'export.convert': {
            const output = await call('export.convert')
            return project(probe, { value: input.part === 'header' ? output.header : output.script })
          }
          case 'edit.content': {
            const plan = await call('edit.content', { renames: input.renames })
            const patched = plan.summary.triggerLinksPatched
            return project(probe, { value: { patched, output: patched > 0 ? plan.edits[0].text : null } })
          }
          case 'disabled-verbs': {
            const rows = Object.fromEntries(DISABLED_VERBS.map(id => {
              const row = descriptor.operations.find(item => item.id === id)
              return [id, row?.state ?? 'absent']
            }))
            const compile = descriptor.operations.find(item => item.id === 'script.compile')
            return project(probe, { value: { rows, compileOwner: /sc2[- ]runtime/iu.test(compile?.reason?.message ?? '') ? 'sc2-runtime' : null } })
          }
          case 'content-scripts': {
            const trait = descriptor.traits.find(item => item.id === 'content.scripts')
            return project(probe, { value: trait === undefined ? null : { blocks: trait.parameters.blocks } })
          }
        }
      } finally { await session.dispose() }
    }
    switch (probe) {
      case 'detect':
        return project(probe, { value: await detectLoaded.module.detectSc2Triggers(source(bytes, name), {}) })
      case 'sax-read':
      case 'sax-read-strings': {
        const strings = input.strings === undefined ? undefined : decoder.decode(await caseBytes(resolveInput({ f: input.strings }, corpus)))
        return project(probe, { value: await core.readTriggerLibraryFast(text, strings) })
      }
      case 'xml2js-read':
        return project(probe, { value: await core.readTriggerLibrary(text) })
      case 'source-index':
        return project(probe, { value: core.scanTriggerSource(text, { sourcePath: name }) })
      case 'trigger-strings':
        return project(probe, { value: core.parseTriggerStrings(text) })
      case 'to-engine': {
        const { library } = await core.readTriggerLibraryFast(text)
        return project(probe, { value: core.triggerLibrariesToEngineProgram([library], { fileName: name, nativeLibraries: [], includeRawFallbacks: true }) })
      }
      case 'g2t': {
        const script = decoder.decode(await caseBytes(resolveInput({ f: input.script }, corpus)))
        const header = input.header === undefined ? '' : decoder.decode(await caseBytes(resolveInput({ f: input.header }, corpus)))
        core.resetGalaxyToTriggerIdCounter()
        const library = core.convertGalaxyToTriggerLibrary(
          core.parseGalaxySource(script, `Lib${input.libraryId}.galaxy`),
          core.parseGalaxySource(header, `Lib${input.libraryId}_h.galaxy`),
          { libraryId: input.libraryId },
        )
        return project(probe, { legacy: library })
      }
    }
    throw new Error(`unknown sc2-triggers probe: ${probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: [codecLoaded.evidence, coreLoaded.evidence, detectLoaded.evidence, assetsLoaded.evidence] },
  }
}
