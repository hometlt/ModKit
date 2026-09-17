// Builds corpus.json: pinned MK2 GameData fixtures, a bounded distinct sample of loose installed
// mod GameData (published MK3 installation discovery) and synthetic inheritance/token/reference
// catalogs. Entity ids for requests are picked with a plain attribute scan (selection only).
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-data/build-corpus.mjs
//   node reports/parity/sc2-data/run.mjs --config <absolute>/reports/parity/sc2-data/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-data/receipt.json --check
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'
import { handlers, targetOperation } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/data/codecs/sc2data/codec.json'
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const GAMEDATA = /GameData\/[^/]+\.xml$/iu

const fixtures = []
const source = await pinnedSource()
for (const fixture of execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').filter(file => GAMEDATA.test(file) && /\.sc2(data|mod|map)\//iu.test(file)).sort())
  fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const pinnedCount = fixtures.length
const seen = new Set(fixtures.map(item => item.sha256))
let installedCount = 0
for (const item of await installedFiles(file => file.startsWith('Mods/') && !file.includes('/.backups/') && GAMEDATA.test(file), { maxBytes: 400_000 })) {
  if (seen.has(item.sha256) || item.size < 80 || installedCount >= 60) continue
  seen.add(item.sha256)
  installedCount += 1
  fixtures.push({ install: item.install, sha256: item.sha256 })
}
const realCount = fixtures.length
const synthetic = [
  ['Synthetic/Inheritance/GameData/UnitData.xml', `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CUnit id="ParityBase" default="1">
        <LifeMax value="10"/>
        <Speed value="1"/>
    </CUnit>
    <CUnit id="ParityChild" parent="ParityBase">
        <Speed value="2"/>
    </CUnit>
    <CUnit id="ParityGrandchild" parent="ParityChild">
        <LifeMax value="30"/>
    </CUnit>
    <CUnit id="ParityOrphan" parent="ParityMissing">
        <LifeMax value="5"/>
    </CUnit>
</Catalog>
`],
  ['Synthetic/Tokens/GameData/UnitData.xml', `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CUnit id="ParityTokenBase" default="1">
        <?token id="unitName" type="CUnitLink"?>
        <Name value="Unit/Name/##unitName##"/>
        <Description value="Unit/Description/##id##"/>
    </CUnit>
    <CUnit id="ParityMarine" parent="ParityTokenBase" unitName="Marine">
        <LifeMax value="45"/>
    </CUnit>
</Catalog>
`],
  ['Synthetic/References/GameData/WeaponData.xml', `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CWeaponLegacy id="ParityGun">
        <DisplayEffect value="ParityDamage"/>
        <Effect value="ParityDamage"/>
    </CWeaponLegacy>
    <CEffectDamage id="ParityDamage">
        <Amount value="6"/>
    </CEffectDamage>
    <CUnit id="ParityShooter">
        <WeaponArray Link="ParityGun"/>
        <WeaponArray Link="ParityMissingGun"/>
    </CUnit>
</Catalog>
`],
]
for (const [name, text] of synthetic) fixtures.push({ name, base64: Buffer.from(text).toString('base64') })

const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  if (claims.skipProbes[probe] !== undefined) return
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
const decoder = new TextDecoder()
for (const [f, item] of fixtures.entries()) {
  const text = decoder.decode(await caseBytes(item))
  const real = f < realCount
  add('detect', f, { f })
  if (!/<Catalog[\s>]/u.test(text)) continue
  const entities = [...text.matchAll(/<(C[A-Za-z]+)\s+id="([^"]+)"(?:\s+parent="([^"]+)")?/gu)]
    .map(match => ({ klass: match[1], id: match[2], parent: match[3] }))
  if (entities.length === 0) continue
  for (const probe of ['view.inspect', 'describe', 'asset.validate']) add(probe, f, { f })
  add('asset.search', `${f}a`, { f, request: { limit: 50 } })
  add('asset.search', `${f}c`, { f, request: { class: entities[0].klass } })
  add('asset.search', `${f}i`, { f, request: { id: entities[0].id.slice(0, 3).toLowerCase(), limit: 20 } })
  add('export.convert', `${f}r`, { f, request: { format: 'json', mode: 'raw' } })
  if (!real) {
    add('export.convert', `${f}j`, { f, request: { format: 'json', mode: 'full' } })
    add('export.convert', `${f}x`, { f, request: { format: 'xml' } })
  }
  // The namespace of an entity class is resolved by the codec; requests use the file's own
  // namespace stem (UnitData.xml -> Unit), as a caller that opened the file would.
  const namespace = /\/([A-Za-z]+)Data\.xml$/u.exec(item.install ?? item.fixture ?? item.name)?.[1]
  if (namespace === undefined) continue
  const target = entities[0]
  add('sc2-data.references', `${f}d`, { f, request: { namespace, id: target.id } })
  add('sc2-data.references', `${f}n`, { f, request: { namespace, id: target.id, includeDeclaration: false } })
  for (const entity of real ? entities.filter(item => item.parent !== undefined).slice(0, 2) : entities)
    add('sc2-data.resolve-inheritance', `${f}/${entity.id}`, { f, request: { namespace, id: entity.id } })
  // MK2 and MK3 both refuse a rename while an ancestor is outside the opened file.
  const local = new Set(entities.map(item => item.id))
  const closed = entities.every(item => item.parent === undefined || local.has(item.parent))
  if (closed && (!real || f < pinnedCount + 20)) {
    add('edit.content', `${f}r`, { f, request: { renames: [{ namespace, oldId: target.id, newId: `${target.id}Parity` }] } })
    add('edit.content', `${f}0`, { f, request: { renames: [{ namespace, oldId: 'ParityNoSuchEntity', newId: 'ParityRenamed' }] } })
  }
}

const proofs = [
  ...claims.features.map(([hash, ...tags]) => ({ requirement: `legacy/codec-manifest/modkit/sc2-data/feature/${hash}`, kind: 'feature', tags })),
  ...claims.operations.map(([legacy, ...tags]) => ({
    requirement: `legacy/codec-manifest/modkit/sc2-data/operation/${legacy}`,
    kind: 'operation', tags, legacyOperation: legacy, targetOperation: targetOperation(legacy),
    handlerId: handlers[legacy], contribution, executed: true,
  })),
].filter(proof => proof.tags.every(tag => claims.skipProbes[tag] === undefined)).map(({ tags, ...proof }) => ({
  ...proof,
  adapterOperation: 'sc2-data.parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${pinnedCount} pinned MK2 GameData fixtures, ${installedCount} distinct loose installed mod GameData files and ${synthetic.length} synthetic catalogs.`,
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-data corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
