/** Protocol-neutral contracts for bounded semantic map opening. */

import type { DataCatalogSnapshot, DataEntityRef, DataResolvedEntity } from '../data/index.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for game-specific semantic map opening. */
export const MAP_SEMANTIC_ANALYSIS_CONTRACT = 'common.map/semantic-analysis' as const

/** Host-owned matcher profile for exact game-id routing. */
export const MAP_SEMANTIC_MATCHER_PROFILE = 'org.modkitx/map-semantic-matcher' as const

/** One already-extracted map-internal document. Container loading stays outside this contract. */
export interface MapSemanticDocument {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface MapSemanticAnalysisRequest {
  readonly workspaceId: string
  readonly gameId: string
  readonly mapId: string
  readonly documents: readonly MapSemanticDocument[]
  /** Optional resolved catalog used to bind placed objects to schema-backed entities. */
  readonly catalog?: DataCatalogSnapshot
  readonly maxDocuments: number
  readonly maxDocumentBytes: number
  readonly maxTotalBytes: number
  readonly maxObjects: number
  readonly maxRegions: number
  readonly maxTerrainCells: number
  readonly maxTerrainSamples: number
  readonly maxDepth: number
  readonly signal?: AbortSignal
}

export interface MapPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type MapObjectKind = 'unit' | 'doodad' | 'point' | 'camera'

/** A schema link for an object, resolved when the supplied catalog contains the entity. */
export interface MapCatalogBinding {
  readonly ref: DataEntityRef
  readonly entity?: DataResolvedEntity
}

export interface MapPlacedObject {
  readonly kind: MapObjectKind
  readonly objectId: number
  readonly position: MapPosition
  readonly rotation?: number
  readonly scale?: MapPosition
  readonly typeId?: string
  readonly player?: number
  readonly variation?: number
  readonly name?: string
  readonly catalog?: MapCatalogBinding
}

export interface MapRegionShape {
  readonly type: string
  readonly parameters: Readonly<Record<string, string>>
}

export interface MapRegion {
  readonly regionId: number
  readonly name: string
  readonly color?: string
  readonly shapes: readonly MapRegionShape[]
}

export interface MapTerrainSample {
  readonly x: number
  readonly y: number
  readonly heightBase: number
  readonly heightAdjustment: number
  readonly mask: number
}

/** Bounded summary of a terrain height grid; the full cell array is deliberately not transferred. */
export interface MapTerrainSummary {
  readonly version: number
  readonly width: number
  readonly height: number
  readonly cellCount: number
  readonly minimumHeightBase: number
  readonly maximumHeightBase: number
  readonly minimumHeightAdjustment: number
  readonly maximumHeightAdjustment: number
  readonly cliffCellCount: number
  readonly trailingBytes: number
  readonly samples: readonly MapTerrainSample[]
}

export type MapSemanticDiagnosticSeverity = 'error' | 'warning' | 'information'

export interface MapSemanticDiagnostic {
  readonly severity: MapSemanticDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly objectId?: number
  readonly regionId?: number
  readonly catalogRef?: DataEntityRef
}

export interface MapSemanticSnapshot {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly mapId: string
  readonly analyzerId: string
  readonly documentPaths: readonly string[]
  readonly terrain?: MapTerrainSummary
  readonly regions: readonly MapRegion[]
  readonly objects: readonly MapPlacedObject[]
  /** Queries a consumer can feed to the data catalog before reopening with `catalog`. */
  readonly catalogQueries: readonly DataEntityRef[]
  readonly resolvedCatalogObjects: number
  readonly diagnostics: readonly MapSemanticDiagnostic[]
  readonly complete: boolean
}

/** Activated game-specific semantic map analyzer. */
export interface MapSemanticAnalysis {
  readonly contract: typeof MAP_SEMANTIC_ANALYSIS_CONTRACT
  readonly analyzerId: string
  readonly gameIds: readonly string[]
  open(request: MapSemanticAnalysisRequest): Promise<MapSemanticSnapshot>
}

/** JSON-safe route advertised by a map contribution. */
export interface MapSemanticOfferFacet {
  readonly gameIds: readonly string[]
}

/** JSON-safe route supplied by a consumer selecting one named game. */
export interface MapSemanticRequestFacet {
  readonly gameId: string
}

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.map/semantic-analysis': { 1: MapSemanticAnalysis }
  }

  interface ContractRequestMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticOfferFacet }
    }
  }
}

export type MapSemanticProviderModule = ServiceProviderModule<
  typeof MAP_SEMANTIC_ANALYSIS_CONTRACT,
  1
>
