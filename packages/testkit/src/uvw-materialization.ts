/** Testkit-only admission probe for the candidate UVW base-heightfield path. */

import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldSceneFacetState,
  WorldScenePage,
} from '@modkitx-x3/sdk/maps'

export const CANDIDATE_WORLD_UVW_PROFILE = 'uvw.candidate.v1/base-heightfield-admission' as const

export type CandidateWorldUvwRefusalCode =
  | 'invalid-budget'
  | 'cancelled'
  | 'source-stale'
  | 'source-info-failed'
  | 'source-identity-mismatch'
  | 'terrain-facet-missing'
  | 'terrain-not-exact'
  | 'exact-lod-missing'
  | 'terrain-bounds-unproven'
  | 'coordinate-space-missing'
  | 'coordinate-transform-unproven'
  | 'source-unit-unproven'
  | 'canonical-origin-unproven'
  | 'cell-size-unproven'
  | 'vertical-quantization-unproven'
  | 'source-page-failed'
  | 'cursor-rejected'
  | 'cursor-cycle'
  | 'page-snapshot-mismatch'
  | 'page-facet-mismatch'
  | 'exact-page-unavailable'
  | 'page-limit-exceeded'
  | 'terrain-budget-exceeded'
  | 'exact-page-item-invalid'

export interface CandidateWorldUvwRefusal {
  readonly code: CandidateWorldUvwRefusalCode
  readonly message: string
  readonly path?: string
}

export interface CandidateWorldUvwAdmissionOptions {
  /** Maximum number of items requested from the source in one page. */
  readonly maxPageItems: number
  /** Cumulative exact terrain-cell ceiling for the admission probe. */
  readonly maxTerrainItems: number
  readonly signal?: AbortSignal
}

/**
 * A refusal-only Block 15F report. It is deliberately not a MaterializationReceipt: no artifact
 * exists, no semantic hash was computed, and the reserved world scope has not been admitted.
 */
export interface CandidateWorldUvwAdmissionReport {
  readonly state: 'refused'
  readonly profile: typeof CANDIDATE_WORLD_UVW_PROFILE
  readonly target: Readonly<{
    readonly format: 'UVW'
    readonly version: '1.0'
    readonly status: 'candidate'
    readonly facets: readonly ['basis', 'bounds', 'heightfield-base']
  }>
  readonly source: Readonly<{
    readonly contract: string
    readonly major: 1
    readonly snapshotId: string
    readonly infoSnapshotId?: string
  }>
  readonly terrainLayerId?: string
  readonly requestedLod: 'exact'
  readonly pageRequests: number
  readonly observedTerrainItems: number
  readonly materialized: false
  readonly serialized: false
  readonly serializedBytes: 0
  readonly lostFacetIds: readonly []
  readonly excludedFacetIds: readonly string[]
  readonly refusalCodes: readonly CandidateWorldUvwRefusalCode[]
  readonly refusals: readonly CandidateWorldUvwRefusal[]
}

const BASE_EXCLUSIONS = Object.freeze([
  'world.catalogs-definitions',
  'world.lighting',
  'world.map-native-binding',
  'world.navigation',
  'world.objects',
  'world.physics',
  'world.regions',
  'world.resources',
  'world.scenario-runtime',
  'world.terrain.authored-cliffs-ramps',
  'world.terrain.heightAdjustment',
  'world.terrain.hmap-padding-trailing-bytes',
  'world.terrain.mask',
  'world.terrain.material-layers',
  'world.terrain.pathing',
  'world.terrain.sampled-summary-metadata',
  'world.terrain.water',
  'world.trigger-volumes',
] as const)

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  )
}

function isStale(error: unknown): boolean {
  return /\b(?:released|stale)\b/iu.test(String(error))
}

/**
 * Assess whether one publisher-qualified world candidate can honestly become the UVW 1.0 base
 * heightfield. This Block 15F seam has no success/artifact branch: the current world ABI cannot
 * prove a canonical origin, scalar cell size, uniform source unit or vertical dequantization.
 *
 * The exact-page drain still runs for synthetic future-looking sources which advertise it. That
 * makes snapshot, cursor, cancellation and budget refusals executable without pretending those
 * transport checks close the missing semantic proof.
 */
export async function assessCandidateWorldUvwAdmission(
  source: CandidateWorldSceneSource,
  options: CandidateWorldUvwAdmissionOptions,
): Promise<CandidateWorldUvwAdmissionReport> {
  const refusals = new Map<CandidateWorldUvwRefusalCode, CandidateWorldUvwRefusal>()
  let info: CandidateWorldSceneInfo | undefined
  let terrain: WorldSceneFacetState | undefined = undefined
  let pageRequests = 0
  let observedTerrainItems = 0
  const cancelled = (): boolean => options.signal?.aborted === true

  const refuse = (code: CandidateWorldUvwRefusalCode, message: string, path?: string): void => {
    if (refusals.has(code)) return
    refusals.set(code, Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }))
  }
  const finish = (): CandidateWorldUvwAdmissionReport => {
    const excluded = new Set<string>(BASE_EXCLUSIONS)
    for (const facet of info?.unknownFacets ?? []) excluded.add(`world.unknown.${facet}`)
    const refusalList = Object.freeze([...refusals.values()])
    return Object.freeze({
      state: 'refused',
      profile: CANDIDATE_WORLD_UVW_PROFILE,
      target: Object.freeze({
        format: 'UVW',
        version: '1.0',
        status: 'candidate',
        facets: Object.freeze(['basis', 'bounds', 'heightfield-base'] as const),
      }),
      source: Object.freeze({
        contract: source.contract,
        major: source.major,
        snapshotId: source.snapshotId,
        ...(info === undefined ? {} : { infoSnapshotId: info.snapshotId }),
      }),
      ...(terrain === undefined ? {} : { terrainLayerId: terrain.layerId }),
      requestedLod: 'exact',
      pageRequests,
      observedTerrainItems,
      materialized: false,
      serialized: false,
      serializedBytes: 0,
      lostFacetIds: Object.freeze([] as const),
      excludedFacetIds: Object.freeze([...excluded].sort()),
      refusalCodes: Object.freeze(refusalList.map(item => item.code)),
      refusals: refusalList,
    })
  }

  if (
    !isPositiveSafeInteger(options.maxPageItems) ||
    !isPositiveSafeInteger(options.maxTerrainItems)
  ) {
    refuse(
      'invalid-budget',
      'maxPageItems and maxTerrainItems must be positive safe integers',
      'options',
    )
    return finish()
  }
  if (cancelled()) {
    refuse('cancelled', 'UVW candidate admission was cancelled before source inspection')
    return finish()
  }

  try {
    info = await source.info(options.signal)
  } catch (error) {
    if (isAbort(error, options.signal)) {
      refuse('cancelled', 'UVW candidate admission was cancelled while reading source info')
    } else if (isStale(error)) {
      refuse('source-stale', 'world candidate source was released or stale while reading info')
    } else {
      refuse('source-info-failed', `world candidate info failed: ${String(error)}`)
    }
    return finish()
  }

  if (
    source.contract !== info.contract ||
    source.major !== info.major ||
    source.snapshotId !== info.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    refuse(
      'source-identity-mismatch',
      'world candidate identity or maturity changed between source and info',
      'source',
    )
    return finish()
  }

  terrain = info.facets.find(item => item.facet === 'terrain')
  if (terrain === undefined) {
    refuse('terrain-facet-missing', 'world candidate does not advertise a terrain facet')
    return finish()
  }
  if (terrain.state !== 'available') {
    refuse(
      'terrain-not-exact',
      `terrain facet state is ${terrain.state}; exact materialization requires available`,
      'info.facets.terrain.state',
    )
  }
  const hasExactLod = terrain.lods.includes('exact')
  if (!hasExactLod) {
    refuse(
      'exact-lod-missing',
      'terrain facet does not advertise an exact LOD',
      'info.facets.terrain.lods',
    )
  }

  const terrainBounds = info.bounds.find(item => item.facet === 'terrain')
  if (
    terrainBounds === undefined ||
    terrainBounds.x.state !== 'known' ||
    terrainBounds.y.state !== 'known' ||
    terrainBounds.z.state !== 'known'
  ) {
    refuse(
      'terrain-bounds-unproven',
      'terrain bounds are not fully known in one proven coordinate space',
      'info.bounds.terrain',
    )
  }
  const coordinateSpace =
    terrainBounds === undefined
      ? undefined
      : info.coordinateSpaces.find(item => item.id === terrainBounds.coordinateSpaceId)
  if (coordinateSpace === undefined) {
    refuse(
      'coordinate-space-missing',
      'terrain bounds do not identify a declared coordinate space',
      'info.coordinateSpaces',
    )
  }
  const mapTransform =
    coordinateSpace === undefined
      ? undefined
      : info.crossSpaceTransforms.find(
          item => item.from === coordinateSpace.id && item.to === 'map-native',
        )
  if (mapTransform === undefined || mapTransform.state === 'unknown') {
    refuse(
      'coordinate-transform-unproven',
      'terrain coordinates have no proven transform into map-native and the UVW canonical frame',
      'info.crossSpaceTransforms',
    )
  } else {
    refuse(
      'coordinate-transform-unproven',
      'publisher metadata stops at map-native and does not prove the UVW canonical frame transform',
      'info.crossSpaceTransforms',
    )
  }

  // These facts do not exist in CandidateWorldSceneInfo. Strings such as "grid-index" and
  // "grid-zero" cannot prove that horizontal indices and uint16 height codes share one UVW unit.
  refuse(
    'source-unit-unproven',
    'world candidate metadata does not prove one scalar source unit across all UVW axes',
    'info.coordinateSpaces',
  )
  refuse(
    'canonical-origin-unproven',
    'world candidate metadata has no numeric origin in the UVW canonical frame',
    'info.coordinateSpaces',
  )
  refuse(
    'cell-size-unproven',
    'world candidate metadata has no proven horizontal cell size in the UVW source unit',
    'info.coordinateSpaces',
  )
  refuse(
    'vertical-quantization-unproven',
    'world candidate metadata does not define how heightBase becomes an elevation in the UVW source unit',
    'terrain.heightBase',
  )

  if (terrain.state !== 'available' || !hasExactLod) return finish()

  let cursor: string | undefined
  const seenCursors = new Set<string>()
  do {
    if (cancelled()) {
      refuse('cancelled', 'UVW candidate admission was cancelled before an exact terrain page')
      break
    }
    let page: WorldScenePage
    try {
      pageRequests += 1
      page = await source.page(
        {
          facet: 'terrain',
          layerId: terrain.layerId,
          lod: 'exact',
          ...(cursor === undefined ? {} : { cursor }),
          limit: options.maxPageItems,
        },
        options.signal,
      )
    } catch (error) {
      if (isAbort(error, options.signal)) {
        refuse('cancelled', 'UVW candidate admission was cancelled while reading terrain')
      } else if (cursor !== undefined) {
        refuse(
          'cursor-rejected',
          `world candidate rejected its exact-page cursor: ${String(error)}`,
        )
      } else if (isStale(error)) {
        refuse('source-stale', 'world candidate source was released or stale while reading terrain')
      } else {
        refuse('source-page-failed', `exact terrain page failed: ${String(error)}`)
      }
      break
    }

    if (page.snapshotId !== info.snapshotId) {
      refuse(
        'page-snapshot-mismatch',
        'exact terrain page belongs to a different snapshot',
        'page.snapshotId',
      )
      break
    }
    if (page.facet !== 'terrain') {
      refuse('page-facet-mismatch', 'exact terrain page returned a different facet', 'page.facet')
      break
    }
    if (page.state !== 'available') {
      refuse('exact-page-unavailable', `exact terrain page state is ${page.state}`, 'page.state')
      break
    }
    if (page.items.length > options.maxPageItems) {
      refuse(
        'page-limit-exceeded',
        'world candidate returned more terrain items than the requested page limit',
        'page.items',
      )
      break
    }
    observedTerrainItems += page.items.length
    if (observedTerrainItems > options.maxTerrainItems) {
      refuse(
        'terrain-budget-exceeded',
        'exact terrain drain exceeded maxTerrainItems',
        'page.items',
      )
      break
    }
    const invalidItem = page.items.find(item => {
      const runtimeItem = item as unknown as Readonly<Record<string, unknown>>
      return (
        runtimeItem['facet'] !== 'terrain' ||
        runtimeItem['layerId'] !== terrain?.layerId ||
        runtimeItem['lod'] !== 'exact'
      )
    })
    if (invalidItem !== undefined) {
      refuse(
        'exact-page-item-invalid',
        'exact terrain page contains an item with the wrong facet, layer or LOD',
        'page.items',
      )
      break
    }

    const nextCursor = page.nextCursor
    if (nextCursor !== undefined && (nextCursor === cursor || seenCursors.has(nextCursor))) {
      refuse('cursor-cycle', 'exact terrain paging repeated a cursor', 'page.nextCursor')
      break
    }
    if (nextCursor !== undefined) seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor !== undefined)

  return finish()
}
