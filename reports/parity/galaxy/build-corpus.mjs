// Builds corpus.json from pinned MK2 Galaxy fixtures (Git blobs at the oracle pin).
// Offsets are chosen deterministically from the pinned bytes; no working-tree file is read.
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/galaxy/build-corpus.mjs
//   node reports/parity/galaxy/run.mjs --config <absolute>/reports/parity/galaxy/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/galaxy/receipt.json --check
// MODKIT_PARITY_CACHE may point the pinned-oracle bundle cache anywhere outside the repositories.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pinnedSource } from '../lib/kit.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { execFileSync } from 'node:child_process'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { mk2Root } from '../lib/kit.mjs'
import { handlers } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/galaxy/codecs/galaxy/codec.json'
const fixtures = execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\n')
  .filter(file => file.endsWith('.galaxy'))
  .sort()
const divergences = JSON.parse(await readFile(path.join(here, 'divergences.json'), 'utf8'))
const gated = new Set(divergences.fixtures)
const source = await pinnedSource()
const cases = []
const byProbe = new Map()
const add = (probe, id, input) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  byProbe.set(probe, [...(byProbe.get(probe) ?? []), `${probe}/${id}`])
}
const records = []
for (const fixture of fixtures) {
  const record = await source.read(fixture)
  records.push({ fixture, sha256: record.sha256, text: record.bytes.toString('utf8') })
}
const whole = ['view.inspect', 'script.symbols', 'asset.validate', 'type-check', 'export.convert', 'analyze-script', 'language-index', 'to-engine']
for (const [f, { fixture, text }] of records.entries()) {
  const ref = { f }
  for (const probe of whole) if (!(gated.has(fixture) && divergences.probes.includes(probe))) add(probe, f, ref)
  add('script.format', `${f}d`, ref)
  add('script.format', `${f}s`, { ...ref, options: { insertSpaces: true, tabSize: 2, finalNewline: true } })
  // Identifier offsets: first two distinct identifiers that are immediately called or declared.
  const offsets = []
  const seen = new Set()
  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
    if (seen.has(match[1]) || ['if', 'while', 'for', 'return', 'switch'].includes(match[1])) continue
    seen.add(match[1])
    offsets.push({ offset: match.index + 1, name: match[1] })
    if (offsets.length === 2) break
  }
  for (const { offset, name } of offsets) {
    add('script.references', `${f}@${offset}`, { ...ref, offset })
    add('script.completion', `${f}@${offset}`, { ...ref, offset })
    add('language-at', `${f}@${offset}`, { ...ref, offset })
    if (!gated.has(fixture)) add('edit.structure', `${f}@${offset}`, { ...ref, offset, newName: `${name}_renamed` })
  }
  // Completion at end of file.
  add('script.completion', `${f}@end`, { ...ref, offset: text.length })
}
add('script.compile', 0, { f: 0 })
// Multi-file workspaces: sibling fixtures sharing a directory, target symbol declared in the first file.
const groups = new Map()
for (const [f, record] of records.entries()) groups.set(path.posix.dirname(record.fixture), [...(groups.get(path.posix.dirname(record.fixture)) ?? []), { ...record, f }])
for (const members of groups.values()) {
  if (members.length < 2) continue
  const first = members[0]
  const match = /\b(?:void|int|bool|fixed|string|unit|point)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(first.text)
  if (!match) continue
  const offset = match.index + match[0].indexOf(match[1]) + 1
  add('workspace', first.f, {
    files: members.slice(0, 4).map(item => item.f),
    symbol: match[1],
    offset,
  })
}

const feature = (hash, ...probes) => ({ requirement: `legacy/codec-manifest/modkit/galaxy/feature/${hash}`, kind: 'feature', probes })
const operation = legacy => ({
  requirement: `legacy/codec-manifest/modkit/galaxy/operation/${legacy}`,
  kind: 'operation',
  probes: [legacy],
  legacyOperation: legacy,
  targetOperation: legacy,
  handlerId: handlers[legacy],
  contribution,
  executed: true,
})
const claims = [
  feature('07d548c77579f8ed', 'workspace'),
  feature('1383a83c2b585e7a', 'analyze-script'),
  feature('1d0afa85c36188cf', 'script.symbols'),
  feature('252e2cacb2830db7', 'script.references'),
  feature('29f65483b2fa01ab', 'script.compile'),
  feature('429c80cac335d506', 'script.completion'),
  feature('4f9a12a69da3135b', 'export.convert'),
  feature('59a4a5fd3d65ae64', 'edit.structure'),
  feature('8a8d967eb1bbc06e', 'language-index'),
  feature('9f0fb87bc2f25373', 'to-engine'),
  feature('a2ffa463f1509b05', 'script.format'),
  feature('b4c751d6594c32ce', 'type-check'),
  feature('c83412c572a2e7b2', 'view.inspect', 'export.convert'),
  feature('d24505df1a08d94b', 'asset.validate'),
  ...['view.inspect', 'script.symbols', 'script.references', 'asset.validate', 'script.completion', 'script.format', 'edit.structure', 'export.convert'].map(operation),
]
const proofs = claims.map(({ probes, ...proof }) => ({
  ...proof,
  adapterOperation: 'galaxy.parity',
  caseIds: probes.flatMap(probe => byProbe.get(probe) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  fixtures: records.map(({ fixture, sha256 }) => ({ fixture, sha256 })),
  description: `Pinned MK2 Galaxy fixtures (${records.length} Git blobs at ${MK2_PIN}): authored parser/checker/service fixtures and real SC2Map/SC2Mod MapScripts.`,
  cases,
  proofs,
}, 0))
console.log(`galaxy corpus: ${records.length} fixtures, ${cases.length} cases, ${proofs.length} proofs`)
