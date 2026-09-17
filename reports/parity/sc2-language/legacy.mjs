// Pinned MK2 SC2 language server: DocumentRouter with the SC2 language contribution registry,
// bundled from the pinned tree and run over stdio by ./mk2-server.mjs.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isolatedOracle, kitFile, loadPinned } from '../lib/kit.mjs'
import { createScenarioDriver } from './driver.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const loaderFiles = ['legacy.mjs', 'driver.mjs', 'lsp-client.mjs', 'mk2-server.mjs'].map(name => path.join(here, name))
// The extracted base-game data root MK2 requires (`defaultDataPath`); override with SC2_GAMEDATA_ROOT.
export const dataRoot = process.env.SC2_GAMEDATA_ROOT ?? 'C:/FILES/SC2Files/Mods/Builtin'
export const MK2_LANGUAGE_IDS = Object.freeze({ galaxy: 'galaxy', data: 'xml', strings: 'sc2strings', layout: 'sc2layout' })

export async function prepareOracle({ operation, corpus }) {
  const loaded = []
  await isolatedOracle(async () => {
    for (const [entry, execution] of [
      ['packages/lsp/src/host/router.ts', 'pinned-DocumentRouter'],
      ['extensions/blizzard/starcraft-2/src/language/host/language-contributions.ts', 'pinned-sc2-language-contributions'],
    ])
      loaded.push(await loadPinned(entry, {
        operation, corpus, loaderFiles: [...loaderFiles, kitFile],
        operationOptions: { adapterProtocol: 'sc2-language-parity-v1', execution, dataRoot },
      }))
  })
  const [router, registry] = loaded
  const driver = createScenarioDriver(corpus, root => ({
    command: process.execPath,
    args: [path.join(here, 'mk2-server.mjs'), router.evidence.directory, registry.evidence.directory, '--stdio'],
    options: { responses: { 'workspace/workspaceFolders': [{ uri: pathToFileURL(root).href, name: 'ws' }] } },
    languageIds: MK2_LANGUAGE_IDS,
    initializationOptions: { defaultDataPath: dataRoot },
  }))
  return {
    module: { [operation]: driver.invoke },
    evidence: { modules: loaded.map(item => item.evidence) },
  }
}
