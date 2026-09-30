/**
 * Lazy, presentation-neutral data-source ABIs and their data-only inventory registry.
 * Implementations belong to later host/extension slices; this module owns contracts only.
 */

import { compareUtf8, isQualifiedId, type SourceSpan, type SourceSpanWire } from '@modkit/core'
import type { FieldEditable, FieldType } from '../fields/index.js'
import type { KnowledgeTarget } from '../knowledge/index.js'
import type { LanguageCompletionItem, LanguageTokenKind } from '../language/index.js'
import { snapshotJsonWireData } from '../manifest/validate.js'
import { validateWithSchema } from '../manifest/validate.js'
import { dataSourceContractDefinitionSpecV1Schema } from '../schemas/contribution-specs.js'
import type {
  DataSourceContractDefinitionSpecV1Wire,
  DefinitionInventoryProvenance,
} from '../definitions.js'
import {
  STANDARD_DATA_SOURCE_CONTRACTS,
  type DataSourceRefWire,
  type OpaqueDataSourceRefWire,
  type StandardDataSourceId,
} from './data-source-ids.js'
export {
  ADMITTED_DATA_SOURCE_CONTRACTS,
  DATA_SOURCE_MATURITY,
  dataSourceMaturity,
  STANDARD_DATA_SOURCE_CONTRACTS,
  type DataSourceMaturity,
  type DataSourceRefWire,
  type OpaqueDataSourceRefWire,
  type StandardDataSourceId,
  type StandardDataSourceRef,
} from './data-source-ids.js'
import type {
  AssetDiagnostic,
  AssetOperationId,
  AssetSourceRef,
  JsonValue,
  RevisionId,
} from './types.js'
import type {
  AudioMediaSource,
  ModelSceneSource,
  RasterImageSource,
  VectorSceneSource,
  VideoMediaSource,
} from './media-data-sources.js'
import type {
  ModelAnimationSource,
  ModelCollisionSource,
  ModelMaterialSource,
  ModelResourceRefsSource,
  ModelSkeletonSource,
  ModelCameraInfo,
  ModelCameraRef,
  ModelCameraSource,
  ModelLightInfo,
  ModelLightRef,
  ModelLightSource,
  ModelNodeBehaviourInfo,
  ModelNodeBehaviourRef,
  ModelNodeBehaviourSource,
  ModelLodInfo,
  ModelLodLevelRef,
  ModelLodSource,
  ModelPhysicsInfo,
  ModelPhysicsRef,
  ModelPhysicsSource,
  ModelEffectInfo,
  ModelEffectProperty,
  ModelEffectRef,
  ModelEffectSource,
  ModelSocketSource,
} from './model-facet-sources.js'
import type { WorldSceneSource } from '../maps/index.js'
import type { GameTemplateTextRun } from '../templates/index.js'
import type { ViewerWorkspaceDocument } from './presentation.js'
export {
  isReservedModelFacetSource,
  RESERVED_MODEL_FACET_SOURCES,
  type ModelAnimationChannel,
  type ModelAnimationClip,
  type ModelAnimationInfo,
  type ModelAnimationInterpolation,
  type ModelAnimationKind,
  type ModelAnimationSample,
  type ModelAnimationSource,
  type ModelAnimationTimeBounds,
  type ModelBoneBinding,
  type ModelBoneLocalPose,
  type ModelBoneProvenance,
  type ModelCollisionInfo,
  type ModelCollisionOrigin,
  type ModelCollisionSource,
  type ModelCollisionVolume,
  type ModelMaterialInfo,
  type ModelMaterialLayerRef,
  type ModelMaterialRef,
  type ModelMaterialSource,
  type ModelResourceProvenance,
  type ModelResourceRef,
  type ModelResourceRefsInfo,
  type ModelResourceRefsSource,
  type ModelResourceRole,
  type ModelTextureColorKey,
  type ModelSkeletonInfo,
  type ModelSkeletonSource,
  type ModelSocketInfo,
  type ModelSocketOrientation,
  type ModelSocketRef,
  type ModelCameraInfo,
  type ModelCameraRef,
  type ModelCameraSource,
  type ModelLightInfo,
  type ModelLightRef,
  type ModelLightSource,
  type ModelNodeBehaviourInfo,
  type ModelNodeBehaviourRef,
  type ModelNodeBehaviourSource,
  type ModelLodInfo,
  type ModelLodLevelRef,
  type ModelLodSource,
  type ModelPhysicsInfo,
  type ModelPhysicsRef,
  type ModelPhysicsSource,
  type ModelEffectInfo,
  type ModelEffectProperty,
  type ModelEffectRef,
  type ModelEffectSource,
  type ModelSocketSource,
  type ReservedModelFacetSource,
} from './model-facet-sources.js'
export type {
  AudioMediaInfo,
  AudioMediaSource,
  AudioPcmBlock,
  AudioPcmRequest,
  AudioTrackInfo,
  CompressedTextureBlockLayout,
  CompressedTextureDescriptorV1,
  CompressedTextureFormat,
  CompressedTextureRequest,
  CompressedTextureSubresource,
  EncodedMediaDescriptor,
  EncodedMediaSource,
  ModelBounds,
  ModelMesh,
  ModelMorphTarget,
  ModelNode,
  ModelNodeBillboard,
  ModelNodeTrs,
  ModelPrimitive,
  ModelPrimitiveRequest,
  ModelPrimitiveTopology,
  ModelSceneInfo,
  ModelUpAxis,
  ModelSceneSource,
  RasterAtlasRegion,
  RasterImageInfo,
  RasterImageSource,
  RasterPixelFormat,
  RasterRegion,
  RasterRegionRequest,
  VectorSceneDocument,
  VectorSceneInfo,
  VectorSceneSource,
  VideoFrame,
  VideoFrameRequest,
  VideoMediaInfo,
  VideoMediaSource,
  VideoTrackInfo,
} from './media-data-sources.js'

export interface Lease<T> {
  readonly value: T
  /** Async and idempotent. Consumers never dispose the underlying owner directly. */
  release(): Promise<void>
}

export interface PageRequest {
  readonly cursor?: string
  readonly limit: number
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
}

export type TextSliceRequest =
  | {
      readonly kind: 'from-line'
      readonly line: number
      readonly lineCount: number
      readonly maxBytes: number
      readonly cursor?: never
    }
  | {
      readonly kind: 'from-cursor'
      readonly cursor: string
      readonly maxBytes: number
      readonly line?: never
      readonly lineCount?: never
    }

export type TextSlice =
  | {
      readonly complete: true
      readonly text: string
      readonly fromLine: number
      readonly lineCount: number
      readonly nextCursor?: never
    }
  | {
      readonly complete: false
      readonly text: string
      readonly fromLine: number
      readonly lineCount: number
      readonly nextCursor: string
    }

export interface TextQuery {
  readonly pattern: string
  readonly regex?: boolean
  readonly caseSensitive?: boolean
}

export interface TextDataSource {
  info(): Promise<{
    readonly bytes: bigint
    readonly encoding: string
    readonly bom: boolean
    readonly newline: 'lf' | 'crlf' | 'cr' | 'mixed'
    readonly lines: number | 'unknown'
    readonly longestLineBytes: number | 'unknown'
  }>
  slice(request: TextSliceRequest, signal?: AbortSignal): Promise<TextSlice>
  search(query: TextQuery, signal?: AbortSignal): AsyncIterable<SourceSpan>
}

/** 64-bit runtime offsets; callers request bounded byte counts. */
export interface ByteRangeSource {
  size(): Promise<bigint>
  read(offset: bigint, length: number, signal?: AbortSignal): Promise<Uint8Array>
}

export interface TreeNodeRef {
  readonly id: string
  readonly hasChildren: boolean
}

/**
 * One highlighted run inside a displayed value.
 *
 * Offsets are characters within that value, not positions in a document: a tree node and a table
 * cell each show one value, and a line/character range would have to be translated by every widget
 * that draws one. The kind vocabulary is the language contract's, so a codec that already produces
 * tokens for its editor produces the same tokens here — one vocabulary, not two that drift.
 */
export interface ValueSpan {
  readonly from: number
  readonly to: number
  readonly kind: LanguageTokenKind
  readonly modifiers?: readonly string[]
}

export interface TreeNodeFacts {
  readonly kind: string
  readonly label: string
  readonly preview?: string
  /** Stable subject address opened when a host activates this node. */
  readonly subjectId?: string
  readonly range?: SourceSpan
  /**
   * Where the node's entity is written, when that is another subject than the one `subjectId`
   * opens (the card): its subject and, optionally, the span there. A host offers "Go to declaration".
   */
  readonly declaration?: { readonly subjectId: string; readonly range?: SourceSpan }
  readonly semanticPath?: readonly string[]
  /** Exact lookup coordinate for optional help provided by the host. */
  readonly knowledgeTarget?: KnowledgeTarget
  /**
   * Typed value of this node, in the same shape a `MetadataEntry` uses.
   *
   * `preview` is prose for a human and cannot carry a type: nothing in `"9999999"` says whether the
   * node holds an int with a range or a string that happens to read as digits. A surface that wants
   * to offer the right control — a spinner, a checkbox, an enum list, a filtered subject picker —
   * needs the schema, so it is published here or not at all. Every field is optional, so a codec
   * that publishes nothing keeps working and simply gets the read-only rendering it has today.
   */
  readonly value?: JsonValue
  readonly type?: FieldType
  readonly unit?: string
  /**
   * Present only when the codec can actually write this node back, and it names how: an operation
   * id, or a writer requirement. Absence means read-only, and a surface must not guess otherwise.
   */
  readonly editable?: FieldEditable
  /** Host-bound destination preview for this exact semantic field. */
  readonly editTarget?: SubjectEditTargetResult
  /** Syntax runs over the displayed value, when the codec knows its grammar. */
  readonly spans?: readonly ValueSpan[]
}

export interface TreeQuery {
  readonly pattern: string
}

export interface TreeDataSource {
  root(): Promise<TreeNodeRef>
  children(node: TreeNodeRef, page: PageRequest, signal?: AbortSignal): Promise<Page<TreeNodeRef>>
  facts(node: TreeNodeRef): Promise<TreeNodeFacts>
  search(query: TreeQuery, signal?: AbortSignal): AsyncIterable<TreeNodeRef>
}

export type TablePageRequest =
  | {
      readonly kind: 'range'
      readonly from: number
      readonly count: number
      readonly cursor?: never
    }
  | {
      readonly kind: 'cursor'
      readonly cursor: string
      readonly count: number
      readonly from?: never
    }

export interface Row {
  readonly index: number
  readonly cells: readonly string[]
}

export interface CellCoord {
  readonly row: number
  readonly column: number
}

export interface CellFacts {
  /** Display text. Always present, because every table can be read even when nothing is typed. */
  readonly value: string
  readonly range?: SourceSpan
  readonly diagnostics?: readonly AssetDiagnostic[]
  /** Exact lookup coordinate for optional help provided by the host. */
  readonly knowledgeTarget?: KnowledgeTarget
  /**
   * The same optional schema a tree node may carry; see `TreeNodeFacts`. `typedValue` exists
   * because `value` is display text: `"true"` and `true` render alike and edit differently.
   */
  readonly typedValue?: JsonValue
  readonly type?: FieldType
  readonly unit?: string
  readonly editable?: FieldEditable
  /** Host-bound destination preview for this exact semantic field. */
  readonly editTarget?: SubjectEditTargetResult
  /** Syntax runs over `value`, when the codec knows its grammar. */
  readonly spans?: readonly ValueSpan[]
}

export interface TableQuery {
  readonly pattern: string
}

/**
 * What one column holds, when a table is more than a grid.
 *
 * A localization table is the case that needs it: its value columns are the same text in several
 * languages, and a surface that knows which column is which can search, compare and translate
 * without knowing the format. `variant` names the language (or any other variant axis); `base` marks
 * the one the others are compared with and translated from.
 */
export interface TableColumnInfo {
  /**
   * `key` identifies the row, `variant` holds one variant of the row's value, `status` lists the
   * row's `TableRowStatus` tokens separated by spaces, and `detail` is any other derived column.
   */
  readonly role: 'key' | 'variant' | 'status' | 'detail'
  readonly variant?: string
  /** BCP-47 language of a variant column, for a translation service. */
  readonly language?: string
  readonly base?: boolean
}

/** Tokens a `status` column may carry. */
export type TableRowStatus = 'missing' | 'untranslated' | 'duplicate'

/**
 * Operations a table offers over its rows, by descriptor operation id.
 *
 * Each one is an ordinary codec operation; naming it here only tells a surface which request shape
 * it accepts, so the surface stays free of any format's operation names.
 */
export interface TableActions {
  /**
   * Invoked with `TableRowAddRequest`, or with `TableVariantWriteRequest` for a batch of values in
   * one variant; answers with one edit plan.
   */
  readonly addRow?: AssetOperationId
  /** Invoked with `TableVariantCompareRequest`; answers with `TableVariantComparison`. */
  readonly compareVariants?: AssetOperationId
  /**
   * Invoked with `TableVariantTranslateRequest`, answering `TableVariantTranslation`, or with
   * `{ probe: true }`, answering `TableTranslateAvailability` before anything is sent anywhere.
   */
  readonly translateVariant?: AssetOperationId
  /** Invoked with `TableValueRenderRequest`; answers with `TableValueRendering`. */
  readonly renderValues?: AssetOperationId
  /** Invoked with `TableValueHighlightRequest`; answers with `TableValueHighlight`. */
  readonly highlightValue?: AssetOperationId
  /** Invoked with `TableValueCompleteRequest`; answers with `TableValueCompletion`. */
  readonly completeValue?: AssetOperationId
}

/**
 * Values to draw the way a reader of the game sees them, one answer per item in the same order.
 *
 * Text is sent rather than a cell coordinate: the surface already holds the values, and the same
 * call then draws what an editor holds before it is saved. Style sheets and the like arrive in
 * `workspaceDocuments` — the key `view.template` reads (`GAME_TEMPLATE_WORKSPACE_INPUT`).
 */
export interface TableValueRenderRequest {
  readonly items: readonly { readonly column: number; readonly text: string }[]
  readonly workspaceDocuments?: readonly ViewerWorkspaceDocument[]
}

export interface TableValueRendering {
  readonly items: readonly { readonly runs: readonly GameTemplateTextRun[] }[]
}

/** Syntax runs and problems of a value while it is being typed. */
export interface TableValueHighlightRequest {
  readonly column: number
  readonly text: string
}

/** One problem in a value; offsets count characters of that value, like `ValueSpan`. */
export interface TableValueDiagnostic {
  readonly from: number
  readonly to: number
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'information' | 'hint'
  readonly code?: string
}

export interface TableValueHighlight {
  readonly spans: readonly ValueSpan[]
  readonly diagnostics?: readonly TableValueDiagnostic[]
}

export interface TableValueCompleteRequest {
  readonly row: number
  readonly column: number
  readonly text: string
  /** Caret position, in characters of `text`. */
  readonly offset: number
  readonly workspaceDocuments?: readonly ViewerWorkspaceDocument[]
}

/**
 * Suggestions at the caret. Accepting one replaces `from`..`to` of the value; an item's own
 * `replacementRange` (a document range) does not apply inside a single value.
 */
export interface TableValueCompletion {
  readonly from: number
  readonly to: number
  readonly items: readonly LanguageCompletionItem[]
}

export interface TableRowAddRequest {
  readonly action: 'add'
  readonly key: string
  readonly value: string
  /** The variant column that receives the row; the opened subject's own when omitted. */
  readonly variant?: string
}

export interface TableVariantWriteRequest {
  readonly action: 'set-many'
  readonly variant: string
  /** Each key is set, or added when the variant lacks it. */
  readonly entries: readonly { readonly key: string; readonly value: string }[]
}

export interface TableVariantCompareRequest {
  /** Compared with the base variant. */
  readonly variant: string
}

export interface TableVariantComparison {
  readonly missing: readonly string[]
  readonly orphaned: readonly string[]
  readonly identical: readonly string[]
  readonly empty: readonly string[]
  readonly total: number
  readonly translated: number
}

export interface TableVariantTranslateRequest {
  readonly key: string
  readonly sourceVariant: string
  readonly targetVariant: string
  readonly sourceLanguage: string
  readonly targetLanguage: string
}

export interface TableVariantTranslation {
  readonly key: string
  readonly translated: string
  readonly changed: boolean
  /** Present when the service answered and its answer was discarded. */
  readonly refused?: string
}

export interface TableTranslateAvailability {
  readonly available: boolean
  /** Why translation cannot run here, for the surface to show beside a disabled control. */
  readonly reason?: string
}

export interface TableDataSource {
  shape(): Promise<{
    readonly rows: number | 'unknown'
    readonly columns: number
    readonly header?: readonly string[]
    /** One entry per column when present. */
    readonly columnInfo?: readonly TableColumnInfo[]
    readonly actions?: TableActions
    /** Separator of group segments in the `key` column, e.g. `/`. */
    readonly keySeparator?: string
  }>
  rows(request: TablePageRequest, signal?: AbortSignal): Promise<Page<Row>>
  cell(coord: CellCoord, signal?: AbortSignal): Promise<CellFacts>
  search(query: TableQuery, signal?: AbortSignal): AsyncIterable<CellCoord>
}

export type TransportPlaybackState =
  'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

export interface TransportTrack {
  readonly id: string
  readonly kind: 'audio' | 'video' | 'animation' | 'camera' | 'event' | 'data'
  readonly label?: string
  readonly selected: boolean
}

export interface TransportSnapshot {
  readonly state: TransportPlaybackState
  readonly positionMs: number
  readonly durationMs: number | 'unknown'
  readonly bufferedUntilMs?: number
  readonly frameRate?: number
  readonly rate: number
  readonly seekable: boolean
  readonly live: boolean
  readonly tracks: readonly TransportTrack[]
  /** Controls are descriptor operation IDs; invocation stays behind OperationSession. */
  readonly controls: {
    readonly playPause?: AssetOperationId
    readonly seek?: AssetOperationId
    readonly setRate?: AssetOperationId
    readonly selectTrack?: AssetOperationId
  }
}

export type TransportEvent =
  | { readonly kind: 'snapshot'; readonly snapshot: TransportSnapshot }
  | { readonly kind: 'diagnostic'; readonly diagnostic: AssetDiagnostic }

/** Bounds a consumer sets on one `TransportSource.timeline` answer. */
export interface TransportTimelineRequest {
  readonly maxMarkers: number
  /** Per series. */
  readonly maxSeriesPoints: number
}

/** One labelled value about a participant; `id` lets a surface localize well-known facts. */
export interface TransportTimelineFact {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** Someone or something the timeline follows: a player, a team, a faction. */
export interface TransportParticipant {
  readonly id: string
  readonly label: string
  /** CSS `#rrggbb`, the participant's own colour in the source. */
  readonly color?: string
  /** Faction, race or team, as the source names it. */
  readonly group?: string
  readonly outcome?: 'win' | 'loss' | 'tie' | 'undecided'
  readonly facts: readonly TransportTimelineFact[]
}

/** A numeric value over time: `points` is `[positionMs, value, positionMs, value, …]`. */
export interface TransportTimelineSeries {
  /** What is measured, shared by every participant's series of that measure (e.g. `units`). */
  readonly metric: string
  readonly label: string
  readonly participantId?: string
  readonly points: readonly number[]
}

/** Something that happened at one position. `kind` is a stable token a surface may localize. */
export interface TransportTimelineMarker {
  readonly positionMs: number
  readonly kind: string
  readonly label: string
  readonly participantId?: string
}

export interface TransportTimeline {
  readonly participants: readonly TransportParticipant[]
  readonly series: readonly TransportTimelineSeries[]
  /** Ordered by position. */
  readonly markers: readonly TransportTimelineMarker[]
  /** False when a bound cut markers or series points. */
  readonly complete: boolean
  /**
   * `sampled`: world positions are interpolated between recorded samples, not simulated, so a
   * surface must say so.
   */
  readonly fidelity: 'exact' | 'sampled'
}

export interface TransportSource {
  snapshot(signal?: AbortSignal): Promise<TransportSnapshot>
  events(signal?: AbortSignal): AsyncIterable<TransportEvent>
  /** Participants, measured series and markers of the whole playable range. */
  timeline?(request: TransportTimelineRequest, signal?: AbortSignal): Promise<TransportTimeline>
}

export interface NamespaceEntry {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'directory'
  /** Size of the entry's content once extracted. */
  readonly size?: bigint
  /**
   * Size as the container stores it, when that differs from `size`.
   *
   * Optional because not every namespace compresses, and absent is not zero: a container that does
   * not know must not claim a ratio of one.
   */
  readonly storedSize?: bigint
  /**
   * How the container stores this entry, in the container's own vocabulary (`stored`, `deflate`,
   * `lzma`…). Free-form on purpose: a fixed enumeration here would either exclude formats this
   * lab has not met or force every container to lie about which of the listed methods it used.
   */
  readonly compression?: string
  /** Last modification the container records, as epoch milliseconds UTC. */
  readonly modifiedAt?: number
  /**
   * An integrity value the container carries for this entry — the container's own, not one this
   * host computed. `algorithm` names it (`crc-32`, `sha-256`) so a consumer never has to infer
   * the algorithm from the length of the value.
   */
  readonly checksum?: { readonly algorithm: string; readonly value: string }
  /**
   * For an entry the container stores uncompressed: its bytes are exactly this range of the parent's
   * `common.view/byte-range-source`. A host then opens the entry as a nested subject by reading that
   * range, never extracting it into memory — so an entry of any size opens.
   */
  readonly storedRange?: { readonly offset: bigint; readonly length: bigint }
  /**
   * The entry's decoded bytes can be read by range through `openEntrySource` — stored data in a
   * companion file, or a block-compressed entry the container decodes block by block. A host opens
   * such an entry as a nested subject without extracting it, whatever its size.
   */
  readonly rangeAccess?: true
  /**
   * Hidden by the container's own convention (a dot folder, `__MACOSX/`, `.DS_Store`); a viewer
   * shows it only when the user asks for hidden files. An entry under a hidden folder is hidden too,
   * and a flat listing marks each such entry itself.
   */
  readonly hidden?: true
  /**
   * What the entry holds, when neither its name nor its bytes say so (`audio/x-emperor-bag`); a host
   * opening it as a nested subject selects the codec by it, as by an extension.
   */
  readonly mediaType?: string
  readonly revision: RevisionId
}

/**
 * Optional, bounded namespace lookup for containers whose native index can answer more efficiently
 * than walking every entry through the ABI.
 *
 * `basename-any` matches a complete final path segment. The source owns path normalisation; the
 * caller must state whether letter case is significant so a host never guesses container rules.
 */
export interface NamespaceEntrySearchQuery {
  readonly kind: 'basename-any'
  readonly basenames: readonly string[]
  readonly caseSensitive: boolean
}

/** Input contract of the shared `container.extract` operation. */
export interface ContainerExtractInput {
  /** Opaque id returned by the same subject's `NamespaceEntrySource.list`. */
  readonly entryId: string
}

/** One full-file replacement passed by the host to a container's `container.pack` operation. */
export interface ContainerPackEntryReplacementV1 {
  /** Opaque id returned by this container session's `NamespaceEntrySource.list`. */
  readonly entryId: string
  /** Provider-owned entry revision observed by the host before the semantic operation ran. */
  readonly expectedRevision: RevisionId
  /** Standard base64. The host encodes semantic entry bytes behind the execution boundary. */
  readonly bytesBase64: string
}

/** One complete named file supplied when creating a new container. */
export interface ContainerPackCreateFileV1 {
  /** Provider-portable relative path. The container codec owns path and case-policy validation. */
  readonly name: string
  /** Canonical standard base64. */
  readonly bytesBase64: string
}

/**
 * Input contract of the shared `container.pack` operation.
 *
 * The replacement form is constructed by the semantic-container composition host. It preserves
 * the existing source and replaces only revision-pinned entries. `mode` is optional for v1 wire
 * compatibility with the original host request.
 */
export interface ContainerPackReplaceInputV1 {
  readonly schemaVersion: 1
  readonly mode?: 'replace'
  readonly expectedContainerRevision: RevisionId
  readonly replacements: readonly ContainerPackEntryReplacementV1[]
  readonly intent?: JsonValue
  readonly files?: never
}

/**
 * Public creation form of `container.pack`.
 *
 * An application opens a provider-recognised empty creation target through normal inventory,
 * grant and activation, then invokes the published operation through its descriptor. The returned
 * outer `edit-plan` replaces that target. This is an operation input, not a P11 service contract.
 */
export interface ContainerPackCreateInputV1 {
  readonly schemaVersion: 1
  readonly mode: 'create'
  readonly expectedContainerRevision: RevisionId
  readonly files: readonly ContainerPackCreateFileV1[]
  readonly replacements?: never
  readonly intent?: never
}

/** One member the host listed, pinned to the revision it saw. */
export interface ContainerPackEntryRefV1 {
  readonly entryId: string
  readonly expectedRevision: RevisionId
}

/** A member moved to a new provider-portable path. */
export interface ContainerPackEntryRenameV1 extends ContainerPackEntryRefV1 {
  readonly name: string
}

/**
 * Structural form of `container.pack`: what a file manager does to a folder — add, remove and
 * rename members, and replace their bytes — in one repack. A name ending in `/` adds an empty
 * folder. A folder the container only implies is not a member: the host names every member under
 * it instead. Every member not named is kept as it was.
 */
export interface ContainerPackEditInputV1 {
  readonly schemaVersion: 1
  readonly mode: 'edit'
  readonly expectedContainerRevision: RevisionId
  readonly add?: readonly ContainerPackCreateFileV1[]
  readonly remove?: readonly ContainerPackEntryRefV1[]
  readonly rename?: readonly ContainerPackEntryRenameV1[]
  readonly replacements?: readonly ContainerPackEntryReplacementV1[]
  readonly files?: never
  readonly intent?: never
}

/** Version-one replacement, fresh-creation or structural request for `container.pack`. */
export type ContainerPackInputV1 =
  ContainerPackReplaceInputV1 | ContainerPackCreateInputV1 | ContainerPackEditInputV1

/** A page of a container listing. */
export interface NamespacePageRequest extends PageRequest {
  /**
   * Entries marked `hidden` too. A host serving an application leaves them out of listings,
   * child listings and searches unless asked; exact lookups and opens reach them either way.
   */
  readonly includeHidden?: boolean
}

export interface NamespaceEntrySource {
  list(
    prefix: string,
    page: NamespacePageRequest,
    signal?: AbortSignal,
  ): Promise<Page<NamespaceEntry>>
  /**
   * Optional immediate-child listing for very large hierarchical namespaces. Unlike the flat
   * listing, this returns only files and directories directly below the requested path.
   */
  children?(
    path: string,
    page: NamespacePageRequest,
    signal?: AbortSignal,
  ): Promise<Page<NamespaceEntry>>
  /**
   * Optional bounded bytes stored before the namespace container itself. The carrier owns the
   * physical range; a semantic codec owns its interpretation.
   */
  readPreamble?(maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
  /** Optional indexed lookup; absence means the namespace only supports prefix listing. */
  search?(
    query: NamespaceEntrySearchQuery,
    page: NamespacePageRequest,
    signal?: AbortSignal,
  ): Promise<Page<NamespaceEntry>>
  /**
   * Optional exact-path lookup, answered even where the listing is incomplete: a hashed archive
   * without its file list (an MPQ without `(listfile)`) finds a named entry it cannot enumerate.
   * `undefined` means the container holds no entry at that path.
   */
  lookup?(path: string, signal?: AbortSignal): Promise<NamespaceEntry | undefined>
  /**
   * Data the container hands every subject opened from its entries (IoStore: the global script
   * object names of `global.utoc`, which lie beside the container, not in it). The host passes it
   * as the nested codec's `ContributionContext.containerContext`.
   */
  nestedContext?(signal?: AbortSignal): Promise<JsonValue | undefined>
  /** Returns a leased source reference, never eager decoded bytes. */
  openEntry(entryId: string, signal?: AbortSignal): Promise<Lease<AssetSourceRef>>
  /**
   * The decoded bytes of an entry marked `rangeAccess`, by range; released with the lease. Refuses
   * an entry without `rangeAccess` (that one is extracted).
   */
  openEntrySource?(entryId: string, signal?: AbortSignal): Promise<Lease<ByteRangeSource>>
}

export interface RelationGraphNode {
  readonly id: string
  readonly label: string
  readonly type: string
  /** Canonical serialized `SubjectRef`; present when this node can be opened as a subject. */
  readonly subject?: string
  /** Subject-kind identity, kept separate from the graph's presentation-oriented type bucket. */
  readonly kind?: string
}

export interface RelationGraphEdge {
  readonly from: string
  readonly to: string
  readonly role?: string
  /** The target is a typed placeholder for a reference the producer could not resolve. */
  readonly dead?: boolean
}

export interface RelationGraphTypeBucket {
  readonly id: string
  readonly label: string
  /** Count over the complete logical graph, never merely the currently loaded page. */
  readonly count: number
  readonly tone: number
}

export type RelationGraphCompleteness = 'complete' | 'capped' | 'partial'

export interface RelationGraphSummary {
  /** Stable for every page served from this source snapshot. */
  readonly snapshotId: string
  readonly totalNodes: number
  readonly totalEdges: number
  readonly types: readonly RelationGraphTypeBucket[]
  readonly completeness: RelationGraphCompleteness
  readonly reason?: string
}

/**
 * Presentation-neutral, independently pageable graph facts. Consumers must use summary counts for
 * type filters and disclose any producer or consumer cap instead of treating a page as complete.
 */
export interface RelationGraphSource {
  summary(signal?: AbortSignal): Promise<RelationGraphSummary>
  nodes(page: PageRequest, signal?: AbortSignal): Promise<Page<RelationGraphNode>>
  edges(page: PageRequest, signal?: AbortSignal): Promise<Page<RelationGraphEdge>>
}

export interface SubjectFactProvenanceFor<Span extends SourceSpanWire> {
  readonly label: string
  readonly source?: AssetSourceRef
  readonly range?: Span
  readonly semanticPath?: readonly string[]
}

export type SubjectFactProvenance = SubjectFactProvenanceFor<SourceSpan>
export type SubjectFactProvenanceWire = SubjectFactProvenanceFor<SourceSpanWire>

export interface SubjectFactsIdentity {
  readonly subjectId: string
  readonly label: string
  readonly kind: string
  readonly type?: string
  readonly origins: readonly SubjectFactProvenance[]
  /**
   * A logical image id (an icon, a portrait) the host resolves through the subject's own raster
   * resource port. The card never turns it into a path; without a resolver it is simply not drawn.
   */
  readonly portrait?: string
  /**
   * A logical model id (the model a unit is drawn with) the host resolves through the subject's own
   * resource session; the facts source then offers it through `openModel`. Like `portrait`, the
   * card never turns it into a path.
   */
  readonly model?: string
  /** Scale the model's native units convert at, when the producer knows it (as map semantics do). */
  readonly modelMetersPerSourceUnit?: number
  /** The label in each locale the producer resolved, keyed by the same locale ids facts carry. */
  readonly localizedLabels?: Readonly<Record<string, string>>
}

export interface SubjectFactGroup {
  readonly id: string
  readonly label: string
  /** Count over the complete group, not the current page. */
  readonly factCount: number
  /**
   * How the producer means the group to be read: `fields` (label and value, the default), `grid`
   * (a compact table of short values, stats) or `cards` (each fact a tile: abilities, weapons). A
   * hint; a surface that cannot draw it draws fields.
   */
  readonly presentation?: 'fields' | 'grid' | 'cards'
}

export interface SubjectFact {
  readonly id: string
  readonly label: string
  readonly value: JsonValue
  readonly provenance: readonly SubjectFactProvenance[]
  /** One short sentence about what the value is, when the value alone misleads (as `MetadataEntry`). */
  readonly note?: string
  /**
   * The locale this value is written in. A subject that publishes the same fact in several locales
   * tags each copy; a card shows one locale at a time and offers the rest as a switch.
   */
  readonly locale?: string
  /** Exact lookup coordinate for optional host-provided help. */
  readonly knowledgeTarget?: KnowledgeTarget
  /**
   * The same optional schema a tree node or a table cell may carry; see `TreeNodeFacts`.
   *
   * A card is a view of one subject, and a subject that can be edited through a tree can be edited
   * through its card — the difference was never anything but which surface a reader happened to
   * open. Without these three a card is permanently read-only, which is why entity cards in MK2
   * ended up with an editing path of their own instead of the one every other surface uses.
   */
  readonly type?: FieldType
  readonly unit?: string
  readonly editable?: FieldEditable
  /** Host-bound destination preview for this exact semantic field. */
  readonly editTarget?: SubjectEditTargetResult
}

export interface RelatedSubjectFact {
  readonly role: string
  readonly subjectId: string
  readonly label: string
  readonly kind: string
  /** True when the reference has a stable placeholder identity but no resolvable target. */
  readonly dead?: boolean
  readonly provenance?: readonly SubjectFactProvenance[]
}

export interface SubjectPreviewResource {
  readonly source: AssetSourceRef
  readonly mediaType?: string
  readonly label?: string
}

export interface SubjectFactsSummary {
  readonly snapshotId: string
  readonly identity: SubjectFactsIdentity
  readonly groupCount: number
  readonly relationCount: number
  readonly preview?: SubjectPreviewResource
  /** Optional data-only card layout selected from the subject-kind definition. */
  readonly card?: {
    readonly sections: readonly string[]
    readonly preview?: 'raster' | 'model' | 'none'
  }
}

/** Facts only. Hosts own the mapping to cards and extensions may provide another projection. */
export interface SubjectFactsSource {
  summary(signal?: AbortSignal): Promise<SubjectFactsSummary>
  groups(page: PageRequest, signal?: AbortSignal): Promise<Page<SubjectFactGroup>>
  facts(groupId: string, page: PageRequest, signal?: AbortSignal): Promise<Page<SubjectFact>>
  relations(page: PageRequest, signal?: AbortSignal): Promise<Page<RelatedSubjectFact>>
  /**
   * The model named by `identity.model`, host-resolved and converted: its scene, materials and
   * resource references. Hosts add these; a producer only names the model.
   */
  openModel?(signal?: AbortSignal): Promise<Lease<ModelSceneSource>>
  openModelMaterials?(signal?: AbortSignal): Promise<Lease<ModelMaterialSource>>
  openModelResources?(signal?: AbortSignal): Promise<Lease<ModelResourceRefsSource>>
}

export type SubjectCalculationStatus = 'computed' | 'missing-data' | 'unsupported' | 'invalid'
export type SubjectCalculationInputState = 'resolved' | 'defaulted' | 'missing' | 'unsupported'
export type SubjectCalculationsCompleteness = 'complete' | 'partial' | 'capped'

/** Stable, versioned mathematical rule used for a read-only subject calculation. */
export interface SubjectCalculationFormula {
  readonly id: string
  readonly name: string
  readonly version: string
  /** Human-readable formula; it is documentation, not executable source code. */
  readonly expression: string
}

/** One auditable value consumed by a calculation. */
export interface SubjectCalculationInput {
  readonly id: string
  readonly label: string
  readonly state: SubjectCalculationInputState
  readonly value?: JsonValue
  readonly unit?: string
  readonly provenance: readonly SubjectFactProvenance[]
  readonly knowledgeTarget?: KnowledgeTarget
}

export interface SubjectCalculationWarning {
  readonly code: string
  readonly message: string
}

/** One bounded result. Unsupported or incomplete work is explicit and never guessed. */
export interface SubjectCalculation {
  readonly id: string
  readonly label: string
  readonly formula: SubjectCalculationFormula
  readonly status: SubjectCalculationStatus
  readonly value?: JsonValue
  /** Optional unrounded numeric result when `value` is a display-rounded number. */
  readonly rawValue?: number
  readonly unit?: string
  readonly inputs: readonly SubjectCalculationInput[]
  readonly provenance: readonly SubjectFactProvenance[]
  readonly warnings: readonly SubjectCalculationWarning[]
  readonly knowledgeTarget?: KnowledgeTarget
}

export interface SubjectCalculationsSummary {
  readonly snapshotId: string
  readonly subjectId: string
  readonly totalCalculations: number
  readonly completeness: SubjectCalculationsCompleteness
  readonly reason?: string
}

/**
 * Presentation-neutral read-only calculations for one subject. Formula versions, inputs,
 * provenance and incomplete states cross the boundary together so UI and MCP clients can audit
 * the result without reimplementing game rules.
 */
export interface SubjectCalculationsSource {
  summary(signal?: AbortSignal): Promise<SubjectCalculationsSummary>
  calculations(page: PageRequest, signal?: AbortSignal): Promise<Page<SubjectCalculation>>
}

export type SubjectSelectorCompleteness = 'complete' | 'partial' | 'capped'

/** Stable identity of one nested subject that may be selected without parsing in the consumer. */
export interface SelectableSubject {
  readonly subjectId: string
  readonly label: string
  readonly kind: string
  readonly type?: string
  /** Provider-published semantic tags used by structured subject filters. */
  readonly tags?: readonly string[]
  /** Present only when this candidate is a root asset selectable by an `asset-ref` field. */
  readonly asset?: {
    readonly formatId: string
    readonly traits: readonly string[]
  }
}

export interface SubjectSelectorSummary {
  readonly snapshotId: string
  readonly totalSubjects: number
  readonly completeness: SubjectSelectorCompleteness
  readonly reason?: string
}

export interface SubjectEditDocumentRef {
  readonly rootId: string
  readonly path: string
  readonly revision?: RevisionId
}

export interface SubjectEditTargetRequest {
  readonly subjectId: string
  readonly fieldPath: readonly string[]
  readonly targetDocument?: Pick<SubjectEditDocumentRef, 'rootId' | 'path'>
}

export interface SubjectEditDestination extends SubjectEditDocumentRef {
  readonly mode: 'replace' | 'create'
  readonly label: string
  readonly targetId: string
  readonly subjectUri: string
}

export type SubjectEditTargetResult =
  | Readonly<{
      readonly state: 'resolved'
      readonly snapshotId: string
      readonly workspaceId: string
      readonly selectedRootId: string
      readonly subjectId: string
      readonly fieldPath: readonly string[]
      readonly action: string
      readonly destination: SubjectEditDestination
      readonly candidates: readonly SubjectEditDocumentRef[]
      readonly lastDeclaration?: SubjectEditDocumentRef
      readonly effectiveFieldSource?: SubjectEditDocumentRef
      readonly selectionReason: string
      readonly guards: readonly SubjectEditDocumentRef[]
    }>
  | Readonly<{
      readonly state: 'selection-required'
      readonly snapshotId: string
      readonly workspaceId: string
      readonly selectedRootId: string
      readonly subjectId: string
      readonly fieldPath: readonly string[]
      readonly candidates: readonly SubjectEditDocumentRef[]
      readonly reason: string
    }>
  | Readonly<{
      readonly state: 'unavailable'
      readonly snapshotId: string
      readonly subjectId: string
      readonly fieldPath: readonly string[]
      readonly reason: string
    }>

export interface SubjectIsolationRequest {
  readonly schemaVersion: 1
  readonly ownerSubjectId: string
  readonly targetSubjectId: string
  /** Exact typed-link field selected by the caller; publishers must not guess a branch. */
  readonly ownerFieldPath: readonly string[]
  readonly maxEdges: number
  readonly always?: boolean
}

export interface SubjectIsolationReferrer {
  readonly subjectId: string
  readonly fieldPaths: readonly (readonly string[])[]
}

export type SubjectIsolationResult =
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'unavailable'
      readonly snapshotId: string
      readonly ownerSubjectId: string
      readonly targetSubjectId: string
      readonly ownerFieldPath: readonly string[]
      readonly cloneRequired: false
      readonly reason: string
    }>
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'ready'
      readonly snapshotId: string
      readonly ownerSubjectId: string
      readonly targetSubjectId: string
      readonly ownerFieldPath: readonly string[]
      readonly shared: boolean
      readonly cloneRequired: boolean
      readonly referrers: readonly SubjectIsolationReferrer[]
      readonly otherReferrerIds: readonly string[]
      readonly rewireFieldPaths: readonly (readonly string[])[]
    }>

export interface SubjectIsolationPlanRequest extends SubjectIsolationRequest {
  readonly cloneSubjectId: string
  readonly ownerTargetDocument?: Pick<SubjectEditDocumentRef, 'rootId' | 'path'>
  readonly cloneTargetDocument?: Pick<SubjectEditDocumentRef, 'rootId' | 'path'>
}

export interface SubjectIsolationPlanReplacement {
  readonly purpose: 'clone' | 'rewire' | 'clone-and-rewire'
  readonly destination: SubjectEditDestination
  readonly replacementBytes: number
}

export interface SubjectIsolationPlanDiagnostic {
  readonly severity: 'error' | 'warning' | 'information'
  readonly code: string
  readonly message: string
}

export type SubjectIsolationPlanResult =
  | Extract<SubjectIsolationResult, { readonly state: 'unavailable' }>
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'selection-required'
      readonly snapshotId: string
      readonly ownerSubjectId: string
      readonly targetSubjectId: string
      readonly cloneSubjectId: string
      readonly purpose: 'clone' | 'rewire'
      readonly candidates: readonly SubjectEditDocumentRef[]
      readonly reason: string
    }>
  | Readonly<{
      readonly schemaVersion: 1
      readonly state: 'planned'
      readonly snapshotId: string
      readonly previewSnapshotId: string
      readonly ownerSubjectId: string
      readonly targetSubjectId: string
      readonly cloneSubjectId: string
      readonly analysis: Extract<SubjectIsolationResult, { readonly state: 'ready' }>
      readonly replacements: readonly SubjectIsolationPlanReplacement[]
      readonly diagnostics: readonly SubjectIsolationPlanDiagnostic[]
    }>

/** Optional publisher-applied filters for large nested-subject catalogs. */
export interface SubjectSelectorQuery extends PageRequest {
  readonly filter?: import('../fields/index.js').SubjectFilter
  /** Root-asset constraints; omission selects semantic subjects rather than root assets. */
  readonly asset?: import('../fields/index.js').AssetReferenceFilter
  /** Exact semantic kind, for example a publisher-defined data namespace. */
  readonly kind?: string
  /** Exact publisher type within the kind. */
  readonly type?: string
  /** Case-insensitive match against stable id or display label. */
  readonly text?: string
}

/**
 * Read-only selection boundary for container-like subjects. The publisher owns parsing and lends
 * standard entity sources; consumers retain only explicit leases and never reinterpret files.
 */
export interface SubjectSelectorSource {
  summary(signal?: AbortSignal): Promise<SubjectSelectorSummary>
  subjects(page: SubjectSelectorQuery, signal?: AbortSignal): Promise<Page<SelectableSubject>>
  openFacts(subjectId: string, signal?: AbortSignal): Promise<Lease<SubjectFactsSource>>
  openCalculations(
    subjectId: string,
    signal?: AbortSignal,
  ): Promise<Lease<SubjectCalculationsSource>>
  /** Optional host-bound destination preview for fields of a selected resolved subject. */
  editTarget?(
    request: SubjectEditTargetRequest,
    signal?: AbortSignal,
  ): Promise<SubjectEditTargetResult>
  /** Optional read-only impact preview for isolating a shared referenced subject. */
  isolation?(
    request: SubjectIsolationRequest,
    signal?: AbortSignal,
  ): Promise<SubjectIsolationResult>
  /** Optional bounded clone/rewire proposal; full replacement bytes remain provider/host-owned. */
  isolationPlan?(
    request: SubjectIsolationPlanRequest,
    signal?: AbortSignal,
  ): Promise<SubjectIsolationPlanResult>
}

/**
 * Where a slide's geometry is published. A deck never carries geometry of its own: the shapes of
 * a slide are the shapes of a page in the vector plane, so the deck names that page instead of
 * copying it. Keeping it a tagged reference leaves room for a future plane without changing the
 * meaning of the ones that exist.
 */
export interface SlidePageRef {
  readonly kind: 'vector-scene-page'
  /** 1-based ordinal of the page inside the same subject's vector scene. */
  readonly page: number
}

/**
 * One slide, in deck order.
 *
 * `title` is present only when the source marks a run as the slide's title; a body run promoted to
 * a title by a heuristic would be an invention, so it stays in `textRuns` instead. `notes` is
 * absent — not empty — when the source carries no notes for the slide.
 */
export interface Slide {
  readonly id: string
  /** 1-based position in the deck; the deck's order is part of the contract. */
  readonly index: number
  readonly title?: string
  readonly textRuns: readonly string[]
  readonly notes?: readonly string[]
  readonly page: SlidePageRef
}

export interface SlideDeckInfo {
  readonly slides: number
  readonly title?: string
  /** Slides whose geometry the publisher did not parse, and therefore did not publish. */
  readonly unparsedSlides?: number
}

/**
 * Ordered slides of a deck — `common.view/slide-deck-source@1`, ADR-DOC-001.
 *
 * `publisher-candidate` maturity (see `DATA_SOURCE_MATURITY`): ODP is the only family publishing
 * it, so masters, layouts, transitions and animation are deliberately absent rather than stubbed.
 * A second independent slides family admits or versions the shape; it is not widened silently.
 */
export interface SlideDeckSource {
  info(signal?: AbortSignal): Promise<SlideDeckInfo>
  slides(page: PageRequest, signal?: AbortSignal): Promise<Page<Slide>>
}

/** Open compile-time registry. Extensions may augment it without changing host code. */
export interface DataSourceContractMap {
  'common.view/text-data-source': { 1: TextDataSource }
  'common.view/byte-range-source': { 1: ByteRangeSource }
  'common.view/tree-data-source': { 1: TreeDataSource }
  'common.view/table-data-source': { 1: TableDataSource }
  'common.view/transport-source': { 1: TransportSource }
  'common.view/namespace-entry-source': { 1: NamespaceEntrySource }
  'common.view/raster-image-source': { 1: RasterImageSource }
  'common.view/vector-scene-source': { 1: VectorSceneSource }
  'common.view/audio-media-source': { 1: AudioMediaSource }
  'common.view/video-media-source': { 1: VideoMediaSource }
  'common.view/model-scene-source': { 1: ModelSceneSource }
  'common.view/world-scene-source': { 1: WorldSceneSource }
  'common.view/model-resource-refs-source': { 1: ModelResourceRefsSource }
  'common.view/model-skeleton-source': { 1: ModelSkeletonSource }
  'common.view/model-animation-source': { 1: ModelAnimationSource }
  'common.view/model-collision-source': { 1: ModelCollisionSource }
  'common.view/model-material-source': { 1: ModelMaterialSource }
  'common.view/model-socket-source': { 1: ModelSocketSource }
  'common.view/model-effect-source': { 1: ModelEffectSource }
  'common.view/model-light-source': { 1: ModelLightSource }
  'common.view/model-camera-source': { 1: ModelCameraSource }
  'common.view/model-physics-source': { 1: ModelPhysicsSource }
  'common.view/model-node-behaviour-source': { 1: ModelNodeBehaviourSource }
  'common.view/model-lod-source': { 1: ModelLodSource }
  'common.view/relation-graph-source': { 1: RelationGraphSource }
  'common.view/subject-selector-source': { 1: SubjectSelectorSource }
  'common.view/subject-facts-source': { 1: SubjectFactsSource }
  'common.view/subject-calculations-source': { 1: SubjectCalculationsSource }
  'common.view/slide-deck-source': { 1: SlideDeckSource }
}

export type KnownDataSourceId = keyof DataSourceContractMap
export type DataSourceMajor<K extends KnownDataSourceId> = keyof DataSourceContractMap[K] & number
export type DataSourceOf<
  K extends KnownDataSourceId,
  M extends DataSourceMajor<K>,
> = DataSourceContractMap[K][M]

export type KnownDataSourceRef = {
  [K in KnownDataSourceId]: {
    readonly contract: K
    readonly major: DataSourceMajor<K>
    readonly opaque?: never
  }
}[KnownDataSourceId]

/** Standard contracts understood by the A-1 wire schema without extension inventory. */
declare const OPAQUE_DATA_SOURCE_REF_BRAND: unique symbol

/**
 * Plain JSON reference to a contract unknown to this build. `opaque: true` makes the loss of
 * static knowledge explicit. Runtime inventory resolution remains mandatory before activation.
 */
export type ForeignDataSourceId<Contract extends string> = string extends Contract
  ? never
  : Contract extends KnownDataSourceId
    ? never
    : Contract

/** Constructor-issued authoring ref. The nominal marker is erased by JSON packaging. */
export interface OpaqueDataSourceRef<
  Contract extends string = string,
  Major extends number = number,
> extends OpaqueDataSourceRefWire {
  readonly contract: Contract
  readonly major: Major
  readonly [OPAQUE_DATA_SOURCE_REF_BRAND]: true
}

/**
 * Explicit escape hatch for a contract absent from this build's augmented map. Known contracts
 * cannot be laundered through it to bypass their typed major.
 */
export function foreignDataSource<const Contract extends string, const Major extends number>(
  contract: ForeignDataSourceId<Contract>,
  major: Major,
): OpaqueDataSourceRef<Contract, Major> {
  if (!isQualifiedId(contract)) throw new TypeError(`invalid foreign data-source id: ${contract}`)
  if ((STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(contract)) {
    throw new TypeError(`known data-source contract must use its typed reference: ${contract}`)
  }
  if (!Number.isSafeInteger(major) || major < 0) {
    throw new TypeError(`invalid foreign data-source major: ${major}`)
  }
  return Object.freeze({ contract, major, opaque: true }) as unknown as OpaqueDataSourceRef<
    Contract,
    Major
  >
}

/** Brands a schema-validated wire reference; inventory resolution is still required separately. */
export function dataSourceRefFromWire(ref: DataSourceRefWire): DataSourceRef {
  if (!isQualifiedId(ref.contract) || !Number.isSafeInteger(ref.major) || ref.major < 0) {
    throw new TypeError(`invalid data-source reference: ${ref.contract}@${ref.major}`)
  }
  if ('opaque' in ref && ref.opaque === true) {
    if ((STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(ref.contract)) {
      throw new TypeError(`standard data-source contract cannot be opaque: ${ref.contract}`)
    }
    return Object.freeze({ ...ref }) as unknown as OpaqueDataSourceRef
  }
  if (
    !(STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(ref.contract) ||
    ref.major !== 1
  ) {
    throw new TypeError(
      `unknown data-source reference must be explicitly opaque: ${ref.contract}@${ref.major}`,
    )
  }
  return Object.freeze({ ...ref }) as KnownDataSourceRef
}

/** Extensible typed plane. Packaging normalizes non-standard known refs to opaque wire refs. */
export type DataSourceRef = KnownDataSourceRef | OpaqueDataSourceRef

/** Correlated authoring ref; the default `string` branch remains the raw schema DTO. */
export type DataSourceRefFor<Contract extends string> = string extends Contract
  ? DataSourceRefWire
  : Contract extends StandardDataSourceId
    ? {
        readonly contract: Contract
        readonly major: 1
        readonly opaque?: never
      }
    : Contract extends KnownDataSourceId
      ? {
          readonly contract: Contract
          readonly major: DataSourceMajor<Contract>
          /** The host cannot know an extension-augmented contract before inventory registration. */
          readonly opaque: true
        }
      : OpaqueDataSourceRef<Contract>
export type DataSourceOffer = DataSourceRef
export type DataSourceOfferWire = DataSourceRefWire

export type ConformanceProfileId = string

/**
 * Compatibility name for the single authored wire authority. Data-source definitions are the
 * `kind: 'data-source'` arm of `modkit/contract-definition`; there is no second envelope.
 */
export type DataSourceContributionSpecV1 = DataSourceContractDefinitionSpecV1Wire

export interface DataSourceInventoryEntry {
  readonly definition: DataSourceContractDefinitionSpecV1Wire
  readonly provenance: DefinitionInventoryProvenance
}

export interface DataSourceRegistration<
  K extends string = string,
  M extends number = number,
> extends Omit<DataSourceContractDefinitionSpecV1Wire, 'contract' | 'major'> {
  readonly contract: K
  readonly major: M
  readonly ownerExtensionId: string
  readonly provenance: DefinitionInventoryProvenance
}

export type RegistrationRejectionReason =
  | 'duplicate'
  | 'major-conflict'
  | 'schema-invalid'
  | 'reserved-namespace'
  | 'conformance-missing'
  | 'stale-update'

export type RegistrationResult =
  | { readonly state: 'registered' }
  | {
      readonly state: 'rejected'
      readonly reason: RegistrationRejectionReason
      readonly diagnostics: readonly AssetDiagnostic[]
    }

export type RegistrationBatchResult =
  | { readonly state: 'committed'; readonly registrations: readonly DataSourceRegistration[] }
  | {
      readonly state: 'rejected'
      readonly results: readonly RegistrationResult[]
      readonly diagnostics: readonly AssetDiagnostic[]
    }

export interface DataSourceRegistry {
  replaceOwnerInventory(
    ownerExtensionId: string,
    entries: readonly DataSourceInventoryEntry[],
  ): Promise<RegistrationBatchResult>
  unregisterOwner(ownerExtensionId: string): void
  lookup(contract: string, major: number): DataSourceRegistration | undefined
  majors(contract: string): readonly number[]
  list(): readonly DataSourceRegistration[]
  resolveRef(ref: DataSourceRef): DataSourceRegistration | undefined
}

export interface DataSourceRegistryOptions {
  /** Required host policy. The SDK never guesses which extension owns a namespace. */
  readonly isNamespaceOwner: (namespace: string, ownerExtensionId: string) => boolean
  /**
   * Host-owned, fail-closed binding check. The complete tuple prevents a valid schema or profile
   * for another contract/major from being laundered into this registration.
   */
  readonly validateDefinition: (
    definition: DataSourceDefinitionBinding,
  ) =>
    | { readonly state: 'valid' }
    | { readonly state: 'invalid'; readonly reason: 'schema-invalid' | 'conformance-missing' }
    | Promise<
        | { readonly state: 'valid' }
        | { readonly state: 'invalid'; readonly reason: 'schema-invalid' | 'conformance-missing' }
      >
}

export interface DataSourceDefinitionBinding extends DataSourceContractDefinitionSpecV1Wire {
  readonly ownerExtensionId: string
  readonly provenance: DefinitionInventoryProvenance
}

function registrationKey(contract: string, major: number): string {
  return `${contract}@${major}`
}

function contractNamespace(contract: string): string {
  const slash = contract.indexOf('/')
  return slash === -1 ? contract : contract.slice(0, slash)
}

function compareRegistration(a: DataSourceRegistration, b: DataSourceRegistration): number {
  return (
    compareUtf8(a.contract, b.contract) ||
    a.major - b.major ||
    compareUtf8(a.ownerExtensionId, b.ownerExtensionId)
  )
}

function rejection(
  reason: RegistrationRejectionReason,
  spec: DataSourceContractDefinitionSpecV1Wire,
  index: number,
): RegistrationResult {
  const diagnostic: AssetDiagnostic = {
    id: `data-source-registration-${index}`,
    code: `x3.sdk/data-source-${reason}`,
    category: reason === 'reserved-namespace' ? 'security' : 'structure',
    severity: 'error',
    message: `data-source contract ${spec.contract}@${spec.major} rejected: ${reason}`,
  }
  return { state: 'rejected', reason, diagnostics: [diagnostic] }
}

function malformedBatchDiagnostic(message: string): AssetDiagnostic {
  return {
    id: 'data-source-registration-batch',
    code: 'x3.sdk/data-source-schema-invalid',
    category: 'structure',
    severity: 'error',
    message,
  }
}

const PROVENANCE_KEYS = [
  'ownerExtensionId',
  'extensionVersion',
  'inventoryRecordId',
  'manifestDigest',
  'artifactDigest',
  'artifactRoot',
  'manifestPath',
] as const

function hasExactStringKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const own = Object.keys(record).sort(compareUtf8)
  const expected = [...keys].sort(compareUtf8)
  return (
    own.length === expected.length &&
    own.every((key, index) => key === expected[index]) &&
    keys.every(key => typeof record[key] === 'string' && record[key].trim() !== '')
  )
}

function isInventoryEntry(value: unknown): value is DataSourceInventoryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort(compareUtf8)
  return (
    keys.length === 2 &&
    keys[0] === 'definition' &&
    keys[1] === 'provenance' &&
    hasExactStringKeys(record['provenance'], PROVENANCE_KEYS)
  )
}

/** Pure, deterministic, owner-atomic data-source inventory. It activates no extension code. */
export function createDataSourceRegistry(options: DataSourceRegistryOptions): DataSourceRegistry {
  if (
    typeof options !== 'object' ||
    options === null ||
    typeof options.isNamespaceOwner !== 'function' ||
    typeof options.validateDefinition !== 'function'
  ) {
    throw new TypeError('data-source registry requires namespace and definition validators')
  }
  // Capture the trusted ports once. Mutating the caller-owned options object after registry
  // construction must never alter namespace or conformance policy.
  const isNamespaceOwner = options.isNamespaceOwner
  const validateDefinition = options.validateDefinition
  let registrations = new Map<string, DataSourceRegistration>()
  const ownerGenerations = new Map<string, number>()

  const beginOwnerUpdate = (ownerExtensionId: string): number => {
    const generation = (ownerGenerations.get(ownerExtensionId) ?? 0) + 1
    ownerGenerations.set(ownerExtensionId, generation)
    return generation
  }

  const list = (): readonly DataSourceRegistration[] =>
    Object.freeze([...registrations.values()].sort(compareRegistration))

  return {
    async replaceOwnerInventory(ownerExtensionId, entries) {
      const generation = beginOwnerUpdate(ownerExtensionId)
      let ownedEntries: readonly DataSourceInventoryEntry[]
      try {
        const snapshot = snapshotJsonWireData(entries)
        if (!Array.isArray(snapshot)) throw new TypeError('data-source inventory must be an array')
        const checks = await Promise.all(
          snapshot.map(entry => {
            if (!isInventoryEntry(entry)) {
              return Promise.resolve([
                malformedBatchDiagnostic(
                  'data-source inventory entry must bind definition and provenance',
                ),
              ])
            }
            return validateWithSchema(
              dataSourceContractDefinitionSpecV1Schema,
              (entry as { readonly definition: unknown }).definition,
            )
          }),
        )
        const invalid = checks.findIndex(diagnostics => diagnostics.length > 0)
        if (invalid !== -1) {
          throw new TypeError(`data-source inventory item ${invalid} violates its schema authority`)
        }
        ownedEntries = snapshot as unknown as readonly DataSourceInventoryEntry[]
      } catch (error) {
        const diagnostic = malformedBatchDiagnostic(
          `data-source inventory rejected before policy evaluation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return {
          state: 'rejected',
          results: [
            {
              state: 'rejected',
              reason: 'schema-invalid',
              diagnostics: [diagnostic],
            },
          ],
          diagnostics: [diagnostic],
        }
      }
      const counts = new Map<string, number>()
      for (const { definition: spec } of ownedEntries) {
        const key = registrationKey(spec.contract, spec.major)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }

      const results = await Promise.all(
        ownedEntries.map(
          async ({ definition: spec, provenance }, index): Promise<RegistrationResult> => {
            const key = registrationKey(spec.contract, spec.major)
            if ((counts.get(key) ?? 0) > 1) return rejection('duplicate', spec, index)
            if (
              !isQualifiedId(spec.contract) ||
              !Number.isSafeInteger(spec.major) ||
              spec.major < 0 ||
              spec.schema.$ref.trim() === ''
            ) {
              return rejection('schema-invalid', spec, index)
            }
            try {
              if (isNamespaceOwner(contractNamespace(spec.contract), ownerExtensionId) !== true) {
                return rejection('reserved-namespace', spec, index)
              }
            } catch {
              return rejection('reserved-namespace', spec, index)
            }
            if (spec.conformanceProfile.trim() === '') {
              return rejection('conformance-missing', spec, index)
            }
            if (
              provenance.ownerExtensionId !== ownerExtensionId ||
              provenance.artifactRoot.trim() === '' ||
              provenance.manifestPath.trim() === '' ||
              provenance.manifestDigest.trim() === '' ||
              provenance.artifactDigest.trim() === ''
            ) {
              return rejection('schema-invalid', spec, index)
            }
            const definition = Object.freeze({ ...spec, ownerExtensionId, provenance })
            let validation: Awaited<ReturnType<DataSourceRegistryOptions['validateDefinition']>>
            try {
              validation = await validateDefinition(definition)
            } catch {
              return rejection('schema-invalid', spec, index)
            }
            if (validation?.state !== 'valid') {
              const reason =
                validation?.state === 'invalid' &&
                (validation.reason === 'schema-invalid' ||
                  validation.reason === 'conformance-missing')
                  ? validation.reason
                  : 'schema-invalid'
              return rejection(reason, spec, index)
            }
            return { state: 'registered' }
          },
        ),
      )

      const diagnostics = results.flatMap(result =>
        result.state === 'rejected' ? result.diagnostics : [],
      )
      if (diagnostics.length > 0) return { state: 'rejected', results, diagnostics }

      if (ownerGenerations.get(ownerExtensionId) !== generation) {
        const staleResults = ownedEntries.map(({ definition }, index) =>
          rejection('stale-update', definition, index),
        )
        const staleDiagnostics = staleResults.flatMap(result =>
          result.state === 'rejected' ? result.diagnostics : [],
        )
        const diagnostics =
          staleDiagnostics.length > 0
            ? staleDiagnostics
            : [malformedBatchDiagnostic('data-source inventory update was superseded')]
        return { state: 'rejected', results: staleResults, diagnostics }
      }

      // Re-read the current map after every await. No other task can interleave between this
      // check and the synchronous commit below, so cross-owner updates are never lost.
      const retained = new Map(
        [...registrations].filter(
          ([, registration]) => registration.ownerExtensionId !== ownerExtensionId,
        ),
      )
      const conflictResults = ownedEntries.map(({ definition }, index): RegistrationResult =>
        retained.has(registrationKey(definition.contract, definition.major))
          ? rejection('major-conflict', definition, index)
          : { state: 'registered' },
      )
      const conflictDiagnostics = conflictResults.flatMap(result =>
        result.state === 'rejected' ? result.diagnostics : [],
      )
      if (conflictDiagnostics.length > 0) {
        return {
          state: 'rejected',
          results: conflictResults,
          diagnostics: conflictDiagnostics,
        }
      }

      const committed = ownedEntries.map(
        ({ definition: spec, provenance }): DataSourceRegistration =>
          Object.freeze({
            ...spec,
            schema: Object.freeze({ ...spec.schema }),
            ownerExtensionId,
            provenance: Object.freeze({ ...provenance }),
          }),
      )
      registrations = retained
      for (const registration of committed) {
        registrations.set(registrationKey(registration.contract, registration.major), registration)
      }
      return {
        state: 'committed',
        registrations: Object.freeze([...committed].sort(compareRegistration)),
      }
    },

    unregisterOwner(ownerExtensionId) {
      beginOwnerUpdate(ownerExtensionId)
      registrations = new Map(
        [...registrations].filter(
          ([, registration]) => registration.ownerExtensionId !== ownerExtensionId,
        ),
      )
    },

    lookup(contract, major) {
      return registrations.get(registrationKey(contract, major))
    },

    majors(contract) {
      return list()
        .filter(registration => registration.contract === contract)
        .map(registration => registration.major)
    },

    list,

    resolveRef(ref) {
      if (!isQualifiedId(ref.contract) || !Number.isSafeInteger(ref.major) || ref.major < 0) {
        return undefined
      }
      const isStandard = (STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(
        ref.contract,
      )
      if (isStandard && (ref.major !== 1 || ('opaque' in ref && ref.opaque === true))) {
        return undefined
      }
      return registrations.get(registrationKey(ref.contract, ref.major))
    },
  }
}
