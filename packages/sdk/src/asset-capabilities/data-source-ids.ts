/** Dependency-neutral data-source wire IDs used by both schemas and runtime registries. */

export const STANDARD_DATA_SOURCE_CONTRACTS = Object.freeze([
  'common.view/text-data-source',
  'common.view/byte-range-source',
  'common.view/tree-data-source',
  'common.view/table-data-source',
  'common.view/transport-source',
  'common.view/namespace-entry-source',
] as const)

export type StandardDataSourceId = (typeof STANDARD_DATA_SOURCE_CONTRACTS)[number]

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
