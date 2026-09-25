import { pageStart } from './paging.js'
import { deferAssetSession } from './deferred-session.js'
import { PROJECTION_RECEIPT_METADATA_ID } from './projection.js'
import type { SourceSpan } from '@modkit/core'
export {
  snapshotModelSkeleton,
  createModelSkeletonNodes,
  createModelPoseSampler,
} from './model/skeleton.js'
export type { ModelBonePoseSample } from './model/skeleton.js'
export { snapshotModelAnimations, createModelAnimationSampler } from './model/animation.js'
export type { ModelAnimationValue } from './model/animation.js'
export { modelPrimitiveByteLength } from './model/geometry.js'
import { contributionSettingsFor } from '@modkit/sdk'
import type { ArtifactSource, DataSourceRefWire } from '@modkit/sdk'
import type {
  TransportEvent,
  ProbePlan,
  AssetOriginDescriptorWire,
  DataSourceOf,
  KnownDataSourceId,
  DataSourceMajor,
  FieldEditable,
  FieldType,
  ValueSpan,
  Writer,
} from '@modkit/sdk'
import type { HostOperationHandler } from '@modkit/host/codec'

import type {
  ArtifactByteSource,
  AssetInputPlan,
  AssetNamespace,
  AssetEditPlan,
  AssetInput,
  ChangeSet,
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
  /** Stable root or nested-subject address for generic host navigation. */
  readonly subjectId?: string
  readonly semanticPath?: readonly string[]
  readonly children?: readonly InspectionTreeNode[]
  /**
   * Typed value for this node, passed through to `TreeNodeFacts` untouched.
   *
   * `preview` is prose and cannot carry a type, so a surface reading it can only ever render text.
   * A codec that knows its node holds a bounded integer says so here, and gets the right control
   * instead of a text box. Publishing nothing keeps the read-only rendering a codec has today.
   */
  readonly value?: JsonValue
  readonly type?: FieldType
  readonly unit?: string
  readonly editable?: FieldEditable
  /** Syntax runs over the displayed value, when the codec knows the grammar of what it holds. */
  readonly spans?: readonly ValueSpan[]
}

export interface InspectionTrait {
  readonly id: string
  readonly parameters?: JsonValue
}

export interface InspectionContext {
  /**
   * The host's settings for this contribution, already narrowed to the source being opened.
   * Empty when the host configured none; a codec supplies its own default for a missing key.
   */
  readonly settings: Readonly<Record<string, unknown>>
  /** Host-provided capability resolver; codecs never construct a provider inventory. */
  readonly contracts?: ContributionContext['contracts']
  readonly rasterResources?: ContributionContext['rasterResources']
  readonly modelResources?: ContributionContext['modelResources']
  readonly logicalResources?: ContributionContext['logicalResources']
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

/**
 * S3 DRAFT — not yet consumed by `createInspectionCodec`. How one container entry's bytes are stored,
 * so the host, not every codec, can list, extract and open it. `offset`/`length` are absolute byte
 * positions in the container source. For the decoding kinds the host inflates with the one owner in
 * `codec-kit/compression`, bounded by the entry's decoded `size`. `custom` is for what no shared
 * decoder covers (Halo ERA `decryptRange`, a proprietary codec): the format opens the entry itself.
 */
export type ContainerEntryStorage =
  | { readonly kind: 'stored'; readonly offset: bigint; readonly length: bigint }
  | {
      readonly kind: 'deflate' | 'zlib' | 'gzip' | 'zstd' | 'lz4-block' | 'refpack'
      readonly offset: bigint
      readonly compressedLength: bigint
    }
  | {
      readonly kind: 'custom'
      /** A range source of the decoded entry, or its decoded bytes as a stream (read once). */
      open(signal?: AbortSignal): Promise<ByteRangeSource | AsyncIterable<Uint8Array>>
    }

/**
 * S3 DRAFT. One entry of a container: what the codec's `index → entries` function returns. The
 * host derives the entry's id, name and revision (`containerEntryRevision(container, path, size)`).
 */
export interface ContainerEntry {
  /** `/`-separated, relative, no empty, `.` or `..` segment; unique under `caseSensitivity`. */
  readonly path: string
  /** Decoded size — what extraction produces and what the host bounds decoding by. */
  readonly size: bigint
  readonly storage: ContainerEntryStorage
  readonly modifiedAt?: number
  readonly checksum?: { readonly algorithm: string; readonly value: string }
}

/**
 * S3 DRAFT. A range-access container's entry table, returned from `inspect` as `containerEntries`.
 * From it the host will build, with no code in the codec: `namespace-entry-source` (paged, with a
 * cursor, `batchItems` across the worker boundary), `container.extract` for entries within budget,
 * a leased entry source for `openNestedSubject` without materialising it (a range of the container
 * for `stored`, a bounded decoding stream otherwise), chunked `subject.extract --out`, and the
 * `maxDecodedBytes` guard. A codec keeps only `detect`, reading its index by ranges, and mapping
 * each record to an entry.
 */
export interface ContainerEntryTable {
  readonly entries: readonly ContainerEntry[]
  readonly caseSensitivity: 'sensitive' | 'insensitive'
  /** False when the index was cut short (budget, damage); `diagnostics` say why. */
  readonly complete: boolean
  readonly diagnostics?: readonly AssetDiagnostic[]
}

export interface InspectionResult {
  /** S3 DRAFT — only for `access: 'ranges'`; ignored until the host builds on it. */
  readonly containerEntries?: ContainerEntryTable
  readonly summary: JsonValue
  readonly metadata: readonly MetadataGroup[]
  readonly traits: readonly InspectionTrait[]
  /** `true` publishes the raw source; a string publishes decoded UTF-8 text. */
  readonly text?: boolean | string
  readonly dataSources?: Readonly<Record<string, unknown>>
  readonly handlers?: Readonly<Record<string, HostOperationHandler>>
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
  /**
   * The host's settings for this contribution, already narrowed to the source being opened.
   * Empty when the host configured none; a codec supplies its own default for a missing key.
   */
  readonly settings: Readonly<Record<string, unknown>>
  readonly contracts?: ContributionContext['contracts']
  readonly rasterResources?: ContributionContext['rasterResources']
  readonly modelResources?: ContributionContext['modelResources']
  readonly logicalResources?: ContributionContext['logicalResources']
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
  /** Inspect once on first session access, after the host binds post-open resource capabilities. */
  readonly deferInspection?: boolean
  readonly id: string
  readonly version?: string
  readonly format: {
    readonly id: string
    readonly label: string
    readonly mediaType?: string
  }
  readonly operations?: readonly OperationDecl[]
  readonly namespace?: never
  /** `bytes` (the default): the whole source is read into memory within `budget.maxInputBytes`. */
  readonly access?: 'bytes'
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

/**
 * An inspection codec for a source too large to hold in memory — a container or archive of any
 * size, offsets past 4 GiB included. `detect` gets the first bytes (at most 64 KiB); `inspect` never
 * receives the file and reads what it needs through `context.byteSource`, one range at a time. A
 * read starting past the end of the source or longer than `budget.maxInputBytes` is refused; one
 * that runs past the end is cut there. `export.raw` is not published: it would hold the source.
 */
export interface RangeInspectionCodecDefinition extends Omit<
  InspectionCodecDefinition,
  'access' | 'inspect'
> {
  readonly access: 'ranges'
  inspect(context: InspectionContext): Promise<InspectionResult>
}

export interface NamespaceInspectionCodecDefinition {
  readonly deferInspection?: boolean
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
  readonly access?: never
  readonly detect?: never
  readonly inspect?: never
}

export interface TransportController extends TransportSource {
  control(
    kind: 'playPause' | 'seek' | 'setRate' | 'selectTrack',
    input?: Record<string, unknown>,
  ): void
}

export interface TransportSourceOptions {
  /** Advance position from elapsed wall time while playing and at least one event consumer exists. */
  readonly wallClock?: boolean
  readonly updateIntervalMs?: number
}

export {
  assetRevisionFromInput,
  editPlanFromInput,
  editPlanFromBinding,
  replaceBytes,
  type EditPlanFromInputOptions,
} from './editing.js'
export { applyJsonEdit, type JsonEdit } from './json-edit.js'
export { isJsonSerializable } from './json.js'
export { getLogger, installLoggerFactory } from './logging.js'

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

import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkit/host/codec'
import { revisionId, toPortableProjectionReceipt } from '@modkit/sdk/codec'

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
        ...(value.subjectId === undefined ? {} : { subjectId: value.subjectId }),
        ...(value.semanticPath === undefined
          ? {}
          : { semanticPath: Object.freeze([...value.semanticPath]) }),
        ...(value.value === undefined ? {} : { value: value.value }),
        ...(value.type === undefined ? {} : { type: value.type }),
        ...(value.unit === undefined ? {} : { unit: value.unit }),
        ...(value.editable === undefined ? {} : { editable: value.editable }),
        ...(value.spans === undefined ? {} : { spans: value.spans }),
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

export function createTransportSource(
  snapshot: TransportSnapshot,
  options: TransportSourceOptions = {},
): TransportController {
  const updateIntervalMs = options.updateIntervalMs ?? 50
  if (!Number.isSafeInteger(updateIntervalMs) || updateIntervalMs <= 0) {
    throw new RangeError('transport updateIntervalMs must be a positive safe integer')
  }
  let current = {
    ...snapshot,
    tracks: snapshot.tracks.map(track => ({ ...track })),
    controls: { ...snapshot.controls },
  }
  const listeners = new Set<(event: TransportEvent) => void>()
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  let previousTick = 0
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
  const stopClock = () => {
    if (timer !== undefined) globalThis.clearInterval(timer)
    timer = undefined
  }
  const startClock = () => {
    if (
      options.wallClock !== true ||
      timer !== undefined ||
      current.state !== 'playing' ||
      listeners.size === 0 ||
      typeof current.durationMs !== 'number'
    )
      return
    previousTick = Date.now()
    timer = globalThis.setInterval(() => {
      const now = Date.now()
      const elapsed = now - previousTick
      previousTick = now
      const positionMs = Math.min(
        current.durationMs as number,
        current.positionMs + elapsed * current.rate,
      )
      current = {
        ...current,
        positionMs,
        state: positionMs >= (current.durationMs as number) ? 'ended' : current.state,
      }
      publish()
      if (current.state === 'ended') stopClock()
    }, updateIntervalMs)
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
      startClock()
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
        if (listeners.size === 0) stopClock()
        signal?.removeEventListener('abort', abort)
      }
    },
    control(kind, input = {}) {
      if (kind === 'playPause') {
        current = {
          ...current,
          positionMs: current.state === 'ended' ? 0 : current.positionMs,
          state: current.state === 'playing' ? 'paused' : 'playing',
        }
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
      if (current.state === 'playing') startClock()
      else stopClock()
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

export {
  createModelSceneSource,
  createModelResourceRefsSource,
  createModelSkeletonSource,
  createModelAnimationSource,
  createModelCollisionSource,
  createModelMaterialSource,
  createModelCameraSource,
  createModelEffectSource,
  createModelLightSource,
  createModelNodeBehaviourSource,
  createModelPhysicsSource,
  createModelSocketSource,
} from './model/sources.js'

// ProjectionReceipt — the native → live boundary (§2.6, block 12 item 5)

export { PROJECTION_RECEIPT_METADATA_ID, createProjectionReceipt } from './projection.js'

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
        ...(operation.inputSchema === undefined ? {} : { inputSchema: operation.inputSchema }),
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

/** What a byte-mode codec reads: the source already held in memory. */
function memoryByteSource(bytes: Uint8Array): ByteRangeSource {
  return Object.freeze<ByteRangeSource>({
    size: async () => BigInt(bytes.byteLength),
    async read(offset, length, readSignal) {
      if (readSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (offset < 0n || offset > BigInt(bytes.byteLength) || length < 0) {
        throw new RangeError('byte range is outside the source')
      }
      return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length))
    },
  })
}

/** The first bytes a range-mode codec's `detect` sees when a session opens. */
const RANGE_DETECT_PREFIX_BYTES = 64 * 1024
/** One `ArtifactByteSource.read` at most — well inside a worker RPC frame. */
const RANGE_READ_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * What a range-mode codec reads: the opened source itself, one bounded range at a time. Memory
 * follows the ranges asked for, never the size of the source.
 */
function rangeByteSource(source: ArtifactSource, budget: ResourceBudget): ByteRangeSource {
  if (source.kind !== 'bytes' || source.size === undefined) {
    throw new TypeError('range inspection codecs require a sized byte source')
  }
  const size = source.size
  const maximum = BigInt(budget.maxInputBytes)
  return Object.freeze<ByteRangeSource>({
    size: async () => size,
    async read(offset, length, readSignal) {
      if (readSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (
        typeof offset !== 'bigint' ||
        offset < 0n ||
        offset > size ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        throw new RangeError('byte range is outside the source')
      }
      if (BigInt(length) > maximum) {
        throw new RangeError('byte range exceeds the inspection budget')
      }
      const end = offset + BigInt(length) < size ? offset + BigInt(length) : size
      const result = new Uint8Array(Number(end - offset))
      let filled = 0
      while (filled < result.byteLength) {
        if (readSignal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
        const wanted = Math.min(RANGE_READ_CHUNK_BYTES, result.byteLength - filled)
        const chunk = await source.read(offset + BigInt(filled), wanted, readSignal)
        if (chunk.byteLength === 0) throw new RangeError('source ended before its declared size')
        const taken = Math.min(chunk.byteLength, wanted)
        result.set(chunk.subarray(0, taken), filled)
        filled += taken
      }
      return result
    },
  })
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
  definition:
    InspectionCodecDefinition | RangeInspectionCodecDefinition | NamespaceInspectionCodecDefinition,
  contributionContext?: ContributionContext,
): Codec {
  if (definition.deferInspection === true) {
    const codec = createInspectionCodec(
      { ...definition, deferInspection: false },
      contributionContext,
    )
    return Object.freeze<Codec>({
      ...codec,
      async open(input, intent, budget, signal) {
        signal?.throwIfAborted()
        const ownedBudget = Object.freeze({ ...budget })
        return deferAssetSession(
          revisionId(input.revisions.revision),
          initializeSignal => codec.open(input, intent, ownedBudget, initializeSignal),
          ownedBudget,
          signal,
        )
      },
    })
  }
  const namespaceDefinition = definition.namespace
  const rangeDefinition = definition.access === 'ranges' ? definition : undefined
  const customOperations = Object.freeze([...(definition.operations ?? [])])
  // `export.raw` hands out the whole source: a namespace has none, a range codec never holds it.
  const sharedOperations =
    namespaceDefinition === undefined && rangeDefinition === undefined
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
            ...(contributionContext === undefined
              ? {}
              : {
                  contracts: contributionContext.contracts,
                  ...(contributionContext.modelResources === undefined
                    ? {}
                    : { modelResources: contributionContext.modelResources }),
                  ...(contributionContext.rasterResources === undefined
                    ? {}
                    : { rasterResources: contributionContext.rasterResources }),
                  ...(contributionContext.logicalResources === undefined
                    ? {}
                    : { logicalResources: contributionContext.logicalResources }),
                }),
            budget,
            signal,
            intent,
            settings: contributionSettingsFor(contributionContext?.settings, input.root.uri),
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
            maxOperationDiagnostics: budget.maxDiagnostics,
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
        // A range codec never holds the source: no `readAll`, so no size ceiling on the file.
        const bytes =
          rangeDefinition === undefined ? await readAll(source, budget, signal) : undefined
        const byteSource =
          bytes === undefined ? rangeByteSource(source, budget) : memoryByteSource(bytes)
        const sourceSize = await byteSource.size()
        const readable =
          BigInt(budget.maxInputBytes) < sourceSize ? BigInt(budget.maxInputBytes) : sourceSize
        const prefix =
          bytes ??
          (await byteSource.read(0n, Math.min(RANGE_DETECT_PREFIX_BYTES, Number(readable)), signal))
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
        )(prefix, primary.source.uri)
        const inspectionContext: InspectionContext = {
          ...(contributionContext === undefined
            ? {}
            : {
                contracts: contributionContext.contracts,
                ...(contributionContext.modelResources === undefined
                  ? {}
                  : { modelResources: contributionContext.modelResources }),
                ...(contributionContext.rasterResources === undefined
                  ? {}
                  : { rasterResources: contributionContext.rasterResources }),
                ...(contributionContext.logicalResources === undefined
                  ? {}
                  : { logicalResources: contributionContext.logicalResources }),
              }),
          budget,
          signal,
          intent,
          settings: contributionSettingsFor(contributionContext?.settings, primary.source.uri),
          source: source as ArtifactByteSource,
          primary,
          byteSource,
          input,
        }
        const inspection =
          rangeDefinition !== undefined
            ? await rangeDefinition.inspect(inspectionContext)
            : await (
                definition.inspect as (
                  bytes: Uint8Array,
                  context: InspectionContext,
                ) => Promise<InspectionResult>
              )(bytes as Uint8Array, inspectionContext)
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
            maxDecodedBytes: String(inspection.maxDecodedBytes ?? sourceSize),
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
          ...(bytes === undefined
            ? []
            : [
                ['export-raw', async () => ({ kind: 'bytes', value: bytes }) as const] satisfies [
                  string,
                  HostOperationHandler,
                ],
              ]),
          ...Object.entries(inspection.handlers ?? {}),
        ])
        return createAssetSession({
          maxOperationDiagnostics: budget.maxDiagnostics,
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

export {
  scanXml,
  getAttr,
  elementPathAt,
  attrAt,
  decodeXmlEntities,
  encodeXmlText,
  encodeXmlAttribute,
  type ScannedAttr,
  type ScannedElement,
} from './xml-scan.js'

export {
  createReferenceIndex,
  type ReferenceIndex,
  type ReferenceIndexOptions,
  type ReferenceIndexSnapshot,
} from './reference-index.js'

export {
  analyzeGraphIsolation,
  type GraphIsolationAnalysis,
  type GraphIsolationEdge,
  type GraphIsolationReferrer,
  type GraphIsolationRequest,
} from './graph-isolation.js'

export {
  createSubjectFactsSource,
  createRelationGraphSource,
  fact,
  pageOf,
  parseSubjectId,
  provenanceOf,
  subjectFieldGroup,
  subjectIdFor,
  type RelationGraphSourceOptions,
  type SubjectFactGroupInput,
  type SubjectFactsSourceOptions,
  type SubjectFieldInput,
} from './subject-facts.js'

export {
  createTableDataSource,
  type TableColumn,
  type TableDataSourceOptions,
} from './table-source.js'
export { snapshotJson, type JsonSnapshotBudget, type JsonSnapshotOptions } from './json-snapshot.js'
