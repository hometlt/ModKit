// Builds corpus.json: pinned MK2 DocumentHeader/DocumentInfo/.version fixtures, loose installed
// StarCraft II maps and mods (published MK3 installation discovery) and synthetic header variants.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/sc2-document-metadata/build-corpus.mjs
//   node reports/parity/sc2-document-metadata/run.mjs --config <absolute>/reports/parity/sc2-document-metadata/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/sc2-document-metadata/receipt.json --check
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes, installedFiles, mk2Root, pinnedSource } from '../lib/kit.mjs'
import { handlers } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/mod/codecs/document-metadata/codec.json'
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const METADATA = /\/(DocumentHeader|DocumentInfo|[^/]+\.version)$/iu

const fixtures = []
const source = await pinnedSource()
for (const fixture of execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n').filter(file => METADATA.test(`/${file}`)).sort())
  fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 })
const formatOf = raw => {
  const magic = Buffer.from(raw.subarray(0, 4)).toString('latin1')
  return raw.length >= 48 && magic === 'H2CS' ? 'header'
    : raw.length === 0 || magic === 'cdes' ? 'version'
      : 'info'
}
const pinnedCount = fixtures.length
const installed = await installedFiles(file => !file.includes('/.backups/') && METADATA.test(file), { maxBytes: 1_000_000 })
// Identical installed bytes add time, not coverage: keep the first path per content hash.
// The sample is capped per format to keep the receipt compact; headers with a non-standard
// marker, signature or artifact type are always kept.
const seen = new Set(fixtures.map(item => item.sha256))
const perFormat = new Map()
for (const item of installed) {
  if (seen.has(item.sha256)) continue
  seen.add(item.sha256)
  const bytes = Buffer.from(await caseBytes(item))
  const format = formatOf(bytes)
  const anomalous = format === 'header' &&
    (bytes.readUInt32LE(0x04) !== 8 || bytes.readUInt32LE(0x08) !== 0x5332 || ![0, 2].includes(bytes.readUInt32LE(0x18)))
  const taken = perFormat.get(format) ?? 0
  if (!anomalous && taken >= 60) continue
  perFormat.set(format, taken + 1)
  fixtures.push({ install: item.install, sha256: item.sha256 })
}

const cases = []
const tagged = new Map()
const add = (probe, id, input, tags = []) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  for (const tag of [probe, ...tags]) tagged.set(tag, [...(tagged.get(tag) ?? []), `${probe}/${id}`])
}
const headers = []
const count = fixtures.length
for (let f = 0; f < count; f++) {
  const bytes = await caseBytes(fixtures[f])
  const format = formatOf(bytes)
  add('detect', f, { f })
  add('view.inspect', f, { f }, [`view.inspect.${format}`])
  add('asset.validate', f, { f })
  add('export.raw', f, { f })
  add('export.convert', f, { f })
  if (format === 'header') headers.push(bytes)
  if (format !== 'version') {
    add('edit.content', `${f}c`, { f, dependencies: [] })
    add('edit.content', `${f}d`, { f, dependencies: ['bnet:Liberty (Mod)/0.0/999,file:Mods/Liberty.SC2Mod', 'file:Mods/Parity.SC2Mod'] })
  }

}
// Synthetic DocumentHeader variants: each check of asset.validate fires once.
const header = headers[0]
for (const [name, offset, value] of [['marker', 0x04, 7], ['signature', 0x08, 0x5333], ['artifact-type', 0x18, 5]]) {
  const bytes = Buffer.from(header)
  bytes.writeUInt32LE(value, offset)
  const f = fixtures.push({ name: `Synthetic/${name}/DocumentHeader`, base64: bytes.toString('base64') }) - 1
  add('asset.validate', f, { f })
  add('view.inspect', f, { f }, ['view.inspect.header'])
}
// Synthetic detection inputs that must be refused, and an empty sidecar inside and outside SC2 context.
for (const [name, base64] of [
  ['Maps/Parity.SC2Map/MapInfo.version', ''],
  ['Parity/Loose.version', ''],
  ['Maps/Parity.SC2Map/DocumentInfo', Buffer.from('<?xml version="1.0"?><Catalog/>').toString('base64')],
  ['Maps/Parity.SC2Map/Truncated.version', Buffer.from([0x63, 0x64, 0x65, 0x73, 0, 0, 0, 0, 2, 0, 0, 0]).toString('base64')],
]) {
  const f = fixtures.push({ name, base64 }) - 1
  add('detect', f, { f })
}

const proofs = [
  ...claims.features.map(([hash, ...tags]) => ({ requirement: `legacy/codec-manifest/modkit/sc2-document-metadata/feature/${hash}`, kind: 'feature', tags })),
  ...claims.operations.map(([legacy, ...tags]) => ({
    requirement: `legacy/codec-manifest/modkit/sc2-document-metadata/operation/${legacy}`,
    kind: 'operation', tags, legacyOperation: legacy, targetOperation: legacy,
    handlerId: handlers[legacy], contribution, executed: true,
  })),
].map(({ tags, ...proof }) => ({
  ...proof,
  adapterOperation: 'sc2-document-metadata.parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: `${pinnedCount} pinned MK2 metadata fixtures, ${count - pinnedCount} distinct loose installed DocumentHeader/DocumentInfo/.version files, synthetic header variants and detection inputs.`,
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`sc2-document-metadata corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
