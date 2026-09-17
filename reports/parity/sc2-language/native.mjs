// MK3 arm: the built modkit-lsp bin (apps/lsp) over the installed StarCraft II extension.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, sha256, workspace } from '../lib/kit.mjs'
import { createScenarioDriver, releaseAllDrivers } from './driver.mjs'

const lspMain = path.join(workspace, 'modkit-core', 'apps', 'lsp', 'dist', 'main.js')
const extension = path.join(blizzardRoot, 'starcraft2')
export const MK3_LANGUAGE_IDS = Object.freeze({ galaxy: 'galaxy', data: 'sc2-data', strings: 'sc2-strings', layout: 'sc2-layout' })

export async function prepareMigrated({ corpus }) {
  const driver = createScenarioDriver(corpus, root => ({
    command: process.execPath,
    args: [lspMain, '--root', root, '--extension', extension],
    options: {},
    languageIds: MK3_LANGUAGE_IDS,
    initializationOptions: {},
  }))
  const self = fileURLToPath(import.meta.url)
  const here = path.dirname(self)
  const hashes = async names => Object.fromEntries(await Promise.all(names.map(async name => [name, sha256(await readFile(path.join(here, name)))])))
  return {
    module: { 'sc2-language.parity': driver.invoke },
    release: releaseAllDrivers,
    evidence: {
      route: 'modkit-lsp stdio (apps/lsp/dist/main.js) with --extension modkit-extensions-blizzard/starcraft2',
      lspMainSha256: sha256(await readFile(lspMain)),
      extensionManifestSha256: sha256(await readFile(path.join(extension, 'package.json'))),
      harness: await hashes(['native.mjs', 'driver.mjs', 'lsp-client.mjs']),
    },
  }
}
