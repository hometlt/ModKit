// Builds corpus.json from the checked-in replay fixtures of modkit-extensions-blizzard (see their
// README for provenance), plus a synthetic non-replay input for detection.
//   node reports/parity/sc2-replay/build-corpus.mjs
//   node reports/parity/sc2-replay/run.mjs --config <absolute>/reports/parity/sc2-replay/config.json
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { sha256, workspace } from '../lib/kit.mjs'
import { handlers } from './native.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const dir = 'modkit-extensions-blizzard/starcraft2/test/fixtures/replays'
const fixtures = []
for (const sub of ['', 'early/'])
  for (const name of (await readdir(path.join(workspace, dir, sub))).filter(item => item.endsWith('.SC2Replay')).sort())
    fixtures.push({ file: `${dir}/${sub}${name}`, sha256: sha256(await readFile(path.join(workspace, dir, sub, name))) })
const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  if (claims.skipProbes[probe] !== undefined) return
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
// Declared divergences (see divergences in claims.json): MK3 opens the pre-tracker Wings of Liberty
// replay that MK2 cannot decode; MK3 decodes game/message events only with an exact bundled
// protocol (MK2 falls back to the nearest build); loops past the end are clamped by MK2 and
// refused (render) or clamped to the tracker timeline (seek) by MK3.
const exactProtocol = file => /Gresvan|Tokamak/u.test(file)
for (const [f, item] of fixtures.entries()) {
  add('detect', f, { f })
  if (item.file.includes('/early/')) continue
  for (const probe of ['view.inspect', 'asset.validate', 'export.raw']) add(probe, f, { f })
  if (exactProtocol(item.file)) for (const probe of ['export.convert', 'sc2-replay.analyze']) add(probe, f, { f })
  for (const loop of [0, 1000, 5000]) {
    add('view.render', `${f}@${loop}`, { f, loop })
    add('media.seek', `${f}@${loop}`, { f, loop })
    add('media.play', `${f}@${loop}`, { f, loop })
  }
}
const junk = fixtures.push({ name: 'Fake.SC2Replay', base64: Buffer.from('MPQ not a replay').toString('base64') }) - 1
add('detect', junk, { f: junk })
const contribution = 'modkit-extensions-blizzard/starcraft2/modules/replay/codecs/replay/codec.json'
const targets = { 'sc2-replay.analyze': 'blizzard/sc2-replay.analyze', 'media.play': 'media.play-pause', 'view.render': 'blizzard/sc2-replay.sample-scene' }
const proofs = [
  ...claims.features.map(([hash, ...tags]) => ({ requirement: `legacy/codec-manifest/modkit/sc2-replay/feature/${hash}`, kind: 'feature', tags })),
  ...claims.operations.map(([legacy, ...tags]) => ({
    requirement: `legacy/codec-manifest/modkit/sc2-replay/operation/${legacy}`, kind: 'operation', tags,
    legacyOperation: legacy, targetOperation: targets[legacy] ?? legacy, handlerId: handlers[legacy], contribution, executed: true,
  })),
].filter(proof => proof.tags.every(tag => claims.skipProbes[tag] === undefined)).map(({ tags, ...proof }) => ({
  ...proof, adapterOperation: 'sc2-replay.parity', caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({ schemaVersion: 1, kind: 'mixed', fixtures, cases, proofs }, 0))
console.log(`sc2-replay corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
