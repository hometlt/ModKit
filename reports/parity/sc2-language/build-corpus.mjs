// Builds corpus.json: LSP scenarios (a small SC2 mod workspace) and one case per request.
// Positions are computed from the authored texts.
// One receipt per codec: cases are filtered by tag prefix and written to <codec>/corpus.json.
//   node reports/parity/sc2-language/build-corpus.mjs galaxy|sc2-layout
//   node reports/parity/sc2-language/<codec>/run.mjs --config <absolute>/reports/parity/sc2-language/<codec>/config.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const codec = process.argv[2]
const prefixes = { galaxy: ['galaxy.', 'capabilities'], 'sc2-layout': ['layout.'] }[codec]
if (prefixes === undefined) throw new Error('usage: build-corpus.mjs galaxy|sc2-layout')
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))[codec]
const mod = 'Probe.SC2Mod'
const files = {
  [`${mod}/Base.SC2Data/MapScript.galaxy`]: [
    'include "Lib"',
    '',
    'const int c_limit = 3;',
    'struct Pair {',
    '    int left;',
    '    int right;',
    '};',
    '',
    'void Init() {',
    '    int x = Helper(2, c_limit);',
    '    Pair p;',
    '    p.left = Helper(x, 1);',
    '}',
    '',
  ].join('\n'),
  [`${mod}/Base.SC2Data/Lib.galaxy`]: [
    '// Library helpers',
    'int Helper(int amount, int scale) {',
    '    return amount * scale;',
    '}',
    '',
  ].join('\n'),
  [`${mod}/Base.SC2Data/GameData/UnitData.xml`]: [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Catalog>',
    '    <CUnit id="Marine">',
    '        <LifeMax value="45"/>',
    '        <WeaponArray Link="Rifle"/>',
    '    </CUnit>',
    '    <CUnit id="Hero" parent="Marine">',
    '        <LifeMax value="90"/>',
    '    </CUnit>',
    '</Catalog>',
    '',
  ].join('\n'),
  [`${mod}/Base.SC2Data/GameData/WeaponData.xml`]: [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Catalog>',
    '    <CWeaponLegacy id="Rifle">',
    '        <Range value="6"/>',
    '    </CWeaponLegacy>',
    '</Catalog>',
    '',
  ].join('\n'),
  [`${mod}/enUS.SC2Data/LocalizedData/GameStrings.txt`]: [
    'Unit/Name/Marine=Marine',
    'Unit/Name/Hero=Hero <c val="FF0000">Prime</c>',
    'Weapon/Name/Rifle=Rifle',
    '',
  ].join('\n'),
  [`${mod}/Base.SC2Data/UI/Layout/Probe.SC2Layout`]: [
    '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
    '<Desc>',
    '    <Constant name="Accent" val="00FF00"/>',
    '    <Frame type="Frame" name="Root">',
    '        <Anchor side="Top" relative="$parent" pos="Min" offset="0"/>',
    '        <Frame type="Label" name="Title">',
    '            <Color val="255,0,0"/>',
    '            <Style val="#Accent"/>',
    '        </Frame>',
    '    </Frame>',
    '</Desc>',
    '',
  ].join('\n'),
}
const languages = Object.fromEntries(Object.keys(files).map(file => [file,
  file.endsWith('.galaxy') ? 'galaxy' : file.endsWith('.xml') ? 'data' : file.endsWith('.txt') ? 'strings' : 'layout']))
const scenarios = { mod: { files, languages, settleMs: 20_000 } }

const uri = file => `<ws>/${file}`
const at = (file, needle, delta = 0, occurrence = 0) => {
  const text = files[file]
  let index = -1
  for (let n = 0; n <= occurrence; n++) index = text.indexOf(needle, index + 1)
  if (index < 0) throw new Error(`needle not found: ${needle}`)
  const before = text.slice(0, index + delta).split('\n')
  return { textDocument: { uri: uri(file) }, position: { line: before.length - 1, character: before.at(-1).length } }
}
const main = `${mod}/Base.SC2Data/MapScript.galaxy`
const lib = `${mod}/Base.SC2Data/Lib.galaxy`
const unit = `${mod}/Base.SC2Data/GameData/UnitData.xml`
const strings = `${mod}/enUS.SC2Data/LocalizedData/GameStrings.txt`
const layout = `${mod}/Base.SC2Data/UI/Layout/Probe.SC2Layout`

const cases = []
const tagged = new Map()
const add = (tag, id, input) => {
  if (!prefixes.some(prefix => tag.startsWith(prefix)) || claims.skipCases.includes(`${tag}/${id}`)) return
  cases.push({ id: `${tag}/${id}`, input: { scenario: 'mod', ...input } })
  tagged.set(tag, [...(tagged.get(tag) ?? []), `${tag}/${id}`])
}
const request = (tag, id, method, params, projection) => add(tag, id, { method, params, projection })
// Galaxy
request('galaxy.hover', 'call', 'textDocument/hover', at(main, 'Helper(2', 2), 'hover')
request('galaxy.hover', 'const', 'textDocument/hover', at(main, 'c_limit)', 2), 'hover')
request('galaxy.hover', 'field', 'textDocument/hover', at(main, 'left =', 1), 'hover')
request('galaxy.definition', 'call', 'textDocument/definition', at(main, 'Helper(x', 2), 'locations')
request('galaxy.definition', 'struct', 'textDocument/definition', at(main, 'Pair p', 1), 'locations')
request('galaxy.references', 'decl', 'textDocument/references', { ...at(lib, 'Helper', 2), context: { includeDeclaration: true } }, 'locations')
request('galaxy.references', 'nodecl', 'textDocument/references', { ...at(lib, 'Helper', 2), context: { includeDeclaration: false } }, 'locations')
request('galaxy.symbols', 'main', 'textDocument/documentSymbol', { textDocument: { uri: uri(main) } }, 'symbols')
request('galaxy.symbols', 'lib', 'textDocument/documentSymbol', { textDocument: { uri: uri(lib) } }, 'symbols')
request('galaxy.workspace-symbols', 'help', 'workspace/symbol', { query: 'Help' }, 'workspace-symbols')
request('galaxy.workspace-symbols', 'pair', 'workspace/symbol', { query: 'Pair' }, 'workspace-symbols')
request('galaxy.signature', 'first', 'textDocument/signatureHelp', at(main, 'Helper(2', 7), 'signature')
request('galaxy.signature', 'second', 'textDocument/signatureHelp', at(main, 'c_limit)', 1), 'signature')
request('galaxy.rename', 'helper', 'textDocument/rename', { ...at(lib, 'Helper', 2), newName: 'Aid' }, 'rename')
// Layout
request('layout.color', 'doc', 'textDocument/documentColor', { textDocument: { uri: uri(layout) } }, 'colors')
const red = at(layout, '255,0,0')
request('layout.color', 'presentation', 'textDocument/colorPresentation', {
  textDocument: red.textDocument, color: { red: 1, green: 0, blue: 0, alpha: 1 },
  range: { start: red.position, end: { line: red.position.line, character: red.position.character + 7 } },
}, 'raw')
request('layout.symbols', 'doc', 'textDocument/documentSymbol', { textDocument: { uri: uri(layout) } }, 'symbols')
request('layout.hover', 'frame', 'textDocument/hover', at(layout, 'type="Label"', 7), 'hover')
request('layout.definition', 'constant', 'textDocument/definition', at(layout, '#Accent', 3), 'location-start')
request('layout.references', 'constant', 'textDocument/references', { ...at(layout, 'Accent"', 2), context: { includeDeclaration: true } }, 'locations')
request('layout.rename', 'constant', 'textDocument/rename', { ...at(layout, 'Accent"', 2), newName: 'Primary' }, 'rename')
// GameData
request('data.hover', 'parent', 'textDocument/hover', at(unit, 'parent="Marine"', 10), 'hover')
request('data.definition', 'parent', 'textDocument/definition', at(unit, 'parent="Marine"', 10), 'location-start')
request('data.definition', 'weapon', 'textDocument/definition', at(unit, 'Link="Rifle"', 8), 'location-start')
request('data.references', 'marine', 'textDocument/references', { ...at(unit, 'id="Marine"', 6), context: { includeDeclaration: true } }, 'locations')
request('data.symbols', 'unit', 'textDocument/documentSymbol', { textDocument: { uri: uri(unit) } }, 'symbols')
// GameStrings
request('strings.hover', 'key', 'textDocument/hover', at(strings, 'Unit/Name/Hero', 3), 'hover')
request('strings.symbols', 'doc', 'textDocument/documentSymbol', { textDocument: { uri: uri(strings) } }, 'symbols')
request('strings.color', 'doc', 'textDocument/documentColor', { textDocument: { uri: uri(strings) } }, 'colors')
// Declared server capabilities that MK2 advertised.
add('capabilities', 'providers', {
  method: 'capabilities',
  keys: ['hoverProvider', 'definitionProvider', 'referencesProvider', 'documentSymbolProvider', 'workspaceSymbolProvider',
    'signatureHelpProvider', 'renameProvider', 'colorProvider', 'completionProvider'],
})

const proofs = claims.features.map(([requirement, ...tags]) => ({
  requirement: `legacy/codec-manifest/modkit/${requirement}`,
  kind: 'feature',
  adapterOperation: 'sc2-language.parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, codec, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'A synthetic SC2 mod workspace (Galaxy, GameData, GameStrings, SC2Layout) served by both language servers; MK2 uses the extracted base-game data root.',
  scenarios,
  cases,
  proofs,
}, 0))
console.log(`sc2-language/${codec} corpus: ${cases.length} cases, ${proofs.length} proofs`)
