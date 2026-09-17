// Pinned MK2 Galaxy oracle for detection, the batch checker and the script fallback audit.
import { fileURLToPath } from 'node:url'
import { caseBytes, caseName, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { drive } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/galaxy/src'

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/core/galaxy-check.ts`, 'pinned-galaxy-check'],
    [`${root}/fallback-audit.ts`, 'pinned-galaxy-fallback-audit'],
    [`${root}/detect.ts`, 'pinned-detectGalaxyScript'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, probes],
      operationOptions: { adapterProtocol: 'galaxy-extras-parity-v1', execution },
      runtimeDependencies: [{ name: 'xml2js' }],
    }))
  const [checkLoaded, auditLoaded, detectLoaded, assetsLoaded] = loaded
  const api = {
    ...checkLoaded.module,
    ...auditLoaded.module,
    async accepted(bytes, name) {
      const source = assetsLoaded.module.createMemoryAssetSource(bytes, { path: `file:///parity/${name}`, name })
      return (await detectLoaded.module.detectGalaxyScript(source, {})).confidence > 0
    },
  }
  const invoke = async raw => drive(api, resolveInput(raw, corpus), corpus, { caseBytes, caseName, resolveInput })
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
