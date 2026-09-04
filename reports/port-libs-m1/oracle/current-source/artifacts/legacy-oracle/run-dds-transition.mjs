import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, sha256, digestManifest } from './load-mk2.mjs'
const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const mode = process.argv[2]
if (!['old', 'new'].includes(mode)) throw new Error('Usage: node run-dds-transition.mjs old|new')
const output = path.join(codingRoot, 'artifacts/legacy-parity-sc2/m1-2026-09-04/oracle')
await mkdir(output, { recursive: true })
const accepted = JSON.parse(await readFile(path.join(codingRoot, 'modkit-core/reports/legacy-parity-textures-m0/receipt.json'), 'utf8'))
let failed = 0
async function run(name) {
  const harness = `artifacts/legacy-parity-textures/${name}${mode === 'old' ? '.old-m1' : ''}.mjs`
  const args = ['--experimental-strip-types', harness, '--corpus', 'C:/FILES/SC2Files/Mods']
  const corpusPath = path.join(output, `${name}.${mode}.corpus.json`)
  const logPath = path.join(output, `${name}.${mode}.log`)
  const chunks = []
  const stdout = []
  const stderr = []
  const startedAt = new Date().toISOString()
  const env = { ...process.env, MK2_CORPUS_RECORD: corpusPath, MK2_ORACLE_EVIDENCE: path.join(output, `${name}.new.loader.json`) }
  env.MK3_REFERENCE_MANIFEST = path.join(output, 'mk3-reference.json')
  if (mode === 'new') env.MK2_CORPUS_EXPECT = path.join(output, `${name}.old.corpus.json`)
  const child = spawn(process.execPath, args, { cwd: codingRoot, env, windowsHide: true })
  child.stdout.on('data', bytes => { chunks.push(bytes); stdout.push(bytes) })
  child.stderr.on('data', bytes => { chunks.push(bytes); stderr.push(bytes) })
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  const log = Buffer.concat(chunks)
  await writeFile(logPath, log)
  await writeFile(path.join(output, `${name}.${mode}.stdout.log`), Buffer.concat(stdout))
  await writeFile(path.join(output, `${name}.${mode}.stderr.log`), Buffer.concat(stderr))
  const expected = accepted.gates.find(gate => gate.id === name)
  const text = Buffer.concat(stdout).toString()
  const match = text.match(/compared (\d+) (file|surface|case)\(s\)(?: against the legacy decoder)?: (\d+) (?:byte-)?identical, (\d+) differing/u)
  const measurements = match && { compared: Number(match[1]), unit: match[2], identical: Number(match[3]), differing: Number(match[4]) }
  let corpus = null
  try { corpus = JSON.parse(await readFile(corpusPath, 'utf8')) } catch {}
  const summaryMatchesM0 = JSON.stringify(measurements) === JSON.stringify(expected.measurements)
  let outputMatchesOld = null
  if (mode === 'new') {
    let oldStdout
    try { oldStdout = await readFile(path.join(output, `${name}.old.stdout.log`), 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
      oldStdout = await readFile(path.join(output, `${name}.old.log`), 'utf8')
    }
    outputMatchesOld = text === oldStdout
  }
  const pass = exitCode === 0 && summaryMatchesM0 && (mode === 'old' || outputMatchesOld) && corpus?.files.length > 0
  const reference = JSON.parse(await readFile(env.MK3_REFERENCE_MANIFEST, 'utf8'))
  const receipt = { milestone: 'M1', step: '0.3', mode, name, command: `node ${args.join(' ')}`, environment: { MK3_REFERENCE_MANIFEST: env.MK3_REFERENCE_MANIFEST }, mk3Commit: reference.commit, startedAt, finishedAt: new Date().toISOString(), exitCode, measurements, expectedM0: expected.measurements, summaryMatchesM0, outputMatchesOld, corpusFiles: corpus?.files.length, corpusDigest: corpus && digestManifest(corpus), logSha256: sha256(log), verdict: pass ? 'pass' : 'fail', limitations: ['Legacy-only refusals remain legacy-only, not both-refused or successful semantic coverage.', 'Synthetic inputs and case order are identified by preserved harness digest; actual real DDS reads are recorded with order and byte hashes.', 'MK3 side is isolated accepted M0; current M1 tree parity requires a separate post-freeze run.'] }
  await writeFile(path.join(output, `${name}.${mode}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`${mode} ${name}: exit ${exitCode}, counts ${measurements?.compared}, M0 ${summaryMatchesM0}, old/new ${outputMatchesOld}, ${receipt.verdict}`)
  if (!pass) failed++
}
// Two independent read-only harnesses at a time, without timeouts or sampling overrides.
for (let index = 0; index < names.length; index += 2) await Promise.all(names.slice(index, index + 2).map(run))
if (failed) process.exitCode = 1
