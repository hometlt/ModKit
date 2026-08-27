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
  'common.view/model-socket-source',
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
 * Two candidates remain, for stated reasons rather than by default.
 *
 * `common.view/slide-deck-source`: block 11 slice 11B publishes it from ODP alone. Its admission
 * waits for a second, independent slides family (PPTX) plus a generic consumer — block 30.
 *
 * `common.view/model-socket-source`: block 15D publishes it from explicit Blizzard M3 ATT_ records.
 * It stays a publisher-candidate until a second independent native family proves the same
 * identity/node/role boundary without assigning semantics from a name heuristic.
 *
 * `common.view/model-skeleton-source` was admitted after the independent Blizzard M3 family began
 * decoding `MODL.bones → BONE.name → CHAR` and publishing twelve corpus-backed bindings. W3D/W3X
 * remain the SAGE/Westwood family; M3 is a different format, parser, package and vendor lineage.
 * Together they satisfy §2.7 without inventing joints from UVM/core's advisory `skinned` boolean.
 *
 * The other four optional model facets are `admitted` as of slice 12-1. Each has at least two
 * independent publishers that exercise *different* shapes of the same contract, so the shape is
 * proved generic rather than fitted to one source:
 *
 * - `model-resource-refs-source`: M3 (CHAR-table paths), W3D (TEXTURE_NAME chunks), W3X (asset ids)
 *   and OBJ (`mtllib` sidecars) — four families, both roles (`texture` and `sidecar`) and both
 *   provenances exercised;
 * - `model-animation-source`: W3D (in-file clips with decoded channels, `direct`) and VXL (an HVA
 *   sidecar, `companion`) — both provenances and both kinds (`animation`, `rest-pose`);
 * - `model-collision-source`: W3D and W3X publish `mesh-role`, UVM publishes `declared-volume` —
 *   both values of the origin enum, from two vendors;
 * - `model-material-source`: OBJ (names plus a library count) and UVM (ids plus per-material
 *   contracts) — the two optional shapes of the contract, from two vendors.
 *
 * The base `common.view/model-scene-source` is untouched and stays admitted: adding a facet beside
 * a contract is not a change to it.
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
    'common.view/model-resource-refs-source': 'admitted',
    'common.view/model-skeleton-source': 'admitted',
    'common.view/model-animation-source': 'admitted',
    'common.view/model-collision-source': 'admitted',
    'common.view/model-material-source': 'admitted',
    'common.view/model-socket-source': 'publisher-candidate',
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
