import type { SourceSpan } from '@modkit/core'
import type { ArtifactSource, DataSourceRefWire } from '@modkit/sdk'
type EditWithoutTarget<T> = T extends SourceEdit ? Omit<T, 'targetId' | 'source'> : never
import type {
  PageRequest,
  Page,
  TransportEvent,
  ProbePlan,
  AssetOriginDescriptorWire,
  DataSourceOf,
  KnownDataSourceId,
  DataSourceMajor,
  Writer,
} from '@modkit/sdk'
import type { HostOperationHandler } from '@modkit/host'
import type { Diagnostic } from '@modkit/core'

import type {
  ArtifactByteSource,
  AssetInputPlan,
  AssetNamespace,
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
  AssetOperationDescriptor,
  ByteRangeSource,
  Codec,
  CodecCandidateSource,
  CompanionDescriptorWire,
  ContributionContext,
  DetectionResult,
  JsonValue,
  Lease,
  MetadataGroup,
  ModelAnimationClip,
  ModelAnimationSource,
  ModelBoneBinding,
  ModelCollisionSource,
  ModelCollisionVolume,
  ModelMaterialRef,
  ModelMaterialSource,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelResourceRef,
  ModelResourceRefsSource,
  ModelSceneInfo,
  ModelSceneSource,
  ModelSkeletonSource,
  ModelSocketRef,
  ModelSocketSource,
  OperationDecl,
  PortableSourceIdentity,
  ProjectionReceipt,
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
} from '@modkit/sdk'

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
  readonly signal?: AbortSignal | undefined
  readonly intent: OpenIntent
  readonly source: ArtifactByteSource
  readonly primary: ResolvedAssetInputBinding
  readonly byteSource: ByteRangeSource
  /** The opened input; Path A plans (`editPlanFromInput`) derive targets and revision from it. */
  readonly input: AssetInput
}

/** Per-document availability; declarations retain operation identity, handlers and permissions. */
export type InspectionOperationState =
  | Pick<Extract<AssetOperationDescriptor, { state: 'available' }>, 'id' | 'state' | 'reason'>
  | Pick<
      Extract<AssetOperationDescriptor, { state: 'disabled' | 'dependency-required' }>,
      'id' | 'state' | 'reason'
    >

export interface InspectionResult {
  readonly summary: JsonValue
  readonly metadata: readonly MetadataGroup[]
  readonly traits: readonly InspectionTrait[]
  /** `true` publishes the raw source; a string publishes decoded UTF-8 text. */
  readonly text?: boolean | string
  readonly dataSources?: Readonly<Record<string, unknown>>
  readonly handlers?: Readonly<Record<string, (input: JsonValue) => Promise<OperationOutput>>>
  /** Overrides declared operations by id for this open; omitted operations remain available. */
  readonly operationStates?: readonly InspectionOperationState[]
  readonly diagnostics?: readonly AssetDiagnostic[]
  readonly unsupportedFeatures?: readonly string[]
  readonly maxDecodedBytes?: bigint | number | string
  readonly companions?: readonly CompanionDescriptorWire[]
  /**
   * The native → live receipt for this open. Published as a descriptor metadata group under
   * `PROJECTION_RECEIPT_METADATA_ID`, always converted to its portable form first.
   */
  readonly projectionReceipt?: ProjectionReceipt
}

export interface NamespaceMarker {
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly size?: bigint
}

export interface NamespaceInspectionContext {
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal | undefined
  readonly intent: OpenIntent
  readonly namespace: AssetNamespace
  readonly input: Extract<AssetInput, { readonly originKind: 'namespace' }>
}

export interface NamespaceInspectionResult extends InspectionResult {
  readonly detection: {
    readonly confidence: number
    readonly kind?: 'magic' | 'structure' | 'companion' | 'context' | 'extension' | 'user-override'
    readonly note?: string
  }
}

export interface NamespaceInspectionDefinition {
  detect(
    markers: readonly NamespaceMarker[],
    uri: string,
  ): Promise<NamespaceInspectionResult['detection']>
  inspect(
    namespace: AssetNamespace,
    context: NamespaceInspectionContext,
  ): Promise<NamespaceInspectionResult>
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
  readonly namespace?: never
  planInput?(
    source: CodecCandidateSource,
    evidence: DetectionResult,
    signal: AbortSignal | undefined,
    context: ContributionContext | undefined,
  ): Promise<AssetInputPlan>
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

export interface NamespaceInspectionCodecDefinition {
  readonly id: string
  readonly version?: string
  readonly format: {
    readonly id: string
    readonly label: string
    readonly mediaType?: string
  }
  readonly operations?: readonly OperationDecl[]
  readonly namespace: NamespaceInspectionDefinition
  readonly planInput?: InspectionCodecDefinition['planInput']
  readonly detect?: never
  readonly inspect?: never
}

export interface TransportController extends TransportSource {
  control(
    kind: 'playPause' | 'seek' | 'setRate' | 'selectTrack',
    input?: Record<string, unknown>,
  ): void
}

export interface EditPlanFromInputOptions {
  readonly planId: string
  readonly edits: readonly (EditWithoutTarget<SourceEdit> & {
    readonly targetId?: string
    readonly source?: AssetSourceRef
  })[]
  readonly fidelity: FidelityClaim
  readonly guarantee?: CommitGuarantee
  readonly diagnostics?: readonly Diagnostic[]
}

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

import { canonicalJsonStringify } from '@modkit/core'
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkit/host'
import { revisionId, toPortableProjectionReceipt } from '@modkit/sdk'

export const INSPECTION_OPERATIONS: readonly OperationDecl[] = Object.freeze([
  Object.freeze({
    id: 'view.inspect' as OperationDecl['id'],
    handlerId: 'inspect',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['json'] as const),
  }),
  Object.freeze({
    id: 'asset.validate' as OperationDecl['id'],
    handlerId: 'validate',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['none'] as const),
  }),
  Object.freeze({
    id: 'export.raw' as OperationDecl['id'],
    handlerId: 'export-raw',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['bytes'] as const),
  }),
])

export function simpleLease<Value>(value: Value): Lease<Value> & {
  readonly isReleased: () => boolean
} {
  let released = false
  return Object.freeze<
    Lease<Value> & {
      readonly isReleased: () => boolean
    }
  >({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

function pageStart(cursor?: string) {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new TypeError('invalid page cursor')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) throw new TypeError('page cursor exceeds safe integer range')
  return value
}

/** Build a bounded lazy tree from inert nodes shaped as `{kind,label,preview?,children?}`. */
export function createTreeDataSource(rootNode: InspectionTreeNode): TreeDataSource {
  const nodes = new Map<string, { node: InspectionTreeNode; childIds: string[] }>()
  const register = (node: InspectionTreeNode, id: string): void => {
    const children = Array.isArray(node.children) ? node.children : []
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) })
    children.forEach((child, index) => register(child, `${id}/${index}`))
  }
  register(rootNode, 'root')
  const ref = (id: string) => {
    const item = nodes.get(id)
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 })
  }
  return Object.freeze<TreeDataSource>({
    async root() {
      return ref('root')
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('tree page limit must be a positive safe integer')
      }
      const start = pageStart(page.cursor)
      const childIds = nodes.get(node.id)?.childIds ?? []
      const items = childIds.slice(start, start + page.limit).map(ref)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < childIds.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node
      if (value === undefined) throw new TypeError(`unknown tree node ${node.id}`)
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...(value.preview === undefined ? {} : { preview: value.preview }),
        ...(value.semanticPath === undefined
          ? {}
          : { semanticPath: Object.freeze([...value.semanticPath]) }),
      })
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const [id, item] of nodes) {
        if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
        const haystack = `${item.node.label}\n${item.node.preview ?? ''}`.toLocaleLowerCase()
        if (haystack.includes(needle)) yield ref(id)
      }
    },
  })
}

export function createTransportSource(snapshot: TransportSnapshot): TransportController {
  let current = {
    ...snapshot,
    tracks: snapshot.tracks.map(track => ({ ...track })),
    controls: { ...snapshot.controls },
  }
  const listeners = new Set<(event: TransportEvent) => void>()
  const owned = () =>
    Object.freeze({
      ...current,
      tracks: Object.freeze(current.tracks.map(track => Object.freeze({ ...track }))),
      controls: Object.freeze({ ...current.controls }),
    })
  const publish = () => {
    const event = Object.freeze({ kind: 'snapshot' as const, snapshot: owned() })
    for (const listener of listeners) listener(event)
  }
  return Object.freeze<TransportController>({
    async snapshot(signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return owned()
    },
    async *events(signal) {
      if (signal?.aborted) return
      const queue: TransportEvent[] = [Object.freeze({ kind: 'snapshot', snapshot: owned() })]
      let wake: (() => void) | undefined
      const listener = (event: TransportEvent) => {
        queue.push(event)
        wake?.()
      }
      const abort = () => wake?.()
      listeners.add(listener)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        while (!signal?.aborted) {
          if (queue.length === 0) await new Promise<void>(resolve => (wake = resolve))
          wake = undefined
          const event = queue.shift()
          if (event !== undefined) yield event
        }
      } finally {
        listeners.delete(listener)
        signal?.removeEventListener('abort', abort)
      }
    },
    control(kind, input = {}) {
      if (kind === 'playPause') {
        current = { ...current, state: current.state === 'playing' ? 'paused' : 'playing' }
      } else if (kind === 'seek') {
        const positionMs = input?.['positionMs'] as number
        if (!Number.isFinite(positionMs) || positionMs < 0)
          throw new RangeError('transport seek requires a non-negative positionMs')
        const maximum = typeof current.durationMs === 'number' ? current.durationMs : positionMs
        current = { ...current, positionMs: Math.min(positionMs, maximum) }
      } else if (kind === 'setRate') {
        const rate = input?.['rate'] as number
        if (!Number.isFinite(rate) || rate <= 0 || rate > 16)
          throw new RangeError('transport rate must be within (0, 16]')
        current = { ...current, rate }
      } else if (kind === 'selectTrack') {
        const trackId = input?.['trackId']
        if (typeof trackId !== 'string' || !current.tracks.some(track => track.id === trackId))
          throw new RangeError('transport selectTrack requires a known trackId')
        current = {
          ...current,
          tracks: current.tracks.map(track => ({ ...track, selected: track.id === trackId })),
        }
      } else {
        throw new RangeError(`unknown transport control: ${kind}`)
      }
      publish()
    },
  })
}

export const TRANSPORT_OPERATIONS: readonly OperationDecl[] = Object.freeze([
  Object.freeze({
    id: 'media.play-pause' as OperationDecl['id'],
    handlerId: 'transport-play-pause',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['none'] as const),
  }),
  Object.freeze({
    id: 'media.seek' as OperationDecl['id'],
    handlerId: 'transport-seek',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['none'] as const),
  }),
  Object.freeze({
    id: 'media.set-rate' as OperationDecl['id'],
    handlerId: 'transport-set-rate',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['none'] as const),
  }),
  Object.freeze({
    id: 'media.select-track' as OperationDecl['id'],
    handlerId: 'transport-select-track',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    outputKinds: Object.freeze(['none'] as const),
  }),
])

export function createTransportHandlers(
  transport: TransportController,
): Readonly<Record<string, (input: JsonValue) => Promise<OperationOutput>>> {
  const handler =
    (kind: Parameters<TransportController['control']>[0]) =>
    async (input: JsonValue): Promise<OperationOutput> => {
      transport.control(kind, input as Record<string, unknown>)
      return Object.freeze({ kind: 'none' })
    }
  return Object.freeze<Readonly<Record<string, (input: JsonValue) => Promise<OperationOutput>>>>({
    'transport-play-pause': handler('playPause'),
    'transport-seek': handler('seek'),
    'transport-set-rate': handler('setRate'),
    'transport-select-track': handler('selectTrack'),
  })
}

function assertBoundedRead(offset: bigint, length: number, size: number) {
  if (typeof offset !== 'bigint' || offset < 0n || offset > BigInt(size)) {
    throw new RangeError('encoded media offset is outside the source')
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('encoded media length must be a non-negative safe integer')
  }
}

/** Create an immutable, bounded encoded-media view without copying bytes on construction. */
export function createEncodedMediaSource(
  bytes: Uint8Array,
  descriptor: Omit<EncodedMediaDescriptor, 'bytes'>,
): EncodedMediaSource {
  const owned = Object.freeze({
    mediaType: descriptor.mediaType,
    bytes: BigInt(bytes.byteLength),
    ...(descriptor.codecs === undefined ? {} : { codecs: Object.freeze([...descriptor.codecs]) }),
  })
  return Object.freeze<EncodedMediaSource>({
    async descriptor() {
      return owned
    },
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      assertBoundedRead(offset, length, bytes.byteLength)
      const start = Number(offset)
      return bytes.slice(start, Math.min(bytes.byteLength, start + length))
    },
  })
}

export function createRasterImageSource(
  bytes: Uint8Array,
  mediaType: string,
  info: RasterImageInfo,
  readRegion?: NonNullable<RasterImageSource['readRegion']>,
): RasterImageSource {
  const ownedInfo = Object.freeze({ ...info })
  const encoded = createEncodedMediaSource(bytes, { mediaType })
  const source: RasterImageSource = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return encoded
    },
  }
  if (readRegion !== undefined) source.readRegion = readRegion
  return Object.freeze(source)
}

export function createAudioMediaSource(
  bytes: Uint8Array,
  mediaType: string,
  info: AudioMediaInfo,
  readPcm?: NonNullable<AudioMediaSource['readPcm']>,
): AudioMediaSource {
  const tracks = Object.freeze(info.tracks.map(track => Object.freeze({ ...track })))
  const ownedInfo = Object.freeze({ ...info, tracks })
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map(track => track.codec),
  })
  /*
   * `pcmAccess` is what a viewer reads before deciding whether to ask for samples, so it may not
   * be a wish: a source that says yes without a reader would make every viewer's fallback path
   * unreachable at exactly the moment it is needed.
   */
  if (ownedInfo.pcmAccess === true && readPcm === undefined) {
    throw new TypeError('audio source declares pcmAccess without a readPcm implementation')
  }
  const source: AudioMediaSource = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async encoded(trackId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      /*
       * `null` means the same as `undefined` here: "no particular track".
       *
       * The capability RPC carries JSON, and JSON has no `undefined` — a viewer that calls
       * `encoded(undefined)` in-process is calling `encoded(null)` once the codec runs
       * worker-brokered, which is how every installed VS Code editor runs it. Treating that as a
       * track id made the default request refuse itself with "unknown audio track null", and the
       * audio stage showed a decoder error for a file it could decode perfectly well.
       */
      if (
        trackId !== undefined &&
        trackId !== null &&
        !tracks.some(track => track.id === trackId)
      ) {
        throw new RangeError(`unknown audio track ${trackId}`)
      }
      return encoded
    },
  }
  if (readPcm !== undefined) source.readPcm = readPcm
  return Object.freeze(source)
}

export function createVideoMediaSource(
  bytes: Uint8Array,
  mediaType: string,
  info: VideoMediaInfo,
): VideoMediaSource {
  const tracks = Object.freeze(info.tracks.map(track => Object.freeze({ ...track })))
  const ownedInfo = Object.freeze({ ...info, tracks })
  const encoded = createEncodedMediaSource(bytes, {
    mediaType,
    codecs: tracks.map(track => track.codec),
  })
  return Object.freeze<VideoMediaSource>({
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async encoded(signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return encoded
    },
  })
}

export function createVectorSceneSource(info: VectorSceneInfo, text: string): VectorSceneSource {
  const ownedInfo = Object.freeze({
    ...info,
    ...(info.viewBox === undefined
      ? {}
      : { viewBox: Object.freeze([...info.viewBox] as [number, number, number, number]) }),
  })
  const document = Object.freeze({
    mediaType: 'image/svg+xml',
    profile: 'uvg.secure-static.v1',
    text,
  })
  return Object.freeze<VectorSceneSource>({
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async document(signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return document
    },
  })
}

function frozenModelNode(node: ModelNode): ModelNode {
  return Object.freeze<ModelNode>({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    meshIds: Object.freeze([...node.meshIds]),
    transform: Object.freeze([...node.transform]),
  })
}

function frozenModelMesh(mesh: ModelMesh): ModelMesh {
  return Object.freeze<ModelMesh>({ ...mesh, primitiveIds: Object.freeze([...mesh.primitiveIds]) })
}

function clonePrimitive(primitive: ModelPrimitive): ModelPrimitive {
  return Object.freeze<ModelPrimitive>({
    ...primitive,
    positions: primitive.positions.slice(),
    ...(primitive.indices === undefined ? {} : { indices: primitive.indices.slice() }),
    ...(primitive.normals === undefined ? {} : { normals: primitive.normals.slice() }),
    ...(primitive.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: primitive.textureCoordinates.slice() }),
  })
}

/** Create a lazy model-scene source; decoded primitive buffers are returned as owned copies. */
export function createModelSceneSource({
  info,
  nodes,
  meshes,
  primitives = [],
}: {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
}): ModelSceneSource {
  const ownedInfo = Object.freeze({ ...info })
  const ownedNodes = Object.freeze(nodes.map(frozenModelNode))
  const ownedMeshes = Object.freeze(meshes.map(frozenModelMesh))
  const ownedPrimitives = new Map(primitives.map(value => [value.id, clonePrimitive(value)]))
  const page = <T>(items: readonly T[], request: PageRequest): Page<T> => {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new TypeError('model page limit must be a positive safe integer')
    }
    const start = pageStart(request.cursor)
    const values = items.slice(start, start + request.limit)
    return Object.freeze({
      items: Object.freeze(values),
      ...(start + values.length < items.length
        ? { nextCursor: String(start + values.length) }
        : {}),
    })
  }
  const source: ModelSceneSource = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return ownedInfo
    },
    async nodes(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return page(ownedNodes, request)
    },
    async meshes(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return page(ownedMeshes, request)
    },
  }
  if (ownedPrimitives.size > 0) {
    source.primitive = async (primitiveId, request, signal) => {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(request?.maxBytes) || request.maxBytes < 0) {
        throw new TypeError('model primitive maxBytes must be a non-negative safe integer')
      }
      const primitive = ownedPrimitives.get(primitiveId)
      if (primitive === undefined) throw new RangeError(`unknown model primitive ${primitiveId}`)
      const bytes =
        primitive.positions.byteLength +
        (primitive.indices?.byteLength ?? 0) +
        (primitive.normals?.byteLength ?? 0) +
        (primitive.textureCoordinates?.byteLength ?? 0)
      if (bytes > request.maxBytes) throw new RangeError('model primitive exceeds maxBytes budget')
      return clonePrimitive(primitive)
    }
  }
  return Object.freeze(source)
}

// ---------------------------------------------------------------------------------------------
// optional model facet sources (block 12, slice 12-1 — migration of the ad hoc summaries)
//
// The five contracts of `model-facet-sources.ts` were derived from what these codecs already
// computed; these builders are the other half of that move. Each derives its `info()` counts from
// the records it was handed rather than accepting them from the caller, so a publisher physically
// cannot say "seven references" and then page four: the summary and the page are the same data.
//
// A publisher that cannot answer does not call the builder at all. None of these fills a missing
// field with a zero, an empty array or an invented name — an absent facet is absent (§2.7).

/** Shared page rule for the facet sources: same cursor grammar as the base model source. */
function facetPage<T>(items: readonly T[], request: PageRequest): Page<T> {
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
    throw new TypeError('model facet page limit must be a positive safe integer')
  }
  const start = pageStart(request.cursor)
  const values = items.slice(start, start + request.limit)
  return Object.freeze<Page<T>>({
    items: Object.freeze(values),
    ...(start + values.length < items.length ? { nextCursor: String(start + values.length) } : {}),
  })
}

function facetSource<Info, Key extends string, Item extends object>(
  info: Info,
  key: Key,
  items: readonly Item[],
): Readonly<
  { info(signal?: AbortSignal): Promise<Info> } & Record<
    Key,
    (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
  >
> {
  const owned = Object.freeze(items.map(item => Object.freeze({ ...item })))
  const source = {
    async info(signal?: AbortSignal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return info
    },
  }
  ;(
    source as unknown as Record<
      Key,
      (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
    >
  )[key] = async (request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    return facetPage(owned, request)
  }
  return Object.freeze(source) as Readonly<
    { info(signal?: AbortSignal): Promise<Info> } & Record<
      Key,
      (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>
    >
  >
}

/**
 * `common.view/model-resource-refs-source@1` — logical requirements, never opened here.
 *
 * `bound` counts the entries the host actually bound, which is why `bindingId` is the only thing
 * that may promote a reference: a codec that guessed a companion existed would be reporting the
 * resolver's job as its own.
 */
export function createModelResourceRefsSource({
  references,
  truncated = false,
}: {
  readonly references: readonly ModelResourceRef[]
  readonly truncated?: boolean
}): ModelResourceRefsSource {
  const items = [...references]
  const info = Object.freeze({
    references: items.length,
    bound: items.filter(item => item.bindingId !== undefined).length,
    truncated: truncated === true,
  })
  return facetSource(info, 'references', items)
}

/** `common.view/model-skeleton-source@1` — bone bindings and where each name came from. */
export function createModelSkeletonSource({
  bindings,
  hierarchies,
}: {
  readonly bindings: readonly ModelBoneBinding[]
  readonly hierarchies?: number
}): ModelSkeletonSource {
  const items = bindings.map(binding => ({
    ...binding,
    ...(binding.flagNames === undefined
      ? {}
      : { flagNames: Object.freeze([...binding.flagNames]) }),
    ...(binding.restMatrix === undefined
      ? {}
      : { restMatrix: Object.freeze([...binding.restMatrix]) }),
  }))
  const info = Object.freeze({
    bindings: items.length,
    named: items.filter(item => item.boneName !== null).length,
    companionBound: items.filter(item => item.provenance === 'companion').length,
    // absent, not zero, when the publisher does not enumerate hierarchies
    ...(hierarchies === undefined ? {} : { hierarchies }),
  })
  return facetSource(info, 'bindings', items)
}

/** `common.view/model-animation-source@1` — clips, and a rest pose stays a rest pose. */
export function createModelAnimationSource({
  clips,
}: {
  readonly clips: readonly ModelAnimationClip[]
}): ModelAnimationSource {
  const items = clips.map(clip => ({
    ...clip,
    ...(clip.nativeTimeBounds === undefined
      ? {}
      : { nativeTimeBounds: Object.freeze({ ...clip.nativeTimeBounds }) }),
    channels: Object.freeze(
      clip.channels.map(channel => ({
        ...channel,
        ...(channel.samples === undefined
          ? {}
          : {
              samples: Object.freeze(
                channel.samples.map(sample =>
                  Object.freeze({ ...sample, value: Object.freeze([...sample.value]) }),
                ),
              ),
            }),
      })),
    ),
  }))
  const info = Object.freeze({
    clips: items.length,
    channelled: items.filter(clip => clip.channels.length > 0).length,
    companionBound: items.filter(clip => clip.provenance === 'companion').length,
  })
  return facetSource(info, 'clips', items)
}

/** `common.view/model-collision-source@1` — declared volumes and mesh roles, kept apart. */
export function createModelCollisionSource({
  volumes,
}: {
  readonly volumes: readonly ModelCollisionVolume[]
}): ModelCollisionSource {
  const items = volumes.map(volume => ({
    ...volume,
    ...(volume.types === undefined ? {} : { types: Object.freeze([...volume.types]) }),
  }))
  const byKind: Record<string, number> = {}
  for (const volume of items) byKind[volume.kind] = (byKind[volume.kind] ?? 0) + 1
  const info = Object.freeze({ volumes: items.length, byKind: Object.freeze(byKind) })
  return facetSource(info, 'volumes', items)
}

/** `common.view/model-material-source@1` — identity and contract coverage, not shader semantics. */
export function createModelMaterialSource({
  materials,
  libraries,
}: {
  readonly materials: readonly ModelMaterialRef[]
  readonly libraries?: number
}): ModelMaterialSource {
  const items = materials.map(material => ({
    ...material,
    ...(material.contracts === undefined
      ? {}
      : { contracts: Object.freeze([...material.contracts]) }),
    ...(material.flagNames === undefined
      ? {}
      : { flagNames: Object.freeze([...material.flagNames]) }),
    ...(material.layers === undefined
      ? {}
      : {
          layers: Object.freeze(
            material.layers.map(layer => ({
              ...layer,
              ...(layer.flagNames === undefined
                ? {}
                : { flagNames: Object.freeze([...layer.flagNames]) }),
            })),
          ),
        }),
  }))
  const byContract: Record<string, number> = {}
  for (const material of items) {
    for (const contract of material.contracts ?? []) {
      byContract[contract] = (byContract[contract] ?? 0) + 1
    }
  }
  const info = Object.freeze({
    materials: items.length,
    // absent, not zero, when the format has no library concept at all
    ...(libraries === undefined ? {} : { libraries }),
    ...(Object.keys(byContract).length === 0 ? {} : { byContract: Object.freeze(byContract) }),
  })
  return facetSource(info, 'materials', items)
}

/** `common.view/model-socket-source@1` — stable attachment identity and native source name. */
export function createModelSocketSource({
  sockets,
}: {
  readonly sockets: readonly ModelSocketRef[]
}): ModelSocketSource {
  const items = sockets.map(socket => ({
    ...socket,
    ...(socket.orientation === undefined
      ? {}
      : { orientation: Object.freeze({ ...socket.orientation }) }),
  }))
  const byRole: Record<string, number> = {}
  for (const socket of items) byRole[socket.role] = (byRole[socket.role] ?? 0) + 1
  return facetSource(
    Object.freeze({ sockets: items.length, byRole: Object.freeze(byRole) }),
    'sockets',
    items,
  )
}

// ---------------------------------------------------------------------------------------------
// ProjectionReceipt — the native → live boundary (§2.6, block 12 item 5)

/** Metadata group id every codec publishes its projection receipt under. */
export const PROJECTION_RECEIPT_METADATA_ID = 'uv-projection-receipt'

const PLANE_STATES = new Set(['normalized', 'preserved', 'inferred', 'lost'])
const CONFIDENCES = new Set(['exact', 'high', 'partial', 'heuristic'])

/**
 * Build the local `ProjectionReceipt` a codec emits when it opens a subject.
 *
 * Checked rather than trusted: a plane state outside the four §2.6 distinguishes, or a receipt with
 * no plane and no evidence at all, is refused here instead of reaching a consumer as a receipt that
 * says nothing. `inferred` stays separate from `normalized` because a value the adapter computed is
 * not the same fact as one it converted.
 */
export function createProjectionReceipt(
  receipt: Omit<ProjectionReceipt, 'form' | 'sourceIdentity'>,
): ProjectionReceipt {
  const planes = [...(receipt.planes ?? [])]
  if (planes.length === 0)
    throw new TypeError('a projection receipt must record at least one plane')
  for (const plane of planes) {
    if (!PLANE_STATES.has(plane.state)) {
      throw new TypeError(`projection plane «${plane.planeId}» has an unknown state ${plane.state}`)
    }
  }
  if (!CONFIDENCES.has(receipt.confidence)) {
    throw new TypeError(`projection receipt has an unknown confidence ${receipt.confidence}`)
  }
  if ((receipt.evidence ?? []).length === 0) {
    throw new TypeError(
      'a projection receipt made of no evidence is a claim with nothing behind it; state at least one declared or observed fact',
    )
  }
  return Object.freeze<ProjectionReceipt>({
    form: 'local',
    adapter: Object.freeze({ ...receipt.adapter }),
    subjectRevision: receipt.subjectRevision,
    companions: Object.freeze((receipt.companions ?? []).map(item => Object.freeze({ ...item }))),
    basis: Object.freeze({ ...receipt.basis }),
    planes: Object.freeze(planes.map(plane => Object.freeze({ ...plane }))),
    evidence: Object.freeze(receipt.evidence.map(item => Object.freeze({ ...item }))),
    confidence: receipt.confidence,
    ...(receipt.semanticHash === undefined ? {} : { semanticHash: receipt.semanticHash }),
    ...(receipt.sourceUri === undefined ? {} : { sourceUri: receipt.sourceUri }),
  })
}

/**
 * JSON-safe deep copy: the descriptor carries `JsonValue`, and `bytesRead` is a `bigint`.
 *
 * Widening it to a decimal string is the honest conversion — `Number` would silently round a byte
 * count past 2^53, and dropping the field would delete the very evidence it records.
 */
function jsonSafe(value: unknown): JsonValue {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  }
  return value as JsonValue
}

/**
 * The descriptor metadata group that carries a projection receipt, always in its portable form.
 *
 * Portable is not a preference here. A descriptor crosses the worker boundary and can be persisted,
 * so a receipt inside one must not name the machine that produced it: `toPortableProjectionReceipt`
 * drops the ambient URI structurally, and this is the only way a codec publishes a receipt.
 */
export function projectionReceiptMetadataGroup(
  receipt: ProjectionReceipt,
  identity: PortableSourceIdentity,
): MetadataGroup {
  const portable = toPortableProjectionReceipt(receipt, identity)
  return Object.freeze<MetadataGroup>({
    id: PROJECTION_RECEIPT_METADATA_ID,
    label: 'UV projection receipt',
    entries: Object.freeze([Object.freeze({ key: 'receipt', value: jsonSafe(portable) })]),
  })
}

/** The identity a codec publishes: the subject revision is already in the receipt beside it. */
const CODEC_SOURCE_IDENTITY = Object.freeze({
  kind: 'redacted',
  reason:
    'a codec projects a subject the host already opened; its portable identity is the subject revision this receipt carries, and an ambient URI would leak the producing machine into every copy',
})

/**
 * Descriptor metadata plus, when the codec emitted one, its projection receipt.
 *
 * Appended last and under a fixed group id so a generic consumer finds a receipt the same way for
 * every format — which is the whole point of moving codecs off their ad hoc summaries.
 */
function descriptorMetadata(inspection: InspectionResult) {
  const groups = inspection.metadata ?? []
  if (inspection.projectionReceipt === undefined) return groups
  return [
    ...groups,
    projectionReceiptMetadataGroup(inspection.projectionReceipt, CODEC_SOURCE_IDENTITY),
  ]
}

function inspectionOperations(
  declarations: readonly OperationDecl[],
  states: readonly InspectionOperationState[] = [],
): readonly AssetOperationDescriptor[] {
  const declaredIds = new Set(declarations.map(operation => operation.id))
  const byId = new Map<AssetOperationDescriptor['id'], InspectionOperationState>()
  for (const operation of states) {
    const id = operation.id
    if (!declaredIds.has(operation.id)) {
      throw new TypeError(`operation state references undeclared operation ${operation.id}`)
    }
    if (byId.has(operation.id)) {
      throw new TypeError(`duplicate operation state for ${operation.id}`)
    }
    if (operation.state === 'available') {
      if (operation.reason !== undefined) {
        throw new TypeError(`available operation ${id} cannot have a reason`)
      }
    } else if (
      (operation.state !== 'disabled' && operation.state !== 'dependency-required') ||
      typeof operation.reason !== 'string' ||
      operation.reason.length === 0
    ) {
      throw new TypeError(`invalid operation state or reason for ${operation.id}`)
    }
    byId.set(operation.id, operation)
  }
  return Object.freeze(
    declarations.map((operation): AssetOperationDescriptor => {
      const override = byId.get(operation.id)
      const identity = {
        id: operation.id,
        handlerId: operation.handlerId,
        mutatesSource: operation.mutatesSource,
      }
      return Object.freeze(
        override === undefined || override.state === 'available'
          ? { ...identity, state: 'available' }
          : { ...identity, state: override.state, reason: override.reason },
      )
    }),
  )
}

async function readAll(source: ArtifactSource, budget: ResourceBudget, signal?: AbortSignal) {
  if (source.kind !== 'bytes' || source.size === undefined) {
    throw new TypeError('inspection codecs require a sized byte source')
  }
  if (source.size > budget.maxInputBytes || source.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('source exceeds the inspection budget')
  }
  const total = Number(source.size)
  const result = new Uint8Array(total)
  let offset = 0
  while (offset < total) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const chunk = await source.read(BigInt(offset), Math.min(64 * 1024, total - offset), signal)
    if (chunk.byteLength === 0) throw new RangeError('source ended before its declared size')
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function originFrom(
  input: AssetInput,
  primary?: ResolvedAssetInputBinding,
  companions: readonly CompanionDescriptorWire[] = [],
): AssetOriginDescriptorWire {
  const requiredCompanionBindings = new Set(
    companions.flatMap(companion =>
      companion.required === true && companion.state === 'resolved' ? companion.bindingIds : [],
    ),
  )
  const toBinding = (binding: ResolvedAssetInputBinding) => ({
    id: binding.bindingId,
    role: binding.role,
    source: binding.source,
    required:
      binding.sourceKind === 'candidate' || requiredCompanionBindings.has(binding.bindingId),
    ownership: binding.ownership,
    revision: binding.revision,
  })
  if (input.originKind === 'single')
    return { kind: 'single', binding: toBinding(primary as ResolvedAssetInputBinding) }
  if (input.originKind === 'bundle') {
    return {
      kind: 'bundle',
      bindings: input.bindings.map(toBinding),
      primary: input.primaryBindingId,
    }
  }
  if (input.originKind === 'namespace') {
    return { kind: 'namespace', root: input.root, revision: input.revisions.namespaceRevision }
  }
  throw new TypeError('inspection codec requires a physical byte input')
}

/**
 * The declared probe window is a ceiling, not a demand: a source shorter than the plan must be
 * probed with what it has. `ArtifactByteSource.read` treats a range past EOF as an error, not a
 * short read, so an unclamped plan makes every file smaller than the window unprobeable
 * (`x3.host/source-range-unrepresentable` before `detect()` ever runs).
 */
function probeLength(plan: Extract<ProbePlan, { kind: 'bytes' }>, size?: bigint) {
  const first = plan.ranges[0]
  const declared = Math.min(plan.maxBytes, first?.length ?? plan.maxBytes)
  const available = size === undefined ? declared : Number(size)
  return Math.max(0, Math.min(declared, available))
}

/**
 * Create a portable metadata/inspection codec.
 *
 * The definition owns detection and parsing. This helper owns only lifecycle, bounded source
 * reads, descriptor assembly, standard data-source leases, and the three shared read-only
 * operations. Optional custom operations remain format-owned.
 */
export function createInspectionCodec(
  definition: InspectionCodecDefinition | NamespaceInspectionCodecDefinition,
  contributionContext?: ContributionContext,
): Codec {
  const namespaceDefinition = definition.namespace
  const customOperations = Object.freeze([...(definition.operations ?? [])])
  const sharedOperations =
    namespaceDefinition === undefined
      ? INSPECTION_OPERATIONS
      : INSPECTION_OPERATIONS.filter(operation => operation.handlerId !== 'export-raw')
  const customIds = new Set<string>()
  for (const operation of customOperations) {
    if (customIds.has(operation.id))
      throw new TypeError(`Duplicate custom operation: ${operation.id}`)
    customIds.add(operation.id)
  }
  // A consumer may supply a genuine implementation/output contract for a shared operation.
  // Replace its declaration by id; never publish two entries for the same operation.
  const operationDeclarations = Object.freeze([
    ...sharedOperations.filter(operation => !customIds.has(operation.id)),
    ...customOperations,
  ])
  const handlerIds = new Set<string>()
  for (const operation of operationDeclarations) {
    if (handlerIds.has(operation.handlerId))
      throw new TypeError(`Duplicate operation handler: ${operation.handlerId}`)
    handlerIds.add(operation.handlerId)
  }
  return Object.freeze<Codec>({
    async probe(request, signal) {
      if (namespaceDefinition !== undefined) {
        if (request.source.kind !== 'namespace' || request.plan.kind !== 'namespace') {
          throw new TypeError(`${definition.id} requires a namespace probe`)
        }
        const namespaceLease = await request.source.openNamespace(signal)
        try {
          const markers = []
          for (const path of request.plan.markers) {
            let entryLease
            try {
              entryLease = await namespaceLease.value.open(path, signal)
            } catch (error) {
              const code = (error as { code?: string } | null)?.code
              if (code === 'x3.host/namespace-entry-not-found') continue
              throw error
            }
            try {
              markers.push(
                Object.freeze({
                  path,
                  kind: entryLease.value.kind === 'namespace' ? 'directory' : 'file',
                  ...(entryLease.value.kind === 'bytes' && entryLease.value.size !== undefined
                    ? { size: entryLease.value.size }
                    : {}),
                }),
              )
            } finally {
              await entryLease.release()
            }
          }
          const detected = await namespaceDefinition.detect(
            Object.freeze(markers),
            request.source.ref.uri,
          )
          return Object.freeze({
            codecId: definition.id,
            confidence: detected.confidence,
            evidence: Object.freeze([
              Object.freeze({
                kind: detected.kind ?? 'structure',
                weight: detected.confidence,
                note: detected.note as string,
              }),
            ]),
            requiredRanges: Object.freeze([]),
          })
        } finally {
          await namespaceLease.release()
        }
      }
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes') {
        throw new TypeError(`${definition.id} requires a byte probe`)
      }
      const bytes = await request.source.read(
        0n,
        probeLength(request.plan, request.source.size),
        signal,
      )
      const detected = await (
        definition.detect as (
          prefix: Uint8Array,
          uri: string,
        ) => Promise<{
          readonly confidence: number
          readonly kind?:
            'magic' | 'structure' | 'companion' | 'context' | 'extension' | 'user-override'
          readonly note?: string
        }>
      )(bytes, request.source.ref.uri)
      return Object.freeze({
        codecId: definition.id,
        confidence: detected.confidence,
        evidence: Object.freeze([
          Object.freeze({
            kind: detected.kind ?? 'magic',
            weight: detected.confidence,
            note: detected.note as string,
          }),
        ]),
        requiredRanges: Object.freeze([
          Object.freeze({ byteOffset: '0', byteLength: String(bytes.byteLength) } as SourceSpan),
        ]),
      })
    },
    async planInput(source, evidence, signal) {
      if (definition.planInput !== undefined) {
        return definition.planInput(source, evidence, signal, contributionContext)
      }
      if (namespaceDefinition !== undefined) {
        if (source.kind !== 'namespace') {
          throw new TypeError(`${definition.id} requires a namespace input`)
        }
        return Object.freeze({ originKind: 'namespace', requirements: Object.freeze([] as const) })
      }
      return Object.freeze({
        originKind: 'single',
        candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
        requirements: Object.freeze([] as const),
      })
    },
    async open(input, intent, budget, signal) {
      if (namespaceDefinition !== undefined) {
        if (input.originKind !== 'namespace') {
          throw new TypeError(`${definition.id} requires a namespace input`)
        }
        const namespaceLease = await input.openNamespace(signal)
        try {
          const inspection = await namespaceDefinition.inspect(namespaceLease.value, {
            budget,
            signal,
            intent,
            namespace: namespaceLease.value,
            input,
          })
          const dataSources = new Map(Object.entries(inspection.dataSources ?? {}))
          const descriptor = await assembleSubjectDescriptor({
            schemaVersion: 2,
            subjectUri: input.root.uri,
            origin: originFrom(input),
            interpretation: 'codec',
            identity: {
              codecId: definition.id,
              codecVersion: definition.version ?? '1.0.0',
              formatId: definition.format.id,
              formatLabel: definition.format.label,
              ...(definition.format.mediaType === undefined
                ? {}
                : { mediaType: definition.format.mediaType }),
              confidence: inspection.detection.confidence,
              detection: [
                {
                  kind: inspection.detection.kind ?? 'structure',
                  weight: inspection.detection.confidence,
                  ...(inspection.detection.note === undefined
                    ? {}
                    : { note: inspection.detection.note }),
                },
              ],
            },
            traits: inspection.traits.map(trait => ({
              id: trait.id,
              descriptorVersion: 1,
              state: 'available',
              ...(trait.parameters === undefined ? {} : { parameters: trait.parameters }),
            })),
            operations: inspectionOperations(operationDeclarations, inspection.operationStates),
            constraints: {
              readOnly: !operationDeclarations.some(operation => operation.mutatesSource === true),
              seekable: false,
              randomAccess: false,
              trusted: false,
              ...(inspection.maxDecodedBytes === undefined
                ? {}
                : { maxDecodedBytes: String(inspection.maxDecodedBytes) }),
              ...(inspection.unsupportedFeatures === undefined
                ? {}
                : { unsupportedFeatures: inspection.unsupportedFeatures }),
            },
            dataSources: [...dataSources.keys()].map(
              contract => ({ contract, major: 1 }) as DataSourceRefWire,
            ),
            diagnostics: inspection.diagnostics ?? [],
            metadata: descriptorMetadata(inspection),
            revision: input.revisions.revision,
          })
          const handlers = new Map<string, HostOperationHandler>([
            ['inspect', async () => ({ kind: 'json', value: inspection.summary })],
            ['validate', async () => ({ kind: 'none' })],
            ...Object.entries(inspection.handlers ?? {}),
          ])
          return createAssetSession({
            revision: revisionId(input.revisions.revision),
            descriptor,
            operationDeclarations,
            permissionGrant: {
              id: `${definition.format.id}-inspection-session`,
              classes: declaredPermissionClasses(operationDeclarations),
            },
            handlers,
            async openDataSource<
              Contract extends KnownDataSourceId,
              Major extends DataSourceMajor<Contract>,
            >(contract: Contract) {
              const value = dataSources.get(contract)
              if (value === undefined)
                throw new TypeError(`${definition.id} does not publish ${contract}`)
              return simpleLease(value as DataSourceOf<Contract, Major>)
            },
            release: [() => namespaceLease.release()],
          }).session
        } catch (error) {
          await namespaceLease.release()
          throw error
        }
      }
      if (input.originKind !== 'single' && input.originKind !== 'bundle') {
        throw new TypeError(`${definition.id} requires a single or bundle byte input`)
      }
      const primaryId = input.primaryBindingId
      const primary = input.bindings.find(binding => binding.bindingId === primaryId)
      if (primary === undefined) throw new TypeError('primary binding is missing')
      const sourceLease = await input.openBinding(primary.bindingId, signal)
      const source = sourceLease.value
      try {
        const bytes = await readAll(source, budget, signal)
        const detected = await (
          definition.detect as (
            prefix: Uint8Array,
            uri: string,
          ) => Promise<{
            readonly confidence: number
            readonly kind?:
              'magic' | 'structure' | 'companion' | 'context' | 'extension' | 'user-override'
            readonly note?: string
          }>
        )(bytes, primary.source.uri)
        const byteSource = Object.freeze<ByteRangeSource>({
          size: async () => BigInt(bytes.byteLength),
          async read(offset, length, readSignal) {
            if (readSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
            if (offset < 0n || offset > BigInt(bytes.byteLength) || length < 0) {
              throw new RangeError('byte range is outside the source')
            }
            return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length))
          },
        })
        const inspection = await (
          definition.inspect as (
            bytes: Uint8Array,
            context: InspectionContext,
          ) => Promise<InspectionResult>
        )(bytes, {
          budget,
          signal,
          intent,
          source: source as ArtifactByteSource,
          primary,
          byteSource,
          input,
        })
        const dataSources = new Map([
          ['common.view/byte-range-source', byteSource],
          ...Object.entries(inspection.dataSources ?? {}),
        ])
        if (inspection.text === true) {
          dataSources.set('common.view/text-data-source', createUtf8TextDataSource(byteSource))
        } else if (typeof inspection.text === 'string') {
          const textBytes = new TextEncoder().encode(inspection.text)
          const textByteSource = Object.freeze<ByteRangeSource>({
            async size() {
              return BigInt(textBytes.byteLength)
            },
            async read(offset, length, readSignal) {
              if (readSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
              if (offset < 0n || offset > BigInt(textBytes.byteLength) || length < 0)
                throw new RangeError('text byte range is outside the source')
              return textBytes.slice(
                Number(offset),
                Math.min(textBytes.byteLength, Number(offset) + length),
              )
            },
          })
          dataSources.set('common.view/text-data-source', createUtf8TextDataSource(textByteSource))
        }
        const descriptor = await assembleSubjectDescriptor({
          schemaVersion: 2,
          subjectUri: primary.source.uri,
          origin: originFrom(input, primary, inspection.companions),
          interpretation: 'codec',
          identity: {
            codecId: definition.id,
            codecVersion: definition.version ?? '1.0.0',
            formatId: definition.format.id,
            formatLabel: definition.format.label,
            ...(definition.format.mediaType === undefined
              ? {}
              : { mediaType: definition.format.mediaType }),
            confidence: detected.confidence,
            detection: [
              {
                kind: detected.kind ?? 'magic',
                weight: detected.confidence,
                ...(detected.note === undefined ? {} : { note: detected.note }),
              },
            ],
          },
          traits: inspection.traits.map(trait => ({
            id: trait.id,
            descriptorVersion: 1,
            state: 'available',
            ...(trait.parameters === undefined ? {} : { parameters: trait.parameters }),
          })),
          operations: inspectionOperations(operationDeclarations, inspection.operationStates),
          constraints: {
            // a codec with a mutating operation is not read-only (ADR-HOST-002 Path A)
            readOnly: !operationDeclarations.some(operation => operation.mutatesSource === true),
            seekable: true,
            randomAccess: true,
            trusted: false,
            maxDecodedBytes: String(inspection.maxDecodedBytes ?? bytes.byteLength),
            ...(inspection.unsupportedFeatures === undefined
              ? {}
              : { unsupportedFeatures: inspection.unsupportedFeatures }),
          },
          dataSources: [...dataSources.keys()].map(
            contract => ({ contract, major: 1 }) as DataSourceRefWire,
          ),
          diagnostics: inspection.diagnostics ?? [],
          metadata: descriptorMetadata(inspection),
          ...(inspection.companions === undefined ? {} : { companions: inspection.companions }),
          revision: input.revisions.revision,
        })
        const handlers = new Map<string, HostOperationHandler>([
          ['inspect', async () => ({ kind: 'json', value: inspection.summary })],
          ['validate', async () => ({ kind: 'none' })],
          ['export-raw', async () => ({ kind: 'bytes', value: bytes })],
          ...Object.entries(inspection.handlers ?? {}),
        ])
        return createAssetSession({
          revision: revisionId(input.revisions.revision),
          descriptor,
          operationDeclarations,
          permissionGrant: {
            id: `${definition.format.id}-inspection-session`,
            classes: declaredPermissionClasses(operationDeclarations),
          },
          handlers,
          async openDataSource<
            Contract extends KnownDataSourceId,
            Major extends DataSourceMajor<Contract>,
          >(contract: Contract) {
            const value = dataSources.get(contract)
            if (value === undefined)
              throw new TypeError(`${definition.id} does not publish ${contract}`)
            return simpleLease(value as DataSourceOf<Contract, Major>)
          },
          release: [() => sourceLease.release()],
        }).session
      } catch (error) {
        await sourceLease.release()
        throw error
      }
    },
  })
}

/** `read-source` plus every class the declared operations need (`write-source` for mutating ones). */
export function declaredPermissionClasses(
  operations: readonly OperationDecl[],
): readonly PermissionClass[] {
  const classes = new Set<PermissionClass>(['read-source'])
  for (const operation of operations) {
    for (const item of operation.requiredPermissions ?? []) classes.add(item)
    if (operation.mutatesSource === true) classes.add('write-source')
  }
  return Object.freeze([...classes].sort())
}

// ---------------------------------------------------------------------------------------------
// ADR-HOST-002 — editing helpers

/**
 * The subject's 13D revision vector, derived from the opened input with the host's own rule
 * (subject-open: canonical `{topology, bindingId, source, revision}`), so a plan built here and
 * the host's expectation agree byte for byte. Single-source subjects only.
 */
export function assetRevisionFromInput(input: AssetInput): AssetRevision {
  if (input.originKind !== 'single' || input.revisions.topology !== 'single') {
    throw new TypeError('assetRevisionFromInput: single-source subjects only')
  }
  const [binding] = input.bindings
  if (binding === undefined) throw new TypeError('assetRevisionFromInput: no binding')
  const revision = binding.revision
  return Object.freeze<AssetRevision>({
    bindings: Object.freeze({ [binding.bindingId]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: binding.bindingId,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision,
    }),
  })
}

/** Path A: the plan a mutating codec operation returns as `{ kind: 'edit-plan', plan }`. */
export function editPlanFromInput(
  input: AssetInput,
  { planId, edits, fidelity, guarantee = 'atomic', diagnostics = [] }: EditPlanFromInputOptions,
): AssetEditPlan {
  const revision = assetRevisionFromInput(input)
  const [binding] = (input as Extract<AssetInput, { originKind: 'single' }>).bindings as readonly [
    ResolvedAssetInputBinding,
    ...ResolvedAssetInputBinding[],
  ]
  const target = Object.freeze({
    targetId: binding.bindingId,
    subjectUri: binding.source.uri,
    ownerSource: Object.freeze({ id: binding.source.id, uri: binding.source.uri }),
    semanticPath: Object.freeze([]),
    expectedRevision: revision,
  })
  return Object.freeze<AssetEditPlan>({
    planId,
    targets: Object.freeze([target]),
    edits: Object.freeze(
      edits.map(edit =>
        Object.freeze({
          ...edit,
          targetId: edit.targetId ?? binding.bindingId,
          source: edit.source ?? target.ownerSource,
        }),
      ),
    ),
    semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics]),
  })
}

/** A byte-range `replace` edit (`length: 0` inserts) with an inline payload. */
export function replaceBytes(
  offset: number | bigint,
  length: number | bigint,
  bytes: Uint8Array,
  label?: string,
): Omit<Extract<SourceEdit, { operation: 'replace' }>, 'targetId' | 'source'> {
  return Object.freeze<Omit<Extract<SourceEdit, { operation: 'replace' }>, 'targetId' | 'source'>>({
    operation: 'replace',
    range: Object.freeze({ kind: 'bytes', offset: BigInt(offset), length: BigInt(length) }),
    payload: Object.freeze({ kind: 'inline', bytes }),
    ...(label === undefined ? {} : { label }),
  })
}

/**
 * Path B: a one-file writer provider module for `common.edit/writer@1`. `plan(change)` receives
 * the change set and must return an `AssetEditPlan` (`planEdits` may return just the edits —
 * targets, semantics and the claimed fidelity are filled in); `validate` defaults to "non-empty".
 */
export function defineWriter({
  providerId,
  providerVersion = '1.0.0',
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = 'mutate',
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits,
  plan,
}: DefineWriterOptions): WriterModule {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId,
  })
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip,
  })
  const writer = Object.freeze<Writer>({
    identity,
    offer,
    async validate(change, signal) {
      if (validate !== undefined) return validate(change, signal)
      return { valid: change.targets.length > 0 && change.edits.length > 0, diagnostics: [] }
    },
    async plan(change, signal) {
      if (plan !== undefined) return plan(change, signal)
      const edits = await (
        planEdits as (change: ChangeSet, signal?: AbortSignal) => Promise<readonly SourceEdit[]>
      )(change, signal)
      return Object.freeze({
        planId: `${providerId}:${change.targets.map(target => target.targetId).join('+')}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: 'atomic' }),
        fidelity,
        diagnostics: Object.freeze([]),
      })
    },
  })
  return Object.freeze<WriterModule>({
    abiVersion: 1,
    provides: Object.freeze(['common.edit/writer']),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`)
      return simpleLease(writer)
    },
  })
}
