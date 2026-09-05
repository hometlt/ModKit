import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const portable = value => value.replaceAll('\\', '/')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fileEvidence = (repoRoot, path) => {
  const bytes = readFileSync(path)
  return Object.freeze({ path: portable(relative(repoRoot, path)), sha256: sha256(bytes) })
}

export function buildOwnerParityReceipt({
  repoRoot,
  corpusPath,
  outputPath,
  report,
  repositories,
  blocking,
}) {
  const ownerCounts = Object.fromEntries(repositories.map(repository => [repository.id, 0]))
  for (const result of report.results) {
    for (const owner of result.repositories ?? []) ownerCounts[owner] += 1
  }
  const oracleExecutions = report.results.flatMap(result => result.oracleExecutions ?? [])
  return Object.freeze({
    schemaVersion: 'owner-parity-aggregation-2',
    verdict: blocking.length === 0 ? 'pass' : 'fail',
    command: 'pnpm parity',
    runner: fileEvidence(repoRoot, fileURLToPath(new URL('check.mjs', import.meta.url))),
    oracleLoader: fileEvidence(
      repoRoot,
      fileURLToPath(new URL('../migration/lib/legacy-oracle.mjs', import.meta.url)),
    ),
    canonicalAdapter: fileEvidence(
      repoRoot,
      fileURLToPath(new URL('modkitx-probe.mjs', import.meta.url)),
    ),
    corpus: fileEvidence(repoRoot, corpusPath),
    report: Object.freeze({
      ...fileEvidence(repoRoot, outputPath),
      schemaVersion: report.schemaVersion,
      counts: report.counts,
    }),
    repositories,
    ownerResultCounts: ownerCounts,
    oracle: Object.freeze({
      repository: report.canonical.repository,
      commit: report.canonical.commit,
      rows: report.results.filter(result => (result.oracleExecutions?.length ?? 0) > 0).length,
      executions: oracleExecutions.length,
    }),
    blockingResultIds: blocking.map(result => result.id).sort(),
  })
}

export function sha256File(path) {
  return sha256(readFileSync(path))
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function validateOwnerParityDocuments({ receipt, report }) {
  if (receipt.schemaVersion !== 'owner-parity-aggregation-2') {
    throw new Error(`unsupported owner parity receipt schema ${String(receipt.schemaVersion)}`)
  }
  if (receipt.verdict !== 'pass' || receipt.blockingResultIds?.length !== 0) {
    throw new Error('owner parity receipt does not record a passing execution')
  }
  if (report.schemaVersion !== 4 || receipt.report?.schemaVersion !== 4) {
    throw new Error('owner parity report schemaVersion must be 4')
  }
  if (!same(receipt.repositories, report.x3?.repositories)) {
    throw new Error('owner parity receipt repository bindings contradict the report')
  }
  if (!same(receipt.report.counts, report.counts)) {
    throw new Error('owner parity receipt counts contradict the report')
  }
  if (
    report.counts?.total <= 0 ||
    report.counts.compared !== report.counts.total ||
    report.counts.skipped !== 0 ||
    report.counts.failed !== 0 ||
    report.counts.real <= 0
  ) {
    throw new Error(
      'owner parity report must contain only compared rows and a nonempty real corpus',
    )
  }
  const ids = new Set()
  const ownerIds = new Set(receipt.repositories.map(repository => repository.id))
  const ownerCounts = Object.fromEntries([...ownerIds].map(id => [id, 0]))
  let oracleExecutions = 0
  for (const result of report.results ?? []) {
    if (ids.has(result.id)) throw new Error(`duplicate owner parity result id ${result.id}`)
    ids.add(result.id)
    if (!Array.isArray(result.repositories) || result.repositories.length === 0) {
      throw new Error(`owner parity result ${result.id} has no repository binding`)
    }
    for (const id of result.repositories) {
      if (!ownerIds.has(id)) {
        throw new Error(`owner parity result ${result.id} names unknown repository ${id}`)
      }
      ownerCounts[id] += 1
    }
    if (!Array.isArray(result.oracleExecutions) || result.oracleExecutions.length === 0) {
      throw new Error(`owner parity result ${result.id} has no exact oracle execution`)
    }
    for (const execution of result.oracleExecutions) {
      if (
        execution.oracleCommit !== report.canonical?.commit ||
        execution.observeWorkingTree !== false ||
        !/^[0-9a-f]{64}$/u.test(execution.cacheKey) ||
        !/^[0-9a-f]{64}$/u.test(execution.sourceClosureDigest) ||
        !/^[0-9a-f]{64}$/u.test(execution.loaderDigest) ||
        !/^[0-9a-f]{64}$/u.test(execution.dependenciesDigest) ||
        !/^[0-9a-f]{64}$/u.test(execution.corpusDigest) ||
        !/^[0-9a-f]{64}$/u.test(execution.bundleSha256) ||
        !Number.isSafeInteger(execution.sourceFiles) ||
        execution.sourceFiles <= 0
      ) {
        throw new Error(`owner parity result ${result.id} has invalid exact oracle evidence`)
      }
      oracleExecutions += 1
    }
  }
  if (ids.size !== report.counts?.total) {
    throw new Error(`owner parity result count ${ids.size} contradicts counts.total`)
  }
  if (!same(ownerCounts, receipt.ownerResultCounts)) {
    throw new Error('owner parity receipt ownerResultCounts contradict the report')
  }
  if (
    !same(receipt.oracle, {
      repository: report.canonical.repository,
      commit: report.canonical.commit,
      rows: ids.size,
      executions: oracleExecutions,
    })
  ) {
    throw new Error('owner parity receipt oracle summary contradicts the report')
  }
  return Object.freeze({ rows: ids.size, repositories: ownerIds.size, oracleExecutions })
}
