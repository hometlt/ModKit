/**
 * Standard data-source method surfaces (NXT-103) — the data-only table that says how each
 * standard `common.view/*` data-source object is called across an execution boundary. It is the
 * single authority the host capability-RPC core (and any transport or application) derives
 * proxies from; nothing else keeps a method allowlist.
 *
 * Every entry is pinned to its ABI interface at compile time: `SurfaceOf<TextDataSource>` requires
 * exactly the interface's methods (optional ABI methods must carry `optional: true`), so adding a
 * method to an interface and forgetting the surface does not compile. Kinds mirror the ABI:
 * `Promise<X>` → `value`, `Promise<Capability>` → `lease`, `Promise<Lease<Data>>` →
 * `leased-value`, `AsyncIterable<X>` → `iterable` (pull) or `events` (live push).
 *
 * Deliberately no `limits` here: bounds are policy the owner sets per contract; the wire already
 * enforces the endpoint's global transfer/nesting limits.
 */

import { contractId, deepFreeze, type ContractIdLiteral } from '@modkitx-x3/core'
import type {
  DataSourceMethodSurfaceV1,
  DataSourceSurfaceRef,
  DataSourceSurfaceV1,
} from '../definitions.js'
import { STANDARD_DATA_SOURCE_CONTRACTS, type StandardDataSourceId } from './data-source-ids.js'
import type {
  ByteRangeSource,
  NamespaceEntrySource,
  RelationGraphSource,
  SlideDeckSource,
  SubjectFactsSource,
  TableDataSource,
  TextDataSource,
  TransportSource,
  TreeDataSource,
} from './data-sources.js'
import type {
  AudioMediaSource,
  EncodedMediaSource,
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

// ---------------------------------------------------------------------------------------------
// compile-time pin: a surface must name exactly the ABI's methods

type MethodKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? K : never
}[keyof T]
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T]
type RequiredMethodKeys<T> = Exclude<MethodKeys<T>, OptionalKeys<T>>
type OptionalMethodKeys<T> = Extract<MethodKeys<T>, OptionalKeys<T>>

/** The surface shape an ABI interface `T` demands: its methods, optional ones flagged. */
export interface SurfaceOf<T> {
  readonly methods: Readonly<
    Record<
      RequiredMethodKeys<T> & string,
      DataSourceMethodSurfaceV1 & { readonly optional?: false }
    >
  > &
    Readonly<
      Record<
        OptionalMethodKeys<T> & string,
        DataSourceMethodSurfaceV1 & { readonly optional: true }
      >
    >
  readonly releaseVia?: RequiredMethodKeys<T> & string
}

// ---------------------------------------------------------------------------------------------
// auxiliary surface: EncodedMediaSource is a capability object without a data-source contract

/**
 * `EncodedMediaSource` (returned by `encoded()` on raster/audio/video sources) is a capability
 * object, not a data-source contract of its own. It still needs a surface id so a `lease` can name
 * it; it lives with the standard table under this auxiliary id and is released by cascade from
 * its parent (it has no release method of its own).
 */
export const ENCODED_MEDIA_SURFACE_ID = 'common.view/encoded-media' as const
export type EncodedMediaSurfaceId = typeof ENCODED_MEDIA_SURFACE_ID

const ENCODED_MEDIA: DataSourceSurfaceRef = Object.freeze({
  contract: contractId(ENCODED_MEDIA_SURFACE_ID),
  major: 1,
})

const sig = { signal: 'last' } as const

const value = { kind: 'value' } as const
const cancellableValue = { kind: 'value', ...sig } as const
const iterable = { kind: 'iterable', ...sig } as const

const encodedMediaSurface = {
  methods: {
    descriptor: value,
    read: cancellableValue,
  },
} as const satisfies SurfaceOf<EncodedMediaSource>

// ---------------------------------------------------------------------------------------------
// the standard surfaces

const textDataSourceSurface = {
  methods: {
    info: value,
    slice: cancellableValue,
    search: iterable,
  },
} as const satisfies SurfaceOf<TextDataSource>

const byteRangeSourceSurface = {
  methods: {
    size: value,
    read: cancellableValue,
  },
} as const satisfies SurfaceOf<ByteRangeSource>

const treeDataSourceSurface = {
  methods: {
    root: value,
    children: cancellableValue,
    facts: value,
    search: iterable,
  },
} as const satisfies SurfaceOf<TreeDataSource>

const tableDataSourceSurface = {
  methods: {
    shape: value,
    rows: cancellableValue,
    cell: value,
    search: iterable,
  },
} as const satisfies SurfaceOf<TableDataSource>

const transportSourceSurface = {
  methods: {
    snapshot: cancellableValue,
    /** A live stream, not a finite listing: `subscribe` → `event…` → `done`. */
    events: { kind: 'events', ...sig },
  },
} as const satisfies SurfaceOf<TransportSource>

const namespaceEntrySourceSurface = {
  methods: {
    list: cancellableValue,
    search: { kind: 'value', optional: true, ...sig },
    /** `Lease<AssetSourceRef>`: the ref crosses by copy, the lease is a release-only handle. */
    openEntry: { kind: 'leased-value', ...sig },
  },
} as const satisfies SurfaceOf<NamespaceEntrySource>

const rasterImageSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: 'lease', result: ENCODED_MEDIA, wrapper: 'bare', ...sig },
    readRegion: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies SurfaceOf<RasterImageSource>

const vectorSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    document: cancellableValue,
  },
} as const satisfies SurfaceOf<VectorSceneSource>

const audioMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    /** `encoded(trackId?, signal?)`: `arity: 1` keeps the signal last when the track is omitted. */
    encoded: { kind: 'lease', result: ENCODED_MEDIA, wrapper: 'bare', arity: 1, ...sig },
    readPcm: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies SurfaceOf<AudioMediaSource>

const videoMediaSourceSurface = {
  methods: {
    info: cancellableValue,
    encoded: { kind: 'lease', result: ENCODED_MEDIA, wrapper: 'bare', ...sig },
    readFrame: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies SurfaceOf<VideoMediaSource>

const modelSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    nodes: cancellableValue,
    meshes: cancellableValue,
    primitive: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies SurfaceOf<ModelSceneSource>

const worldSceneSourceSurface = {
  methods: {
    info: cancellableValue,
    page: cancellableValue,
  },
} as const satisfies SurfaceOf<WorldSceneSource>

/**
 * The five optional model facets of slice 11C0. Candidate maturity changes nothing about the
 * wire: an `info` plus one paged reader, called exactly like every other source.
 */
const modelResourceRefsSourceSurface = {
  methods: {
    info: cancellableValue,
    references: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelResourceRefsSource>

const modelSkeletonSourceSurface = {
  methods: {
    info: cancellableValue,
    bindings: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelSkeletonSource>

const modelAnimationSourceSurface = {
  methods: {
    info: cancellableValue,
    clips: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelAnimationSource>

const modelCollisionSourceSurface = {
  methods: {
    info: cancellableValue,
    volumes: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelCollisionSource>

const modelMaterialSourceSurface = {
  methods: {
    info: cancellableValue,
    materials: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelMaterialSource>

const modelSocketSourceSurface = {
  methods: {
    info: cancellableValue,
    sockets: cancellableValue,
  },
} as const satisfies SurfaceOf<ModelSocketSource>

const relationGraphSourceSurface = {
  methods: {
    summary: cancellableValue,
    nodes: cancellableValue,
    edges: cancellableValue,
  },
} as const satisfies SurfaceOf<RelationGraphSource>

/** ADR-DOC-001. Candidate maturity changes nothing about the wire: it is called like the rest. */
const slideDeckSourceSurface = {
  methods: {
    info: cancellableValue,
    slides: cancellableValue,
  },
} as const satisfies SurfaceOf<SlideDeckSource>

const subjectFactsSourceSurface = {
  methods: {
    summary: cancellableValue,
    groups: cancellableValue,
    facts: cancellableValue,
    relations: cancellableValue,
  },
} as const satisfies SurfaceOf<SubjectFactsSource>

/** Method surfaces of the standard data-source contracts, all `major 1`. */
export const STANDARD_DATA_SOURCE_SURFACES: Readonly<
  Record<StandardDataSourceId, DataSourceSurfaceV1>
> = deepFreeze({
  'common.view/text-data-source': textDataSourceSurface,
  'common.view/byte-range-source': byteRangeSourceSurface,
  'common.view/tree-data-source': treeDataSourceSurface,
  'common.view/table-data-source': tableDataSourceSurface,
  'common.view/transport-source': transportSourceSurface,
  'common.view/namespace-entry-source': namespaceEntrySourceSurface,
  'common.view/raster-image-source': rasterImageSourceSurface,
  'common.view/vector-scene-source': vectorSceneSourceSurface,
  'common.view/audio-media-source': audioMediaSourceSurface,
  'common.view/video-media-source': videoMediaSourceSurface,
  'common.view/model-scene-source': modelSceneSourceSurface,
  'common.view/world-scene-source': worldSceneSourceSurface,
  'common.view/model-resource-refs-source': modelResourceRefsSourceSurface,
  'common.view/model-skeleton-source': modelSkeletonSourceSurface,
  'common.view/model-animation-source': modelAnimationSourceSurface,
  'common.view/model-collision-source': modelCollisionSourceSurface,
  'common.view/model-material-source': modelMaterialSourceSurface,
  'common.view/model-socket-source': modelSocketSourceSurface,
  'common.view/relation-graph-source': relationGraphSourceSurface,
  'common.view/subject-facts-source': subjectFactsSourceSurface,
  'common.view/slide-deck-source': slideDeckSourceSurface,
})

/** Auxiliary surfaces named by standard `lease` results but not data-source contracts themselves. */
export const AUXILIARY_DATA_SOURCE_SURFACES: Readonly<
  Record<EncodedMediaSurfaceId, DataSourceSurfaceV1>
> = deepFreeze({
  [ENCODED_MEDIA_SURFACE_ID]: encodedMediaSurface,
})

export type StandardSurfaceId = StandardDataSourceId | EncodedMediaSurfaceId

/**
 * Looks a standard or auxiliary surface up by wire coordinates. `undefined` for foreign
 * contracts: their surface comes from their own contract definition (`surface` field), never from
 * a host guess.
 */
export function standardDataSourceSurfaceFor(
  contract: string,
  major: number,
): DataSourceSurfaceV1 | undefined {
  if (major !== 1) return undefined
  if ((STANDARD_DATA_SOURCE_CONTRACTS as readonly string[]).includes(contract)) {
    return STANDARD_DATA_SOURCE_SURFACES[contract as StandardDataSourceId]
  }
  if (contract === ENCODED_MEDIA_SURFACE_ID) return AUXILIARY_DATA_SOURCE_SURFACES[contract]
  return undefined
}

/** Branded id of the auxiliary surface, for callers that build `DataSourceSurfaceRef`s. */
export const ENCODED_MEDIA_SURFACE_CONTRACT: ContractIdLiteral<EncodedMediaSurfaceId> =
  contractId(ENCODED_MEDIA_SURFACE_ID)
