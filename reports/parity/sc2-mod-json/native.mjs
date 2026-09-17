// MK3 JSON mod writer/reader through the public @modkit/blizzard-starcraft2/sc2-mod/json-source export.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { blizzardRoot, importPublic, sha256 } from '../lib/kit.mjs'
import { drive } from './probes.mjs'

export async function prepareMigrated() {
  const json = await importPublic(path.join(blizzardRoot, 'starcraft2'), '@modkit/blizzard-starcraft2/sc2-mod/json-source')
  const self = fileURLToPath(import.meta.url)
  const probes = fileURLToPath(new URL('./probes.mjs', import.meta.url))
  return {
    module: { 'sc2-mod.json-parity': input => drive(json.module, input) },
    evidence: {
      publicExport: path.relative(blizzardRoot, json.file).split(path.sep).join('/'),
      publicExportSha256: sha256(await readFile(json.file)),
      probesSha256: sha256(await readFile(probes)),
      adapterSha256: sha256(await readFile(self)),
    },
  }
}
