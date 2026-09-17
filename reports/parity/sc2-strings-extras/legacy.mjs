// Pinned MK2 sc2-strings oracle for the localization library, hotkey validation and detection.
import { fileURLToPath } from 'node:url'
import { caseBytes, kitFile, loadPinned, resolveInput } from '../lib/kit.mjs'
import { drive, plain } from './probes.mjs'

const adapter = fileURLToPath(import.meta.url)
const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
const root = 'extensions/blizzard/starcraft-2/codecs/sc2-strings/src'
const decoder = new TextDecoder('utf-8', { fatal: false })
export const pathOf = input => input.install ?? input.fixture ?? input.name
export const hotkeyDiagnostic = item => ({ code: item.code, message: item.message, severity: item.severity, line: item.line, start: item.start ?? null, end: item.end ?? null })

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  for (const [entry, execution] of [
    [`${root}/core/index.ts`, 'pinned-sc2-strings-core'],
    [`${root}/core/node.ts`, 'pinned-sc2-strings-node'],
    [`${root}/core/hotkeys.ts`, 'pinned-sc2-strings-hotkeys'],
    [`${root}/detect.ts`, 'pinned-detectSc2Strings'],
    ['packages/assets/src/source.ts', 'pinned-createMemoryAssetSource'],
  ])
    loaded.push(await loadPinned(entry, {
      operation, corpus, loaderFiles: [adapter, kitFile, probes],
      operationOptions: { adapterProtocol: 'sc2-strings-extras-parity-v1', execution },
    }))
  const [coreLoaded, nodeLoaded, hotkeysLoaded, detectLoaded, assetsLoaded] = loaded
  const api = { ...coreLoaded.module, ...nodeLoaded.module }

  const invoke = async raw => {
    const input = resolveInput(raw, corpus)
    const bytes = await caseBytes(input)
    if (input.probe === 'detect') {
      const source = assetsLoaded.module.createMemoryAssetSource(bytes, { path: pathOf(input) })
      return { accepted: (await detectLoaded.module.detectSc2Strings(source, {})).confidence > 0 }
    }
    if (input.probe === 'hotkeys') {
      const model = api.parseSc2StringsOrdered(bytes)
      return plain(hotkeysLoaded.module.analyzeHotkeyStringFile(model).map(hotkeyDiagnostic))
    }
    return drive(api, input, decoder.decode(bytes))
  }
  return {
    module: { [operation]: invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
