/** Dependency-neutral data-source wire IDs used by both schemas and runtime registries. */

export const STANDARD_DATA_SOURCE_CONTRACTS = Object.freeze([
  'common.view/text-data-source',
  'common.view/byte-range-source',
  'common.view/tree-data-source',
  'common.view/table-data-source',
  'common.view/transport-source',
  'common.view/namespace-entry-source',
  'common.view/raster-image-source',
  'common.view/vector-scene-source',
  'common.view/audio-media-source',
  'common.view/video-media-source',
  'common.view/model-scene-source',
  // optional model facets beside the base scene source (block 11, slice 11C0, plan item 11)
  'common.view/model-resource-refs-source',
  'common.view/model-skeleton-source',
  'common.view/model-animation-source',
  'common.view/model-collision-source',
  'common.view/model-material-source',
  'common.view/relation-graph-source',
  'common.view/subject-facts-source',
  'common.view/slide-deck-source',
] as const)

export type StandardDataSourceId = (typeof STANDARD_DATA_SOURCE_CONTRACTS)[number]

/**
 * How much a data-source contract has been proved (ADR-DOC-001, gate §2.7).
 *
 * `admitted` is the only maturity a consumer may treat as settled: the shape has been published by
 * at least two independent source families and consumed generically, so widening it later would be
 * a breaking change rather than a correction. `publisher-candidate` is a contract that exists,
 * validates and is callable across the boundary, but has been proved by exactly one publisher —
 * its field set may still move under the dual-publish rules, and no gate may count it as settled.
 *
 * The distinction is data, not prose, so a validator can state it: nothing may relabel a candidate
 * as admitted without a second family behind it.
 */
export type DataSourceMaturity = 'admitted' | 'publisher-candidate'

/**
 * Maturity of every standard data-source contract.
 *
 * Six candidates, and each of them is a candidate for a stated reason rather than by default.
 *
 * `common.view/slide-deck-source`: block 11 slice 11B publishes it from ODP alone. Its admission
 * waits for a second, independent slides family (PPTX) plus a generic consumer — block 30.
 *
 * The five optional model facets: slice 11C0 declares the contracts; the codecs that already
 * compute those facts still publish them ad hoc in their summaries, and migrating them is slice
 * 11C1 / block 12 work. Until the M3 + W3X proof runs against the contracts themselves, the shapes
 * may still move under the dual-publish rules, and no gate may count them as settled. The base
 * `common.view/model-scene-source` is untouched and stays admitted: adding a facet beside a
 * contract is not a change to it.
 */
export const DATA_SOURCE_MATURITY: Readonly<Record<StandardDataSourceId, DataSourceMaturity>> =
  Object.freeze({
    'common.view/text-data-source': 'admitted',
    'common.view/byte-range-source': 'admitted',
    'common.view/tree-data-source': 'admitted',
    'common.view/table-data-source': 'admitted',
    'common.view/transport-source': 'admitted',
    'common.view/namespace-entry-source': 'admitted',
    'common.view/raster-image-source': 'admitted',
    'common.view/vector-scene-source': 'admitted',
    'common.view/audio-media-source': 'admitted',
    'common.view/video-media-source': 'admitted',
    'common.view/model-scene-source': 'admitted',
    'common.view/model-resource-refs-source': 'publisher-candidate',
    'common.view/model-skeleton-source': 'publisher-candidate',
    'common.view/model-animation-source': 'publisher-candidate',
    'common.view/model-collision-source': 'publisher-candidate',
    'common.view/model-material-source': 'publisher-candidate',
    'common.view/relation-graph-source': 'admitted',
    'common.view/subject-facts-source': 'admitted',
    'common.view/slide-deck-source': 'publisher-candidate',
  })

/** The standard contracts whose shape is settled. Derived, so a candidate cannot be listed here. */
export const ADMITTED_DATA_SOURCE_CONTRACTS: readonly StandardDataSourceId[] = Object.freeze(
  STANDARD_DATA_SOURCE_CONTRACTS.filter(
    contract => DATA_SOURCE_MATURITY[contract] === 'admitted',
  ) as readonly StandardDataSourceId[],
)

/** Maturity of a contract id; `undefined` for a contract this build does not know. */
export function dataSourceMaturity(contract: string): DataSourceMaturity | undefined {
  return (STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(contract)
    ? DATA_SOURCE_MATURITY[contract as StandardDataSourceId]
    : undefined
}

export interface StandardDataSourceRef {
  readonly contract: StandardDataSourceId
  readonly major: 1
}

export interface OpaqueDataSourceRefWire {
  readonly contract: string
  readonly major: number
  readonly opaque: true
}

export type DataSourceRefWire = StandardDataSourceRef | OpaqueDataSourceRefWire
