/**
 * Lazy, presentation-neutral data-source ABIs and their data-only inventory registry.
 * Implementations belong to later host/extension slices; this module owns contracts only.
 */

import { compareUtf8, isQualifiedId, type SourceSpan, type SourceSpanWire } from '@modkit/core'
import type { FieldEditable, FieldType } from '../fields/index.js'
import type { KnowledgeTarget } from '../knowledge/index.js'
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
  ModelSocketSource,
} from './model-facet-sources.js'
import type { WorldSceneSource } from '../maps/index.js'
export {
  isReservedModelFacetSource,
  RESERVED_MODEL_FACET_SOURCES,
  type ModelAnimationChannel,
  type ModelAnimationClip,
  type ModelAnimationInfo,
  type ModelAnimationKind,
  type ModelAnimationSample,
  type ModelAnimationSource,
  type ModelAnimationTimeBounds,
  type ModelBoneBinding,
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
  type ModelSkeletonInfo,
  type ModelSkeletonSource,
  type ModelSocketInfo,
  type ModelSocketOrientation,
  type ModelSocketRef,
  type ModelSocketSource,
  type ReservedModelFacetSource,
} from './model-facet-sources.js'
export type {
  AudioMediaInfo,
  AudioMediaSource,
  AudioPcmBlock,
  AudioPcmRequest,
  AudioTrackInfo,
  EncodedMediaDescriptor,
  EncodedMediaSource,
  ModelBounds,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelPrimitiveRequest,
  ModelPrimitiveTopology,
  ModelSceneInfo,
  ModelSceneSource,
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

export interface TreeNodeFacts {
  readonly kind: string
  readonly label: string
  readonly preview?: string
  readonly range?: SourceSpan
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
}

export interface TableQuery {
  readonly pattern: string
}

export interface TableDataSource {
  shape(): Promise<{
    readonly rows: number | 'unknown'
    readonly columns: number
    readonly header?: readonly string[]
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

export interface TransportSource {
  snapshot(signal?: AbortSignal): Promise<TransportSnapshot>
  events(signal?: AbortSignal): AsyncIterable<TransportEvent>
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

/** Version-one replacement or fresh-creation request for the standard `container.pack` operation. */
export type ContainerPackInputV1 = ContainerPackReplaceInputV1 | ContainerPackCreateInputV1

export interface NamespaceEntrySource {
  list(prefix: string, page: PageRequest, signal?: AbortSignal): Promise<Page<NamespaceEntry>>
  /** Optional indexed lookup; absence means the namespace only supports prefix listing. */
  search?(
    query: NamespaceEntrySearchQuery,
    page: PageRequest,
    signal?: AbortSignal,
  ): Promise<Page<NamespaceEntry>>
  /** Returns a leased source reference, never eager decoded bytes. */
  openEntry(entryId: string, signal?: AbortSignal): Promise<Lease<AssetSourceRef>>
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
}

export interface SubjectFactGroup {
  readonly id: string
  readonly label: string
  /** Count over the complete group, not the current page. */
  readonly factCount: number
}

export interface SubjectFact {
  readonly id: string
  readonly label: string
  readonly value: JsonValue
  readonly provenance: readonly SubjectFactProvenance[]
  /** Exact lookup coordinate for optional host-provided help. */
  readonly knowledgeTarget?: KnowledgeTarget
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
    hasExactStringKeys(record.provenance, PROVENANCE_KEYS)
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
