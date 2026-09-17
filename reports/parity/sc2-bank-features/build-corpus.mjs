// Builds corpus.json for the SC2 bank library/codec features: the pinned MK2 bank and BankList
// fixtures plus synthetic banks (typed values, custom nodes, duplicates, malformed values).
// No user bank from the Documents folder is read; discovery runs on a synthetic temporary tree.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-bank-features/build-corpus.mjs
//   node reports/parity/sc2-bank-features/run.mjs --config <absolute>/reports/parity/sc2-bank-features/config.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { pinnedSource } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const source = await pinnedSource()
const fixtures = []
const pin = async fixture => fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 }) - 1
const inline = (name, text) => fixtures.push({ name, base64: Buffer.from(text).toString('base64') }) - 1

const bank = await pin('extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/fixtures/endofdreamsbank2.SC2Bank')
const bankText = (await source.read(fixtures[bank].fixture)).bytes.toString('utf8')
const bankLists = [
  await pin('extensions/blizzard/starcraft-2/src/language/test/fixtures/mod/BaseMod/BankList.xml'),
  await pin('extensions/blizzard/starcraft-2/src/language/test/fixtures/mod-families.SC2Mod/BankList.xml'),
]
const typed = inline('Typed.SC2Bank', `<?xml version="1.0" encoding="utf-8"?>
<Bank version="1">
    <Section name="Zeta">
        <Key name="b"><Value int="-12"/></Key>
        <Key name="a"><Value fixed="1.5"/></Key>
        <Key name="Flag"><Value flag="1"/></Key>
        <Key name="Point"><Value point="12.5,-3"/></Key>
        <Key name="Text"><Value text="Line &amp; &lt;b&gt;"/></Key>
        <Key name="Name"><Value string="Unicode \u00e9\u4e2d"/></Key>
    </Section>
    <Section name="Alpha">
        <Key name="Custom">
            <Unit type="Marine" count="3"/>
            <Unit type="Zealot" count="1"/>
        </Key>
        <Key name="Zero"><Value int="0"/></Key>
    </Section>
    <Signature value="0123456789ABCDEF0123456789ABCDEF01234567"/>
</Bank>
`)
const broken = inline('Broken.SC2Bank', `<?xml version="1.0" encoding="utf-8"?>
<Bank version="1">
    <Section name="Dup">
        <Key name="k"><Value int="x1"/></Key>
        <Key name="k"><Value fixed="abc"/></Key>
        <Key name=""><Value flag="2"/></Key>
        <Key name="p"><Value point="1"/></Key>
        <Key name="u"><Value weird="1"/></Key>
        <Key name="m"><Value int="1"/><Unit a="b"/></Key>
    </Section>
    <Section name="Dup"/>
    <Section name=""/>
</Bank>
`)
const notBank = inline('Notes.SC2Bank', '<?xml version="1.0"?><Catalog/>')
const signatureInfo = { bankName: 'endofdreamsbank2', authorId: '2-S2-1-1234567', playerId: '2-S2-1-7654321' }

const cases = []
const tagged = new Map()
const add = (probe, id, input, tags = []) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  for (const tag of [probe, ...tags]) tagged.set(tag, [...(tagged.get(tag) ?? []), `${probe}/${id}`])
}
for (const f of [bank, typed, broken]) {
  add('parse', f, { f })
  add('sort', f, { f })
  add('serialize', `${f}d`, { f })
  add('serialize', `${f}s`, { f, options: { sort: true } })
  add('serialize', `${f}g`, { f, options: { sort: true, signatureInfo } })
  add('lookup', f, { f })
  add('validate', `${f}d`, { f })
  add('validate', `${f}r`, { f, options: { requireSignature: true, signatureInfo } })
  add('metadata', f, { f })
  add('export.raw', f, { f })
  add('signature', f, { f, signatureInfo })
  add('verify', f, { f, signatureInfo })
}
for (const f of [bank, typed, broken, notBank]) add('detect', f, { f })
add('detect', 'ext', { f: inline('Plain.txt', bankText) })
add('values', 0, {
  f: bank,
  values: [['int', 5], ['int', '7'], ['fixed', 1.25], ['fixed', '2.5'], ['flag', true], ['flag', 0], ['flag', '1'],
    ['string', 'x'], ['text', 'y'], ['point', { x: 1, y: 2 }], ['point', '3,4'], ['bogus', 1]],
})
add('patch', 'same', { f: bank, patch: { section: 'Stats', key: 'Score', type: 'int', value: '42' } })
add('patch', 'type', { f: bank, patch: { section: 'Stats', key: 'Score', type: 'string', value: 'high' } })
add('patch', 'missing', { f: bank, patch: { section: 'Stats', key: 'Nope', type: 'int', value: '1' } })
add('patch', 'custom', { f: typed, patch: { section: 'Alpha', key: 'Custom', type: 'int', value: '1' } })
add('patch', 'text', { f: typed, patch: { section: 'Zeta', key: 'Text', type: 'text', value: 'a & <b> "q"' } })
add('editor', 'script', {
  f: bank,
  script: [
    ['get', 'Stats', 'Score'], ['getAny', 'Ranks', 'Rank'], ['getString', 'Stats', 'Score'], ['getInt', 'Ranks', 'Rank', 3],
    ['getFixed', 'Stats', 'Missing', 2.5], ['getFlag', 'Stats', 'Score'], ['setInt', 'New', 'I', 9], ['setFixed', 'New', 'F', 0.25],
    ['setString', 'New', 'S', 's'], ['setText', 'New', 'T', 't'], ['setFlag', 'New', 'B', true], ['setPoint', 'New', 'P', { x: 1, y: 2 }],
    ['set', 'Stats', 'Score', 'fixed', 3.5], ['removeKey', 'Stats', 'EasyWins'], ['removeKey', 'Stats', 'Nope'],
    ['removeSection', 'Ranks'], ['sort'], ['sign', signatureInfo], ['verify', signatureInfo], ['verify'],
  ],
}, ['editor.api'])
add('infer', 0, {
  f: bank,
  paths: [
    'C:/Users/X/Documents/StarCraft II/Accounts/1/2-S2-1-7654321/Banks/2-S2-1-1234567/endofdreamsbank2.SC2Bank',
    '/home/x/StarCraft II/Accounts/1/1-S2-1-1/Banks/1-S2-1-2/Name.sc2bank',
    'D:/Banks/Name.SC2Bank',
    'C:/Banks/2-S2-1-1234567/NotBank.txt',
  ],
})
for (const f of bankLists) {
  add('banklist', f, {
    f,
    discovered: [
      { path: '/x/Banks/2-S2-1-1/EndOfDreamsBank2.SC2Bank', info: { bankName: 'EndOfDreamsBank2', authorId: '2-S2-1-1' } },
      { path: '/x/Banks/2-S2-1-1/other.SC2Bank', info: { bankName: 'other' } },
    ],
  })
}
const tree = [
  ['Accounts/1/2-S2-1-7654321/Banks/2-S2-1-1234567/endofdreamsbank2.SC2Bank', bankText],
  ['Accounts/1/2-S2-1-7654321/Banks/2-S2-1-1234567/Deep/Nested/Other.sc2bank', bankText],
  ['Accounts/1/2-S2-1-7654321/Banks/readme.txt', 'x'],
]
add('discover', 'all', { f: bank, tree })
add('discover', 'shallow', { f: bank, tree, options: { maxDepth: 2 } })
const player = 'Accounts/1/2-S2-1-7654321/Banks/2-S2-1-1234567/endofdreamsbank2.SC2Bank'
add('io', 'plain', { f: bank, relativePath: player })
add('io', 'validate', { f: broken, relativePath: 'Broken.SC2Bank', load: { validate: true }, save: { validate: true } })
add('io', 'sign', { f: bank, relativePath: player, save: { sign: true, signatureInfo, createDirs: true } })
for (const [id, args, readBack] of [
  ['help', ['help']],
  ['read', ['read', '<file>']],
  ['read-json', ['read', '<file>', '--json']],
  ['validate', ['validate', '<file>']],
  ['validate-sig', ['validate', '<file>', '--require-signature']],
  ['verify', ['verify', '<file>']],
  ['verify-explicit', ['verify', '<file>', '--bank-name', 'b', '--author-id', '2-S2-1-1', '--player-id', '2-S2-1-2']],
  ['sign', ['sign', '<file>'], true],
  ['set', ['set', '<file>', 'Stats', 'Score', 'int', '5', '--no-sign'], true],
  ['set-sign', ['set', '<file>', 'Stats', 'Score', 'fixed', '1.5', '--sign'], true],
  ['discover', ['discover', '<root>', '--json']],
  ['unknown', ['frobnicate']],
])
  add('cli', id, { f: bank, relativePath: player, args, ...(readBack ? { readBack: true } : {}) })
add('cli', 'banklist', { f: bankLists[0], relativePath: 'BankList.xml', args: ['list-banklist', '<file>', '--json', '--discover', '<root>'] })

const proofs = claims.features.map(([hash, ...tags]) => ({
  requirement: `legacy/codec-manifest/modkit/sc2-bank/feature/${hash}`,
  kind: 'feature',
  adapterOperation: 'sc2-bank.features-parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'Pinned MK2 bank and BankList fixtures with synthetic banks, paths and a temporary discovery tree; no user bank files.',
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-bank-features corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
