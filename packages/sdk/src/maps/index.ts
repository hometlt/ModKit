/** Protocol-neutral contracts for bounded semantic map opening. */

import type { DataCatalogSnapshot, DataEntityRef, DataResolvedEntity } from '../data/index.js'
import type { ProjectionBasis } from '../asset-capabilities/uv-projection.js'
import type { ModWorkspaceLock } from '../mods/index.js'
import type { ResourceProvenanceRecord } from '../resource-session.js'
import type { ServiceProviderModule } from '../runtime-abi.js'

/** Standard service coordinate for game-specific semantic map opening. */
export const MAP_SEMANTIC_ANALYSIS_CONTRACT = 'common.map/semantic-analysis' as const

/** Additive VFS/workspace service; semantic-analysis@1 remains frozen and authoritative. */
export const RESOLVED_MAP_WORKSPACE_CONTRACT = 'common.map/resolved-workspace' as const

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

export type MapSemanticDocumentKind =
  'objects' | 'regions' | 'terrain-height' | 'terrain-native-parameters' | 'navigation'

/** One provider-authored logical read; the host resolves it through ResourceSessionPort. */
export interface MapSemanticDocumentRequirement {
  readonly requirementId: string
  readonly path: string
  readonly kind: MapSemanticDocumentKind
  readonly required: boolean
}

export interface ResolvedMapWorkspacePlanRequest {
  readonly workspace: ModWorkspaceLock
  readonly maxRequirements: number
  readonly signal?: AbortSignal
}

export interface ResolvedMapWorkspacePlan {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly mapId: string
  readonly analyzerId: string
  readonly requirements: readonly MapSemanticDocumentRequirement[]
  readonly diagnostics: readonly MapSemanticDiagnostic[]
  readonly complete: boolean
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

/**
 * Bounded native terrain-grid view. `samples` is exact only when it contains the complete ordered
 * `width × height` grid; a smaller caller budget produces an explicitly sampled view.
 */
export interface MapTerrainSummary {
  readonly version: number
  readonly width: number
  readonly height: number
  readonly cellCount: number
  readonly minimumHeightBase: number
  readonly maximumHeightBase: number
  readonly minimumHeightAdjustment: number
  readonly maximumHeightAdjustment: number
  /** Present only when the publisher exposes a proved cliff bit in this native terrain record. */
  readonly cliffCellCount?: number
  readonly trailingBytes: number
  readonly samples: readonly MapTerrainSample[]
}

interface MapTerrainNativeTransformBase {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly descriptorVersion: number
  readonly heightMap: Readonly<{
    readonly dim: readonly [number, number]
    readonly offset: MapPosition
    readonly scale: MapPosition
  }>
  readonly bounds: Readonly<{
    readonly coordinateSpaceId: 'map-native'
    readonly minimum: MapPosition
    readonly maximum: MapPosition
  }>
}

/** Exact SC2 native terrain mapping from one matching `t3Terrain.xml` and complete HMAP grid. */
export interface MapQuantizedTerrainNativeTransform extends MapTerrainNativeTransformBase {
  readonly source: Readonly<{
    readonly terrainDocumentPath: string
    readonly heightDocumentPath: string
    readonly rootElement: 'terrain'
    readonly heightMapElement: 'heightMap'
    readonly quantizationElement: 'vertData'
  }>
  readonly vertData: Readonly<{
    readonly quantizeBias: number
    readonly quantizeScale: number
    readonly standardHeight: number
  }>
  readonly mapping: Readonly<{
    readonly horizontal: 'offset-plus-grid-index-times-scale'
    readonly vertical: 'dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment'
  }>
}

/** Exact direct-height terrain mapping, currently qualified against Warzone `game.map`. */
export interface MapDirectTerrainNativeTransform extends MapTerrainNativeTransformBase {
  readonly source: Readonly<{
    readonly terrainDocumentPath: string
    readonly format: 'warzone-game-map'
    readonly heightEncoding: 'uint8-times-2' | 'uint16-le'
  }>
  readonly mapping: Readonly<{
    readonly horizontal: 'offset-plus-grid-index-times-scale'
    readonly vertical: 'direct-base-times-scale-plus-offset'
  }>
}

/** Exact publisher-native terrain mapping; each member names its real stored height encoding. */
export type MapTerrainNativeTransform =
  MapQuantizedTerrainNativeTransform | MapDirectTerrainNativeTransform

export type MapCoordinateAxis = 'x' | 'y' | 'z'

/** One numeric output axis of a measured source-space to canonical-space transform. */
export interface MapSignedAxisTransform {
  readonly sourceAxis: MapCoordinateAxis
  readonly scale: number
  readonly offset: number
}

/**
 * Measured map-native to canonical UVW transform.
 *
 * This is additive candidate metadata, not an admitted `world-interchange-v1` contract. A host
 * validates every numeric field before exposing it to a materializer.
 */
export interface MapWorldCanonicalTransform {
  readonly schemaVersion: 1
  readonly snapshotId: string
  readonly sourceCoordinateSpaceId: string
  readonly targetCoordinateSpaceId: 'uvw-canonical'
  readonly basis: ProjectionBasis
  readonly axes: Readonly<{
    readonly x: MapSignedAxisTransform
    readonly y: MapSignedAxisTransform
    readonly z: MapSignedAxisTransform
  }>
  readonly heightfield: Readonly<{
    readonly columns: number
    readonly rows: number
    readonly cellSize: number
    readonly origin: readonly [number, number, number]
    readonly sourceRowOrder: 'forward' | 'reverse'
  }>
  readonly bounds: Readonly<{
    readonly coordinateSpaceId: 'uvw-canonical'
    readonly minimum: MapPosition
    readonly maximum: MapPosition
  }>
  readonly proof: Readonly<{
    readonly kind: 'adapter-qualification'
    readonly method: 'sealed-legacy-differential' | 'official-reference-differential'
    readonly oracle: string
    readonly corpus: string
    readonly sourceDigests: Readonly<Record<string, `sha256:${string}`>>
    readonly tupleCount: number
    readonly comparison: 'ieee-754-binary64-exact'
    readonly nativeTupleDigest: `sha256:${string}`
    readonly presentationTupleDigest?: `sha256:${string}`
    readonly canonicalTupleDigest: `sha256:${string}`
  }>
}

export interface MapNavigationSample {
  readonly x: number
  readonly y: number
  /** Publisher-native flags whose bit meanings remain explicit candidate metadata. */
  readonly flags: number
}

/** Bounded summary of a publisher-native navigation grid. */
export interface MapNavigationSummary {
  readonly version: number
  readonly width: number
  readonly height: number
  readonly cellCount: number
  readonly minimumFlags: number
  readonly maximumFlags: number
  readonly trailingBytes: number
  readonly samples: readonly MapNavigationSample[]
}

export interface MapWorldCandidateDescriptor {
  /** Publisher-qualified candidate coordinate. This is deliberately not an admitted common ID. */
  readonly contract: string
  readonly major: 1
  readonly maturity: 'publisher-candidate'
  readonly coordinateSpaces: readonly Readonly<{
    readonly id: string
    horizontalAxes: readonly [string, string]
    verticalAxis: string
    handedness: string
    linearUnit: string
    rotationUnit: string
    origin: string
  }>[]
  /** No cross-space transform may be inferred when the publisher has not proved one. */
  readonly crossSpaceTransforms: readonly Readonly<{
    readonly from: string
    readonly to: string
    readonly state: 'identity' | 'known' | 'unknown'
    readonly reason?: string
  }>[]
  readonly unknownFacets: readonly string[]
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

export interface ResolvedMapWorkspaceAnalysisRequest extends MapSemanticAnalysisRequest {
  readonly snapshotId: string
  readonly unresolvedRequirementIds: readonly string[]
  readonly requiredRequirementIds: readonly string[]
  readonly maxDiagnostics: number
}

/** Additive result; `semantic` is the untouched authoritative semantic-analysis@1 snapshot. */
export interface ResolvedMapWorkspaceSnapshot {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly gameId: string
  readonly mapId: string
  readonly analyzerId: string
  readonly snapshotId: string
  readonly semantic: MapSemanticSnapshot
  readonly navigation?: MapNavigationSummary
  readonly terrainTransform?: MapTerrainNativeTransform
  readonly uvwTransform?: MapWorldCanonicalTransform
  readonly worldCandidate: MapWorldCandidateDescriptor
  readonly unresolvedRequirementIds: readonly string[]
  readonly diagnostics: readonly MapSemanticDiagnostic[]
  readonly diagnosticsTruncated: boolean
  readonly complete: boolean
}

export type WorldSceneFacet =
  'layers' | 'terrain' | 'objects' | 'regions' | 'resources' | 'navigation'
export type WorldSceneLayerKind = Exclude<WorldSceneFacet, 'layers'>

export type WorldSceneAxisExtent =
  | Readonly<{ state: 'known'; minimum: number; maximum: number }>
  | Readonly<{ state: 'unknown'; reason: string }>

export interface WorldSceneFacetBounds {
  readonly facet: WorldSceneLayerKind
  readonly coordinateSpaceId: string
  readonly x: WorldSceneAxisExtent
  readonly y: WorldSceneAxisExtent
  readonly z: WorldSceneAxisExtent
}

export interface WorldSceneFacetState {
  readonly facet: WorldSceneLayerKind
  readonly layerId: string
  readonly state: 'available' | 'unavailable' | 'partial'
  readonly itemCount: number
  readonly lods: readonly string[]
  readonly reason?: string
}

export interface CandidateWorldSceneInfo {
  readonly contract: string
  readonly major: 1
  readonly maturity: 'publisher-candidate'
  readonly snapshotId: string
  readonly mapId: string
  readonly coordinateSpaces: MapWorldCandidateDescriptor['coordinateSpaces']
  readonly crossSpaceTransforms: MapWorldCandidateDescriptor['crossSpaceTransforms']
  readonly bounds: readonly WorldSceneFacetBounds[]
  readonly terrainTransform?: MapTerrainNativeTransform
  readonly uvwTransform?: MapWorldCanonicalTransform
  readonly facets: readonly WorldSceneFacetState[]
  readonly provenance: readonly ResourceProvenanceRecord[]
  readonly unknownFacets: readonly string[]
  readonly lossPolicy: 'explicit-partial'
  readonly complete: boolean
}

export interface WorldSceneLayerItem {
  readonly facet: 'layers'
  readonly id: string
  readonly layerId: string
  readonly kind: WorldSceneLayerKind
  readonly state: WorldSceneFacetState['state']
  readonly itemCount: number
  readonly lods: readonly string[]
}

export interface WorldSceneTerrainItem extends MapTerrainSample {
  readonly facet: 'terrain'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  /** Present only when a validated exact native terrain transform was admitted for this snapshot. */
  readonly mapNativePosition?: MapPosition
  /** Present only when the host validated a measured map-native to canonical UVW transform. */
  readonly uvwPosition?: MapPosition
  /**
   * `exact` means the publisher retained every native height-grid tuple. It does not claim that
   * the tuple has been converted into map-native or canonical UVW coordinates.
   */
  readonly lod: 'sampled' | 'exact'
}

export interface WorldSceneNavigationItem extends MapNavigationSample {
  readonly facet: 'navigation'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  readonly lod: 'sampled'
}

export interface WorldSceneObjectItem extends MapPlacedObject {
  readonly facet: 'objects'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  /** Stable join into the resources facet when this object names a catalog entity. */
  readonly resourceId?: string
}

export interface WorldSceneRegionShape {
  readonly kind: string
  readonly center?: Readonly<{ x: number; y: number }>
  readonly radius?: number
  readonly rawParameters: Readonly<Record<string, string>>
}

export interface WorldSceneRegionItem {
  readonly facet: 'regions'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  readonly regionId: number
  readonly name: string
  readonly color?: string
  readonly shapes: readonly WorldSceneRegionShape[]
}

export interface WorldSceneResourceItem {
  readonly facet: 'resources'
  readonly id: string
  readonly layerId: string
  readonly namespace: string
  readonly entityId: string
  readonly resolved: boolean
  /** Exact reverse join to every placed object that references this resource. */
  readonly objectIds: readonly string[]
}

export type WorldSceneItem =
  | WorldSceneLayerItem
  | WorldSceneTerrainItem
  | WorldSceneNavigationItem
  | WorldSceneObjectItem
  | WorldSceneRegionItem
  | WorldSceneResourceItem

export interface WorldScenePageRequest {
  /** Unknown facet names produce a named unsupported page, not a silently empty success. */
  readonly facet: string
  readonly layerId?: string
  readonly lod?: string
  readonly cursor?: string
  readonly limit: number
  readonly bounds?: Readonly<{
    minimumX: number
    minimumY: number
    maximumX: number
    maximumY: number
  }>
}

export interface WorldScenePage {
  readonly snapshotId: string
  readonly facet: string
  readonly state: 'available' | 'unavailable' | 'unsupported'
  readonly items: readonly WorldSceneItem[]
  readonly nextCursor?: string
  readonly reason?: string
}

/**
 * Structural candidate surface consumed by the generic Block 15 harness.
 *
 * It intentionally has no ContractMap augmentation and no common.view coordinate. Block 18 may
 * admit a common contract only through the documented adapter/dual-publish transition.
 */
export interface CandidateWorldSceneSource {
  readonly contract: string
  readonly major: 1
  readonly snapshotId: string
  info(signal?: AbortSignal): Promise<CandidateWorldSceneInfo>
  page(request: WorldScenePageRequest, signal?: AbortSignal): Promise<WorldScenePage>
}

/** Activated game-specific semantic map analyzer. */
export interface MapSemanticAnalysis {
  readonly contract: typeof MAP_SEMANTIC_ANALYSIS_CONTRACT
  readonly analyzerId: string
  readonly gameIds: readonly string[]
  open(request: MapSemanticAnalysisRequest): Promise<MapSemanticSnapshot>
}

/** Workspace-aware service composed by the host over ResourceSession/VFS reads. */
export interface ResolvedMapWorkspaceAnalysis {
  readonly contract: typeof RESOLVED_MAP_WORKSPACE_CONTRACT
  readonly analyzerId: string
  readonly gameIds: readonly string[]
  plan(request: ResolvedMapWorkspacePlanRequest): Promise<ResolvedMapWorkspacePlan>
  analyze(request: ResolvedMapWorkspaceAnalysisRequest): Promise<ResolvedMapWorkspaceSnapshot>
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
    'common.map/resolved-workspace': { 1: ResolvedMapWorkspaceAnalysis }
  }

  interface ContractRequestMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticRequestFacet }
    }
    'common.map/resolved-workspace': {
      1: { presence: 'required'; facet: MapSemanticRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticOfferFacet }
    }
    'common.map/resolved-workspace': {
      1: { presence: 'required'; facet: MapSemanticOfferFacet }
    }
  }
}

export type MapSemanticProviderModule = ServiceProviderModule<
  typeof MAP_SEMANTIC_ANALYSIS_CONTRACT,
  1
>

export type ResolvedMapWorkspaceProviderModule = ServiceProviderModule<
  typeof RESOLVED_MAP_WORKSPACE_CONTRACT,
  1
>
