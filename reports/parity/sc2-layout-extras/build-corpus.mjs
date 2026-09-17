// Builds corpus.json for SC2Layout detection, the simple parser and reference rename, on the inputs
// of ../sc2-layout plus synthetic detection inputs.
//   node reports/parity/sc2-layout-extras/build-corpus.mjs
//   node reports/parity/sc2-layout-extras/run.mjs --config <absolute>/reports/parity/sc2-layout-extras/config.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const { fixtures } = JSON.parse(await readFile(path.join(here, '../sc2-layout/corpus.json'), 'utf8'))
const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
const values = ['@UI/Texture', '*@UI/Literal', '@@Alias', 'Assets\\Textures\\x.dds', '@', '']
for (const [f, item] of [...fixtures.entries()]) {
  const text = new TextDecoder().decode(await caseBytes(item))
  add('detect', f, { f })
  if (!/<Desc[\s>]/u.test(text)) continue
  add('parse', f, { f, values })
  const match = /val="@?(\w+)\/(\w+)\/([^"]+)"/u.exec(text)
  if (match) add('rename', `${f}r`, { f, request: { namespace: match[1], oldId: match[2], newId: `${match[2]}Parity` } })
  add('rename', `${f}0`, { f, request: { namespace: 'Unit', oldId: 'ParityNoSuch', newId: 'ParityRenamed' } })
}
for (const [name, text] of [
  ['Parity/UI/Layout/Plain.SC2Layout', '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n</Desc>\n'],
  ['Parity/UI/Layout/Other.xml', '<?xml version="1.0"?><Catalog/>'],
  ['Parity/Notes.SC2Layout', 'not xml'],
  ['Parity/NoExt', '<?xml version="1.0" encoding="utf-8" standalone="yes"?><Desc><Frame type="Frame" name="A"/></Desc>'],
]) {
  const f = fixtures.push({ name, base64: Buffer.from(text).toString('base64') }) - 1
  add('detect', f, { f })
}
const proof = (hash, ...tags) => ({
  requirement: `legacy/codec-manifest/modkit/sc2-layout/feature/${hash}`,
  kind: 'feature',
  adapterOperation: 'sc2-layout.extras-parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
})
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'Inputs of ../sc2-layout (pinned MK2 and installed mod layouts) plus synthetic detection inputs.',
  fixtures,
  cases,
  proofs: [proof('631facb9fe735bd2', 'detect'), proof('fc1a57ee3ba6a843', 'parse'), proof('ef570244a04485ae', 'rename')],
}, 0))
console.log(`sc2-layout-extras corpus: ${fixtures.length} inputs, ${cases.length} cases`)
