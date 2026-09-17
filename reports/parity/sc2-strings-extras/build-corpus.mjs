// Builds corpus.json for the SC2 localization library: pinned MK2 string tables, a capped distinct
// sample of loose installed mod tables (published MK3 installation discovery), markup values drawn
// from them plus synthetic values, and a small synthetic catalog for resolution/completion.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-strings-extras/build-corpus.mjs
//   node reports/parity/sc2-strings-extras/run.mjs --config <absolute>/reports/parity/sc2-strings-extras/config.json
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const TABLE = /\/LocalizedData\/(GameStrings|TriggerStrings|ObjectStrings|GameHotkeys)\.txt$/iu
const fixtures = []
const source = await pinnedSource()
for (const fixture of execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').filter(file => TABLE.test(`/${file}`)).sort())
  fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const seen = new Set(fixtures.map(item => item.sha256))
let installed = 0
for (const item of await installedFiles(file => file.startsWith('Mods/') && !file.includes('/.backups/') && TABLE.test(file), { maxBytes: 600_000 })) {
  if (seen.has(item.sha256) || installed >= 40) continue
  seen.add(item.sha256)
  installed += 1
  fixtures.push({ install: item.install, sha256: item.sha256 })
}

const decoder = new TextDecoder()
const markupValues = []
for (const item of fixtures) {
  for (const line of decoder.decode(await caseBytes(item)).split(/\r?\n/u)) {
    const value = line.slice(line.indexOf('=') + 1)
    if (line.includes('=') && value.includes('<') && markupValues.length < 120 && !markupValues.includes(value)) markupValues.push(value)
  }
}
const synthetic = [
  'Deals <d ref="Effect,ParityDamage,Amount"/> damage (<d ref="Effect,ParityDamage,Amount*2+1" precision="1"/>).',
  '<c val="ColorAttackInfo">Hot</c> <c val="FF8000">orange</c> <s val="ParityStyle">styled</s><n/>line',
  '<d stringref="Unit,ParityMarine,Name"/> and <d GalaxyVar="gv_parity"/> and <d GalaxyVar="gv_missing"/>',
  '<img path="@@Icon1" width="16" height="16"/> [d ref="Unit,ParityMarine,LifeMax"] <d ref="Unit,Missing,LifeMax"/>',
  'Broken <c val="FF0000">unclosed <d ref="Effect,ParityDamage"/> </s> <x', '$Token$ plain /// comment <c val="Nope">',
  '<ul><li>one</li><li>two</li></ul><a href="x">link</a>', '',
]
const snapshot = {
  entities: {
    'Effect/ParityDamage': { Amount: 10, Kind: 'Melee', Flags: { Kill: 1 } },
    'Unit/ParityMarine': { LifeMax: 45, Name: 'Unit/Name/ParityMarine', WeaponArray: [{ Link: 'Gun' }] },
  },
  strings: { 'Unit/Name/ParityMarine': 'Marine', 'Unit/Name/Missing': '' },
  galaxyVars: { gv_parity: { text: 'Seven', value: 7, type: 'int' } },
  constants: { ColorAttackInfo: 'FFCC00' },
  styles: { ParityStyle: { fontcolor: 'FF00FF', textcolor: '00FF00' } },
}

const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
const values = [...markupValues, ...synthetic]
for (let start = 0; start < values.length; start += 20) {
  const chunk = values.slice(start, start + 20)
  add('markup', start, { f: 0, values: chunk })
  add('tokenize', start, { f: 0, values: chunk, keys: ['Unit/Name/Marine', 'Abil/Name/Parity##id##', 'Param/Value/lib_Ntve_00000001', 'Simple'] })
  add('resolve', start, { f: 0, values: chunk, snapshot, paths: [['Effect/ParityDamage', 'Flags.Kill'], ['Unit/ParityMarine', 'WeaponArray[0]'], ['Unit/ParityMarine', 'LifeMax']], htmlOptions: { classPrefix: 'p-' } })
}
add('complete', 'points', {
  f: 0, snapshot,
  points: [
    ['value', '<', 1], ['value', '<c ', 3], ['value', '<c val="', 8], ['value', '<d ref="', 8], ['value', '<d ref="Effect,', 15],
    ['value', '<d ref="Effect,ParityDamage,', 28], ['value', '<s val="', 8], ['value', '<img path="', 11], ['value', 'plain', 3],
    ['value', '<d ', 3], ['value', '<d ref="x" precision="', 22], ['key', '', 0], ['key', 'Unit/', 5], ['key', 'Unit/Par', 8], ['key', 'Unit/ParityMarine/', 18],
  ],
})
add('constants', 'all', {
  f: 0,
  codes: ['enUS', 'enus', 'ENUS', 'ruRU', 'zhCN', 'xxXX', 'en', ''],
  stems: ['GameStrings', 'gamestrings', 'TRIGGERSTRINGS', 'Unknown', 'objectstrings.txt'],
  localeXml: '<?xml version="1.0"?><Locales><Locale id="enUS" name="English"/><Locale id="deDE"/></Locales>',
})
for (const [f, item] of fixtures.entries()) {
  const name = item.install ?? item.fixture
  add('detect', f, { f })
  if (/GameHotkeys\.txt$/iu.test(name)) add('hotkeys', f, { f })
  else add('analysis', f, { f, snapshot })
}
for (const [name, text] of [['Parity/Loose.txt', 'A=1\nB=2\nC=3\n'], ['Parity/enUS.SC2Data/LocalizedData/Notes.txt', 'plain words\n'],
  ['Parity/enUS.SC2Data/LocalizedData/GameHotkeys.txt', 'Button/Hotkey/Attack=A\nButton/Hotkey/Move=Ctrl+Shift+Q\nButton/Hotkey/Bad=Nope+\nButton/Hotkey/Attack=B\n']]) {
  const f = fixtures.push({ name, base64: Buffer.from(text).toString('base64') }) - 1
  add('detect', f, { f })
  if (name.endsWith('GameHotkeys.txt')) add('hotkeys', f, { f })
}
const before = 'Unit/Name/A=Alpha\nUnit/Name/B=Beta\nUnit/Name/C=Gamma\n'
const after = 'Unit/Name/A=Alpha2\nUnit/Name/C=Gamma\nUnit/Name/D=Delta\n'
const afterIndex = fixtures.push({ name: 'Parity/After.txt', base64: Buffer.from(after).toString('base64') }) - 1
add('diff', 'texts', {
  f: afterIndex, before,
  unified: '--- a/GameStrings.txt\n+++ b/GameStrings.txt\n@@ -1,3 +1,3 @@\n-Unit/Name/A=Alpha\n+Unit/Name/A=Alpha2\n-Unit/Name/B=Beta\n Unit/Name/C=Gamma\n+Unit/Name/D=Delta\n',
})
add('git', 'worktree', { f: afterIndex, revisions: [before, after] })
add('git', 'commits', { f: afterIndex, revisions: [before, after], commitLast: true })

const proofs = claims.features.map(([hash, ...tags]) => ({
  requirement: `legacy/codec-manifest/modkit/sc2-strings/feature/${hash}`,
  kind: 'feature',
  adapterOperation: 'sc2-strings.extras-parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${fixtures.length - installed - 4} pinned MK2 string tables, ${installed} distinct installed mod tables, ${values.length} markup values and a synthetic catalog/git history.`,
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-strings-extras corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
