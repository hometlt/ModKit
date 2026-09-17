// Pinned MK2 sc2-mod JSON mod writer/reader.
import { fileURLToPath } from 'node:url'
import { kitFile, loadPinned } from '../lib/kit.mjs'
import { drive } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))

export async function prepareOracle({ operation, corpus }) {
  const loaded = await loadPinned('extensions/blizzard/starcraft-2/codecs/sc2-mod/src/json-mod.ts', {
    operation, corpus, loaderFiles: [adapter, kitFile, probes],
    operationOptions: { adapterProtocol: 'sc2-mod-json-parity-v1', execution: 'pinned-json-mod' },
  })
  return {
    module: { [operation]: input => drive(loaded.module, input) },
    evidence: { modules: [loaded.evidence] },
  }
}
