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
 * The way back from a world to a game's map (WT10), as `common.model/native-encoder` is for models:
 * a game extension writes a UVW document as a map file of its own format. The map's world is the way
 * there; this is the only way back.
 */
export const NATIVE_MAP_ENCODER_CONTRACT = 'common.map/native-encoder' as const

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
export const MAP_LAYERS_REPRESENTATION = /* @__PURE__ */ Object.freeze({
  id: 'map-layers',
  contract: 'common.map/layers',
  major: 1,
} as const)

// Plain constants, no spreads: a bundle that takes one constant of this module drops the schemas.
const sampleX = {
  type: 'integer',
  minimum: 0,
  description: 'Column of the first sample, counted from the west edge.',
} as const
const sampleY = {
  type: 'integer',
  minimum: 0,
  description: 'Row of the first sample, counted from the north edge (row 0).',
} as const
const windowWidth = {
  type: 'integer',
  minimum: 1,
  description: 'Columns in the window; x + width stays within the layer.',
} as const
const windowHeight = {
  type: 'integer',
  minimum: 1,
  description: 'Rows in the window; y + height stays within the layer.',
} as const
const layerId = {
  type: 'string',
  minLength: 1,
  description: 'A layer id from map.layers of the same subject revision.',
} as const
const anyNamed = (...names: readonly string[]) => ({ anyOf: names.map(name => ({ required: [name] })) })

/** `map.layers` input: none. */
export const MAP_LAYERS_INPUT_SCHEMA: JsonSchemaRef = /* @__PURE__ */ Object.freeze({
  $ref: 'modkit://map/layers.v1',
  document: {
    $id: 'modkit://map/layers.v1',
    description:
      'Lists the grid layers of a map. Each layer names its size, integer sample bounds, whether it is editable, and optionally what a sample means in the world: world value = valueOffset + sample * valueScale, in unit, sampled at grid vertices or in cells; a layer of classes may carry a legend (categories: value, label, colour). pictures lists images the codec draws itself, rendered by view.render with { layer: id }.',
    anyOf: [{ type: 'null' }, { type: 'object', properties: {}, additionalProperties: false }],
  },
})

/** `map.layer-read` input; `mapLayerWindow` checks the same rules against the layer. */
export const MAP_LAYER_READ_INPUT_SCHEMA: JsonSchemaRef = /* @__PURE__ */ Object.freeze({
  $ref: 'modkit://map/layer-read.v1',
  document: {
    $id: 'modkit://map/layer-read.v1',
    description:
      'Reads a layer as row-major integer samples, row 0 at the north edge. Without x, y, width and height the whole layer is read; a window names all four. World value = valueOffset + sample * valueScale from map.layers.',
    type: 'object',
    required: ['layer'],
    additionalProperties: false,
    properties: {
      layer: layerId,
      x: sampleX,
      y: sampleY,
      width: windowWidth,
      height: windowHeight,
    },
    anyOf: [
      { not: /* @__PURE__ */ anyNamed('x', 'y', 'width', 'height') },
      { required: ['x', 'y', 'width', 'height'] },
    ],
  },
})

/** `map.layer-write` input; the answer is an edit plan, applied only by prepare and commit. */
export const MAP_LAYER_WRITE_INPUT_SCHEMA: JsonSchemaRef = /* @__PURE__ */ Object.freeze({
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
      x: sampleX,
      y: sampleY,
      width: windowWidth,
      height: windowHeight,
      values: {
        type: 'array',
        minItems: 1,
        items: { type: 'integer', minimum: 0, maximum: 0xffff },
        description: "width * height samples, row-major, within the layer's minimum and maximum.",
      },
      expectedSourceRevision: { type: 'string', minLength: 1, description: 'Revision the window was read from.' },
    },
    anyOf: [{ required: ['x', 'y'] }, { not: /* @__PURE__ */ anyNamed('x', 'y') }],
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

/** Host-owned exact matcher routing a native map encoder by its target format id. */
export const NATIVE_MAP_ENCODER_MATCHER_PROFILE = 'modkit/native-map-encoder-matcher' as const

/** The map formats an encoder writes (its game's ids, `ra2-map`, `minecraft-anvil`, …). */
export interface NativeMapEncoderOfferFacet {
  readonly formatIds: readonly string[]
}

/** The one map format a consumer asks for. */
export interface NativeMapEncoderRequestFacet {
  readonly formatId: string
}

export interface NativeMapEncodeRequest {
  /** The complete UVW document, as its file's bytes. The encoder never receives another map format. */
  readonly uvw: Uint8Array
  readonly options?: JsonValue
  /**
   * The target game's entities the encoder asked for (NativeMapCatalogQuestions), answered from the
   * mod context of the installation or mod the caller writes for; absent on the first call.
   */
  readonly catalogEntities?: readonly DataResolvedEntity[]
  readonly signal?: AbortSignal
}

/** The map written. */
export interface NativeMapEncoding {
  readonly formatId: string
  readonly extension: string
  readonly mediaType?: string
  readonly bytes: Uint8Array
  /**
   * What the game's map does not carry of the world, one diagnostic per kind of loss
   * (SPEC_UVM_CONVERSION §5): a layer the format has no place for, objects without a game type.
   */
  readonly diagnostics?: readonly Diagnostic[]
}

/**
 * The encoder needs the target game's catalog first, as an operation's catalog questions (owner
 * decision, question 67): the sections its objects' types live in, the tile sets of a theater. The
 * caller answers from the target's mod context and calls again with `catalogEntities`.
 */
export interface NativeMapCatalogQuestions {
  readonly formatId: string
  readonly catalogQueries: readonly DataEntityRef[]
}

export type NativeMapEncodeResult = NativeMapEncoding | NativeMapCatalogQuestions

export interface NativeMapEncoder {
  readonly contract: typeof NATIVE_MAP_ENCODER_CONTRACT
  readonly formatId: string
  readonly extension: string
  readonly mediaType?: string
  encode(request: NativeMapEncodeRequest): Promise<NativeMapEncodeResult>
}

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
  /** The part of the world these documents were read for (ResolvedMapWorkspacePlan.window). */
  readonly window?: MapWorldWindow
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

/**
 * A rectangle of a map's world in map-native x and y (the units of `MapPlacedObject.position`), for
 * a world larger than one analysis reads (MW5: a Minecraft dimension). Inclusive, minimum ≤ maximum.
 */
export interface MapWorldWindow {
  readonly minimumX: number
  readonly minimumY: number
  readonly maximumX: number
  readonly maximumY: number
}

export interface ResolvedMapWorkspacePlanRequest {
  readonly workspace: ModWorkspaceLock
  readonly maxRequirements: number
  /**
   * The part of the world a viewer looks at (CandidateWorldSceneSource.focus), for a provider whose
   * plans name a `window`; absent, the provider's own first part (around the spawn or origin).
   */
  readonly window?: MapWorldWindow
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
  /**
   * The part of the world these documents cover, when the world is larger than one plan reads: its
   * world source can then move to another part (CandidateWorldSceneSource.focus) by a plan for a
   * requested window. A provider covers at least the part of a requested window its limits allow.
   * Absent: the plan covers the whole world.
   */
  readonly window?: MapWorldWindow
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
  /**
   * How far below the object's ground its foundation reaches, in world units: the vertices at or
   * below its origin (object-local y ≤ 0) are drawn that much lower, so a defence or tree on a slope
   * meets the ground on its low side (Warzone 2100 `stretch`, tcmask_instanced.vert). Presentation
   * only: the position and exported UVW stay as authored.
   */
  readonly presentationFoundationStretch?: number
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
  /** Texture variants `modelResource` loads for this placement (see MapModelTextureVariant). */
  readonly modelTextureVariant?: MapModelTextureVariant
  /** Ordered component models for compound objects. Each requirement remains independently scoped;
   * consumers must not collapse a droid/attachment composition to one guessed path. */
  readonly modelResources?: readonly LogicalResourceRequirement[]
  /**
   * Explicit composition for repeated/attached component instances. Array order is not semantic.
   * An empty array: the object draws nothing of its own (a Warzone 2100 module built into its base).
   */
  readonly modelComponents?: readonly MapModelComponentPlacement[]
}

/**
 * Textures a model loads in a placement's variant instead of as the model names them. A texture
 * whose file name, compared without case, starts with a name's `prefix` and contains its `contains`
 * loads from the file with `suffix` added before the extension when that file resolves, else as
 * named. SC2: a CModel's TextureDeclares with the CTerrain TextureProp of the placement's TileSet
 * (the map's by default) — DecalProtoss00_Diffuse.dds loads as DecalProtoss00_Diffuse_monlyth.dds.
 */
export interface MapModelTextureVariant {
  readonly suffix: string
  readonly names: readonly Readonly<{ prefix: string; contains: string }>[]
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
  /**
   * No ground at this sample: a column the map leaves empty (a Roblox air column, a Westwood cell
   * outside the map's diamond), so what lies below shows through. Data, unlike
   * `presentationCellHidden`: the world publishes no terrain item here and declares its layer's
   * `grid.noDataValue`, which UVW keeps; a cell touching the sample is not drawn. Its heights are
   * placeholders, outside the terrain's bounds.
   */
  readonly noGround?: true
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

/**
 * A terrain texture coordinate transform, the rule of SPEC_UVW_PROFILE (owner decision 48):
 * `uv' = c + R·S·(uv − c) + offset` with `c = (0.5, 0.5)`, `S = diag(scale)` and `R` the rotation by
 * `rotation` radians, turning the u axis toward v. Pivoting on the centre turns or flips a tile in
 * place. `transformTerrainUv` applies it; a publisher holding a transform written about the UV origin
 * converts it with `terrainUvTransformFromOrigin`.
 */
export type MapTerrainUvTransform = Readonly<{
  readonly offset: readonly [number, number]
  readonly scale: readonly [number, number]
  readonly rotation: number
}>

/** `transform` applied to `uv` by the centre rule of `MapTerrainUvTransform`. */
export function transformTerrainUv(
  uv: readonly [number, number],
  transform: MapTerrainUvTransform,
): readonly [number, number] {
  const x = (uv[0] - 0.5) * transform.scale[0]
  const y = (uv[1] - 0.5) * transform.scale[1]
  const cosine = Math.cos(transform.rotation)
  const sine = Math.sin(transform.rotation)
  return [
    0.5 + x * cosine - y * sine + transform.offset[0],
    0.5 + x * sine + y * cosine + transform.offset[1],
  ]
}

/**
 * The centre-rule transform of a mapping written about the UV origin, `uv' = R·S·uv + offset`
 * (scale, then rotation, then offset): the same `scale` and `rotation`, `offset − c + R·S·c`.
 */
export function terrainUvTransformFromOrigin(
  transform: MapTerrainUvTransform,
): MapTerrainUvTransform {
  const x = 0.5 * transform.scale[0]
  const y = 0.5 * transform.scale[1]
  const cosine = Math.cos(transform.rotation)
  const sine = Math.sin(transform.rotation)
  return Object.freeze({
    offset: Object.freeze([
      transform.offset[0] - 0.5 + x * cosine - y * sine,
      transform.offset[1] - 0.5 + x * sine + y * cosine,
    ] as const),
    scale: Object.freeze([transform.scale[0], transform.scale[1]] as const),
    rotation: transform.rotation,
  })
}

/** Dominant authored terrain material at one terrain cell. */
export interface MapTerrainMaterialSample {
  readonly x: number
  readonly y: number
  readonly textureIndex: number
  readonly textureName?: string
  /** Exact normalized blend weights when the publisher exposes the authored splat data. */
  readonly weights?: readonly Readonly<{ readonly materialId: string; readonly weight: number }>[]
  /**
   * Per-sample UV orientation/tiling, in the cell's own 0..1 coordinates (centre rule of
   * `MapTerrainUvTransform`); needed for formats with rotated or flipped terrain tiles.
   */
  readonly uvTransform?: MapTerrainUvTransform
  /**
   * In place of `uvTransform`, corner by corner: the in-cell coordinates the cell's corners take,
   * local (0,0), (1,0), (1,1), (0,1), linear over each of the cell's triangles (SAGE cliff cells,
   * whose texture is stretched over the cell). The material's own transform applies after.
   */
  readonly cornerUv?: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ]
  /**
   * A tile drawn over this cell's blended ground with its base colour's alpha (Warzone 2100 decal
   * tiles): the material's texture over the cell, oriented by `uvTransform` as a tile is. Presentation
   * only; the weights stay the ground.
   */
  readonly decal?: Readonly<{
    readonly materialId: string
    readonly uvTransform?: MapTerrainUvTransform
  }>
  /**
   * Tiles of atlas materials drawn over this cell, bottom first (Warcraft III tilesets): the first
   * opaque, each other one over it by its tile's alpha; the tile's top row lies on the cell edge its
   * material's `atlas.tileTop` names. When present the cell's ground is these, not `weights`.
   */
  readonly layers?: readonly Readonly<{
    readonly materialId: string
    readonly tile: Readonly<{ readonly column: number; readonly row: number }>
    /**
     * An upper layer's coverage at the cell's corners, local (0,0), (1,0), (1,1), (0,1), 0..1, times
     * its tile's alpha (SAGE blends: 0 or 1 by blend direction). Linear over each of the cell's two
     * triangles; where one corner differs from the other three, the cell is cut along the diagonal
     * between that corner's neighbours, so a diagonal blend runs straight (Generals WorldHeightMap,
     * OpenSAGE Terrain.frag). Absent: 1 at every corner.
     */
    readonly cornerAlpha?: readonly [number, number, number, number]
  }>[]
}

export interface MapTerrainMaterialDefinition {
  readonly materialId: string
  readonly label?: string
  /**
   * The base colour texture is an atlas of square tiles in `rows` rows, as many columns as its
   * aspect gives, column 0 and row 0 at the top left; cells name a tile in `layers`. `tileTop` is the
   * cell edge a tile's top row lies on: `local-y-1` (the default) where the map's y grows north
   * (Warcraft III), `local-y-0` where its row 0 is the north edge (Dune 2000, StarCraft, Westwood).
   */
  readonly atlas?: Readonly<{ readonly rows: number; readonly tileTop?: 'local-y-1' | 'local-y-0' }>
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
  /**
   * World tiling of the material's textures, in continuous terrain cell coordinates (cell x and y),
   * by the centre rule of `MapTerrainUvTransform`; a cell's own transform applies first.
   */
  readonly uvTransform?: MapTerrainUvTransform
}

/**
 * GPU-ready blend raster. Channels name materials in RGBA order; with `sum` normalization the
 * weights of all of a map's rasters add up to one at each texel.
 */
export interface MapTerrainWeightRaster {
  readonly resourceId: string
  readonly width: number
  readonly height: number
  readonly materialIds: readonly string[]
  readonly encoding: 'rgba8-unorm'
  readonly normalization: 'sum'
  /**
   * `authored` (the default): the map's own blend data. `presentation`: the publisher's
   * approximation of how the game blends its cells (Roblox voxel materials), drawn the same but
   * not map data; a UVW export names it among its lost fields, as UVW cannot tell the two apart.
   */
  readonly derivation?: 'authored' | 'presentation'
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
     * an open third-party reference the owner accepted (`references/mdx-m3-viewer`, MIT, for
     * Warcraft III terrain; D2kEditor for Dune 2000), or the game's own data that shows the same
     * ground (Emperor's terrain mesh `test.xbf`, a top view the game ships); `oracle` names which.
     */
    readonly method:
      | 'sealed-legacy-differential'
      | 'official-reference-differential'
      | 'third-party-reference-differential'
      | 'game-data-reference-differential'
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
 * the SHA-256 of each terrain sample's map-native position `(x, y, z)` — its grid index times the
 * native cell size plus the offset, and its height, as ADR-WORLD-001 and ADR-WORLD-002 hash them
 * (`(column, row, height)` only where a cell is one native unit) — and of its canonical UVW
 * `(x, y, z)`: one encoding for every adapter, so two worlds that agree to the bit digest the same.
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

/**
 * One player slot of a map, as the map states it: objects whose `player` is `id` are drawn in its
 * colour (unless they state `presentationTeamColor` themselves).
 */
export interface MapPlayer {
  /** The slot objects name in `MapPlacedObject.player`. */
  readonly id: number
  /** Team colour, RGB in 0..1 as `presentationTeamColor`. */
  readonly color?: readonly [number, number, number]
  /**
   * The player's own shades for indexed team-colour ramps (`ModelTeamColorRule.ramp`), linear RGB
   * 0..1, as the game builds them (SC1 8, Dune 2000 and RA2/TS 16); a material's ramp of another
   * length keeps its own shades.
   */
  readonly colorRamp?: readonly (readonly [number, number, number])[]
  /** The alliance the slot starts in. */
  readonly team?: number
  readonly name?: string
  /** The publisher's own faction or race name. */
  readonly race?: string
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
  /** The map's player slots, when it states them. */
  readonly players?: readonly MapPlayer[]
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
  /**
   * `unlit`: the game shows tiles and sprites as stored, their shading painted in (Dune 2000,
   * Tiberian Sun): the world draws each texel times `unlitColor` (default white), without light
   * direction, shadow or highlight, and the other light fields do not apply. `lit` is the default.
   */
  readonly model?: 'lit' | 'unlit'
  readonly unlitColor?: readonly [number, number, number]
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

/**
 * How the game shows its world (WT3, MW6), which a world viewer opens on. Angles are degrees in the
 * UVW frame (+y up): `azimuthDegrees` is the eye's direction from what it looks at, seen from above,
 * from +x toward +z; `elevationDegrees` how far above the ground plane the eye stands (0..90).
 */
export interface MapWorldCamera {
  /** `orthographic`: the game draws without perspective (an isometric or editor view). */
  readonly projection: 'orthographic' | 'perspective'
  readonly azimuthDegrees?: number
  readonly elevationDegrees?: number
  /** A perspective lens: its vertical field of view. */
  readonly fieldOfViewDegrees?: number
  /** How far the game draws, in UVW units (metres): a perspective view's far plane. */
  readonly drawDistance?: number
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
  /** The game's view of the world, when the publisher knows it. */
  readonly camera?: MapWorldCamera
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
  /** Why the publisher's `uvwTransform` was refused: the first check it failed. */
  readonly uvwTransformRefusal?: string
  /** The map's player slots (MapSemanticSnapshot.players): a viewer colours objects by them. */
  readonly players?: readonly MapPlayer[]
  /** The game's view of the world (ResolvedMapWorkspaceSnapshot.camera): a viewer opens on it. */
  readonly camera?: MapWorldCamera
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
  /** Texture variants the joined instances' model loads (MapPlacedObject.modelTextureVariant). */
  readonly modelTextureVariant?: MapModelTextureVariant
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
  /** As MapWorldLightingSummary: `unlit` draws each texel times `unlitColor`, without light. */
  readonly model?: 'lit' | 'unlit'
  readonly unlitColor?: readonly [number, number, number]
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
  readonly bounds?: MapWorldWindow
}

/**
 * A rectangle of a world as its viewer draws it: uvw-canonical x and z, its ground plane (the world
 * plan's own x and z where an object has no canonical position).
 */
export interface WorldSceneViewWindow {
  readonly minimumX: number
  readonly minimumZ: number
  readonly maximumX: number
  readonly maximumZ: number
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

/**
 * The UVM bytes a world model result says it needed when it did not fit its request: the size a
 * `x3.host/model-resource-too-large` refusal names, or the converted UVM of a result whose textures
 * ran out of the `maxBytes` they share with it (`x3.host/resource-budget-exceeded`). A caller asks
 * again with these bytes and its texture budget; undefined when the result names neither.
 */
export function worldModelRequiredBytes(result: WorldSceneModelResult): number | undefined {
  let required: number | undefined
  for (const item of result.diagnostics) {
    const named = (item.data as { readonly requiredBytes?: unknown } | undefined)?.requiredBytes
    if (item.code === 'x3.host/model-resource-too-large' && typeof named === 'number')
      required = named
    else if (item.code === 'x3.host/resource-budget-exceeded' && result.state === 'converted')
      required = result.uvmBytes?.byteLength ?? required
  }
  return required !== undefined && Number.isSafeInteger(required) && required > 0
    ? required
    : undefined
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
  /**
   * Resolves true once a refined world has replaced this one: a map preview shows its world before
   * the map's catalog has answered, then the answered world (models and terrain the catalog names).
   * After it resolves, `info` and every page name the refined snapshot; a reader reads again. Resolves
   * false when no refinement will come. Absent: the world is final when opened.
   */
  refined?(signal?: AbortSignal): Promise<boolean>
  /**
   * Asks a world larger than it holds to hold `window`, what a viewer looks at (MW5): resolves true
   * once a world covering it has replaced this one (a new snapshot, read again as after `refined`),
   * false when this one already covers it or cannot move there. Absent: the world is whole.
   */
  focus?(window: WorldSceneViewWindow, signal?: AbortSignal): Promise<boolean>
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
  /** See CandidateWorldSceneSource.refined. */
  refined?(signal?: AbortSignal): Promise<boolean>
  /** See CandidateWorldSceneSource.focus. */
  focus?(window: WorldSceneViewWindow, signal?: AbortSignal): Promise<boolean>
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
    'common.map/native-encoder': { 1: NativeMapEncoder }
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
    'common.map/native-encoder': {
      1: { presence: 'required'; facet: NativeMapEncoderRequestFacet }
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
    'common.map/native-encoder': {
      1: { presence: 'required'; facet: NativeMapEncoderOfferFacet }
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

export type NativeMapEncoderProviderModule = ServiceProviderModule<
  typeof NATIVE_MAP_ENCODER_CONTRACT,
  1
>
