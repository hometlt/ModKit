// Builds corpus.json: pinned MK2 TriggerData fixtures plus loose installed StarCraft II mods/maps
// (found by the published MK3 installation discovery), and small synthetic detection inputs.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-triggers/build-corpus.mjs
//   node reports/parity/sc2-triggers/run.mjs --config <absolute>/reports/parity/sc2-triggers/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-triggers/receipt.json --check
// Input selection uses the public MK3 source index only to pick offsets/targets; it is not evidence.
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { blizzardRoot, caseBytes, importPublic, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'
import { handlers } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/triggers/codecs/triggers/codec.json'
const { module: lib } = await importPublic(path.join(blizzardRoot, 'starcraft2'), '@modkit/blizzard-starcraft2/triggers/document')
const decoder = new TextDecoder()
const fixtures = []
const at = record => {
  const id = item => item.fixture ?? item.install ?? JSON.stringify([item.name, item.text])
  let index = fixtures.findIndex(item => id(item) === id(record))
  if (index < 0) index = fixtures.push(record) - 1
  return index
}

const pinned = execFileSync('git', ['-C', mk2Root, 'grep', '-l', '-I', '<TriggerData', MK2_PIN, '--', '.', ':!*.ts', ':!*.js', ':!*.md'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).map(line => line.slice(MK2_PIN.length + 1)).sort()
const source = await pinnedSource()
const triggerFiles = []
for (const fixture of pinned) triggerFiles.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const installedTriggers = await installedFiles(file => /\/Triggers$/iu.test(file) && !file.includes('/.backups/'))
// Bounded real sample: every loose installed mod plus the smaller maps (large maps add time, not coverage).
for (const item of installedTriggers)
  if (item.size <= 800_000 && item.size > 100) triggerFiles.push({ install: item.install, sha256: item.sha256 })
const strings = await installedFiles(file => /\/enUS\.SC2Data\/LocalizedData\/TriggerStrings\.txt$/iu.test(file) && !file.includes('/.backups/'))
const galaxy = await installedFiles(file => /\/Base\.SC2Data\/Lib\w+\.galaxy$/iu.test(file) && file.startsWith('Mods/') && !file.includes('/.backups/'))

const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const cases = []
const mapForms = []
const byProbe = new Map()
const excluded = (probe, input) =>
  Object.values(claims.divergences).some(item => item.probes?.includes(probe) && item.inputs.includes(fixtures[input.f]?.install ?? fixtures[input.f]?.fixture))
const add = (probe, id, input) => {
  if (claims.skipProbes[probe] !== undefined || excluded(probe, input)) return
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  byProbe.set(probe, [...(byProbe.get(probe) ?? []), `${probe}/${id}`])
}
const whole = ['view.inspect', 'script.symbols', 'asset.validate', 'detect', 'sax-read', 'xml2js-read', 'source-index', 'to-engine', 'content-scripts']
for (const record of triggerFiles) {
  const f = at(record)
  const text = decoder.decode(await caseBytes(record))
  // MK2 cannot open map-form TriggerData (no Library/Standard element); MK3 wraps it as Map.
  // Such inputs are kept only for probes MK2 defines on raw text (declared in divergences.json).
  const mapForm = lib.parseTriggerXmlSync(text).size === 0
  if (mapForm) {
    mapForms.push(record.fixture ?? record.install)
    for (const probe of ['detect', 'source-index']) add(probe, f, { f })
    continue
  }
  for (const probe of whole) add(probe, f, { f })
  for (const part of ['script', 'header']) add('export.convert', `${f}${part[0]}`, { f, part })
  const index = lib.scanTriggerSource(text, { sourcePath: 'Triggers' })
  const reference = index.references.find(item => item.target?.type && item.target?.id)
  if (reference) {
    add('script.references', f, { f, target: { type: reference.target.type, id: reference.target.id } })
    if (reference.target.library) add('script.references', `${f}L`, { f, target: { ...reference.target } })
  }
  const named = index.elements.find(item => (item.identifier?.value ?? '').length >= 3)
  if (named) {
    add('asset.search', `${f}n`, { f, query: named.identifier.value.slice(0, 3) })
    add('asset.search', `${f}t`, { f, query: named.id.slice(0, 2), types: [named.type] })
  }
  const links = [...new Map(index.gameLinks.map(link => [`${link.catalog}/${link.entry}`, link])).values()].slice(0, 2)
  if (links.length) add('edit.content', f, { f, renames: links.map(link => ({ catalog: link.catalog, oldId: link.entry, newId: `${link.entry}Renamed` })) })
  add('edit.content', `${f}0`, { f, renames: [{ catalog: 'Unit', oldId: 'ParityNoSuchUnit', newId: 'ParityRenamed' }] })
}
add('disabled-verbs', 0, { f: 0 })
for (const record of strings) {
  const f = at({ install: record.install, sha256: record.sha256 })
  add('trigger-strings', f, { f })
  const owner = record.install.replace(/\/enUS\.SC2Data\/LocalizedData\/TriggerStrings\.txt$/iu, '/Triggers')
  const triggers = triggerFiles.find(item => item.install?.toLowerCase() === owner.toLowerCase())
  if (triggers && !mapForms.includes(triggers.install)) add('sax-read-strings', `${at(triggers)}+${f}`, { f: at(triggers), strings: f })
}
for (const record of galaxy.filter(item => !/_h\.galaxy$/iu.test(item.install))) {
  const header = galaxy.find(item => item.install === record.install.replace(/\.galaxy$/u, '_h.galaxy'))
  const libraryId = /\/Lib(\w+)\.galaxy$/u.exec(record.install)[1]
  const script = at({ install: record.install, sha256: record.sha256 })
  add('g2t', script, {
    f: 0, libraryId, script,
    ...(header ? { header: at({ install: header.install, sha256: header.sha256 }) } : {}),
  })
}
// Synthetic detection inputs: accepted names/roots and rejected foreign XML roots.
for (const [name, text] of [
  ['Triggers', '<?xml version="1.0" encoding="utf-8"?>\n<TriggerData>\n</TriggerData>\n'],
  ['Lib.TriggerLib', '<TriggerData><Library Id="ABCD"/></TriggerData>'],
  ['Parity.SC2Lib', '<TriggerData><Library Id="ABCD"/></TriggerData>'],
  ['Parity.xml', '<?xml version="1.0"?><TriggerData><Root/></TriggerData>'],
  ['Parity.Triggers', '<TriggerData><Element Type="Trigger" Id="1"/></TriggerData>'],
  ['UnitData.xml', '<?xml version="1.0"?><Catalog><CUnit id="Marine"/></Catalog>'],
  ['GameUI.SC2Layout', '<?xml version="1.0"?><Desc><Frame type="Frame" name="X"/></Desc>'],
  ['Triggers', '<CFrame/>'],
  ['Notes.txt', 'plain text'],
]) {
  const f = at({ name, text })
  add('detect', `s${f}`, { f })
}

const feature = (hash, ...probes) => ({ requirement: `legacy/codec-manifest/modkit/sc2-triggers/feature/${hash}`, kind: 'feature', probes })
const operation = legacy => ({
  requirement: `legacy/codec-manifest/modkit/sc2-triggers/operation/${legacy}`,
  kind: 'operation', probes: [legacy], legacyOperation: legacy, targetOperation: legacy,
  handlerId: handlers[legacy], contribution, executed: true,
})
const proofs = [
  ...claims.features.map(([hash, ...probes]) => feature(hash, ...probes)),
  ...claims.operations.map(operation),
].filter(proof => proof.probes.every(probe => claims.skipProbes[probe] === undefined)).map(({ probes, ...proof }) => ({
  ...proof,
  adapterOperation: 'sc2-triggers.parity',
  caseIds: probes.flatMap(probe => byProbe.get(probe) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${pinned.length} pinned MK2 TriggerData fixtures, ${triggerFiles.length - pinned.length} loose installed Triggers, ${strings.length} installed TriggerStrings, installed Lib*.galaxy for G2T, and synthetic detection inputs.`,
  fixtures,
  cases,
  proofs,
}, 0))
await writeFile(path.join(here, 'divergences.json'), stable({
  schemaVersion: 1,
  mapFormTriggerData: {
    rule: 'MK2 readTriggerLibraryFast throws "No libraries found in trigger XML" for map-form TriggerData without a Library/Standard element; MK3 blizzard/sc2-triggers parses it as an implicit Map library (superset). These inputs are compared only by detect and source-index.',
    inputs: mapForms,
  },
  ...claims.divergences,
}))
console.log(`sc2-triggers corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
