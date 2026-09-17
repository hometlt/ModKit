// Builds corpus.json for Galaxy detection, batch checking and fallback auditing: pinned MK2 Galaxy
// and TriggerData fixtures, loose installed mod Lib*.galaxy (published MK3 installation discovery)
// and the extracted base-game natives/NativeLib/GameData Galaxy libraries (hash-bound referenced
// corpus, SC2_TRIGGERLIBS overrides the directory).
// Reproduce (from modkit-core, after building modkit-extensions-blizzard/starcraft2):
//   node reports/parity/galaxy-extras/build-corpus.mjs
//   node reports/parity/galaxy-extras/run.mjs --config <absolute>/reports/parity/galaxy-extras/config.json
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MK2_PIN } from '../../../scripts/migration/lib/legacy-oracle.mjs'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { installedFiles, mk2Root, pinnedSource, sc2Install, sha256 } from '../lib/kit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const claims = JSON.parse(await readFile(path.join(here, 'claims.json'), 'utf8'))
const triggerLibs = (process.env.SC2_TRIGGERLIBS ?? 'C:/FILES/SC2Files/Mods/Builtin/mods/core.sc2mod/base.sc2data/triggerlibs').replaceAll('\\', '/')
const fixtures = []
const file = async absolute => fixtures.push({ file: absolute, sha256: sha256(await readFile(absolute)) }) - 1
const source = await pinnedSource()
const pinned = async fixture => fixtures.push({ fixture, sha256: (await source.read(fixture)).sha256 }) - 1

const tree = execFileSync('git', ['-C', mk2Root, 'ls-tree', '-r', '--name-only', MK2_PIN], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
const galaxyFixtures = []
for (const item of tree.filter(item => item.endsWith('.galaxy')).sort()) galaxyFixtures.push(await pinned(item))
const triggerFixtures = []
for (const item of ['extensions/blizzard/starcraft-2/codecs/sc2-mod/test/fixtures/RuntimeFixture.SC2Map/Triggers',
  'extensions/blizzard/starcraft-2/codecs/sc2-triggers/test/core-fixtures/fixtures/crlf-map.Triggers'])
  triggerFixtures.push(await pinned(item))
const root = (await sc2Install()).replaceAll('\\', '/')
const installedGalaxy = []
for (const item of await installedFiles(name => /\/Base\.SC2Data\/Lib\w+\.galaxy$/iu.test(name) && name.startsWith('Mods/') && !name.includes('/.backups/')))
  installedGalaxy.push(await file(`${root}/${item.install}`))
const installedTriggers = []
for (const item of await installedFiles(name => /\/Triggers$/iu.test(name) && name.startsWith('Mods/') && !name.includes('/.backups/'), { maxBytes: 800_000 }))
  installedTriggers.push(await file(`${root}/${item.install}`))
const deps = []
for (const name of ['natives.galaxy', 'nativelib.galaxy', 'nativelib_h.galaxy']) deps.push(await file(`${triggerLibs}/${name}`))
for (const name of (await readdir(`${triggerLibs}/gamedata`)).filter(item => item.endsWith('.galaxy')).sort())
  deps.push(await file(`${triggerLibs}/gamedata/${name}`))

const cases = []
const tagged = new Map()
const add = (probe, id, input) => {
  cases.push({ id: `${probe}/${id}`, input: { probe, ...input } })
  tagged.set(probe, [...(tagged.get(probe) ?? []), `${probe}/${id}`])
}
for (const f of [...galaxyFixtures, ...installedGalaxy]) {
  add('detect', f, { f })
  add('galaxy-audit', f, { f })
  add('sentinels', f, { f })
}
for (const f of [...triggerFixtures, ...installedTriggers]) {
  add('detect', f, { f })
  add('trigger-audit', f, { f })
}
for (const [index, f] of installedGalaxy.entries()) add('audit-compare', f, { f, baseline: installedGalaxy[(index + 1) % installedGalaxy.length] })
// Per mod: its own libraries against the base-game dependency set, and once without dependencies.
const byMod = new Map()
for (const f of installedGalaxy) {
  const mod = fixtures[f].file.replace(/\/Base\.SC2Data\/.*$/iu, '')
  byMod.set(mod, [...(byMod.get(mod) ?? []), f])
}
for (const [mod, targets] of byMod) {
  const id = path.posix.basename(mod)
  add('galaxy-check', `${id}+deps`, { targets, deps })
  add('galaxy-check', `${id}`, { targets, deps: [] })
}

const proofs = claims.features.map(([hash, ...tags]) => ({
  requirement: `legacy/codec-manifest/modkit/galaxy/feature/${hash}`,
  kind: 'feature',
  adapterOperation: 'galaxy.extras-parity',
  caseIds: tags.flatMap(tag => tagged.get(tag) ?? []),
}))
await writeFile(path.join(here, 'corpus.json'), stable({
  schemaVersion: 1,
  kind: 'mixed',
  description: 'Pinned MK2 Galaxy/TriggerData fixtures, loose installed mod Lib*.galaxy and Triggers, extracted base-game natives/NativeLib/GameData Galaxy as checker dependencies.',
  fixtures,
  cases,
  proofs,
}, 0))
console.log(`galaxy-extras corpus: ${fixtures.length} inputs, ${cases.length} cases, ${proofs.length} proofs`)
