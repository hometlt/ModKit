// Pinned MK2 mod workspace: the chain `ModContextManager` resolves for a mod tree.
import { fileURLToPath } from 'node:url'
import { kitFile, loadPinned } from '../lib/kit.mjs'
import { driveOracle } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))

export async function prepareOracle({ operation, corpus }) {
  const loaded = await loadPinned(
    'extensions/blizzard/starcraft-2/codecs/sc2-mod/src/workspace/index.ts',
    {
      operation,
      corpus,
      loaderFiles: [adapter, kitFile, probes],
      operationOptions: {
        adapterProtocol: 'sc2-mod-content-parity-v1',
        execution: 'pinned-mod-workspace',
      },
    },
  )
  return {
    module: { [operation]: input => driveOracle(loaded.module, input) },
    evidence: { modules: [loaded.evidence] },
  }
}
