import type {
  ArtifactByteSource,
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
