/**
 * Host-internal capability surfaces for the runtime ABI objects that cross an execution boundary
 * (NXT-105 R2): the codec module and codec, asset/operation sessions, and the host-side objects a
 * worker calls back into (artifact sources, namespaces, asset inputs, the diagnostic sink and the
 * contract resolver). These are not data-source contracts and not public data — they are pinned
 * to the runtime-ABI interfaces in `@modkit/sdk` at compile time (`AbiSurfaceOf<T>`) so an ABI
 * change that forgets its surface does not compile.
 *
 * Objects that mix data and methods (`AssetSession.revision`, `ArtifactByteSource.size`, an
 * `AssetInput`'s bindings) declare their data as `fields`: the executing side copies them with the
 * handle, the consuming side exposes them as read-only properties next to the proxied methods.
 * Sync ABI methods that only derive from those fields (`AssetInput.bindingsFor`,
 * `DerivedAssetInput.subjectsFor`) are not proxied — a worker bootstrap computes them locally.
 *
 * Signals and progress callbacks that the ABI puts *inside* request/options objects
 * (`ParseRequest.signal`, `OperationSession.invoke(…, { signal, onProgress })`) are declared as
 * placements (`signal: { arg, key }`, `progress: { arg, key }`): the consumer lifts them out before
 * sending, the executor re-creates them on its side. `ContributionContext.contracts` resolves the
 * leased provider's surface from the request (`resultFromArgs` on `{ arg: 0, key }`), so a codec in
 * a worker can call `contracts.resolve({ contract, major })` and get a proxied provider whose
 * surface comes from that contract's definition.
 */

import type {
  ModelResourcePort,
  ModelResourceAsset,
  ArtifactByteSource,
  ArtifactNamespaceSource,
  AssetNamespace,
  AssetSession,
  Codec,
  CodecModule,
  ContractResolverPort,
  DiagnosticSink,
  DerivedAssetInput,
  NamespaceAssetInput,
  OperationSession,
  RasterResourcePort,
  InstallationProbes,
  VideoFrameDecoder,
  ServiceProviderModule,
  SingleAssetInput,
} from '@modkit/sdk'
import type { CapabilitySurface, MethodSurface } from './surface.js'
import type { WireLogicalResourcePort, WireLogicalResourceResolution } from './logical-resources.js'

// ---------------------------------------------------------------------------------------------
// compile-time pin against the runtime ABI

type MethodKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? K : never
}[keyof T]
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T]
type RequiredMethodKeys<T> = Exclude<MethodKeys<T>, OptionalKeys<T>>
type OptionalMethodKeys<T> = Extract<MethodKeys<T>, OptionalKeys<T>>
type FieldKeys<T> = Exclude<keyof T, MethodKeys<T>> & string

/**
 * The surface an ABI interface `T` demands: every method (optional ones flagged), and only its
 * data properties as `fields`. `Omit` selects sync helpers that are derived locally instead.
 */
interface AbiSurfaceOf<T> {
  readonly contract: string
  readonly major: number
  readonly methods: Readonly<
    Record<RequiredMethodKeys<T> & string, MethodSurface & { readonly optional?: false }>
  > &
    Readonly<Record<OptionalMethodKeys<T> & string, MethodSurface & { readonly optional: true }>>
  readonly fields?: readonly FieldKeys<T>[]
  readonly releaseVia?: RequiredMethodKeys<T> & string
}

// ---------------------------------------------------------------------------------------------
// surface ids

export const ABI_CODEC_MODULE = { contract: 'x3.abi/codec-module', major: 1 } as const
/** Root of a `ServiceProviderModule` (ABI v1): providers are leased by the contract they serve. */
export const ABI_SERVICE_PROVIDER_MODULE = {
  contract: 'x3.abi/service-provider-module',
  major: 1,
} as const
export const ABI_CODEC = { contract: 'x3.abi/codec', major: 1 } as const
export const ABI_ASSET_SESSION = { contract: 'x3.abi/asset-session', major: 1 } as const
export const ABI_OPERATION_SESSION = { contract: 'x3.abi/operation-session', major: 1 } as const
/** Union surface for `ArtifactSource` (`bytes` | `namespace`): consumers read `kind` first. */
export const ABI_ARTIFACT_SOURCE = { contract: 'x3.abi/artifact-source', major: 1 } as const
export const ABI_ASSET_NAMESPACE = { contract: 'x3.abi/asset-namespace', major: 1 } as const
/** Union surface for `AssetInput` topologies: consumers read `originKind` first. */
export const ABI_ASSET_INPUT = { contract: 'x3.abi/asset-input', major: 1 } as const
export const ABI_DIAGNOSTIC_SINK = { contract: 'x3.abi/diagnostic-sink', major: 1 } as const
/** `ContributionContext.contracts`: the leased provider's surface is named by the request itself. */
export const ABI_CONTRACT_RESOLVER = { contract: 'x3.abi/contract-resolver', major: 1 } as const
export const ABI_RASTER_RESOURCES = { contract: 'x3.abi/raster-resources', major: 1 } as const
export const ABI_MODEL_RESOURCES = { contract: 'x3.abi/model-resources', major: 1 } as const
/** `ContributionContext.installationProbes`: read-only platform install probes of a desktop host. */
export const ABI_INSTALLATION_PROBES = { contract: 'x3.abi/installation-probes', major: 1 } as const
/** `ContributionContext.videoFrames`: one decoded video frame from a desktop host. */
export const ABI_VIDEO_FRAMES = { contract: 'x3.abi/video-frames', major: 1 } as const
export const ABI_MODEL_RESOURCE_ASSET = {
  contract: 'x3.abi/model-resource-asset',
  major: 1,
} as const
export const ABI_LOGICAL_RESOURCES = { contract: 'x3.abi/logical-resources', major: 1 } as const
export const ABI_LOGICAL_RESOURCE_RESOLUTION = {
  contract: 'x3.abi/logical-resource-resolution',
  major: 1,
} as const

const sig = { signal: 'last' } as const

// ---------------------------------------------------------------------------------------------
// module → codec → session

const codecModuleSurface = {
  ...ABI_CODEC_MODULE,
  fields: ['abiVersion'],
  methods: {
    /** `createCodec(context)` — the backend marshals `context` (budgets copied, ports as refs). */
    createCodec: { kind: 'lease', result: ABI_CODEC, wrapper: 'bare' },
  },
} as const satisfies AbiSurfaceOf<CodecModule>

const serviceProviderModuleSurface = {
  ...ABI_SERVICE_PROVIDER_MODULE,
  fields: ['abiVersion', 'provides'],
  methods: {
    /**
     * `createProvider(selection, context)` — the leased provider's surface is the one the
     * selection names (its contract definition's `surface`); `context` is marshalled like
     * `createCodec`'s. Returns a `Lease`: releasing the handle releases the provider.
     */
    createProvider: {
      kind: 'lease',
      wrapper: 'lease',
      resultFromArgs: { contract: { arg: 0, key: 'contract' }, major: { arg: 0, key: 'major' } },
    },
  },
} as const satisfies AbiSurfaceOf<ServiceProviderModule>

const codecSurface = {
  ...ABI_CODEC,
  methods: {
    probe: { kind: 'value', ...sig },
    planInput: { kind: 'value', optional: true, ...sig },
    open: { kind: 'lease', result: ABI_ASSET_SESSION, wrapper: 'bare', ...sig },
  },
} as const satisfies AbiSurfaceOf<Codec>

const assetSessionSurface = {
  ...ABI_ASSET_SESSION,
  fields: ['revision'],
  releaseVia: 'dispose',
  methods: {
    state: { kind: 'value' },
    descriptor: { kind: 'value' },
    /** `dataSource(contract, major)` — the leased surface is named by the arguments. */
    dataSource: {
      kind: 'lease',
      resultFromArgs: { contract: 0, major: 1 },
      wrapper: 'lease',
    },
    operations: { kind: 'lease', result: ABI_OPERATION_SESSION, wrapper: 'bare' },
    events: { kind: 'events', ...sig },
    dispose: { kind: 'value' },
  },
} as const satisfies AbiSurfaceOf<AssetSession>

const operationSessionSurface = {
  ...ABI_OPERATION_SESSION,
  releaseVia: 'dispose',
  methods: {
    invoke: {
      kind: 'value',
      signal: { arg: 2, key: 'signal' },
      progress: { arg: 2, key: 'onProgress' },
    },
    dispose: { kind: 'value' },
  },
} as const satisfies AbiSurfaceOf<OperationSession>

// ---------------------------------------------------------------------------------------------
// host-side objects a worker calls back into

const artifactSourceSurface = {
  ...ABI_ARTIFACT_SOURCE,
  fields: ['ref', 'revision', 'kind', 'size'],
  methods: {
    read: { kind: 'value', optional: true, ...sig },
    stream: { kind: 'iterable', optional: true, ...sig },
    openNamespace: {
      kind: 'lease',
      result: ABI_ASSET_NAMESPACE,
      wrapper: 'lease',
      optional: true,
      ...sig,
    },
  },
} as const satisfies AbiSurfaceOf<Partial<ArtifactByteSource & ArtifactNamespaceSource>>

const assetNamespaceSurface = {
  ...ABI_ASSET_NAMESPACE,
  methods: {
    list: { kind: 'iterable', batchItems: 512, ...sig },
    readPreamble: { kind: 'value', optional: true, ...sig },
    open: { kind: 'lease', result: ABI_ARTIFACT_SOURCE, wrapper: 'lease', ...sig },
  },
} as const satisfies AbiSurfaceOf<AssetNamespace>

/**
 * The topology union collapses to `never` when intersected (conflicting `originKind` literals),
 * so the pin is assembled from its members: the namespace variant's methods and data, the physical
 * variants' `primaryBindingId`, and `originKind` widened to the union's discriminant.
 */
type AssetInputPin = Partial<
  Omit<NamespaceAssetInput, 'bindingsFor' | 'originKind'> &
    Pick<SingleAssetInput, 'primaryBindingId'> &
    Omit<
      Extract<DerivedAssetInput, { openMaterialized: unknown }>,
      'subjectsFor' | 'bindingsFor' | 'originKind' | 'revisions'
    > & { readonly originKind: string }
>

/**
 * `AssetInput` as the worker sees it: topology data as fields, the host-executed openers as
 * methods (all optional across the topology union). `bindingsFor`/`subjectsFor` are derived
 * locally from the copied data by the worker bootstrap.
 */
const assetInputSurface = {
  ...ABI_ASSET_INPUT,
  // topology data as fields: physical bindings, the namespace/derived discriminants, the derived
  // subject list and its optional materialized requirement/recipe
  fields: [
    'originKind',
    'root',
    'bindings',
    'revisions',
    'primaryBindingId',
    'subjects',
    'recipe',
    'materialized',
  ],
  methods: {
    openBinding: {
      kind: 'lease',
      result: ABI_ARTIFACT_SOURCE,
      wrapper: 'lease',
      optional: true,
      ...sig,
    },
    openNamespace: {
      kind: 'lease',
      result: ABI_ASSET_NAMESPACE,
      wrapper: 'lease',
      optional: true,
      ...sig,
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: 'lease',
      result: ABI_ASSET_SESSION,
      wrapper: 'lease',
      optional: true,
      ...sig,
    },
    openMaterialized: {
      kind: 'lease',
      result: ABI_ARTIFACT_SOURCE,
      wrapper: 'lease',
      optional: true,
      ...sig,
    },
  },
} as const satisfies AbiSurfaceOf<AssetInputPin>

const contractResolverSurface = {
  ...ABI_CONTRACT_RESOLVER,
  methods: {
    resolve: {
      kind: 'lease',
      wrapper: 'lease',
      resultFromArgs: { contract: { arg: 0, key: 'contract' }, major: { arg: 0, key: 'major' } },
      signal: { arg: 0, key: 'signal' },
    },
    resolveUnknown: {
      kind: 'lease',
      wrapper: 'lease',
      resultFromArgs: { contract: { arg: 0, key: 'contract' }, major: { arg: 0, key: 'major' } },
      signal: { arg: 0, key: 'signal' },
    },
  },
} as const satisfies AbiSurfaceOf<ContractResolverPort>

const diagnosticSinkSurface = {
  ...ABI_DIAGNOSTIC_SINK,
  methods: {
    report: { kind: 'value' },
  },
} as const satisfies AbiSurfaceOf<DiagnosticSink>

const rasterResourcesSurface = {
  ...ABI_RASTER_RESOURCES,
  methods: { read: { kind: 'value', ...sig } },
} as const satisfies AbiSurfaceOf<RasterResourcePort>

const installationProbesSurface = {
  ...ABI_INSTALLATION_PROBES,
  methods: {
    registryValues: { kind: 'value', ...sig },
    steamAppDir: { kind: 'value', ...sig },
    epicInstallLocation: { kind: 'value', ...sig },
    gogInstallPath: { kind: 'value', ...sig },
    storePackageLocation: { kind: 'value', ...sig },
    knownFolder: { kind: 'value', ...sig },
  },
} as const satisfies AbiSurfaceOf<InstallationProbes>

const videoFramesSurface = {
  ...ABI_VIDEO_FRAMES,
  methods: { decodeFrame: { kind: 'value', signal: { arg: 0, key: 'signal' } } },
} as const satisfies AbiSurfaceOf<VideoFrameDecoder>

const modelAcquire = {
  kind: 'lease',
  result: ABI_MODEL_RESOURCE_ASSET,
  wrapper: 'lease',
  ...sig,
} as const
const modelResourcesSurface = {
  ...ABI_MODEL_RESOURCES,
  methods: { acquire: modelAcquire },
} as const satisfies AbiSurfaceOf<ModelResourcePort>
const modelResourceAssetSurface = {
  ...ABI_MODEL_RESOURCE_ASSET,
  fields: ['result'],
  methods: {
    acquire: modelAcquire,
    readRaster: { kind: 'value', ...sig },
    sceneInfo: { kind: 'value', optional: true, ...sig },
    nodes: { kind: 'value', optional: true, ...sig },
    meshes: { kind: 'value', optional: true, ...sig },
    primitive: { kind: 'value', optional: true, ...sig },
    skeletonBindings: { kind: 'value', optional: true, ...sig },
    animationClips: { kind: 'value', optional: true, ...sig },
    materials: { kind: 'value', optional: true, ...sig },
    resourceReferences: { kind: 'value', optional: true, ...sig },
    sockets: { kind: 'value', optional: true, ...sig },
  },
} as const satisfies AbiSurfaceOf<ModelResourceAsset>

const logicalResourcesSurface = {
  ...ABI_LOGICAL_RESOURCES,
  methods: {
    discover: { kind: 'value', ...sig },
    readBatch: { kind: 'value', ...sig },
    resolve: { kind: 'lease', result: ABI_LOGICAL_RESOURCE_RESOLUTION, wrapper: 'lease', ...sig },
    provenance: { kind: 'value', ...sig },
    identity: { kind: 'value', ...sig },
  },
} as const satisfies AbiSurfaceOf<WireLogicalResourcePort>

const logicalResourceResolutionSurface = {
  ...ABI_LOGICAL_RESOURCE_RESOLUTION,
  fields: ['result'],
  methods: { openSource: { kind: 'lease', result: ABI_ARTIFACT_SOURCE, wrapper: 'lease', ...sig } },
} as const satisfies AbiSurfaceOf<WireLogicalResourceResolution>

/** Every runtime-ABI surface a host endpoint registers next to the data-source surfaces. */
export const RUNTIME_ABI_SURFACES: readonly CapabilitySurface[] = Object.freeze([
  codecModuleSurface,
  serviceProviderModuleSurface,
  codecSurface,
  assetSessionSurface,
  operationSessionSurface,
  artifactSourceSurface,
  assetNamespaceSurface,
  assetInputSurface,
  diagnosticSinkSurface,
  contractResolverSurface,
  rasterResourcesSurface,
  installationProbesSurface,
  videoFramesSurface,
  modelResourcesSurface,
  modelResourceAssetSurface,
  logicalResourcesSurface,
  logicalResourceResolutionSurface,
])
