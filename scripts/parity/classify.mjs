const CLASSIFICATION_RANK = Object.freeze({
  'X3 богаче': 0,
  паритет: 1,
  'X3 беднее': 2,
  'нет в X3': 3,
})

function classification(missing, extra, x3Available = true) {
  if (!x3Available) return 'нет в X3'
  if (missing.length > 0) return 'X3 беднее'
  if (extra.length > 0) return 'X3 богаче'
  return 'паритет'
}

export function classifyParity(canonicalFeatures, x3Features, x3Available = true) {
  const canonical = new Set(canonicalFeatures)
  const x3 = new Set(x3Features)
  const missing = [...canonical].filter(feature => !x3.has(feature)).sort()
  const extra = [...x3].filter(feature => !canonical.has(feature)).sort()
  return Object.freeze({
    classification: classification(missing, extra, x3Available),
    missing,
    extra,
  })
}

function compareValue(key, canonical, x3, missing, extra) {
  if (typeof canonical !== typeof x3) {
    missing.push(`measurement:${key}=${String(canonical)}`)
    extra.push(`measurement:${key}=${String(x3)}`)
    return
  }
  if (typeof canonical === 'number' && typeof x3 === 'number') {
    if (x3 < canonical) missing.push(`measurement:${key}:${x3}<${canonical}`)
    else if (x3 > canonical) extra.push(`measurement:${key}:${x3}>${canonical}`)
    return
  }
  if (typeof canonical === 'boolean' && typeof x3 === 'boolean') {
    if (canonical && !x3) missing.push(`measurement:${key}=true`)
    else if (!canonical && x3) extra.push(`measurement:${key}=true`)
    return
  }
  if (canonical !== x3) {
    missing.push(`measurement:${key}=${String(canonical)}`)
    extra.push(`measurement:${key}=${String(x3)}`)
  }
}

export function compareMeasurements(canonicalMeasurements, x3Measurements) {
  const missing = []
  const extra = []
  for (const [key, value] of Object.entries(canonicalMeasurements).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!(key in x3Measurements)) missing.push(`measurement:${key}`)
    else compareValue(key, value, x3Measurements[key], missing, extra)
  }
  for (const key of Object.keys(x3Measurements).sort()) {
    if (!(key in canonicalMeasurements)) extra.push(`measurement:${key}`)
  }
  return Object.freeze({ classification: classification(missing, extra), missing, extra })
}

export function classifySourceParity(canonicalSource, x3Source) {
  if (x3Source === undefined) {
    return Object.freeze({
      contract: canonicalSource.contract,
      classification: 'X3 беднее',
      missing: [`source:${canonicalSource.contract}`],
      extra: [],
    })
  }
  const featureComparison = classifyParity(
    canonicalSource.features ?? [],
    x3Source.features ?? [],
    true,
  )
  const measurementComparison = compareMeasurements(
    canonicalSource.measurements ?? {},
    x3Source.measurements ?? {},
  )
  const missing = [
    ...featureComparison.missing,
    ...measurementComparison.missing,
    ...(x3Source.state === 'opened' ? [] : [`source-state:${x3Source.state}`]),
  ].sort()
  const extra = [...featureComparison.extra, ...measurementComparison.extra].sort()
  return Object.freeze({
    contract: canonicalSource.contract,
    classification: classification(missing, extra),
    missing,
    extra,
  })
}

export function classifyFormatParity(canonical, x3, x3Available = true) {
  if (!x3Available) {
    return Object.freeze({
      classification: 'нет в X3',
      missing: [...(canonical.features ?? [])],
      extra: [],
      sources: [],
    })
  }
  const surface = classifyParity(canonical.features ?? [], x3.features ?? [])
  const x3Sources = new Map((x3.sources ?? []).map(source => [source.contract, source]))
  const sources = (canonical.sources ?? [])
    .map(source => classifySourceParity(source, x3Sources.get(source.contract)))
    .sort((a, b) => a.contract.localeCompare(b.contract))
  const canonicalContracts = new Set((canonical.sources ?? []).map(source => source.contract))
  const extraSources = (x3.sources ?? [])
    .filter(source => !canonicalContracts.has(source.contract))
    .map(source => `source:${source.contract}`)
  const missing = [
    ...new Set([
      ...surface.missing,
      ...sources.flatMap(source => source.missing.map(item => `${source.contract}:${item}`)),
    ]),
  ].sort()
  const extra = [
    ...new Set([
      ...surface.extra,
      ...extraSources,
      ...sources.flatMap(source => source.extra.map(item => `${source.contract}:${item}`)),
    ]),
  ].sort()
  const candidates = [surface.classification, ...sources.map(source => source.classification)]
  const worst = candidates.reduce((current, candidate) =>
    CLASSIFICATION_RANK[candidate] > CLASSIFICATION_RANK[current] ? candidate : current,
  )
  return Object.freeze({ classification: worst, missing, extra, sources })
}

export function comparableMetadataFeatures(input) {
  const keys = ['animations', 'materials', 'meshes', 'nodes', 'primitives', 'scenes', 'textures']
  return keys.filter(key => Number.isSafeInteger(input[key])).map(key => `metadata:${key}`)
}
