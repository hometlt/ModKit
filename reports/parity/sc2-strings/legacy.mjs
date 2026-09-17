// Pinned MK2 sc2-strings oracle: the legacy codec session and the exact @modkitx/xml line model.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-strings/src'
export const pathOf = input => input.install ?? input.fixture ?? input.name

export async function prepareOracle({ operation, corpus }) {
  const load = (entry, execution) =>
    loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-strings-parity-v1', execution },
    })
  const [codecLoaded, xmlLoaded, assetsLoaded] = await Promise.all([
    load(`${root}/codec.ts`, 'pinned-Sc2StringsCodec'),
    load('packages/xml/src/index.ts', 'pinned-xml-line-model'),
    load('packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'),
  ])
  const codec = codecLoaded.module.createSc2StringsCodec()
  const xml = xmlLoaded.module
  const source = async input => assetsLoaded.module.createMemoryAssetSource(await caseBytes(input), { path: pathOf(input) })

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    if (probe === 'parse') {
      const model = xml.parseSc2StringsOrdered(await caseBytes(input))
      return project(probe, { value: { model, serialized: xml.serializeStringModel(model) } })
    }
    const sources = [await source(input)]
    if (input.other !== undefined) sources.push(await source(resolveInput({ f: input.other }, corpus)))
    const document = sources.length === 1 ? await codec.open(sources[0], {}) : await codec.openLocaleSet(sources, {})
    const descriptor = await codec.describe(document, {})
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source', 'write-source', 'write-workspace'] })
    const call = (id, request) => session.invoke(`sc2-strings.${id}`, request)
    try {
      switch (probe) {
        case 'view.inspect': return project(probe, { legacy: await call('view.inspect', {}) })
        case 'asset.validate': return project(probe, { legacy: await call('asset.validate') })
        case 'references': return project(probe, { value: await call('sc2-strings.references', input.key === undefined ? {} : { key: input.key }) })
        case 'export.convert': return project(probe, { value: await call('export.convert', {}) })
        case 'export.entries': return project(probe, { value: await call('export.convert', { format: 'entries' }) })
        case 'edit.content':
          await call('edit.content', input.edit)
          return project(probe, { value: await call('export.convert', {}) })
        case 'compare-locales': {
          const other = document.locales[1]
          return project(probe, { value: await call('asset.compare', { targetLocale: other.locale ?? other.localeToken }) })
        }
        case 'resolve-fallback': {
          const result = await call('sc2-strings.resolve-fallback', { key: input.key })
          return project(probe, { value: { key: result.key, value: result.value ?? null, fromPrimary: result.fromPrimary } })
        }
      }
    } finally { await session.dispose() }
    throw new Error(`unknown sc2-strings probe: ${probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: [codecLoaded.evidence, xmlLoaded.evidence, assetsLoaded.evidence] },
  }
}
