import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const output = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(output, '../../../../..')
const core = path.join(workspace, 'modkit-core')
const baseline = path.join(core, 'reports/port-libs-m1/current-parity')
const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const sha256 = value => createHash('sha256').update(value).digest('hex')
const normalize = text => text.replaceAll('\r\n', '\n')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
const loaderPath = path.join(core, 'scripts/migration/lib/legacy-oracle.mjs')
const loaderSha256 = sha256(await readFile(loaderPath))
const expectedLoaderSha256 = 'aff3a93efd6d5fc05864c7655b4a31e19fba2e5b4a2df301589f26bfd7912a7d'
if (loaderSha256 !== expectedLoaderSha256) throw new Error('Unexpected loader bytes before regression')
const gitIdentity = () => ({
  head: execFileSync('git', ['-C', core, 'rev-parse', 'HEAD']).toString().trim(),
  trackedDiffSha256: sha256(execFileSync('git', ['-C', core, 'diff', '--binary', 'HEAD'], { maxBuffer: 128 * 1024 * 1024 })),
})
async function implementationFiles() {
  const files = []
  async function visit(relative) {
    for (const item of (await readdir(path.join(core, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${item.name}`
      if (item.isDirectory()) await visit(file)
      else if (item.isFile()) files.push({ path: file, sha256: sha256(await readFile(path.join(core, file))) })
    }
  }
  for (const directory of ['extensions/images/src', 'extensions/images/vendor', ...['codec-kit', 'host', 'sdk', 'core', 'vfs'].map(name => `packages/${name}/dist`)]) await visit(directory)
  return files
}
const before = { git: gitIdentity(), implementationFiles: await implementationFiles() }
await writeJson(path.join(output, 'before.json'), before)
const receipts = []
for (const name of names) {
  const expectedReceipt = await readJson(path.join(baseline, `${name}.current.receipt.json`))
  let expectedCorpusBytes
  try { expectedCorpusBytes = await readFile(path.join(baseline, `${name}.current.corpus.json`)) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    expectedCorpusBytes = gunzipSync(await readFile(path.join(baseline, `${name}.current.corpus.json.gz`)))
  }
  const expectedCorpus = JSON.parse(expectedCorpusBytes)
  if (!expectedCorpus.files.length) throw new Error(`Empty accepted corpus: ${name}`)
  const expectedCorpusPath = path.join(output, `${name}.expected-corpus.json`)
  await writeFile(expectedCorpusPath, expectedCorpusBytes)
  const corpusPath = path.join(output, `${name}.corpus.json`)
  const loaderEvidencePath = path.join(output, `${name}.loader.json`)
  const harness = `artifacts/legacy-parity-textures/${name}.mjs`
  const args = ['--experimental-strip-types', harness, '--corpus', 'C:/FILES/SC2Files/Mods']
  const command = `node ${args.join(' ')}`
  if (command !== expectedReceipt.command) throw new Error(`Command changed: ${name}`)
  const env = { ...process.env, MK2_CORPUS_EXPECT: expectedCorpusPath, MK2_CORPUS_RECORD: corpusPath, MK2_ORACLE_EVIDENCE: loaderEvidencePath }
  delete env.MK3_REFERENCE_MANIFEST
  const stdout = [], stderr = []
  const startedAt = new Date().toISOString()
  console.log(`${startedAt} START ${name}`)
  const child = spawn(process.execPath, args, { cwd: workspace, env, windowsHide: true })
  child.stdout.on('data', bytes => stdout.push(bytes))
  child.stderr.on('data', bytes => stderr.push(bytes))
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  const text = Buffer.concat(stdout).toString()
  await writeFile(path.join(output, `${name}.stdout.log`), text)
  await writeFile(path.join(output, `${name}.stderr.log`), Buffer.concat(stderr))
  const match = text.match(/compared (\d+) (file|surface|case)\(s\)(?: against the legacy decoder)?: (\d+) (?:byte-)?identical, (\d+) differing/u)
  const measurements = match && { compared: Number(match[1]), unit: match[2], identical: Number(match[3]), differing: Number(match[4]) }
  let corpus, loaderEvidence
  try { corpus = await readJson(corpusPath); loaderEvidence = await readJson(loaderEvidencePath) } catch {}
  const oldText = await readFile(path.join(baseline, `${name}.current.stdout.log`), 'utf8')
  const matchesM1 = JSON.stringify(measurements) === JSON.stringify(expectedReceipt.measurements)
  const stdoutMatchesM1 = normalize(text) === normalize(oldText)
  const corpusMatchesM1 = JSON.stringify(corpus) === JSON.stringify(expectedCorpus)
  const usesFrozenLoader = loaderEvidence?.modules?.length > 0 && loaderEvidence.modules.every(module => module.loader.some(file => path.resolve(file.path) === loaderPath && file.sha256 === loaderSha256))
  const sumMatching = pattern => text.split('\n').reduce((total, line) => {
    const row = line.match(/^\s*(\d+)\s+/u)
    return total + (row && pattern.test(line) ? Number(row[1]) : 0)
  }, 0)
  const refusals = {
    legacyOnly: sumMatching(/:: legacy-refused:/u),
    confirmedBoth: sumMatching(/:: BOTH-REFUSED|:: IDENTICAL \(refused:/u),
    unclassifiedIdenticalMalformed: name === 'compare-legacy-dds-encode' ? sumMatching(/refusal .* :: IDENTICAL$/u) : 0,
  }
  const receipt = {
    schemaVersion: 1, purpose: 'M2 loader peer-dependency regression against accepted M1 texture products',
    name, command, cwd: workspace, startedAt, finishedAt: new Date().toISOString(), exitCode,
    baselineReceipt: path.join(baseline, `${name}.current.receipt.json`),
    loader: { path: loaderPath, sha256: loaderSha256 },
    harnessSha256: sha256(await readFile(path.join(workspace, harness))),
    measurements, expectedM1: expectedReceipt.measurements, refusals,
    corpusFiles: corpus?.files?.length, matchesM1, stdoutMatchesM1, corpusMatchesM1, usesFrozenLoader,
    stdoutSha256: sha256(text), stderrSha256: sha256(Buffer.concat(stderr)),
    verdict: exitCode === 0 && matchesM1 && stdoutMatchesM1 && corpusMatchesM1 && usesFrozenLoader ? 'pass' : 'fail',
    limitations: ['Summary identical includes matched refusals and scalar results; legacy-only refusals do not execute MK3.', 'Encoder retains three malformed-input identical outcomes not classified by its stdout as accepted or refused.'],
  }
  receipts.push(receipt)
  await writeJson(path.join(output, `${name}.receipt.json`), receipt)
  console.log(`${receipt.finishedAt} END ${name} exit=${exitCode} identical=${measurements?.identical} differing=${measurements?.differing} verdict=${receipt.verdict}`)
}
const after = { git: gitIdentity(), implementationFiles: await implementationFiles() }
await writeJson(path.join(output, 'after.json'), after)
const implementationUnchanged = JSON.stringify(before.implementationFiles) === JSON.stringify(after.implementationFiles)
const loaderUnchanged = sha256(await readFile(loaderPath)) === loaderSha256
const verdict = receipts.every(receipt => receipt.verdict === 'pass') && implementationUnchanged && loaderUnchanged ? 'pass' : 'fail'
await writeJson(path.join(output, 'receipt.json'), {
  schemaVersion: 1, verdict, implementationUnchanged, loaderUnchanged,
  processPolicy: 'five unchanged harness commands executed sequentially, no cap overrides or timeouts',
  gates: receipts,
  totals: {
    compared: receipts.reduce((sum, receipt) => sum + (receipt.measurements?.compared ?? 0), 0),
    identical: receipts.reduce((sum, receipt) => sum + (receipt.measurements?.identical ?? 0), 0),
    differing: receipts.reduce((sum, receipt) => sum + (receipt.measurements?.differing ?? 0), 0),
    legacyOnlyRefused: receipts.reduce((sum, receipt) => sum + receipt.refusals.legacyOnly, 0),
    confirmedBothRefused: receipts.reduce((sum, receipt) => sum + receipt.refusals.confirmedBoth, 0),
  },
})
console.log(`FINAL ${verdict}; implementationUnchanged=${implementationUnchanged}; loaderUnchanged=${loaderUnchanged}`)
if (verdict !== 'pass') process.exitCode = 1
