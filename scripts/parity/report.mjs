import { spawnSync } from 'node:child_process'

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
  return {
    ...result,
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

export function buildParityReport({ corpus, canonical, x3, results }) {
  const stableResults = [...results]
    .sort((left, right) => left.format.localeCompare(right.format))
    .map(stableResult)
  const summary = stableResults.map(result => ({
    format: result.format,
    state: result.state,
    classification: result.classification ?? null,
  }))
  const poorer = stableResults
    .filter(result => result.classification === 'X3 беднее' || result.classification === 'нет в X3')
    .map(result => ({
      format: result.format,
      classification: result.classification,
      missing: result.missing ?? [],
      ...(result.allowPoorerReason === undefined ? {} : { reason: result.allowPoorerReason }),
    }))
  return Object.freeze({
    schemaVersion: 2,
    corpus,
    canonical,
    x3,
    summary,
    poorer,
    results: stableResults,
  })
}

export function blockingParityResults(results) {
  return results.filter(
    result =>
      result.state === 'failed' ||
      result.classification === 'нет в X3' ||
      (result.classification === 'X3 беднее' && result.allowPoorerReason === undefined),
  )
}
