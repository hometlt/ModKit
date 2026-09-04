import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { codingRoot, sha256, digestManifest } from './load-mk2.mjs'
const names = ['compare-legacy-dds', 'compare-legacy-dds-bptc', 'compare-legacy-dds-compressed', 'compare-legacy-dds-encode', 'compare-legacy-image-ops']
const mode = 'current'
const mk3Root = path.join(codingRoot, 'modkit-core')
const workingIdentity = () => ({ head: execFileSync('git', ['-C', mk3Root, 'rev-parse', 'HEAD']).toString().trim(), diffSha256: sha256(execFileSync('git', ['-C', mk3Root, 'diff', '--binary', 'HEAD'], { maxBuffer: 128 * 1024 * 1024 })) })
const before = workingIdentity()
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
  const env = { ...process.env, MK2_CORPUS_RECORD: corpusPath, MK2_ORACLE_EVIDENCE: path.join(output, `${name}.current.loader.json`) }
  delete env.MK3_REFERENCE_MANIFEST
  if (mode !== 'old') env.MK2_CORPUS_EXPECT = path.join(output, `${name}.old.corpus.json`)
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
  if (mode !== 'old') {
    let oldStdout
    try { oldStdout = await readFile(path.join(output, `${name}.old.stdout.log`), 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
      oldStdout = await readFile(path.join(output, `${name}.old.log`), 'utf8')
    }
    outputMatchesOld = text === oldStdout
  }
  const pass = exitCode === 0 && summaryMatchesM0 && (mode === 'old' || outputMatchesOld) && corpus?.files.length > 0
  const reference = { commit: before.head }
  const receipt = { milestone: 'M1', step: '0.3', mode, name, command: `node ${args.join(' ')}`, environment: { MK3_REFERENCE_MANIFEST: null }, mk3WorkingTree: before, mk3Commit: reference.commit, startedAt, finishedAt: new Date().toISOString(), exitCode, measurements, expectedM0: expected.measurements, summaryMatchesM0, outputMatchesOld, corpusFiles: corpus?.files.length, corpusDigest: corpus && digestManifest(corpus), logSha256: sha256(log), verdict: pass ? 'pass' : 'fail', limitations: ['Legacy-only refusals remain legacy-only, not both-refused or successful semantic coverage.', 'Synthetic inputs and case order are identified by preserved harness digest; actual real DDS reads are recorded with order and byte hashes.', 'MK3 side is the frozen current M1 working tree, identified by HEAD and binary diff digest.'] }
  await writeFile(path.join(output, `${name}.${mode}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`${mode} ${name}: exit ${exitCode}, counts ${measurements?.compared}, M0 ${summaryMatchesM0}, old/new ${outputMatchesOld}, ${receipt.verdict}`)
  if (!pass) failed++
}
// Two independent read-only harnesses at a time, without timeouts or sampling overrides.
for (let index = 0; index < names.length; index += 2) await Promise.all(names.slice(index, index + 2).map(run))
if (failed) process.exitCode = 1

if (JSON.stringify(before) !== JSON.stringify(workingIdentity())) throw new Error('MK3 tracked working tree changed during current parity run')
