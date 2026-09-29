/** Protocol-neutral contracts for bounded semantic map opening. */

import type { Diagnostic } from '@modkit/core'
import type { DataCatalogSnapshot, DataEntityRef, DataResolvedEntity } from '../data/index.js'
import type { ProjectionBasis } from '../asset-capabilities/uv-projection.js'
import type { ModWorkspaceGraphInput, ModWorkspaceLock } from '../mods/index.js'
import type { LogicalResourceRequirement, ResourceProvenanceRecord } from '../resource-session.js'
import type { ServiceProviderModule } from '../runtime-abi.js'
import type { JsonSchemaRef, JsonValue } from '../asset-capabilities/types.js'
import type { NamespaceEntrySearchQuery } from '../asset-capabilities/data-sources.js'
import type { ModelResourceRequest, ModelResourceResult } from '../model-resources.js'
import type {
  CompressedTextureFormat,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
} from '../asset-capabilities/media-data-sources.js'
import type {
  ModelAnimationClip,
  ModelBoneBinding,
  ModelMaterialRef,
  ModelResourceRef,
  ModelSocketRef,
} from '../asset-capabilities/model-facet-sources.js'
import type { SceneRendererTexture } from '../renderer/index.js'

/** Standard service coordinate for game-specific semantic map opening. */
export const MAP_SEMANTIC_ANALYSIS_CONTRACT = 'common.map/semantic-analysis' as const

/** Additive VFS/workspace service; semantic-analysis@1 remains frozen and authoritative. */
export const RESOLVED_MAP_WORKSPACE_CONTRACT = 'common.map/resolved-workspace' as const

/** Game-extension preparation of one ordinary codec subject for a host-owned map preview. */
export const MAP_PREVIEW_PREPARATION_CONTRACT = 'common.map/preview-preparation' as const

/**
 * Standard candidate coordinate for a bounded, game-neutral world scene.
 *
 * The callable SDK coordinate is additive. It does not freeze `world-interchange-v1` or promote
 * the current UVW candidate: maturity stays explicit on `WorldSceneInfo` until the common viewer
 * and conformance receipts close the remaining admission gates.
 */
export const WORLD_SCENE_SOURCE_CONTRACT = 'common.view/world-scene-source' as const

/**
 * Grid layers of a map — heights, cliff levels, water, pathing, texture weights — in any game's
 * format. A map codec lists its layers (`map.layers`), reads one as numbers (`map.layer-read`)
 * and turns numbers back into an edit plan (`map.layer-write`). A codec never sees an image: the
 * application turns a layer into a grey PNG and back (`@modkit/codec-kit/raster` grey grids), so a
 * heightmap exports and imports the same way for every game.
 */
export const MAP_LAYERS_OPERATION = 'map.layers' as const
export const MAP_LAYER_READ_OPERATION = 'map.layer-read' as const
export const MAP_LAYER_WRITE_OPERATION = 'map.layer-write' as const

/** What a layer's numbers mean; `other` for a game's own grid. */
export type MapLayerMeaning =
  | 'height'
  | 'cliff-level'
  | 'water'
  | 'pathing'
  | 'texture-weight'
  | 'flags'
  | 'other'

export interface MapLayerDescriptor {
  readonly id: string
  readonly label: string
  readonly meaning: MapLayerMeaning
  readonly width: number
  readonly height: number
  /** Inclusive bounds of a sample; `maximum` at most 65535, so a layer fits a 16-bit image. */
  readonly minimum: number
  readonly maximum: number
  readonly editable: boolean
  /**
   * What a sample means in the world: `valueOffset + sample * valueScale`, in `unit`. Without them
   * the samples are the format's own numbers with no declared world meaning.
   */
  readonly valueScale?: number
  readonly valueOffset?: number
  /** Unit of the world value, for example `world-unit` or `m`. */
  readonly unit?: string
  /** Samples on the grid's vertices (a heightfield) or inside its cells. */
  readonly sampling?: 'vertex' | 'cell'
  /**
   * The legend of a layer whose samples name classes (biomes, top blocks, pathing flags): each
   * listed value's name and, optionally, its colour as `#rrggbb`. Values not listed have no name.
   */
  readonly categories?: readonly MapLayerCategory[]
}

export interface MapLayerCategory {
  readonly value: number
  readonly label: string
  readonly color?: string
}

/**
 * A picture the codec draws itself (an overview, an overlay of units and regions, texture masks):
 * the PNG its `view.render` returns for `{ layer: id }`. It is shown, not exported as numbers.
 */
export interface MapPictureDescriptor {
  readonly id: string
  readonly label: string
}

/** `map.layers` output. */
export interface MapLayerList {
  readonly layers: readonly MapLayerDescriptor[]
  readonly pictures?: readonly MapPictureDescriptor[]
}

/**
 * `map.layer-read` output and `map.layer-write` input: row-major samples, row 0 at the map's north
 * edge (image order), `width * height` integers within the descriptor's bounds. `x`/`y` place a
 * window: its first sample's column from the west edge and row from the north edge. Without them
 * the grid is the whole layer.
 */
export interface MapLayerGrid {
  readonly layer: string
  readonly x?: number
  readonly y?: number
  readonly width: number
  readonly height: number
  readonly values: readonly number[]
}

/** `map.layer-read` input: the whole layer, or a window given by all four of `x`, `y`, `width`, `height`. */
export interface MapLayerReadRequest {
  readonly layer: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface MapLayerWindow {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The representation a map codec's layer-write fidelity proof names. */
export const MAP_LAYERS_REPRESENTATION = Object.freeze({
  id: 'map-layers',
  contract: 'common.map/layers',
  major: 1,
} as const)

const sampleOrigin = {
  x: { type: 'integer', minimum: 0, description: 'Column of the first sample, counted from the west edge.' },
  y: { type: 'integer', minimum: 0, description: 'Row of the first sample, counted from the north edge (row 0).' },
} as const
const windowSize = {
  width: { type: 'integer', minimum: 1, description: 'Columns in the window; x + width stays within the layer.' },
  height: { type: 'integer', minimum: 1, description: 'Rows in the window; y + height stays within the layer.' },
} as const
const layerId = {
  type: 'string',
  minLength: 1,
  description: 'A layer id from map.layers of the same subject revision.',
} as const
const anyNamed = (...names: readonly string[]) => ({ anyOf: names.map(name => ({ required: [name] })) })

/** `map.layers` input: none. */
export const MAP_LAYERS_INPUT_SCHEMA: JsonSchemaRef = Object.freeze({
  $ref: 'modkit://map/layers.v1',
  document: {
    $id: 'modkit://map/layers.v1',
    description:
      'Lists the grid layers of a map. Each layer names its size, integer sample bounds, whether it is editable, and optionally what a sample means in the world: world value = valueOffset + sample * valueScale, in unit, sampled at grid vertices or in cells; a layer of classes may carry a legend (categories: value, label, colour). pictures lists images the codec draws itself, rendered by view.render with { layer: id }.',
    anyOf: [{ type: 'null' }, { type: 'object', properties: {}, additionalProperties: false }],
  },
})

/** `map.layer-read` input; `mapLayerWindow` checks the same rules against the layer. */
export const MAP_LAYER_READ_INPUT_SCHEMA: JsonSchemaRef = Object.freeze({
  $ref: 'modkit://map/layer-read.v1',
  document: {
    $id: 'modkit://map/layer-read.v1',
    description:
      'Reads a layer as row-major integer samples, row 0 at the north edge. Without x, y, width and height the whole layer is read; a window names all four. World value = valueOffset + sample * valueScale from map.layers.',
    type: 'object',
    required: ['layer'],
    additionalProperties: false,
    properties: { layer: layerId, ...sampleOrigin, ...windowSize },
    anyOf: [{ not: anyNamed('x', 'y', 'width', 'height') }, { required: ['x', 'y', 'width', 'height'] }],
  },
})

/** `map.layer-write` input; the answer is an edit plan, applied only by prepare and commit. */
export const MAP_LAYER_WRITE_INPUT_SCHEMA: JsonSchemaRef = Object.freeze({
  $ref: 'modkit://map/layer-write.v1',
  document: {
    $id: 'modkit://map/layer-write.v1',
    description:
      "Plans writing width x height integer samples, row-major, row 0 at the north edge, into an editable layer. x and y place the window and go together; without them the grid is the whole layer. Every value stays within the layer's minimum and maximum; world value = valueOffset + sample * valueScale. expectedSourceRevision, when given, must be the subject revision the samples were read from.",
    type: 'object',
    required: ['layer', 'width', 'height', 'values'],
    additionalProperties: false,
    properties: {
      layer: layerId,
      ...sampleOrigin,
      ...windowSize,
      values: {
        type: 'array',
        minItems: 1,
        items: { type: 'integer', minimum: 0, maximum: 0xffff },
        description: "width * height samples, row-major, within the layer's minimum and maximum.",
      },
      expectedSourceRevision: { type: 'string', minLength: 1, description: 'Revision the window was read from.' },
    },
    anyOf: [{ required: ['x', 'y'] }, { not: anyNamed('x', 'y') }],
  },
})

/**
 * The one bounds check of `map.layer-read` requests and `map.layer-write` grids against a layer.
 * A read names all four of `x`, `y`, `width`, `height` or none (the whole layer); a grid (it has
 * `values`) names `x` and `y` both or neither, and holds `width * height` integers within the
 * layer's bounds, and its layer must be editable. Throws `RangeError`; returns the window.
 */
export function mapLayerWindow(
  layer: MapLayerDescriptor,
  input: MapLayerReadRequest | MapLayerGrid,
): MapLayerWindow {
  const fail = (message: string): never => {
    throw new RangeError(`map layer ${layer.id}: ${message}`)
  }
  if (input.layer !== layer.id) fail(`request names layer ${String(input.layer)}`)
  const grid = 'values' in input
  const given = (['x', 'y', 'width', 'height'] as const).filter(name => input[name] !== undefined)
  if (grid ? (input.x === undefined) !== (input.y === undefined) : given.length !== 0 && given.length !== 4) {
    fail(grid ? 'x and y go together' : 'a window needs all of x, y, width and height')
  }
  const number = (value: unknown, name: string, minimum: number): number => {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(`${name} must be an integer of at least ${minimum}`)
    return value as number
  }
  const whole = !grid && given.length === 0
  const window = Object.freeze({
    x: whole ? 0 : number(input.x ?? 0, 'x', 0),
    y: whole ? 0 : number(input.y ?? 0, 'y', 0),
    width: whole ? layer.width : number(input.width, 'width', 1),
    height: whole ? layer.height : number(input.height, 'height', 1),
  })
  if (window.x + window.width > layer.width || window.y + window.height > layer.height) {
    fail(`window ${window.x},${window.y} ${window.width}x${window.height} leaves the ${layer.width}x${layer.height} layer`)
  }
  if (!grid) return window
  if (!layer.editable) fail('the layer is read-only')
  const values: unknown = input.values
  if (!Array.isArray(values) || values.length !== window.width * window.height) {
    fail(`a ${window.width}x${window.height} grid needs ${window.width * window.height} values`)
  }
  for (const [index, value] of (values as readonly unknown[]).entries()) {
    if (!Number.isSafeInteger(value) || (value as number) < layer.minimum || (value as number) > layer.maximum) {
      fail(`value ${index} must be an integer from ${layer.minimum} to ${layer.maximum}`)
    }
  }
  return window
}

/** Host-owned matcher profile for exact game-id routing. */
export const MAP_SEMANTIC_MATCHER_PROFILE = 'modkit/map-semantic-matcher' as const

/** Host-owned exact matcher for preparation providers advertising subject format ids. */
export const MAP_PREVIEW_PREPARATION_MATCHER_PROFILE =
  'modkit/map-preview-preparation-matcher' as const

/** One bounded namespace fact; entry ids and open/extract capabilities intentionally stay hidden. */
export interface MapPreviewPreparationNamespaceEntry {
  readonly path: string
  readonly kind: 'file' | 'directory'
  /** Decimal bytes because bigint is not JSON-safe. */
  readonly size?: string
}

export interface MapPreviewPreparationNamespaceIndex {
  readonly state: 'unavailable' | 'complete' | 'truncated'
  readonly entries: readonly MapPreviewPreparationNamespaceEntry[]
}

/** One provider-requested lookup executed by the host against an optional namespace index. */
export interface MapPreviewPreparationNamespaceSearchRequest {
  readonly searchId: string
  readonly query: NamespaceEntrySearchQuery
}

/** JSON-only bounded facts returned by the host on the next preparation call. */
export interface MapPreviewPreparationNamespaceSearchIndex {
  readonly searchId: string
  readonly state: 'unsupported' | 'complete' | 'truncated'
  readonly entries: readonly MapPreviewPreparationNamespaceEntry[]
}

/** One bounded metadata document a preparation provider asks the host to read from the subject. */
export interface MapPreviewPreparationDocumentReadRequest {
  readonly documentId: string
  readonly path: string
  readonly maxBytes: number
}

/** JSON-only result of a host-owned document read; live namespace and extraction handles stay local. */
export interface MapPreviewPreparationDocumentReadResult {
  readonly documentId: string
  readonly path: string
  readonly state: 'read' | 'missing' | 'too-large' | 'unreadable' | 'unsupported'
  readonly text?: string
}

/** JSON-safe descriptor facts exposed to a preparation provider; no live session crosses the ABI. */
export interface MapPreviewPreparationSubject {
  readonly schemaVersion: 1
  readonly subjectUri: string
  readonly revision: string
  readonly formatId: string
  readonly traits: readonly string[]
  readonly dataSources: readonly Readonly<{ contract: string; major: number }>[]
  readonly operations: readonly Readonly<{ id: string; state: string }>[]
  /** Bounded host listing used for multi-map selection/root detection without namespace authority. */
  readonly namespace: MapPreviewPreparationNamespaceIndex
  /** Results of one host-owned indexed-search round; absent on older hosts, empty initially. */
  readonly namespaceSearches?: readonly MapPreviewPreparationNamespaceSearchIndex[]
  /** Results of one provider-requested bounded metadata read round. */
  readonly documentReads?: readonly MapPreviewPreparationDocumentReadResult[]
}

export interface MapPreviewPreparationDiagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'information' | 'hint'
  readonly message: string
  readonly path?: readonly (string | number)[]
  readonly data?: JsonValue
}

export interface MapPreviewSelectionCandidate {
  readonly candidateId: string
  readonly displayName: string
  /** Provider-owned stable logical root, shown for disambiguation but never interpreted by common UI. */
  readonly sourcePath?: string
}

/** One opaque, provider-declared host resource root. Common code never interprets `locator`. */
export interface MapPreviewHostResourceRoot {
  readonly rootId: string
  readonly locator: JsonValue
  /**
   * The game plays without this root: an add-on it mounts only when installed (Warzone 2100's
   * `terrain_overrides/high.wz`). A resolver that finds nothing for it leaves the root empty with an
   * informational diagnostic instead of failing the plan.
   */
  readonly optional?: boolean
}

/** Maps one workspace root to a confined prefix inside the opened subject namespace. */
export interface MapPreviewSubjectNamespaceRoot {
  readonly rootId: string
  /** Empty explicitly means the namespace root (for example a standalone map archive). */
  readonly namespacePrefix: string
  /**
   * Where under the prefix the subject keeps its assets, in lookup order, as its codec declares
   * them (`container.assetRoots`; '' is the prefix itself, '*.X' a wildcard). A game-logical id that
   * starts with one of them is also looked up under each other: an SC2 map carries what it imports
   * at its root where a mod keeps Base.SC2Assets, and both answer `base.sc2assets/Assets/...`.
   */
  readonly assetRoots?: readonly string[]
}

/**
 * JSON-only resource strategy paired with a prepared workspace.
 *
 * `subject-namespace` is the complete same-container path. `host-resolved` is explicit whenever
 * dependencies may live outside the opened subject; a trusted host adapter turns its opaque roots
 * into one confined origin without sending live filesystem/CASC/VFS capabilities through the
 * preparation service.
 */
export type MapPreviewResourcePlan =
  | Readonly<{
      schemaVersion: 1
      strategy: 'subject-namespace'
      roots: readonly MapPreviewSubjectNamespaceRoot[]
    }>
  | Readonly<{
      schemaVersion: 1
      strategy: 'host-resolved'
      resolverId: string
      /** Exact subject mounts the host resolver may include; empty excludes the subject namespace. */
      subjectNamespaceRoots: readonly MapPreviewSubjectNamespaceRoot[]
      roots: readonly MapPreviewHostResourceRoot[]
    }>

export interface MapPreviewPreparedPlan {
  readonly schemaVersion: 1
  /** Fully JSON-safe graph; the host validates and resolves it into a ModWorkspaceLock. */
  readonly workspace: ModWorkspaceGraphInput
  /** Explicit origin strategy; external installation/dependency roots are never inferred. */
  readonly resources: MapPreviewResourcePlan
}

export interface MapPreviewPreparationRequest {
  readonly subject: MapPreviewPreparationSubject
  /** Opaque candidate id returned by an earlier selection-required result. */
  readonly selectionId?: string
  readonly maxCandidates: number
  readonly maxRoots: number
  readonly maxDepth: number
  readonly signal?: AbortSignal
}

/** Every arm is wire-safe; live namespaces, ResourceSessions and AssetSessions stay in the host. */
export type MapPreviewPreparationResult =
  | Readonly<{
      state: 'not-applicable'
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>
  | Readonly<{
      state: 'selection-required'
      candidates: readonly MapPreviewSelectionCandidate[]
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>
  | Readonly<{
      state: 'namespace-search-required'
      searches: readonly MapPreviewPreparationNamespaceSearchRequest[]
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>
  | Readonly<{
      state: 'document-read-required'
      documents: readonly MapPreviewPreparationDocumentReadRequest[]
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>
  | Readonly<{
      state: 'prepared'
      plan: MapPreviewPreparedPlan
      diagnostics: readonly MapPreviewPreparationDiagnostic[]
    }>

/** Activated extension-owned preparation provider. */
export interface MapPreviewPreparationPort {
  readonly contract: typeof MAP_PREVIEW_PREPARATION_CONTRACT
  readonly preparationId: string
  readonly subjectFormatIds: readonly string[]
  prepare(request: MapPreviewPreparationRequest): Promise<MapPreviewPreparationResult>
}

/** JSON-safe route advertised by a preparation contribution. */
export interface MapPreviewPreparationOfferFacet {
  readonly subjectFormatIds: readonly string[]
}

/** JSON-safe route derived from the ordinary codec descriptor by the common host. */
export interface MapPreviewPreparationRequestFacet {
  readonly subjectFormatId: string
}

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
  /**
   * Operation ids the opened map subject declares. A publisher names its world edit route only
   * among them — a codec family may name the same edit differently per codec (packed or folder).
   * Absent when the caller analyzes documents without an opened subject.
   */
  readonly subjectOperationIds?: readonly string[]
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
  | 'objects'
  | 'regions'
  | 'terrain-height'
  | 'terrain-native-parameters'
  | 'terrain-resource-index'
  | 'terrain-vertex-color'
  | 'navigation'
  | 'gateways'

export type MapSemanticDocumentScope = 'map-root' | 'workspace'

/** One provider-authored logical read; the host resolves it through ResourceSessionPort. */
export interface MapSemanticDocumentRequirement {
  readonly requirementId: string
  readonly path: string
  readonly kind: MapSemanticDocumentKind
  readonly required: boolean
  /** Defaults to `map-root`; `workspace` admits a confined dependency-layer logical path. */
  readonly scope?: MapSemanticDocumentScope
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

export type MapObjectKind = 'unit' | 'structure' | 'feature' | 'doodad' | 'point' | 'camera'

/** A schema link for an object, resolved when the supplied catalog contains the entity. */
export interface MapCatalogBinding {
  readonly ref: DataEntityRef
  readonly entity?: DataResolvedEntity
}

/** One persistent model instance in a compound placed object. `resourceId` joins the object's
 * scoped model requirements before world publication and the world resources facet afterwards. */
export interface MapModelComponentPlacement {
  readonly id: string
  readonly resourceId: string
  /** Both attachment fields are present together. Roots omit both. */
  readonly parentId?: string
  readonly parentSocketId?: string
  /** Optional local rotation applied after the parent socket transform. */
  readonly rotation?: readonly [number, number, number, number]
}

export interface MapPlacedObject {
  readonly kind: MapObjectKind
  readonly objectId: number
  /** Source-authored id when it exists separately from the workspace-unique object identity. */
  readonly sourceObjectId?: number
  /** Stable publisher key used when the source format does not carry a numeric id. */
  readonly sourceKey?: string
  readonly position: MapPosition
  /** Two means the publisher deliberately ignored any authored third component. */
  readonly sourcePositionDimensions?: 2 | 3
  /** How the authored vertical component is interpreted when exact terrain is available. */
  readonly heightReference?: 'absolute' | 'terrain-relative' | 'terrain-surface'
  readonly rotation?: number
  /** 'radians', 'degrees' or 'uint16-turn' (65 536 per turn). */
  readonly nativeRotationUnit?: string
  /**
   * Which way a positive `rotation` turns seen from above in UVW: 'counter-clockwise' (the default,
   * a right-handed turn about +Y) or 'clockwise' — Warzone 2100 turns a model by −direction in a
   * world whose z is −mapY.
   */
  readonly nativeRotationSense?: 'counter-clockwise' | 'clockwise'
  /**
   * The rotation the game draws when it differs from the authored one, same unit and sense
   * (Warzone 2100 snaps structures to quarter turns and turns walls to their neighbours).
   * Presentation only: `rotation` stays the authored data.
   */
  readonly presentationRotation?: number
  readonly scale?: MapPosition
  readonly typeId?: string
  readonly player?: number
  /** Explicit renderer-neutral RGB for source/team colour material channels. */
  readonly presentationTeamColor?: readonly [number, number, number]
  /** Renderer team-color intensity for this object (see `SceneRendererMaterialContext`); 0 = none. */
  readonly presentationTeamColorIntensity?: number
  /**
   * Authored per-object tint: RGB 0..1 multiplying the shaded colour of the object's model, in the
   * colour space of its textures (no transfer function applied). Absent means no tint.
   */
  readonly presentationTint?: readonly [number, number, number]
  readonly variation?: number
  /** Authored resource amount, before any gameplay harvesting. */
  readonly resources?: number
  /** Initial animation selected by the source's resolved actor events. */
  readonly presentationAnimation?: {
    readonly name: string
    readonly groups: readonly string[]
    readonly loop: boolean
    readonly speed: number
    /**
     * Each instance starts the looping clip at its own point (SC2 `RandomStartOffset`), so placed
     * copies of one model do not animate in lockstep. The renderer picks a stable phase per object.
     */
    readonly randomStart?: boolean
  }
  readonly modules?: number
  readonly name?: string
  readonly catalog?: MapCatalogBinding
  /** Host-resolved model asset discovered from the resolved game catalog, never an ambient path. */
  readonly modelResource?: LogicalResourceRequirement
  /** Ordered component models for compound objects. Each requirement remains independently scoped;
   * consumers must not collapse a droid/attachment composition to one guessed path. */
  readonly modelResources?: readonly LogicalResourceRequirement[]
  /**
   * Explicit composition for repeated/attached component instances. Array order is not semantic.
   * An empty array: the object draws nothing of its own (a Warzone 2100 module built into its base).
   */
  readonly modelComponents?: readonly MapModelComponentPlacement[]
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
  /** Publisher-decoded scalar vertex AO; 1 means unoccluded. */
  readonly ambientOcclusion?: number
  readonly x: number
  readonly y: number
  readonly heightBase: number
  readonly heightAdjustment: number
  /**
   * Adjustment to draw with where the publisher's cliff pieces model the wall and need the terrain
   * step placed differently than the authored value. Presentation only: `heightAdjustment` stays
   * the authored data for editing and export.
   */
  readonly presentationHeightAdjustment?: number
  /**
   * The cell from this sample to `(x + 1, y + 1)` is a hole in the drawn ground: the map cut it so
   * what lies below shows through (SC2 `t3CellFlags` value 3 — the space around a platform). It is
   * neither drawn nor casts. Presentation only: heights stay authored for editing and export.
   */
  readonly presentationCellHidden?: true
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

/** Dominant authored terrain material at one terrain cell. */
export interface MapTerrainMaterialSample {
  readonly x: number
  readonly y: number
  readonly textureIndex: number
  readonly textureName?: string
  /** Exact normalized blend weights when the publisher exposes the authored splat data. */
  readonly weights?: readonly Readonly<{ readonly materialId: string; readonly weight: number }>[]
  /** Per-sample UV orientation/tiling; needed for formats with rotated or flipped terrain tiles. */
  readonly uvTransform?: Readonly<{
    readonly offset: readonly [number, number]
    readonly scale: readonly [number, number]
    readonly rotation: number
  }>
  /**
   * A tile drawn over this cell's blended ground with its base colour's alpha (Warzone 2100 decal
   * tiles): the material's texture over the cell, oriented by `uvTransform` as a tile is. Presentation
   * only; the weights stay the ground.
   */
  readonly decal?: Readonly<{
    readonly materialId: string
    readonly uvTransform?: Readonly<{
      readonly offset: readonly [number, number]
      readonly scale: readonly [number, number]
      readonly rotation: number
    }>
  }>
}

export interface MapTerrainMaterialDefinition {
  readonly materialId: string
  readonly label?: string
  /** Portable semantic classification when the publisher can prove one (for example TER_WATER). */
  readonly classification?: string
  readonly sourceIndex?: number
  readonly baseColorResourceId?: string
  /** Host-resolvable source texture. The id remains the portable UVW join key. */
  readonly baseColorResource?: LogicalResourceRequirement
  /**
   * Exactly glTF `pbrMetallicRoughness.baseColorFactor`: linear RGBA 0..1 multiplying the base
   * colour texture, or the colour itself without one (Roblox `Terrain.MaterialColors`). Absent means
   * [1, 1, 1, 1]; alpha does not make the terrain transparent.
   */
  readonly baseColorFactor?: readonly [number, number, number, number]
  readonly normalResourceId?: string
  readonly normalResource?: LogicalResourceRequirement
  /**
   * How the normal texture's channels spell the tangent-space normal. `rgb` (the default) is the
   * usual XYZ-in-RGB, X along the texture's u and Y along its v (image rows downward);
   * `rgb-inverted-y` is the same with Y against v, as Warzone 2100 reads its ground normal maps
   * (terrain_combined.vert: bitangent N × (N × x̂)); `xy-in-alpha-green` takes X from alpha and Y
   * from green and reconstructs Z, as DXN-swizzled maps do — the publisher knows this, the renderer
   * cannot guess it.
   */
  readonly normalEncoding?: 'rgb' | 'rgb-inverted-y' | 'xy-in-alpha-green'
  readonly specularResourceId?: string
  readonly specularResource?: LogicalResourceRequirement
  /**
   * What the specular texture holds. `color` (the default) is a specular colour lit as
   * `colour · pow(N·H, specularExponent)`. `gloss` is a gloss `g` in red, lit as
   * `g² · clamp(pow(N·H, specularExponent · (1 − g²))) · N·L`, as Warzone 2100's terrain shaders read
   * their `_sm` maps (light.glsl blinnTerm, terrain_combined_high.frag). The exponent and multiplier
   * are the lighting's `terrain` settings.
   */
  readonly specularEncoding?: 'color' | 'gloss'
  readonly uvTransform?: Readonly<{
    readonly offset: readonly [number, number]
    readonly scale: readonly [number, number]
    readonly rotation: number
  }>
}

/**
 * GPU-ready exact authored blend raster. Channels name materials in RGBA order; with `sum`
 * normalization the weights of all of a map's rasters add up to one at each texel.
 */
export interface MapTerrainWeightRaster {
  readonly resourceId: string
  readonly width: number
  readonly height: number
  readonly materialIds: readonly string[]
  readonly encoding: 'rgba8-unorm'
  readonly normalization: 'sum'
  /** Publisher-owned decoded bytes; omitted from layer catalogs and serialized UVW metadata. */
  readonly rgba?: Uint8Array
}

/** Bounded material grid resolved from a publisher's native terrain-layer documents. */
export interface MapTerrainMaterialSummary {
  readonly version: number
  readonly width: number
  readonly height: number
  /** Whether samples are a dominant-cell classification or the normalized authored blend. */
  readonly weightEncoding?: 'dominant-only' | 'normalized-exact'
  readonly maskResolution?: Readonly<{
    readonly width: number
    readonly height: number
    readonly layers: number
  }>
  readonly cellCount: number
  readonly textureNames: readonly string[]
  readonly materials?: readonly MapTerrainMaterialDefinition[]
  /** Exact high-resolution weights independent of the bounded sample preview. */
  readonly weightRasters?: readonly MapTerrainWeightRaster[]
  readonly samples: readonly MapTerrainMaterialSample[]
  readonly exact: boolean
}

export interface MapWaterZone {
  readonly zoneId: number
  readonly templateId: string
  readonly minimum: Readonly<{ x: number; y: number }>
  readonly maximum: Readonly<{ x: number; y: number }>
  /** Undefined until the publisher resolves a water template or authored vertical coordinate. */
  readonly elevation?: number
  /** Stable join into MapWaterSummary.materials when visual parameters resolved. */
  readonly materialId?: string
}

/** Portable initial visual state for one water/lava surface material. Native gameplay physics
 * and shoreline object spawning remain outside this spatial render contract. */
export interface MapWaterMaterialDefinition {
  readonly materialId: string
  readonly label?: string
  readonly classification?: 'water' | 'lava'
  /** Whether ground intersections clip the surface or the authored zone is authoritative. */
  readonly shorelineMode?: 'terrain-clipped' | 'zone'
  readonly color: readonly [number, number, number, number]
  /**
   * How the surface meets the ground under it. `over` (the default) lays its colour over it by
   * alpha, deepening with depth. `multiply` multiplies the ground under it by the unlit surface
   * colour — `color` times the base image times the second image's red — as Warzone 2100 draws
   * water at its default quality (REND_MULTIPLICATIVE, shaders/water.frag), right after the terrain.
   */
  readonly compositing?: 'over' | 'multiply'
  readonly baseColorResourceId?: string
  readonly baseColorResource?: LogicalResourceRequirement
  /** Optional second surface sample. When absent, the base image is sampled twice. */
  readonly secondaryColorResourceId?: string
  readonly secondaryColorResource?: LogicalResourceRequirement
  /** Two world-space UV scale pairs for dual scrolling surface samples. */
  readonly uvScale?: readonly [number, number, number, number]
  /** Two authored UV velocity pairs in units per second. */
  readonly scroll?: readonly [number, number, number, number]
  readonly colorFalloff?: number
  readonly specularity?: number
  readonly specularScale?: number
  readonly reflectivityPower?: number
  /**
   * The surface's wave normals (SC2 Water.fx): two tangent-space normals packed in one image, x/y in
   * red/green and in blue/alpha, sampled at the map position times `uvScale` (first pair) and
   * moved by the first and second `scroll` pair. They light the surface and its highlight
   * (`specularity` exponent, `specularScale`).
   */
  readonly normalResourceId?: string
  readonly normalResource?: LogicalResourceRequirement
  readonly causticsResourceId?: string
  readonly causticsResource?: LogicalResourceRequirement
  /**
   * The caustics flip-book in playing order, at `causticsFramesPerSecond`; ids join
   * `causticsFrameResources` by index. `causticsResourceId` stays the first frame for consumers that
   * draw one image.
   */
  readonly causticsFrameResourceIds?: readonly string[]
  readonly causticsFrameResources?: readonly LogicalResourceRequirement[]
  readonly causticsScale?: readonly [number, number]
  readonly causticsFramesPerSecond?: number
  /**
   * How strongly caustics light the bottom with water depth: saturate(causticsFalloff × depth) in world
   * units (SC2 CWater State CausticsFallOff). Absent means the surface casts no caustics.
   */
  readonly causticsFalloff?: number
  readonly receiveShadows?: boolean
  /**
   * The ground's ambient occlusion (MapTerrainSample.ambientOcclusion) darkens the surface over it
   * too, as Warzone 2100 multiplies its high-quality water by the tile brightness
   * (terrain_water_high.frag). Absent means it does not.
   */
  readonly occludedLikeTerrain?: boolean
  /**
   * The surface shaded per pixel as Warzone 2100's high-quality water (terrain_water_high.frag)
   * instead of a flat colour: see MapWaterDetailWaves. `color` is the water colour its diffuse
   * light shows; the base and second images are sampled on the two UV sets for glitter.
   */
  readonly detailWaves?: MapWaterDetailWaves
}

/**
 * Detail waves of a lit, see-through water surface (Warzone 2100 terrain_water_high.frag). Two
 * normal images (RGB, blue out of the surface) are read on the two scrolling UV sets of the
 * material's `uvScale`/`scroll`, each twice more with its own extra movement; the first pair is
 * blended by reoriented normal mapping, averaged with the second pair and flattened by `upScale`.
 * The pixel is the water colour lit by the key light's diffuse, glitter from the base and second
 * images' red, foam near the shore, a Blinn (128) and mirror (14) highlight, and a warm fresnel
 * tint where the eye looks against the light; its opacity is 0.5 plus a view-angle term (0.15–0.5)
 * times a depth term that thins it where the water is shallower than `depthRange`.
 */
export interface MapWaterDetailWaves {
  /** Normal images on the first and second UV set. */
  readonly normalResourceIds: readonly [string, string]
  readonly normalResources: readonly [LogicalResourceRequirement, LogicalResourceRequirement]
  /** Foam masks (red) on the first and second UV set; absent: foam from the waves alone. */
  readonly foamResourceIds?: readonly [string, string]
  readonly foamResources?: readonly [LogicalResourceRequirement, LogicalResourceRequirement]
  /**
   * Extra UV movement per second of the four normal samples, (u, v) each: the first image, the
   * second, the first again, the second again.
   */
  readonly sampleScroll: readonly [number, number, number, number, number, number, number, number]
  /** The blended normal's up component is scaled by this before normalizing: larger is calmer. */
  readonly upScale: number
  /** Water depth (world units) at which the surface reaches full opacity and loses its foam. */
  readonly depthRange: number
}

export interface MapWaterSummary {
  readonly version: number
  readonly zones: readonly MapWaterZone[]
  readonly materials?: readonly MapWaterMaterialDefinition[]
  /** False when the common constant-elevation zone shape cannot encode every native water tile. */
  readonly exact?: boolean
}

export interface MapCliffSample {
  readonly x: number
  readonly y: number
  readonly level: number
  readonly authored: boolean
  /**
   * The sample lies on a ramp: walkable ground rising between two cliff levels, not a cliff. A view
   * draws no cliff line across it; the publisher decides from its own data.
   */
  readonly ramp?: boolean
}

/** One ordered model choice for a cliff mesh piece; `yaw` rotates it about the vertical axis. */
export interface MapCliffPieceCandidate {
  readonly requirement: LogicalResourceRequirement
  /** Radians, counter-clockwise in the map-native horizontal plane. */
  readonly yaw: number
}

/**
 * Publisher-resolved presentation model for authored cliff pieces. The host draws the first
 * candidate that resolves; a publisher lists alternatives when only the game's asset set decides.
 */
export interface MapCliffPieceModel {
  readonly id: string
  readonly candidates: readonly MapCliffPieceCandidate[]
  /**
   * A cliff set may share one mesh family and skin it separately: the materials of this model
   * replace the piece model's materials by index, with their own textures.
   */
  readonly materialModel?: LogicalResourceRequirement
}

/** One authored cliff/ramp mesh placement derived from native cliff data. */
export interface MapCliffPiece {
  readonly id: string
  /** Map-native position with absolute height. */
  readonly position: MapPosition
  readonly modelId: string
  readonly ramp?: boolean
}

/** Native synchronized cliff levels. Geometry remains explicit publisher-candidate data. */
export interface MapCliffSummary {
  readonly version: number
  readonly width: number
  readonly height: number
  readonly cellCount: number
  readonly samples: readonly MapCliffSample[]
  readonly exact: boolean
  /** Presentation-only cliff meshes; they are drawn with the world but never exported as objects. */
  readonly pieceModels?: readonly MapCliffPieceModel[]
  readonly pieces?: readonly MapCliffPiece[]
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

/** Exact quantized native terrain mapping from a terrain document and complete height grid. */
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

/** Exact direct-height terrain mapping qualified by the contributing extension. */
export interface MapDirectTerrainNativeTransform extends MapTerrainNativeTransformBase {
  readonly source: Readonly<{
    readonly terrainDocumentPath: string
    readonly format: string
    readonly heightEncoding: string
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
    /**
     * The oracle compared against: the sealed legacy (MK2) adapter, the publisher's own reference,
     * or an open third-party reference the owner accepted (`references/mdx-m3-viewer`, MIT, for
     * Warcraft III terrain); `oracle` names which.
     */
    readonly method:
      | 'sealed-legacy-differential'
      | 'official-reference-differential'
      | 'third-party-reference-differential'
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

/**
 * The bytes a qualification digests: each tuple as three little-endian binary64 values, in order.
 * `nativeTupleDigest` and `canonicalTupleDigest` of a {@link MapWorldCanonicalTransform} proof are
 * the SHA-256 of the native `(column, row, height)` and the canonical `(x, y, z)` encodings — one
 * encoding for every adapter, so two worlds that agree to the bit digest the same.
 */
export function mapQualificationTupleBytes(
  tuples: readonly (readonly [number, number, number])[],
): Uint8Array {
  const view = new DataView(new ArrayBuffer(tuples.length * 24))
  tuples.forEach((tuple, index) => {
    for (let axis = 0; axis < 3; axis += 1)
      view.setFloat64(index * 24 + axis * 8, tuple[axis] ?? Number.NaN, true)
  })
  return new Uint8Array(view.buffer)
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

export interface MapGatewaySegment {
  readonly id: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** Exact publisher-native navigation gateway segments. */
export interface MapGatewaySummary {
  readonly exact: boolean
  readonly segments: readonly MapGatewaySegment[]
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
  /** Exact native edit route; viewers still submit an intent and never write documents directly. */
  readonly edit?: Readonly<{
    readonly operationId: string
    readonly moveObjectKind: 'object.update'
  }>
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
  /** Provider-authored conversion scale for native model resources placed in this map world. */
  readonly modelMetersPerSourceUnit?: number
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

/**
 * How far from the eye shadows are drawn, with that eye's vertical field of view (SC2 CCamera
 * ShadowClip and FieldOfView of the game camera). A renderer with another projection places the
 * perspective eye that frames its view with this field of view; past `distance` from it no point
 * receives a shadow. Absent: shadows everywhere.
 */
export interface WorldShadowRange {
  readonly distance: number
  readonly fieldOfViewDegrees: number
}

/**
 * Exponential height fog (SC2 CTerrain Fog*, Shaders/Common.fx FogDensity): at height `h` along the
 * up axis of the lighting's coordinate space the fog is `density · exp((startingHeight − h) · falloff)`
 * thick. A surface seen from the eye takes the integral of it along the eye ray, clamped to 0..1, as
 * the weight of `color` over its own lit colour, before tone mapping.
 */
export interface WorldHeightFog {
  /** 0..1 RGB, on the same scale as the light colours. */
  readonly color: readonly [number, number, number]
  /** Per world unit of ray, at `startingHeight`. */
  readonly density: number
  /** Per world unit of height; 0 keeps the fog equally thick at every height. */
  readonly falloff: number
  readonly startingHeight: number
}

/** One resolved, renderer-neutral world-lighting environment for a map snapshot. */
export interface MapWorldLightingSummary {
  readonly coordinateSpaceId: string
  readonly ambientColor: readonly [number, number, number]
  readonly ambientIntensity: number
  readonly toneMapping?: WorldToneMapping
  readonly shadowRange?: WorldShadowRange
  readonly fog?: WorldHeightFog
  readonly terrain?: WorldTerrainLighting
  readonly directional: readonly Readonly<{
    readonly id: string
    /** Direction travelled by the light rays in `coordinateSpaceId`. */
    readonly direction: readonly [number, number, number]
    readonly color: readonly [number, number, number]
    readonly intensity: number
    readonly specularColor?: readonly [number, number, number]
    readonly specularIntensity?: number
    readonly useAmbientOcclusion?: boolean
  }>[]
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
  readonly gateways?: MapGatewaySummary
  readonly terrainMaterials?: MapTerrainMaterialSummary
  readonly water?: MapWaterSummary
  readonly cliffs?: MapCliffSummary
  readonly terrainTransform?: MapTerrainNativeTransform
  readonly uvwTransform?: MapWorldCanonicalTransform
  readonly lighting?: MapWorldLightingSummary
  readonly worldCandidate: MapWorldCandidateDescriptor
  readonly unresolvedRequirementIds: readonly string[]
  readonly diagnostics: readonly MapSemanticDiagnostic[]
  readonly diagnosticsTruncated: boolean
  readonly complete: boolean
}

export type WorldSceneFacet =
  | 'layers'
  | 'terrain'
  | 'terrain-materials'
  | 'water'
  | 'cliffs'
  | 'objects'
  | 'regions'
  | 'resources'
  | 'navigation'
  | 'gateways'
  | 'lighting'
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
  /** Publisher-independent content identity used to retain unchanged heavy layers across snapshots. */
  readonly contentRevision?: string
  readonly reason?: string
}

interface WorldSceneInfoBase {
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
  readonly edit?: MapWorldCandidateDescriptor['edit']
  /** Present only when the source was decoded from an already-canonical standalone UVW artifact. */
  readonly canonicalArtifact?: Readonly<{
    readonly format: 'UVW'
    readonly version: '1.0'
    readonly spaces: readonly Readonly<{
      readonly id: string
      readonly label?: string
      readonly basis: ProjectionBasis
      readonly bounds: Readonly<{
        readonly min: readonly [number, number, number]
        readonly max: readonly [number, number, number]
      }>
    }>[]
  }>
}

/** Publisher-qualified identity retained during the candidate/common dual-publish transition. */
export interface CandidateWorldSceneInfo extends WorldSceneInfoBase {
  readonly contract: string
}

/** Common callable identity; still a candidate and not a `world-interchange` GA declaration. */
export interface WorldSceneInfo extends WorldSceneInfoBase {
  readonly contract: typeof WORLD_SCENE_SOURCE_CONTRACT
}

export interface WorldSceneLayerItem {
  readonly facet: 'layers'
  readonly id: string
  readonly layerId: string
  readonly kind: WorldSceneLayerKind
  readonly label?: string
  readonly state: WorldSceneFacetState['state']
  readonly itemCount: number
  readonly lods: readonly string[]
  readonly contentRevision?: string
  /** Original UVW-local identity when this source was reopened from a UVW artifact. */
  readonly spaceId?: string
  readonly localLayerId?: string
  /** Exact grid layout for grid-backed facets; absent when the publisher has not proved it. */
  readonly grid?: Readonly<{
    readonly columns: number
    readonly rows: number
    readonly cellSize: number
    readonly origin: readonly [number, number, number]
    readonly coordinateSpaceId: string
    readonly noDataValue?: number
  }>
  /** Material catalog used by terrain-material samples in this layer. */
  readonly materials?: readonly MapTerrainMaterialDefinition[]
  /** Initial render materials used only by water zones in this layer. */
  readonly waterMaterials?: readonly MapWaterMaterialDefinition[]
  /** Exact packageable blend rasters; pixel bytes remain behind WorldSceneSource.texture(). */
  readonly weightRasters?: readonly MapTerrainWeightRaster[]
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
   * Where the world draws this point when the publisher's presentation height differs from the
   * authored one (`presentationHeightAdjustment` over a transform without quantized vertices — the
   * riverbed Warzone 2100 sinks under water). `uvwPosition` and UVW export keep the authored height.
   */
  readonly presentationUvwPosition?: MapPosition
  /**
   * World units this vertex's painted base height (`heightBase`, the raise/lower brush) lies from the
   * terrain's standard height: (dequantized base − vertData standardHeight) × vertical scale. Cliff
   * meshes are authored at the standard height and the engine moves each of their vertices by this.
   * Present only over a quantized transform; without it a renderer takes the most common base.
   */
  readonly baseOffset?: number
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
  readonly lod: 'sampled' | 'exact'
  readonly uvwPosition?: MapPosition
}

export interface WorldSceneGatewayItem extends MapGatewaySegment {
  readonly facet: 'gateways'
  readonly layerId: string
  readonly coordinateSpaceId: string
  readonly uvwStart?: MapPosition
  readonly uvwEnd?: MapPosition
}

export interface WorldSceneTerrainMaterialItem extends MapTerrainMaterialSample {
  readonly facet: 'terrain-materials'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: 'height-grid'
  readonly lod: 'sampled' | 'exact'
  readonly uvwPosition?: MapPosition
}

export interface WorldSceneWaterItem extends MapWaterZone {
  readonly facet: 'water'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  readonly uvwMinimum?: Readonly<{ readonly x: number; readonly z: number }>
  readonly uvwMaximum?: Readonly<{ readonly x: number; readonly z: number }>
  readonly uvwElevation?: number
  readonly materialId?: string
}

export interface WorldSceneCliffItem extends MapCliffSample {
  readonly facet: 'cliffs'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: 'height-grid'
  readonly lod: 'sampled' | 'exact'
  readonly uvwPosition?: MapPosition
}

export interface WorldSceneObjectItem extends MapPlacedObject {
  readonly facet: 'objects'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  /** Stable join into the resources facet when this object names a catalog entity. */
  readonly resourceId?: string
  readonly resourceIds?: readonly string[]
  /** Render-time map-native position after applying an explicit terrain height reference. */
  readonly mapNativePresentationPosition?: MapPosition
  readonly uvwPosition?: MapPosition
  readonly uvwRotation?: readonly [number, number, number, number]
  readonly uvwScale?: MapPosition
  /** Presentation-only instance generated from another facet; never exported or edited as an object. */
  readonly derivedFrom?: 'cliffs'
}

export interface WorldSceneRegionShape {
  readonly kind: string
  readonly center?: Readonly<{ x: number; y: number }>
  readonly radius?: number
  readonly minimum?: Readonly<{ x: number; y: number }>
  readonly maximum?: Readonly<{ x: number; y: number }>
  readonly points?: readonly Readonly<{ x: number; y: number }>[]
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
  /** Region geometry transformed into the UVW horizontal x/z plane. */
  readonly uvwShapes?: readonly WorldSceneRegionShape[]
}

export interface WorldSceneResourceItem {
  readonly facet: 'resources'
  readonly id: string
  readonly layerId: string
  readonly namespace?: string
  readonly entityId?: string
  readonly resolved: boolean
  readonly kind?: 'uvm' | 'media'
  readonly uri?: string
  readonly digest?: `sha256:${string}`
  /** Standard logical resource request for the model shared by the joined object instances. */
  readonly modelResource?: LogicalResourceRequirement
  /**
   * Ordered alternatives when the publisher cannot know which asset exists; the host converts the
   * first that resolves and bakes its yaw into the model. `modelResource` is the first candidate.
   */
  readonly modelCandidates?: readonly MapCliffPieceCandidate[]
  /** Model whose materials replace the converted model's materials by index (see MapCliffPieceModel). */
  readonly materialModel?: LogicalResourceRequirement
  /** Exact reverse join to every placed object that references this resource. */
  readonly objectIds: readonly string[]
}

export interface WorldSceneLightingItem {
  readonly facet: 'lighting'
  readonly id: string
  readonly layerId: string
  readonly coordinateSpaceId: string
  readonly ambientColor: readonly [number, number, number]
  readonly ambientIntensity: number
  readonly toneMapping?: WorldToneMapping
  readonly shadowRange?: WorldShadowRange
  readonly fog?: WorldHeightFog
  readonly terrain?: WorldTerrainLighting
  readonly directional: readonly Readonly<{
    readonly id: string
    readonly direction: readonly [number, number, number]
    readonly color: readonly [number, number, number]
    readonly intensity: number
    readonly specularColor?: readonly [number, number, number]
    readonly specularIntensity?: number
    readonly useAmbientOcclusion?: boolean
  }>[]
}

/** Luminance-preserving HDR mapping, applied after transparent scene compositing. */
export interface WorldToneMapping {
  readonly operator: 'reinhard' | 'exponential' | 'logarithmic' | 'linear' | 'filmic'
  readonly exposure: number
  readonly whitePoint: number
  readonly contrast: number
  readonly correctGamma?: boolean
  readonly colorization?: WorldColorization
  readonly ambientOcclusion?: WorldAmbientOcclusion
}

export interface WorldTerrainLighting {
  readonly specularExponent: number
  readonly diffuseMultiplier: number
  readonly specularMultiplier: number
}

export interface WorldAmbientOcclusion {
  readonly radius: number
  readonly noOcclusion: number
  readonly fullOcclusion: number
  readonly power: number
}

/** Levels plus colourized HSL blend, baked into the post-tonemap 16-cubed LUT. */
export interface WorldColorization {
  readonly inputLow: number
  readonly inputHigh: number
  readonly inputGamma: number
  readonly outputLow: number
  readonly outputHigh: number
  readonly brightness: number
  readonly contrast: number
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly blend: number
}

export type WorldSceneItem =
  | WorldSceneLayerItem
  | WorldSceneTerrainItem
  | WorldSceneTerrainMaterialItem
  | WorldSceneWaterItem
  | WorldSceneCliffItem
  | WorldSceneNavigationItem
  | WorldSceneGatewayItem
  | WorldSceneObjectItem
  | WorldSceneRegionItem
  | WorldSceneResourceItem
  | WorldSceneLightingItem

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

export interface WorldSceneModelRequest extends Omit<ModelResourceRequest, 'requirement'> {
  readonly maxNodes?: number
  readonly maxMeshes: number
  readonly maxPrimitives: number
  readonly maxPrimitiveBytes: number
  readonly maxResources?: number
  readonly maxTextureBytes?: number
  readonly maxTextureTotalBytes?: number
  /**
   * Block formats the viewer's renderer uploads as stored: a model texture in one of them arrives
   * as its GPU blocks (`SceneRendererTexture.compressed`) and its budget counts block bytes; any
   * other arrives decoded. Absent: every texture decoded.
   */
  readonly compressedTextureFormats?: readonly CompressedTextureFormat[]
}

export interface WorldSceneTextureRequest {
  readonly maxBytes: number
  /** As `WorldSceneModelRequest.compressedTextureFormats`, for a terrain or water texture. */
  readonly compressedFormats?: readonly CompressedTextureFormat[]
}

export type WorldSceneTextureResult =
  | Readonly<{
      state: 'decoded'
      texture: SceneRendererTexture
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

export type WorldSceneModelResult =
  | Readonly<{
      state: 'converted'
      sourceKey: string
      /** Independently reopened UVM artifact owned by this result; portable packagers must use
       * these bytes rather than reconstructing geometry from the native session. */
      readonly uvmBytes?: Uint8Array
      readonly nodes?: readonly ModelNode[]
      readonly skeleton?: readonly ModelBoneBinding[]
      readonly animations?: readonly ModelAnimationClip[]
      readonly materials?: readonly ModelMaterialRef[]
      readonly resources?: readonly ModelResourceRef[]
      readonly sockets?: readonly ModelSocketRef[]
      readonly textures?: readonly SceneRendererTexture[]
      meshes: readonly ModelMesh[]
      primitives: readonly ModelPrimitive[]
      diagnostics: ModelResourceResult['diagnostics']
      complete: boolean
    }>
  | Extract<ModelResourceResult, { readonly state: 'unresolved' }>

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
  /** Lazily converts one joined native model through the standard host model-resource route. */
  model?(
    resourceId: string,
    request: WorldSceneModelRequest,
    signal?: AbortSignal,
  ): Promise<WorldSceneModelResult>
  /** Lazily decodes one declared terrain material raster through the ordinary host codec route. */
  texture?(
    resourceId: string,
    request: WorldSceneTextureRequest,
    signal?: AbortSignal,
  ): Promise<WorldSceneTextureResult>
}

/**
 * Bounded common world source used by host-owned preview sessions.
 *
 * Partial and unavailable facets remain first-class states, unknown facets stay named in `info`,
 * and unsupported queries return an explicit page result rather than an empty success.
 */
export interface WorldSceneSource {
  readonly contract: typeof WORLD_SCENE_SOURCE_CONTRACT
  readonly major: 1
  readonly snapshotId: string
  info(signal?: AbortSignal): Promise<WorldSceneInfo>
  page(request: WorldScenePageRequest, signal?: AbortSignal): Promise<WorldScenePage>
  /** Optional while publisher-candidate sources migrate; absence means explicit placeholders. */
  model?(
    resourceId: string,
    request: WorldSceneModelRequest,
    signal?: AbortSignal,
  ): Promise<WorldSceneModelResult>
  texture?(
    resourceId: string,
    request: WorldSceneTextureRequest,
    signal?: AbortSignal,
  ): Promise<WorldSceneTextureResult>
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
    'common.map/preview-preparation': { 1: MapPreviewPreparationPort }
  }

  interface ContractRequestMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticRequestFacet }
    }
    'common.map/resolved-workspace': {
      1: { presence: 'required'; facet: MapSemanticRequestFacet }
    }
    'common.map/preview-preparation': {
      1: { presence: 'required'; facet: MapPreviewPreparationRequestFacet }
    }
  }

  interface ContractOfferMap {
    'common.map/semantic-analysis': {
      1: { presence: 'required'; facet: MapSemanticOfferFacet }
    }
    'common.map/resolved-workspace': {
      1: { presence: 'required'; facet: MapSemanticOfferFacet }
    }
    'common.map/preview-preparation': {
      1: { presence: 'required'; facet: MapPreviewPreparationOfferFacet }
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

export type MapPreviewPreparationProviderModule = ServiceProviderModule<
  typeof MAP_PREVIEW_PREPARATION_CONTRACT,
  1
>
