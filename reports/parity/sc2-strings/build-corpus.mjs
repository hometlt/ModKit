// Builds corpus.json: pinned MK2 localization fixtures plus loose installed StarCraft II mod
// string tables (found by the published MK3 installation discovery).
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-strings/build-corpus.mjs
//   node reports/parity/sc2-strings/run.mjs --config <absolute>/reports/parity/sc2-strings/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-strings/receipt.json --check
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { blizzardRoot, caseBytes, importPublic, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'
import { handlers, targetOperation } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/strings/codecs/strings/codec.json'
const { module: xml } = await importPublic(path.join(blizzardRoot, 'starcraft2'), '@modkit/codec-kit/legacy/xml')
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const STRINGS = /\/LocalizedData\/(GameStrings|TriggerStrings|ObjectStrings|GameHotkeys)\.txt$/iu

const fixtures = []
const source = await pinnedSource()
for (const fixture of execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').filter(file => STRINGS.test(`/${file}`)).sort())
  fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const installed = await installedFiles(file => file.startsWith('Mods/') && !file.includes('/.backups/') && STRINGS.test(file), { maxBytes: 2_000_000 })
for (const item of installed) fixtures.push({ install: item.install, sha256: item.sha256 })

const cases = []
const byProbe = new Map()
const add = (probe, id, input) => {
  if (claims.skipProbes[probe] !== undefined) return
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  byProbe.set(probe, [...(byProbe.get(probe) ?? []), `${probe}/${id}`])
}
const pathOf = item => item.install ?? item.fixture
for (const [f, record] of fixtures.entries()) {
  const model = xml.parseSc2StringsOrdered(await caseBytes(record))
  const keys = [...model.index.keys()]
  add('parse', f, { f })
  if (keys.length === 0) continue
  const hotkeys = /GameHotkeys\.txt$/iu.test(pathOf(record))
  for (const probe of ['view.inspect', 'export.convert', 'export.entries', 'references']) add(probe, f, { f })
  if (!hotkeys) add('asset.validate', f, { f })
  const withRef = keys.find(key => /<d\s[^>]*ref=/iu.test(xml.effectiveValue(model, key) ?? ''))
  if (withRef !== undefined) add('references', `${f}k`, { f, key: withRef })
  add('edit.content', `${f}s`, { f, edit: { action: 'set', key: keys[0], value: 'Parity <c val="FF0000">value</c>' } })
  add('edit.content', `${f}r`, { f, edit: { action: 'rename', oldKey: keys[0], newKey: `${keys[0]}Parity` } })
  add('edit.content', `${f}a`, { f, edit: { action: 'add', key: 'Parity/Added/Key', value: 'added', afterKey: keys.at(-1) } })
  add('edit.content', `${f}n`, { f, edit: { action: 'set', key: 'Parity/Missing/Key', value: 'x' } })
  // Locale pairs: the same catalog of the same package in another locale.
  const match = /^(.*\/)([a-z]{2}[A-Z]{2})(\.SC2Data\/LocalizedData\/\w+\.txt)$/iu.exec(pathOf(record))
  if (match && match[2].toLowerCase() === 'enus') {
    const other = fixtures.findIndex(item => {
      const candidate = /^(.*\/)([a-z]{2}[A-Z]{2})(\.SC2Data\/LocalizedData\/\w+\.txt)$/iu.exec(pathOf(item))
      return candidate && candidate[1] === match[1] && candidate[3].toLowerCase() === match[3].toLowerCase() && candidate[2].toLowerCase() !== 'enus'
    })
    if (other >= 0) {
      const otherModel = xml.parseSc2StringsOrdered(await caseBytes(fixtures[other]))
      add('compare-locales', `${f}-${other}`, { f, other })
      add('resolve-fallback', `${f}-${other}p`, { f, other, key: keys[0] })
      const missing = [...otherModel.index.keys()].find(key => !model.index.has(key))
      if (missing !== undefined) add('resolve-fallback', `${f}-${other}m`, { f, other, key: missing })
      const empty = keys.find(key => xml.effectiveValue(model, key) === '')
      if (empty !== undefined) add('resolve-fallback', `${f}-${other}e`, { f, other, key: empty })
    }
  }
}

const proofs = [
  ...claims.features.map(([hash, ...probes]) => ({ requirement: `legacy/codec-manifest/modkit/sc2-strings/feature/${hash}`, kind: 'feature', probes })),
  ...claims.operations.map(([legacy, ...probes]) => ({
    requirement: `legacy/codec-manifest/modkit/sc2-strings/operation/${legacy}`,
    kind: 'operation', probes, legacyOperation: legacy, targetOperation: targetOperation(legacy),
    handlerId: handlers[legacy], contribution, executed: true,
  })),
].filter(proof => proof.probes.every(probe => claims.skipProbes[probe] === undefined)).map(({ probes, ...proof }) => ({
  ...proof,
  adapterOperation: 'sc2-strings.parity',
  caseIds: probes.flatMap(probe => byProbe.get(probe) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${fixtures.length - installed.length} pinned MK2 localization fixtures and ${installed.length} loose installed mod string tables; edits are synthetic requests on real files.`,
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-strings corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
