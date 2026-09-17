// SC2Layout reference-rename cases that actually rewrite values (the renamer maps the last key
// segment), on the ../sc2-layout inputs plus a synthetic layout with literal and @@ references.
// Uses the ../sc2-layout-extras adapters.
//   node reports/parity/sc2-layout-rename/build-corpus.mjs
//   node reports/parity/sc2-layout-rename/run.mjs --config <absolute>/reports/parity/sc2-layout-rename/config.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const { fixtures } = JSON.parse(await readFile(path.join(here, '../sc2-layout/corpus.json'), 'utf8'))
fixtures.push({
  name: 'Parity/UI/Layout/Rename.SC2Layout',
  base64: Buffer.from(`${String.fromCharCode(0xfeff)}<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Desc>
    <Frame type="Button" name="Attack">
        <Shortcut val="@Button/Hotkey/Attack"/>
        <Tooltip val="*@Button/Tooltip/Attack"/>
        <Texture val="@@UI/Attack"/>
        <Text val="@UI/Attack"/>
        <Text val="Attack"/>
    </Frame>
</Desc>
`).toString('base64'),
})
const cases = []
for (const [f, item] of fixtures.entries()) {
  const text = new TextDecoder().decode(await caseBytes(item))
  if (!/<Desc[\s>]/u.test(text)) continue
  const seen = new Set()
  for (const match of text.matchAll(/val="\*?@@?([^"/]+)\/(?:[^"]*\/)?([^"/]+)"/gu)) {
    const request = { namespace: match[1], oldId: match[2], newId: `${match[2]}Parity` }
    const key = JSON.stringify(request)
    if (seen.has(key) || seen.size >= 3) continue
    seen.add(key)
    cases.push({ id: `rename/${f}/${seen.size}`, input: { probe: 'rename', f, request } })
  }
}
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'Rewriting reference-rename requests on the ../sc2-layout inputs and a synthetic BOM layout.',
  fixtures,
  cases,
  proofs: [{
    requirement: 'legacy/codec-manifest/modkit/sc2-layout/feature/ef570244a04485ae',
    kind: 'feature',
    adapterOperation: 'sc2-layout.extras-parity',
    caseIds: cases.map(item => item.id),
  }],
}, 0))
console.log(`sc2-layout-rename corpus: ${cases.length} cases`)
