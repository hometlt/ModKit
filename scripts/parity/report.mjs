import { spawnSync } from 'node:child_process'
import { comparisonPlanes, parityVerdict } from './classify.mjs'

/** Ordered worst-last so a regression against an approved row can be detected numerically. */
const CLASSIFICATION_RANK = Object.freeze({
  'X3 богаче': 0,
  паритет: 1,
  'X3 беднее': 2,
  'нет в X3': 3,
})

export function gitSha(root, run = spawnSync) {
  const result = run('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0 || result.stdout.trim() === '') {
    throw new Error(`cannot resolve Git SHA for ${root}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function byContract(left, right) {
  return left.contract.localeCompare(right.contract)
}

function stableSurface(surface) {
  if (surface === undefined) return undefined
  return {
    ...surface,
    ...(surface.sources === undefined ? {} : { sources: [...surface.sources].sort(byContract) }),
  }
}

function stableResult(result) {
  if (result.state !== 'compared') return { ...result }
  const canonical = stableSurface(result.canonical)
  const x3 = stableSurface(result.x3)
  const sourceComparisons = [...(result.sourceComparisons ?? [])].sort(byContract)
  const planes = comparisonPlanes(
    canonical,
    x3,
    { sources: sourceComparisons },
    result.x3?.available !== false,
  )
  return {
    ...result,
    verdict: parityVerdict(result.classification, planes),
    planes,
    canonical,
    x3,
    sourceComparisons,
    declared: {
      canonical: [...(canonical?.declaredSources ?? [])].sort(),
      x3: [...(x3?.declaredSources ?? [])].sort(),
    },
    observed: {
      canonical: canonical?.sources ?? [],
      x3: x3?.sources ?? [],
    },
    comparison: {
      classification: result.classification,
      missing: result.missing ?? [],
      extra: result.extra ?? [],
      sources: sourceComparisons,
    },
  }
}

function countBy(results, predicate) {
  return results.filter(element => predicate(element)).length
}

function corpusCounts(results) {
  return Object.freeze({
    total: results.length,
    real: countBy(results, result => result.kind === 'real'),
    synthetic: countBy(results, result => result.kind === 'synthetic'),
    compared: countBy(results, result => result.state === 'compared'),
    skipped: countBy(results, result => result.state === 'skipped'),
    failed: countBy(results, result => result.state === 'failed'),
    comparedReal: countBy(results, result => result.state === 'compared' && result.kind === 'real'),
    comparedSynthetic: countBy(
      results,
      result => result.state === 'compared' && result.kind === 'synthetic',
    ),
    richer: countBy(results, result => result.verdict === 'richer'),
    equal: countBy(results, result => result.verdict === 'equal'),
    poorer: countBy(results, result => result.verdict === 'poorer'),
    incomparable: countBy(results, result => result.verdict === 'incomparable'),
  })
}

/**
 * A row that carries an approved baseline may never come back worse than that baseline. This is
 * the machine form of §3.4 of the final plan: the approved snapshot is the regression reference,
 * and a newly discovered honest `poorer` is published rather than rewritten as a success.
 */
export function regressedParityResult(result) {
  if (result.state !== 'compared' || result.baseline === undefined) return undefined
  const approved = CLASSIFICATION_RANK[result.baseline]
  const observed = CLASSIFICATION_RANK[result.classification]
  if (approved === undefined || observed === undefined || observed <= approved) return undefined
  return `${result.baseline} → ${result.classification}`
}

export function buildParityReport({ corpus, canonical, x3, results }) {
  const stableResults = [...results]
    .sort((left, right) => left.format.localeCompare(right.format))
    .map(stableResult)
  const summary = stableResults.map(result => ({
    id: result.id ?? result.format,
    format: result.format,
    kind: result.kind ?? null,
    contributionId: result.contributionId ?? null,
    state: result.state,
    classification: result.classification ?? null,
    verdict: result.verdict ?? null,
  }))
  const poorer = stableResults
    .filter(result => result.verdict === 'poorer')
    .map(result => ({
      id: result.id ?? result.format,
      format: result.format,
      kind: result.kind ?? null,
      classification: result.classification,
      missing: result.missing ?? [],
      ...(result.allowPoorerReason === undefined ? {} : { reason: result.allowPoorerReason }),
    }))
  const incomparable = stableResults
    .filter(result => result.verdict === 'incomparable')
    .map(result => ({
      id: result.id ?? result.format,
      format: result.format,
      reason: 'no semantic plane is observed by both readers',
    }))
  const skipped = stableResults
    .filter(result => result.state === 'skipped')
    .map(result => ({ id: result.id ?? result.format, reason: result.detail }))
  return Object.freeze({
    schemaVersion: 4,
    corpus,
    canonical,
    x3,
    counts: corpusCounts(stableResults),
    summary,
    poorer,
    incomparable,
    skipped,
    results: stableResults,
  })
}

/**
 * §2.4: the gate falls on an unexplained regression, never on the mere existence of an honest
 * `poorer`. A row that regressed against its approved baseline blocks unconditionally — a reason
 * cannot buy back a capability that used to be there — while a newly discovered shortfall blocks
 * only until it is named.
 */
export function blockingParityResults(results) {
  return results.filter(
    result =>
      result.state === 'failed' ||
      regressedParityResult(result) !== undefined ||
      ((result.classification === 'нет в X3' || result.classification === 'X3 беднее') &&
        result.allowPoorerReason === undefined),
  )
}
