import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  hash,
  stable,
  validateReceipt,
  readEvidence,
  checkLedger,
  confined,
} from './port-state.mjs'
import { MK2_PIN, digestManifest } from './legacy-oracle.mjs'
import { parseFlags, requiredFlag } from './port-cli.mjs'
import { verifyPreparedOracle } from './port-oracle-proof.mjs'
import { workspaceRoot } from './port-context.mjs'
import { captureRuntimeProof, verifyRuntimeProof } from './port-runtime-proof.mjs'

export function validateOracleEvidence(evidence, corpus) {
  const modules = evidence?.modules ?? (evidence ? [evidence] : [])
  if (!Array.isArray(modules) || !modules.length)
    throw new Error('real corpus requires nonempty pinned oracle evidence')
  for (const module of modules) {
    if (
      module.oracleCommit !== MK2_PIN ||
      !Array.isArray(module.source) ||
      !module.source.length ||
      !Array.isArray(module.loader) ||
      !module.loader.length ||
      !Array.isArray(module.dependencies)
    )
      throw new Error('incomplete pinned oracle closure')
    if (
      module.sourceClosureDigest !== digestManifest(module.source) ||
      module.loaderDigest !== digestManifest(module.loader) ||
      module.dependenciesDigest !== digestManifest(module.dependencies)
    )
      throw new Error('pinned oracle closure digest mismatch')
    if (module.corpusDigest !== digestManifest(corpus))
      throw new Error('oracle corpus differs from the executed corpus')
  }
}

export function scaffoldBrief({ codec, requirements, audit, sourceCommit }) {
  const rows = requirements.filter(row => row.codec === codec)
  if (!rows.length) throw new Error(`unknown or empty codec scope: ${codec}`)
  return [
    `# Port brief: ${codec}`,
    '',
    `Pinned MK2 source: ${sourceCommit}.`,
    audit
      ? `Historical source audit: ${audit.mk2Path}. Recheck current MK3 surfaces before editing.`
      : 'Authored scope: use the campaign plan and real native fixtures; do not claim MK2 parity.',
    '',
    '## Preconditions',
    '',
    '- Owner has accepted the previous milestone; M1 does not start bank implementation.',
    '- Resolve canonical source/test/data closure with copy-mk2; preserve all existing richer MK3 behavior.',
    '- Bind each operation to an executable handler and a versioned receipt; no empty corpus or implementation stubs.',
    '',
    '## Required obligations',
    '',
    ...rows.map(row => `- [ ] ${row.id}: ${row.label}`),
    '',
    '## Verification and evidence',
    '',
    'Run the exact declared MK2 suite and full pinned differential corpus. Record commands, cwd, counts, hashes and refusal taxonomy.',
    'Use scaffold-parity-harness with explicit oracle and migrated adapters; fill public-surface assertions before claiming acceptance.',
    'Each proof names its requirement, kind, adapterOperation and nonempty successful caseIds; operation proofs also name the executed native handler and its published contribution.',
    'Apply a passing receipt through evidence:apply; rerun feature-ledger integrity and the explicit codec closure.',
    'Keep family closure pending until every family obligation and acceptance surface passes.',
    '',
  ].join('\n')
}

export function scaffoldHarness({ codec, requirements, libraryUrl }) {
  const ids = requirements.filter(row => row.codec === codec).map(row => row.id)
  if (!ids.length) throw new Error(`unknown or empty codec scope: ${codec}`)
  if (ids.every(id => id.startsWith('authored/')))
    throw new Error('authored functionality has no MK2 differential oracle')
  return `// Generated parity harness for ${codec}. Explicit adapters and a nonempty corpus are required.\nimport { runDifferentialCli } from ${JSON.stringify(libraryUrl)}\nawait runDifferentialCli({ codec: ${JSON.stringify(codec)}, requirementIds: ${JSON.stringify(ids)} })\n`
}

function normalize(value, seen = new Set()) {
  if (value === undefined) return { $type: 'undefined' }
  if (typeof value === 'bigint') return { $type: 'bigint', value: String(value) }
  if (typeof value === 'number')
    return { $type: 'number', value: Object.is(value, -0) ? '-0' : String(value) }
  if (ArrayBuffer.isView(value))
    return {
      $type: value.constructor.name,
      hex: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex'),
    }
  if (value instanceof ArrayBuffer)
    return { $type: 'ArrayBuffer', hex: Buffer.from(value).toString('hex') }
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new Error('adapter output is not comparable inert data')
  if (value === null) return { $type: 'null' }
  if (typeof value !== 'object') return { $type: typeof value, value }
  if (seen.has(value)) throw new Error('cyclic adapter output')
  seen.add(value)
  let result
  if (Array.isArray(value))
    result = { $type: 'array', value: value.map(item => normalize(item, seen)) }
  else {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('adapter must normalize class instances explicitly')
    if (Object.getOwnPropertySymbols(value).length)
      throw new Error('adapter must normalize symbol keys explicitly')
    result = {
      $type: 'object',
      value: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalize(item, seen)]),
      ),
    }
  }
  seen.delete(value)
  return result
}

export async function runDifferential({
  legacy,
  migrated,
  cases,
  codec,
  operation,
  corpusKind,
  proofs = [],
  onCase,
}) {
  if (typeof legacy !== 'function' || typeof migrated !== 'function')
    throw new Error('two executable adapters are required')
  if (!Array.isArray(cases) || !cases.length) throw new Error('empty corpus is not parity')
  if (!['synthetic', 'real', 'mixed'].includes(corpusKind)) throw new Error('declare corpus kind')
  if (
    new Set(cases.map(row => row.id)).size !== cases.length ||
    cases.some(row => typeof row.id !== 'string' || !row.id)
  )
    throw new Error('cases need distinct stable IDs')
  const rows = []
  for (const item of cases) {
    const invoke = async adapter => {
      let value
      try {
        value = await adapter(structuredClone(item.input))
      } catch (error) {
        return {
          result: 'refused',
          code: error?.code ?? null,
          message: String(error?.message ?? error),
        }
      }
      // A broken comparator is a harness failure, not a legacy refusal.
      return { result: 'success', value: normalize(value) }
    }
    const left = await invoke(legacy)
    const right = await invoke(migrated)
    const match = stable(left) === stable(right)
    const row = {
      id: item.id,
      verdict: !match ? 'different' : left.result === 'refused' ? 'both-refused' : 'identical',
      legacySha256: hash(stable(left)),
      migratedSha256: hash(stable(right)),
    }
    if (onCase !== undefined) await onCase({ ...row, legacy: left, migrated: right })
    rows.push(row)
  }
  const identical = rows.filter(row => row.verdict === 'identical').length
  const differing = rows.filter(row => row.verdict === 'different').length
  const bothRefused = rows.length - identical - differing
  return {
    schemaVersion: 1,
    codec,
    ...(operation === undefined ? {} : { inputs: { operation } }),
    corpusKind,
    verdict: differing === 0 && identical > 0 ? 'pass' : 'fail',
    tests: { passed: identical, failed: differing },
    counts: { total: rows.length, identical, differing, bothRefused },
    corpusSha256: hash(stable(cases)),
    proofs,
    cases: rows,
  }
}

export async function runDifferentialCli({ codec, requirementIds }) {
  const args = parseFlags(process.argv.slice(2), [
    '--legacy',
    '--migrated',
    '--corpus',
    '--receipt',
    '--operation',
    '--config',
    '--outputs',
  ])
  let base = process.cwd()
  let configPath
  let configBytes
  let config
  if (args.has('--config')) {
    if (args.size !== 1) throw new Error('--config cannot be combined with inline parity options')
    configPath = path.resolve(requiredFlag(args, '--config'))
    configBytes = await readFile(configPath)
    config = JSON.parse(configBytes)
    const keys = ['schemaVersion', 'legacy', 'migrated', 'corpus', 'receipt', 'operation', 'outputs']
    if (config?.schemaVersion !== 1 || Object.keys(config).some(key => !keys.includes(key))) {
      throw new Error('invalid parity config schema')
    }
    base = path.dirname(configPath)
  }
  const get = name => {
    const value = config === undefined ? requiredFlag(args, name) : config[name.slice(2)]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`required ${name}`)
    return value
  }
  const sourcePath = path.resolve(base, get('--legacy'))
  const targetPath = path.resolve(base, get('--migrated'))
  const corpusPath = path.resolve(base, get('--corpus'))
  const receiptPath = path.resolve(base, get('--receipt'))
  const outputOption = config === undefined ? args.get('--outputs') : config.outputs
  if (outputOption !== undefined && (typeof outputOption !== 'string' || !outputOption.trim())) {
    throw new Error('invalid parity outputs path')
  }
  const outputsPath = outputOption === undefined ? undefined : path.resolve(base, outputOption)
  const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value
  const inputPaths = [sourcePath, targetPath, corpusPath, ...(configPath === undefined ? [] : [configPath])]
  const outputPaths = [receiptPath, ...(outputsPath === undefined ? [] : [outputsPath])]
  if (new Set(outputPaths.map(pathKey)).size !== outputPaths.length ||
    outputPaths.some(output => inputPaths.some(input => pathKey(output) === pathKey(input)))) {
    throw new Error('parity output would overwrite an input or another output')
  }
  const operation = get('--operation')
  const inputBytes = new Map(await Promise.all(inputPaths.map(async file => [file, file === configPath ? configBytes : await readFile(file)])))
  const inputHashes = [...inputBytes].map(([file, bytes]) => [file, hash(bytes)])
  const corpusBytes = inputBytes.get(corpusPath)
  const corpus = JSON.parse(corpusBytes)
  for (const proof of corpus.proofs ?? [])
    if (!requirementIds.includes(proof.requirement))
      throw new Error(`out-of-scope proof: ${proof.requirement}`)
  const harnessSelection = { roots: [path.dirname(fileURLToPath(import.meta.url)),
    ...(process.argv[1] === undefined ? [] : [path.resolve(process.argv[1])])] }
  const harnessProof = await captureRuntimeProof(harnessSelection)
  const oracle = await import(pathToFileURL(sourcePath).href)
  const target = await import(pathToFileURL(targetPath).href)
  const prepared =
    typeof oracle.prepareOracle === 'function'
      ? await oracle.prepareOracle({ operation, corpus, corpusPath })
      : { module: oracle, evidence: oracle.oracleEvidence }
  let oracleVerification
  if (corpus.kind !== 'synthetic') {
    validateOracleEvidence(prepared.evidence, corpus)
    oracleVerification = await verifyPreparedOracle(prepared.evidence, {
      corpus,
      adapterPath: sourcePath,
      operation,
      repoRoot: path.join(workspaceRoot, 'references/modkitmk2'),
    })
  }
  const migrated = typeof target.prepareMigrated === 'function'
    ? await target.prepareMigrated({ operation, corpus, corpusPath })
    : { module: target }
  const caseOutputs = []
  let receipt
  try {
    receipt = await runDifferential({
      legacy: prepared.module[operation],
      migrated: migrated.module[operation],
      cases: corpus.cases,
      codec,
      operation,
      corpusKind: corpus.kind,
      proofs: corpus.proofs ?? [],
      ...(outputsPath === undefined ? {} : { onCase: value => { caseOutputs.push(value) } }),
    })
    if (typeof migrated.verify === 'function') await migrated.verify()
    await verifyRuntimeProof(harnessProof, harnessSelection)
  } finally {
    if (typeof migrated.release === 'function') await migrated.release()
  }
  for (const [file, expected] of inputHashes) {
    if (hash(await readFile(file)) !== expected) throw new Error(`parity input changed during execution: ${file}`)
  }
  receipt.inputs = {
    legacyAdapterSha256: hash(await readFile(sourcePath)),
    migratedAdapterSha256: hash(await readFile(targetPath)),
    corpusFileSha256: hash(corpusBytes),
    operation,
  }
  if (prepared.evidence) receipt.oracle = prepared.evidence
  if (oracleVerification) receipt.oracleVerification = oracleVerification
  if (migrated.evidence !== undefined) receipt.migrated = migrated.evidence
  receipt.harness = harnessProof
  if (configBytes !== undefined) receipt.inputs.configSha256 = hash(configBytes)
  if (outputsPath !== undefined) {
    // Deep canonical values are large; indentation must not multiply retained output size.
    const bytes = stable({ schemaVersion: 1, codec, operation, cases: caseOutputs }, 0)
    await mkdir(path.dirname(outputsPath), { recursive: true })
    await writeFile(outputsPath, bytes)
    receipt.outputs = { path: path.relative(path.dirname(receiptPath), outputsPath).replaceAll('\\', '/'), sha256: hash(bytes) }
  }
  await mkdir(path.dirname(receiptPath), { recursive: true })
  await writeFile(receiptPath, stable(receipt))
  console.log(
    `${codec}: ${receipt.verdict}, identical ${receipt.counts.identical}, different ${receipt.counts.differing}, both-refused ${receipt.counts.bothRefused}`,
  )
  if (receipt.verdict !== 'pass') process.exitCode = 1
}

export async function applyReceipt({
  root,
  receiptPath,
  requirements,
  ledger,
  operationMap,
  publications = [],
}) {
  const file = confined(root, receiptPath)
  const bytes = await readFile(file)
  const reference = { path: receiptPath, sha256: hash(bytes) }
  const receipt = JSON.parse(await readEvidence(root, reference))
  if (!Array.isArray(receipt.proofs) || !receipt.proofs.length)
    throw new Error('receipt has no requirement proofs')
  if (new Set(receipt.proofs.map(row => row.requirement)).size !== receipt.proofs.length)
    throw new Error('duplicate receipt proofs')
  const next = structuredClone(ledger)
  const maps = structuredClone(operationMap)
  for (const proof of receipt.proofs) {
    const requirement = requirements.find(row => row.id === proof.requirement)
    if (!requirement) throw new Error(`unknown proof requirement: ${proof.requirement}`)
    validateReceipt(receipt, requirement)
    const row = next.entries.find(row => row.id === requirement.id)
    if (!row) throw new Error(`ledger row missing: ${requirement.id}`)
    if (row.status === 'owner-dropped' || row.status === 'superseded')
      throw new Error(`owner decision needs explicit review before restoring: ${row.id}`)
    row.status = 'adapted'
    if (
      !row.evidence.some(item => item.sha256 === reference.sha256 && item.path === reference.path)
    )
      row.evidence.push(reference)
    if (requirement.kind === 'operation') {
      const mapping = maps.entries.find(row => row.id === requirement.id)
      if (!mapping) throw new Error(`operation mapping absent: ${requirement.id}`)
      Object.assign(mapping, {
        status: row.status,
        targetOperation: proof.targetOperation,
        handlerId: proof.handlerId,
        contribution: proof.contribution,
      })
    }
  }
  const failures = await checkLedger({
    root,
    requirements,
    ledger: next,
    operationMap: maps,
    previous: ledger,
    publications,
  })
  if (failures.length) throw new Error(failures.join('\n'))
  return { ledger: next, operationMap: maps, applied: receipt.proofs.length }
}
