import type { Diagnostic } from '@modkitx-x3/core'
import type {
  ArtifactByteSource,
  AssetEditPlan,
  AssetInput,
  AssetRevision,
  AssetSourceRef,
  ChangeSet,
  CommitGuarantee,
  FidelityClaim,
  MutationMode,
  PermissionClass,
  RoundTrip,
  SourceEdit,
  ValidationResult,
  WriterModule,
  AudioMediaInfo,
  AudioMediaSource,
  AssetDiagnostic,
  ByteRangeSource,
  Codec,
  ContributionContext,
  JsonValue,
  Lease,
  MetadataGroup,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelSceneInfo,
  ModelSceneSource,
  OperationDecl,
  OperationOutput,
  OpenIntent,
  ResolvedAssetInputBinding,
  ResourceBudget,
  RasterImageInfo,
  RasterImageSource,
  TransportSnapshot,
  TransportSource,
  TreeDataSource,
  EncodedMediaDescriptor,
  EncodedMediaSource,
  VectorSceneInfo,
  VectorSceneSource,
  VideoMediaInfo,
  VideoMediaSource,
} from '@modkitx-x3/sdk'

export interface InspectionTreeNode {
  readonly kind: string
  readonly label: string
  readonly preview?: string
  readonly semanticPath?: readonly string[]
  readonly children?: readonly InspectionTreeNode[]
}

export interface InspectionTrait {
  readonly id: string
  readonly parameters?: JsonValue
}

export interface InspectionContext {
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
  readonly intent: OpenIntent
  readonly source: ArtifactByteSource
  readonly primary: ResolvedAssetInputBinding
  readonly byteSource: ByteRangeSource
  /** The opened input; Path A plans (`editPlanFromInput`) derive targets and revision from it. */
  readonly input: AssetInput
}

export interface InspectionResult {
  readonly summary: JsonValue
  readonly metadata: readonly MetadataGroup[]
  readonly traits: readonly InspectionTrait[]
  /** `true` publishes the raw source through the standard UTF-8 text adapter. */
  readonly text?: boolean
  readonly dataSources?: Readonly<Record<string, unknown>>
  readonly handlers?: Readonly<Record<string, (input: JsonValue) => Promise<OperationOutput>>>
  readonly diagnostics?: readonly AssetDiagnostic[]
  readonly unsupportedFeatures?: readonly string[]
  readonly maxDecodedBytes?: bigint | number | string
}

export interface InspectionCodecDefinition {
  readonly id: string
  readonly version?: string
  readonly format: {
    readonly id: string
    readonly label: string
    readonly mediaType?: string
  }
  readonly operations?: readonly OperationDecl[]
  detect(
    prefix: Uint8Array,
    uri: string,
  ): Promise<{
    readonly confidence: number
    readonly kind?: 'magic' | 'structure' | 'companion' | 'context' | 'extension' | 'user-override'
    readonly note?: string
  }>
  inspect(bytes: Uint8Array, context: InspectionContext): Promise<InspectionResult>
}

export const INSPECTION_OPERATIONS: readonly OperationDecl[]

export function simpleLease<Value>(value: Value): Lease<Value> & {
  readonly isReleased: () => boolean
}

export function createTreeDataSource(root: InspectionTreeNode): TreeDataSource
export interface TransportController extends TransportSource {
  control(
    kind: 'playPause' | 'seek' | 'setRate' | 'selectTrack',
    input?: Record<string, unknown>,
  ): void
}

export const TRANSPORT_OPERATIONS: readonly OperationDecl[]
export function createTransportSource(snapshot: TransportSnapshot): TransportController
export function createTransportHandlers(
  transport: TransportController,
): Readonly<Record<string, (input: JsonValue) => Promise<OperationOutput>>>
export function createEncodedMediaSource(
  bytes: Uint8Array,
  descriptor: Omit<EncodedMediaDescriptor, 'bytes'>,
): EncodedMediaSource
export function createRasterImageSource(
  bytes: Uint8Array,
  mediaType: string,
  info: RasterImageInfo,
  readRegion?: NonNullable<RasterImageSource['readRegion']>,
): RasterImageSource
export function createAudioMediaSource(
  bytes: Uint8Array,
  mediaType: string,
  info: AudioMediaInfo,
): AudioMediaSource
export function createVideoMediaSource(
  bytes: Uint8Array,
  mediaType: string,
  info: VideoMediaInfo,
): VideoMediaSource
export function createVectorSceneSource(info: VectorSceneInfo, text: string): VectorSceneSource
export function createModelSceneSource(input: {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
}): ModelSceneSource
export function createInspectionCodec(
  definition: InspectionCodecDefinition,
  context?: ContributionContext,
): Codec

// ---------------------------------------------------------------------------------------------
// ADR-HOST-002 — editing helpers

export function declaredPermissionClasses(
  operations: readonly OperationDecl[],
): readonly PermissionClass[]

export function assetRevisionFromInput(input: AssetInput): AssetRevision

export interface EditPlanFromInputOptions {
  readonly planId: string
  readonly edits: readonly (Omit<SourceEdit, 'targetId' | 'source'> & {
    readonly targetId?: string
    readonly source?: AssetSourceRef
  })[]
  readonly fidelity: FidelityClaim
  readonly guarantee?: CommitGuarantee
  readonly diagnostics?: readonly Diagnostic[]
}

export function editPlanFromInput(
  input: AssetInput,
  options: EditPlanFromInputOptions,
): AssetEditPlan

export function replaceBytes(
  offset: number | bigint,
  length: number | bigint,
  bytes: Uint8Array,
  label?: string,
): Omit<Extract<SourceEdit, { operation: 'replace' }>, 'targetId' | 'source'>

export interface DefineWriterOptions {
  readonly providerId: string
  readonly providerVersion?: string
  readonly artifactDigest: string
  readonly offerId: string
  readonly formatId: string
  readonly representationId: string
  readonly mutationMode?: MutationMode
  readonly minimumRoundTrip: RoundTrip
  readonly fidelityEvidenceId: string
  readonly fidelity: FidelityClaim
  readonly validate?: (change: ChangeSet, signal?: AbortSignal) => Promise<ValidationResult>
  readonly planEdits?: (change: ChangeSet, signal?: AbortSignal) => Promise<readonly SourceEdit[]>
  readonly plan?: (change: ChangeSet, signal?: AbortSignal) => Promise<AssetEditPlan>
}

export function defineWriter(options: DefineWriterOptions): WriterModule
