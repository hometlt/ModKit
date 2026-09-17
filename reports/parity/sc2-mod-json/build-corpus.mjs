// Synthetic JSON mods for the modkit-json-mod@1 writer/reader parity (no game input needed).
//   node reports/parity/sc2-mod-json/build-corpus.mjs && node reports/parity/sc2-mod-json/run.mjs --config <absolute>/config.json
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const unit = { LifeMax: { value: '45' }, WeaponArray: [{ Link: 'Gun' }, { Link: 'Gun2' }], Name: { value: 'Unit/Name/Marine' } }
const mods = {
  'Parity.SC2Mod': {
    manifest: { format: 'modkit-json-mod@1', name: 'Parity' },
    deps: ['Liberty.SC2Mod', 'Parity Base.SC2Mod'],
    entries: {
      Unit: { Marine: unit, Child: { parent: 'Marine', class: 'CUnitHero', LifeMax: { value: '60' } } },
      Weapon: { Gun: { class: 'CWeaponLegacy', Range: { value: '5' } } },
      Abil: {},
    },
  },
  'Empty.SC2Mod': { manifest: { format: 'modkit-json-mod@1' }, deps: [], entries: {} },
}
const paths = ['Parity.SC2Mod', 'parity.sc2mod', 'Parity.SC2Mod/Base.SC2Data', 'Parity.SC2Mod/Base.SC2Data/GameData',
  'Parity.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'Parity.SC2Mod/base.sc2data/gamedata/unitdata.xml',
  'Parity.SC2Mod/Base.SC2Data/GameData/WeaponData.xml', 'Parity.SC2Mod/Base.SC2Data/GameData/AbilData.xml',
  'Parity.SC2Mod/DocumentInfo', 'Parity.SC2Mod/ComponentList.SC2Components', 'Empty.SC2Mod', 'Empty.SC2Mod/DocumentInfo', 'Missing.SC2Mod/x', '']
const cases = [
  { id: 'json/tab', input: { mods, paths, indent: '\t' } },
  { id: 'json/default', input: { mods, paths } },
]
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'synthetic',
  cases,
  proofs: [{ requirement: 'legacy/codec-manifest/modkit/sc2-mod/feature/51f919fb5ce9eda8', kind: 'feature', adapterOperation: 'sc2-mod.json-parity', caseIds: cases.map(item => item.id) }],
}, 0))
