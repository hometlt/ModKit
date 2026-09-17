// Builds corpus.json: pinned MK2 .SC2Layout fixtures and loose installed mod layouts (published MK3
// installation discovery). Workspace probes load every layout of the same package.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-layout/build-corpus.mjs
//   node reports/parity/sc2-layout/run.mjs --config <absolute>/reports/parity/sc2-layout/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-layout/receipt.json --check
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'
import { handlers, targetOperation } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/layout/codecs/layout/codec.json'
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const LAYOUT = /\.sc2layout$/iu

const fixtures = []
const source = await pinnedSource()
for (const fixture of execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').filter(file => LAYOUT.test(file)).sort())
  fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const pinnedCount = fixtures.length
const seen = new Set(fixtures.map(item => item.sha256))
for (const item of await installedFiles(file => file.startsWith('Mods/') && !file.includes('/.backups/') && LAYOUT.test(file), { maxBytes: 2_000_000 }))
  if (!seen.has(item.sha256)) { seen.add(item.sha256); fixtures.push({ install: item.install, sha256: item.sha256 }) }

const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  if (claims.skipProbes[probe] !== undefined) return
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
// A package is the directory above UI/Layout (or the fixture's own directory).
const packageOf = item => {
  const file = item.install ?? item.fixture
  const at = file.search(/\/UI\/Layout\//iu)
  return at < 0 ? path.posix.dirname(file) : file.slice(0, at)
}
const packages = new Map()
for (const [f, item] of fixtures.entries()) packages.set(packageOf(item), [...(packages.get(packageOf(item)) ?? []), f])
const decoder = new TextDecoder()
let schemaAdded = false
for (const [f, item] of fixtures.entries()) {
  const text = decoder.decode(await caseBytes(item))
  if (!/<Desc[\s>]/u.test(text)) continue
  for (const probe of ['parse', 'view.inspect', 'view.render', 'export.convert', 'export.raw']) add(probe, f, { f })
  const workspace = packages.get(packageOf(item)).slice(0, 40)
  if (!workspace.includes(f)) workspace.push(f)
  add('store-check', f, { f, workspace })
  const frame = /<Frame\b[^>]*\bname="([^"]+)"/u.exec(text)?.[1]
  // A path-named frame overrides base-game UI, whose layouts live in CASC: not resolvable here.
  if (frame !== undefined && !frame.includes('/')) {
    add('render-visual', f, { f, workspace, rootPath: frame })
    if (!schemaAdded) { add('schema', f, { f, rootPath: frame }); schemaAdded = true }
  }
}

const proofs = [
  ...claims.features.map(([hash, ...tags]) => ({ requirement: `legacy/codec-manifest/modkit/sc2-layout/feature/${hash}`, kind: 'feature', tags })),
  ...claims.operations.map(([legacy, ...tags]) => ({
    requirement: `legacy/codec-manifest/modkit/sc2-layout/operation/${legacy}`,
    kind: 'operation', tags, legacyOperation: legacy, targetOperation: targetOperation(legacy),
    handlerId: handlers[legacy], contribution, executed: true,
  })),
].filter(proof => proof.tags.every(tag => claims.skipProbes[tag] === undefined)).map(({ tags, ...proof }) => ({
  ...proof,
  adapterOperation: 'sc2-layout.parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${pinnedCount} pinned MK2 SC2Layout fixtures and ${fixtures.length - pinnedCount} distinct loose installed mod layouts; workspace probes load up to 40 layouts of the same package.`,
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-layout corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
