// Builds corpus.json for the sc2-data catalog library slice from the inputs of ../sc2-data
// (pinned MK2 GameData, installed mod GameData, synthetic catalogs).
//   node reports/parity/sc2-data-library/build-corpus.mjs
//   node reports/parity/sc2-data-library/run.mjs --config <absolute>/reports/parity/sc2-data-library/config.json
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const { fixtures } = JSON.parse(await readFile(path.join(here, '../sc2-data/corpus.json'), 'utf8'))
const cases = []
for (const [f, item] of fixtures.entries()) {
  const text = new TextDecoder().decode(await caseBytes(item))
  if (/<Catalog[\s>]/u.test(text) && /\sid="/u.test(text)) cases.push({ id: `library/${f}`, input: { f } })
}
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'Inputs of ../sc2-data: pinned MK2 GameData, installed mod GameData and synthetic catalogs.',
  fixtures,
  cases,
  proofs: claims.features.map(hash => ({
    requirement: `legacy/codec-manifest/modkit/sc2-data/feature/${hash}`,
    kind: 'feature',
    adapterOperation: 'sc2-data.library-parity',
    caseIds: cases.map(item => item.id),
  })),
}, 0))
console.log(`sc2-data-library corpus: ${fixtures.length} inputs, ${cases.length} cases`)
