const CLASSIFICATION_RANK = Object.freeze({
  'X3 богаче': 0,
  паритет: 1,
  'X3 беднее': 2,
  'нет в X3': 3,
})
const M3_COUNTER_SEMANTICS = 'm3-declared-executable-v1'
const M3_COUNTER_KEYS = Object.freeze([
  'declaredSequences',
  'executableClips',
  'layerRecords',
  'logicalResources',
  'meshPartitions',
  'meshes',
])

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
    ...(x3Source.measurementBasis === undefined
      ? {}
      : { measurementBasis: x3Source.measurementBasis }),
  })
}

function m3DeclaredModelSource(surface, source) {
  if (surface.formatId !== 'm3' || source.contract !== 'common.view/model-scene-source') {
    return source
  }
  const metadata = surface.metadata
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    metadata.counterState !== 'complete' ||
    metadata.counterSemantics !== M3_COUNTER_SEMANTICS ||
    M3_COUNTER_KEYS.some(key => !Number.isSafeInteger(metadata[key]) || Number(metadata[key]) < 0)
  ) {
    return source
  }
  const measurements = source.measurements ?? {}
  if (
    metadata.executableClips > metadata.declaredSequences ||
    (metadata.meshes > 0 && metadata.meshes > metadata.meshPartitions) ||
    measurements.animations !== metadata.executableClips ||
    measurements.textures !== metadata.logicalResources ||
    measurements.meshes !== metadata.meshes
  ) {
    return source
  }
  return Object.freeze({
    ...source,
    measurementBasis: M3_COUNTER_SEMANTICS,
    measurements: Object.freeze({
      ...measurements,
      animations: metadata.declaredSequences,
      textures: metadata.layerRecords,
      meshes: metadata.meshPartitions,
    }),
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
  const x3Sources = new Map(
    (x3.sources ?? []).map(source => [source.contract, m3DeclaredModelSource(x3, source)]),
  )
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

/**
 * Semantic planes of §2.4 of the Block 9 execution plan. A measurement only belongs to a plane
 * when both readers mean the same quantity by it, which is why the mapping is keyed by data-source
 * contract instead of by bare measurement name: `nodes` is a hierarchy fact for a model scene and a
 * structural count for a tree.
 *
 * `payload-access` is an addition to the plan's model-centric list. Raster, media and namespace
 * subjects have no geometry, yet whether their bytes or pixels are actually reachable is exactly
 * the kind of claim the plan refuses to accept on the strength of "the file opened".
 *
 * `collision`, `palette-voxel-transforms`, `protected-tail-preservation` and
 * `diagnostics-on-malformed-input` are declared but observed by neither side yet: no data source
 * publishes them. They stay in the table as `not-observed` so the gap is visible rather than
 * silently absent, and they are the entry points for Block 9 steps 3 and 4.
 */
export const PARITY_PLANES = Object.freeze([
  'subject-recognition',
  'structural-metadata',
  'geometry-counts',
  'hierarchy',
  'materials-textures',
  'animation',
  'collision',
  'palette-voxel-transforms',
  'payload-access',
  'protected-tail-preservation',
  'diagnostics-on-malformed-input',
])

const PLANE_KEYS = Object.freeze({
  'common.view/model-scene-source': {
    scenes: 'structural-metadata',
    nodes: 'hierarchy',
    meshes: 'geometry-counts',
    primitives: 'geometry-counts',
    decodedGeometry: 'geometry-counts',
    decodedVertices: 'geometry-counts',
    decodedIndices: 'geometry-counts',
    materials: 'materials-textures',
    textures: 'materials-textures',
    animations: 'animation',
  },
  'common.view/tree-data-source': {
    nodes: 'structural-metadata',
    kinds: 'structural-metadata',
    complete: 'structural-metadata',
    maxDepth: 'hierarchy',
  },
  'common.view/namespace-entry-source': {
    entries: 'structural-metadata',
    files: 'structural-metadata',
    directories: 'structural-metadata',
    complete: 'structural-metadata',
    extractedBytes: 'payload-access',
    extractedNonEmpty: 'payload-access',
    productReopenCompleted: 'payload-access',
  },
  'common.view/table-data-source': {
    rows: 'structural-metadata',
    rowsKnown: 'structural-metadata',
    columns: 'structural-metadata',
    typedColumns: 'structural-metadata',
    firstPageRows: 'payload-access',
  },
  'common.view/text-data-source': {
    encoding: 'structural-metadata',
    lines: 'structural-metadata',
    linesKnown: 'structural-metadata',
    sliceLines: 'payload-access',
    sliceNonEmpty: 'payload-access',
  },
  'common.view/raster-image-source': {
    width: 'structural-metadata',
    height: 'structural-metadata',
    channels: 'structural-metadata',
    encodedMediaType: 'structural-metadata',
    encodedNonEmpty: 'payload-access',
    decodedAccess: 'payload-access',
    decodedBytes: 'payload-access',
  },
  'common.view/vector-scene-source': {
    width: 'structural-metadata',
    height: 'structural-metadata',
    nodes: 'hierarchy',
    paths: 'geometry-counts',
    shapes: 'geometry-counts',
    textNodes: 'geometry-counts',
    gradients: 'materials-textures',
    documentNonEmpty: 'payload-access',
  },
  'common.view/audio-media-source': {
    tracks: 'structural-metadata',
    sampleRate: 'structural-metadata',
    channels: 'structural-metadata',
    durationKnown: 'structural-metadata',
    seekable: 'structural-metadata',
    pcmAccess: 'payload-access',
    encodedNonEmpty: 'payload-access',
  },
  'common.view/video-media-source': {
    tracks: 'structural-metadata',
    width: 'structural-metadata',
    height: 'structural-metadata',
    durationKnown: 'structural-metadata',
    seekable: 'structural-metadata',
    frameAccess: 'payload-access',
    encodedNonEmpty: 'payload-access',
  },
  'common.view/byte-range-source': {
    nonEmpty: 'payload-access',
    firstReadBytes: 'payload-access',
  },
})

function planeOf(contract, key) {
  return PLANE_KEYS[contract]?.[key]
}

function planeObservations(surface, available) {
  const planes = new Map(PARITY_PLANES.map(plane => [plane, 0]))
  if (!available) return planes
  const opened = (surface.sources ?? []).filter(source => source.state === 'opened')
  if (opened.length > 0) planes.set('subject-recognition', 1)
  for (const source of opened) {
    for (const key of Object.keys(source.measurements ?? {})) {
      const plane = planeOf(source.contract, key)
      if (plane !== undefined) planes.set(plane, (planes.get(plane) ?? 0) + 1)
    }
  }
  return planes
}

function planeDirections(comparison) {
  const directions = new Map(PARITY_PLANES.map(plane => [plane, { missing: 0, extra: 0 }]))
  for (const source of comparison.sources ?? []) {
    for (const [bucket, items] of [
      ['missing', source.missing],
      ['extra', source.extra],
    ]) {
      for (const item of items ?? []) {
        const key = /^measurement:([^:=]+)/u.exec(item)?.[1]
        const plane = key === undefined ? undefined : planeOf(source.contract, key)
        if (plane !== undefined) directions.get(plane)[bucket] += 1
      }
    }
  }
  return directions
}

/**
 * Per-plane verdicts. A plane both readers observe is compared; a plane only one reader observes
 * is named as such instead of being folded into an overall score, and a plane nobody observes is
 * reported as an open gap.
 */
export function comparisonPlanes(canonical, x3, comparison, x3Available = true) {
  const canonicalPlanes = planeObservations(canonical ?? {}, true)
  const x3Planes = planeObservations(x3 ?? {}, x3Available)
  const directions = planeDirections(comparison ?? {})
  return PARITY_PLANES.map(plane => {
    const inCanonical = (canonicalPlanes.get(plane) ?? 0) > 0
    const inX3 = (x3Planes.get(plane) ?? 0) > 0
    if (!inCanonical && !inX3) return { plane, state: 'not-observed', verdict: 'not-observed' }
    if (inCanonical && !inX3) return { plane, state: 'canonical-only', verdict: 'poorer' }
    if (!inCanonical && inX3) return { plane, state: 'x3-only', verdict: 'richer' }
    const direction = directions.get(plane) ?? { missing: 0, extra: 0 }
    const verdict = direction.missing > 0 ? 'poorer' : direction.extra > 0 ? 'richer' : 'equal'
    return { plane, state: 'compared', verdict }
  })
}

const VERDICT_BY_CLASSIFICATION = Object.freeze({
  'X3 богаче': 'richer',
  паритет: 'equal',
  'X3 беднее': 'poorer',
  'нет в X3': 'poorer',
})

/**
 * `incomparable` is derived, never declared: it is reserved for rows where no plane is observed by
 * both readers, so a row can never buy the label by asserting it.
 */
export function parityVerdict(classification, planes) {
  if (classification === undefined) return undefined
  const compared = planes.filter(plane => plane.state === 'compared')
  if (compared.length === 0 && classification !== 'нет в X3') return 'incomparable'
  return VERDICT_BY_CLASSIFICATION[classification]
}
