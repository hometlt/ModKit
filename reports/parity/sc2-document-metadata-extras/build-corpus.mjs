// Dependency-only DocumentInfo writer inputs and pinned metadata fixtures for the source.save state.
//   node reports/parity/sc2-document-metadata-extras/build-corpus.mjs && node reports/parity/sc2-document-metadata-extras/run.mjs --config <absolute>/config.json
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { pinnedSource } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await pinnedSource()
const fixtures = []
for (const fixture of [
  'extensions/blizzard/starcraft-2/src/language/test/fixtures/sc2-map.SC2Map/DocumentHeader',
  'extensions/blizzard/starcraft-2/src/language/test/fixtures/sc2-map.SC2Map/DocumentInfo',
  'extensions/blizzard/starcraft-2/src/language/test/fixtures/sc2-map.SC2Map/GameData.version',
]) fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256, name: `Maps/Parity.SC2Map/${path.posix.basename(fixture)}` })
const cases = [
  ...[[], ['bnet:Liberty (Mod)/0.0/999,file:Mods/Liberty.SC2Mod'], ['file:Mods/A & B.SC2Mod', 'file:Mods/<x>.SC2Mod', 'file:Mods/"q".SC2Mod']]
    .map((dependencies, index) => ({ id: `write/${index}`, input: { probe: 'write-dependencies', f: 0, dependencies } })),
  ...fixtures.map((_item, f) => ({ id: `save/${f}`, input: { probe: 'save-state', f } })),
]
const ids = prefix => cases.filter(item => item.id.startsWith(prefix)).map(item => item.id)
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1, kind: 'mixed', fixtures, cases,
  proofs: [
    { requirement: 'legacy/codec-manifest/modkit/sc2-document-metadata/feature/0eb044a83b444824', kind: 'feature', adapterOperation: 'sc2-document-metadata.extras-parity', caseIds: ids('write/') },
    { requirement: 'legacy/codec-manifest/modkit/sc2-document-metadata/feature/adbe47bf6acd0344', kind: 'feature', adapterOperation: 'sc2-document-metadata.extras-parity', caseIds: ids('save/') },
  ],
}, 0))
