import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, createPinnedSource, sha256, digestManifest, MK2_PIN } from './load-mk2.mjs'
const root = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const mk3Reference = JSON.parse(await readFile(path.join(root, 'mk3-reference.json'), 'utf8'))
const pinned = await createPinnedSource({ repoRoot: path.join(codingRoot, 'references/modkitmk2') })
const originalSourceChecks = []
for (const name of ['dds', 'helpers', 'ops', 'metadata', 'codec']) {
  const { bytes, ...record } = await pinned.read(`extensions/common/images/codecs/dds/src/${name}.ts`)
  const normalizedWorking = (await readFile(path.join(pinned.repoRoot, record.path), 'utf8')).replaceAll('\r\n', '\n')
  const normalizedPin = bytes.toString().replaceAll('\r\n', '\n')
  originalSourceChecks.push({ ...record, lineEndingNormalizedEqual: normalizedWorking === normalizedPin, normalizedSha256: sha256(normalizedPin) })
}
if (originalSourceChecks.some(file => !file.lineEndingNormalizedEqual)) throw new Error('Historical old DDS loader read source content different from pin')
const gates = []
for (const name of names) {
  const old = JSON.parse(await readFile(path.join(root, `${name}.old.receipt.json`), 'utf8'))
  const current = JSON.parse(await readFile(path.join(root, `${name}.new.receipt.json`), 'utf8'))
  const loader = JSON.parse(await readFile(path.join(root, `${name}.new.loader.json`), 'utf8'))
  if (old.verdict !== 'pass' || current.verdict !== 'pass' || old.corpusDigest !== current.corpusDigest) throw new Error(`Transition gate failed: ${name}`)
  if (loader.modules.some(module => module.oracleCommit !== MK2_PIN || module.corpusDigest !== current.corpusDigest)) throw new Error(`Incomplete loader evidence: ${name}`)
  gates.push({ name, oldReceipt: `${name}.old.receipt.json`, newReceipt: `${name}.new.receipt.json`, measurements: current.measurements, corpusDigest: current.corpusDigest, corpusFiles: current.corpusFiles, outputMatchesOld: current.outputMatchesOld, loaderEvidence: `${name}.new.loader.json`, sourceClosures: loader.modules.map(module => ({ entry: module.entry, cacheKey: module.cacheKey, sourceClosureDigest: module.sourceClosureDigest, loaderDigest: module.loaderDigest, dependenciesDigest: module.dependenciesDigest })) })
}
const sourceFiles = ['modkit-core/scripts/migration/lib/legacy-oracle.mjs', 'modkit-core/scripts/migration/test/legacy-oracle.test.mjs', 'artifacts/legacy-oracle/load-mk2.mjs', 'artifacts/legacy-oracle/dds-host-isolation.mjs', 'artifacts/legacy-oracle/track-corpus.mjs', 'artifacts/legacy-oracle/mk3-reference.mjs', 'artifacts/legacy-oracle/run-dds-transition.mjs', 'artifacts/legacy-parity-textures/legacy-mk2.mjs']
const implementation = []
for (const file of sourceFiles) implementation.push({ path: file, sha256: sha256(await readFile(path.join(codingRoot, file))) })
const receipt = { schemaVersion: 1, milestone: 'M1', step: '0.3', verdict: 'pass', generatedAt: new Date().toISOString(), oracleCommit: MK2_PIN, mk3Commit: mk3Reference.commit, mk3Reference: 'mk3-reference.json', originalSourceChecks, gates, implementation, implementationDigest: digestManifest(implementation), limitations: ['This is loader-transition evidence against isolated accepted MK3 M0, not final current M1-tree parity.', 'All original counts and refusal semantics are preserved: MK2-only refusals are not both-refused.', 'Static source closure plus explicitly declared runtime data/dependencies defines each entry; arbitrary runtime filesystem I/O must be declared by its harness.', 'M1 infrastructure readiness does not claim M2 port readiness or M7/M8 full surfaces.'] }
receipt.loaderVersionNote = 'Each new.loader.json loaderSnapshots list identifies the exact tested sources, preserved by sha256 in the versionable selection. Final lint/prettier-only engine cleanup and added syntax fixture are verified separately by oracle-verification.receipt.json. The current implementation hashes below do not replace the tested loader hashes.'
await writeFile(path.join(root, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(`oracle transition: ${gates.length}/5 old/new pairs pass; MK2 ${MK2_PIN}, MK3 ${mk3Reference.commit}`)
