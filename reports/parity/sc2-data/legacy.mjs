// Pinned MK2 sc2-data oracle: the legacy codec session and its structural detector.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { project } from './projection.mjs'

const adapter = fileURLToPath(import.meta.url)
const projection = fileURLToPath(new URL('./projection.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-data/src'
export const pathOf = input => input.install ?? input.fixture ?? input.name
// Both arms see the same source identity: the URI the MK3 host passes to the codec.
export const uriOf = input => `file:///parity/${pathOf(input)}`
const SESSION_IDS = Object.freeze({
  'view.inspect': 'view.inspect',
  'asset.search': 'asset.search',
  'asset.validate': 'asset.validate',
  'sc2-data.references': 'sc2-data.references',
  'sc2-data.resolve-inheritance': 'sc2-data.resolve-inheritance',
  'edit.content': 'edit.content',
  'export.convert': 'export.convert',
})

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/codec.ts`, 'pinned-Sc2DataCodec'],
    [`${root}/detect.ts`, 'pinned-detectSc2Data'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, projection],
      operationOptions: { adapterProtocol: 'sc2-data-parity-v1', execution },
    }))
  const [codecLoaded, detectLoaded, assetsLoaded] = loaded
  const codec = codecLoaded.module.createSc2DataCodec()

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const probe = input.probe
    const source = assetsLoaded.module.createMemoryAssetSource(await caseBytes(input), { path: uriOf(input) })
    if (probe === 'detect') return project(probe, { value: await detectLoaded.module.detectSc2Data(source, {}) })
    const document = await codec.open(source, {})
    const descriptor = await codec.describe(document, {})
    if (probe === 'describe') return project(probe, { legacy: descriptor })
    const session = codec.createSession(document, {}, descriptor, { grantedPermissions: ['read-source', 'write-source', 'write-workspace'] })
    try {
      const result = await session.invoke(`sc2-data.${SESSION_IDS[probe]}`, input.request)
      if (probe === 'edit.content' || probe === 'export.convert') return project(probe, { legacy: result })
      return project(probe, { value: result })
    } finally { await session.dispose() }
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
