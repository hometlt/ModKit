// Pinned MK2 sc2-layout oracle: legacy codec session, @modkitx/layouts-processing core and bundled
// schema, and the codec's rendering pipeline.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { drive, project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-layout/src'
const decoder = new TextDecoder('utf-8', { fatal: true })
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`, 'u')
export const uriOf = input => `file:///parity/${input.install ?? input.fixture ?? input.name}`

export async function prepareOracle({ operation, corpus }) {
  const load = (entry, execution, extra = {}) =>
    loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-layout-parity-v1', execution },
      ...extra,
    })
  const layoutDeps = { runtimeDependencies: [{ name: 'fast-xml-parser' }] }
  // Sequential: parallel loads race while linking the shared dependency snapshot.
  const loaded = []
  for (const [entry, execution, extra] of [
    [`${root}/codec.ts`, 'pinned-Sc2LayoutCodec', layoutDeps],
    ['packages/layouts-processing/src/sc2-layout-core/index.ts', 'pinned-sc2-layout-core', layoutDeps],
    [`${root}/rendering/index.ts`, 'pinned-sc2-layout-rendering', layoutDeps],
    ['packages/layouts-processing/bundled-schema.js', 'pinned-bundled-schema', { additionalFiles: ['packages/layouts-processing/generated/sc2layout-schema-data.json'] }],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource', {}],
  ]) loaded.push(await load(entry, execution, extra))
  const [codecLoaded, coreLoaded, renderLoaded, schemaLoaded, assetsLoaded] = loaded
  const codec = codecLoaded.module.createSc2LayoutCodec()
  const impl = { ...coreLoaded.module, ...renderLoaded.module, schemaData: schemaLoaded.module.default }
  const assets = assetsLoaded.module
  const text = async input => decoder.decode(await caseBytes(input)).replace(BOM, '')

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const bytes = await caseBytes(input)
    if (probe === 'store-check' || probe === 'render-visual') {
      const documents = await Promise.all(input.workspace.map(async f => {
        const file = resolveInput({ f }, corpus)
        return { uri: uriOf(file), text: await text(file) }
      }))
      return project(probe, { value: drive(impl, documents, uriOf(input), probe, input) })
    }
    if (probe === 'schema') {
      const registry = impl.createRegistry(impl.schemaData)
      return project(probe, { value: [...registry.frameTypes.keys()].sort((a, b) => a.localeCompare(b)).slice(0, 256) })
    }
    const source = assets.createMemoryAssetSource(bytes, { path: uriOf(input) })
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source'] })
    const call = id => session.invoke(`sc2-layout.${id}`)
    try {
      switch (probe) {
        case 'parse': return project(probe, { value: await call('sc2-layout.parse') })
        case 'view.inspect': return project(probe, { value: await call('view.inspect') })
        case 'view.render':
        case 'export.convert':
        case 'export.raw': return project(probe, { value: (await call(probe)).data })
      }
    } finally { await session.dispose() }
    throw new Error(`unknown sc2-layout probe: ${probe}`)
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: [codecLoaded.evidence, coreLoaded.evidence, renderLoaded.evidence, schemaLoaded.evidence, assetsLoaded.evidence] },
  }
}
