// Pinned MK2 sc2-data catalog library over a catalog opened by the pinned MK2 codec.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { drive } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-data/src'
export const uriOf = input => `file:///parity/${input.install ?? input.fixture ?? input.name}`

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/codec.ts`, 'pinned-Sc2DataCodec'],
    [`${root}/flatten.ts`, 'pinned-flatten'],
    [`${root}/filter.ts`, 'pinned-filter'],
    [`${root}/extract.ts`, 'pinned-extract'],
    [`${root}/relations.ts`, 'pinned-relations'],
    [`${root}/graph-view.ts`, 'pinned-graph-view'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, probes],
      operationOptions: { adapterProtocol: 'sc2-data-library-parity-v1', execution },
    }))
  const assets = loaded.at(-1).module
  const api = Object.assign({}, ...loaded.slice(1, -1).map(item => item.module))
  const codec = loaded[0].module.createSc2DataCodec()
  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const document = await codec.open(assets.createMemoryAssetSource(await caseBytes(input), { path: uriOf(input) }), {})
    return drive(api, document.catalog)
  }
  return { module: { [operation]: invoke }, evidence: { modules: loaded.map(item => item.evidence) } }
}
